// js/data.js — App-level data layer for My Circle
// All persistent data lives in the user's Google Drive under mycircle/
'use strict';

const Data = (() => {

  let _folders = null; // { rootId, circlesFolderId, collectionsFolderId, contactsFolderId }

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

  /* ── Settings ──────────────────────────────── */

  async function getSettings() {
    try {
      const f = await Drive.findFile('settings.json', _folders.rootId);
      if (!f) return _defaultSettings();
      return await Drive.readJsonFile(f.id);
    } catch {
      return _defaultSettings();
    }
  }

  function _defaultSettings() {
    return { theme: 'minimal', colorTheme: 'paper', defaultSharing: 'friends', allowCopying: 'friends' };
  }

  async function saveSettings(data) {
    return Drive.upsertJsonFile('settings.json', data, _folders.rootId);
  }

  /* ── Friends ───────────────────────────────── */

  async function _getFriendsFile() {
    try {
      const f = await Drive.findFile('friends.json', _folders.contactsFolderId);
      if (!f) return { friends: [] };
      return await Drive.readJsonFile(f.id);
    } catch {
      return { friends: [] };
    }
  }

  async function getFriends() {
    return (await _getFriendsFile()).friends || [];
  }

  async function addFriend(email, displayName = '') {
    const data = await _getFriendsFile();
    if (data.friends.find(f => f.email === email)) return; // already added
    data.friends.push({ email, displayName, addedAt: new Date().toISOString() });
    await Drive.upsertJsonFile('friends.json', data, _folders.contactsFolderId);
  }

  async function removeFriend(email) {
    const data = await _getFriendsFile();
    data.friends = data.friends.filter(f => f.email !== email);
    await Drive.upsertJsonFile('friends.json', data, _folders.contactsFolderId);
  }

  /* ── Blocked ───────────────────────────────── */

  async function _getBlockedFile() {
    try {
      const f = await Drive.findFile('blocked.json', _folders.contactsFolderId);
      if (!f) return { blocked: [] };
      return await Drive.readJsonFile(f.id);
    } catch {
      return { blocked: [] };
    }
  }

  async function getBlocked() {
    return (await _getBlockedFile()).blocked || [];
  }

  async function blockUser(email) {
    const data = await _getBlockedFile();
    if (data.blocked.find(b => b.email === email)) return;
    data.blocked.push({ email, blockedAt: new Date().toISOString() });
    await Drive.upsertJsonFile('blocked.json', data, _folders.contactsFolderId);
  }

  async function unblockUser(email) {
    const data = await _getBlockedFile();
    data.blocked = data.blocked.filter(b => b.email !== email);
    await Drive.upsertJsonFile('blocked.json', data, _folders.contactsFolderId);
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

  async function createCircle(name, description = '', addPolicy = 'owner_only') {
    const id = Utils.generateId('circle');
    const folderId = await Drive.getOrCreateFolder(id, _folders.circlesFolderId);
    const user = Auth.getCurrentUser();
    const meta = {
      id,
      name,
      description,
      addPolicy,  // 'owner_only' | 'any_member'
      ownerId: user.userId,
      ownerEmail: user.email,
      members: [{ email: user.email, displayName: user.name, role: 'owner', addedAt: new Date().toISOString() }],
      createdAt: new Date().toISOString()
    };
    await Drive.createJsonFile('_meta.json', meta, folderId);
    return { ...meta, folderId };
  }

  async function getCircle(folderId) {
    const f = await Drive.findFile('_meta.json', folderId);
    if (!f) throw new Error('Circle not found');
    const meta = await Drive.readJsonFile(f.id);
    return { ...meta, folderId };
  }

  async function updateCircleMeta(folderId, patch) {
    const f = await Drive.findFile('_meta.json', folderId);
    if (!f) throw new Error('Circle not found');
    const meta = await Drive.readJsonFile(f.id);
    const updated = { ...meta, ...patch };
    await Drive.updateJsonFile(f.id, updated);
    return updated;
  }

  async function deleteCircle(folderId) {
    await Drive.deleteFile(folderId);
  }

  async function addMemberToCircle(folderId, email, displayName = '') {
    const f = await Drive.findFile('_meta.json', folderId);
    const meta = await Drive.readJsonFile(f.id);
    if (meta.members.find(m => m.email === email)) return meta;
    meta.members.push({ email, displayName, role: 'member', addedAt: new Date().toISOString() });
    await Drive.updateJsonFile(f.id, meta);
    // Share the folder with the new member (editor so they can upload)
    await Drive.shareWithEmail(folderId, email, 'writer').catch(() => {});
    return meta;
  }

  async function removeMemberFromCircle(folderId, email) {
    const f = await Drive.findFile('_meta.json', folderId);
    const meta = await Drive.readJsonFile(f.id);
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
    const folders = await Drive.listFiles(_folders.collectionsFolderId, `mimeType='application/vnd.google-apps.folder'`);
    const metas = await Promise.all(folders.map(async f => {
      try {
        const metaFile = await Drive.findFile('_meta.json', f.id);
        if (!metaFile) return null;
        const meta = await Drive.readJsonFile(metaFile.id);
        return { ...meta, folderId: f.id };
      } catch { return null; }
    }));
    return metas.filter(Boolean);
  }

  async function createCollection(name, description = '', sharing = 'friends', allowCopying = true) {
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
    const meta = await Drive.readJsonFile(f.id);
    const updated = { ...meta, ...patch };
    await Drive.updateJsonFile(f.id, updated);
    return updated;
  }

  async function deleteCollection(folderId) {
    await Drive.deleteFile(folderId);
  }

  async function shareCollection(folderId, emails) {
    await Promise.all(emails.map(e => Drive.shareWithEmail(folderId, e, 'commenter').catch(() => {})));
  }

  /* ── Reactions ─────────────────────────────── */

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
      if (!f) return { likes: [] };
      return await Drive.readJsonFile(f.id);
    } catch {
      return { likes: [] };
    }
  }

  async function toggleLike(collectionFolderId) {
    const user = Auth.getCurrentUser();
    const key  = _reactKey(collectionFolderId);
    const f    = await Drive.findFile(key, _folders.rootId);
    let reactions = f ? await Drive.readJsonFile(f.id) : { likes: [] };

    const idx = reactions.likes.findIndex(l => l.userId === user.userId);
    const liked = idx < 0;
    if (liked) {
      reactions.likes.push({ userId: user.userId, email: user.email, at: new Date().toISOString() });
    } else {
      reactions.likes.splice(idx, 1);
    }

    await Drive.upsertJsonFile(key, reactions, _folders.rootId);
    return { liked, count: reactions.likes.length };
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
    const sharing   = opts.sharing   || 'friends';
    const circleIds = opts.circleIds || [];

    const id = Utils.generateId('post');
    const folderId = await Drive.getOrCreateFolder(id, _folders.collectionsFolderId);
    const meta = {
      id, name, caption,
      isPost: true, sharing,
      sharedWith: [], allowCopying: false,
      createdAt: new Date().toISOString()
    };
    await Drive.createJsonFile('_meta.json', meta, folderId);

    // Share based on audience
    if (sharing === 'everyone') {
      await Drive.makePublic(folderId).catch(() => {});
    } else if (sharing === 'friends') {
      const friends = await getFriends();
      await Promise.all(friends.map(f =>
        Drive.shareWithEmail(folderId, f.email, 'commenter').catch(() => {})
      ));
    } else if (sharing === 'circles' && circleIds.length) {
      // Collect all unique member emails across selected circles
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

    return { ...meta, folderId };
  }

  async function listOwnPosts() {
    const colls = await listCollections();
    return colls.filter(c => c.isPost);
  }

  /* ── Feed ──────────────────────────────────── */

  // Returns folders shared with the current user (friends' collections/circles)
  async function getFeedFolders() {
    return Drive.listSharedWithMe();
  }

  /* ── Hidden files ──────────────────────────── */

  async function getHiddenIds() {
    try {
      const f = await Drive.findFile('hidden.json', _folders.rootId);
      if (!f) return [];
      const data = await Drive.readJsonFile(f.id);
      return data.ids || [];
    } catch { return []; }
  }

  async function hideFile(fileId) {
    const ids = await getHiddenIds();
    if (!ids.includes(fileId)) {
      ids.push(fileId);
      await Drive.upsertJsonFile('hidden.json', { ids }, _folders.rootId);
    }
  }

  async function unhideFile(fileId) {
    const ids = await getHiddenIds();
    const filtered = ids.filter(id => id !== fileId);
    await Drive.upsertJsonFile('hidden.json', { ids: filtered }, _folders.rootId);
  }

  /* ── Circle Posts ──────────────────────────── */

  // Each post is a subfolder inside the circle folder, containing _post.json + media/doc files.
  // This avoids write conflicts — each user creates their own subfolder.

  async function createCirclePost(circleFolderId, { caption = '' }) {
    const id = Utils.generateId('cpost');
    const postFolderId = await Drive.getOrCreateFolder(id, circleFolderId);
    const user = Auth.getCurrentUser();
    const meta = {
      id, caption,
      authorEmail: user.email,
      authorName:  user.name || user.email,
      createdAt:   new Date().toISOString()
    };
    await Drive.createJsonFile('_post.json', meta, postFolderId);
    return { ...meta, postFolderId };
  }

  async function listCirclePosts(circleFolderId) {
    const subfolders = await Drive.listFiles(circleFolderId, `mimeType='application/vnd.google-apps.folder'`);
    const posts = await Promise.all(subfolders.map(async sf => {
      try {
        const postFile = await Drive.findFile('_post.json', sf.id);
        if (!postFile) return null; // not a post subfolder (e.g. old structure)
        const meta  = await Drive.readJsonFile(postFile.id);
        const files = await Drive.listFiles(sf.id);
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

  async function sendFriendRequest(email, displayName = '') {
    const data = await _getFriendsFile();
    if (data.friends.find(f => f.email === email)) return; // already in list
    const user = Auth.getCurrentUser();
    const reqPayload = {
      type: 'mc_friend_request',
      fromEmail: user.email,
      fromName:  user.name || user.email,
      toEmail:   email,
      sentAt:    new Date().toISOString()
    };
    const key    = _freqKey(email);
    const fileId = await Drive.upsertJsonFile(key, reqPayload, _folders.rootId);
    await Drive.shareWithEmail(fileId, email, 'reader').catch(() => {});
    data.friends.push({ email, displayName: displayName || email, addedAt: new Date().toISOString(), status: 'pending_sent' });
    await Drive.upsertJsonFile('friends.json', data, _folders.contactsFolderId);
  }

  async function getIncomingFriendRequests() {
    try {
      const files = await Drive.listSharedFilesWithName('mc-freq-');
      const me    = Auth.getCurrentUser();
      const declined = await _getDeclinedRequestIds();
      const reqs = await Promise.all(files.map(async f => {
        try {
          if (declined.includes(f.id)) return null;
          const d = await Drive.readJsonFile(f.id);
          if (d.type !== 'mc_friend_request') return null;
          if (d.toEmail !== me.email) return null;
          return { ...d, fileId: f.id };
        } catch { return null; }
      }));
      return reqs.filter(Boolean);
    } catch { return []; }
  }

  async function _getDeclinedRequestIds() {
    try {
      const f = await Drive.findFile('declined-requests.json', _folders.rootId);
      if (!f) return [];
      const d = await Drive.readJsonFile(f.id);
      return d.ids || [];
    } catch { return []; }
  }

  async function acceptFriendRequest(fromEmail, fromName) {
    const data = await _getFriendsFile();
    if (!data.friends.find(f => f.email === fromEmail)) {
      data.friends.push({ email: fromEmail, displayName: fromName || fromEmail, addedAt: new Date().toISOString(), status: 'accepted' });
      await Drive.upsertJsonFile('friends.json', data, _folders.contactsFolderId);
    }
  }

  async function declineFriendRequest(fileId) {
    const ids = await _getDeclinedRequestIds();
    if (!ids.includes(fileId)) {
      ids.push(fileId);
      await Drive.upsertJsonFile('declined-requests.json', { ids }, _folders.rootId);
    }
  }

  /* ── PIN ────────────────────────────────────── */

  async function _hashPin(pin) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin + 'mc_pin_v1'));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function getPin() {
    try {
      const f = await Drive.findFile('pin.json', _folders.rootId);
      if (!f) return null;
      const data = await Drive.readJsonFile(f.id);
      return data.hash || null;
    } catch { return null; }
  }

  async function setPin(pin) {
    const hash = await _hashPin(pin);
    await Drive.upsertJsonFile('pin.json', { hash }, _folders.rootId);
  }

  async function verifyPin(pin) {
    const stored = await getPin();
    if (!stored) return true;
    return (await _hashPin(pin)) === stored;
  }

  async function clearPin() {
    const f = await Drive.findFile('pin.json', _folders.rootId);
    if (f) await Drive.deleteFile(f.id).catch(() => {});
  }

  /* ── Exports ───────────────────────────────── */

  return {
    init,
    getFolders,
    getProfile,   saveProfile,
    getSettings,  saveSettings,
    getFriends,   addFriend,    removeFriend,
    sendFriendRequest, getIncomingFriendRequests, acceptFriendRequest, declineFriendRequest,
    getBlocked,   blockUser,    unblockUser,
    listCircles,  createCircle, getCircle,  updateCircleMeta,  deleteCircle,
    addMemberToCircle, removeMemberFromCircle,
    createCirclePost, listCirclePosts, deleteCirclePost,
    getMutedCircles, muteCircle, unmuteCircle,
    listCollections, createCollection, getCollection, updateCollectionMeta, deleteCollection, shareCollection,
    getReactions, toggleLike,
    createPost, listOwnPosts,
    getFeedFolders,
    getHiddenIds, hideFile, unhideFile,
    getPin, setPin, verifyPin, clearPin
  };
})();
