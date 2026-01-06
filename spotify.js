// 🔒 Require valid Spotify credentials from environment variables
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
  console.error('ERROR: SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET environment variables are required.');
  console.error('Please set them before starting the server:');
  console.error('  $env:SPOTIFY_CLIENT_ID="your_client_id"');
  console.error('  $env:SPOTIFY_CLIENT_SECRET="your_client_secret"');
}

// Ensure fetch is available (Node 18+ has it built-in; older versions need node-fetch)
if (typeof fetch === 'undefined' && typeof require !== 'undefined') {
  try {
    global.fetch = require('node-fetch');
  } catch (e) {
    console.warn('Warning: node-fetch not available; fetch will fail in Node < 18');
  }
}

// ===== MOOD TO AUDIO-FEATURES MAPPING =====
const MOOD_FEATURES = {
  happy: { valence: 0.8, energy: 0.75, danceability: 0.85, acousticness: 0.15, tempo: 120 },
  energetic: { valence: 0.85, energy: 0.85, danceability: 0.8, acousticness: 0.1, tempo: 130 },
  calm: { valence: 0.3, energy: 0.2, danceability: 0.3, acousticness: 0.7, tempo: 70 },
  sad: { valence: 0.2, energy: 0.25, danceability: 0.25, acousticness: 0.8, tempo: 60 },
  stressed: { valence: 0.35, energy: 0.3, danceability: 0.4, acousticness: 0.6, tempo: 75 },
};

// ===== AGE GROUP AUDIO-FEATURE ADJUSTMENTS =====
const AGE_ADJUSTMENTS = {
  "13-17": { danceability: 0.05, tempo: 10, energy: 0.03 },
  "18-25": { danceability: 0.02, tempo: 0, energy: 0 },
  "26-35": { acousticness: 0.03, tempo: -5 },
  "36-50": { acousticness: 0.05, tempo: -10, energy: -0.05 },
  "50+": { acousticness: 0.08, tempo: -15, energy: -0.1 },
};

// ===== MOOD-TO-GENRE SEED MAPPING =====
const MOOD_GENRES = {
  happy: "pop,indie-pop,electro-pop",
  energetic: "dance,electronic,hip-hop",
  calm: "ambient,indie-folk,acoustic",
  sad: "indie,alternative,folk",
  stressed: "lo-fi,chill-pop,singer-songwriter",
};

async function getSpotifyToken() {
  const tokenUrl = "https://accounts.spotify.com/api/token";

  // Encode credentials for Basic auth. Use Buffer in Node, fall back to btoa in browsers.
  const rawCreds = `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`;
  const credentials = typeof Buffer !== "undefined"
    ? Buffer.from(rawCreds).toString("base64")
    : (typeof btoa === "function" ? btoa(rawCreds) : null);

  if (!credentials) throw new Error("Unable to encode Spotify credentials in this environment.");

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${credentials}`,
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get Spotify token: ${res.status} ${res.statusText} - ${text}`);
  }

  const data = await res.json();
  return data && data.access_token ? data.access_token : null;
}
async function searchSongsByMood(mood) {
  const token = await getSpotifyToken();
  if (!token) throw new Error("No Spotify access token available.");

  const res = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(mood)}&type=track&limit=5`,
    {
      headers: {
        "Authorization": `Bearer ${token}`,
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify search failed: ${res.status} ${res.statusText} - ${text}`);
  }

  const data = await res.json();
  return (data && data.tracks && data.tracks.items) ? data.tracks.items : [];
}

// ===== NEW: GET RECOMMENDATIONS BY MOOD + AGE GROUP =====
async function getRecommendationsByMoodAndAge(moodKey, ageGroup = "18-25") {
  const token = await getSpotifyToken();
  if (!token) throw new Error("No Spotify access token available.");

  // Get base mood features
  let features = MOOD_FEATURES[moodKey.toLowerCase()] || MOOD_FEATURES.happy;
  
  // Apply age-group adjustments
  const adjustments = AGE_ADJUSTMENTS[ageGroup] || {};
  Object.keys(adjustments).forEach(key => {
    if (features.hasOwnProperty(key)) {
      features[key] = Math.max(0, Math.min(1, features[key] + adjustments[key]));
    } else if (key === "tempo") {
      features.tempo = Math.max(50, features.tempo + adjustments[key]);
    }
  });

  // Get seed genres for mood
  const genres = MOOD_GENRES[moodKey.toLowerCase()] || "pop";

  // Build recommendations query
  const params = new URLSearchParams({
    seed_genres: genres,
    limit: 8,
    target_valence: features.valence.toFixed(2),
    target_energy: features.energy.toFixed(2),
    target_danceability: features.danceability.toFixed(2),
    target_acousticness: features.acousticness.toFixed(2),
    target_tempo: Math.round(features.tempo),
  });

  const url = `https://api.spotify.com/v1/recommendations?${params.toString()}`;
  const res = await fetch(url, {
    headers: { "Authorization": `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify recommendations failed: ${res.status} ${res.statusText} - ${text}`);
  }

  const data = await res.json();
  return (data && data.tracks) ? data.tracks : [];
}

// If this file is run directly (node spotify.js), run a quick example.
if (typeof require !== "undefined" && require.main === module) {
  (async () => {
    try {
      const songs = await searchSongsByMood("happy");
      console.log(songs);
    } catch (err) {
      console.error(err);
    }
  })();
}
async function handleMoodClick(moodKey) {
  const username  = localStorage.getItem("username") || "guest";
  const ageGroup  = document.getElementById("age-group-select").value || "unknown";

  // 1) Your existing static recommendation (what you're showing now)
  const moodConfig = moodRecommendations[moodKey]; // e.g. { song: "Workout Beats", activity: "10-minute workout" }
  document.getElementById("result-mood-title").textContent = moodKey;
  document.getElementById("result-song").textContent       = moodConfig.song;
  document.getElementById("result-activity").textContent   = moodConfig.activity;

  // 2) NEW: get a real Spotify track for this mood
  const tracks = await searchSongsByMood(moodKey + " " + moodConfig.song); // from spotify.js
  if (!tracks || !tracks.length) {
    console.warn("No Spotify tracks found for mood:", moodKey);
    // you can still insert without spotify_id if you want
    return;
  }

  const track = tracks[0];

  // Optionally update the displayed song to the real one:
  document.getElementById("result-song").textContent =
    `${track.name} – ${track.artists[0].name}`;

  // 3) Play the preview
  if (track.preview_url) {
    const audio = new Audio(track.preview_url);
    audio.play();
  }

  // 4) Save to Supabase with spotify fields
  const { data, error } = await supabase.from("mood_logs").insert({
    user_id: username,
    mood: moodKey,
    age_group: ageGroup,
    spotify_id: track.id,  // 👈 this will no longer be NULL
    listened: true,        // later you can change based on skip
    play_seconds: 0
  });

  if (error) {
    console.error("Error saving mood log:", error);
  } else {
    console.log("Saved mood log:", data);
  }
}

// Export helpers for server use when required in Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getRecommendationsByMoodAndAge,
    searchSongsByMood,
    getSpotifyToken
  };
}
