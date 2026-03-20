// js/drive.js — Google Drive REST API wrapper for My Circle
'use strict';

const Drive = (() => {

  const BASE   = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

  /* ── HTTP helpers ─────────────────────────── */

  function _headers(extra = {}) {
    const token = Auth.getAccessToken();
    if (!token) throw Object.assign(new Error('Not authenticated'), { status: 401 });
    return Object.assign({ Authorization: `Bearer ${token}` }, extra);
  }

  async function _request(url, options = {}) {
    return Utils.withRetry(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000); // 15 s timeout
      let r;
      try {
        r = await fetch(url, { signal: controller.signal, ...options });
      } finally {
        clearTimeout(timer);
      }
      if (r.status === 401) {
        window.dispatchEvent(new CustomEvent('mc:session-expired'));
        throw Object.assign(new Error('Unauthorized'), { status: 401 });
      }
      if (r.status === 403) {
        const body = await r.clone().json().catch(() => ({}));
        const reason = body?.error?.errors?.[0]?.reason || '';
        if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded')
          throw Object.assign(new Error('Rate limit'), { status: 429 });
        throw Object.assign(new Error('Forbidden'), { status: 403 });
      }
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
      return r;
    }, 3, 1000);
  }

  async function _json(url, options = {}) {
    const r = await _request(url, options);
    return r.json();
  }

  /* ── Google People API (Contacts) ────────── */

  async function getContacts() {
    const url = 'https://people.googleapis.com/v1/people/me/connections' +
      '?personFields=names,emailAddresses&pageSize=200&sortOrder=LAST_NAME_ASCENDING';
    const data = await _json(url, { headers: _headers() });
    return (data.connections || [])
      .map(p => ({
        email: p.emailAddresses?.[0]?.value || null,
        name:  p.names?.[0]?.displayName   || null
      }))
      .filter(c => c.email);
  }

  /* ── Demo store ───────────────────────────── */

  const _demo = {
    _s: null,
    _store() {
      if (!this._s) {
        const raw = localStorage.getItem('mc_demo');
        this._s = raw ? (Utils.safeParseJSON(raw) || {}) : {};
      }
      return this._s;
    },
    _save() { try { localStorage.setItem('mc_demo', JSON.stringify(this._s)); } catch {} },
    get(k) { return this._store()[k] ?? null; },
    set(k, v) { this._store()[k] = v; this._save(); return k; },
    del(k) { delete this._store()[k]; this._save(); },
    list(prefix) {
      return Object.entries(this._store())
        .filter(([k]) => k.startsWith(prefix))
        .map(([id, content]) => ({ id, name: id.split('/').pop(), content, createdTime: new Date().toISOString(), mimeType: 'application/json' }));
    }
  };

  /* ── Folder cache ─────────────────────────── */

  const _fc = {};

  async function getOrCreateFolder(name, parentId = null) {
    const key = `${parentId || 'root'}/${name}`;
    if (_fc[key]) return _fc[key];

    const q = [
      `name='${name.replace(/'/g, "\\'")}'`,
      `mimeType='application/vnd.google-apps.folder'`,
      `trashed=false`,
      parentId ? `'${parentId}' in parents` : `'root' in parents`
    ].join(' and ');

    const data = await _json(`${BASE}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`, { headers: _headers() });

    if (data.files?.length) {
      _fc[key] = data.files[0].id;
      return data.files[0].id;
    }

    const meta = { name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) };
    const created = await _json(`${BASE}/files`, {
      method: 'POST',
      headers: _headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(meta)
    });
    _fc[key] = created.id;
    return created.id;
  }

  /* ── App folder init ──────────────────────── */

  // Returns { rootId, circlesFolderId, collectionsFolderId, contactsFolderId }
  async function initFolders() {
    const root        = await getOrCreateFolder('mycircle');
    const circles     = await getOrCreateFolder('circles',     root);
    const collections = await getOrCreateFolder('collections', root);
    const contacts    = await getOrCreateFolder('contacts',    root);
    return { rootId: root, circlesFolderId: circles, collectionsFolderId: collections, contactsFolderId: contacts };
  }

  /* ── File operations ──────────────────────── */

  async function listFiles(folderId, extraQ = '') {
    let q = `'${folderId}' in parents and trashed=false`;
    if (extraQ) q += ` and ${extraQ}`;
    const params = new URLSearchParams({ q, fields: 'files(id,name,createdTime,modifiedTime,mimeType,size,thumbnailLink)', orderBy: 'createdTime desc', spaces: 'drive', pageSize: '100' });
    const data = await _json(`${BASE}/files?${params}`, { headers: _headers() });
    return data.files || [];
  }

  async function readJsonFile(fileId) {
    const r = await _request(`${BASE}/files/${fileId}?alt=media`, { headers: _headers() });
    return r.json();
  }

  async function createJsonFile(name, content, folderId) {
    const meta = { name, mimeType: 'application/json', parents: [folderId] };
    const body = new FormData();
    body.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    body.append('file',     new Blob([JSON.stringify(content)], { type: 'application/json' }));
    return _json(`${UPLOAD}/files?uploadType=multipart&fields=id,name`, { method: 'POST', headers: _headers(), body });
  }

  async function updateJsonFile(fileId, content) {
    await _request(`${UPLOAD}/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: _headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(content)
    });
  }

  async function findFile(name, folderId) {
    const q = `name='${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`;
    const data = await _json(`${BASE}/files?${new URLSearchParams({ q, fields: 'files(id,name)', spaces: 'drive' })}`, { headers: _headers() });
    return data.files?.[0] || null;
  }

  async function upsertJsonFile(name, content, folderId) {
    const ex = await findFile(name, folderId);
    if (ex) { await updateJsonFile(ex.id, content); return ex.id; }
    const cr = await createJsonFile(name, content, folderId);
    return cr.id;
  }

  async function uploadMedia(file, folderId) {
    const meta = { name: `${Date.now()}-${file.name}`, mimeType: file.type, parents: [folderId] };
    const initRes = await _request(`${UPLOAD}/files?uploadType=resumable&fields=id,name`, {
      method: 'POST',
      headers: _headers({ 'Content-Type': 'application/json', 'X-Upload-Content-Type': file.type }),
      body: JSON.stringify(meta)
    });
    const uploadUrl = initRes.headers.get('Location');
    if (!uploadUrl) throw new Error('No upload URL');
    const r = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    if (!r.ok) throw Object.assign(new Error(`Upload failed ${r.status}`), { status: r.status });
    return r.json();
  }

  async function deleteFile(fileId) {
    await _request(`${BASE}/files/${fileId}`, { method: 'DELETE', headers: _headers() });
  }

  async function copyFile(fileId, destFolderId) {
    return _json(`${BASE}/files/${fileId}/copy`, {
      method: 'POST',
      headers: _headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ parents: [destFolderId] })
    });
  }

  /* ── Permissions / Sharing ────────────────── */

  async function shareWithEmail(fileId, email, role = 'reader') {
    await _json(`${BASE}/files/${fileId}/permissions?sendNotificationEmail=false`, {
      method: 'POST',
      headers: _headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ role, type: 'user', emailAddress: email })
    });
  }

  async function listPermissions(fileId) {
    const data = await _json(`${BASE}/files/${fileId}/permissions?fields=permissions(id,emailAddress,role)`, { headers: _headers() });
    return data.permissions || [];
  }

  async function removePermission(fileId, permissionId) {
    await _request(`${BASE}/files/${fileId}/permissions/${permissionId}`, { method: 'DELETE', headers: _headers() });
  }

  async function makePublic(fileId) {
    await _json(`${BASE}/files/${fileId}/permissions`, {
      method: 'POST',
      headers: _headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    });
  }

  /* ── Shared with me ───────────────────────── */

  async function listSharedWithMe() {
    const q = `sharedWithMe=true and trashed=false and mimeType='application/vnd.google-apps.folder'`;
    const params = new URLSearchParams({ q, fields: 'files(id,name,owners,createdTime,sharedWithMeTime)', spaces: 'drive', pageSize: '50' });
    const data = await _json(`${BASE}/files?${params}`, { headers: _headers() });
    return data.files || [];
  }

  /* ── Quota ────────────────────────────────── */

  async function getQuota() {
    const data = await _json(`${BASE}/about?fields=storageQuota`, { headers: _headers() });
    return data.storageQuota; // { limit, usage, usageInDrive }
  }

  async function listLargeFiles(limit = 10) {
    const params = new URLSearchParams({ fields: 'files(id,name,size,mimeType)', orderBy: 'quotaBytesUsed desc', pageSize: String(limit), spaces: 'drive' });
    const data = await _json(`${BASE}/files?${params}`, { headers: _headers() });
    return data.files || [];
  }

  /* ── Comments (Drive Comments API) ───────── */

  async function getComments(fileId) {
    const params = new URLSearchParams({ fields: 'comments(id,content,author,createdTime)', includeDeleted: 'false' });
    const data = await _json(`${BASE}/files/${fileId}/comments?${params}`, { headers: _headers() });
    return data.comments || [];
  }

  async function addComment(fileId, content) {
    return _json(`${BASE}/files/${fileId}/comments`, {
      method: 'POST',
      headers: _headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ content })
    });
  }

  /* ── Media URL ────────────────────────────── */

  // Returns a thumbnail URL usable directly in <img src>.
  // Prefers the Drive API's thumbnailLink (a signed URL that doesn't require browser
  // Google cookies), falling back to the cookie-based URL if no thumbnailLink is available.
  function getThumbnailUrl(fileId, size = 'w400', thumbnailLink = null) {
    if (Auth.isDemoMode()) return _demo.get(fileId) || '';
    if (thumbnailLink) return thumbnailLink;
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=${size}`;
  }

  // Alias kept for backward-compat callsites
  function getMediaUrl(fileId) {
    return getThumbnailUrl(fileId);
  }

  // Fetches the full-resolution file via the Drive API (needs access token) and
  // returns an object URL suitable for a high-res <img src> or download.
  // Caller is responsible for calling URL.revokeObjectURL() when done.
  async function getFileAsBlob(fileId) {
    if (Auth.isDemoMode()) {
      const dataUri = _demo.get(fileId);
      if (!dataUri) throw new Error('Demo file not found');
      const res = await fetch(dataUri);
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    }
    const token = Auth.getAccessToken();
    if (!token) throw Object.assign(new Error('Not authenticated'), { status: 401 });
    const r = await fetch(`${BASE}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (r.status === 401) { window.dispatchEvent(new CustomEvent('mc:session-expired')); throw new Error('Unauthorized'); }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    return URL.createObjectURL(blob);
  }

  /* ── Demo-mode shims ──────────────────────── */

  function _dw(real, fake) {
    return (...args) => Auth.isDemoMode() ? fake(...args) : real(...args);
  }

  const _demoFolders = { rootId: 'demo/root', circlesFolderId: 'demo/circles', collectionsFolderId: 'demo/collections', contactsFolderId: 'demo/contacts' };

  const _demoUpload = async (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => { const k = `demo/media/${Date.now()}-${file.name}`; _demo.set(k, e.target.result); res({ id: k, name: file.name }); };
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  const _demoComments = {};
  const _demoReactions = {};

  const _demoGetComments = async (fileId) => _demoComments[fileId] || [];
  const _demoAddComment  = async (fileId, content) => {
    const c = { id: Utils.generateId('c'), content, author: { displayName: Auth.getCurrentUser()?.name || 'Demo' }, createdTime: new Date().toISOString() };
    (_demoComments[fileId] = _demoComments[fileId] || []).push(c);
    return c;
  };

  return {
    initFolders:       _dw(initFolders,    async () => _demoFolders),
    getOrCreateFolder: _dw(getOrCreateFolder, async (n) => `demo/${n}`),
    listFiles:         _dw(listFiles,      async (folderId) => _demo.list(folderId + '/').slice(0, 20)),
    readJsonFile:      _dw(readJsonFile,   async (k) => { const v = _demo.get(k); return typeof v === 'string' ? Utils.safeParseJSON(v) : v; }),
    createJsonFile:    _dw(createJsonFile, async (n, c, f) => { const k = `${f}/${n}`; _demo.set(k, c); return { id: k, name: n }; }),
    updateJsonFile:    _dw(updateJsonFile, async (k, c) => _demo.set(k, c)),
    upsertJsonFile:    _dw(upsertJsonFile, async (n, c, f) => { const k = `${f}/${n}`; _demo.set(k, c); return k; }),
    findFile:          _dw(findFile,       async () => null),
    uploadMedia:       _dw(uploadMedia,    _demoUpload),
    deleteFile:        _dw(deleteFile,     async (k) => _demo.del(k)),
    copyFile:          _dw(copyFile,       async () => ({ id: Utils.generateId('copy') })),
    shareWithEmail:    _dw(shareWithEmail, async () => {}),
    listPermissions:   _dw(listPermissions, async () => []),
    removePermission:  _dw(removePermission, async () => {}),
    makePublic:        _dw(makePublic,     async () => {}),
    listSharedWithMe:  _dw(listSharedWithMe, async () => []),
    getQuota:          _dw(getQuota,       async () => ({ limit: '16106127360', usage: '1073741824', usageInDrive: '536870912' })),
    listLargeFiles:    _dw(listLargeFiles, async () => []),
    getComments:       _dw(getComments,    _demoGetComments),
    addComment:        _dw(addComment,     _demoAddComment),
    getThumbnailUrl,
    getMediaUrl,
    getFileAsBlob:     _dw(getFileAsBlob, getFileAsBlob),
    getContacts:       _dw(getContacts,   async () => [])
  };
})();
