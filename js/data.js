// js/data.js — App-level data layer for My Circle
// All persistent data lives in the user's Google Drive under mycircle/
'use strict';

const Data = (() => {

  let _folders = null; // { rootId, circlesFolderId, collectionsFolderId, contactsFolderId }

  /* ── Simple cache with TTL ──────────────────── */

  const _cache = {};
  const _inflight = {};
  const CACHE_TTL = 30_000; // 30 seconds

  function _cacheGet(key) {
    const entry = _cache[key];
    if (!entry) return undefined;
    if (Date.now() - entry.ts > CACHE_TTL) { delete _cache[key]; return undefined; }
    return entry.val;
  }

  function _cacheSet(key, val) {
    _cache[key] = { val, ts: Date.now() };
  }

  function _cacheDel(key) { delete _cache[key]; }

  // Dedup concurrent calls to the same async function
  function _dedup(key, fn) {
    if (_inflight[key]) return _inflight[key];
    const p = fn().finally(() => { delete _inflight[key]; });
    _inflight[key] = p;
    return p;
  }

  /* ── Write lock (serializes friends/notifs writes) ── */

  let _writeLockP = Promise.resolve();

  function _withWriteLock(fn) {
    const next = _writeLockP.then(fn, fn);
    _writeLockP = next.catch(() => {});
    return next;
  }

  // Timestamp of the last completed acceptance-sync so we don't hammer Drive.
  let _lastSyncAt = 0;
  let _syncInFlight = null; // dedup concurrent sync calls

  /* ── Init ──────────────────────────────────── */

  async function init() {
    _folders = await Drive.initFolders();
    return _folders;
  }

  function getFolders() { return _folders; }

  /* ── Profile ───────────────────────────────── */

  async function getProfile() {
    try {
      const f = await Drive.findFile('profile.json', _folders.rootId);
      if (!f) return _defaultProfile();
      return await Drive.readJsonFile(f.id);
    } catch {
      return _defaultProfile();
    }
  }

  function _defaultProfile() {
    const u = Auth.getCurrentUser();
    return { displayName: u?.name || '', handle: '', bio: '', avatarFileId: null, updatedAt: null };
  }

  async function saveProfile(data) {
    return Drive.upsertJsonFile('profile.json', { ...data, updatedAt: new Date().toISOString() }, _folders.rootId);
  }

  async function uploadAvatar(file) {
    const result = await Drive.uploadMedia(file, _folders.rootId);
    return result.id;
  }

  async function makeProfilePublic() {
    await Drive.makePublic(_folders.collectionsFolderId).catch(() => {});
    return `https://drive.google.com/drive/folders/${_folders.collectionsFolderId}`;
  }

  /* ── Settings ──────────────────────────────── */

  async function getSettings() {
    const cached = _cacheGet('settings');
    if (cached) return cached;
    return _dedup('settings', async () => {
      try {
        const f = await Drive.findFile('settings.json', _folders.rootId);
        if (!f) return _defaultSettings();
        const s = await Drive.readJsonFile(f.id);
        _cacheSet('settings', s);
        return s;
      } catch {
        return _defaultSettings();
      }
    });
  }

  function _defaultSettings() {
    return { theme: 'soft', colorTheme: 'slate', defaultSharing: 'friends', allowCopying: 'friends' };
  }

  const _VALID_THEMES   = new Set(['minimal', 'brutalist', 'soft', 'editorial', 'glass']);
  const _VALID_COLORS   = new Set([
    'paper', 'midnight', 'forest', 'coral', 'slate',
    'ocean', 'lavender', 'ember', 'sand', 'rose',
    'arctic', 'bronze', 'plum', 'neon', 'sage',
    'charcoal', 'honey', 'dusk', 'mint', 'wine'
  ]);
  const _VALID_SHARING  = new Set(['everyone', 'friends', 'circles', 'select']);

  async function saveSettings(data) {
    // Whitelist known fields to prevent injection of arbitrary keys
    const safe = {
      theme:          _VALID_THEMES.has(data.theme) ? data.theme : 'soft',
      colorTheme:     _VALID_COLORS.has(data.colorTheme) ? data.colorTheme : 'slate',
      defaultSharing: _VALID_SHARING.has(data.defaultSharing) ? data.defaultSharing : 'friends',
      allowCopying:   data.allowCopying || 'friends'
    };
    _cacheDel('settings');
    return Drive.upsertJsonFile('settings.json', safe, _folders.rootId);
  }

  /* ── Friends ───────────────────────────────── */

  async function _getFriendsFile() {
    const cached = _cacheGet('friends');
    if (cached) return JSON.parse(JSON.stringify(cached)); // deep clone so callers can mutate
    return _dedup('friendsFile', async () => {
      try {
        const f = await Drive.findFile('friends.json', _folders.contactsFolderId);
        if (!f) return { friends: [] };
        const data = await Drive.readJsonFile(f.id);
        _cacheSet('friends', data);
        return JSON.parse(JSON.stringify(data));
      } catch {
        return { friends: [] };
      }
    });
  }

  async function _saveFriendsFile(data) {
    await Drive.upsertJsonFile('friends.json', data, _folders.contactsFolderId);
    _cacheSet('friends', data);
  }

  async function getFriends() {
    // Fire sync in the background — don't block on it so the UI feels instant.
    // syncFriendAcceptances is internally throttled to at most once per 60s.
    syncFriendAcceptances().catch(() => {});
    return (await _getFriendsFile()).friends || [];
  }

  async function addFriend(email, displayName = '') {
    return _withWriteLock(async () => {
      const data = await _getFriendsFile();
      if (data.friends.find(f => f.email === email)) return;
      data.friends.push({ email, displayName, addedAt: new Date().toISOString(), status: 'accepted' });
      await _saveFriendsFile(data);
    });
  }

  async function removeFriend(email) {
    return _withWriteLock(async () => {
      const data = await _getFriendsFile();
      data.friends = data.friends.filter(f => f.email !== email);
      await _saveFriendsFile(data);

      // Notify the removed person so they can remove us from their list too.
      // Fire-and-forget; failure is non-fatal.
      const user = Auth.getCurrentUser();
      const key  = `mc-fremov-${email.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
      Drive.upsertJsonFile(key, {
        type:      'mc_friend_removed',
        fromEmail: user.email,
        toEmail:   email,
        removedAt: new Date().toISOString()
      }, _folders.rootId)
        .then(fid => Drive.shareWithEmail(fid, email, 'reader').catch(() => {}))
        .catch(() => {});
    });
  }

  /* ── Blocked ───────────────────────────────── */

  async function _getBlockedFile() {
    const cached = _cacheGet('blocked');
    if (cached) return JSON.parse(JSON.stringify(cached));
    return _dedup('blockedFile', async () => {
      try {
        const f = await Drive.findFile('blocked.json', _folders.contactsFolderId);
        if (!f) return { blocked: [] };
        const data = await Drive.readJsonFile(f.id);
        _cacheSet('blocked', data);
        return JSON.parse(JSON.stringify(data));
      } catch {
        return { blocked: [] };
      }
    });
  }

  async function getBlocked() {
    return (await _getBlockedFile()).blocked || [];
  }

  async function blockUser(email) {
    return _withWriteLock(async () => {
      const data = await _getBlockedFile();
      if (data.blocked.find(b => b.email === email)) return;
      data.blocked.push({ email, blockedAt: new Date().toISOString() });
      _cacheDel('blocked');
      await Drive.upsertJsonFile('blocked.json', data, _folders.contactsFolderId);
    });
  }

  async function unblockUser(email) {
    return _withWriteLock(async () => {
      const data = await _getBlockedFile();
      data.blocked = data.blocked.filter(b => b.email !== email);
      _cacheDel('blocked');
      await Drive.upsertJsonFile('blocked.json', data, _folders.contactsFolderId);
    });
  }

  /* ── Circles ───────────────────────────────── */

  // A circle = a subfolder under mycircle/circles/{id}/
  // with _meta.json inside it.

  async function listCircles() {
    // 1. User's own circles (in their mycircle/circles/ folder)
    const ownFolders = await Drive.listFiles(_folders.circlesFolderId, `mimeType='application/vnd.google-apps.folder'`);

    // 2. Circles shared with this user by others (they were added as a member)
    let sharedFolders = [];
    try { sharedFolders = await Drive.listSharedWithMe(); } catch {}

    // Combine and deduplicate
    const seen = new Set();
    const allFolders = [];
    for (const f of [...ownFolders, ...sharedFolders]) {
      if (!seen.has(f.id)) { seen.add(f.id); allFolders.push(f); }
    }

    const metas = await Promise.all(allFolders.map(async f => {
      try {
        const metaFile = await Drive.findFile('_meta.json', f.id);
        if (!metaFile) return null;
        const meta = await Drive.readJsonFile(metaFile.id);
        // Circles have ownerId + members[]; collections have sharing + allowCopying
        if (!meta.ownerId || !Array.isArray(meta.members)) return null;
        return { ...meta, folderId: f.id };
      } catch { return null; }
    }));
    return metas.filter(Boolean);
  }

  async function createCircle(name, description = '', addPolicy = 'owner_only', coverFile = null) {
    const id = Utils.generateId('circle');
    const folderId = await Drive.getOrCreateFolder(id, _folders.circlesFolderId);
    const user = Auth.getCurrentUser();
    let coverFileId = null;
    if (coverFile) {
      try {
        const uploaded = await Drive.uploadMedia(coverFile, folderId);
        coverFileId = uploaded.id;
      } catch { /* cover upload failure is non-fatal */ }
    }
    const meta = {
      id,
      name,
      description,
      addPolicy,  // 'owner_only' | 'any_member'
      ownerId: user.userId,
      ownerEmail: user.email,
      members: [{ email: user.email, displayName: user.name, role: 'owner', addedAt: new Date().toISOString() }],
      coverFileId,
      createdAt: new Date().toISOString()
    };
    await Drive.createJsonFile('_meta.json', meta, folderId);
    return { ...meta, folderId };
  }

  async function uploadCircleCover(folderId, file) {
    const uploaded = await Drive.uploadMedia(file, folderId);
    await updateCircleMeta(folderId, { coverFileId: uploaded.id });
    return uploaded.id;
  }

  async function getCircle(folderId) {
    const f = await Drive.findFile('_meta.json', folderId);
    if (!f) throw new Error('Circle not found');
    const meta = await Drive.readJsonFile(f.id);
    return { ...meta, folderId };
  }

  function _assertCircleOwner(meta) {
    const user = Auth.getCurrentUser();
    if (!user || meta.ownerEmail !== user.email) throw new Error('Not the circle owner');
  }

  async function updateCircleMeta(folderId, patch) {
    const f = await Drive.findFile('_meta.json', folderId);
    if (!f) throw new Error('Circle not found');
    const meta = await Drive.readJsonFile(f.id);
    _assertCircleOwner(meta);
    const updated = { ...meta, ...patch };
    await Drive.updateJsonFile(f.id, updated);
    return updated;
  }

  async function deleteCircle(folderId) {
    const f = await Drive.findFile('_meta.json', folderId);
    if (f) {
      const meta = await Drive.readJsonFile(f.id);
      _assertCircleOwner(meta);
    }
    await Drive.deleteFile(folderId);
  }

  async function addMemberToCircle(folderId, email, displayName = '') {
    const f = await Drive.findFile('_meta.json', folderId);
    if (!f) throw new Error('Circle not found');
    const meta = await Drive.readJsonFile(f.id);
    const user = Auth.getCurrentUser();
    // Only owner or any_member policy can add
    if (meta.addPolicy !== 'any_member') _assertCircleOwner(meta);
    if (meta.members.find(m => m.email === email)) return meta;
    meta.members.push({ email, displayName, role: 'member', addedAt: new Date().toISOString() });
    await Drive.updateJsonFile(f.id, meta);
    // Share the folder with the new member (editor so they can upload)
    await Drive.shareWithEmail(folderId, email, 'writer').catch(() => {});
    return meta;
  }

  async function removeMemberFromCircle(folderId, email) {
    const f = await Drive.findFile('_meta.json', folderId);
    if (!f) throw new Error('Circle not found');
    const meta = await Drive.readJsonFile(f.id);
    _assertCircleOwner(meta);
    meta.members = meta.members.filter(m => m.email !== email);
    await Drive.updateJsonFile(f.id, meta);
    // Revoke Drive permission
    const perms = await Drive.listPermissions(folderId);
    const perm = perms.find(p => p.emailAddress === email);
    if (perm) await Drive.removePermission(folderId, perm.id).catch(() => {});
    return meta;
  }

  /* ── Collections ───────────────────────────── */

  // A collection = subfolder under mycircle/collections/{id}/
  // with _meta.json and reactions.json inside.

  async function listCollections() {
    const cached = _cacheGet('collections');
    if (cached) return cached;
    return _dedup('collections', async () => {
      const folders = await Drive.listFiles(_folders.collectionsFolderId, `mimeType='application/vnd.google-apps.folder'`);
      const metas = await Promise.all(folders.map(async f => {
        try {
          const metaFile = await Drive.findFile('_meta.json', f.id);
          if (!metaFile) return null;
          const meta = await Drive.readJsonFile(metaFile.id);
          return { ...meta, folderId: f.id };
        } catch { return null; }
      }));
      const result = metas.filter(Boolean);
      _cacheSet('collections', result);
      return result;
    });
  }

  async function createCollection(name, description = '', sharing = 'friends', allowCopying = true, circleIds = []) {
    sharing = _VALID_SHARING.has(sharing) ? sharing : 'friends';
    const id = Utils.generateId('coll');
    const folderId = await Drive.getOrCreateFolder(id, _folders.collectionsFolderId);
    const meta = {
      id, name, description,
      sharing,     // 'everyone' | 'friends' | 'circles' | 'select'
      sharedWith: [],
      allowCopying,
      createdAt: new Date().toISOString()
    };
    await Drive.createJsonFile('_meta.json', meta, folderId);
    await Drive.createJsonFile('reactions.json', { likes: [] }, folderId);
    await _shareByAudience(folderId, sharing, circleIds);
    _cacheDel('collections');
    return { ...meta, folderId };
  }

  async function getCollection(folderId) {
    const f = await Drive.findFile('_meta.json', folderId);
    if (!f) throw new Error('Collection not found');
    const meta = await Drive.readJsonFile(f.id);
    return { ...meta, folderId };
  }

  async function updateCollectionMeta(folderId, patch) {
    const f = await Drive.findFile('_meta.json', folderId);
    if (!f) throw new Error('Collection not found');
    const meta = await Drive.readJsonFile(f.id);
    const updated = { ...meta, ...patch };
    await Drive.updateJsonFile(f.id, updated);
    return updated;
  }

  async function deleteCollection(folderId) {
    await Drive.deleteFile(folderId);
    _cacheDel('collections');
  }

  async function shareCollection(folderId, emails) {
    await Promise.all(emails.map(e => Drive.shareWithEmail(folderId, e, 'commenter').catch(() => {})));
  }

  async function inviteCollaborator(collectionFolderId, email) {
    await Drive.shareWithEmail(collectionFolderId, email, 'writer');
  }

  /* ── Reactions ─────────────────────────────── */

  const _REACTION_DEFAULTS = { likes: [], laughs: [], claps: [], wows: [], sads: [], seenBy: [] };

  function _ensureReactionArrays(obj) {
    for (const k of Object.keys(_REACTION_DEFAULTS)) {
      if (!Array.isArray(obj[k])) obj[k] = [];
    }
    return obj;
  }

  // Reactions are stored in the user's own Drive root to avoid permission errors
  // on folders shared by friends (reader access can't write files).
  // File name: react-{sanitised folderId}.json
  function _reactKey(collectionFolderId) {
    return `react-${collectionFolderId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
  }

  async function getReactions(collectionFolderId) {
    try {
      const key = _reactKey(collectionFolderId);
      const f = await Drive.findFile(key, _folders.rootId);
      if (!f) return { ..._REACTION_DEFAULTS };
      return _ensureReactionArrays(await Drive.readJsonFile(f.id));
    } catch {
      return { ..._REACTION_DEFAULTS };
    }
  }

  async function toggleReaction(collectionFolderId, type) {
    // type: 'like' | 'laugh' | 'clap' | 'wow' | 'sad'
    const user = Auth.getCurrentUser();
    const key  = _reactKey(collectionFolderId);
    const f    = await Drive.findFile(key, _folders.rootId);
    let reactions = f ? _ensureReactionArrays(await Drive.readJsonFile(f.id)) : { ..._REACTION_DEFAULTS };

    const arrayKey = { like: 'likes', laugh: 'laughs', clap: 'claps', wow: 'wows', sad: 'sads' }[type] || 'likes';
    const arr = reactions[arrayKey];
    const idx = arr.findIndex(l => l.userId === user.userId);
    const reacted = idx < 0;
    if (reacted) {
      arr.push({ userId: user.userId, email: user.email, at: new Date().toISOString() });
    } else {
      arr.splice(idx, 1);
    }

    await Drive.upsertJsonFile(key, reactions, _folders.rootId);
    return { reacted, count: arr.length, type };
  }

  async function toggleLike(collectionFolderId) {
    // Backward compat alias
    const result = await toggleReaction(collectionFolderId, 'like');
    return { liked: result.reacted, count: result.count };
  }

  /* ── Seen By ───────────────────────────────── */

  async function markSeen(collectionFolderId) {
    const user = Auth.getCurrentUser();
    if (!user) return;
    const key  = _reactKey(collectionFolderId);
    const f    = await Drive.findFile(key, _folders.rootId);
    let reactions = f ? _ensureReactionArrays(await Drive.readJsonFile(f.id)) : { ..._REACTION_DEFAULTS };
    if (!reactions.seenBy.some(s => s.userId === user.userId)) {
      reactions.seenBy.push({ userId: user.userId, email: user.email, at: new Date().toISOString() });
      await Drive.upsertJsonFile(key, reactions, _folders.rootId);
    }
  }

  async function getSeenBy(collectionFolderId) {
    const r = await getReactions(collectionFolderId);
    return r.seenBy || [];
  }

  /* ── Sharing helper ──────────────────────── */

  async function _shareByAudience(folderId, sharing, circleIds = []) {
    if (sharing === 'everyone') {
      await Drive.makePublic(folderId).catch(() => {});
    } else if (sharing === 'friends') {
      const friends = await getFriends();
      await Promise.all(friends.map(f =>
        Drive.shareWithEmail(folderId, f.email, 'commenter').catch(() => {})
      ));
    } else if (sharing === 'circles' && circleIds.length) {
      const circles = await Promise.all(
        circleIds.map(fid => getCircle(fid).catch(() => null))
      );
      const emails = new Set();
      circles.filter(Boolean).forEach(c => {
        c.members.filter(m => m.role !== 'owner').forEach(m => emails.add(m.email));
      });
      await Promise.all([...emails].map(email =>
        Drive.shareWithEmail(folderId, email, 'commenter').catch(() => {})
      ));
    }
  }

  /* ── Posts ─────────────────────────────────── */

  // A post is a collection with isPost:true plus an optional caption.
  // It lives in mycircle/collections/ like any other collection.

  // opts: { caption, name, sharing, circleIds }
  //   sharing: 'friends' | 'circles' | 'everyone'
  //   circleIds: array of circle folderIds (used when sharing === 'circles')
  async function createPost(opts = {}) {
    const caption   = opts.caption   || '';
    const name      = opts.name      || `Post ${new Date().toLocaleDateString()}`;
    const sharing   = _VALID_SHARING.has(opts.sharing) ? opts.sharing : 'friends';
    const circleIds = opts.circleIds || [];

    const id = Utils.generateId('post');
    const folderId = await Drive.getOrCreateFolder(id, _folders.collectionsFolderId);
    const meta = {
      id, name, caption,
      isPost: true, sharing,
      sharedWith: [], allowCopying: false,
      createdAt: new Date().toISOString()
    };
    if (opts.voidscroll)                    meta.voidscroll    = opts.voidscroll;
    if (opts.sourceAlbumId)                 meta.sourceAlbumId = opts.sourceAlbumId;
    if (sharing === 'circles' && circleIds.length) meta.circleIds = circleIds;
    await Drive.createJsonFile('_meta.json', meta, folderId);
    await _shareByAudience(folderId, sharing, circleIds);
    _cacheDel('collections');
    return { ...meta, folderId };
  }

  async function listOwnPosts() {
    const colls = await listCollections();
    return colls.filter(c => c.isPost && !c.isStory);
  }

  /* ── Stories ───────────────────────────────── */

  // opts: { caption, sharing, circleIds }
  async function createStory(opts = {}) {
    const caption   = (opts.caption || '').slice(0, 200); // enforce max length in data layer
    const sharing   = _VALID_SHARING.has(opts.sharing) ? opts.sharing : 'friends';
    const circleIds = opts.circleIds || [];
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const id = Utils.generateId('story');
    const folderId = await Drive.getOrCreateFolder(id, _folders.collectionsFolderId);
    const meta = {
      id, caption,
      name: `Story ${new Date().toLocaleTimeString()}`,
      isPost: true, isStory: true,
      sharing, sharedWith: [], allowCopying: false,
      expiresAt,
      createdAt: new Date().toISOString()
    };
    await Drive.createJsonFile('_meta.json', meta, folderId);
    await _shareByAudience(folderId, sharing, circleIds);
    _cacheDel('collections');
    return { ...meta, folderId };
  }

  async function listOwnStories() {
    const colls = await listCollections();
    const now = new Date();
    return colls.filter(c => c.isStory && new Date(c.expiresAt) > now);
  }

  /* ── Feed ──────────────────────────────────── */

  // Returns folders shared with the current user (friends' collections/circles)
  async function getFeedFolders() {
    return Drive.listSharedWithMe();
  }

  /* ── Hidden files ──────────────────────────── */

  async function getHiddenIds() {
    const cached = _cacheGet('hiddenIds');
    if (cached) return [...cached];
    try {
      const f = await Drive.findFile('hidden.json', _folders.rootId);
      if (!f) return [];
      const data = await Drive.readJsonFile(f.id);
      const ids = data.ids || [];
      _cacheSet('hiddenIds', ids);
      return [...ids];
    } catch { return []; }
  }

  async function hideFile(fileId) {
    return _withWriteLock(async () => {
      const ids = await getHiddenIds();
      if (!ids.includes(fileId)) {
        ids.push(fileId);
        _cacheSet('hiddenIds', ids);
        await Drive.upsertJsonFile('hidden.json', { ids }, _folders.rootId);
      }
    });
  }

  async function unhideFile(fileId) {
    return _withWriteLock(async () => {
      const ids = await getHiddenIds();
      const filtered = ids.filter(id => id !== fileId);
      _cacheSet('hiddenIds', filtered);
      await Drive.upsertJsonFile('hidden.json', { ids: filtered }, _folders.rootId);
    });
  }

  /* ── Circle Posts ──────────────────────────── */

  // Each post is a subfolder inside the circle folder, containing _post.json + media/doc files.
  // This avoids write conflicts — each user creates their own subfolder.

  async function createCirclePost(circleFolderId, { caption = '', members = [], voidscroll = null, sourceAlbumId = null }) {
    const id = Utils.generateId('cpost');
    const postFolderId = await Drive.getOrCreateFolder(id, circleFolderId);
    const user = Auth.getCurrentUser();
    const meta = {
      id, caption,
      authorEmail:   user.email,
      authorName:    user.name || user.email,
      authorPicture: user.picture || null,
      createdAt:     new Date().toISOString()
    };
    if (voidscroll)     meta.voidscroll    = voidscroll;
    if (sourceAlbumId)  meta.sourceAlbumId = sourceAlbumId;
    await Drive.createJsonFile('_post.json', meta, postFolderId);

    // Notify other circle members about the new post
    const others = (members || []).filter(m => m.email !== user.email);
    if (others.length > 0) {
      try {
        const notifPayload = {
          type:          'mc_circle_post',
          postId:        id,
          circleFolderId,
          fromEmail:     user.email,
          fromName:      user.name || user.email,
          caption,
          createdAt:     meta.createdAt
        };
        const notifFileId = await Drive.upsertJsonFile(`mc-circpost-${id}.json`, notifPayload, _folders.rootId);
        await Promise.all(others.map(m => Drive.shareWithEmail(notifFileId, m.email, 'reader').catch(() => {})));
      } catch {}
    }

    return { ...meta, postFolderId };
  }

  async function listCirclePosts(circleFolderId) {
    const subfolders = await Drive.listFiles(circleFolderId, `mimeType='application/vnd.google-apps.folder'`);
    const posts = await Promise.all(subfolders.map(async sf => {
      try {
        const postFile = await Drive.findFile('_post.json', sf.id);
        if (!postFile) return null; // not a post subfolder (e.g. old structure)
        const meta  = await Drive.readJsonFile(postFile.id);
        let files = await Drive.listFiles(sf.id);
        // If this post references a source album, pull media from there
        const isMedia = f => f.mimeType?.startsWith('image/') || f.mimeType?.startsWith('video/');
        if (meta.sourceAlbumId && !files.some(isMedia)) {
          try {
            const srcFiles = await Drive.listFiles(meta.sourceAlbumId);
            files = [...files, ...srcFiles.filter(isMedia)];
          } catch {}
        }
        return { ...meta, postFolderId: sf.id, files };
      } catch { return null; }
    }));
    return posts
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async function deleteCirclePost(postFolderId) {
    await Drive.deleteFile(postFolderId);
  }

  /* ── Circle Mute ───────────────────────────── */

  async function getMutedCircles() {
    const s = await getSettings();
    return s.mutedCircleIds || [];
  }

  async function muteCircle(folderId) {
    const s = await getSettings();
    const ids = s.mutedCircleIds || [];
    if (!ids.includes(folderId)) await saveSettings({ ...s, mutedCircleIds: [...ids, folderId] });
  }

  async function unmuteCircle(folderId) {
    const s = await getSettings();
    const ids = (s.mutedCircleIds || []).filter(id => id !== folderId);
    await saveSettings({ ...s, mutedCircleIds: ids });
  }

  /* ── Friend Requests ───────────────────────── */

  // Request files are stored in the sender's mycircle/ root and shared with the recipient.
  // File name: mc-freq-{sanitised_target_email}.json
  // This lets recipients find them via sharedWithMe queries.

  function _freqKey(targetEmail) {
    return `mc-freq-${targetEmail.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
  }

  async function sendFriendRequest(email) {
    return _withWriteLock(async () => {
      const data = await _getFriendsFile();
      if (data.friends.find(f => f.email === email)) return; // already in list

      // Auto-make profile public on first friend request so others can see your posts
      if (!data.friends.length) {
        await makeProfilePublic().catch(() => {});
        try { localStorage.setItem('mc_profile_public', '1'); } catch {}
      }

      const user = Auth.getCurrentUser();
      const reqPayload = {
        type:        'mc_friend_request',
        fromEmail:   user.email,
        fromName:    user.name  || user.email,
        fromPicture: user.picture || null,
        toEmail:     email,
        sentAt:      new Date().toISOString()
      };
      const key    = _freqKey(email);
      const fileId = await Drive.upsertJsonFile(key, reqPayload, _folders.rootId);
      await Drive.shareWithEmail(fileId, email, 'reader');
      data.friends.push({ email, displayName: email, picture: null, addedAt: new Date().toISOString(), status: 'pending_sent' });
      await _saveFriendsFile(data);
    });
  }

  async function getIncomingFriendRequests() {
    // Short cache so rapid re-opens of the notification panel feel instant
    const cached = _cacheGet('incomingReqs');
    if (cached) return cached;
    try {
      const files   = await Drive.listSharedFilesWithName('mc-freq-');
      const me      = Auth.getCurrentUser();
      const handled = await _getHandledNotifIds();
      const reqs = await Promise.all(files.map(async f => {
        try {
          if (handled.includes(f.id)) return null;
          const d = await Drive.readJsonFile(f.id);
          if (d.type !== 'mc_friend_request') return null;
          if (d.toEmail !== me.email) return null;
          return { ...d, fileId: f.id };
        } catch { return null; }
      }));
      const result = reqs.filter(Boolean);
      _cacheSet('incomingReqs', result);
      return result;
    } catch { return []; }
  }

  async function getIncomingCircleNotifications() {
    try {
      const files   = await Drive.listSharedFilesWithName('mc-circpost-');
      const handled = await _getHandledNotifIds();
      const notifs = await Promise.all(files.map(async f => {
        try {
          if (handled.includes(f.id)) return null;
          const d = await Drive.readJsonFile(f.id);
          if (d.type !== 'mc_circle_post') return null;
          return { ...d, fileId: f.id };
        } catch { return null; }
      }));
      return notifs.filter(Boolean);
    } catch { return []; }
  }

  async function getNotifications() {
    const [friendReqs, circleNotifs] = await Promise.all([
      getIncomingFriendRequests(),
      getIncomingCircleNotifications()
    ]);
    return { friendReqs, circleNotifs, total: friendReqs.length + circleNotifs.length };
  }

  // General-purpose "handled notifications" list — covers friend requests, acceptances, circle posts.
  async function _getHandledNotifIds() {
    const cached = _cacheGet('handledNotifs');
    if (cached) return [...cached];
    return _dedup('handledNotifs', async () => {
      try {
        const f = await Drive.findFile('handled-notifs.json', _folders.rootId);
        if (!f) return [];
        const d = await Drive.readJsonFile(f.id);
        const ids = d.ids || [];
        _cacheSet('handledNotifs', ids);
        return [...ids];
      } catch { return []; }
    });
  }

  async function _markNotifHandled(fileId) {
    return _withWriteLock(async () => {
      const ids = await _getHandledNotifIds();
      if (ids.includes(fileId)) return;
      ids.push(fileId);
      _cacheSet('handledNotifs', ids);
      await Drive.upsertJsonFile('handled-notifs.json', { ids }, _folders.rootId);
    });
  }

  // Share all existing 'friends' posts/stories with a newly accepted friend.
  // Called outside the write lock so it doesn't block other writes.
  async function _shareExistingPostsWithFriend(email) {
    try {
      const colls = await listCollections();
      const now   = new Date();
      await Promise.all(
        colls
          .filter(c => c.isPost && c.sharing === 'friends' &&
                       (!c.isStory || new Date(c.expiresAt) > now))
          .map(c => Drive.shareWithEmail(c.folderId, email, 'commenter').catch(() => {}))
      );
    } catch {}
  }

  async function acceptFriendRequest(fromEmail, fromName, fromPicture, requestFileId) {
    await _withWriteLock(async () => {
      // Ensure profile is public so the requester can see our posts
      await makeProfilePublic().catch(() => {});
      try { localStorage.setItem('mc_profile_public', '1'); } catch {}

      const data = await _getFriendsFile();
      // Deduplicate: remove any extra entries for this email, keep only the first
      const dupes = data.friends.filter(f => f.email === fromEmail);
      if (dupes.length > 1) {
        data.friends = data.friends.filter(f => f.email !== fromEmail);
        data.friends.push(dupes[0]);
      }
      const existing = data.friends.find(f => f.email === fromEmail);
      if (!existing) {
        data.friends.push({
          email:       fromEmail,
          displayName: fromName || fromEmail,
          picture:     fromPicture || null,
          addedAt:     new Date().toISOString(),
          status:      'accepted'
        });
        await _saveFriendsFile(data);
      } else if (existing.status !== 'accepted') {
        existing.status      = 'accepted';
        existing.displayName = fromName || existing.displayName;
        if (fromPicture) existing.picture = fromPicture;
        await _saveFriendsFile(data);
      }

      // Mark the request as handled so it won't reappear (inline, already under lock)
      if (requestFileId) {
        const ids = await _getHandledNotifIds();
        if (!ids.includes(requestFileId)) {
          ids.push(requestFileId);
          _cacheSet('handledNotifs', ids);
          await Drive.upsertJsonFile('handled-notifs.json', { ids }, _folders.rootId);
        }
      }

      // Create acceptance notification so the requester knows we accepted
      const user = Auth.getCurrentUser();
      const payload = {
        type:        'mc_friend_accepted',
        fromEmail:   user.email,
        fromName:    user.name    || user.email,
        fromPicture: user.picture || null,
        toEmail:     fromEmail,
        acceptedAt:  new Date().toISOString()
      };
      try {
        const key    = `mc-freqacc-${fromEmail.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
        const fileId = await Drive.upsertJsonFile(key, payload, _folders.rootId);
        await Drive.shareWithEmail(fileId, fromEmail, 'reader').catch(() => {});
      } catch {}
    });

    _cacheDel('incomingReqs'); // bust cache so badge refreshes immediately
    // Share all existing 'friends' posts/stories with the new friend (outside the lock)
    _shareExistingPostsWithFriend(fromEmail).catch(() => {});
  }

  async function declineFriendRequest(fileId) {
    await _markNotifHandled(fileId);
    _cacheDel('incomingReqs'); // bust cache so count refreshes immediately
  }

  // Check sharedWithMe for mc-freqacc-* and mc-fremov-* files.
  // Promotes pending_sent entries to accepted and removes entries for removals.
  // Throttled to once per 60 s. Drive reads happen OUTSIDE the write lock so the lock is
  // held only for the fast in-memory mutations + two small Drive writes.
  async function syncFriendAcceptances() {
    // Throttle: skip if run recently (dedup concurrent calls too)
    const now = Date.now();
    if (now - _lastSyncAt < 60_000) return;
    if (_syncInFlight) return _syncInFlight;

    _lastSyncAt = now; // claim the slot immediately so concurrent callers bail

    _syncInFlight = (async () => {
      const newlyAcceptedEmails = [];
      try {
        // ── Phase 1: read from Drive OUTSIDE the write lock ─────────────
        const [accFiles, remFiles] = await Promise.all([
          Drive.listSharedFilesWithName('mc-freqacc-'),
          Drive.listSharedFilesWithName('mc-fremov-')
        ]);

        const me      = Auth.getCurrentUser();
        const handled = await _getHandledNotifIds();
        const allFiles = [...accFiles, ...remFiles].filter(f => !handled.includes(f.id));
        if (!allFiles.length) return;

        // Read all unhandled files in parallel
        const toProcess = (await Promise.all(
          allFiles.map(async f => {
            try {
              const d = await Drive.readJsonFile(f.id);
              const validType = d.type === 'mc_friend_accepted' || d.type === 'mc_friend_removed';
              return (validType && d.toEmail === me.email) ? { fileId: f.id, ...d } : null;
            } catch { return null; }
          })
        )).filter(Boolean);

        if (!toProcess.length) return;

        // ── Phase 2: mutate state inside the write lock (fast: cache hits + 2 writes) ─
        await _withWriteLock(async () => {
          const data           = await _getFriendsFile();
          const currentHandled = await _getHandledNotifIds();
          let changed  = false;
          const newHandled = [...currentHandled];

          for (const d of toProcess) {
            if (newHandled.includes(d.fileId)) continue;

            if (d.type === 'mc_friend_accepted') {
              const friend = data.friends.find(fr => fr.email === d.fromEmail);
              if (friend) {
                if (friend.status === 'pending_sent' || !friend.displayName || friend.displayName === friend.email) {
                  friend.status      = 'accepted';
                  friend.displayName = d.fromName || d.fromEmail;
                  if (d.fromPicture) friend.picture = d.fromPicture;
                  changed = true;
                  newlyAcceptedEmails.push(d.fromEmail);
                }
              } else if (!data.friends.some(fr => fr.email === d.fromEmail)) {
                data.friends.push({
                  email:       d.fromEmail,
                  displayName: d.fromName || d.fromEmail,
                  picture:     d.fromPicture || null,
                  addedAt:     new Date().toISOString(),
                  status:      'accepted'
                });
                changed = true;
                newlyAcceptedEmails.push(d.fromEmail);
              }
            } else if (d.type === 'mc_friend_removed') {
              // The other person removed us — mirror it locally
              const before = data.friends.length;
              data.friends = data.friends.filter(fr => fr.email !== d.fromEmail);
              if (data.friends.length !== before) changed = true;
            }

            newHandled.push(d.fileId);
          }

          if (changed) await _saveFriendsFile(data);
          if (newHandled.length > currentHandled.length) {
            _cacheSet('handledNotifs', newHandled);
            await Drive.upsertJsonFile('handled-notifs.json', { ids: newHandled }, _folders.rootId);
          }
        });
      } catch {}

      // Share existing 'friends' posts with newly confirmed friends (outside the lock)
      for (const email of newlyAcceptedEmails) {
        _shareExistingPostsWithFriend(email).catch(() => {});
      }
    })().finally(() => { _syncInFlight = null; });

    return _syncInFlight;
  }

  // Force the next syncFriendAcceptances call to run immediately (bypass throttle).
  function _resetSyncThrottle() { _lastSyncAt = 0; }

  /* ── PIN ────────────────────────────────────── */

  async function _hashPin(pin, salt) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function _generateSalt() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  async function getPin() {
    try {
      const f = await Drive.findFile('pin.json', _folders.rootId);
      if (!f) return null;
      return await Drive.readJsonFile(f.id);
    } catch { return null; }
  }

  async function setPin(pin) {
    const salt = _generateSalt();
    const hash = await _hashPin(pin, salt);
    await Drive.upsertJsonFile('pin.json', { hash, salt }, _folders.rootId);
  }

  async function verifyPin(pin) {
    const stored = await getPin();
    if (!stored) return true;
    // Backward-compat: old pin.json may lack a salt field (legacy used static 'mc_pin_v1').
    // New format: hash = SHA-256(salt + ':' + pin)
    // Legacy format: hash = SHA-256(pin + 'mc_pin_v1')
    const hashInput = stored.salt
      ? (stored.salt + ':' + pin)
      : (pin + 'mc_pin_v1');
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashInput));
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    return hex === (stored.hash || stored);
  }

  async function clearPin() {
    const f = await Drive.findFile('pin.json', _folders.rootId);
    if (f) await Drive.deleteFile(f.id).catch(() => {});
  }

  /* ── Exports ───────────────────────────────── */

  /* ── Hidden posts (feed/circle hide) ───────── */

  async function getHiddenPostIds() {
    const cached = _cacheGet('hiddenPostIds');
    if (cached) return [...cached];
    try {
      const f = await Drive.findFile('hidden_posts.json', _folders.rootId);
      if (!f) return [];
      const data = await Drive.readJsonFile(f.id);
      const ids = data.ids || [];
      _cacheSet('hiddenPostIds', ids);
      return [...ids];
    } catch { return []; }
  }

  async function hidePost(id) {
    return _withWriteLock(async () => {
      const ids = await getHiddenPostIds();
      if (!ids.includes(id)) {
        ids.push(id);
        _cacheSet('hiddenPostIds', ids);
        await Drive.upsertJsonFile('hidden_posts.json', { ids }, _folders.rootId);
      }
    });
  }

  async function unhidePost(id) {
    return _withWriteLock(async () => {
      const ids = await getHiddenPostIds();
      const filtered = ids.filter(x => x !== id);
      _cacheSet('hiddenPostIds', filtered);
      await Drive.upsertJsonFile('hidden_posts.json', { ids: filtered }, _folders.rootId);
    });
  }

  /* ── Circle post edit ───────────────────────── */

  async function updateCirclePostCaption(postFolderId, caption) {
    const f = await Drive.findFile('_post.json', postFolderId);
    if (!f) throw new Error('Circle post not found');
    const meta = await Drive.readJsonFile(f.id);
    const updated = { ...meta, caption };
    await Drive.updateJsonFile(f.id, updated);
    return updated;
  }

  /* ── Hidden users ───────────────────────────── */

  async function _getHiddenUsersFile() {
    const cached = _cacheGet('hiddenUsers');
    if (cached) return JSON.parse(JSON.stringify(cached));
    return _dedup('hiddenUsersFile', async () => {
      try {
        const f = await Drive.findFile('hidden_users.json', _folders.contactsFolderId);
        if (!f) return { users: [] };
        const data = await Drive.readJsonFile(f.id);
        _cacheSet('hiddenUsers', data);
        return JSON.parse(JSON.stringify(data));
      } catch { return { users: [] }; }
    });
  }

  async function getHiddenUsers() {
    return (await _getHiddenUsersFile()).users || [];
  }

  async function hideUser(email) {
    return _withWriteLock(async () => {
      const data = await _getHiddenUsersFile();
      if (data.users.find(u => u.email === email)) return;
      data.users.push({ email, hiddenAt: new Date().toISOString() });
      _cacheDel('hiddenUsers');
      await Drive.upsertJsonFile('hidden_users.json', data, _folders.contactsFolderId);
    });
  }

  async function unhideUser(email) {
    return _withWriteLock(async () => {
      const data = await _getHiddenUsersFile();
      data.users = data.users.filter(u => u.email !== email);
      _cacheDel('hiddenUsers');
      await Drive.upsertJsonFile('hidden_users.json', data, _folders.contactsFolderId);
    });
  }

  /* ── Account deletion ─────────────────────── */

  // Permanently deletes all app data from Drive and clears local state.
  // Call Auth.signOut() after this returns.
  async function deleteAccount() {
    // Delete the mycircle root folder (all app data lives inside it)
    await Drive.deleteFile(_folders.rootId);
    // Wipe in-memory caches
    Object.keys(_cache).forEach(k => delete _cache[k]);
    // Clear all app-owned localStorage keys so no stale state persists
    const _LS_KEYS = ['mc_profile_public', 'mc_welcome_done', 'mc_theme', 'mc_color', 'mc_client_id', 'mc_demo'];
    _LS_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch {} });
    _folders = null;
  }

  /* ── Exports ───────────────────────────────── */

  return {
    init,
    getFolders,
    getProfile,   saveProfile,  uploadAvatar, makeProfilePublic,
    getSettings,  saveSettings,
    getFriends,   addFriend,    removeFriend,
    sendFriendRequest, getIncomingFriendRequests, getIncomingCircleNotifications, getNotifications,
    acceptFriendRequest, declineFriendRequest, syncFriendAcceptances,
    deleteAccount,
    getBlocked,   blockUser,    unblockUser,
    getHiddenUsers, hideUser,   unhideUser,
    listCircles,  createCircle, getCircle,  updateCircleMeta,  deleteCircle, uploadCircleCover,
    addMemberToCircle, removeMemberFromCircle,
    createCirclePost, listCirclePosts, deleteCirclePost, updateCirclePostCaption,
    getMutedCircles, muteCircle, unmuteCircle,
    listCollections, createCollection, getCollection, updateCollectionMeta, deleteCollection, shareCollection, inviteCollaborator,
    getReactions, toggleReaction, toggleLike,
    markSeen, getSeenBy,
    createPost, listOwnPosts,
    createStory, listOwnStories,
    getFeedFolders,
    getHiddenIds, hideFile, unhideFile,
    getHiddenPostIds, hidePost, unhidePost,
    getPin, setPin, verifyPin, clearPin,
    _resetSyncThrottle
  };
})();
