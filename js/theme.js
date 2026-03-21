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
  }

  function init(settings = {}) {
    apply(settings.theme || 'soft', settings.colorTheme || 'slate');
  }

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
