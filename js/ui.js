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
    feed: 'Feed', circles: 'My Circles', 'circle-detail': 'Circle',
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
    if (el) el.style.display = 'block';
  }

  /* ── Feed ───────────────────────────────────── */

  async function _renderFeed() {
    const grid  = document.getElementById('feed-grid');
    const empty = document.getElementById('feed-empty');
    grid.innerHTML = '<p class="muted-text" style="grid-column:1/-1">Loading…</p>';
    empty.hidden = true;

    try {
      const sharedFolders = await Data.getFeedFolders();
      grid.innerHTML = '';

      if (!sharedFolders.length) {
        empty.hidden = false;
        empty.querySelector('p').textContent = 'Your feed is empty. Add friends and ask them to share collections with you.';
        return;
      }

      const items = [];
      await Promise.all(sharedFolders.map(async folder => {
        try {
          const files = await Drive.listFiles(folder.id);
          files.filter(f => f.mimeType?.startsWith('image/') || f.mimeType?.startsWith('video/')).forEach(f => {
            items.push({ file: f, folder, owner: folder.owners?.[0] });
          });
        } catch (err) {
          console.warn('Feed: could not load folder', folder.id, err);
        }
      }));

      if (!items.length) { empty.hidden = false; return; }

      // Newest first
      items.sort((a, b) => new Date(b.file.createdTime) - new Date(a.file.createdTime));

      items.forEach(({ file, folder, owner }) => {
        const el = _el(`
          <div class="media-item">
            <img src="${Drive.getMediaUrl(file.id)}" alt="" loading="lazy" />
            <div class="media-overlay">
              <span>${Utils.escapeHtml(owner?.displayName || 'Friend')}</span>
              <span class="media-time">${Utils.formatRelativeTime(file.createdTime)}</span>
            </div>
          </div>
        `);
        el.addEventListener('click', () => openLightbox(file.id, folder.id, { canCopy: true }));
        grid.appendChild(el);
      });
    } catch (err) {
      console.error('Feed load error', err);
      grid.innerHTML = '';
      empty.hidden = false;
      empty.querySelector('p').textContent = 'Could not load your feed. Check your connection and try again.';
    }
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
        const card = _el(`
          <div class="card coll-card">
            <div class="coll-thumb" style="font-size:2.5rem">◎</div>
            <div class="card-body">
              <h4>${Utils.escapeHtml(c.name)}</h4>
              <div class="card-meta">
                <span>${c.members?.length || 0} member${c.members?.length !== 1 ? 's' : ''}</span>
                <span>${c.addPolicy === 'any_member' ? 'Open adds' : 'Owner-managed'}</span>
              </div>
              ${c.description ? `<p style="font-size:.8rem;color:var(--muted);margin-top:.35rem">${Utils.escapeHtml(c.description)}</p>` : ''}
            </div>
          </div>
        `);
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

      const user    = Auth.getCurrentUser();
      const isOwner = circle.ownerEmail === user.email;
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
        const el = _el(`<div class="media-item"><img src="${Drive.getMediaUrl(f.id)}" alt="" loading="lazy" /></div>`);
        el.addEventListener('click', () => openLightbox(f.id, folderId, { canDelete: isOwner }));
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
      colls.forEach(c => {
        const card = _el(`
          <div class="card coll-card">
            <div class="coll-thumb" style="font-size:2.5rem">▤</div>
            <div class="card-body">
              <h4>${Utils.escapeHtml(c.name)}</h4>
              <div class="card-meta">
                <span>${_sharingLabel(c.sharing)}</span>
                ${c.allowCopying ? '<span>Copying ok</span>' : ''}
              </div>
              ${c.description ? `<p style="font-size:.8rem;color:var(--muted);margin-top:.35rem">${Utils.escapeHtml(c.description)}</p>` : ''}
            </div>
          </div>
        `);
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
        const el = _el(`<div class="media-item"><img src="${Drive.getMediaUrl(f.id)}" alt="" loading="lazy" /></div>`);
        el.addEventListener('click', () => openLightbox(f.id, folderId, { canDelete: true }));
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
      const row = _el(`
        <div class="person-row">
          <div class="avatar-sm">${(f.displayName || f.email)[0].toUpperCase()}</div>
          <div class="person-info">
            <div class="person-name">${Utils.escapeHtml(f.displayName || f.email)}</div>
            <div class="person-email">${Utils.escapeHtml(f.email)}</div>
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
    const input = document.getElementById('add-friend-email');
    const email = input.value.trim();
    if (!email || !email.includes('@')) { Utils.showToast('Enter a valid email', 'error'); return; }
    try {
      await Data.addFriend(email);
      input.value = '';
      _renderFriends();
      Utils.showToast(`${email} added!`);
    } catch { Utils.showToast('Failed to add friend', 'error'); }
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

      // Store profile in closure for edit form
      avatar._profile = profile;
    } catch { Utils.showToast('Failed to load profile', 'error'); }
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

  async function openLightbox(fileId, collectionFolderId, opts = {}) {
    const lb = document.getElementById('lightbox');
    lb.hidden = false;
    document.getElementById('lightbox-img').src = Drive.getMediaUrl(fileId);

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
      } catch { commArea.innerHTML = ''; }
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
      const text = input.value.trim();
      if (!text) return;
      try {
        await Drive.addComment(fileId, text);
        input.value = '';
        refreshComments();
      } catch { Utils.showToast('Failed to post comment', 'error'); }
    };

    document.getElementById('lightbox-close').onclick    = closeLightbox;
    document.getElementById('lightbox-backdrop').onclick = closeLightbox;
  }

  function closeLightbox() {
    document.getElementById('lightbox').hidden = true;
    document.getElementById('lightbox-img').src = '';
    document.getElementById('lightbox-comment-input').value = '';
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
