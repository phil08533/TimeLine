// js/utils.js — Shared helpers for My Circle
'use strict';

const Utils = (() => {

  /* ── XSS Prevention ──────────────────────────────── */

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ── Relative Timestamps ─────────────────────────── */

  function formatRelativeTime(dateStr) {
    const date = new Date(dateStr);
    if (isNaN(date)) return '';
    const now = Date.now();
    const diff = now - date.getTime();

    const MINUTE = 60 * 1000;
    const HOUR   = 60 * MINUTE;
    const DAY    = 24 * HOUR;
    const WEEK   = 7 * DAY;

    if (diff < MINUTE)       return 'just now';
    if (diff < 2 * MINUTE)   return '1 minute ago';
    if (diff < HOUR)         return `${Math.floor(diff / MINUTE)} minutes ago`;
    if (diff < 2 * HOUR)     return '1 hour ago';
    if (diff < DAY)          return `${Math.floor(diff / HOUR)} hours ago`;
    if (diff < 2 * DAY)      return 'yesterday';
    if (diff < WEEK)         return `${Math.floor(diff / DAY)} days ago`;

    return date.toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  /* ── ID Generation ───────────────────────────────── */

  function generateId(prefix = 'id') {
    const rand = Math.random().toString(36).slice(2, 9);
    return `${prefix}-${Date.now()}-${rand}`;
  }

  /* ── Debounce ────────────────────────────────────── */

  function debounce(fn, delayMs = 500) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delayMs);
    };
  }

  /* ── File Validation ─────────────────────────────── */

  const ALLOWED_TYPES = new Set([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm'
  ]);

  function validateMediaFile(file) {
    if (!file) return { ok: false, error: 'No file selected.' };

    if (!ALLOWED_TYPES.has(file.type)) {
      return { ok: false, error: 'File type not allowed. Use jpg, png, gif, webp, mp4, or webm.' };
    }

    const limits = (typeof CONFIG !== 'undefined' && CONFIG.MAX_FILE_SIZE) || {
      image: 10 * 1024 * 1024,
      video: 100 * 1024 * 1024
    };

    const isVideo = file.type.startsWith('video/');
    const limit   = isVideo ? limits.video : limits.image;

    if (file.size > limit) {
      const mb = Math.round(limit / (1024 * 1024));
      return { ok: false, error: `File is too large. Max size is ${mb} MB.` };
    }

    return { ok: true, isVideo };
  }

  /* ── Format bytes ────────────────────────────────── */

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }

  /* ── Toast Notifications ─────────────────────────── */

  function showToast(message, type = 'info', durationMs = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    // Use textContent to prevent XSS
    toast.textContent = message;
    container.appendChild(toast);

    const dismiss = () => {
      toast.classList.add('dismissing');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    };

    const timer = setTimeout(dismiss, durationMs);
    toast.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
  }

  /* ── Loading Overlay ─────────────────────────────── */

  function showLoading() {
    const el = document.getElementById('loading-overlay');
    if (el) el.hidden = false;
  }

  function hideLoading() {
    const el = document.getElementById('loading-overlay');
    if (el) el.hidden = true;
  }

  /* ── OAuth State Parameter ───────────────────────── */

  function generateState() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  /* ── JSON Validation ─────────────────────────────── */

  function safeParseJSON(str) {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  /* ── Retry with Exponential Back-off ─────────────── */

  async function withRetry(fn, maxAttempts = 3, baseDelayMs = 1000) {
    let lastErr;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const isRetryable = !err.status || err.status === 429 || err.status >= 500;
        if (!isRetryable || attempt === maxAttempts - 1) break;
        await sleep(baseDelayMs * Math.pow(2, attempt));
      }
    }
    throw lastErr;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /* ── Exports ─────────────────────────────────────── */

  return {
    escapeHtml,
    formatRelativeTime,
    formatBytes,
    generateId,
    debounce,
    validateMediaFile,
    showToast,
    showLoading,
    hideLoading,
    generateState,
    safeParseJSON,
    withRetry,
    sleep
  };
})();
