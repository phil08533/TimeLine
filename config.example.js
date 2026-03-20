// My Circle — Configuration
// Copy this file to config.js and fill in your Google Cloud credentials.
// DO NOT commit config.js to version control.
//
// Setup:
//   1. Create a project at https://console.cloud.google.com/
//   2. Enable the Google Drive API
//   3. Create OAuth 2.0 credentials (Web Application)
//   4. Add your site URL as an authorized JavaScript origin
//   5. Copy your CLIENT_ID below

if (typeof CONFIG === 'undefined') {
  var CONFIG = {
    GOOGLE_CLIENT_ID: '587233718402-qhush9gi9rqrqbmv744oggf65s4f5aus.apps.googleusercontent.com',
    APP_FOLDER: 'mycircle',
    MAX_FILE_SIZE: {
      image: 10 * 1024 * 1024,   // 10MB
      video: 100 * 1024 * 1024   // 100MB
    }
  };
}
