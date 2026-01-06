// mood.js — clean frontend for mood.html
(function(){
  // Small helper to determine API base; falls back to localhost when opened via file://
  const API_FALLBACK = 'http://localhost:3002';
  function getApiBase(){
    try{
      const origin = window.location.origin;
      if (origin && origin !== 'null' && !origin.startsWith('file:')) return origin;
    }catch(e){}
    return API_FALLBACK;
  }

  const moodToActivities = {
    happy: ["Go for a short walk","Call a friend","Dance for 5 minutes"],
    energetic: ["Quick HIIT (10 mins)","Go for a run","Do a cycling sprint"],
    calm: ["5-minute breathing","Read for 15 minutes","Do gentle stretching"],
    sad: ["Write a short journal entry","Listen to soothing music","Take a warm shower"],
    stressed: ["Try a 3-minute breathing break","Declutter one small area","Make a warm drink"]
  };

  const $mood = document.getElementById('mood-select');
  const $age = document.getElementById('age-group-select');
  const $go = document.getElementById('go');
  const $activity = document.getElementById('activity');
  const $tracksList = document.getElementById('tracks-list');
  const $player = document.getElementById('player');
  const $status = document.getElementById('status');

  let currentLogId = null;
  let currentPlaySeconds = 0;

  function setStatus(msg, timeout=3000){
    if(!$status) return;
    $status.textContent = msg;
    clearTimeout(setStatus._t);
    if(timeout>0) setStatus._t = setTimeout(()=>{ $status.textContent = ''; }, timeout);
  }

  function pickActivity(mood){
    const list = moodToActivities[mood] || ["Take a break"];
    return list[Math.floor(Math.random()*list.length)];
  }

  async function getRecommendations(mood, age){
    const base = getApiBase();
    try{
      const res = await fetch(`${base}/api/recommendations`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ mood, age_group: age })
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Status ${res.status}`);
      }
      const json = await res.json();
      return json.tracks || [];
    }catch(err){
      console.warn('Recommendations failed, falling back to search', err);
      return [];
    }
  }

  async function searchTracks(query){
    const base = getApiBase();
    try{
      const res = await fetch(`${base}/api/search?q=${encodeURIComponent(query)}`);
      if(!res.ok){
        const txt = await res.text();
        throw new Error(txt||`Status ${res.status}`);
      }
      const json = await res.json();
      return json.tracks || [];
    }catch(err){
      console.warn('Search failed', err);
      return [];
    }
  }

  function renderTracks(tracks){
    if(!$tracksList) return;
    if(!tracks || !tracks.length){
      $tracksList.innerHTML = '<div>No tracks found.</div>';
      if($player) $player.src = '';
      return;
    }
    $tracksList.innerHTML = '';
    tracks.forEach(t=>{
      const div = document.createElement('div'); div.className='track';
      const title = document.createElement('div'); title.textContent = `${t.name} — ${t.artists.map(a=>a.name).join(', ')}`;
      const actions = document.createElement('div');
      const btnPlay = document.createElement('button'); btnPlay.textContent = 'Play preview'; btnPlay.disabled = !t.preview_url;
      btnPlay.addEventListener('click', ()=>{
        if(!t.preview_url){ alert('No preview available for this track.'); return; }
        if($player){ $player.src = t.preview_url; $player.play(); }
      });
      const btnUse = document.createElement('button'); btnUse.textContent='Use as suggested'; btnUse.style.marginLeft='8px';
      btnUse.addEventListener('click', ()=> useTrackAsSuggestion(t));
      actions.appendChild(btnPlay); actions.appendChild(btnUse);
      div.appendChild(title); div.appendChild(actions); $tracksList.appendChild(div);
    });
  }

  async function useTrackAsSuggestion(track){
    if(!$activity || !$mood) return;
    const mood = $mood.value;
    const age = $age.value || '18-25';
    
    // Validate mood selection
    if (!mood) {
      setStatus('Please select a mood first');
      return;
    }
    
    $activity.textContent = `Try: ${pickActivity(mood)} — Suggested track: ${track.name} — ${track.artists?.[0]?.name || ''}`;
    if(track.preview_url && $player){ $player.src = track.preview_url; $player.play(); }

    // Save to server with validated age_group
    try{
      const payload = {
        user_id: localStorage.getItem('username') || 'guest',
        mood: mood,
        age_group: age,
        spotify_id: track.id,
        listened: true,
        play_seconds: 0
      };
      const base = getApiBase();
      const resp = await fetch(`${base}/api/log`, {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
      });
      if(!resp.ok){ const txt = await resp.text(); setStatus('Failed to save mood log'); console.warn('Save failed', txt); return; }
      const json = await resp.json();
      if(json && json.inserted && json.inserted[0] && json.inserted[0].id){ currentLogId = json.inserted[0].id; setStatus('Saved mood log'); }
      else { setStatus('Saved mood log'); }
    }catch(err){ console.error('Error saving mood log', err); setStatus('Error saving mood log'); }
  }

  // UI event
  if($go){
    $go.addEventListener('click', async ()=>{
      const mood = $mood.value;
      const age = $age.value || '18-25';
      if(!mood){ setStatus('Please choose a mood'); return; }
      $tracksList.innerHTML = 'Searching...';
      // Try recommendations first
      let tracks = await getRecommendations(mood, age);
      if(!tracks || !tracks.length){
        // fallback to search combining mood+activity keyword
        const activity = pickActivity(mood);
        const query = `${mood} ${activity.split(' ')[0]}`;
        tracks = await searchTracks(query);
      }
      renderTracks(tracks);
    });
  }

  // Playback tracking to update play_seconds
  if($player){
    $player.addEventListener('timeupdate', ()=>{ currentPlaySeconds = Math.floor($player.currentTime || 0); });
    $player.addEventListener('pause', ()=> flushPlaySeconds(false));
    $player.addEventListener('ended', ()=> flushPlaySeconds(true));
  }

  async function flushPlaySeconds(final=false){
    if(!currentLogId) return;
    try{
      const body = { play_seconds: currentPlaySeconds };
      if(final) body.listened = $player?.ended || !$player?.paused;
      await fetch(`${getApiBase()}/api/log/${encodeURIComponent(currentLogId)}`, {
        method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
      });
    }catch(err){ console.warn('Failed to flush play seconds', err); }
  }

  window.addEventListener('beforeunload', ()=>{ if(currentLogId){ try{ navigator.sendBeacon(`${getApiBase()}/api/log/${encodeURIComponent(currentLogId)}`, JSON.stringify({play_seconds: currentPlaySeconds})); }catch(e){} } });

})();
// Frontend: calls /api/search?q=... and suggests activities per mood
(function(){
  const moodToActivities = {
    happy: ["Go for a short walk","Call a friend","Dance for 5 minutes"],
    energetic: ["Quick HIIT (10 mins)","Go for a run","Do a cycling sprint"],
    calm: ["5-minute breathing","Read for 15 minutes","Do gentle stretching"],
    sad: ["Write a short journal entry","Listen to soothing music","Take a warm shower"],
    stressed: ["Try a 3-minute breathing break","Declutter one small area","Make a warm drink"]
  };
      // Prefer recommendations endpoint which uses audio-features mapping
      const body = { mood: query.mood || query, age_group: query.age_group || '18-25' };
      const recRes = await fetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (recRes.ok) {
        const json = await recRes.json();
        return json.tracks || [];
      }

      // Fallback to simple search if recommendations not available
      const q = typeof query === 'string' ? query : (query.mood || 'mood');
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if(!res.ok){
        const txt = await res.text();
        throw new Error(txt || 'Search failed');
      }
      const data = await res.json();
      return data.tracks || [];
  let currentLogId = null;
  let currentPlaySeconds = 0;

  function pickActivity(mood){
    const list = moodToActivities[mood] || ["Take a break"];
    return list[Math.floor(Math.random()*list.length)];
  }

  async function searchTracks(query){
    try{
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if(!res.ok){
        const txt = await res.text();
        throw new Error(txt || 'Search failed');
      }
      const data = await res.json();
      return data.tracks || [];
    }catch(err){
      console.error('Search error',err);
      return [];
    }
  }

  function renderTracks(tracks){
    if(!tracks || !tracks.length){
      $tracksList.innerHTML = '<div>No tracks found.</div>';
      $player.src = '';
      return;
    }

    $tracksList.innerHTML = '';
    tracks.forEach((t, idx)=>{
      const div = document.createElement('div');
      div.className = 'track';
      const title = document.createElement('div');
      title.textContent = `${t.name} — ${t.artists.map(a=>a.name).join(', ')}`;

      const actions = document.createElement('div');
      const btnPlay = document.createElement('button');
      btnPlay.textContent = 'Play preview';
      btnPlay.disabled = !t.preview_url;
      btnPlay.addEventListener('click', ()=>{
        if(t.preview_url){
          $player.src = t.preview_url;
          $player.play();
        } else {
          alert('No preview available for this track.');
        }
      });

      const btnUse = document.createElement('button');
      btnUse.textContent = 'Use as suggested';
      btnUse.style.marginLeft = '8px';
      btnUse.addEventListener('click', ()=>{
        $activity.textContent = `Try: ${pickActivity($mood.value)} — Suggested track: ${t.name} — ${t.artists[0].name}`;
        if(t.preview_url){ $player.src = t.preview_url; $player.play(); }
          // Save log to server and capture returned id for updates
          (async ()=>{
            try{
              const payload = {
                user_id: localStorage.getItem('username') || 'guest',
                mood: $mood.value,
                age_group: $age.value,
                spotify_id: t.id,
                listened: true,
                play_seconds: 0
              };
                setStatus('Failed to save mood log');
                console.warn('Failed to save mood log:', txt);
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });
              if (!resp.ok) {
                const txt = await resp.text();
                setStatus('Saved mood log');
                console.log('Mood log created id=', currentLogId);
                return;
                console.log('Mood log response:', json);
                setStatus('Saved mood log');
              const json = await resp.json();
              // server returns { inserted: [ {...} ] }
              if (json && json.inserted && json.inserted[0] && json.inserted[0].id) {
                currentLogId = json.inserted[0].id;
                console.log('Mood log created id=', currentLogId);
              } else {
                console.log('Mood log response:', json);
              }
            }catch(err){ console.error('Error saving mood log',err); }
          })();
      });

      actions.appendChild(btnPlay);
      actions.appendChild(btnUse);

      div.appendChild(title);
      div.appendChild(actions);
      $tracksList.appendChild(div);
    });
  }

  $go.addEventListener('click', async ()=>{
    const mood = $mood.value;
    const age = $age.value;
    const activityText = pickActivity(mood);
    $activity.textContent = `${activityText} (age: ${age})`;

    // Build a search query combining mood + activity keywords to get better results
    const query = `${mood} ${activityText.split(' ')[0]}`;
    $tracksList.innerHTML = 'Searching...';
    const tracks = await searchTracks(query);
    renderTracks(tracks);
  });

  // Track play_seconds while audio plays and update server on pause/ended
  $player.addEventListener('timeupdate', ()=>{
    currentPlaySeconds = Math.floor($player.currentTime || 0);
  });

  async function flushPlaySeconds(final=false){
    if (!currentLogId) return;
    try{
      const body = { play_seconds: currentPlaySeconds };
      if (final) body.listened = $player.ended || !$player.paused;
      await fetch(`/api/log/${encodeURIComponent(currentLogId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      // console.log('Flushed play seconds', currentPlaySeconds);
    }catch(err){ console.warn('Failed to flush play seconds', err); }
  }

  $player.addEventListener('pause', ()=> flushPlaySeconds(false));
  $player.addEventListener('ended', ()=> flushPlaySeconds(true));

  // Try to send final update when leaving page
  window.addEventListener('beforeunload', ()=>{
    if (!currentLogId) return;
    try{
      const payload = JSON.stringify({ play_seconds: currentPlaySeconds });
      navigator.sendBeacon(`/api/log/${encodeURIComponent(currentLogId)}`, payload);
    }catch(e){ /* ignore */ }
  });

  // Small status helper for UI feedback
  const $status = document.getElementById('status');
  function setStatus(msg, timeout=3000){
    if(!$status) return;
    $status.textContent = msg;
    clearTimeout(setStatus._t);
    if (timeout>0) setStatus._t = setTimeout(()=>{ $status.textContent = ''; }, timeout);
  }

})();
