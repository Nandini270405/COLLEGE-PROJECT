// Minimal Node server to proxy Spotify search using Client Credentials
// Usage: set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in env, then `node server.js`

require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Allow JSON bodies for recommendations endpoint

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
// Hardcoded Supabase project URL to ensure consistent usage across environments
const SUPABASE_URL = 'https://ytykkyurraerxbrhwnge.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('=== Server Configuration ===');
console.log('SPOTIFY_CLIENT_ID:', SPOTIFY_CLIENT_ID ? '✓ set' : '✗ missing');
console.log('SPOTIFY_CLIENT_SECRET:', SPOTIFY_CLIENT_SECRET ? '✓ set' : '✗ missing');
console.log('SUPABASE_URL:', SUPABASE_URL || '✗ missing');
console.log('SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_ROLE_KEY ? '✓ set' : '✗ missing');
console.log('PORT:', PORT);
console.log('============================');

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
  console.warn('Warning: SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET not set. API will fail until provided.');
}

async function getSpotifyToken() {
  const tokenUrl = 'https://accounts.spotify.com/api/token';
  const creds = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${creds}`,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Token request failed: ${res.status} ${res.statusText} - ${txt}`);
  }
  const data = await res.json();
  return data.access_token;
}

// GET /api/search?q=comfort
app.get('/api/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Missing q query parameter' });

    const token = await getSpotifyToken();
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=8`;
    const apiRes = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!apiRes.ok) {
      const txt = await apiRes.text();
      return res.status(apiRes.status).json({ error: txt });
    }
    const data = await apiRes.json();
    return res.json({ tracks: data.tracks && data.tracks.items ? data.tracks.items : [] });
  } catch (err) {
    console.error('Error in /api/search', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/recommendations -> uses spotify.js recommendation helper (mood + age_group)
try {
  const spotifyHelper = require('./spotify');
  if (spotifyHelper && typeof spotifyHelper.getRecommendationsByMoodAndAge === 'function') {
    app.post('/api/recommendations', async (req, res) => {
      try {
        const { mood, age_group } = req.body || {};
        if (!mood) return res.status(400).json({ error: 'Missing mood in body' });
        const age = age_group || '18-25';
        const tracks = await spotifyHelper.getRecommendationsByMoodAndAge(mood, age);
        return res.json({ tracks: tracks || [] });
      } catch (err) {
        console.error('Error in /api/recommendations', err.message, err.stack);
        return res.status(500).json({ error: err.message || 'Failed to get recommendations' });
      }
    });
  } else {
    console.warn('getRecommendationsByMoodAndAge not exported from spotify.js');
  }
} catch (e) {
  console.warn('Could not register /api/recommendations endpoint:', e && e.message);
}

// POST /api/log  -> save mood log to Supabase via REST using service role key
app.post('/api/log', async (req, res) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured on server.' });
    }

    const body = req.body;
    // Basic validation
    const allowed = ['user_id','mood','age_group','note','spotify_id','listened','play_seconds'];
    const payload = {};
    for (const k of allowed) if (body[k] !== undefined) payload[k] = body[k];

    // Set defaults
    if (!payload.user_id) payload.user_id = 'guest';
    if (!payload.mood) return res.status(400).json({ error: 'Missing mood in payload' });

    console.log('POST /api/log payload:', payload);
    const insertUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/mood_logs`;
    console.log('Supabase insert URL:', insertUrl);
    
    const insertRes = await fetch(insertUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(payload),
    });

    const text = await insertRes.text();
    console.log('Supabase response status:', insertRes.status, 'body:', text);
    
    if (!insertRes.ok) {
      console.error('Supabase insert failed:', insertRes.status, text);
      return res.status(insertRes.status).json({ error: text });
    }

    // Supabase returns JSON array for inserted rows when using return=representation
    let data;
    try { data = JSON.parse(text); } catch (e) { data = text; }
    console.log('Inserted data:', data);
    return res.json({ inserted: data });
  } catch (err) {
    console.error('Error in /api/log', err.message, err.stack);
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/log/:id -> update existing mood_log row (e.g., play_seconds)
app.patch('/api/log/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Missing id param' });
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured on server.' });
    }

    const updateUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/mood_logs?id=eq.${encodeURIComponent(id)}`;
    const updateRes = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(req.body)
    });

    const text = await updateRes.text();
    if (!updateRes.ok) return res.status(updateRes.status).json({ error: text });
    let data;
    try { data = JSON.parse(text); } catch (e) { data = text; }
    return res.json({ updated: data });
  } catch (err) {
    console.error('Error in PATCH /api/log/:id', err);
    return res.status(500).json({ error: err.message });
  }
});

// Serve static files AFTER API routes
app.use(express.static(path.join(__dirname, '')));

app.listen(PORT, () => {
  console.log(`Spotify proxy server listening on http://localhost:${PORT}`);
});
