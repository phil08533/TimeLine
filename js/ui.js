// js/ui.js — SPA router + all page renderers for My Circle
'use strict';

const UI = (() => {

  /* ── State ──────────────────────────────────── */

  let _currentPage = null;
  let _currentCircleFolderId = null;
  let _currentCollFolderId   = null;

  /* ── Boot ───────────────────────────────────── */

  function boot() {
    Auth.init({ onSignIn: _onSignIn, onSignOut: _onSignOut });
    document.getElementById('sign-in-btn').addEventListener('click', () => Auth.signIn());
    document.getElementById('demo-btn').addEventListener('click', () => Auth.signIn());

    const demoSignInLink = document.getElementById('demo-sign-in-link');
    if (demoSignInLink) demoSignInLink.addEventListener('click', e => { e.preventDefault(); Auth.signOut(); });

    // Notification bell
    const notifBtn = document.getElementById('notif-btn');
    if (notifBtn) notifBtn.addEventListener('click', e => { e.stopPropagation(); _toggleNotificationPanel(); });
    document.addEventListener('click', e => {
      const panel = document.getElementById('notif-panel');
      if (panel && !panel.hidden && !panel.contains(e.target) && e.target !== notifBtn) panel.hidden = true;
    });

    _initSetupUI();

    if (Auth.isSignedIn()) _onSignIn(Auth.getCurrentUser());
  }

  function _initSetupUI() {
    const setupSection  = document.getElementById('setup-section');
    const clientIdInput = document.getElementById('client-id-input');
    const saveBtn       = document.getElementById('save-client-id-btn');
    const clearBtn      = document.getElementById('clear-client-id-btn');
    const statusEl      = document.getElementById('setup-status');
    const authNote      = document.getElementById('auth-note');
    const demoBtn       = document.getElementById('demo-btn');

    if (!setupSection) return;

    const hasCredentials = Auth.hasRealCredentials();

    if (!hasCredentials) {
      // No Google Client ID — show demo option and setup panel
      setupSection.hidden = false;
      if (demoBtn) demoBtn.hidden = false;
      if (authNote) authNote.textContent = 'No Google Client ID configured — Sign in will use a local demo account.';
    } else {
      if (authNote) authNote.textContent = 'Your photos stay in your Google Drive. We never see them.';
    }

    // Pre-fill if a Client ID is already saved in localStorage
    const saved = localStorage.getItem('mc_client_id');
    if (saved) {
      clientIdInput.value = saved;
      clearBtn.style.display = '';
      statusEl.textContent = 'Client ID saved. Click Sign in with Google above.';
    }

    saveBtn.addEventListener('click', () => {
      const id = clientIdInput.value.trim();
      if (!id) { statusEl.textContent = 'Paste your Client ID first.'; return; }
      if (!id.includes('.apps.googleusercontent.com')) {
        statusEl.textContent = 'Should end in .apps.googleusercontent.com — check and try again.';
        return;
      }
      if (Auth.setClientId(id)) {
        statusEl.textContent = 'Saved. Click Sign in with Google above.';
        clearBtn.style.display = '';
        setupSection.removeAttribute('open');
      } else {
        statusEl.textContent = 'Invalid Client ID.';
      }
    });

    clearBtn.addEventListener('click', () => {
      Auth.clearClientId();
      clientIdInput.value = '';
      clearBtn.style.display = 'none';
      statusEl.textContent = 'Removed.';
    });

    clientIdInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); });
  }

  async function _onSignIn(user) {
    _showScreen('app-shell');
    _updateNavAvatar(user);
    const demoBanner = document.getElementById('demo-banner');
    if (demoBanner) demoBanner.hidden = !Auth.isDemoMode();
    Utils.showLoading();
    try {
      // Hard 20 s cap — if Drive setup stalls the user still gets into the app
      await Promise.race([
        Data.init(),
        Utils.sleep(20000).then(() => { throw new Error('timeout'); })
      ]);
      const settings = await Data.getSettings();
      Theme.init(settings);
      _syncSettingsUI(settings);
    } catch (err) {
      console.error('Init error', err);
      const msg = err.message === 'timeout'
        ? 'Setup timed out — working in offline mode.'
        : 'Could not reach Google Drive. Some features may be unavailable.';
      Utils.showToast(msg, 'error', 6000);
    } finally {
      Utils.hideLoading();
    }
    _setupRouter();
    _setupKeyboardShortcuts();
    _navigate(window.location.hash.slice(1) || 'feed');
    // Poll notifications once after sign-in (no need to hammer the API)
    _refreshNotificationCount().catch(() => {});
  }

  function _onSignOut() {
    _showScreen('auth-screen');
    _currentPage = null;
  }

  /* ── Notifications ──────────────────────────── */

  async function _refreshNotificationCount() {
    try {
      const { total } = await Data.getNotifications();
      const badge = document.getElementById('notif-badge');
      if (badge) { badge.textContent = total > 9 ? '9+' : String(total); badge.hidden = total === 0; }
    } catch {}
  }

  async function _toggleNotificationPanel() {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    if (!panel.hidden) { panel.hidden = true; return; }
    panel.hidden = false;
    panel.innerHTML = '<p class="notif-empty">Loading…</p>';

    let friendReqs = [], circleNotifs = [];
    try { ({ friendReqs, circleNotifs } = await Data.getNotifications()); } catch {}
    _refreshNotificationCount().catch(() => {});

    panel.innerHTML = '';
    if (!friendReqs.length && !circleNotifs.length) {
      panel.innerHTML = '<p class="notif-empty">No new notifications.</p>';
      return;
    }

    function _clearIfEmpty() {
      if (!panel.querySelector('.notif-item,.notif-circle')) panel.innerHTML = '<p class="notif-empty">No new notifications.</p>';
    }

    // ── Friend request items ──────────────────────
    friendReqs.forEach(req => {
      const label = req.fromName || req.fromEmail;
      const avatarHtml = req.fromPicture
        ? `<img src="${Utils.escapeHtml(req.fromPicture)}" alt="" class="notif-avatar notif-avatar-img" />`
        : `<div class="notif-avatar">${label[0].toUpperCase()}</div>`;
      const item = _el(`
        <div class="notif-item">
          ${avatarHtml}
          <div class="notif-body">
            <div class="notif-title"><strong>${Utils.escapeHtml(label)}</strong> wants to be your friend</div>
            <div class="notif-actions">
              <button class="btn btn-primary btn-sm notif-accept">Accept</button>
              <button class="btn btn-ghost btn-sm notif-decline">Decline</button>
            </div>
          </div>
        </div>
      `);
      item.querySelector('.notif-accept').addEventListener('click', async () => {
        item.querySelector('.notif-accept').disabled = true;
        item.querySelector('.notif-decline').disabled = true;
        try {
          await Data.acceptFriendRequest(req.fromEmail, req.fromName, req.fromPicture, req.fileId);
          item.innerHTML = `<div class="notif-done">✓ Added ${Utils.escapeHtml(label)} as a friend</div>`;
          setTimeout(() => { item.remove(); _clearIfEmpty(); }, 1800);
          Utils.showToast(`Added ${label} as friend`);
          _refreshNotificationCount().catch(() => {});
        } catch { Utils.showToast('Could not accept', 'error'); }
      });
      item.querySelector('.notif-decline').addEventListener('click', async () => {
        item.querySelector('.notif-accept').disabled = true;
        item.querySelector('.notif-decline').disabled = true;
        await Data.declineFriendRequest(req.fileId).catch(() => {});
        item.remove(); _clearIfEmpty();
        _refreshNotificationCount().catch(() => {});
      });
      panel.appendChild(item);
    });

    // ── Circle post notification items ────────────
    circleNotifs.forEach(notif => {
      const preview = notif.caption ? `: "${notif.caption.length > 40 ? notif.caption.slice(0, 40) + '…' : notif.caption}"` : '';
      const item = _el(`
        <div class="notif-item notif-circle">
          <div class="notif-avatar" style="font-size:1rem">◎</div>
          <div class="notif-body">
            <div class="notif-title"><strong>${Utils.escapeHtml(notif.fromName || notif.fromEmail)}</strong> posted in a circle${Utils.escapeHtml(preview)}</div>
            <div class="notif-actions">
              <button class="btn btn-primary btn-sm notif-view">View</button>
              <button class="btn btn-ghost btn-sm notif-dismiss">Dismiss</button>
            </div>
          </div>
        </div>
      `);
      item.querySelector('.notif-view').addEventListener('click', async () => {
        await Data.declineFriendRequest(notif.fileId).catch(() => {});
        panel.hidden = true;
        navigate('circle-detail', { folderId: notif.circleFolderId });
        _refreshNotificationCount().catch(() => {});
      });
      item.querySelector('.notif-dismiss').addEventListener('click', async () => {
        await Data.declineFriendRequest(notif.fileId).catch(() => {});
        item.remove(); _clearIfEmpty();
        _refreshNotificationCount().catch(() => {});
      });
      panel.appendChild(item);
    });

    // ── Recent circle activity digest ─────────────
    if (circleNotifs.length) {
      // Group by circle
      const byCircle = {};
      circleNotifs.forEach(n => {
        const key = n.circleFolderId || 'unknown';
        if (!byCircle[key]) byCircle[key] = { folderId: n.circleFolderId, count: 0 };
        byCircle[key].count++;
      });
      const groups = Object.values(byCircle);
      const total  = circleNotifs.length;
      const digestEl = _el(`
        <div class="notif-digest">
          <div class="notif-digest-title">Recent circle activity</div>
          <div class="notif-digest-body">${total} new post${total !== 1 ? 's' : ''} across ${groups.length} circle${groups.length !== 1 ? 's' : ''} since yesterday</div>
        </div>
      `);
      panel.appendChild(digestEl);
    }
  }

  /* ── Screen / page helpers ─────────────────── */

  function _showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  function _updateNavAvatar(user) {
    const el = document.getElementById('nav-avatar');
    if (!el) return;
    if (user?.picture) {
      el.innerHTML = `<img src="${Utils.escapeHtml(user.picture)}" alt="" />`;
    } else {
      el.textContent = (user?.name || '?')[0].toUpperCase();
    }
  }

  /* ── Router ─────────────────────────────────── */

  function _setupRouter() {
    window.addEventListener('hashchange', () => _navigate(window.location.hash.slice(1) || 'feed'));

    window.addEventListener('mc:session-expired', () => {
      Utils.showToast('Your session expired — please sign in again.', 'error', 6000);
      Auth.signOut();
    });

    _on('back-from-circle',    'click', () => navigate('circles'));
    _on('back-from-collection','click', () => navigate('collections'));
    _on('sign-out-btn',        'click', () => Auth.signOut());
  }

  function navigate(page, params = {}) {
    if (page === 'circle-detail' && params.folderId) {
      _currentCircleFolderId = params.folderId;
      window.location.hash = `circle-detail/${params.folderId}`;
    } else if (page === 'collection-detail' && params.folderId) {
      _currentCollFolderId = params.folderId;
      window.location.hash = `collection-detail/${params.folderId}`;
    } else {
      window.location.hash = page;
    }
  }

  const _pageTitles = {
    feed: 'Feed', 'my-data': 'My Data',
    circles: 'Circles', 'circle-detail': 'Circle',
    collections: 'Collections', 'collection-detail': 'Collection',
    friends: 'Friends', profile: 'Profile', settings: 'Settings', about: 'About'
  };

  function _navigate(hash) {
    const parts = hash.split('/');
    const page  = parts[0];
    const id    = parts[1];

    document.title = (_pageTitles[page] ? _pageTitles[page] + ' — ' : '') + 'My Circle';

    document.querySelectorAll('.nav-link').forEach(a => {
      const match = a.dataset.page === page || (page.startsWith(a.dataset.page) && a.dataset.page !== 'feed');
      a.classList.toggle('active', match);
    });

    document.querySelectorAll('.page').forEach(p => { p.style.display = 'none'; });
    _currentPage = page;

    switch (page) {
      case 'feed':
        _showPage('page-feed');        _renderFeed();             break;
      case 'my-data':
        _showPage('page-my-data');     _renderMyData();           break;
      case 'circles':
        _showPage('page-circles');     _renderCircles();          break;
      case 'circle-detail':
        _currentCircleFolderId = id || _currentCircleFolderId;
        _showPage('page-circle-detail'); _renderCircleDetail(_currentCircleFolderId); break;
      case 'collections':
        _showPage('page-collections'); _renderCollections();      break;
      case 'collection-detail':
        _currentCollFolderId = id || _currentCollFolderId;
        _showPage('page-collection-detail'); _renderCollectionDetail(_currentCollFolderId); break;
      case 'friends':
        _showPage('page-friends');     _renderFriends();          break;
      case 'profile':
        _showPage('page-profile');     _renderProfile();          break;
      case 'settings':
        _showPage('page-settings');    _renderSettings();         break;
      case 'about':
        _showPage('page-about');                                  break;
      default:
        _showPage('page-feed');        _renderFeed();
    }
  }

  function _showPage(id) {
    const el = document.getElementById(id);
    if (el) { el.removeAttribute('hidden'); el.style.display = 'block'; }
  }

  /* ── Thumbnail loader ────────────────────────── */

  // Drive thumbnailLink and drive.google.com/thumbnail both require a matching
  // browser Google session cookie to load in <img> tags.  For private files the
  // only reliable path is an authenticated API fetch → blob URL.
  // We try thumbnailLink first (cheap, zero bytes from our quota) and fall back
  // to getFileAsBlob if the browser cookie session doesn't match the OAuth user.

  let _thumbBlobUrls = [];

  function _clearThumbBlobs() {
    _thumbBlobUrls.forEach(u => URL.revokeObjectURL(u));
    _thumbBlobUrls = [];
  }

  function _loadThumbnail(imgEl, fileId, thumbnailLink) {
    if (Auth.isDemoMode()) {
      const u = Drive.getThumbnailUrl(fileId);
      if (u) imgEl.src = u;
      return;
    }
    function _fetchBlob() {
      Drive.getFileAsBlob(fileId).then(u => {
        _thumbBlobUrls.push(u);
        imgEl.src = u;
      }).catch(() => {});
    }
    if (thumbnailLink) {
      imgEl.src = thumbnailLink;
      imgEl.addEventListener('error', _fetchBlob, { once: true });
    } else {
      _fetchBlob();
    }
  }

  // Loads the first media file from a folder and sets it as the card cover image.
  // thumbEl is the .coll-thumb div; called after the card is in the DOM.
  async function _loadCardCover(folderId, thumbEl) {
    try {
      const files = await Drive.listFiles(folderId);
      const first = files.find(f => f.mimeType?.startsWith('image/') || f.mimeType?.startsWith('video/'));
      if (!first) return;
      const img = document.createElement('img');
      img.alt = '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover';
      _loadThumbnail(img, first.id, first.thumbnailLink);
      thumbEl.innerHTML = '';
      thumbEl.appendChild(img);
    } catch { /* leave emoji placeholder */ }
  }

  /* ── Feed ───────────────────────────────────── */

  let _feedAlbums = [];   // cached after load for filter re-renders
  let _feedFilter = 'all';
  let _feedQueue  = [];   // albums not yet rendered (infinite scroll)
  let _feedSentinelObs = null; // IntersectionObserver for infinite scroll
  let _focusedPostIndex = -1; // keyboard navigation

  async function _openPostModal() {
    // Load circles so the audience picker can list them
    const circles = await Data.listCircles().catch(() => []);

    const circlePillsHtml = circles.length
      ? circles.map(c => `
          <label class="circle-check">
            <input type="checkbox" name="circle-ids" value="${Utils.escapeHtml(c.folderId)}" />
            <span>${Utils.escapeHtml(c.name)}</span>
          </label>`).join('')
      : '<span class="muted-text small">You have no circles yet.</span>';

    openModal(`
      <h3>Create a Post</h3>
      <form id="post-form" class="form-block">

        <div class="post-dropzone" id="post-dropzone" tabindex="0" role="button" aria-label="Add photos or videos">
          <div class="post-dropzone-inner">
            <span class="post-dropzone-icon">📷</span>
            <span>Drag photos &amp; videos here, or <span class="link-text">browse</span></span>
          </div>
          <input type="file" id="post-files" accept="image/*,video/*" multiple hidden />
        </div>

        <div id="post-previews" class="post-previews" hidden></div>

        <div class="form-field" id="post-album-row" hidden>
          <label>Album title <span class="muted-text small">(required when adding multiple photos)</span></label>
          <input type="text" id="post-album-title" class="input" placeholder="Summer 2025, Road trip…" maxlength="80" />
        </div>

        <div class="form-field">
          <label>Caption <span class="muted-text small">(optional)</span></label>
          <textarea id="post-caption" class="input" rows="3" placeholder="What's on your mind?"></textarea>
        </div>

        <div class="form-field">
          <label>Who can see this?</label>
          <div class="audience-options">

            <label class="audience-option">
              <input type="radio" name="audience" value="friends" checked />
              <div>
                <div class="audience-label">All friends</div>
                <div class="muted-text small">Everyone you've added as a friend</div>
              </div>
            </label>

            <label class="audience-option" id="audience-circles-row">
              <input type="radio" name="audience" value="circles" />
              <div>
                <div class="audience-label">Specific circles</div>
                <div class="muted-text small">Only people in the circles you choose</div>
              </div>
            </label>
            <div class="circle-picker" id="circle-picker" hidden>
              ${circlePillsHtml}
            </div>

            <label class="audience-option">
              <input type="radio" name="audience" value="everyone" />
              <div>
                <div class="audience-label">Public link</div>
                <div class="muted-text small">Anyone who has the link can view — shared via Google Drive's link sharing</div>
              </div>
            </label>

          </div>
        </div>

        <p id="post-status" class="muted-text small" aria-live="polite"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Post</button>
        </div>
      </form>
    `);

    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);

    const dropzone   = document.getElementById('post-dropzone');
    const fileInput  = document.getElementById('post-files');
    const previewBox = document.getElementById('post-previews');
    const albumRow   = document.getElementById('post-album-row');
    const albumTitle = document.getElementById('post-album-title');
    const circlePick = document.getElementById('circle-picker');
    const status     = document.getElementById('post-status');
    let selectedFiles = [];

    // Dropzone click / keyboard
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

    // Drag-and-drop
    dropzone.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('dropzone--over'); });
    dropzone.addEventListener('dragleave', ()  => dropzone.classList.remove('dropzone--over'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('dropzone--over');
      _applyFiles(Array.from(e.dataTransfer.files).filter(f =>
        f.type.startsWith('image/') || f.type.startsWith('video/')
      ));
    });

    fileInput.addEventListener('change', () => _applyFiles(Array.from(fileInput.files)));

    function _applyFiles(files) {
      selectedFiles = files;
      previewBox.innerHTML = '';
      previewBox.hidden = !files.length;
      albumRow.hidden    = files.length <= 1;
      files.forEach(f => {
        const url  = URL.createObjectURL(f);
        const item = _el(`<div class="post-preview-item"><img src="${url}" alt="${Utils.escapeHtml(f.name)}" /></div>`);
        previewBox.appendChild(item);
      });
      if (files.length > 1 && !albumTitle.value) albumTitle.focus();
    }

    // Show / hide circle picker when audience radio changes
    document.querySelectorAll('input[name="audience"]').forEach(r => {
      r.addEventListener('change', () => {
        if (circlePick) circlePick.hidden = r.value !== 'circles';
      });
    });

    // Submit
    document.getElementById('post-form').addEventListener('submit', async e => {
      e.preventDefault();
      const caption  = document.getElementById('post-caption').value.trim();
      const audience = document.querySelector('input[name="audience"]:checked').value;
      const title    = albumTitle.value.trim();

      if (!caption && !selectedFiles.length) {
        status.textContent = 'Write something or add a photo first.';
        return;
      }
      if (selectedFiles.length > 1 && !title) {
        status.textContent = 'Give your album a title.';
        albumTitle.focus();
        return;
      }

      let circleIds = [];
      if (audience === 'circles') {
        circleIds = [...document.querySelectorAll('input[name="circle-ids"]:checked')].map(el => el.value);
        if (!circleIds.length) {
          status.textContent = 'Select at least one circle.';
          return;
        }
      }

      const submitBtn = e.target.querySelector('[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Posting…';
      status.textContent = 'Creating…';
      Utils.showLoading();

      try {
        const post = await Data.createPost({
          caption,
          name: title || (selectedFiles.length === 1 ? selectedFiles[0].name.replace(/\.[^.]+$/, '') : `Post ${new Date().toLocaleDateString()}`),
          sharing: audience,
          circleIds
        });

        if (selectedFiles.length) {
          status.textContent = `Uploading ${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}…`;
          await Promise.all(selectedFiles.map(f => Drive.uploadMedia(f, post.folderId)));
        }

        closeModal();
        Utils.showToast('Posted!');
        _renderFeed();
      } catch {
        Utils.showToast('Failed to post', 'error');
        status.textContent = '';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Post';
      } finally {
        Utils.hideLoading();
      }
    });
  }

  async function _renderFeed() {
    const list  = document.getElementById('feed-list');
    const empty = document.getElementById('feed-empty');
    list.innerHTML = '<p class="muted-text">Loading…</p>';
    empty.hidden = true;
    _clearThumbBlobs();

    // Disconnect any existing sentinel observer
    if (_feedSentinelObs) { _feedSentinelObs.disconnect(); _feedSentinelObs = null; }

    _on('new-post-btn', 'click', () => _openPostModal());

    // Wire up filter pills (use _on equivalent via replacement to avoid duplicate listeners)
    document.querySelectorAll('#feed-filters .filter-pill').forEach(btn => {
      const fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);
      fresh.addEventListener('click', () => {
        document.querySelectorAll('#feed-filters .filter-pill').forEach(b => b.classList.remove('active'));
        fresh.classList.add('active');
        _feedFilter = fresh.dataset.filter;
        _paintFeedAlbums();
      });
    });

    try {
      const [sharedFolders, ownPosts, ownStories] = await Promise.all([
        Data.getFeedFolders(),
        Data.listOwnPosts(),
        Data.listOwnStories().catch(() => [])
      ]);

      const me = Auth.getCurrentUser();

      // ── Render stories bar ─────────────────────
      _renderStoriesBar(sharedFolders, ownStories, me);

      // Build a unified album list (exclude stories)
      const allFolders = [
        ...sharedFolders.map(f => ({
          id: f.id,
          name: f.name,
          sharer: f.owners?.[0]?.displayName || 'Friend',
          sharerEmail: f.owners?.[0]?.emailAddress || '',
          sharerPicture: f.owners?.[0]?.photoLink || null,
          sharedAt: f.sharedWithMeTime || f.createdTime,
          _isOwn: false
        })),
        ...ownPosts.filter(p => !p.isStory).map(p => ({
          id: p.folderId,
          name: p.name,
          sharer: me?.name || 'You',
          sharerEmail: me?.email || '',
          sharerPicture: me?.picture || null,
          sharedAt: p.createdAt || new Date().toISOString(),
          caption: p.caption,
          _isOwn: true
        }))
      ];

      // Sort albums newest-shared first
      allFolders.sort((a, b) => new Date(b.sharedAt) - new Date(a.sharedAt));

      // Load files for first 10 albums immediately; queue the rest for infinite scroll
      const BATCH = 10;
      const firstBatch  = allFolders.slice(0, BATCH);
      const restFolders = allFolders.slice(BATCH);

      _feedAlbums = await Promise.all(firstBatch.map(async album => {
        try {
          const allFiles = await Drive.listFiles(album.id);
          const metaFile = allFiles.find(f => f.name === '_meta.json');
          const files    = allFiles.filter(f => f.mimeType?.startsWith('image/') || f.mimeType?.startsWith('video/'));
          return { ...album, files, metaFileId: metaFile?.id || null };
        } catch {
          return { ...album, files: [], metaFileId: null };
        }
      }));

      // Store rest in queue for lazy loading
      _feedQueue = restFolders;

      list.innerHTML = '';
      _paintFeedAlbums();

      // Set up sentinel for infinite scroll
      _setupFeedSentinel();

    } catch (err) {
      console.error('Feed load error', err);
      list.innerHTML = '';
      empty.hidden = false;
      empty.querySelector('p').textContent = 'Could not load your feed. Check your connection and try again.';
    }
  }

  function _setupFeedSentinel() {
    const sentinel = document.getElementById('feed-sentinel');
    if (!sentinel || !_feedQueue.length) return;
    sentinel.hidden = false;
    _feedSentinelObs = new IntersectionObserver(async entries => {
      if (!entries[0].isIntersecting || !_feedQueue.length) return;
      const BATCH = 10;
      const nextBatch = _feedQueue.splice(0, BATCH);
      const loaded = await Promise.all(nextBatch.map(async album => {
        try {
          const allFiles = await Drive.listFiles(album.id);
          const metaFile = allFiles.find(f => f.name === '_meta.json');
          const files    = allFiles.filter(f => f.mimeType?.startsWith('image/') || f.mimeType?.startsWith('video/'));
          return { ...album, files, metaFileId: metaFile?.id || null };
        } catch { return { ...album, files: [], metaFileId: null }; }
      }));
      _feedAlbums = _feedAlbums.concat(loaded);
      _appendFeedAlbums(loaded);
      if (!_feedQueue.length) { sentinel.hidden = true; _feedSentinelObs.disconnect(); }
    }, { rootMargin: '200px' });
    _feedSentinelObs.observe(sentinel);
  }

  // ── Stories bar ──────────────────────────────────
  function _renderStoriesBar(sharedFolders, ownStories, me) {
    const bar = document.getElementById('stories-bar');
    if (!bar) return;
    bar.innerHTML = '';

    // "Add Story" button
    const addCircle = _el(`
      <div class="story-circle story-circle--add" title="Add Story">
        <div class="story-avatar story-avatar--add">+</div>
        <span class="story-label">Your Story</span>
      </div>
    `);
    addCircle.addEventListener('click', () => _openAddStoryModal());
    bar.appendChild(addCircle);

    // Own stories
    ownStories.forEach(story => {
      const initials = (me?.name || '?')[0].toUpperCase();
      const avatarHtml = me?.picture
        ? `<img src="${Utils.escapeHtml(me.picture)}" alt="" class="story-avatar-img" />`
        : `<span class="story-avatar-initials">${initials}</span>`;
      const circle = _el(`
        <div class="story-circle story-circle--own" title="${Utils.escapeHtml(story.name || 'Story')}">
          <div class="story-avatar story-avatar--viewed">${avatarHtml}</div>
          <span class="story-label">${Utils.escapeHtml(me?.name || 'You')}</span>
        </div>
      `);
      circle.addEventListener('click', () => _openStoryViewer([story], 0, me));
      bar.appendChild(circle);
    });

    // Friend stories (shared folders that have isStory in meta)
    // We detect stories by checking if folder name starts with 'story_' pattern or
    // we can check a limited set. For performance we skip meta-checking here and
    // only show folders where the owner matches known friends and folder is recent (<24h)
    // A proper implementation would cache meta but for now we parse based on available data.
    // We show the stories bar and let users tap to see content.
    const recentShared = sharedFolders.filter(f => {
      const t = new Date(f.sharedWithMeTime || f.createdTime || 0).getTime();
      return Date.now() - t < 24 * 60 * 60 * 1000;
    }).slice(0, 8);

    recentShared.forEach(f => {
      const owner  = f.owners?.[0];
      const name   = owner?.displayName || 'Friend';
      const pic    = owner?.photoLink || null;
      const initials = name[0].toUpperCase();
      const avatarHtml = pic
        ? `<img src="${Utils.escapeHtml(pic)}" alt="" class="story-avatar-img" />`
        : `<span class="story-avatar-initials">${initials}</span>`;
      const circle = _el(`
        <div class="story-circle" title="${Utils.escapeHtml(name)}">
          <div class="story-avatar">${avatarHtml}</div>
          <span class="story-label">${Utils.escapeHtml(name.split(' ')[0])}</span>
        </div>
      `);
      circle.addEventListener('click', () => _openStoryViewerFromFolder(f));
      bar.appendChild(circle);
    });

    bar.hidden = bar.children.length <= 1; // hide if only "Add Story" button
  }

  function _openAddStoryModal() {
    openModal(`
      <h3>Share a Story</h3>
      <p class="muted-text small">Stories disappear after 24 hours.</p>
      <form id="story-form" class="form-block">
        <div class="post-dropzone" id="story-dropzone" tabindex="0" role="button" aria-label="Add photo or video">
          <div class="post-dropzone-inner">
            <span class="post-dropzone-icon">📸</span>
            <span>Add a photo or video</span>
          </div>
          <input type="file" id="story-file" accept="image/*,video/*" hidden />
        </div>
        <div id="story-preview" class="post-previews" hidden></div>
        <div class="form-field">
          <label>Caption (optional)</label>
          <input id="story-caption" class="input" type="text" placeholder="What's happening?" maxlength="200" />
        </div>
        <p id="story-status" class="muted-text small" aria-live="polite"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Share Story</button>
        </div>
      </form>
    `);
    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
    const dropzone  = document.getElementById('story-dropzone');
    const fileInput = document.getElementById('story-file');
    const preview   = document.getElementById('story-preview');
    let selectedFile = null;
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
    fileInput.addEventListener('change', () => {
      selectedFile = fileInput.files[0] || null;
      if (selectedFile) {
        const url = URL.createObjectURL(selectedFile);
        preview.innerHTML = `<div class="post-preview-item"><img src="${url}" alt="" /></div>`;
        preview.hidden = false;
      }
    });
    document.getElementById('story-form').addEventListener('submit', async e => {
      e.preventDefault();
      const caption = document.getElementById('story-caption').value.trim();
      const status  = document.getElementById('story-status');
      const btn     = e.target.querySelector('[type="submit"]');
      btn.disabled = true; btn.textContent = 'Sharing…';
      Utils.showLoading();
      try {
        const story = await Data.createStory({ caption, sharing: 'friends' });
        if (selectedFile) {
          status.textContent = 'Uploading…';
          await Drive.uploadMedia(selectedFile, story.folderId);
        }
        closeModal();
        Utils.showToast('Story shared!');
        _renderFeed();
      } catch {
        Utils.showToast('Failed to share story', 'error');
        btn.disabled = false; btn.textContent = 'Share Story';
      } finally { Utils.hideLoading(); }
    });
  }

  async function _openStoryViewerFromFolder(folder) {
    // Simplified: just open the first image/video from the folder as a story
    try {
      const files = await Drive.listFiles(folder.id);
      const media = files.filter(f => f.mimeType?.startsWith('image/') || f.mimeType?.startsWith('video/'));
      if (!media.length) { Utils.showToast('No media in this story', 'error'); return; }
      const owner = folder.owners?.[0];
      _openStoryViewerMedia(media, 0, owner?.displayName || 'Friend', owner?.photoLink || null);
    } catch { Utils.showToast('Could not load story', 'error'); }
  }

  function _openStoryViewer(stories, startIndex, user) {
    if (!stories.length) return;
    // For own stories, load files from the first story
    Drive.listFiles(stories[startIndex].folderId).then(files => {
      const media = files.filter(f => f.mimeType?.startsWith('image/') || f.mimeType?.startsWith('video/'));
      _openStoryViewerMedia(media, 0, user?.name || 'You', user?.picture || null);
    }).catch(() => Utils.showToast('Could not load story', 'error'));
  }

  function _openStoryViewerMedia(mediaFiles, index, authorName, authorPic) {
    if (!mediaFiles.length) return;
    const overlay = _el(`
      <div class="story-viewer-overlay" id="story-viewer-overlay">
        <div class="story-viewer-inner">
          <div class="story-progress-bar">
            ${mediaFiles.map((_, i) => `<div class="story-progress-seg${i < index ? ' done' : (i === index ? ' active' : '')}"></div>`).join('')}
          </div>
          <div class="story-viewer-header">
            <div class="story-viewer-avatar">${authorPic ? `<img src="${Utils.escapeHtml(authorPic)}" alt="" />` : authorName[0].toUpperCase()}</div>
            <span class="story-viewer-name">${Utils.escapeHtml(authorName)}</span>
            <button class="story-viewer-close" aria-label="Close">✕</button>
          </div>
          <div class="story-viewer-media" id="story-viewer-media"></div>
          <button class="story-viewer-prev" aria-label="Previous">‹</button>
          <button class="story-viewer-next" aria-label="Next">›</button>
        </div>
      </div>
    `);
    document.body.appendChild(overlay);

    let cur = index;
    let autoTimer = null;

    function showSlide(i) {
      cur = i;
      const mediaEl = overlay.querySelector('#story-viewer-media');
      mediaEl.innerHTML = '';
      const segs = overlay.querySelectorAll('.story-progress-seg');
      segs.forEach((s, idx) => {
        s.className = 'story-progress-seg' + (idx < cur ? ' done' : (idx === cur ? ' active' : ''));
      });
      const f = mediaFiles[cur];
      if (f.mimeType?.startsWith('video/')) {
        const vid = document.createElement('video');
        vid.autoplay = true; vid.muted = false; vid.loop = false; vid.playsInline = true;
        vid.style.cssText = 'width:100%;height:100%;object-fit:contain';
        Drive.getFileAsBlob(f.id).then(url => { vid.src = url; }).catch(() => {});
        mediaEl.appendChild(vid);
        vid.addEventListener('ended', () => advance(1));
        clearTimeout(autoTimer);
      } else {
        const img = document.createElement('img');
        img.alt = ''; img.style.cssText = 'width:100%;height:100%;object-fit:contain';
        _loadThumbnail(img, f.id, f.thumbnailLink);
        mediaEl.appendChild(img);
        clearTimeout(autoTimer);
        autoTimer = setTimeout(() => advance(1), 5000);
      }
    }

    function advance(dir) {
      const next = cur + dir;
      if (next < 0 || next >= mediaFiles.length) { closeViewer(); return; }
      showSlide(next);
    }

    function closeViewer() {
      clearTimeout(autoTimer);
      overlay.remove();
    }

    overlay.querySelector('.story-viewer-close').addEventListener('click', closeViewer);
    overlay.querySelector('.story-viewer-prev').addEventListener('click', e => { e.stopPropagation(); advance(-1); });
    overlay.querySelector('.story-viewer-next').addEventListener('click', e => { e.stopPropagation(); advance(1); });
    overlay.addEventListener('click', e => { if (e.target === overlay) closeViewer(); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { closeViewer(); document.removeEventListener('keydown', onKey); }
      if (e.key === 'ArrowRight') advance(1);
      if (e.key === 'ArrowLeft')  advance(-1);
    });

    showSlide(cur);
  }

  function _paintFeedAlbums() {
    const list  = document.getElementById('feed-list');
    const empty = document.getElementById('feed-empty');
    list.innerHTML = '';

    const visible = _feedAlbums.filter(a => {
      if (_feedFilter === 'friends') return !a._isOwn;
      if (_feedFilter === 'mine')    return a._isOwn;
      return true;
    }).filter(a => a.files.length > 0 || a.caption);

    if (!visible.length) {
      empty.hidden = false;
      empty.querySelector('p').textContent = _feedFilter === 'all'
        ? 'Your feed is empty. Create a post or add friends to see their shares here.'
        : 'Nothing here yet.';
      // Still add sentinel
      const sentinel = document.getElementById('feed-sentinel');
      if (sentinel) sentinel.hidden = !_feedQueue.length;
      return;
    }
    empty.hidden = true;

    visible.forEach(album => _renderSingleFeedPost(album, list));

    // Sentinel placeholder at end of list
    const sentinel = document.getElementById('feed-sentinel');
    if (sentinel) {
      list.appendChild(sentinel);
      sentinel.hidden = !_feedQueue.length;
    }
  }

  // Appends newly loaded albums (from infinite scroll) without clearing the list
  function _appendFeedAlbums(albums) {
    const list  = document.getElementById('feed-list');
    const empty = document.getElementById('feed-empty');
    const visible = albums.filter(a => {
      if (_feedFilter === 'friends') return !a._isOwn;
      if (_feedFilter === 'mine')    return a._isOwn;
      return true;
    }).filter(a => a.files.length > 0 || a.caption);
    visible.forEach(album => _renderSingleFeedPost(album, list));
    // Move sentinel to end
    const sentinel = document.getElementById('feed-sentinel');
    if (sentinel) { list.appendChild(sentinel); sentinel.hidden = !_feedQueue.length; }
    if (visible.length) empty.hidden = true;
  }

  function _renderSingleFeedPost(album, list) {
    const mediaFiles = album.files.filter(f => f.mimeType?.startsWith('image/') || f.mimeType?.startsWith('video/'));
    const count   = mediaFiles.length;
    const timeStr = Utils.formatRelativeTime(album.sharedAt);

    // Avatar HTML
    const initials = (album.sharer || '?')[0].toUpperCase();
    const avatarHtml = album.sharerPicture
      ? `<img src="${Utils.escapeHtml(album.sharerPicture)}" alt="" class="post-avatar-img" />`
      : `<span class="post-avatar-initials">${initials}</span>`;

    // Media grid (1 photo → full width, 2-4 → 2-col grid, 5+ → 3-col)
    const gridClass = count === 1 ? 'post-media-single' : count <= 4 ? 'post-media-grid2' : 'post-media-grid3';
    const mediaHtml = count > 0 ? `<div class="post-media ${gridClass}"></div>` : '';

    // Text-only detection
    const isTextOnly = count === 0 && !!album.caption;

    const card = _el(`
      <div class="post-card${isTextOnly ? ' post-card--text-only' : ''}" tabindex="-1" data-album-id="${Utils.escapeHtml(album.id)}">
        <div class="post-card-header">
          <div class="post-avatar">${avatarHtml}</div>
          <div class="post-author-meta">
            <span class="post-author-name">${Utils.escapeHtml(album.sharer)}</span>
            <span class="post-author-time">${timeStr}</span>
          </div>
          ${album._isOwn ? `<button class="post-delete-btn" title="Delete post">×</button>` : ''}
        </div>
        ${isTextOnly
          ? `<div class="post-text-only-body">${Utils.escapeHtml(album.caption)}</div>`
          : (album.caption ? `<div class="post-caption">${Utils.escapeHtml(album.caption)}</div>` : '')}
        ${mediaHtml}
        <div class="post-actions">
          <div class="post-reactions" id="reactions-${Utils.escapeHtml(album.id)}">
            <button class="post-react-btn" data-type="like" title="Like">❤️ <span>0</span></button>
            <button class="post-react-btn" data-type="laugh" title="Haha">😂 <span>0</span></button>
            <button class="post-react-btn" data-type="clap" title="Clap">👏 <span>0</span></button>
            <button class="post-react-btn" data-type="wow" title="Wow">😮 <span>0</span></button>
            <button class="post-react-btn" data-type="sad" title="Sad">😢 <span>0</span></button>
          </div>
          <button class="post-comments-btn" data-album-id="${Utils.escapeHtml(album.id)}" data-loaded="0">
            💬 <span class="post-comments-count">0</span> comments
          </button>
        </div>
        <div class="post-comments-section" id="comments-${Utils.escapeHtml(album.id)}" hidden></div>
      </div>
    `);

    // Load media thumbnails into grid
    const mediaDiv = card.querySelector('.post-media');
    if (mediaDiv && count > 0) {
      mediaFiles.slice(0, 9).forEach(f => {
        let thumb;
        if (f.mimeType?.startsWith('video/')) {
          thumb = _el(`
            <div class="post-media-item post-media-item--video">
              <video src="" loop muted playsinline preload="none"></video>
              <div class="video-play-overlay">
                <button class="video-play-btn" aria-label="Play video">▶</button>
              </div>
            </div>
          `);
          const vid    = thumb.querySelector('video');
          const playEl = thumb.querySelector('.video-play-overlay');
          thumb.querySelector('.video-play-btn').addEventListener('click', async e => {
            e.stopPropagation();
            playEl.hidden = true;
            try {
              const url = await Drive.getFileAsBlob(f.id);
              vid.src = url;
              vid.muted = false;
              vid.play().catch(() => {});
            } catch { Utils.showToast('Could not load video', 'error'); playEl.hidden = false; }
          });
        } else {
          thumb = _el(`<div class="post-media-item"><img src="" alt="" loading="lazy" /></div>`);
          _loadThumbnail(thumb.querySelector('img'), f.id, f.thumbnailLink);
        }
        thumb.addEventListener('click', e => {
          if (e.target.closest('.video-play-btn')) return;
          e.stopPropagation();
          openLightbox(f.id, album.id, { canCopy: !album._isOwn, canDelete: album._isOwn, thumbnailLink: f.thumbnailLink });
        });
        mediaDiv.appendChild(thumb);
      });
      if (count > 9) {
        const more = _el(`<div class="post-media-more">+${count - 9}</div>`);
        more.addEventListener('click', e => {
          e.stopPropagation();
          openLightbox(mediaFiles[9].id, album.id, { canCopy: !album._isOwn, canDelete: album._isOwn, thumbnailLink: mediaFiles[9].thumbnailLink });
        });
        mediaDiv.appendChild(more);
      }
    }

    // Multi-reaction buttons — load reactions once
    const reactBar = card.querySelector('.post-reactions');
    Data.getReactions(album.id).then(r => {
      const me = Auth.getCurrentUser();
      const map = { like: r.likes, laugh: r.laughs, clap: r.claps, wow: r.wows, sad: r.sads };
      reactBar.querySelectorAll('.post-react-btn').forEach(btn => {
        const type = btn.dataset.type;
        const arr  = map[type] || [];
        const active = arr.some(l => l.userId === me?.userId);
        btn.querySelector('span').textContent = arr.length;
        btn.classList.toggle('reacted', active);
      });
    }).catch(() => {});

    reactBar.querySelectorAll('.post-react-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const type = btn.dataset.type;
        try {
          const result = await Data.toggleReaction(album.id, type);
          btn.querySelector('span').textContent = result.count;
          btn.classList.toggle('reacted', result.reacted);
        } catch { Utils.showToast('Could not react', 'error'); }
      });
    });

    // Comments button — lazy load
    const commentsBtn = card.querySelector('.post-comments-btn');
    const commentsSection = card.querySelector('.post-comments-section');
    commentsBtn.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = !commentsSection.hidden;
      commentsSection.hidden = isOpen;
      if (!isOpen && commentsBtn.dataset.loaded === '0') {
        commentsBtn.dataset.loaded = '1';
        _loadPostComments(album, commentsSection, commentsBtn);
      }
    });

    // Delete own post
    const delBtn = card.querySelector('.post-delete-btn');
    if (delBtn) {
      delBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('Delete this post?')) return;
        delBtn.disabled = true;
        try {
          await Data.deleteCollection(album.id);
          card.closest('.post-card-wrapper').remove();
          Utils.showToast('Post deleted');
          _feedAlbums = _feedAlbums.filter(a => a.id !== album.id);
          if (!document.querySelectorAll('.post-card').length) _paintFeedAlbums();
        } catch { Utils.showToast('Could not delete post', 'error'); delBtn.disabled = false; }
      });
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'post-card-wrapper';
    wrapper.appendChild(card);
    list.appendChild(wrapper);

    // Seen-by IntersectionObserver
    const seenObs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        Data.markSeen(album.id).catch(() => {});
        seenObs.disconnect();
      }
    }, { threshold: 0.5 });
    seenObs.observe(card);
  }

  function _loadPostComments(album, section, countBtn) {
    // We use the metaFileId for Drive Comments API if available
    const fileId = album.metaFileId;
    section.innerHTML = '<span class="muted-text small">Loading comments…</span>';

    if (!fileId) {
      section.innerHTML = '<span class="muted-text small">Comments not available for this post.</span>';
      _renderCommentInput(album, section, null, countBtn);
      return;
    }

    Drive.getComments(fileId).then(comments => {
      section.innerHTML = '';
      if (comments.length) {
        const area = document.createElement('div');
        area.className = 'post-comments-list';
        comments.forEach(c => {
          const timeStr = c.createdTime ? Utils.formatRelativeTime(c.createdTime) : '';
          area.appendChild(_el(`
            <div class="post-comment-row">
              <span class="post-comment-author">${Utils.escapeHtml(c.author?.displayName || 'Someone')}</span>
              <span class="post-comment-text">${Utils.escapeHtml(c.content)}</span>
              ${timeStr ? `<span class="post-comment-time">${timeStr}</span>` : ''}
            </div>
          `));
        });
        section.appendChild(area);
        const cnt = countBtn.querySelector('.post-comments-count');
        if (cnt) cnt.textContent = comments.length;
      } else {
        section.appendChild(_el('<span class="muted-text small">No comments yet.</span>'));
      }
      _renderCommentInput(album, section, fileId, countBtn);
    }).catch(err => {
      section.innerHTML = '';
      if (err?.status === 403) {
        section.appendChild(_el('<span class="muted-text small">Comments unavailable — owner hasn\'t granted commenter access.</span>'));
      }
      _renderCommentInput(album, section, fileId, countBtn);
    });
  }

  function _renderCommentInput(album, section, fileId, countBtn) {
    const form = _el(`
      <form class="post-comment-form">
        <input class="input post-comment-input" placeholder="Write a comment…" maxlength="500" />
        <button type="submit" class="btn btn-primary btn-sm">Post</button>
      </form>
    `);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const input = form.querySelector('.post-comment-input');
      const text  = input.value.trim();
      if (!text) return;
      if (!fileId) { Utils.showToast('Comments not available', 'error'); return; }
      const btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      try {
        await Drive.addComment(fileId, text);
        input.value = '';
        // Reload comments
        countBtn.dataset.loaded = '0';
        section.innerHTML = '';
        _loadPostComments(album, section, countBtn);
      } catch (err) {
        if (err?.status === 403) Utils.showToast('No commenter access on this post', 'error');
        else Utils.showToast('Failed to post comment', 'error');
      } finally { btn.disabled = false; }
    });
    section.appendChild(form);
  }

  /* ── My Data ─────────────────────────────────── */

  // Shows ALL files from the user's Google Drive with management actions.

  let _myDataItems         = []; // Drive file objects
  let _myDataNextPageToken = null;
  let _myDataHiddenIds     = [];
  let _myDataCurrentFilter = 'all';
  let _pinSessionOk        = false;

  async function _renderMyData() {
    const grid  = document.getElementById('my-data-grid');
    const empty = document.getElementById('my-data-empty');
    grid.innerHTML = '<p class="muted-text" style="grid-column:1/-1">Loading…</p>';
    empty.hidden = true;
    _on('my-data-upload-btn', 'click', _openMyDataUploadModal);
    _on('my-data-load-more', 'click', _loadMoreMyData);

    // Filter pills — deduplicate listeners with replacement
    document.querySelectorAll('#my-data-filters .filter-pill').forEach(btn => {
      const fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);
      fresh.addEventListener('click', () => _onMyDataFilter(fresh));
    });

    try {
      const [driveResult, hiddenIds] = await Promise.all([
        Drive.listAllFiles(), Data.getHiddenIds()
      ]);
      _myDataItems = driveResult.files;
      _myDataNextPageToken = driveResult.nextPageToken;
      _myDataHiddenIds = hiddenIds;
      _myDataCurrentFilter = 'all';

      document.querySelectorAll('#my-data-filters .filter-pill').forEach(b =>
        b.classList.toggle('active', b.dataset.filter === 'all'));
      _renderMyDataGrid('all');
    } catch (err) {
      console.error('My Data load error', err);
      grid.innerHTML = '';
      empty.hidden = false;
      empty.querySelector('p').textContent = 'Could not load your files. Check your connection and try again.';
    }
  }

  async function _loadMoreMyData() {
    if (!_myDataNextPageToken) return;
    const btn = document.getElementById('my-data-load-more');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    try {
      const result = await Drive.listAllFiles(_myDataNextPageToken);
      _myDataItems = _myDataItems.concat(result.files);
      _myDataNextPageToken = result.nextPageToken;
      _renderMyDataGrid(_myDataCurrentFilter);
    } catch { Utils.showToast('Could not load more files', 'error'); }
    if (btn) { btn.disabled = false; btn.textContent = 'Load more'; }
  }

  async function _onMyDataFilter(btn) {
    const filter = btn.dataset.filter;
    _myDataCurrentFilter = filter;
    document.querySelectorAll('#my-data-filters .filter-pill').forEach(b => b.classList.toggle('active', b === btn));

    if (filter !== 'hidden') { _renderMyDataGrid(filter); return; }

    // Hidden tab — require PIN
    if (_pinSessionOk) { _renderMyDataGrid('hidden'); return; }

    const hasPin = !!(await Data.getPin());
    if (!hasPin) {
      _openSetPinModal(() => { _pinSessionOk = true; _renderMyDataGrid('hidden'); });
    } else {
      _openVerifyPinModal(() => { _pinSessionOk = true; _renderMyDataGrid('hidden'); });
    }
  }

  function _fileTypeIcon(mimeType) {
    if (!mimeType) return '📄';
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎥';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📕';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv') return '📊';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📋';
    if (mimeType.includes('document') || mimeType.includes('word') || mimeType.startsWith('text/')) return '📝';
    if (mimeType.includes('zip') || mimeType.includes('archive') || mimeType.includes('tar') || mimeType.includes('rar')) return '🗜️';
    return '📄';
  }

  function _formatFileSize(bytes) {
    if (!bytes) return '';
    const n = parseInt(bytes, 10);
    if (isNaN(n)) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
    return `${(n / 1073741824).toFixed(1)} GB`;
  }

  function _renderMyDataGrid(filter) {
    const grid        = document.getElementById('my-data-grid');
    const empty       = document.getElementById('my-data-empty');
    const loadMoreBtn = document.getElementById('my-data-load-more');
    _clearThumbBlobs();
    grid.innerHTML = '';

    const hiddenSet = new Set(_myDataHiddenIds);
    const isMedia   = f => f.mimeType?.startsWith('image/') || f.mimeType?.startsWith('video/');

    let items;
    if (filter === 'hidden') {
      items = _myDataItems.filter(f => hiddenSet.has(f.id));
    } else if (filter === 'images') {
      items = _myDataItems.filter(f => f.mimeType?.startsWith('image/') && !hiddenSet.has(f.id));
    } else if (filter === 'videos') {
      items = _myDataItems.filter(f => f.mimeType?.startsWith('video/') && !hiddenSet.has(f.id));
    } else if (filter === 'documents') {
      items = _myDataItems.filter(f => !isMedia(f) && !hiddenSet.has(f.id));
    } else {
      items = _myDataItems.filter(f => !hiddenSet.has(f.id));
    }

    if (!items.length) {
      empty.hidden = false;
      const p = empty.querySelector('p');
      if (p) p.textContent = filter === 'hidden' ? 'No hidden files.' : 'No files found in your Drive.';
      if (loadMoreBtn) loadMoreBtn.hidden = true;
      return;
    }
    empty.hidden = true;

    items.sort((a, b) => new Date(b.modifiedTime || b.createdTime) - new Date(a.modifiedTime || a.createdTime));

    // Group by type when showing All or Hidden
    const groups = [];
    if (filter === 'all' || filter === 'hidden') {
      const imgs = items.filter(f => f.mimeType?.startsWith('image/'));
      const vids = items.filter(f => f.mimeType?.startsWith('video/'));
      const docs = items.filter(f => !isMedia(f));
      if (imgs.length) groups.push({ label: '🖼️ Images', items: imgs });
      if (vids.length) groups.push({ label: '🎥 Videos', items: vids });
      if (docs.length) groups.push({ label: '📄 Documents & Files', items: docs });
    } else {
      groups.push({ label: null, items });
    }

    groups.forEach(g => {
      if (g.label) {
        const heading = document.createElement('div');
        heading.className = 'my-data-section-heading';
        heading.textContent = g.label;
        grid.appendChild(heading);
      }

      g.items.forEach(file => {
        const isHidden   = hiddenSet.has(file.id);
        const isMediaFile = isMedia(file);
        const icon       = _fileTypeIcon(file.mimeType);
        const sizeStr    = _formatFileSize(file.size);
        const dateStr    = file.modifiedTime
          ? new Date(file.modifiedTime).toLocaleDateString()
          : (file.createdTime ? new Date(file.createdTime).toLocaleDateString() : '');

        const wrapper = document.createElement('div');
        wrapper.className = 'drive-file-card';

        const el = _el(`
          <div class="media-item media-item--managed${isMediaFile ? '' : ' drive-file-non-media-item'}">
            ${isMediaFile
              ? '<img src="" alt="" loading="lazy" />'
              : `<div class="drive-file-non-media"><span class="drive-file-icon">${icon}</span></div>`}
            <div class="media-item-actions">
              <button class="mia-btn mia-share" title="Share">📤</button>
              <button class="mia-btn mia-add"   title="Add to circle or collection">📁</button>
              <button class="mia-btn mia-hide"  title="${isHidden ? 'Unhide' : 'Hide (private)'}">👁</button>
              <button class="mia-btn mia-del"   title="Delete">🗑</button>
            </div>
          </div>
        `);

        if (isMediaFile) {
          _loadThumbnail(el.querySelector('img'), file.id, file.thumbnailLink);
          el.querySelector('img').addEventListener('click', e => {
            e.stopPropagation();
            openLightbox(file.id, null, { canDelete: true, thumbnailLink: file.thumbnailLink });
          });
        }

        // Share
        el.querySelector('.mia-share').addEventListener('click', e => {
          e.stopPropagation();
          _openShareFileModal(file.id, file.name);
        });

        // Add to collection
        el.querySelector('.mia-add').addEventListener('click', e => {
          e.stopPropagation();
          _openAddToCollectionModal(file.id, file.name);
        });

        // Hide / Unhide
        el.querySelector('.mia-hide').addEventListener('click', async e => {
          e.stopPropagation();
          const hideBtn = e.currentTarget;
          hideBtn.disabled = true;
          try {
            if (isHidden) {
              await Data.unhideFile(file.id);
              _myDataHiddenIds = _myDataHiddenIds.filter(id => id !== file.id);
            } else {
              await Data.hideFile(file.id);
              _myDataHiddenIds.push(file.id);
            }
            _renderMyDataGrid(filter);
          } catch { Utils.showToast('Could not update hidden status', 'error'); hideBtn.disabled = false; }
        });

        // Delete
        el.querySelector('.mia-del').addEventListener('click', async e => {
          e.stopPropagation();
          if (!confirm(`Delete "${file.name}"? This cannot be undone.`)) return;
          const delBtn = e.currentTarget;
          delBtn.disabled = true;
          try {
            await Drive.deleteFile(file.id);
            _myDataItems = _myDataItems.filter(f => f.id !== file.id);
            _renderMyDataGrid(filter);
            Utils.showToast('Deleted');
          } catch { Utils.showToast('Could not delete file', 'error'); delBtn.disabled = false; }
        });

        const label = document.createElement('div');
        label.className = 'drive-file-label';
        label.title = file.name;
        label.textContent = file.name;
        wrapper.appendChild(el);
        wrapper.appendChild(label);

        if (sizeStr || dateStr) {
          const meta = document.createElement('div');
          meta.className = 'drive-file-meta';
          meta.textContent = [sizeStr, dateStr].filter(Boolean).join(' · ');
          wrapper.appendChild(meta);
        }

        grid.appendChild(wrapper);
      });
    });

    if (loadMoreBtn) {
      loadMoreBtn.hidden = !_myDataNextPageToken || filter === 'hidden';
    }
  }

  /* ── Share file modal ─────────────────────────── */

  function _openShareFileModal(fileId, fileName) {
    openModal(`
      <h3>Share "${Utils.escapeHtml(fileName)}"</h3>
      <form id="share-form" class="form-block">
        <div class="form-field">
          <label>Email address</label>
          <input type="email" id="share-email" class="input" placeholder="friend@example.com" autocomplete="email" />
        </div>
        <div class="form-field">
          <label>Permission</label>
          <select id="share-role" class="select-sm" style="width:100%">
            <option value="reader">Viewer — can view only</option>
            <option value="commenter">Commenter — can comment</option>
            <option value="writer">Editor — can edit</option>
          </select>
        </div>
        <div class="form-field">
          <label class="checkbox-label">
            <input type="checkbox" id="share-public" />
            Make public (anyone with the link)
          </label>
        </div>
        <p id="share-status" class="muted-text small" aria-live="polite"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Share</button>
        </div>
      </form>
    `);
    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('share-public').addEventListener('change', e => {
      const checked = e.target.checked;
      document.getElementById('share-email').disabled = checked;
      document.getElementById('share-role').disabled  = checked;
    });
    document.getElementById('share-form').addEventListener('submit', async e => {
      e.preventDefault();
      const isPublic = document.getElementById('share-public').checked;
      const email    = document.getElementById('share-email').value.trim();
      const role     = document.getElementById('share-role').value;
      const status   = document.getElementById('share-status');
      const btn      = e.target.querySelector('[type=submit]');
      btn.disabled = true; btn.textContent = 'Sharing…';
      status.textContent = '';
      try {
        if (isPublic) {
          await Drive.makePublic(fileId);
          Utils.showToast('File is now public');
        } else {
          if (!email) { status.textContent = 'Enter an email address.'; btn.disabled = false; btn.textContent = 'Share'; return; }
          await Drive.shareWithEmail(fileId, email, role);
          Utils.showToast(`Shared with ${email}`);
        }
        closeModal();
      } catch { status.textContent = 'Could not share. Try again.'; btn.disabled = false; btn.textContent = 'Share'; }
    });
  }

  /* ── Add to collection modal ──────────────────── */

  async function _openAddToCollectionModal(fileId, fileName) {
    let circles = [], colls = [];
    try {
      [circles, colls] = await Promise.all([Data.listCircles(), Data.listCollections()]);
    } catch { Utils.showToast('Could not load destinations', 'error'); return; }

    const destOptions = [
      ...circles.map(c => `<option value="${Utils.escapeHtml(c.folderId)}">◎ ${Utils.escapeHtml(c.name)} (Circle)</option>`),
      ...colls.filter(c => !c.isPost).map(c => `<option value="${Utils.escapeHtml(c.folderId)}">▤ ${Utils.escapeHtml(c.name)} (Collection)</option>`)
    ].join('');

    if (!destOptions) { Utils.showToast('Create a circle or collection first', 'error'); return; }

    openModal(`
      <h3>Add to Circle or Collection</h3>
      <p class="muted-text small">A copy of "${Utils.escapeHtml(fileName)}" will be added to the destination.</p>
      <form id="add-to-coll-form" class="form-block">
        <div class="form-field">
          <label>Destination</label>
          <select id="add-dest" class="select-sm" style="width:100%">${destOptions}</select>
        </div>
        <p id="add-status" class="muted-text small" aria-live="polite"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Add</button>
        </div>
      </form>
    `);
    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('add-to-coll-form').addEventListener('submit', async e => {
      e.preventDefault();
      const destFolderId = document.getElementById('add-dest').value;
      const status       = document.getElementById('add-status');
      const btn          = e.target.querySelector('[type=submit]');
      btn.disabled = true; btn.textContent = 'Adding…';
      try {
        await Drive.copyFile(fileId, destFolderId);
        Utils.showToast('Added successfully');
        closeModal();
      } catch { status.textContent = 'Could not add file. Try again.'; btn.disabled = false; btn.textContent = 'Add'; }
    });
  }

  /* ── PIN modals ───────────────────────────────── */

  function _openSetPinModal(onSuccess) {
    openModal(`
      <h3>Set a PIN for Hidden</h3>
      <p class="muted-text small">Choose a PIN to lock your hidden items. You'll enter it once per session.</p>
      <form id="pin-form" class="form-block">
        <div class="form-field">
          <label>New PIN</label>
          <input type="password" id="pin-a" class="input" placeholder="Enter PIN" inputmode="numeric" maxlength="20" autocomplete="new-password" />
        </div>
        <div class="form-field">
          <label>Confirm PIN</label>
          <input type="password" id="pin-b" class="input" placeholder="Confirm PIN" inputmode="numeric" maxlength="20" autocomplete="new-password" />
        </div>
        <p id="pin-status" class="muted-text small" aria-live="polite"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Set PIN</button>
        </div>
      </form>
    `);
    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('pin-form').addEventListener('submit', async e => {
      e.preventDefault();
      const a = document.getElementById('pin-a').value;
      const b = document.getElementById('pin-b').value;
      const status = document.getElementById('pin-status');
      if (!a) { status.textContent = 'Enter a PIN.'; return; }
      if (a !== b) { status.textContent = 'PINs do not match.'; return; }
      const btn = e.target.querySelector('[type="submit"]');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await Data.setPin(a);
        closeModal();
        onSuccess();
      } catch { status.textContent = 'Could not save PIN.'; btn.disabled = false; btn.textContent = 'Set PIN'; }
    });
  }

  function _openVerifyPinModal(onSuccess) {
    openModal(`
      <h3>🔒 Hidden Items</h3>
      <p class="muted-text small">Enter your PIN to view hidden items.</p>
      <form id="pin-form" class="form-block">
        <div class="form-field">
          <input type="password" id="pin-input" class="input" placeholder="PIN" inputmode="numeric" maxlength="20" autocomplete="current-password" />
        </div>
        <p id="pin-status" class="muted-text small" aria-live="polite"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="pin-reset-btn">Forgot PIN</button>
          <button type="button" class="btn btn-ghost btn-sm modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Unlock</button>
        </div>
      </form>
    `);
    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('pin-reset-btn').addEventListener('click', () => {
      if (!confirm('Reset your PIN? Google will verify your identity.')) return;
      Auth.requestReauth(async () => {
        await Data.clearPin().catch(() => {});
        closeModal();
        Utils.showToast('PIN cleared — set a new one to continue.');
        _openSetPinModal(onSuccess);
      });
    });
    document.getElementById('pin-form').addEventListener('submit', async e => {
      e.preventDefault();
      const pin = document.getElementById('pin-input').value;
      const status = document.getElementById('pin-status');
      const btn = e.target.querySelector('[type="submit"]');
      btn.disabled = true; btn.textContent = 'Checking…';
      try {
        const ok = await Data.verifyPin(pin);
        if (!ok) { status.textContent = 'Incorrect PIN.'; btn.disabled = false; btn.textContent = 'Unlock'; return; }
        closeModal();
        onSuccess();
      } catch { status.textContent = 'Could not verify PIN.'; btn.disabled = false; btn.textContent = 'Unlock'; }
    });
  }

  /* ── Upload modals ────────────────────────────── */

  // Drag-drop upload to a specific folder (used by collections detail page)
  function _openUploadModal(folderId) {
    _openDragDropUpload({ title: 'Add Files', folderId, onDone: () => {
      if (_currentPage === 'collection-detail') _renderCollectionDetail(_currentCollFolderId);
    }});
  }

  // Drag-drop upload with destination selector (used by My Data page)
  async function _openMyDataUploadModal() {
    let circles = [], colls = [];
    try {
      [circles, colls] = await Promise.all([Data.listCircles(), Data.listCollections()]);
    } catch { Utils.showToast('Could not load destinations', 'error'); return; }

    const destOptions = [
      ...circles.map(c => `<option value="${Utils.escapeHtml(c.folderId)}">◎ ${Utils.escapeHtml(c.name)} (Circle)</option>`),
      ...colls.filter(c => !c.isPost).map(c => `<option value="${Utils.escapeHtml(c.folderId)}">▤ ${Utils.escapeHtml(c.name)} (Collection)</option>`)
    ].join('');

    if (!destOptions) { Utils.showToast('Create a circle or collection first', 'error'); return; }

    _openDragDropUpload({
      title: 'Upload to Circle or Collection',
      destSelectHtml: `
        <div class="form-field">
          <label>Add to</label>
          <select id="up-dest" class="select-sm" style="width:100%">${destOptions}</select>
        </div>`,
      getFolderId: () => document.getElementById('up-dest').value,
      onDone: () => _renderMyData()
    });
  }

  function _openDragDropUpload({ title, folderId, destSelectHtml = '', getFolderId, onDone }) {
    openModal(`
      <h3>${Utils.escapeHtml(title)}</h3>
      <form id="up-form" class="form-block">
        ${destSelectHtml}
        <div class="post-dropzone" id="up-dropzone" tabindex="0" role="button" aria-label="Add photos or videos">
          <div class="post-dropzone-inner">
            <span class="post-dropzone-icon">📷</span>
            <span>Drag photos &amp; videos here, or <span class="link-text">browse</span></span>
          </div>
          <input type="file" id="up-files" accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,application/pdf" multiple hidden />
        </div>
        <div id="up-previews" class="post-previews" hidden></div>
        <p id="up-status" class="muted-text small" aria-live="polite"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Upload</button>
        </div>
      </form>
    `);
    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);

    const dropzone  = document.getElementById('up-dropzone');
    const fileInput = document.getElementById('up-files');
    const previews  = document.getElementById('up-previews');
    const status    = document.getElementById('up-status');
    let selectedFiles = [];

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dropzone--over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dropzone--over'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('dropzone--over');
      _setUpFiles(Array.from(e.dataTransfer.files));
    });
    fileInput.addEventListener('change', () => _setUpFiles(Array.from(fileInput.files)));

    function _setUpFiles(files) {
      selectedFiles = files;
      previews.innerHTML = '';
      previews.hidden = !files.length;
      files.forEach(f => {
        if (f.type.startsWith('image/') || f.type.startsWith('video/')) {
          const url = URL.createObjectURL(f);
          previews.appendChild(_el(`<div class="post-preview-item"><img src="${url}" alt="${Utils.escapeHtml(f.name)}" /></div>`));
        } else {
          previews.appendChild(_el(`<div class="post-preview-item post-preview-doc"><span>${_fileTypeIcon(f.type)}</span><span class="post-preview-name">${Utils.escapeHtml(f.name)}</span></div>`));
        }
      });
    }

    document.getElementById('up-form').addEventListener('submit', async e => {
      e.preventDefault();
      if (!selectedFiles.length) { status.textContent = 'Select at least one file.'; return; }
      const target = folderId || (getFolderId && getFolderId());
      if (!target) { status.textContent = 'Select a destination.'; return; }
      const submitBtn = e.target.querySelector('[type="submit"]');
      submitBtn.disabled = true; submitBtn.textContent = 'Uploading…';
      Utils.showLoading();
      let done = 0;
      for (const file of selectedFiles) {
        const v = Utils.validateMediaFile(file);
        if (!v.ok) { Utils.showToast(v.error, 'error'); continue; }
        status.textContent = `Uploading ${file.name}…`;
        try { await Drive.uploadMedia(file, target); done++; }
        catch { Utils.showToast(`Failed: ${file.name}`, 'error'); }
      }
      Utils.hideLoading();
      closeModal();
      if (done) { Utils.showToast(`${done} file${done > 1 ? 's' : ''} uploaded`); if (onDone) onDone(); }
    });
  }

  /* ── Circles ─────────────────────────────────── */

  // Generate a stable pastel background color from a string
  function _circleColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
    return `hsl(${h % 360}, 38%, 68%)`;
  }

  async function _renderCircles() {
    const grid  = document.getElementById('circles-grid');
    const empty = document.getElementById('circles-empty');
    grid.innerHTML = '<p class="muted-text">Loading…</p>';
    empty.hidden = true;
    _on('create-circle-btn', 'click', _openCreateCircleModal);
    document.getElementById('circles-empty-create-btn')?.addEventListener('click', _openCreateCircleModal);

    let circles;
    try {
      circles = await Data.listCircles();
    } catch {
      grid.innerHTML = '';
      Utils.showToast('Failed to load circles', 'error');
      return;
    }

    const user = Auth.getCurrentUser();
    let mutedIds = [];
    try { mutedIds = await Data.getMutedCircles(); } catch { /* ignore */ }

    function _buildCard(c) {
      const isOwner = c.ownerEmail === user.email;
      const isMuted = mutedIds.includes(c.folderId);
      const memberCount = c.members?.length || 0;
      const color = _circleColor(c.name);

      // up to 5 mini avatar initials
      const avatarHtml = (c.members || []).slice(0, 5).map(m => {
        const initials = (m.displayName || m.email || '?')[0].toUpperCase();
        return `<span class="mini-avatar" title="${Utils.escapeHtml(m.displayName || m.email)}">${initials}</span>`;
      }).join('');
      const extraCount = memberCount > 5 ? `<span class="mini-avatar" style="background:var(--border)">+${memberCount - 5}</span>` : '';

      const card = _el(`
        <div class="circle-card" style="--circle-color:${color}" data-owner="${isOwner}" data-name="${Utils.escapeHtml(c.name.toLowerCase())}">
          <div class="circle-card-cover">
            <div class="circle-card-cover-overlay"></div>
            ${isMuted ? `<span class="circle-card-mute" title="Muted">🔕</span>` : ''}
            <span class="circle-card-badge ${isOwner ? 'circle-card-badge--owner' : ''}">${isOwner ? 'Owner' : 'Member'}</span>
          </div>
          <div class="circle-card-body">
            <div class="circle-card-title">${Utils.escapeHtml(c.name)}</div>
            ${c.description ? `<div class="circle-card-desc">${Utils.escapeHtml(c.description)}</div>` : ''}
            <div class="circle-card-meta">
              <div class="circle-card-avatars">${avatarHtml}${extraCount}</div>
              <span class="circle-card-members-label">${memberCount} member${memberCount !== 1 ? 's' : ''}</span>
              ${isOwner ? `<button class="btn btn-ghost btn-sm circle-card-edit" title="Edit circle">✎ Edit</button>` : ''}
            </div>
          </div>
        </div>
      `);

      // Load cover image without wiping overlay elements
      const coverDiv = card.querySelector('.circle-card-cover');
      const coverImg = document.createElement('img');
      coverImg.alt = '';
      coverImg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
      coverDiv.prepend(coverImg);
      Drive.listFiles(c.folderId).then(files => {
        const first = files.find(f => f.mimeType?.startsWith('image/') || f.mimeType?.startsWith('video/'));
        if (!first) { coverImg.remove(); return; }
        _loadThumbnail(coverImg, first.id, first.thumbnailLink);
      }).catch(() => coverImg.remove());

      if (isOwner) {
        card.querySelector('.circle-card-edit').addEventListener('click', e => {
          e.stopPropagation();
          _openEditCircleModal(c.folderId, c);
        });
      }
      card.addEventListener('click', () => navigate('circle-detail', { folderId: c.folderId }));
      return card;
    }

    function _applyFilters() {
      const query  = (document.getElementById('circles-search')?.value || '').toLowerCase().trim();
      const active = document.querySelector('#circles-filter .filter-pill.active')?.dataset.filter || 'all';
      let visible = 0;
      grid.querySelectorAll('.circle-card').forEach(card => {
        const name    = card.dataset.name || '';
        const isOwner = card.dataset.owner === 'true';
        const matchesFilter = active === 'all' || (active === 'owner' && isOwner) || (active === 'member' && !isOwner);
        const matchesSearch = !query || name.includes(query);
        card.hidden = !(matchesFilter && matchesSearch);
        if (!card.hidden) visible++;
      });
      empty.hidden = visible > 0 || (circles.length === 0);
    }

    grid.innerHTML = '';
    if (!circles.length) { empty.hidden = false; return; }
    circles.forEach(c => grid.appendChild(_buildCard(c)));

    // Search
    document.getElementById('circles-search')?.addEventListener('input', _applyFilters);

    // Filter pills
    document.querySelectorAll('#circles-filter .filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#circles-filter .filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        _applyFilters();
      });
    });
  }

  async function _renderCircleDetail(folderId) {
    if (!folderId) { navigate('circles'); return; }

    // Reset UI
    document.getElementById('circle-detail-name').textContent = '…';
    document.getElementById('circle-detail-desc').textContent = '';
    document.getElementById('circle-hero-stats').innerHTML = '';
    document.getElementById('circle-detail-feed').innerHTML = '<p class="muted-text">Loading…</p>';
    document.getElementById('circle-detail-empty').hidden = true;
    document.getElementById('circle-detail-actions').innerHTML = '';
    document.getElementById('circle-members-grid').innerHTML = '';

    // Reset tabs to Feed
    document.querySelectorAll('.circle-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'feed'));
    document.getElementById('circle-tab-feed').hidden = false;
    document.getElementById('circle-tab-members').hidden = true;

    // Wire tab switching
    document.querySelectorAll('.circle-tab').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('.circle-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('circle-tab-feed').hidden    = tab.dataset.tab !== 'feed';
        document.getElementById('circle-tab-members').hidden = tab.dataset.tab !== 'members';
      };
    });

    try {
      const [circle, mutedIds] = await Promise.all([
        Data.getCircle(folderId),
        Data.getMutedCircles().catch(() => [])
      ]);

      const user    = Auth.getCurrentUser();
      const isOwner = circle.ownerEmail === user.email;
      const isMuted = mutedIds.includes(folderId);
      const memberCount = circle.members?.length || 0;
      const color = _circleColor(circle.name);

      // Hero
      const iconEl = document.getElementById('circle-detail-icon');
      iconEl.textContent = circle.name[0]?.toUpperCase() || '◎';
      iconEl.style.setProperty('--circle-color', color);

      document.getElementById('circle-detail-name').textContent = circle.name;
      document.getElementById('circle-detail-desc').textContent = circle.description || '';

      document.getElementById('circle-hero-stats').innerHTML = `
        <span class="circle-stat"><strong>${memberCount}</strong> member${memberCount !== 1 ? 's' : ''}</span>
        <span class="circle-stat">${isMuted ? '🔕 Muted' : (circle.addPolicy === 'any_member' ? 'Open' : 'Managed')}</span>
        ${isOwner ? '<span class="circle-stat">You own this</span>' : ''}
      `;

      // Actions
      const actions = document.getElementById('circle-detail-actions');

      const postBtn = _el(`<button class="btn btn-primary btn-sm">+ Post</button>`);
      postBtn.addEventListener('click', () => _openCirclePostModal(folderId, circle));
      actions.appendChild(postBtn);

      if (isOwner || circle.addPolicy === 'any_member') {
        const addBtn = _el(`<button class="btn btn-ghost btn-sm">+ Member</button>`);
        addBtn.addEventListener('click', () => _openAddMemberModal(folderId, circle));
        actions.appendChild(addBtn);
      }

      const muteBtn = _el(`<button class="btn btn-ghost btn-sm">${isMuted ? '🔔 Unmute' : '🔕 Mute'}</button>`);
      muteBtn.addEventListener('click', async () => {
        muteBtn.disabled = true;
        try {
          if (isMuted) { await Data.unmuteCircle(folderId); Utils.showToast('Circle unmuted'); }
          else         { await Data.muteCircle(folderId);   Utils.showToast('Circle muted'); }
          _renderCircleDetail(folderId);
        } catch { muteBtn.disabled = false; }
      });
      actions.appendChild(muteBtn);

      if (isOwner) {
        const editBtn = _el(`<button class="btn btn-ghost btn-sm">✎ Edit</button>`);
        editBtn.addEventListener('click', () => _openEditCircleModal(folderId, circle));
        actions.appendChild(editBtn);

        const delBtn = _el(`<button class="btn btn-ghost btn-sm danger-btn">Delete</button>`);
        delBtn.addEventListener('click', async () => {
          if (!confirm(`Delete circle "${circle.name}"? This cannot be undone.`)) return;
          await Data.deleteCircle(folderId);
          navigate('circles');
          Utils.showToast('Circle deleted');
        });
        actions.appendChild(delBtn);
      }

      // ── Members tab ──
      _renderCircleMembersGrid(folderId, circle, isOwner, user);

      // ── Feed tab ──
      const posts  = await Data.listCirclePosts(folderId);
      const feedEl = document.getElementById('circle-detail-feed');
      feedEl.innerHTML = '';

      if (!posts.length) { document.getElementById('circle-detail-empty').hidden = false; return; }

      posts.forEach(post => {
        const timeStr    = Utils.formatRelativeTime(post.createdAt);
        const isMedia    = f => f.mimeType?.startsWith('image/') || f.mimeType?.startsWith('video/');
        const mediaFiles = post.files.filter(isMedia);
        const docFiles   = post.files.filter(f => !isMedia(f) && f.name !== '_post.json');
        const canDelete  = isOwner || post.authorEmail === user.email;

        const coverHtml = mediaFiles.length > 0 ? `
          <div class="feed-album-cover">
            <img src="" alt="" loading="lazy" />
            ${mediaFiles.length > 1 ? `<span class="feed-album-count">${mediaFiles.length}</span>` : ''}
          </div>` : '';

        const docsHtml = docFiles.map(f =>
          `<div class="circle-doc-chip">${_fileTypeIcon(f.mimeType)} <span>${Utils.escapeHtml(f.name)}</span></div>`
        ).join('');

        const card = _el(`
          <div class="feed-album-card">
            ${coverHtml}
            <div class="feed-album-meta">
              <div class="feed-album-byline">
                <span class="feed-album-sharer">${Utils.escapeHtml(post.authorName || post.authorEmail)}</span>
                <span class="feed-album-dot">·</span>
                <span class="feed-album-time">${timeStr}</span>
                ${canDelete ? `<button class="btn-link circle-del-post" style="margin-left:auto;font-size:.72rem;color:var(--muted)">delete</button>` : ''}
              </div>
              ${post.caption ? `<div class="feed-album-caption">${Utils.escapeHtml(post.caption)}</div>` : ''}
              ${docsHtml ? `<div class="circle-docs-row">${docsHtml}</div>` : ''}
            </div>
          </div>
        `);

        if (mediaFiles.length > 0) {
          _loadThumbnail(card.querySelector('img'), mediaFiles[0].id, mediaFiles[0].thumbnailLink);
        }

        if (canDelete) {
          card.querySelector('.circle-del-post')?.addEventListener('click', async e => {
            e.stopPropagation();
            if (!confirm('Delete this post?')) return;
            try {
              await Data.deleteCirclePost(post.postFolderId);
              _renderCircleDetail(folderId);
              Utils.showToast('Post deleted');
            } catch { Utils.showToast('Could not delete post', 'error'); }
          });
        }

        const expandGrid = document.createElement('div');
        expandGrid.className = 'feed-album-grid';
        expandGrid.hidden = true;
        let expanded = false;

        const setupCoverClick = coverEl => {
          if (!coverEl) return;
          coverEl.style.cursor = 'pointer';
          coverEl.addEventListener('click', e => {
            e.stopPropagation();
            if (mediaFiles.length === 1) {
              openLightbox(mediaFiles[0].id, post.postFolderId, { canDelete, thumbnailLink: mediaFiles[0].thumbnailLink });
            } else {
              expanded = !expanded;
              expandGrid.hidden = !expanded;
              if (expanded && !expandGrid.dataset.loaded) {
                expandGrid.dataset.loaded = '1';
                mediaFiles.forEach(f => {
                  const thumb = _el(`<div class="media-item"><img src="" alt="" loading="lazy" /></div>`);
                  _loadThumbnail(thumb.querySelector('img'), f.id, f.thumbnailLink);
                  thumb.addEventListener('click', ev => {
                    ev.stopPropagation();
                    openLightbox(f.id, post.postFolderId, { canDelete, thumbnailLink: f.thumbnailLink });
                  });
                  expandGrid.appendChild(thumb);
                });
              }
            }
          });
        };
        setupCoverClick(card.querySelector('.feed-album-cover'));

        const wrapper = document.createElement('div');
        wrapper.className = 'feed-album-wrapper';
        wrapper.appendChild(card);
        wrapper.appendChild(expandGrid);
        feedEl.appendChild(wrapper);
      });

    } catch (err) {
      Utils.showToast('Failed to load circle', 'error');
      console.error(err);
    }
  }

  function _renderCircleMembersGrid(folderId, circle, isOwner, user) {
    const grid = document.getElementById('circle-members-grid');
    grid.innerHTML = '';
    const members = circle.members || [];
    if (!members.length) {
      grid.innerHTML = '<p class="muted-text">No members yet.</p>';
      return;
    }
    members.forEach(m => {
      const isMe     = m.email === user.email;
      const isMOwner = m.email === circle.ownerEmail;
      const initials = (m.displayName || m.email || '?')[0].toUpperCase();
      const card = _el(`
        <div class="circle-member-card">
          <div class="circle-member-avatar" style="background:${_circleColor(m.email)}">${initials}</div>
          <div class="circle-member-info">
            <div class="circle-member-name">${Utils.escapeHtml(m.displayName || m.email)}</div>
            <div class="circle-member-email">${Utils.escapeHtml(m.email)}</div>
          </div>
          <span class="circle-member-role ${isMOwner ? 'circle-member-role--owner' : ''}">${isMOwner ? 'Owner' : 'Member'}</span>
        </div>
      `);
      if (isOwner && !isMe) {
        const removeBtn = _el(`<button class="btn btn-ghost btn-sm" style="margin-left:.35rem;font-size:.75rem;padding:.2rem .5rem;color:var(--muted)">✕</button>`);
        removeBtn.title = `Remove ${m.displayName || m.email}`;
        removeBtn.addEventListener('click', async () => {
          const label = m.displayName || m.email;
          if (!confirm(`Remove ${label} from this circle?`)) return;
          try {
            await Data.removeMemberFromCircle(folderId, m.email);
            _renderCircleDetail(folderId);
            Utils.showToast(`${label} removed`);
          } catch { Utils.showToast('Could not remove member', 'error'); }
        });
        card.appendChild(removeBtn);
      }
      grid.appendChild(card);
    });
  }

  function _openCirclePostModal(circleFolderId, circle) {
    const circleName = circle.name || '';
    openModal(`
      <h3>Post to ${Utils.escapeHtml(circleName)}</h3>
      <form id="cp-form" class="form-block">
        <div class="post-dropzone" id="cp-dropzone" tabindex="0" role="button" aria-label="Add files">
          <div class="post-dropzone-inner">
            <span class="post-dropzone-icon">📎</span>
            <span>Photos, videos, docs — drag here or <span class="link-text">browse</span></span>
          </div>
          <input type="file" id="cp-files" accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,application/pdf" multiple hidden />
        </div>
        <div id="cp-previews" class="post-previews" hidden></div>
        <div class="form-field">
          <label>Write something <span class="muted-text small">(optional)</span></label>
          <textarea id="cp-caption" class="input" rows="3" placeholder="What's on your mind?"></textarea>
        </div>
        <p id="cp-status" class="muted-text small" aria-live="polite"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Post</button>
        </div>
      </form>
    `);
    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);

    const dropzone   = document.getElementById('cp-dropzone');
    const fileInput  = document.getElementById('cp-files');
    const previewBox = document.getElementById('cp-previews');
    const status     = document.getElementById('cp-status');
    let selectedFiles = [];

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
    dropzone.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('dropzone--over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dropzone--over'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('dropzone--over');
      _applyCpFiles(Array.from(e.dataTransfer.files));
    });
    fileInput.addEventListener('change', () => _applyCpFiles(Array.from(fileInput.files)));

    function _applyCpFiles(files) {
      selectedFiles = files;
      previewBox.innerHTML = '';
      previewBox.hidden = !files.length;
      files.forEach(f => {
        if (f.type.startsWith('image/') || f.type.startsWith('video/')) {
          const url = URL.createObjectURL(f);
          previewBox.appendChild(_el(`<div class="post-preview-item"><img src="${url}" alt="${Utils.escapeHtml(f.name)}" /></div>`));
        } else {
          previewBox.appendChild(_el(`<div class="post-preview-item post-preview-doc"><span>${_fileTypeIcon(f.type)}</span><span class="post-preview-name">${Utils.escapeHtml(f.name)}</span></div>`));
        }
      });
    }

    document.getElementById('cp-form').addEventListener('submit', async e => {
      e.preventDefault();
      const caption = document.getElementById('cp-caption').value.trim();
      if (!caption && !selectedFiles.length) { status.textContent = 'Write something or add a file first.'; return; }
      const submitBtn = e.target.querySelector('[type=submit]');
      submitBtn.disabled = true; submitBtn.textContent = 'Posting…';
      Utils.showLoading();
      try {
        const post = await Data.createCirclePost(circleFolderId, { caption, members: circle.members || [] });
        if (selectedFiles.length) {
          status.textContent = `Uploading ${selectedFiles.length} file(s)…`;
          await Promise.all(selectedFiles.map(f => Drive.uploadMedia(f, post.postFolderId)));
        }
        closeModal();
        Utils.showToast('Posted!');
        _renderCircleDetail(circleFolderId);
      } catch {
        Utils.showToast('Failed to post', 'error');
        submitBtn.disabled = false; submitBtn.textContent = 'Post';
      } finally { Utils.hideLoading(); }
    });
  }

  function _openCreateCircleModal() {
    openModal(`
      <h3>New Circle</h3>
      <form id="mf" class="form-block">
        <div class="form-field"><label>Name</label><input name="name" class="input" placeholder="e.g. Family, Hiking Crew…" required /></div>
        <div class="form-field"><label>Description (optional)</label><input name="description" class="input" /></div>
        <div class="form-field">
          <label>Who can add members?</label>
          <select name="addPolicy" class="select-sm" style="width:100%">
            <option value="owner_only">Only me (owner)</option>
            <option value="any_member">Any member</option>
          </select>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Create</button>
        </div>
      </form>
    `);
    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('mf').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      Utils.showLoading();
      try {
        await Data.createCircle(fd.get('name'), fd.get('description'), fd.get('addPolicy'));
        closeModal(); _renderCircles(); Utils.showToast('Circle created!');
      } catch { Utils.showToast('Failed to create circle', 'error'); }
      finally   { Utils.hideLoading(); }
    });
  }

  async function _openAddMemberModal(folderId, circle) {
    // Pre-load friends to offer as suggestions (non-blocking)
    let friends = [];
    try { friends = (await Data.getFriends()) || []; } catch { /* ignore */ }

    // Exclude already-in-circle emails
    const existingEmails = new Set((circle.members || []).map(m => m.email));
    const suggestions = friends.filter(f => !existingEmails.has(f.email) && f.status !== 'pending_sent');

    const suggestHtml = suggestions.length ? `
      <div class="form-field">
        <label>Suggest from friends</label>
        <div class="add-member-suggestions">
          ${suggestions.map(f => `
            <button type="button" class="member-suggest-pill" data-email="${Utils.escapeHtml(f.email)}" data-name="${Utils.escapeHtml(f.displayName || '')}">
              ${Utils.escapeHtml(f.displayName || f.email)}
            </button>
          `).join('')}
        </div>
      </div>
    ` : '';

    openModal(`
      <h3>Add Member to ${Utils.escapeHtml(circle.name)}</h3>
      <form id="mf" class="form-block">
        ${suggestHtml}
        <div class="form-field"><label>Email</label><input name="email" type="email" class="input" required placeholder="someone@example.com" /></div>
        <div class="form-field"><label>Display name <span class="muted-text small">(optional)</span></label><input name="displayName" class="input" /></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Add</button>
        </div>
      </form>
    `);
    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);

    // Wire suggestion pills
    document.querySelectorAll('.member-suggest-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelector('#mf [name="email"]').value    = pill.dataset.email;
        document.querySelector('#mf [name="displayName"]').value = pill.dataset.name;
        document.querySelectorAll('.member-suggest-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
      });
    });

    document.getElementById('mf').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      Utils.showLoading();
      try {
        await Data.addMemberToCircle(folderId, fd.get('email'), fd.get('displayName'));
        closeModal(); _renderCircleDetail(folderId); Utils.showToast('Member added!');
      } catch { Utils.showToast('Failed to add member', 'error'); }
      finally   { Utils.hideLoading(); }
    });
  }

  function _openEditCircleModal(folderId, circle) {
    openModal(`
      <h3>Edit Circle</h3>
      <form id="mf" class="form-block">
        <div class="form-field"><label>Name</label><input name="name" class="input" value="${Utils.escapeHtml(circle.name)}" required /></div>
        <div class="form-field"><label>Description</label><input name="description" class="input" value="${Utils.escapeHtml(circle.description || '')}" /></div>
        <div class="form-field">
          <label>Who can add members?</label>
          <select name="addPolicy" class="select-sm" style="width:100%">
            <option value="owner_only" ${circle.addPolicy !== 'any_member' ? 'selected' : ''}>Only me (owner)</option>
            <option value="any_member" ${circle.addPolicy === 'any_member' ? 'selected' : ''}>Any member</option>
          </select>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Save</button>
        </div>
      </form>
    `);
    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('mf').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      Utils.showLoading();
      try {
        await Data.updateCircleMeta(folderId, {
          name: fd.get('name'),
          description: fd.get('description'),
          addPolicy: fd.get('addPolicy')
        });
        closeModal();
        _renderCircles();
        Utils.showToast('Circle updated!');
      } catch { Utils.showToast('Failed to update circle', 'error'); }
      finally   { Utils.hideLoading(); }
    });
  }

  /* ── Collections ─────────────────────────────── */

  async function _renderCollections() {
    const grid  = document.getElementById('collections-grid');
    const empty = document.getElementById('collections-empty');
    grid.innerHTML = '<p class="muted-text">Loading…</p>';
    empty.hidden = true;
    _on('create-collection-btn', 'click', _openCreateCollectionModal);

    try {
      const colls = await Data.listCollections();
      grid.innerHTML = '';
      if (!colls.length) { empty.hidden = false; return; }
      colls.filter(c => !c.isPost).forEach(c => {
        const card = _el(`
          <div class="card coll-card">
            <div class="coll-thumb coll-thumb-cover">▤</div>
            <div class="card-body">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem">
                <h4>${Utils.escapeHtml(c.name)}</h4>
                <button class="btn btn-ghost btn-sm card-edit-btn" title="Edit">✎</button>
              </div>
              <div class="card-meta">
                <span>${_sharingLabel(c.sharing)}</span>
                ${c.allowCopying ? '<span>Copying ok</span>' : ''}
              </div>
              ${c.description ? `<p style="font-size:.78rem;color:var(--muted);margin-top:.35rem">${Utils.escapeHtml(c.description)}</p>` : ''}
            </div>
          </div>
        `);
        const thumb = card.querySelector('.coll-thumb-cover');
        _loadCardCover(c.folderId, thumb);
        card.querySelector('.card-edit-btn').addEventListener('click', e => {
          e.stopPropagation();
          _openEditCollectionModal(c.folderId, c);
        });
        card.addEventListener('click', () => navigate('collection-detail', { folderId: c.folderId }));
        grid.appendChild(card);
      });
    } catch {
      grid.innerHTML = '';
      Utils.showToast('Failed to load collections', 'error');
    }
  }

  function _sharingLabel(s) {
    return { everyone: 'Public', friends: 'Friends', circles: 'Circles', select: 'Select people' }[s] || s;
  }

  async function _renderCollectionDetail(folderId) {
    if (!folderId) { navigate('collections'); return; }
    document.getElementById('collection-detail-name').textContent = '…';
    document.getElementById('collection-detail-grid').innerHTML = '<p class="muted-text">Loading…</p>';
    document.getElementById('collection-detail-actions').innerHTML = '';

    try {
      const coll = await Data.getCollection(folderId);
      document.getElementById('collection-detail-name').textContent = coll.name;

      const actions = document.getElementById('collection-detail-actions');

      const upBtn = _el(`<button class="btn btn-primary btn-sm">Upload</button>`);
      upBtn.addEventListener('click', () => _openUploadModal(folderId));
      actions.appendChild(upBtn);

      const shareBtn = _el(`<button class="btn btn-ghost btn-sm">Share</button>`);
      shareBtn.addEventListener('click', () => _openShareModal(folderId, coll));
      actions.appendChild(shareBtn);

      const inviteBtn = _el(`<button class="btn btn-ghost btn-sm">+ Collaborator</button>`);
      inviteBtn.addEventListener('click', () => _openInviteCollaboratorModal(folderId));
      actions.appendChild(inviteBtn);

      const delBtn = _el(`<button class="btn btn-ghost btn-sm danger-btn">Delete</button>`);
      delBtn.addEventListener('click', async () => {
        if (!confirm(`Delete collection "${coll.name}"?`)) return;
        await Data.deleteCollection(folderId);
        navigate('collections');
        Utils.showToast('Collection deleted');
      });
      actions.appendChild(delBtn);

      const files = await Drive.listFiles(folderId);
      const allFiles = files.filter(f => f.mimeType !== 'application/json');
      const grid  = document.getElementById('collection-detail-grid');
      grid.innerHTML = '';

      if (!allFiles.length) {
        grid.innerHTML = '<div class="empty-state"><p>No files yet. Upload something!</p></div>';
        return;
      }

      const isMedia = f => f.mimeType?.startsWith('image/') || f.mimeType?.startsWith('video/');
      allFiles.forEach(f => {
        if (isMedia(f)) {
          const el = _el(`<div class="media-item"><img src="" alt="" loading="lazy" /></div>`);
          _loadThumbnail(el.querySelector('img'), f.id, f.thumbnailLink);
          el.addEventListener('click', () => openLightbox(f.id, folderId, { canDelete: true, thumbnailLink: f.thumbnailLink }));
          grid.appendChild(el);
        } else {
          // Non-media file card
          const wrapper = document.createElement('div');
          wrapper.className = 'drive-file-card';
          const el = _el(`
            <div class="media-item media-item--managed drive-file-non-media-item">
              <div class="drive-file-non-media"><span class="drive-file-icon">${_fileTypeIcon(f.mimeType)}</span></div>
              <div class="media-item-actions">
                <button class="mia-btn mia-del" title="Delete">🗑</button>
              </div>
            </div>
          `);
          el.querySelector('.mia-del').addEventListener('click', async e => {
            e.stopPropagation();
            if (!confirm(`Delete "${f.name}"?`)) return;
            try { await Drive.deleteFile(f.id); _renderCollectionDetail(folderId); Utils.showToast('Deleted'); }
            catch { Utils.showToast('Could not delete', 'error'); }
          });
          const label = document.createElement('div');
          label.className = 'drive-file-label'; label.title = f.name; label.textContent = f.name;
          wrapper.appendChild(el); wrapper.appendChild(label);
          grid.appendChild(wrapper);
        }
      });
    } catch (err) {
      Utils.showToast('Failed to load collection', 'error');
      console.error(err);
    }
  }

  function _openCreateCollectionModal() {
    openModal(`
      <h3>New Collection</h3>
      <form id="mf" class="form-block">
        <div class="form-field"><label>Name</label><input name="name" class="input" placeholder="e.g. Summer 2025…" required /></div>
        <div class="form-field"><label>Description (optional)</label><input name="description" class="input" /></div>
        <div class="form-field">
          <label>Share with</label>
          <select name="sharing" class="select-sm" style="width:100%">
            <option value="friends">Friends</option>
            <option value="circles">My circles</option>
            <option value="everyone">Anyone with link</option>
            <option value="select">Specific people</option>
          </select>
        </div>
        <label style="display:flex;align-items:center;gap:.5rem;font-size:.875rem;cursor:pointer">
          <input type="checkbox" name="allowCopying" checked /> Allow others to copy files
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Create</button>
        </div>
      </form>
    `);
    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('mf').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      Utils.showLoading();
      try {
        const coll = await Data.createCollection(fd.get('name'), fd.get('description'), fd.get('sharing'), !!fd.get('allowCopying'));
        closeModal();
        navigate('collection-detail', { folderId: coll.folderId });
        Utils.showToast('Collection created!');
      } catch { Utils.showToast('Failed to create collection', 'error'); }
      finally   { Utils.hideLoading(); }
    });
  }

  function _openShareModal(folderId, coll) {
    openModal(`
      <h3>Share "${Utils.escapeHtml(coll.name)}"</h3>
      <form id="mf" class="form-block">
        <div class="form-field">
          <label>Email addresses (comma-separated)</label>
          <textarea name="emails" class="input" rows="3" placeholder="friend@example.com, another@example.com"></textarea>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Share</button>
        </div>
      </form>
    `);
    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('mf').addEventListener('submit', async e => {
      e.preventDefault();
      const emails = new FormData(e.target).get('emails').split(',').map(s => s.trim()).filter(Boolean);
      if (!emails.length) return;
      Utils.showLoading();
      try {
        await Data.shareCollection(folderId, emails);
        closeModal(); Utils.showToast('Shared!');
      } catch { Utils.showToast('Failed to share', 'error'); }
      finally   { Utils.hideLoading(); }
    });
  }

  function _openEditCollectionModal(folderId, coll) {
    openModal(`
      <h3>Edit Collection</h3>
      <form id="mf" class="form-block">
        <div class="form-field"><label>Name</label><input name="name" class="input" value="${Utils.escapeHtml(coll.name)}" required /></div>
        <div class="form-field"><label>Description</label><input name="description" class="input" value="${Utils.escapeHtml(coll.description || '')}" /></div>
        <div class="form-field">
          <label>Share with</label>
          <select name="sharing" class="select-sm" style="width:100%">
            <option value="friends"  ${coll.sharing === 'friends'  ? 'selected' : ''}>Friends</option>
            <option value="circles"  ${coll.sharing === 'circles'  ? 'selected' : ''}>My circles</option>
            <option value="everyone" ${coll.sharing === 'everyone' ? 'selected' : ''}>Anyone with link</option>
            <option value="select"   ${coll.sharing === 'select'   ? 'selected' : ''}>Specific people</option>
          </select>
        </div>
        <label style="display:flex;align-items:center;gap:.5rem;font-size:.875rem;cursor:pointer">
          <input type="checkbox" name="allowCopying" ${coll.allowCopying ? 'checked' : ''} /> Allow others to copy files
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Save</button>
        </div>
      </form>
    `);
    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('mf').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      Utils.showLoading();
      try {
        await Data.updateCollectionMeta(folderId, {
          name:         fd.get('name'),
          description:  fd.get('description'),
          sharing:      fd.get('sharing'),
          allowCopying: !!fd.get('allowCopying')
        });
        closeModal();
        _renderCollections();
        Utils.showToast('Collection updated!');
      } catch { Utils.showToast('Failed to update collection', 'error'); }
      finally   { Utils.hideLoading(); }
    });
  }

  function _openInviteCollaboratorModal(folderId) {
    openModal(`
      <h3>Invite a Collaborator</h3>
      <p class="muted-text small">Collaborators can upload files to this collection.</p>
      <form id="collab-form" class="form-block">
        <div class="form-field">
          <label>Email address</label>
          <input type="email" id="collab-email" class="input" placeholder="friend@example.com" required autocomplete="email" />
        </div>
        <p id="collab-status" class="muted-text small" aria-live="polite"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Invite</button>
        </div>
      </form>
    `);
    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('collab-form').addEventListener('submit', async e => {
      e.preventDefault();
      const email  = document.getElementById('collab-email').value.trim();
      const status = document.getElementById('collab-status');
      const btn    = e.target.querySelector('[type="submit"]');
      if (!email) return;
      btn.disabled = true; btn.textContent = 'Inviting…';
      try {
        await Data.inviteCollaborator(folderId, email);
        Utils.showToast(`${email} can now upload to this collection`);
        closeModal();
      } catch {
        status.textContent = 'Could not invite collaborator.';
        btn.disabled = false; btn.textContent = 'Invite';
      }
    });
  }

  /* ── New Post ────────────────────────────────── */

  /* ── Friends ─────────────────────────────────── */

  async function _renderFriends() {
    _on('add-friend-btn', 'click', _addFriend);
    _on('add-friend-email', 'keydown', e => { if (e.key === 'Enter') _addFriend(); });
    _on('add-friend-name',  'keydown', e => { if (e.key === 'Enter') _addFriend(); });

    try {
      const [friends, blocked] = await Promise.all([Data.getFriends(), Data.getBlocked()]);
      document.getElementById('friends-count').textContent = friends.length;
      _renderFriendsList(friends);
      _renderBlockedList(blocked);
    } catch { Utils.showToast('Failed to load friends', 'error'); }
  }

  function _renderFriendsList(friends) {
    const list  = document.getElementById('friends-list');
    const empty = document.getElementById('friends-empty');
    list.innerHTML = '';
    empty.hidden = !!friends.length;
    friends.forEach(f => {
      const isPending  = f.status === 'pending_sent';
      const timeLabel  = f.addedAt ? Utils.formatRelativeTime(f.addedAt) : '';
      const statusBadge = isPending
        ? `<span class="status-badge status-badge--pending">Request sent</span>`
        : '';
      const avatarHtml = f.picture
        ? `<img src="${Utils.escapeHtml(f.picture)}" alt="" class="avatar-sm avatar-sm-img" />`
        : `<div class="avatar-sm">${(f.displayName || f.email)[0].toUpperCase()}</div>`;
      const row = _el(`
        <div class="person-row${!isPending ? ' person-row--clickable' : ''}">
          ${avatarHtml}
          <div class="person-info">
            <div class="person-name">${Utils.escapeHtml(f.displayName || f.email)} ${statusBadge}</div>
            <div class="person-email">${Utils.escapeHtml(f.email)}${timeLabel ? ` <span style="opacity:.55">· ${timeLabel}</span>` : ''}</div>
          </div>
          <div class="person-actions">
            ${!isPending ? `<button class="btn btn-ghost btn-sm" data-action="posts">Posts</button><button class="btn btn-ghost btn-sm" data-action="block">Block</button>` : ''}
            <button class="btn btn-ghost btn-sm danger-btn" data-action="remove">${isPending ? 'Cancel' : 'Remove'}</button>
          </div>
        </div>
      `);
      if (!isPending) {
        row.querySelector('[data-action="posts"]').addEventListener('click', e => {
          e.stopPropagation(); _openFriendPostsModal(f);
        });
        row.addEventListener('click', () => _openFriendPostsModal(f));
      }
      row.querySelector('[data-action="remove"]').addEventListener('click', async e => {
        e.stopPropagation(); await Data.removeFriend(f.email); _renderFriends();
      });
      row.querySelector('[data-action="block"]')?.addEventListener('click', async e => {
        e.stopPropagation();
        await Data.blockUser(f.email); await Data.removeFriend(f.email);
        _renderFriends(); Utils.showToast(`${f.email} blocked`);
      });
      list.appendChild(row);
    });
  }

  async function _openFriendPostsModal(friend) {
    const name = friend.displayName || friend.email;
    openModal(`
      <h3>${Utils.escapeHtml(name)}'s Posts</h3>
      <div id="fp-list" class="feed-list" style="max-height:60vh;overflow-y:auto;margin-top:.75rem">
        <p class="muted-text">Loading…</p>
      </div>
    `);
    try {
      const sharedFolders = await Data.getFeedFolders();
      const theirs = sharedFolders.filter(f => f.owners?.[0]?.emailAddress === friend.email);
      const list = document.getElementById('fp-list');
      if (!list) return;
      list.innerHTML = '';
      if (!theirs.length) { list.innerHTML = '<p class="muted-text">No public posts yet.</p>'; return; }

      for (const folder of theirs.slice(0, 30)) {
        try {
          const files = await Drive.listFiles(folder.id);
          const media = files.filter(f => f.mimeType?.startsWith('image/') || f.mimeType?.startsWith('video/'));
          const cover = media[0];
          const timeStr = Utils.formatRelativeTime(folder.sharedWithMeTime || folder.createdTime);
          const card = _el(`
            <div class="feed-album-card${!cover ? ' feed-album-card--text' : ''}">
              ${cover ? `<div class="feed-album-cover"><img src="" alt="" loading="lazy" /></div>` : ''}
              <div class="feed-album-meta">
                <div class="feed-album-byline">
                  <span class="feed-album-time">${timeStr}</span>
                  ${media.length > 1 ? `<span class="feed-album-dot">·</span><span>${media.length} photos</span>` : ''}
                </div>
              </div>
            </div>
          `);
          if (cover) {
            _loadThumbnail(card.querySelector('img'), cover.id, cover.thumbnailLink);
            card.style.cursor = 'pointer';
            card.addEventListener('click', () => openLightbox(cover.id, folder.id, { canCopy: true, thumbnailLink: cover.thumbnailLink }));
          }
          list.appendChild(card);
        } catch {}
      }
    } catch {
      const list = document.getElementById('fp-list');
      if (list) list.innerHTML = '<p class="muted-text">Could not load posts.</p>';
    }
  }

  function _renderBlockedList(blocked) {
    const list  = document.getElementById('blocked-list');
    const empty = document.getElementById('blocked-empty');
    list.innerHTML = '';
    empty.hidden = !!blocked.length;
    blocked.forEach(b => {
      const row = _el(`
        <div class="person-row">
          <div class="avatar-sm">✕</div>
          <div class="person-info"><div class="person-name">${Utils.escapeHtml(b.email)}</div></div>
          <div class="person-actions">
            <button class="btn btn-ghost btn-sm">Unblock</button>
          </div>
        </div>
      `);
      row.querySelector('button').addEventListener('click', async () => {
        await Data.unblockUser(b.email); _renderFriends();
      });
      list.appendChild(row);
    });
  }

  async function _addFriend() {
    const emailInput = document.getElementById('add-friend-email');
    const email = emailInput.value.trim();
    if (!email || !email.includes('@')) { Utils.showToast('Enter a valid email', 'error'); return; }
    try {
      await Data.sendFriendRequest(email);
      emailInput.value = '';
      _renderFriends();
      Utils.showToast(`Friend request sent to ${email}!`);
    } catch { Utils.showToast('Failed to send friend request', 'error'); }
  }

  async function _renderContactSuggestions(friends) {
    const block = document.getElementById('friend-suggestions-block');
    const list  = document.getElementById('friend-suggestions-list');
    block.hidden = true;
    try {
      const contacts = await Drive.getContacts();
      const me = Auth.getCurrentUser();
      const skip = new Set([me?.email?.toLowerCase(), ...friends.map(f => f.email.toLowerCase())]);
      const suggestions = contacts.filter(c => !skip.has(c.email.toLowerCase())).slice(0, 8);
      if (!suggestions.length) return;
      list.innerHTML = '';
      suggestions.forEach(c => {
        const row = _el(`
          <div class="person-row">
            <div class="avatar-sm">${(c.name || c.email)[0].toUpperCase()}</div>
            <div class="person-info">
              <div class="person-name">${Utils.escapeHtml(c.name || c.email)}</div>
              <div class="person-email">${Utils.escapeHtml(c.email)}</div>
            </div>
            <div class="person-actions">
              <button class="btn btn-primary btn-sm">Add</button>
            </div>
          </div>
        `);
        row.querySelector('button').addEventListener('click', async () => {
          await Data.sendFriendRequest(c.email);
          _renderFriends();
          Utils.showToast(`Friend request sent to ${c.email}!`);
        });
        list.appendChild(row);
      });
      block.hidden = false;
    } catch { /* contacts permission not granted or unavailable — skip silently */ }
  }

  /* ── Profile ─────────────────────────────────── */

  async function _renderProfile() {
    _on('edit-profile-btn',    'click', () => _openProfileEdit());
    _on('cancel-profile-btn',  'click', _closeProfileEdit);

    try {
      const profile = await Data.getProfile();
      const user    = Auth.getCurrentUser();

      document.getElementById('profile-display-name').textContent = profile.displayName || user?.name || '—';
      document.getElementById('profile-handle').textContent = profile.handle ? `@${profile.handle}` : '@—';
      document.getElementById('profile-bio').textContent   = profile.bio || '';

      const avatar = document.getElementById('profile-avatar');
      if (profile.avatarFileId) {
        const img = document.createElement('img');
        img.alt = '';
        _loadThumbnail(img, profile.avatarFileId, null);
        avatar.innerHTML = '';
        avatar.appendChild(img);
      } else if (user?.picture) {
        avatar.innerHTML = `<img src="${Utils.escapeHtml(user.picture)}" alt="" />`;
      } else {
        avatar.textContent = (profile.displayName || user?.name || '?')[0].toUpperCase();
      }

      // Load stats and posts asynchronously so the profile card renders immediately
      _renderProfileStats();
      _renderProfilePosts();
      _renderProfileShareButton();
    } catch { Utils.showToast('Failed to load profile', 'error'); }
  }

  function _renderProfileShareButton() {
    // Insert or replace "Share your profile" button below profile stats
    let shareBtn = document.getElementById('profile-share-btn');
    if (!shareBtn) {
      shareBtn = _el(`<button id="profile-share-btn" class="btn btn-ghost btn-sm" style="margin-bottom:1rem">🔗 Share your profile</button>`);
      const statsEl = document.getElementById('profile-stats');
      if (statsEl) statsEl.insertAdjacentElement('afterend', shareBtn);
      else {
        const section = document.getElementById('profile-posts-section');
        if (section) section.parentElement.insertBefore(shareBtn, section);
      }
    }
    // Replace listener
    const fresh = shareBtn.cloneNode(true);
    shareBtn.parentNode.replaceChild(fresh, shareBtn);
    fresh.addEventListener('click', _openProfileShareModal);
  }

  function _openProfileShareModal() {
    openModal(`
      <h3>Share Your Profile</h3>
      <p class="muted-text small">Make your collections visible publicly so anyone can view your profile link.</p>
      <div id="profile-share-url" class="profile-share-url" hidden></div>
      <p id="profile-share-status" class="muted-text small" aria-live="polite"></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost btn-sm modal-cancel-btn">Cancel</button>
        <button type="button" class="btn btn-primary btn-sm" id="profile-make-public-btn">Make Public &amp; Get Link</button>
      </div>
    `);
    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('profile-make-public-btn').addEventListener('click', async () => {
      const btn    = document.getElementById('profile-make-public-btn');
      const status = document.getElementById('profile-share-status');
      const urlBox = document.getElementById('profile-share-url');
      btn.disabled = true; btn.textContent = 'Working…';
      try {
        const url = await Data.makeProfilePublic();
        urlBox.textContent = url;
        urlBox.hidden = false;
        status.textContent = 'Anyone with this link can view your public collections.';
        // Copy to clipboard
        navigator.clipboard?.writeText(url).then(() => Utils.showToast('Link copied!')).catch(() => {});
        btn.textContent = 'Link copied!';
      } catch {
        status.textContent = 'Could not make profile public.';
        btn.disabled = false; btn.textContent = 'Make Public & Get Link';
      }
    });
  }

  async function _renderProfileStats() {
    // Inject (or update) a stats row just below the profile card
    let statsEl = document.getElementById('profile-stats');
    if (!statsEl) {
      statsEl = document.createElement('div');
      statsEl.id = 'profile-stats';
      statsEl.className = 'profile-stats-row';
      const profileView = document.getElementById('profile-view');
      profileView.insertAdjacentElement('afterend', statsEl);
    }
    statsEl.innerHTML = '<span class="muted-text small">Loading…</span>';

    try {
      const [circles, colls, friends, posts] = await Promise.all([
        Data.listCircles(),
        Data.listCollections(),
        Data.getFriends(),
        Data.listOwnPosts()
      ]);
      const nonPostColls = colls.filter(c => !c.isPost);
      statsEl.innerHTML = `
        <div class="profile-stat"><span class="profile-stat-n">${circles.length}</span><span class="profile-stat-l">Circles</span></div>
        <div class="profile-stat"><span class="profile-stat-n">${nonPostColls.length}</span><span class="profile-stat-l">Collections</span></div>
        <div class="profile-stat"><span class="profile-stat-n">${posts.length}</span><span class="profile-stat-l">Posts</span></div>
        <div class="profile-stat"><span class="profile-stat-n">${friends.length}</span><span class="profile-stat-l">Friends</span></div>
      `;
    } catch {
      statsEl.innerHTML = '';
    }
  }

  async function _renderProfilePosts() {
    const grid  = document.getElementById('profile-posts-grid');
    const empty = document.getElementById('profile-posts-empty');
    if (!grid) return;
    grid.innerHTML = '<p class="muted-text small">Loading…</p>';
    empty.hidden = true;

    try {
      const posts = await Data.listOwnPosts();
      grid.innerHTML = '';
      if (!posts.length) { empty.hidden = false; return; }

      posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      posts.forEach(post => {
        const card = _el(`
          <div class="profile-post-card">
            <div class="profile-post-thumb"></div>
            ${post.caption ? `<div class="profile-post-caption">${Utils.escapeHtml(post.caption.length > 60 ? post.caption.slice(0, 60) + '…' : post.caption)}</div>` : ''}
            <div class="profile-post-actions">
              <span class="profile-post-time muted-text small">${Utils.formatRelativeTime(post.createdAt)}</span>
              <button class="btn btn-ghost btn-sm danger-btn profile-post-del">Delete</button>
            </div>
          </div>
        `);

        _loadCardCover(post.folderId, card.querySelector('.profile-post-thumb'));

        card.querySelector('.profile-post-del').addEventListener('click', async e => {
          e.stopPropagation();
          if (!confirm('Delete this post? This cannot be undone.')) return;
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            await Data.deleteCollection(post.folderId);
            card.remove();
            Utils.showToast('Post deleted');
            if (!grid.children.length) empty.hidden = false;
            // Also refresh stats
            _renderProfileStats();
          } catch { Utils.showToast('Could not delete post', 'error'); btn.disabled = false; }
        });

        grid.appendChild(card);
      });
    } catch {
      grid.innerHTML = '';
      Utils.showToast('Could not load posts', 'error');
    }
  }

  async function _openProfileEdit() {
    const profile = await Data.getProfile();
    const user    = Auth.getCurrentUser();
    document.getElementById('profile-view').style.display = 'none';
    const form = document.getElementById('profile-form');
    form.hidden = false;
    form.elements.displayName.value = profile.displayName || '';
    form.elements.handle.value      = profile.handle || '';
    form.elements.bio.value         = profile.bio || '';

    // Avatar upload area — inject above form fields if not already there
    let avatarEditEl = form.querySelector('.profile-avatar-edit');
    if (!avatarEditEl) {
      avatarEditEl = _el(`
        <div class="profile-avatar-edit">
          <div class="avatar-edit-preview" id="avatar-edit-preview">
            ${user?.picture ? `<img src="${Utils.escapeHtml(user.picture)}" alt="" />` : (profile.displayName || user?.name || '?')[0].toUpperCase()}
          </div>
          <div>
            <button type="button" class="btn btn-ghost btn-sm" id="avatar-upload-trigger">Change photo</button>
            <input type="file" id="avatar-file-input" accept="image/*" hidden />
            <p class="muted-text small" id="avatar-upload-status"></p>
          </div>
        </div>
      `);
      form.insertBefore(avatarEditEl, form.firstElementChild);

      // Load custom avatar if set
      if (profile.avatarFileId) {
        const previewEl = form.querySelector('#avatar-edit-preview');
        const img = document.createElement('img');
        img.alt = '';
        _loadThumbnail(img, profile.avatarFileId, null);
        previewEl.innerHTML = '';
        previewEl.appendChild(img);
      }

      document.getElementById('avatar-upload-trigger').addEventListener('click', () => {
        document.getElementById('avatar-file-input').click();
      });
      document.getElementById('avatar-file-input').addEventListener('change', async () => {
        const file = document.getElementById('avatar-file-input').files[0];
        if (!file) return;
        const statusEl = document.getElementById('avatar-upload-status');
        const triggerBtn = document.getElementById('avatar-upload-trigger');
        triggerBtn.disabled = true;
        statusEl.textContent = 'Uploading…';
        try {
          const fileId = await Data.uploadAvatar(file);
          await Data.saveProfile({ ...profile, avatarFileId: fileId });
          // Update preview
          const previewEl = form.querySelector('#avatar-edit-preview');
          const img = document.createElement('img');
          img.alt = ''; img.src = URL.createObjectURL(file);
          previewEl.innerHTML = '';
          previewEl.appendChild(img);
          statusEl.textContent = 'Photo updated!';
          profile.avatarFileId = fileId;
          Utils.showToast('Avatar updated!');
        } catch { statusEl.textContent = 'Upload failed.'; }
        finally { triggerBtn.disabled = false; }
      });
    }

    form.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(form);
      Utils.showLoading();
      try {
        await Data.saveProfile({ displayName: fd.get('displayName'), handle: fd.get('handle'), bio: fd.get('bio'), avatarFileId: profile.avatarFileId || null });
        _closeProfileEdit(); _renderProfile(); Utils.showToast('Profile saved!');
      } catch { Utils.showToast('Failed to save profile', 'error'); }
      finally   { Utils.hideLoading(); }
    };
  }

  function _closeProfileEdit() {
    document.getElementById('profile-view').style.display = '';
    document.getElementById('profile-form').hidden = true;
  }

  /* ── Settings ─────────────────────────────────── */

  async function _renderSettings() {
    Drive.getQuota().then(q => {
      if (!q) return;
      const used  = parseInt(q.usage || 0);
      const limit = parseInt(q.limit || 1);
      const pct   = Math.min(100, Math.round(used / limit * 100));
      document.getElementById('storage-bar-fill').style.width = pct + '%';
      document.getElementById('storage-label').textContent = `${Utils.formatBytes(used)} of ${Utils.formatBytes(limit)} used (${pct}%)`;
    }).catch(() => {});

    Drive.listLargeFiles(5).then(files => {
      const el = document.getElementById('large-files-list');
      el.innerHTML = files.map(f => `
        <div class="large-file-row">
          <span>${Utils.escapeHtml(f.name)}</span>
          <span>${Utils.formatBytes(parseInt(f.size || 0))}</span>
        </div>
      `).join('');
    }).catch(() => {});

    document.querySelectorAll('.theme-pill').forEach(btn => {
      btn.addEventListener('click', async () => {
        Theme.setVisual(btn.dataset.vtheme);
        document.querySelectorAll('.theme-pill').forEach(b => b.classList.toggle('active', b === btn));
        await _saveSettingsFromUI();
      });
    });

    document.querySelectorAll('.color-dot').forEach(btn => {
      btn.addEventListener('click', async () => {
        Theme.setColor(btn.dataset.ctheme);
        document.querySelectorAll('.color-dot').forEach(b => b.classList.toggle('active', b === btn));
        const lbl = document.getElementById('color-theme-label');
        if (lbl) lbl.textContent = Theme.getColorName(btn.dataset.ctheme);
        await _saveSettingsFromUI();
      });
    });

    ['default-sharing', 'allow-copying'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', _saveSettingsFromUI);
    });
  }

  function _syncSettingsUI(settings) {
    document.querySelectorAll('.theme-pill').forEach(b => b.classList.toggle('active', b.dataset.vtheme === settings.theme));
    document.querySelectorAll('.color-dot').forEach(b => b.classList.toggle('active', b.dataset.ctheme === settings.colorTheme));
    const lbl = document.getElementById('color-theme-label');
    if (lbl) lbl.textContent = Theme.getColorName(settings.colorTheme || 'paper');
    const ds = document.getElementById('default-sharing');
    if (ds) ds.value = settings.defaultSharing || 'friends';
    const ac = document.getElementById('allow-copying');
    if (ac) ac.value = settings.allowCopying || 'friends';
  }

  async function _saveSettingsFromUI() {
    const settings = {
      theme:          Theme.getVisual(),
      colorTheme:     Theme.getColor(),
      defaultSharing: document.getElementById('default-sharing')?.value || 'friends',
      allowCopying:   document.getElementById('allow-copying')?.value   || 'friends'
    };
    await Data.saveSettings(settings).catch(() => {});
  }

  /* ── Lightbox ─────────────────────────────────── */

  let _lightboxBlobUrl = null;

  async function openLightbox(fileId, collectionFolderId, opts = {}) {
    const lb  = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    lb.hidden = false;

    // Show thumbnail immediately, then upgrade to full-resolution
    img.src = opts.thumbnailLink || Drive.getThumbnailUrl(fileId, 'w800');
    if (_lightboxBlobUrl) { URL.revokeObjectURL(_lightboxBlobUrl); _lightboxBlobUrl = null; }
    Drive.getFileAsBlob(fileId).then(blobUrl => {
      if (!lb.hidden) { // still open
        _lightboxBlobUrl = blobUrl;
        img.src = blobUrl;
      } else {
        URL.revokeObjectURL(blobUrl);
      }
    }).catch(() => { /* keep thumbnail */ });

    const user     = Auth.getCurrentUser();
    const reactBar = document.getElementById('lightbox-reactions');
    const commArea = document.getElementById('lightbox-comments');
    reactBar.innerHTML = '';
    commArea.innerHTML = '<span class="muted-text small">Loading…</span>';

    // Reactions (multi-type)
    const REACTION_TYPES = [
      { type: 'like', emoji: '❤️' },
      { type: 'laugh', emoji: '😂' },
      { type: 'clap', emoji: '👏' },
      { type: 'wow', emoji: '😮' },
      { type: 'sad', emoji: '😢' }
    ];
    async function refreshReactions() {
      try {
        const r  = await Data.getReactions(collectionFolderId);
        const map = { like: r.likes, laugh: r.laughs, clap: r.claps, wow: r.wows, sad: r.sads };
        reactBar.innerHTML = '';
        REACTION_TYPES.forEach(({ type, emoji }) => {
          const arr    = map[type] || [];
          const active = arr.some(l => l.userId === user?.userId);
          const btn = _el(`<button class="react-btn ${active ? 'liked' : ''}">${emoji} ${arr.length}</button>`);
          btn.addEventListener('click', async () => { await Data.toggleReaction(collectionFolderId, type); refreshReactions(); });
          reactBar.appendChild(btn);
        });
        // Seen by
        const seenCount = (r.seenBy || []).length;
        if (seenCount > 0) {
          reactBar.appendChild(_el(`<span class="lightbox-seen-by muted-text small">Seen by ${seenCount}</span>`));
        }
      } catch { reactBar.innerHTML = ''; }
    }
    refreshReactions();

    // Comments
    let _commentsEnabled = true;
    async function refreshComments() {
      try {
        const comments = await Drive.getComments(fileId);
        if (!comments.length) {
          commArea.innerHTML = '<span class="muted-text small">No comments yet.</span>';
          return;
        }
        commArea.innerHTML = '';
        comments.forEach(c => {
          commArea.appendChild(_el(`
            <div class="comment-row">
              <span class="comment-author">${Utils.escapeHtml(c.author?.displayName || 'Someone')}</span>${Utils.escapeHtml(c.content)}
            </div>
          `));
        });
      } catch (err) {
        if (err?.status === 403) {
          _commentsEnabled = false;
          commArea.innerHTML = '<span class="muted-text small">Comments unavailable — owner hasn\'t granted commenter access.</span>';
        } else {
          commArea.innerHTML = '';
        }
      }
    }
    refreshComments();

    // Save to Drive (friends' shared files)
    if (opts.canCopy) {
      const copyBtn = _el(`<button class="btn btn-ghost btn-sm">Save to Drive</button>`);
      copyBtn.addEventListener('click', async () => {
        copyBtn.disabled = true;
        copyBtn.textContent = 'Saving…';
        try {
          const folders = Data.getFolders();
          await Drive.copyFile(fileId, folders.rootId);
          Utils.showToast('Saved to your Drive!');
          copyBtn.textContent = 'Saved ✓';
        } catch {
          Utils.showToast('Could not save file', 'error');
          copyBtn.disabled = false;
          copyBtn.textContent = 'Save to Drive';
        }
      });
      reactBar.appendChild(copyBtn);
    }

    // Delete own file
    if (opts.canDelete) {
      const delBtn = _el(`<button class="btn btn-ghost btn-sm danger-btn">Delete</button>`);
      delBtn.addEventListener('click', async () => {
        if (!confirm('Delete this file?')) return;
        try {
          await Drive.deleteFile(fileId);
          closeLightbox();
          Utils.showToast('File deleted');
          if (_currentPage === 'collection-detail') _renderCollectionDetail(_currentCollFolderId);
          else if (_currentPage === 'circle-detail') _renderCircleDetail(_currentCircleFolderId);
        } catch {
          Utils.showToast('Could not delete file', 'error');
        }
      });
      reactBar.appendChild(delBtn);
    }

    const form  = document.getElementById('lightbox-comment-form');
    const input = document.getElementById('lightbox-comment-input');
    form.onsubmit = async e => {
      e.preventDefault();
      if (!_commentsEnabled) { Utils.showToast('Comments not available for this file', 'error'); return; }
      const text = input.value.trim();
      if (!text) return;
      try {
        await Drive.addComment(fileId, text);
        input.value = '';
        refreshComments();
      } catch (err) {
        if (err?.status === 403) {
          _commentsEnabled = false;
          Utils.showToast('No commenter access on this file', 'error');
        } else {
          Utils.showToast('Failed to post comment', 'error');
        }
      }
    };

    document.getElementById('lightbox-close').onclick    = closeLightbox;
    document.getElementById('lightbox-backdrop').onclick = closeLightbox;
  }

  function closeLightbox() {
    document.getElementById('lightbox').hidden = true;
    document.getElementById('lightbox-img').src = '';
    document.getElementById('lightbox-comment-input').value = '';
    if (_lightboxBlobUrl) { URL.revokeObjectURL(_lightboxBlobUrl); _lightboxBlobUrl = null; }
  }

  /* ── Keyboard shortcuts ──────────────────────── */

  function _setupKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
      // Ignore when typing in inputs
      const tag = (e.target || document.activeElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case 'Escape': {
          if (!document.getElementById('modal-overlay').hidden) { closeModal(); break; }
          if (!document.getElementById('lightbox').hidden) { closeLightbox(); break; }
          const storyOverlay = document.getElementById('story-viewer-overlay');
          if (storyOverlay) { storyOverlay.remove(); break; }
          break;
        }
        case '?': {
          e.preventDefault();
          _showKeyboardShortcutsModal();
          break;
        }
        case 'j':
        case 'ArrowDown': {
          e.preventDefault();
          const cards = Array.from(document.querySelectorAll('.post-card'));
          if (!cards.length) break;
          _focusedPostIndex = Math.min(_focusedPostIndex + 1, cards.length - 1);
          cards[_focusedPostIndex].focus();
          cards[_focusedPostIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
          break;
        }
        case 'k':
        case 'ArrowUp': {
          e.preventDefault();
          const cards = Array.from(document.querySelectorAll('.post-card'));
          if (!cards.length) break;
          _focusedPostIndex = Math.max(_focusedPostIndex - 1, 0);
          cards[_focusedPostIndex].focus();
          cards[_focusedPostIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
          break;
        }
        case 'l': {
          const cards = Array.from(document.querySelectorAll('.post-card'));
          const card  = cards[_focusedPostIndex];
          if (!card) break;
          const albumId = card.dataset.albumId;
          if (!albumId) break;
          Data.toggleReaction(albumId, 'like').then(result => {
            const reactBar = card.querySelector('.post-reactions');
            const btn = reactBar?.querySelector('[data-type="like"]');
            if (btn) {
              btn.querySelector('span').textContent = result.count;
              btn.classList.toggle('reacted', result.reacted);
            }
          }).catch(() => {});
          break;
        }
      }
    });
  }

  function _showKeyboardShortcutsModal() {
    openModal(`
      <h3>Keyboard Shortcuts</h3>
      <div class="shortcuts-list">
        <div class="shortcut-row"><kbd>j</kbd> / <kbd>↓</kbd> <span>Next post</span></div>
        <div class="shortcut-row"><kbd>k</kbd> / <kbd>↑</kbd> <span>Previous post</span></div>
        <div class="shortcut-row"><kbd>l</kbd> <span>Like focused post</span></div>
        <div class="shortcut-row"><kbd>Esc</kbd> <span>Close modal / lightbox</span></div>
        <div class="shortcut-row"><kbd>?</kbd> <span>Show this help</span></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost btn-sm modal-cancel-btn">Close</button>
      </div>
    `);
    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
  }

  /* ── Modal ───────────────────────────────────── */

  function openModal(html) {
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal-overlay').hidden = false;
    document.getElementById('modal-close').onclick = closeModal;
  }

  function closeModal() {
    document.getElementById('modal-overlay').hidden = true;
    document.getElementById('modal-content').innerHTML = '';
  }

  /* ── DOM helpers ─────────────────────────────── */

  function _el(html) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  }

  // Replace event listener each call (prevents duplicate bindings on re-render)
  function _on(id, event, handler) {
    const el = document.getElementById(id);
    if (!el) return;
    const clone = el.cloneNode(true);
    el.parentNode.replaceChild(clone, el);
    clone.addEventListener(event, handler);
  }

  /* ── Public ──────────────────────────────────── */

  return { boot, navigate, openModal, closeModal, openLightbox, closeLightbox };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => UI.boot());
} else {
  UI.boot();
}
