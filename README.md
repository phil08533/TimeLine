# TimeLine

A minimal, friends-only photo and text sharing social network.
**No servers.** The entire backend is Google Drive. The frontend is a static page hosted on GitHub Pages.

---

## Quick Start (Demo Mode)

Open `index.html` in a browser and click **Sign In with Google**.
Without a `js/config.js` file the app runs in **demo mode** — no Google account required, data stored locally in the browser.

---

## Deploy to GitHub Pages (Full Mode)

### 1. Google Cloud Console setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Create a new project (e.g. `timeline-app`)
3. Enable **Google Drive API**
4. Create **OAuth 2.0 credentials** (Web Application type):
   - Authorised JavaScript origins: `https://YOUR_USERNAME.github.io`
   - Authorised redirect URIs: `https://YOUR_USERNAME.github.io/timeline/`
5. Create an **API Key** → restrict it to *Drive API* and your GitHub Pages domain
6. Copy `CLIENT_ID` and `API_KEY`

### 2. Configure the app

```bash
cp config.example.js js/config.js
```

Edit `js/config.js`:

```javascript
const CONFIG = {
  GOOGLE_CLIENT_ID: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
  GOOGLE_API_KEY:   'YOUR_API_KEY',
  REDIRECT_URI:     'https://YOUR_USERNAME.github.io/timeline/',
  APP_FOLDER:       'timeline',
  DEMO_MODE:        false,
  MAX_FILE_SIZE: {
    image: 10 * 1024 * 1024,
    video: 100 * 1024 * 1024,
    json:  100 * 1024
  }
};
```

> **Important:** `js/config.js` is in `.gitignore`. Never commit it.

### 3. Push and enable GitHub Pages

```bash
git add .
git commit -m "Initial deploy"
git push origin main
```

Then go to **Settings → Pages** and set the source to the `main` branch, root folder.

---

## File Structure

```
timeline/
├── index.html          # Single-page app shell
├── config.example.js   # Config template (safe to commit)
├── css/
│   └── styles.css      # All styling
├── js/
│   ├── config.js       # Your credentials (NOT committed — copy from example)
│   ├── utils.js        # XSS helpers, toasts, debounce, retry
│   ├── auth.js         # Google OAuth via Identity Services
│   ├── drive.js        # Google Drive REST API wrapper
│   ├── posts.js        # Post / profile / friends CRUD
│   └── ui.js           # DOM rendering and event wiring
└── README.md
```

---

## Google Drive Folder Layout

```
My Drive/
└── timeline/
    ├── profiles/
    │   └── {userId}/
    │       ├── profile.json
    │       └── friends.json
    └── posts/
        └── {userId}/
            ├── post-{timestamp}.json
            └── media-{timestamp}-{filename}
```

---

## MVP Feature Checklist

- [x] Google OAuth login / logout (demo mode without credentials)
- [x] Create text posts (max 500 characters)
- [x] Upload image / video posts (jpg, png, gif, webp, mp4, webm)
- [x] Add / remove friends by email
- [x] Choose which friends see each post
- [x] Private / public toggle per post
- [x] Timeline view with relative timestamps
- [x] Hand-drawn image frame aesthetic
- [x] XSS prevention (`textContent`, `escapeHtml`)
- [x] File-size validation (10 MB images, 100 MB videos)
- [x] Rate-limit error handling (Drive 403/429)
- [x] Retry with exponential back-off
- [x] Mobile-first responsive layout
- [x] Toast notifications

---

## Security Notes

- OAuth access tokens are stored in **`sessionStorage`** only (cleared on tab close)
- All user-generated text is rendered with `.textContent` — never `.innerHTML`
- File types and sizes are validated before upload
- No server-side components; attack surface is limited to Google's APIs

---

## License

MIT
