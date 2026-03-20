// js/auth.js — Google OAuth 2.0 via Google Identity Services (GIS)
'use strict';

const Auth = (() => {

  let _tokenClient   = null;
  let _accessToken   = null;
  let _tokenExpiry   = 0;
  let _currentUser   = null;    // { userId, name, email, picture }
  let _onSignInCb    = null;
  let _onSignOutCb   = null;

  const SESSION_KEY_TOKEN  = 'mc_access_token';
  const SESSION_KEY_EXPIRY = 'mc_token_expiry';
  const SESSION_KEY_USER   = 'mc_user';

  /* ── Initialise ────────────────────────────────── */

  function init({ onSignIn, onSignOut } = {}) {
    _onSignInCb  = onSignIn  || (() => {});
    _onSignOutCb = onSignOut || (() => {});

    // Restore any token saved this session
    _restoreSession();

    // Build GIS token client once the library has loaded
    if (typeof google === 'undefined' || !google.accounts) {
      // GIS not loaded (e.g. demo mode or offline) — handled below
      return;
    }

    _initTokenClient();
  }

  function _initTokenClient() {
    if (_tokenClient) return;

    const cfg = _getConfig();
    if (!cfg) return;

    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cfg.GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive openid email profile',
      callback: _handleTokenResponse
    });
  }

  function _getConfig() {
    // Allow runtime-configured Client ID (stored by setup UI)
    const storedId = localStorage.getItem('mc_client_id');
    if (storedId && storedId.includes('.apps.googleusercontent.com')) {
      return Object.assign({}, typeof CONFIG !== 'undefined' ? CONFIG : {}, { GOOGLE_CLIENT_ID: storedId });
    }
    if (typeof CONFIG === 'undefined') return null;
    if (!CONFIG.GOOGLE_CLIENT_ID || CONFIG.GOOGLE_CLIENT_ID.startsWith('YOUR_')) return null;
    return CONFIG;
  }

  function setClientId(clientId) {
    if (!clientId || !clientId.includes('.apps.googleusercontent.com')) return false;
    localStorage.setItem('mc_client_id', clientId.trim());
    _tokenClient = null; // reset so it re-initialises with new ID
    return true;
  }

  function clearClientId() {
    localStorage.removeItem('mc_client_id');
    _tokenClient = null;
  }

  function hasRealCredentials() {
    return !!_getConfig();
  }

  /* ── Sign In ───────────────────────────────────── */

  async function signIn() {
    // Demo mode — no real credentials configured
    if (!_getConfig()) {
      await _signInDemo();
      return;
    }

    // Ensure GIS is loaded
    if (!_tokenClient) {
      if (typeof google !== 'undefined' && google.accounts) {
        _initTokenClient();
      } else {
        Utils.showToast('Google Sign-In library not loaded. Check your network connection.', 'error');
        return;
      }
    }

    // If we have a valid token, proceed directly
    if (_isTokenValid()) {
      await _fetchUserInfo();
      _onSignInCb(_currentUser);
      return;
    }

    // Request a new access token (opens Google pop-up / redirect)
    _tokenClient.requestAccessToken({ prompt: 'select_account' });
  }

  async function _handleTokenResponse(response) {
    if (response.error) {
      console.error('OAuth error:', response.error, response.error_description);
      Utils.showToast('Sign-in failed: ' + (response.error_description || response.error), 'error');
      return;
    }

    _accessToken = response.access_token;
    // GIS returns expires_in in seconds
    _tokenExpiry = Date.now() + (response.expires_in - 60) * 1000;

    _saveSession();

    await _fetchUserInfo();
    _onSignInCb(_currentUser);
  }

  /* ── Demo Mode ─────────────────────────────────── */

  async function _signInDemo() {
    _currentUser = {
      userId:  'demo-user',
      name:    'Demo User',
      email:   'demo@example.com',
      picture: null
    };
    _accessToken = 'DEMO_TOKEN';
    _tokenExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24h

    sessionStorage.setItem(SESSION_KEY_USER, JSON.stringify(_currentUser));
    _onSignInCb(_currentUser);
  }

  /* ── User Info ─────────────────────────────────── */

  async function _fetchUserInfo() {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${_accessToken}` }
      });
      if (!res.ok) throw new Error('userinfo HTTP ' + res.status);
      const info = await res.json();

      _currentUser = {
        userId:  info.sub,
        name:    info.name,
        email:   info.email,
        picture: info.picture || null
      };
      sessionStorage.setItem(SESSION_KEY_USER, JSON.stringify(_currentUser));
    } catch (err) {
      console.error('Failed to fetch user info:', err);
    }
  }

  /* ── Session Persistence ───────────────────────── */

  function _saveSession() {
    sessionStorage.setItem(SESSION_KEY_TOKEN,  _accessToken);
    sessionStorage.setItem(SESSION_KEY_EXPIRY, String(_tokenExpiry));
  }

  function _restoreSession() {
    const token  = sessionStorage.getItem(SESSION_KEY_TOKEN);
    const expiry = parseInt(sessionStorage.getItem(SESSION_KEY_EXPIRY) || '0', 10);
    const userRaw = sessionStorage.getItem(SESSION_KEY_USER);

    if (token && expiry > Date.now()) {
      _accessToken = token;
      _tokenExpiry = expiry;
    }

    if (userRaw) {
      const parsed = Utils.safeParseJSON(userRaw);
      if (parsed && parsed.userId) _currentUser = parsed;
    }
  }

  function _isTokenValid() {
    return !!_accessToken && _tokenExpiry > Date.now();
  }

  /* ── Sign Out ──────────────────────────────────── */

  function signOut() {
    if (_accessToken && typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
      google.accounts.oauth2.revoke(_accessToken, () => {});
    }

    _accessToken  = null;
    _tokenExpiry  = 0;
    _currentUser  = null;

    sessionStorage.removeItem(SESSION_KEY_TOKEN);
    sessionStorage.removeItem(SESSION_KEY_EXPIRY);
    sessionStorage.removeItem(SESSION_KEY_USER);

    _onSignOutCb();
  }

  /* ── Getters ───────────────────────────────────── */

  function getAccessToken() {
    if (!_isTokenValid()) return null;
    return _accessToken;
  }

  function getCurrentUser() {
    return _currentUser ? Object.assign({}, _currentUser) : null;
  }

  function isSignedIn() {
    return _isTokenValid() && !!_currentUser;
  }

  function isDemoMode() {
    return _accessToken === 'DEMO_TOKEN';
  }

  /* ── Exports ───────────────────────────────────── */

  return {
    init,
    signIn,
    signOut,
    getAccessToken,
    getCurrentUser,
    isSignedIn,
    isDemoMode,
    setClientId,
    clearClientId,
    hasRealCredentials
  };
})();
