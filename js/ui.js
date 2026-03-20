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
    _navigate(window.location.hash.slice(1) || 'feed');
  }

  function _onSignOut() {
    _showScreen('auth-screen');
    _currentPage = null;
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

  function _wireComposer() {
    // De-duplicate by replacing the submit button node
    const submitBtn = document.getElementById('composer-submit');
    if (!submitBtn) return;
    const freshSubmit = submitBtn.cloneNode(true);
    submitBtn.parentNode.replaceChild(freshSubmit, submitBtn);

    const fileInput   = document.getElementById('composer-files');
    const caption     = document.getElementById('composer-caption');
    const previews    = document.getElementById('composer-previews');
    const sharingEl   = document.getElementById('composer-sharing');

    // De-duplicate file input listener
    const freshFile = fileInput.cloneNode(true);
    fileInput.parentNode.replaceChild(freshFile, fileInput);

    let _selectedFiles = [];

    freshFile.addEventListener('change', () => {
      _selectedFiles = Array.from(freshFile.files);
      previews.innerHTML = '';
      previews.hidden = !_selectedFiles.length;
      _selectedFiles.forEach(f => {
        const url  = URL.createObjectURL(f);
        const wrap = _el(`<div class="composer-preview-item"><img src="${url}" alt="${Utils.escapeHtml(f.name)}" /></div>`);
        previews.appendChild(wrap);
      });
    });

    freshSubmit.addEventListener('click', async () => {
      const text    = caption.value.trim();
      const sharing = sharingEl.value;
      if (!text && !_selectedFiles.length) {
        Utils.showToast('Write something or add a photo first', 'error');
        return;
      }
      freshSubmit.disabled = true;
      freshSubmit.textContent = 'Posting…';
      Utils.showLoading();
      try {
        const post = await Data.createPost(text, sharing);
        if (_selectedFiles.length) {
          await Promise.all(_selectedFiles.map(f => Drive.uploadMedia(f, post.folderId)));
        }
        caption.value = '';
        previews.innerHTML = '';
        previews.hidden = true;
        freshFile.value = '';
        _selectedFiles = [];
        Utils.showToast('Posted!');
        await _renderFeed();
      } catch {
        Utils.showToast('Failed to post', 'error');
      } finally {
        freshSubmit.disabled = false;
        freshSubmit.textContent = 'Post';
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

    // ── Inline post composer ──────────────────────────────
    _wireComposer();

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
      const [sharedFolders, ownPosts] = await Promise.all([
        Data.getFeedFolders(),
        Data.listOwnPosts()
      ]);

      // Build a unified album list
      const allFolders = [
        ...sharedFolders.map(f => ({
          id: f.id,
          name: f.name,
          sharer: f.owners?.[0]?.displayName || 'Friend',
          sharerEmail: f.owners?.[0]?.emailAddress || '',
          sharedAt: f.sharedWithMeTime || f.createdTime,
          _isOwn: false
        })),
        ...ownPosts.map(p => ({
          id: p.folderId,
          name: p.name,
          sharer: 'You',
          sharerEmail: '',
          sharedAt: p.createdAt || new Date().toISOString(),
          caption: p.caption,
          _isOwn: true
        }))
      ];

      // Sort albums newest-shared first
      allFolders.sort((a, b) => new Date(b.sharedAt) - new Date(a.sharedAt));

      // Load files for each album
      _feedAlbums = await Promise.all(allFolders.map(async album => {
        try {
          const files = (await Drive.listFiles(album.id))
            .filter(f => f.mimeType?.startsWith('image/') || f.mimeType?.startsWith('video/'));
          return { ...album, files };
        } catch {
          return { ...album, files: [] };
        }
      }));

      list.innerHTML = '';
      _paintFeedAlbums();
    } catch (err) {
      console.error('Feed load error', err);
      list.innerHTML = '';
      empty.hidden = false;
      empty.querySelector('p').textContent = 'Could not load your feed. Check your connection and try again.';
    }
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
      return;
    }
    empty.hidden = true;

    visible.forEach(album => {
      const cover   = album.files[0];
      const count   = album.files.length;
      const timeStr = Utils.formatRelativeTime(album.sharedAt);

      const coverHtml = cover ? `
        <div class="feed-album-cover">
          <img src="" alt="" loading="lazy" />
          ${count > 1 ? `<span class="feed-album-count">${count} photos</span>` : ''}
        </div>` : '';

      const expandHint = count > 1
        ? `<span class="feed-album-dot">·</span><span class="feed-album-expand-hint">tap to expand</span>` : '';

      const card = _el(`
        <div class="feed-album-card${!cover ? ' feed-album-card--text' : ''}">
          ${coverHtml}
          <div class="feed-album-meta">
            <div class="feed-album-byline">
              <span class="feed-album-sharer">${Utils.escapeHtml(album.sharer)}</span>
              <span class="feed-album-dot">·</span>
              <span class="feed-album-time">${timeStr}</span>
              ${expandHint}
            </div>
            ${album.caption ? `<div class="feed-album-caption">${Utils.escapeHtml(album.caption)}</div>` : ''}
          </div>
        </div>
      `);

      if (cover) _loadThumbnail(card.querySelector('img'), cover.id, cover.thumbnailLink);

      // Expanded grid (hidden by default for multi-photo albums)
      let expanded = false;
      const expandGrid = document.createElement('div');
      expandGrid.className = 'feed-album-grid';
      expandGrid.hidden = true;

      if (count === 1) {
        // Single photo — click card opens lightbox directly
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => openLightbox(cover.id, album.id, {
          canCopy: !album._isOwn, canDelete: album._isOwn, thumbnailLink: cover.thumbnailLink
        }));
      } else if (count > 1) {
        // Multi-photo album — click toggles grid
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => {
          expanded = !expanded;
          expandGrid.hidden = !expanded;
          card.classList.toggle('feed-album-card--open', expanded);
          if (expanded && !expandGrid.dataset.loaded) {
            expandGrid.dataset.loaded = '1';
            album.files.forEach(f => {
              const thumb = _el(`<div class="media-item"><img src="" alt="" loading="lazy" /></div>`);
              _loadThumbnail(thumb.querySelector('img'), f.id, f.thumbnailLink);
              thumb.addEventListener('click', e => {
                e.stopPropagation();
                openLightbox(f.id, album.id, {
                  canCopy: !album._isOwn, canDelete: album._isOwn, thumbnailLink: f.thumbnailLink
                });
              });
              expandGrid.appendChild(thumb);
            });
          }
        });
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'feed-album-wrapper';
      wrapper.appendChild(card);
      wrapper.appendChild(expandGrid);
      list.appendChild(wrapper);
    });
  }

  /* ── My Data ─────────────────────────────────── */

  // Aggregates all media files from the user's own circles and collections.
  // Items are grouped by source with section headings and filterable by type.

  let _myDataItems = []; // cache so filter doesn't re-fetch

  async function _renderMyData() {
    const grid  = document.getElementById('my-data-grid');
    const empty = document.getElementById('my-data-empty');
    grid.innerHTML = '<p class="muted-text" style="grid-column:1/-1">Loading…</p>';
    empty.hidden = true;
    _on('my-data-upload-btn', 'click', _openMyDataUploadModal);

    // Filter pills
    document.querySelectorAll('.filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill').forEach(b => b.classList.toggle('active', b === btn));
        _renderMyDataGrid(btn.dataset.filter);
      });
    });

    try {
      const [circles, colls] = await Promise.all([Data.listCircles(), Data.listCollections()]);
      _myDataItems = [];

      await Promise.all([
        ...circles.map(async c => {
          try {
            const files = await Drive.listFiles(c.folderId);
            files
              .filter(f => f.mimeType?.startsWith('image/') || f.mimeType?.startsWith('video/'))
              .forEach(f => _myDataItems.push({ file: f, source: c.name, type: 'circles', folderId: c.folderId }));
          } catch { /* skip inaccessible circle */ }
        }),
        ...colls.map(async c => {
          try {
            const files = await Drive.listFiles(c.folderId);
            files
              .filter(f => f.mimeType?.startsWith('image/') || f.mimeType?.startsWith('video/'))
              .forEach(f => _myDataItems.push({ file: f, source: c.name, type: 'collections', folderId: c.folderId }));
          } catch { /* skip inaccessible collection */ }
        })
      ]);

      // Reset filter to "all"
      document.querySelectorAll('.filter-pill').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
      _renderMyDataGrid('all');
    } catch (err) {
      console.error('My Data load error', err);
      grid.innerHTML = '';
      empty.hidden = false;
      empty.querySelector('p').textContent = 'Could not load your files. Check your connection and try again.';
    }
  }

  function _renderMyDataGrid(filter) {
    const grid  = document.getElementById('my-data-grid');
    const empty = document.getElementById('my-data-empty');
    const items = filter === 'all' ? _myDataItems : _myDataItems.filter(i => i.type === filter);

    _clearThumbBlobs();
    grid.innerHTML = '';
    if (!items.length) { empty.hidden = false; return; }
    empty.hidden = true;

    // Sort newest first then group by source
    items.sort((a, b) => new Date(b.file.createdTime) - new Date(a.file.createdTime));

    // Group by source name so we can render section headings
    const groups = [];
    const seen = new Map();
    items.forEach(item => {
      const key = `${item.type}:${item.source}`;
      if (!seen.has(key)) { seen.set(key, []); groups.push({ key, label: item.source, type: item.type, items: seen.get(key) }); }
      seen.get(key).push(item);
    });

    groups.forEach(g => {
      const heading = document.createElement('div');
      heading.className = 'my-data-section-heading';
      heading.textContent = `${g.type === 'circles' ? '◎' : '▤'} ${g.label}`;
      grid.appendChild(heading);

      g.items.forEach(({ file, folderId }) => {
        const el = _el(`
          <div class="media-item">
            <img src="" alt="" loading="lazy" />
            <div class="media-overlay">
              <span class="media-time">${Utils.formatRelativeTime(file.createdTime)}</span>
            </div>
          </div>
        `);
        _loadThumbnail(el.querySelector('img'), file.id, file.thumbnailLink);
        el.addEventListener('click', () => openLightbox(file.id, folderId, { canDelete: true, thumbnailLink: file.thumbnailLink }));
        grid.appendChild(el);
      });
    });
  }

  async function _openMyDataUploadModal() {
    // Need circles and collections to present as upload destinations
    let circles = [], colls = [];
    try {
      [circles, colls] = await Promise.all([Data.listCircles(), Data.listCollections()]);
    } catch { Utils.showToast('Could not load destinations', 'error'); return; }

    const destOptions = [
      ...circles.map(c => `<option value="${Utils.escapeHtml(c.folderId)}" data-type="circle">${Utils.escapeHtml(c.name)} (Circle)</option>`),
      ...colls.map(c => `<option value="${Utils.escapeHtml(c.folderId)}" data-type="collection">${Utils.escapeHtml(c.name)} (Collection)</option>`)
    ].join('');

    if (!destOptions) {
      Utils.showToast('Create a circle or collection first', 'error');
      return;
    }

    openModal(`
      <h3>Upload Files</h3>
      <form id="mf" class="form-block">
        <div class="form-field">
          <label>Upload to</label>
          <select name="dest" class="select-sm" style="width:100%" required>${destOptions}</select>
        </div>
        <input type="file" id="up-input" class="input" multiple accept="image/*,video/*" />
        <p id="up-status" class="muted-text small"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Upload</button>
        </div>
      </form>
    `);
    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('mf').addEventListener('submit', async e => {
      e.preventDefault();
      const folderId = new FormData(e.target).get('dest');
      const files    = document.getElementById('up-input').files;
      if (!files.length) return;
      const status = document.getElementById('up-status');
      let done = 0;
      for (const file of files) {
        const v = Utils.validateMediaFile(file);
        if (!v.ok) { Utils.showToast(v.error, 'error'); continue; }
        status.textContent = `Uploading ${file.name}…`;
        try { await Drive.uploadMedia(file, folderId); done++; }
        catch { Utils.showToast(`Failed: ${file.name}`, 'error'); }
      }
      closeModal();
      if (done) { Utils.showToast(`${done} file${done > 1 ? 's' : ''} uploaded`); _renderMyData(); }
    });
  }

  /* ── Circles ─────────────────────────────────── */

  async function _renderCircles() {
    const grid  = document.getElementById('circles-grid');
    const empty = document.getElementById('circles-empty');
    grid.innerHTML = '<p class="muted-text">Loading…</p>';
    empty.hidden = true;
    _on('create-circle-btn', 'click', _openCreateCircleModal);

    try {
      const circles = await Data.listCircles();
      grid.innerHTML = '';
      if (!circles.length) { empty.hidden = false; return; }
      circles.forEach(c => {
        const user = Auth.getCurrentUser();
        const isOwner = c.ownerEmail === user.email;
        const card = _el(`
          <div class="card coll-card">
            <div class="coll-thumb coll-thumb-cover">◎</div>
            <div class="card-body">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem">
                <h4>${Utils.escapeHtml(c.name)}</h4>
                ${isOwner ? `<button class="btn btn-ghost btn-sm card-edit-btn" title="Edit">✎</button>` : ''}
              </div>
              <div class="card-meta">
                <span>${c.members?.length || 0} member${c.members?.length !== 1 ? 's' : ''}</span>
                <span>${c.addPolicy === 'any_member' ? 'Open' : 'Managed'}</span>
              </div>
              ${c.description ? `<p style="font-size:.78rem;color:var(--muted);margin-top:.35rem">${Utils.escapeHtml(c.description)}</p>` : ''}
            </div>
          </div>
        `);
        const thumb = card.querySelector('.coll-thumb-cover');
        _loadCardCover(c.folderId, thumb);
        if (isOwner) {
          card.querySelector('.card-edit-btn').addEventListener('click', e => {
            e.stopPropagation();
            _openEditCircleModal(c.folderId, c);
          });
        }
        card.addEventListener('click', () => navigate('circle-detail', { folderId: c.folderId }));
        grid.appendChild(card);
      });
    } catch {
      grid.innerHTML = '';
      Utils.showToast('Failed to load circles', 'error');
    }
  }

  async function _renderCircleDetail(folderId) {
    if (!folderId) { navigate('circles'); return; }
    document.getElementById('circle-detail-name').textContent = '…';
    document.getElementById('circle-members-strip').innerHTML = '';
    document.getElementById('circle-detail-grid').innerHTML = '<p class="muted-text">Loading…</p>';
    document.getElementById('circle-detail-empty').hidden = true;
    document.getElementById('circle-detail-actions').innerHTML = '';

    try {
      const circle = await Data.getCircle(folderId);
      document.getElementById('circle-detail-name').textContent = circle.name;

      const user    = Auth.getCurrentUser();
      const isOwner = circle.ownerEmail === user.email;

      const strip = document.getElementById('circle-members-strip');
      (circle.members || []).forEach(m => {
        const canRemove = isOwner && m.email !== user.email;
        const chip = _el(`
          <span class="member-chip">
            ${Utils.escapeHtml(m.displayName || m.email)}
            ${canRemove ? `<button class="chip-remove" title="Remove member">×</button>` : ''}
          </span>
        `);
        if (canRemove) {
          chip.querySelector('.chip-remove').addEventListener('click', async e => {
            e.stopPropagation();
            const label = m.displayName || m.email;
            if (!confirm(`Remove ${label} from this circle?`)) return;
            try {
              await Data.removeMemberFromCircle(folderId, m.email);
              _renderCircleDetail(folderId);
              Utils.showToast(`${label} removed`);
            } catch { Utils.showToast('Could not remove member', 'error'); }
          });
        }
        strip.appendChild(chip);
      });
      const canAdd  = isOwner || circle.addPolicy === 'any_member';
      const actions = document.getElementById('circle-detail-actions');

      if (canAdd) {
        const addBtn = _el(`<button class="btn btn-ghost btn-sm">+ Add Member</button>`);
        addBtn.addEventListener('click', () => _openAddMemberModal(folderId, circle));
        actions.appendChild(addBtn);
      }

      const upBtn = _el(`<button class="btn btn-primary btn-sm">Upload</button>`);
      upBtn.addEventListener('click', () => _openUploadModal(folderId));
      actions.appendChild(upBtn);

      if (isOwner) {
        const delBtn = _el(`<button class="btn btn-ghost btn-sm danger-btn">Delete</button>`);
        delBtn.addEventListener('click', async () => {
          if (!confirm(`Delete circle "${circle.name}"?`)) return;
          await Data.deleteCircle(folderId);
          navigate('circles');
          Utils.showToast('Circle deleted');
        });
        actions.appendChild(delBtn);
      }

      const files = await Drive.listFiles(folderId);
      const media = files.filter(f => f.mimeType?.startsWith('image/') || f.mimeType?.startsWith('video/'));
      const grid  = document.getElementById('circle-detail-grid');
      grid.innerHTML = '';

      if (!media.length) { document.getElementById('circle-detail-empty').hidden = false; return; }

      media.forEach(f => {
        const el = _el(`<div class="media-item"><img src="" alt="" loading="lazy" /></div>`);
        _loadThumbnail(el.querySelector('img'), f.id, f.thumbnailLink);
        el.addEventListener('click', () => openLightbox(f.id, folderId, { canDelete: isOwner, thumbnailLink: f.thumbnailLink }));
        grid.appendChild(el);
      });
    } catch (err) {
      Utils.showToast('Failed to load circle', 'error');
      console.error(err);
    }
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

  function _openAddMemberModal(folderId, circle) {
    openModal(`
      <h3>Add Member to ${Utils.escapeHtml(circle.name)}</h3>
      <form id="mf" class="form-block">
        <div class="form-field"><label>Email</label><input name="email" type="email" class="input" required /></div>
        <div class="form-field"><label>Display name (optional)</label><input name="displayName" class="input" /></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Add</button>
        </div>
      </form>
    `);
    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
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

      const delBtn = _el(`<button class="btn btn-ghost btn-sm danger-btn">Delete</button>`);
      delBtn.addEventListener('click', async () => {
        if (!confirm(`Delete collection "${coll.name}"?`)) return;
        await Data.deleteCollection(folderId);
        navigate('collections');
        Utils.showToast('Collection deleted');
      });
      actions.appendChild(delBtn);

      const files = await Drive.listFiles(folderId);
      const media = files.filter(f => f.mimeType?.startsWith('image/') || f.mimeType?.startsWith('video/'));
      const grid  = document.getElementById('collection-detail-grid');
      grid.innerHTML = '';

      if (!media.length) {
        grid.innerHTML = '<div class="empty-state"><p>No files yet. Upload something!</p></div>';
        return;
      }

      media.forEach(f => {
        const el = _el(`<div class="media-item"><img src="" alt="" loading="lazy" /></div>`);
        _loadThumbnail(el.querySelector('img'), f.id, f.thumbnailLink);
        el.addEventListener('click', () => openLightbox(f.id, folderId, { canDelete: true, thumbnailLink: f.thumbnailLink }));
        grid.appendChild(el);
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

  /* ── New Post ────────────────────────────────── */

  function _openNewPostModal() {
    openModal(`
      <h3>New Post</h3>
      <form id="mf" class="form-block">
        <div class="form-field">
          <label>Photo or Video</label>
          <input type="file" id="post-file-input" class="input" accept="image/*,video/*" required />
        </div>
        <div class="form-field">
          <label>Caption <span class="muted-text">(optional)</span></label>
          <textarea name="caption" class="input" rows="3" placeholder="What's on your mind?"></textarea>
        </div>
        <div class="form-field">
          <label>Share with</label>
          <select name="sharing" class="select-sm" style="width:100%">
            <option value="friends">Friends</option>
            <option value="everyone">Anyone with link (Public)</option>
          </select>
        </div>
        <p id="post-status" class="muted-text small"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Post</button>
        </div>
      </form>
    `);
    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('mf').addEventListener('submit', async e => {
      e.preventDefault();
      const fd     = new FormData(e.target);
      const file   = document.getElementById('post-file-input').files[0];
      if (!file) return;
      const v = Utils.validateMediaFile(file);
      if (!v.ok) { Utils.showToast(v.error, 'error'); return; }
      const status = document.getElementById('post-status');
      status.textContent = 'Creating post…';
      Utils.showLoading();
      try {
        const post = await Data.createPost(fd.get('caption') || '', fd.get('sharing'));
        status.textContent = 'Uploading…';
        await Drive.uploadMedia(file, post.folderId);
        closeModal();
        Utils.showToast('Posted!');
        _renderFeed();
      } catch {
        Utils.showToast('Failed to post', 'error');
        status.textContent = '';
      } finally {
        Utils.hideLoading();
      }
    });
  }

  /* ── Upload ─────────────────────────────────── */

  function _openUploadModal(folderId) {
    openModal(`
      <h3>Upload Files</h3>
      <form id="mf" class="form-block">
        <input type="file" id="up-input" class="input" multiple accept="image/*,video/*" />
        <p id="up-status" class="muted-text small"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Upload</button>
        </div>
      </form>
    `);
    document.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('mf').addEventListener('submit', async e => {
      e.preventDefault();
      const files = document.getElementById('up-input').files;
      if (!files.length) return;
      const status = document.getElementById('up-status');
      let done = 0;
      for (const file of files) {
        const v = Utils.validateMediaFile(file);
        if (!v.ok) { Utils.showToast(v.error, 'error'); continue; }
        status.textContent = `Uploading ${file.name}…`;
        try {
          await Drive.uploadMedia(file, folderId);
          done++;
        } catch { Utils.showToast(`Failed: ${file.name}`, 'error'); }
      }
      closeModal();
      if (done) {
        Utils.showToast(`${done} file${done > 1 ? 's' : ''} uploaded`);
        if (_currentPage === 'circle-detail')     _renderCircleDetail(_currentCircleFolderId);
        else if (_currentPage === 'collection-detail') _renderCollectionDetail(_currentCollFolderId);
      }
    });
  }

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
      _renderContactSuggestions(friends);
    } catch { Utils.showToast('Failed to load friends', 'error'); }
  }

  function _renderFriendsList(friends) {
    const list  = document.getElementById('friends-list');
    const empty = document.getElementById('friends-empty');
    list.innerHTML = '';
    empty.hidden = !!friends.length;
    friends.forEach(f => {
      const addedLabel = f.addedAt ? Utils.formatRelativeTime(f.addedAt) : '';
      const row = _el(`
        <div class="person-row">
          <div class="avatar-sm">${(f.displayName || f.email)[0].toUpperCase()}</div>
          <div class="person-info">
            <div class="person-name">${Utils.escapeHtml(f.displayName || f.email)}</div>
            <div class="person-email">${Utils.escapeHtml(f.email)}${addedLabel ? ` <span style="opacity:.55">· added ${addedLabel}</span>` : ''}</div>
          </div>
          <div class="person-actions">
            <button class="btn btn-ghost btn-sm" data-action="block">Block</button>
            <button class="btn btn-ghost btn-sm danger-btn" data-action="remove">Remove</button>
          </div>
        </div>
      `);
      row.querySelector('[data-action="remove"]').addEventListener('click', async () => {
        await Data.removeFriend(f.email); _renderFriends();
      });
      row.querySelector('[data-action="block"]').addEventListener('click', async () => {
        await Data.blockUser(f.email); await Data.removeFriend(f.email);
        _renderFriends(); Utils.showToast(`${f.email} blocked`);
      });
      list.appendChild(row);
    });
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
    const nameInput  = document.getElementById('add-friend-name');
    const email = emailInput.value.trim();
    const name  = nameInput?.value.trim() || '';
    if (!email || !email.includes('@')) { Utils.showToast('Enter a valid email', 'error'); return; }
    try {
      await Data.addFriend(email, name);
      emailInput.value = '';
      if (nameInput) nameInput.value = '';
      _renderFriends();
      Utils.showToast(`${name || email} added!`);
    } catch { Utils.showToast('Failed to add friend', 'error'); }
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
          await Data.addFriend(c.email, c.name || '');
          _renderFriends();
          Utils.showToast(`${c.name || c.email} added!`);
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
      if (user?.picture) {
        avatar.innerHTML = `<img src="${Utils.escapeHtml(user.picture)}" alt="" />`;
      } else {
        avatar.textContent = (profile.displayName || user?.name || '?')[0].toUpperCase();
      }

      // Load stats asynchronously so the profile card renders immediately
      _renderProfileStats();
    } catch { Utils.showToast('Failed to load profile', 'error'); }
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

  async function _openProfileEdit() {
    const profile = await Data.getProfile();
    document.getElementById('profile-view').style.display = 'none';
    const form = document.getElementById('profile-form');
    form.hidden = false;
    form.elements.displayName.value = profile.displayName || '';
    form.elements.handle.value      = profile.handle || '';
    form.elements.bio.value         = profile.bio || '';
    form.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(form);
      Utils.showLoading();
      try {
        await Data.saveProfile({ displayName: fd.get('displayName'), handle: fd.get('handle'), bio: fd.get('bio') });
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

    // Reactions
    async function refreshReactions() {
      try {
        const r     = await Data.getReactions(collectionFolderId);
        const liked = r.likes.some(l => l.userId === user.userId);
        reactBar.innerHTML = '';
        const likeBtn = _el(`<button class="react-btn ${liked ? 'liked' : ''}">♥ ${r.likes.length}</button>`);
        likeBtn.addEventListener('click', async () => { await Data.toggleLike(collectionFolderId); refreshReactions(); });
        reactBar.appendChild(likeBtn);
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
