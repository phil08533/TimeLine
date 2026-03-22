// js/theme.js — Theme management for My Circle
'use strict';

const Theme = (() => {

  const VISUAL  = ['minimal', 'brutalist', 'soft', 'editorial'];
  const COLORS  = ['paper', 'midnight', 'forest', 'coral', 'slate'];
  const COLOR_NAMES = { paper: 'Paper', midnight: 'Midnight', forest: 'Forest', coral: 'Coral', slate: 'Slate' };

  let _visual = 'soft';
  let _color  = 'slate';

  function apply(visual, color) {
    _visual = VISUAL.includes(visual) ? visual : 'soft';
    _color  = COLORS.includes(color)  ? color  : 'slate';
    document.documentElement.setAttribute('data-theme', _visual);
    document.documentElement.setAttribute('data-color', _color);
    // Cache locally so next load doesn't flash the wrong theme
    try { localStorage.setItem('mc_theme', _visual); localStorage.setItem('mc_color', _color); } catch {}
  }

  function init(settings = {}) {
    // Prefer saved settings, fall back to localStorage cache, then defaults
    const cachedVisual = _tryLS('mc_theme');
    const cachedColor  = _tryLS('mc_color');
    apply(
      settings.theme      || cachedVisual || 'soft',
      settings.colorTheme || cachedColor  || 'slate'
    );
  }

  function _tryLS(key) { try { return localStorage.getItem(key); } catch { return null; } }

  function setVisual(v) {
    apply(v, _color);
  }

  function setColor(c) {
    apply(_visual, c);
  }

  function getVisual() { return _visual; }
  function getColor()  { return _color; }
  function getColorName(c) { return COLOR_NAMES[c] || c; }

  return { init, apply, setVisual, setColor, getVisual, getColor, getColorName, VISUAL, COLORS };
})();
