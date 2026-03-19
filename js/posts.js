// js/posts.js — Post / Profile / Friends CRUD using Drive module
'use strict';

const Posts = (() => {

  // Cached folder IDs set by initUserData()
  let _folders = null;

  /* ── Boot ─────────────────────────────────────── */

  async function initUserData() {
    const user = Auth.getCurrentUser();
    if (!user) throw new Error('Not signed in');
    _folders = await Drive.initFolders(user.userId);
    return _folders;
  }

  function getFolders() {
    return _folders;
  }

  /* ── Post Validation ──────────────────────────── */

  function _validatePostContent(content) {
    if (!content || typeof content !== 'string') return false;
    const trimmed = content.trim();
    if (trimmed.length === 0 || trimmed.length > 500) return false;
    return true;
  }

  /* ── Build post object ────────────────────────── */

  function _buildPost({ type, content, mediaFileId, isVideo, sharedWith, isPrivate }) {
    const user = Auth.getCurrentUser();
    return {
      id:        Utils.generateId('post'),
      type,
      content:   content || '',
      author: {
        userId: user.userId,
        name:   user.name,
        email:  user.email
      },
      createdAt:   new Date().toISOString(),
      isPrivate:   Boolean(isPrivate),
      sharedWith:  Array.isArray(sharedWith) ? sharedWith : [],
      mediaFileId: mediaFileId || null,
      isVideo:     Boolean(isVideo),
      likes:       [],
      comments:    []
    };
  }

  /* ── Text Post ────────────────────────────────── */

  async function createTextPost(content, sharedWith = [], isPrivate = false) {
    if (!_validatePostContent(content)) {
      throw new Error('Post text must be between 1 and 500 characters.');
    }
    if (!_folders) throw new Error('User data not initialised.');

    const post = _buildPost({ type: 'text', content: content.trim(), sharedWith, isPrivate });
    const fileName = `post-${Date.now()}.json`;

    const file = await Drive.createJsonFile(fileName, post, _folders.userPostsFolderId);
    post._fileId = file.id || file; // demo returns key, real returns { id }

    // Share the file with friends who are in sharedWith
    if (!isPrivate && sharedWith.length > 0 && !Auth.isDemoMode()) {
      await Drive.shareFilesWithFriends([post._fileId], sharedWith);
    }

    return post;
  }

  /* ── Image / Video Post ───────────────────────── */

  async function createMediaPost(file, caption, sharedWith = [], isPrivate = false) {
    const validation = Utils.validateMediaFile(file);
    if (!validation.ok) throw new Error(validation.error);
    if (!_folders) throw new Error('User data not initialised.');

    // Upload media first
    const uploaded = await Drive.uploadMedia(file, _folders.userPostsFolderId);
    const mediaFileId = uploaded.id;
    const mediaUrl    = uploaded.dataUrl || null; // only set in demo mode

    const post = _buildPost({
      type:        'image',
      content:     (caption || '').trim().slice(0, 500),
      mediaFileId,
      isVideo:     validation.isVideo,
      sharedWith,
      isPrivate
    });

    // Store the data URL in the post for demo rendering
    if (mediaUrl) post._mediaDataUrl = mediaUrl;

    const fileName = `post-${Date.now()}.json`;
    const metaFile = await Drive.createJsonFile(fileName, post, _folders.userPostsFolderId);
    post._fileId = metaFile.id || metaFile;

    if (!isPrivate && sharedWith.length > 0 && !Auth.isDemoMode()) {
      await Drive.shareFilesWithFriends([post._fileId, mediaFileId], sharedWith);
    }

    return post;
  }

  /* ── Load own posts ───────────────────────────── */

  async function loadOwnPosts() {
    if (!_folders) return [];

    const files = await Drive.listFiles(_folders.userPostsFolderId, `mimeType='application/json'`);

    const posts = await Promise.all(
      files
        .filter(f => f.name && f.name.startsWith('post-'))
        .map(async f => {
          try {
            const data = await Drive.readJsonFile(f.id);
            if (!data || !data.id) return null;
            return Object.assign({}, data, { _fileId: f.id });
          } catch {
            return null;
          }
        })
    );

    return posts
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /* ── Delete post ──────────────────────────────── */

  async function deletePost(fileId) {
    await Drive.deleteFile(fileId);
  }

  /* ── Profile ──────────────────────────────────── */

  async function loadProfile() {
    if (!_folders) return null;
    try {
      const file = await Drive.findFile('profile.json', _folders.userProfileFolderId);
      if (!file) return null;
      return Drive.readJsonFile(file.id || file);
    } catch {
      return null;
    }
  }

  async function saveProfile(profileData) {
    if (!_folders) throw new Error('User data not initialised.');
    const user = Auth.getCurrentUser();

    const payload = Object.assign({
      userId:    user.userId,
      email:     user.email,
      name:      user.name,
      bio:       '',
      avatar:    null,
      createdAt: new Date().toISOString()
    }, profileData, {
      updatedAt: new Date().toISOString()
    });

    await Drive.upsertJsonFile('profile.json', payload, _folders.userProfileFolderId);
    return payload;
  }

  /* ── Friends list ─────────────────────────────── */

  async function loadFriends() {
    if (!_folders) return [];
    try {
      const file = await Drive.findFile('friends.json', _folders.userProfileFolderId);
      if (!file) return [];
      const data = await Drive.readJsonFile(file.id || file);
      return (data && Array.isArray(data.friends)) ? data.friends : [];
    } catch {
      return [];
    }
  }

  async function saveFriends(friendsList) {
    if (!_folders) throw new Error('User data not initialised.');
    await Drive.upsertJsonFile('friends.json', { friends: friendsList }, _folders.userProfileFolderId);
  }

  async function addFriend(email) {
    if (!email || !email.includes('@')) throw new Error('Invalid email address.');

    const friends = await loadFriends();
    const normalised = email.trim().toLowerCase();

    if (friends.some(f => f.email.toLowerCase() === normalised)) {
      throw new Error('This person is already in your friends list.');
    }

    const user = Auth.getCurrentUser();
    if (normalised === user.email.toLowerCase()) {
      throw new Error("You can't add yourself.");
    }

    const newFriend = {
      userId:  null,           // resolved when they sign in (future phase)
      email:   normalised,
      name:    normalised.split('@')[0],   // placeholder name
      addedAt: new Date().toISOString()
    };

    friends.push(newFriend);
    await saveFriends(friends);
    return newFriend;
  }

  async function removeFriend(email) {
    const friends = await loadFriends();
    const normalised = email.trim().toLowerCase();
    const updated = friends.filter(f => f.email.toLowerCase() !== normalised);
    await saveFriends(updated);
    return updated;
  }

  /* ── Exports ──────────────────────────────────── */

  return {
    initUserData,
    getFolders,
    createTextPost,
    createMediaPost,
    loadOwnPosts,
    deletePost,
    loadProfile,
    saveProfile,
    loadFriends,
    saveFriends,
    addFriend,
    removeFriend
  };
})();
