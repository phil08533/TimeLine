# My Circle

**Your photos. Your drive. Your rules.**

My Circle is a private photo & file sharing app. No backend, no ads, no middleman.
Everything lives in *your* Google Drive. You control who sees what.

> **You own your data.** Delete a file from your Drive and it's gone everywhere.
> We don't have servers. There's nothing to breach.

---

## How it works for users

1. Open the app and click **Sign in with Google**
2. The app creates a `mycircle/` folder in your Drive automatically
3. Add friends, create circles, upload photos — everything saves to your Drive
4. Friends you share with access your files directly via Google's own permission system

That's it. No account creation, no passwords, no settings to configure.

---

## Development stages

Progress is tracked here. Each stage is pushed separately for review.

| # | Stage | Status |
|---|-------|--------|
| 1 | **Auth** — Google sign-in, session, first-run Drive setup | ✅ Done |
| 2 | **Profile** — display name, handle, bio, avatar | ✅ Done |
| 3 | **Friends** — add by email, remove, block/unblock | ✅ Done |
| 4 | **Collections** — create albums, upload files, set sharing | ✅ Done |
| 5 | **Circles** — group folders, invite members, upload | ✅ Done |
| 6 | **Feed** — see files friends have shared with you | 🔧 Needs fix |
| 7 | **Copy & manage** — copy friends' files, delete your own, storage viewer | [ ] Not started |
| 8 | **Sign-in screen** — clean login UX, site-owner Client ID setup | 🔧 In progress |
| 9 | **Theme & polish** — visual themes, colour picker, mobile UX | ✅ Done |
| 10 | **About & licensing** — ownership pitch, MIT license, how it works | [ ] Not started |

### What "basically working" means
Stages 1–6 + 8 complete. User can sign in, set up a profile, add friends,
create circles and collections, upload files, and see what friends share —
all without touching a config file or knowing what JSON is.

---

## For site owners (hosting your own instance)

You need a Google OAuth Client ID. Do this once — your users never see it.

### Quick setup
1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Create a project → enable **Google Drive API**
3. **APIs & Services → Credentials → Create → OAuth 2.0 Client ID** (Web application)
4. Add your GitHub Pages URL as an **Authorised JavaScript origin**
5. Copy the Client ID

Then either:
- **Option A (easy):** Open the app, expand "Configure Google login", paste the Client ID, save
- **Option B (deploy):** Copy `config.example.js` → `config.js`, fill in your Client ID, push

Your users then just open the URL and click **Sign in with Google**.

### Deploy to GitHub Pages
1. Fork this repo
2. Settings → Pages → source: `main` branch, root
3. Live at `https://YOUR_USERNAME.github.io/TimeLine/`

---

## File structure

```
my-circle/
├── index.html            # Single-page app shell
├── config.example.js     # Config template (safe to commit)
├── config.js             # Your Client ID (NOT committed — gitignored)
└── js/
    ├── auth.js           # Google OAuth 2.0 via Identity Services
    ├── drive.js          # Google Drive REST API wrapper
    ├── data.js           # All data — profiles, friends, circles, collections
    ├── theme.js          # Visual theme + colour switching
    ├── ui.js             # SPA router and all page renderers
    └── utils.js          # Toasts, XSS prevention, retry, formatting
```

---

## Drive folder layout

Everything the app creates lives inside one folder in your Drive:

```
My Drive/
└── mycircle/
    ├── profile.json          ← your name, handle, bio
    ├── friends.json          ← friend list + block list
    ├── settings.json         ← theme, sharing defaults
    ├── circles/
    │   └── circle-{id}/      ← shared Drive folder (Google handles permissions)
    │       └── _meta.json    ← circle name, members, settings
    └── collections/
        └── coll-{id}/        ← your album folder
            ├── _meta.json    ← name, sharing settings
            ├── reactions.json
            └── photo.jpg
```

---

## Privacy & security

- OAuth tokens in **`sessionStorage`** only — cleared on tab close
- All text rendered with `.textContent` — no XSS via `.innerHTML`
- Files validated before upload
- No server, no database, no telemetry, no analytics
- MIT licensed — read the source, fork it, self-host it

---

## License

MIT — free to use, modify, and self-host.
