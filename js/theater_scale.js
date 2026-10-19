/* Keeps replay moths at the same visual scale relative to the habitat
 * photograph as in the actual 360x640 game. No effects on gameplay sprites. */
(function (root) {
  'use strict';
  const VERSION = 2;
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

  function needsRebuild(frame) {
    return !frame || frame.render_version !== VERSION;
  }

  const api = Object.freeze({ VERSION, GAME_WIDTH, GAME_HEIGHT, mothSize, needsRebuild });
  root.GitaiTheaterScale = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
