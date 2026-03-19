// js/drive.js — Google Drive REST API wrapper
// All requests use the access token from Auth module.
// Paths mirror the folder layout described in the architecture spec:
//   timeline/
//     profiles/{userId}/profile.json
//     profiles/{userId}/friends.json
//     posts/{userId}/post-{timestamp}.json  (+ media files)
'use strict';

const Drive = (() => {

  const BASE_URL = 'https://www.googleapis.com/drive/v3';
  const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3';

  /* ── HTTP helpers ─────────────────────────────── */

  function _headers(extra = {}) {
    const token = Auth.getAccessToken();
    if (!token) throw Object.assign(new Error('Not authenticated'), { status: 401 });
    return Object.assign({ Authorization: `Bearer ${token}` }, extra);
  }

  async function _request(url, options = {}) {
    const res = await Utils.withRetry(async () => {
      const r = await fetch(url, options);
      if (r.status === 401) {
        throw Object.assign(new Error('Unauthorized'), { status: 401 });
      }
      if (r.status === 403) {
        const body = await r.clone().json().catch(() => ({}));
        const reason = body?.error?.errors?.[0]?.reason || '';
        if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
          throw Object.assign(new Error('Rate limit'), { status: 429 });
        }
        throw Object.assign(new Error('Forbidden'), { status: 403, body });
      }
      if (!r.ok) {
        throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
      }
      return r;
    }, 3, 1000);
    return res;
  }

  async function _json(url, options = {}) {
    const res = await _request(url, options);
    return res.json();
  }

  /* ── Demo (no Drive) ──────────────────────────── */

  // When running in demo mode all Drive calls fall back to an
  // in-memory / localStorage store so the UI is fully functional.

  const _demo = {
    store: null,

    _getStore() {
      if (!this.store) {
        const raw = localStorage.getItem('tl_demo_store');
        this.store = raw ? (Utils.safeParseJSON(raw) || {}) : {};
      }
      return this.store;
    },

    _save() {
      try {
        localStorage.setItem('tl_demo_store', JSON.stringify(this.store));
      } catch { /* quota exceeded */ }
    },

    getFile(key) {
      const s = this._getStore();
      return s[key] || null;
    },

    setFile(key, value) {
      this._getStore()[key] = value;
      this._save();
      return key;
    },

    listFiles(prefix) {
      const s = this._getStore();
      return Object.entries(s)
        .filter(([k]) => k.startsWith(prefix))
        .map(([id, content]) => ({ id, name: id.split('/').pop(), content }));
    },

    deleteFile(key) {
      delete this._getStore()[key];
      this._save();
    }
  };

  /* ── Folder Management ────────────────────────── */

  // Cache folder IDs for this session so we don't re-create them
  const _folderCache = {};

  async function getOrCreateFolder(name, parentId = null) {
    const cacheKey = `${parentId || 'root'}/${name}`;
    if (_folderCache[cacheKey]) return _folderCache[cacheKey];

    // Search for existing folder
    const q = [
      `name='${name.replace(/'/g, "\\'")}'`,
      `mimeType='application/vnd.google-apps.folder'`,
      `trashed=false`,
      parentId ? `'${parentId}' in parents` : `'root' in parents`
    ].join(' and ');

    const params = new URLSearchParams({ q, fields: 'files(id,name)', spaces: 'drive' });
    const data = await _json(`${BASE_URL}/files?${params}`, {
      headers: _headers()
    });

    if (data.files && data.files.length > 0) {
      _folderCache[cacheKey] = data.files[0].id;
      return data.files[0].id;
    }

    // Create it
    const meta = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {})
    };
    const created = await _json(`${BASE_URL}/files`, {
      method: 'POST',
      headers: _headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(meta)
    });

    _folderCache[cacheKey] = created.id;
    return created.id;
  }

  /* ── Initialise Folder Structure ──────────────── */

  // Returns { rootId, profilesFolderId, postsFolderId, userProfileFolderId, userPostsFolderId }
  async function initFolders(userId) {
    const rootId      = await getOrCreateFolder('timeline');
    const profilesId  = await getOrCreateFolder('profiles', rootId);
    const postsId     = await getOrCreateFolder('posts',    rootId);
    const userProfId  = await getOrCreateFolder(userId,     profilesId);
    const userPostId  = await getOrCreateFolder(userId,     postsId);
    return { rootId, profilesId, postsId, userProfileFolderId: userProfId, userPostsFolderId: userPostId };
  }

  /* ── Files: list ──────────────────────────────── */

  async function listFiles(folderId, extraQuery = '') {
    let q = `'${folderId}' in parents and trashed=false`;
    if (extraQuery) q += ` and ${extraQuery}`;

    const params = new URLSearchParams({
      q,
      fields: 'files(id,name,createdTime,modifiedTime,mimeType,size)',
      orderBy: 'createdTime desc',
      spaces: 'drive',
      pageSize: '100'
    });

    const data = await _json(`${BASE_URL}/files?${params}`, {
      headers: _headers()
    });

    return data.files || [];
  }

  /* ── Files: read JSON ─────────────────────────── */

  async function readJsonFile(fileId) {
    const res = await _request(`${BASE_URL}/files/${fileId}?alt=media`, {
      headers: _headers()
    });
    return res.json();
  }

  /* ── Files: create JSON ───────────────────────── */

  async function createJsonFile(name, content, folderId) {
    const meta = { name, mimeType: 'application/json', parents: [folderId] };
    const body = new FormData();
    body.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    body.append('file',     new Blob([JSON.stringify(content)], { type: 'application/json' }));

    const data = await _json(`${UPLOAD_URL}/files?uploadType=multipart&fields=id,name`, {
      method: 'POST',
      headers: _headers(),
      body
    });

    return data;   // { id, name }
  }

  /* ── Files: update JSON ───────────────────────── */

  async function updateJsonFile(fileId, content) {
    await _request(`${UPLOAD_URL}/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: _headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(content)
    });
  }

  /* ── Files: find by name in folder ───────────── */

  async function findFile(name, folderId) {
    const q = `name='${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`;
    const params = new URLSearchParams({ q, fields: 'files(id,name)', spaces: 'drive' });
    const data = await _json(`${BASE_URL}/files?${params}`, { headers: _headers() });
    return (data.files && data.files[0]) || null;
  }

  /* ── Files: upsert JSON (create or update) ────── */

  async function upsertJsonFile(name, content, folderId) {
    const existing = await findFile(name, folderId);
    if (existing) {
      await updateJsonFile(existing.id, content);
      return existing.id;
    }
    const created = await createJsonFile(name, content, folderId);
    return created.id;
  }

  /* ── Files: upload binary media ───────────────── */

  async function uploadMedia(file, folderId) {
    // Use resumable upload for larger files
    const meta = {
      name: `media-${Date.now()}-${file.name}`,
      mimeType: file.type,
      parents: [folderId]
    };

    // Initiate resumable session
    const initRes = await _request(
      `${UPLOAD_URL}/files?uploadType=resumable&fields=id,name`,
      {
        method: 'POST',
        headers: _headers({ 'Content-Type': 'application/json', 'X-Upload-Content-Type': file.type }),
        body: JSON.stringify(meta)
      }
    );

    const uploadUrl = initRes.headers.get('Location');
    if (!uploadUrl) throw new Error('Failed to get resumable upload URL');

    // Upload the bytes
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file
    });

    if (!uploadRes.ok) throw Object.assign(new Error(`Upload failed HTTP ${uploadRes.status}`), { status: uploadRes.status });
    return uploadRes.json(); // { id, name }
  }

  /* ── Files: delete ────────────────────────────── */

  async function deleteFile(fileId) {
    await _request(`${BASE_URL}/files/${fileId}`, {
      method: 'DELETE',
      headers: _headers()
    });
  }

  /* ── Sharing ──────────────────────────────────── */

  async function shareFileWithEmail(fileId, email) {
    const body = { role: 'reader', type: 'user', emailAddress: email };
    await _json(`${BASE_URL}/files/${fileId}/permissions?sendNotificationEmail=false`, {
      method: 'POST',
      headers: _headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    });
  }

  async function shareFilesWithFriends(fileIds, friendEmails) {
    // Best-effort: continue even if some shares fail
    const tasks = [];
    for (const fileId of fileIds) {
      for (const email of friendEmails) {
        tasks.push(shareFileWithEmail(fileId, email).catch(err => {
          console.warn(`Share ${fileId} -> ${email} failed:`, err);
        }));
      }
    }
    await Promise.all(tasks);
  }

  /* ── Demo-mode shim: wraps Drive ops ─────────── */

  function _demoWrap(realFn, demoFn) {
    return (...args) => {
      if (Auth.isDemoMode()) return demoFn(...args);
      return realFn(...args);
    };
  }

  /* ── Demo implementations ─────────────────────── */

  const _demoFolders = {
    userProfileFolderId: 'demo/profiles/demo-user',
    userPostsFolderId: 'demo/posts/demo-user'
  };

  const _demoInitFolders = async () => _demoFolders;

  const _demoReadJson = async (key) => {
    const v = _demo.getFile(key);
    return v ? (typeof v === 'string' ? Utils.safeParseJSON(v) : v) : null;
  };

  const _demoUpsertJson = async (name, content, folderId) => {
    const key = `${folderId}/${name}`;
    _demo.setFile(key, content);
    return key;
  };

  const _demoListFiles = async (folderId) => {
    return _demo.listFiles(folderId + '/').map(f => ({
      id: f.id,
      name: f.name,
      createdTime: new Date().toISOString()
    }));
  };

  const _demoDelete = async (key) => _demo.deleteFile(key);

  const _demoUpload = async (file) => {
    // Convert to data URL for demo rendering
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const key = `demo/media/${Date.now()}-${file.name}`;
        _demo.setFile(key, e.target.result);
        resolve({ id: key, name: file.name, dataUrl: e.target.result });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const _demoGetMediaUrl = async (fileId) => {
    return _demo.getFile(fileId);
  };

  /* ── Public API ───────────────────────────────── */

  async function getMediaUrl(fileId) {
    if (Auth.isDemoMode()) return _demoGetMediaUrl(fileId);
    return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(fileId)}`;
  }

  return {
    initFolders:       _demoWrap(initFolders,   _demoInitFolders),
    listFiles:         _demoWrap(listFiles,      _demoListFiles),
    readJsonFile:      _demoWrap(readJsonFile,   _demoReadJson),
    createJsonFile:    _demoWrap(
      (name, content, folderId) => createJsonFile(name, content, folderId),
      (name, content, folderId) => _demoUpsertJson(name, content, folderId)
    ),
    updateJsonFile:    _demoWrap(updateJsonFile, (fileId, content) => { _demo.setFile(fileId, content); }),
    upsertJsonFile:    _demoWrap(upsertJsonFile, _demoUpsertJson),
    uploadMedia:       _demoWrap(uploadMedia,    _demoUpload),
    deleteFile:        _demoWrap(deleteFile,     _demoDelete),
    shareFilesWithFriends,
    getMediaUrl,
    findFile:          _demoWrap(findFile,       async () => null),
    getOrCreateFolder: _demoWrap(getOrCreateFolder, async (name) => `demo/${name}`)
  };
})();
