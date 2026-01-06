Quick steps to enable Spotify recommendations and playback (local development)

1) Install dependencies

```powershell
cd "c:\Users\KIIT0001\Desktop\APP_DEV_PROJECT"
npm install
```

2) Create a `.env` at the project root (or set environment vars in your OS)

- Copy `.env.example` to `.env` and paste your Spotify app credentials.

3) Run the server

```powershell
# dev (auto-reload)
npm run dev
# or run once
npm start
```

4) Keep `index.html` served from a web server or open in the browser. The client will call `http://localhost:3000/api/search?q=...` by default.

Notes
- This proxy uses the Client Credentials flow and should run on a trusted server — do not ship client secrets to browsers.
- If you host the site on a different origin, update the client fetch URL in `index.html`.
