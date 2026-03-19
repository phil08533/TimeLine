// js/ui.js — DOM rendering & event wiring for TimeLine
'use strict';

const UI = (() => {

  /* ── App-level state ──────────────────────────── */
  let _friends   = [];   // array of friend objects
  let _posts     = [];   // array of post objects
  let _mediaFile = null; // staged file for image compose

  // Debounced publish to prevent double-clicks
  const _debouncedPublishText  = Utils.debounce(_doPublishText,  600);
  const _debouncedPublishImage = Utils.debounce(_doPublishImage, 600);

  /* ── Bootstrap ────────────────────────────────── */

  async function init() {
    _bindStaticEvents();

    Auth.init({
      onSignIn:  _handleSignIn,
      onSignOut: _handleSignOut
    });

    // If already signed in from this session, restore app
    if (Auth.isSignedIn()) {
      await _handleSignIn(Auth.getCurrentUser());
    }
  }

  function _bindStaticEvents() {
    // Auth
    document.getElementById('signInBtn').addEventListener('click', () => Auth.signIn());
    document.getElementById('signOutBtn').addEventListener('click', () => Auth.signOut());

    // Compose tabs
    document.querySelectorAll('.compose-tab').forEach(btn => {
      btn.addEventListener('click', () => switchCompose(btn.dataset.tab));
    });

    // Character counter
    document.getElementById('postText').addEventListener('input', _updateCharCount);

    // Publish buttons
    document.getElementById('publishTextBtn').addEventListener('click',  () => _debouncedPublishText());
    document.getElementById('publishImageBtn').addEventListener('click', () => _debouncedPublishImage());

    // Cancel buttons
    document.getElementById('cancelTextBtn').addEventListener('click',  _clearTextCompose);
    document.getElementById('cancelImageBtn').addEventListener('click', _clearImageCompose);

    // File input
    document.getElementById('imageInput').addEventListener('change', _previewMedia);

    // Add friend modal
    document.getElementById('addFriendBtn').addEventListener('click', openAddFriendModal);
    document.getElementById('confirmAddFriendBtn').addEventListener('click', _doAddFriend);
    document.getElementById('cancelFriendBtn').addEventListener('click', () => closeModal('addFriendModal'));
    document.getElementById('friendEmailInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') _doAddFriend();
    });

    // Close modal on backdrop click
    document.getElementById('addFriendModal').addEventListener('click', e => {
      if (e.target === e.currentTarget) closeModal('addFriendModal');
    });

    // Escape key closes modals
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal('addFriendModal');
    });
  }

  /* ── Auth transitions ─────────────────────────── */

  async function _handleSignIn(user) {
    updateUserBadge(user);

    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appView').hidden = false;

    Utils.showLoading();
    try {
      await Posts.initUserData();
      await _loadAllData();
    } catch (err) {
      console.error('Init error:', err);
      Utils.showToast('Failed to load your data. Please try again.', 'error');
    } finally {
      Utils.hideLoading();
    }
  }

  function _handleSignOut() {
    _friends = [];
    _posts   = [];
    _mediaFile = null;

    document.getElementById('authScreen').style.display = '';
    document.getElementById('appView').hidden = true;
    document.getElementById('userBadge').textContent = 'user';
  }

  async function _loadAllData() {
    const [friends, posts] = await Promise.all([
      Posts.loadFriends().catch(() => []),
      Posts.loadOwnPosts().catch(() => [])
    ]);

    _friends = friends;
    _posts   = posts;

    renderFriendsList();
    renderFriendsChecklist('textFriendsList');
    renderFriendsChecklist('imageFriendsList');
    renderTimeline();
  }

  /* ── User Badge ───────────────────────────────── */

  function updateUserBadge(user) {
    const badge = document.getElementById('userBadge');
    badge.textContent = user ? (user.name || user.email) : 'user';
  }

  /* ── Friends List (sidebar) ───────────────────── */

  function renderFriendsList() {
    const container = document.getElementById('friendsList');
    container.innerHTML = '';

    if (_friends.length === 0) {
      const p = document.createElement('p');
      p.className = 'empty-text';
      p.textContent = 'No friends yet';
      container.appendChild(p);
      return;
    }

    _friends.forEach(friend => {
      const item = document.createElement('div');
      item.className = 'friend-item';

      const name = document.createElement('span');
      name.className = 'friend-item-name';
      name.textContent = friend.name || friend.email;
      name.title = friend.email;

      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove';
      removeBtn.setAttribute('aria-label', `Remove ${friend.name || friend.email}`);
      removeBtn.addEventListener('click', () => _doRemoveFriend(friend.email));

      item.appendChild(name);
      item.appendChild(removeBtn);
      container.appendChild(item);
    });
  }

  /* ── Friends Checklist (compose) ─────────────── */

  function renderFriendsChecklist(containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    if (_friends.length === 0) {
      const p = document.createElement('p');
      p.className = 'empty-text';
      p.textContent = 'Add friends to share with them';
      container.appendChild(p);
      return;
    }

    _friends.forEach(friend => {
      const label = document.createElement('label');
      label.className = 'friend-checkbox';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = friend.email;
      cb.dataset.friendEmail = friend.email;

      const span = document.createElement('span');
      span.textContent = friend.name || friend.email;

      label.appendChild(cb);
      label.appendChild(span);
      container.appendChild(label);
    });
  }

  /* ── Timeline ─────────────────────────────────── */

  function renderTimeline() {
    const timeline  = document.getElementById('timeline');
    const emptyState = document.getElementById('emptyState');

    // Remove old items (keep empty state element)
    Array.from(timeline.children).forEach(child => {
      if (child !== emptyState) child.remove();
    });

    if (_posts.length === 0) {
      emptyState.hidden = false;
      return;
    }

    emptyState.hidden = true;

    _posts.forEach(post => {
      const item = document.createElement('div');
      item.className = 'timeline-item';
      item.appendChild(_renderPost(post));
      timeline.appendChild(item);
    });
  }

  function _renderPost(post) {
    const card = document.createElement('article');
    card.className = 'post';
    card.dataset.postId = post.id;

    // Author line
    const author = document.createElement('div');
    author.className = 'post-author';
    author.textContent = post.author?.name || 'Unknown';
    if (post.isPrivate) {
      const tag = document.createElement('span');
      tag.className = 'post-private-tag';
      tag.textContent = 'private';
      author.appendChild(tag);
    }
    card.appendChild(author);

    // Media
    if (post.type === 'image' && post.mediaFileId) {
      const wrapper = document.createElement('div');
      wrapper.className = 'post-image';
      const frame = document.createElement('div');
      frame.className = 'frame';

      if (post.isVideo) {
        const video = document.createElement('video');
        video.controls = true;
        video.preload = 'metadata';
        video.setAttribute('aria-label', 'Video post');
        _setMediaSrc(video, post);
        frame.appendChild(video);
      } else {
        const img = document.createElement('img');
        img.alt = post.content || 'Photo';
        _setMediaSrc(img, post);
        frame.appendChild(img);
      }

      wrapper.appendChild(frame);
      card.appendChild(wrapper);
    }

    // Text content
    if (post.content) {
      const text = document.createElement('p');
      text.className = 'post-text';
      text.textContent = post.content; // textContent prevents XSS
      card.appendChild(text);
    }

    // Meta line (timestamp)
    const meta = document.createElement('div');
    meta.className = 'post-meta';
    meta.textContent = Utils.formatRelativeTime(post.createdAt);
    card.appendChild(meta);

    // Shared-with line
    if (post.sharedWith && post.sharedWith.length > 0) {
      const shared = document.createElement('div');
      shared.className = 'post-shared';
      shared.textContent = 'Shared with: ' + post.sharedWith.map(Utils.escapeHtml).join(', ');
      card.appendChild(shared);
    }

    return card;
  }

  function _setMediaSrc(el, post) {
    // Demo: data URL stored directly
    if (post._mediaDataUrl) {
      el.src = post._mediaDataUrl;
      return;
    }
    // Real Drive: async load
    Drive.getMediaUrl(post.mediaFileId).then(url => {
      if (url) el.src = url;
    }).catch(() => {});
  }

  /* ── Compose ──────────────────────────────────── */

  function switchCompose(tab) {
    const tabs   = document.querySelectorAll('.compose-tab');
    const panels = document.querySelectorAll('.compose-panel');

    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    panels.forEach(p => { p.hidden = (p.id !== `panel${tab.charAt(0).toUpperCase() + tab.slice(1)}`); });
  }

  function _updateCharCount() {
    const ta      = document.getElementById('postText');
    const counter = document.getElementById('charCount');
    const len = ta.value.length;
    counter.textContent = len;
    counter.parentElement.classList.toggle('warn', len > 450);
  }

  function _clearTextCompose() {
    document.getElementById('postText').value = '';
    _updateCharCount();
    _uncheckAll('textFriendsList');
    document.getElementById('textPrivate').checked = false;
  }

  function _clearImageCompose() {
    document.getElementById('imageInput').value = '';
    document.getElementById('mediaPreview').innerHTML = '';
    _mediaFile = null;
    _uncheckAll('imageFriendsList');
    document.getElementById('imagePrivate').checked = false;
    // Reset label text
    const label = document.querySelector('label[for="imageInput"]');
    if (label) label.textContent = 'Click to select a photo or video';
  }

  function _uncheckAll(containerId) {
    document.querySelectorAll(`#${containerId} input[type="checkbox"]`)
      .forEach(cb => { cb.checked = false; });
  }

  function _selectedFriends(containerId) {
    return Array.from(
      document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)
    ).map(cb => cb.value);
  }

  /* ── Media Preview ────────────────────────────── */

  function _previewMedia(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = Utils.validateMediaFile(file);
    if (!validation.ok) {
      Utils.showToast(validation.error, 'error');
      e.target.value = '';
      return;
    }

    _mediaFile = file;

    const preview = document.getElementById('mediaPreview');
    preview.innerHTML = '';

    const url = URL.createObjectURL(file);

    if (validation.isVideo) {
      const video = document.createElement('video');
      video.src = url;
      video.controls = true;
      video.preload = 'metadata';
      preview.appendChild(video);
    } else {
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Preview';
      preview.appendChild(img);
    }

    const fname = document.createElement('p');
    fname.className = 'preview-filename';
    fname.textContent = file.name;
    preview.appendChild(fname);

    // Update label
    const label = document.querySelector('label[for="imageInput"]');
    if (label) label.textContent = 'Change photo / video';
  }

  /* ── Publish ──────────────────────────────────── */

  async function _doPublishText() {
    const content   = document.getElementById('postText').value;
    const sharedWith = _selectedFriends('textFriendsList');
    const isPrivate = document.getElementById('textPrivate').checked;

    const publishBtn = document.getElementById('publishTextBtn');
    publishBtn.disabled = true;

    Utils.showLoading();
    try {
      const post = await Posts.createTextPost(content, sharedWith, isPrivate);
      _posts.unshift(post);
      renderTimeline();
      _clearTextCompose();
      Utils.showToast('Post published!', 'success');
    } catch (err) {
      Utils.showToast(err.message || 'Failed to publish post.', 'error');
    } finally {
      publishBtn.disabled = false;
      Utils.hideLoading();
    }
  }

  async function _doPublishImage() {
    if (!_mediaFile) {
      Utils.showToast('Please select a photo or video first.', 'error');
      return;
    }

    const caption    = '';    // could add a caption textarea in a future iteration
    const sharedWith = _selectedFriends('imageFriendsList');
    const isPrivate  = document.getElementById('imagePrivate').checked;

    const publishBtn = document.getElementById('publishImageBtn');
    publishBtn.disabled = true;

    Utils.showLoading();
    try {
      const post = await Posts.createMediaPost(_mediaFile, caption, sharedWith, isPrivate);
      _posts.unshift(post);
      renderTimeline();
      _clearImageCompose();
      Utils.showToast('Photo posted!', 'success');
    } catch (err) {
      Utils.showToast(err.message || 'Failed to upload media.', 'error');
    } finally {
      publishBtn.disabled = false;
      Utils.hideLoading();
    }
  }

  /* ── Add Friend ───────────────────────────────── */

  function openAddFriendModal() {
    document.getElementById('friendEmailInput').value = '';
    _setFriendModalError('');
    const modal = document.getElementById('addFriendModal');
    modal.hidden = false;
    modal.querySelector('input').focus();
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.hidden = true;
  }

  function _setFriendModalError(msg) {
    const el = document.getElementById('friendModalError');
    el.textContent = msg;
    el.hidden = !msg;
  }

  async function _doAddFriend() {
    const email = document.getElementById('friendEmailInput').value.trim();
    if (!email) {
      _setFriendModalError('Please enter an email address.');
      return;
    }

    const confirmBtn = document.getElementById('confirmAddFriendBtn');
    confirmBtn.disabled = true;

    try {
      const friend = await Posts.addFriend(email);
      _friends.push(friend);
      renderFriendsList();
      renderFriendsChecklist('textFriendsList');
      renderFriendsChecklist('imageFriendsList');
      closeModal('addFriendModal');
      Utils.showToast(`${friend.name || friend.email} added!`, 'success');
    } catch (err) {
      _setFriendModalError(err.message || 'Failed to add friend.');
    } finally {
      confirmBtn.disabled = false;
    }
  }

  async function _doRemoveFriend(email) {
    try {
      _friends = await Posts.removeFriend(email);
      renderFriendsList();
      renderFriendsChecklist('textFriendsList');
      renderFriendsChecklist('imageFriendsList');
      Utils.showToast('Friend removed.', 'info');
    } catch (err) {
      Utils.showToast(err.message || 'Failed to remove friend.', 'error');
    }
  }

  /* ── Exports ──────────────────────────────────── */

  return {
    init,
    switchCompose,
    openAddFriendModal,
    closeModal,
    updateUserBadge,
    renderTimeline,
    renderFriendsList
  };
})();

// Boot the app once DOM is ready
document.addEventListener('DOMContentLoaded', () => UI.init());
