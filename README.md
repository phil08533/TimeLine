# My Circle

**Your photos. Your drive. Your rules.**

My Circle is a private photo & file sharing app with no backend, no ads, and no middleman.
Everything lives in *your* Google Drive. You control who sees what — friends, circles, or nobody.

---

## What it does

- **Share files with friends** — photos, videos, anything — straight from your Google Drive
- **Circles** — like group chats but for shared albums. Add friends, set who can add members
- **Collections** — curated folders you share with specific people or the world
- **Feed** — see what your friends have shared with you
- **Profile** — set a display name, handle, and bio
- **Drive manager** — see your storage usage and largest files at a glance
- **Block list** — block anyone, anytime
- **You own your data** — delete a file from your Drive, it's gone everywhere. No copies on our servers. *We don't have servers.*

---

## How to run it

### Option A — Paste your Client ID in the app (easiest)

1. Open the app (your GitHub Pages URL or `index.html` locally)
2. Click **Configure Google login** on the sign-in screen
3. Follow the on-screen steps to get a Client ID from Google Cloud Console
4. Paste it in and hit **Save**
5. Click **Sign in with Google**

Your Client ID is saved in your browser's `localStorage`. Nothing is sent anywhere.

### Option B — `config.js` file (for self-hosted / team deploys)

1. Copy the template:
   ```bash
   cp config.example.js config.js
   ```
2. Edit `config.js` and fill in your Client ID:
   ```javascript
   var CONFIG = {
     GOOGLE_CLIENT_ID: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
     APP_FOLDER: 'mycircle'
   };
   ```
3. Deploy to GitHub Pages (see below)

> `config.js` is in `.gitignore` — never commit it.

---

## Deploy to GitHub Pages

1. Fork this repo
2. Go to **Settings → Pages** → set source to the `main` branch, root folder
3. Your app is live at `https://YOUR_USERNAME.github.io/TimeLine/`

### Google Cloud Console setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Create a project and enable **Google Drive API**
3. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorised JavaScript origins: `https://YOUR_USERNAME.github.io`
4. Copy the Client ID — paste it in the app (Option A above) or into `config.js` (Option B)

---

## File structure

```
my-circle/
├── index.html          # Single-page app shell
├── config.example.js   # Config template (safe to commit)
├── config.js           # Your credentials (NOT committed)
├── css/
│   └── styles.css
└── js/
    ├── auth.js         # Google OAuth 2.0 via Identity Services
    ├── drive.js        # Google Drive REST API wrapper
    ├── data.js         # Profiles, friends, circles, collections
    ├── theme.js        # Visual theme + colour switching
    ├── ui.js           # SPA router and all page renderers
    └── utils.js        # Helpers — toasts, XSS, retry, formatting
```

---

## How the data model works

Everything is stored as files and folders inside a single `mycircle/` folder in your Google Drive:

```
My Drive/
└── mycircle/
    ├── profile.json          ← your display name, handle, bio
    ├── friends.json          ← friend list + block list
    ├── settings.json         ← theme, sharing defaults
    ├── circles/
    │   └── {circle-name}/    ← a Drive folder shared with circle members
    │       └── circle.json   ← metadata (members, add policy)
    └── collections/
        └── {collection-name}/
            ├── collection.json
            ├── reactions.json
            └── your-photo.jpg
```

Sharing = Google Drive's native file permissions. No custom access-control logic on our end.

---

## Privacy & security

- OAuth tokens stored in **`sessionStorage`** only — cleared when you close the tab
- All text rendered with `.textContent`, never `.innerHTML` — no XSS
- File types and sizes validated before upload
- No server, no database, no telemetry
- MIT licensed — read the source, fork it, run your own instance

---

## Features

| Feature | Status |
|---|---|
| Google OAuth sign-in | ✅ |
| In-app Client ID setup (no config file needed) | ✅ |
| Demo mode (no Google account required) | ✅ |
| Profile (name, handle, bio, avatar) | ✅ |
| Friends list (add by email, remove, block) | ✅ |
| Circles (shared Drive folders with members) | ✅ |
| Collections (personal albums with sharing settings) | ✅ |
| Feed (photos from friends' shared folders) | ✅ |
| Upload photos & videos | ✅ |
| Lightbox with comments & reactions | ✅ |
| Drive storage usage viewer | ✅ |
| Theme switcher (Minimal / Brutalist / Soft / Editorial) | ✅ |
| Colour themes (Paper / Midnight / Forest / Coral / Slate) | ✅ |
| Mobile responsive | ✅ |
| Sharing defaults per user | ✅ |

---

## License

MIT — free to use, modify, and self-host.
