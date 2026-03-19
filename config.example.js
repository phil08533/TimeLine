// TimeLine Configuration
// Copy this file to js/config.js and fill in your Google Cloud credentials.
// DO NOT commit js/config.js to version control.
//
// Setup steps:
//   1. Create a project at https://console.cloud.google.com/
//   2. Enable the Google Drive API
//   3. Create OAuth 2.0 credentials (Web Application)
//   4. Add your GitHub Pages URL as an authorized redirect URI
//   5. Create an API Key (restrict to Drive API)
//   6. Copy CLIENT_ID and API_KEY below

// Guard: config.js takes precedence if already loaded
if (typeof CONFIG === 'undefined') {
  var CONFIG = {
    GOOGLE_CLIENT_ID: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
    GOOGLE_API_KEY: 'YOUR_API_KEY',
    REDIRECT_URI: 'https://YOUR_USERNAME.github.io/timeline/',
    APP_FOLDER: 'timeline',
    // Demo mode activates automatically when CLIENT_ID is not configured
    DEMO_MODE: true,
    MAX_FILE_SIZE: {
      image: 10 * 1024 * 1024,   // 10MB
      video: 100 * 1024 * 1024,  // 100MB
      json:  100 * 1024          // 100KB
    }
  };
}
