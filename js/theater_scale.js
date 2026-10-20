/* Keeps replay moths at the same visual scale relative to the habitat
 * photograph as in the actual 360x640 game. No effects on gameplay sprites. */
(function (root) {
  'use strict';
  const VERSION = 2;
  // Warning-color contact sheets regroup both independent 30-moth lineages.
  // Ordinary cryptic camouflage contact sheets continue using version 2.
  const WARNING_VERSION = 3;
  const GAME_WIDTH = 360;
  const GAME_HEIGHT = 640;

  function mothSize({ gameMothSize, frameWidth, frameHeight, cellWidth, cellHeight }) {
    const moth = Number(gameMothSize);
    if (!Number.isFinite(moth) || moth <= 0) throw new RangeError('Invalid game moth size');
    // The theater uses "cover" for its background. Its horizontal dimension
    // sets the zoom for 9:16 images inside the 600x1000 theater frame.
    const backgroundZoom = Math.max(
      frameWidth / GAME_WIDTH,
      frameHeight / GAME_HEIGHT,
    );
    const largestSafeMoth = Math.floor(Math.min(cellWidth, cellHeight) - 4);
    return Math.max(1, Math.min(Math.round(moth * backgroundZoom), largestSafeMoth));
  }

  function cellPosition(index, warningExperiment = false) {
    if (!Number.isInteger(index) || index < 0 || index >= 60) {
      throw new RangeError('Theater moth index must be between 0 and 59');
    }
    if (!warningExperiment) {
      return { col: index % 6, row: Math.floor(index / 6) };
    }
    // Poison moths 1-30 fill the left 3x10 grid; harmless moths 31-60
    // fill the right 3x10 grid. Both lineages remain in their own panel.
    const lineage = Math.floor(index / 30);
    const withinLineage = index % 30;
    return {
      col: lineage * 3 + (withinLineage % 3),
      row: Math.floor(withinLineage / 3),
    };
  }

  function needsRebuild(frame) {
    if (!frame) return true;
    const warning = /^warning_color_/.test(String(frame.preview_run_id || ''));
    const targetVersion = warning ? WARNING_VERSION : VERSION;
    return Number(frame.render_version) !== targetVersion;
  }

  const api = Object.freeze({
    VERSION, WARNING_VERSION, GAME_WIDTH, GAME_HEIGHT,
    mothSize, cellPosition, needsRebuild,
  });
  root.GitaiTheaterScale = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
