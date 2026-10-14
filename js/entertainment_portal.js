/* InvisiLab / entertainment-only title + menu.
 * The existing game engine is untouched. Background sprites are rendered
 * on a low-resolution canvas, while their motion stays smoothly interpolated.
 */
(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const model = params.get('model') || 'continuous_v1';
  if (model !== 'continuous_v1' || params.get('play') === '1') return;

  const portal = document.getElementById('entertainmentPortal');
  if (!portal) return;
  const intro = document.getElementById('portalIntro');
  const menu = document.getElementById('portalMenu');
  const canvas = document.getElementById('portalArt');
  const enter = document.getElementById('portalEnter');
  const returnToIntro = document.getElementById('portalToIntro');
  const solo = document.getElementById('portalSolo');
  const shared = document.getElementById('portalShared');
  const mystery = document.getElementById('portalMystery');
  const dialog = document.getElementById('portalDialog');
  const dialogTitle = document.getElementById('portalDialogTitle');
  const dialogText = document.getElementById('portalDialogText');
  const closeDialog = document.getElementById('portalDialogClose');
  const backToMenu = document.getElementById('portalBackToMenu');
  const startOverlay = document.getElementById('startOverlay');

  if (!intro || !menu || !canvas || !enter || !solo || !shared || !mystery) return;

  const width = 180;
  const height = 320;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const now = () => performance.now();
  const seed = (i) => {
    const v = Math.sin(i * 125.723 + 45.738) * 41987.371;
    return v - Math.floor(v);
  };
  const int = (x) => Math.round(x);
  let mode = 'intro';
  let active = true;
  let raf = 0;
  let lastDraw = 0;
  let pointerX = 0;
  let pointerY = 0;

  function rectangle(c, color, x, y, w, h) {
    c.fillStyle = color;
    c.fillRect(int(x), int(y), Math.max(1, int(w)), Math.max(1, int(h)));
  }

  function paintHill(c, color, coords) {
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(coords[0][0], coords[0][1]);
    for (let i = 1; i < coords.length; i += 1) c.lineTo(coords[i][0], coords[i][1]);
    c.lineTo(width, height);
    c.lineTo(0, height);
    c.closePath();
    c.fill();
  }

  function drawPixelDisk(c, x, y, radius, colors) {
    // Block-based light source: no antialiasing on edges.
    for (let dy = -radius; dy <= radius; dy += 2) {
      const dx = Math.sqrt(Math.max(0, radius * radius - dy * dy));
      const zone = Math.abs(dy) / radius;
      const color = zone < .52 ? colors[0] : zone < .79 ? colors[1] : colors[2];
      rectangle(c, color, x - dx, y + dy, dx * 2, 2);
    }
  }

  function tree(c, side, variant) {
    const dark = variant === 'intro' ? '#102829' : '#102625';
    const branch = variant === 'intro' ? '#183536' : '#18312f';
    c.save();
    if (side === 'right') {
      c.translate(width, 0);
      c.scale(-1, 1);
    }
    rectangle(c, dark, -6, 78, 16, 250);
    rectangle(c, dark, 6, 100, 7, 95);
    rectangle(c, dark, 11, 117, 30, 8);
    rectangle(c, dark, 17, 96, 7, 29);
    rectangle(c, dark, 8, 182, 26, 8);
    rectangle(c, branch, 0, 118, 4, 87);
    rectangle(c, dark, 6, 49, 15, 40);
    rectangle(c, dark, 10, 43, 47, 9);
    rectangle(c, dark, 37, 45, 9, 17);
    rectangle(c, dark, 18, 35, 28, 9);
    rectangle(c, dark, 13, 29, 20, 10);
    rectangle(c, dark, 0, 61, 20, 16);
    for (let i = 0; i < 22; i += 1) {
      const x = seed(i + (side === 'right' ? 44 : 0)) * 42;
      const y = 27 + seed(i + 139) * 163;
      const s = 4 + Math.floor(seed(i + 201) * 8);
      rectangle(c, i % 3 === 0 ? '#24453e' : dark, x - 7, y, s + 4, 3 + (i % 3) * 2);
    }
    c.restore();
  }

  function buildStaticScene(type) {
    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    const c = off.getContext('2d', { alpha: false });
    c.imageSmoothingEnabled = false;
    const introScene = type === 'intro';

    // Limited palette, horizontal 2px bands: pixel-world light gradients.
    const bands = introScene
      ? ['#1b343b','#224044','#2b4a4a','#385251','#505d50','#69694e','#85704b','#9c784d']
      : ['#12252d','#1b3034','#223c3d','#2e4943','#435748','#595d46','#686448','#766744'];
    for (let y = 0; y < height; y += 2) {
      const mix = Math.max(0, Math.min(bands.length - 1, Math.floor(y / (height * .79) * bands.length)));
      rectangle(c, bands[mix], 0, y, width, 2);
    }

    const sun = introScene ? {x:91,y:141,r:45} : {x:139,y:100,r:30};
    drawPixelDisk(c, sun.x, sun.y, sun.r,
      introScene ? ['#e4b86b','#ce9a5d','#ae8056'] : ['#d4b46b','#ad955b','#6e704f']);

    for (let i = 0; i < 56; i += 1) {
      const x = Math.floor(seed(i + 91) * width);
      const y = Math.floor(seed(i + 280) * 255);
      if (x > sun.x - sun.r - 6 && x < sun.x + sun.r + 6 &&
          y > sun.y - sun.r - 6 && y < sun.y + sun.r + 6) continue;
      rectangle(c, i % 5 === 0 ? '#c7be91' : '#879681', x, y, i % 4 === 0 ? 2 : 1, 1);
    }

    paintHill(c, introScene ? '#394d48' : '#364b46', [
      [0, 213], [16, 210], [37, 214], [62, 196], [87, 207], [112, 191],
      [143, 206], [160, 197], [180, 204]
    ]);
    paintHill(c, '#203936', [
      [0, 236], [23, 226], [48, 231], [73, 221], [100, 239],
      [135, 224], [155, 236], [180, 218]
    ]);
    paintHill(c, '#162e2d', [
      [0, 261], [16, 252], [37, 259], [58, 251], [90, 263],
      [110, 250], [149, 259], [180, 250]
    ]);

    tree(c, 'left', type);
    tree(c, 'right', type);
    rectangle(c, '#102526', 0, 281, width, 39);
    for (let i = 0; i < 130; i += 1) {
      const x = seed(i + 591) * width;
      const y = 265 + seed(i + 921) * 65;
      const color = ['#223c35','#2e4c3c','#374d3d','#667045'][i % 4];
      rectangle(c, color, x, y, 2 + (i % 4) * 2, 2 + (i % 3) * 2);
    }
    // A few foreground sprouts and reeds.
    for (let i = 0; i < 32; i += 1) {
      const x = Math.floor(seed(i + 167) * width);
      const y = 279 + Math.floor(seed(i + 344) * 48);
      rectangle(c, i % 4 ? '#3e5c45' : '#71805b', x, y-6, 2, 8);
      rectangle(c, '#4b6850', x-3, y-7, 4, 2);
      rectangle(c, '#4b6850', x+1, y-9, 4, 2);
    }
    return off;
  }

  const backdrops = {
    intro: buildStaticScene('intro'),
    menu: buildStaticScene('menu')
  };

  const leafPattern = [
    '..a.....',
    '.abb....',
    'abbbb...',
    '.abbbb..',
    '..abbbb.',
    '...abba.',
    '....ab..',
    '.....a..'
  ];
  function leaf(c, x, y, size, shade, rotation) {
    c.save();
    c.translate(x, y);
    c.rotate(rotation);
    const colors = shade === 0 ? {a:'#7a8e58',b:'#c4c67f'}
      : shade === 1 ? {a:'#617c5c',b:'#8aa27a'}
      : {a:'#a08052',b:'#e4bf70'};
    for (let r = 0; r < leafPattern.length; r += 1) {
      for (let i = 0; i < leafPattern[r].length; i += 1) {
        const pixel = leafPattern[r][i];
        if (pixel === '.') continue;
        rectangle(c, colors[pixel], (i - 4) * size, (r - 3) * size, size, size);
      }
    }
    c.restore();
  }

  function moth(c, x, y, scale, flutter) {
    c.save();
    c.translate(int(x), int(y));
    c.scale(scale, scale);
    const wingRadii = [2,4,6,8,10,12,14,16,17,17,16,15,14,12,10,8,7,5,3];
    const palette = ['#d7ce9b','#aba87d','#5f786c','#e3b979'];
    for (let row = 0; row < wingRadii.length; row += 1) {
      const radius = wingRadii[row];
      const flapShift = Math.sin(flutter) * (1 - row / wingRadii.length) * 1.1;
      for (let i = 2; i < radius; i += 1) {
        let color = palette[0];
        if (i > radius - 3 || row > 15) color = palette[2];
        else if ((i * 3 + row * 5) % 13 < 4) color = palette[1];
        if (row > 4 && row < 11 && i > 7 && i < 10) color = palette[3];
        c.fillStyle = color;
        c.fillRect(int(-i - 1 - flapShift), int(row - 9), 1, 1);
        c.fillRect(int(i + flapShift), int(row - 9), 1, 1);
      }
    }
    rectangle(c, '#1b3634', -1, -10, 3, 22);
    rectangle(c, '#f2e6bb', 0, -8, 1, 16);
    rectangle(c, '#e1bc73', -4, -13, 2, 2);
    rectangle(c, '#e1bc73', 3, -13, 2, 2);
    rectangle(c, '#a8ab7a', -3, -11, 1, 5);
    rectangle(c, '#a8ab7a', 3, -11, 1, 5);
    c.restore();
  }

  function renderScene(time) {
    const t = time * .001;
    const image = backdrops[mode];
    ctx.drawImage(image, 0, 0);
    const menuMode = mode === 'menu';
    // Light and far away spores, moved at subpixel speeds through a pixel buffer.
    for (let i = 0; i < 21; i += 1) {
      const x = seed(i + 187) * width + Math.sin(t * (.16 + (i % 3) * .08) + i) * 7;
      const y = ((seed(i + 47) * height - t * (1.2 + i % 3)) % height + height) % height;
      rectangle(ctx, i % 3 === 0 ? '#e5cb7c' : '#91a188', x, y, i % 5 === 0 ? 2 : 1, 1);
    }
    // Floating pixellated leaves and spores: no stepped CSS position changes.
    for (let i = 0; i < 12; i += 1) {
      const rate = .9 + (i % 3) * .37;
      const x = (((seed(i + 326) * (width + 30) - t * rate * 4) % (width + 30)) + width + 30) % (width + 30) - 15;
      const y = 35 + ((seed(i + 527) * 270 + t * rate * 8) % 278);
      const sway = Math.sin(t * .65 + i * 2.1) * 9;
      const size = i % 4 === 0 ? 1.0 : .64;
      leaf(ctx, x + sway, y, size, i % 3, Math.sin(t * .9 + i) * .28);
    }
    if (menuMode) {
      moth(ctx, 106 + Math.sin(t * .45) * 13, 179 + Math.cos(t * .71) * 6, .65, t * 3);
    } else {
      const mx = 91 + Math.sin(t * .62) * 5 + pointerX * 3;
      const my = 190 + Math.sin(t * .93) * 5 + pointerY * 2;
      moth(ctx, mx, my, 1.7, t * 4.5);
      // The dancing points make the still pixel scene feel alive.
      for (let i = 0; i < 9; i += 1) {
        const angle = i * Math.PI * 2 / 9 + t * .26;
        const x = 91 + Math.cos(angle) * (44 + 3 * Math.sin(t + i));
        const y = 189 + Math.sin(angle) * 39;
        rectangle(ctx, i % 2 ? '#e4c881' : '#bdc393', x, y, 1 + (i % 4 === 0 ? 1 : 0), 1);
      }
    }
  }

  function frame(timestamp) {
    raf = 0;
    if (!active || document.hidden || portal.hidden) return;
    if (timestamp - lastDraw >= 30) {
      renderScene(timestamp);
      lastDraw = timestamp;
    }
    if (!reducedMotion.matches) raf = window.requestAnimationFrame(frame);
  }
  function restartAnimation() {
    window.cancelAnimationFrame(raf);
    raf = 0;
    lastDraw = 0;
    if (!active || document.hidden || portal.hidden) return;
    if (reducedMotion.matches) renderScene(now());
    else raf = window.requestAnimationFrame(frame);
  }

  function hideDialog() {
    dialog.hidden = true;
    closeDialog.blur();
  }
  function showDialog(kind) {
    const isShared = kind === 'shared';
    dialogTitle.textContent = isShared ? 'みんなでギタイ' : '？？？？';
    dialogText.textContent = isShared
      ? 'みんなで同じ進化をつなぐモードは現在準備中です。今は「ひとりでギタイ」をお楽しみください。'
      : 'この研究区画は、まだ解放されていません。';
    dialog.hidden = false;
    closeDialog.focus();
  }

  function setMode(nextMode) {
    mode = nextMode;
    hideDialog();
    const introActive = nextMode === 'intro';
    intro.classList.toggle('is-active', introActive);
    menu.classList.toggle('is-active', !introActive);
    intro.setAttribute('aria-hidden', String(!introActive));
    menu.setAttribute('aria-hidden', String(introActive));
    intro.inert = !introActive;
    menu.inert = introActive;
    restartAnimation();
  }

  function showMenu() {
    portal.hidden = false;
    portal.setAttribute('aria-hidden', 'false');
    active = true;
    setMode('menu');
    returnToIntro.focus({ preventScroll: true });
  }

  function startSolo() {
    active = false;
    window.cancelAnimationFrame(raf);
    raf = 0;
    portal.hidden = true;
    portal.setAttribute('aria-hidden', 'true');
    // Do not reset or mutate the existing IndexedDB evolution state.
    if (backToMenu) backToMenu.hidden = false;
    const startButton = document.getElementById('startButton');
    if (startOverlay && startOverlay.classList.contains('visible') && startButton && !startButton.disabled) {
      startButton.focus({ preventScroll: true });
    }
  }

  enter.addEventListener('click', showMenu);
  returnToIntro.addEventListener('click', () => {
    setMode('intro');
    enter.focus({ preventScroll: true });
  });
  solo.addEventListener('click', startSolo);
  shared.addEventListener('click', () => showDialog('shared'));
  mystery.addEventListener('click', () => showDialog('mystery'));
  closeDialog.addEventListener('click', hideDialog);
  if (backToMenu) backToMenu.addEventListener('click', showMenu);
  portal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!dialog.hidden) { event.preventDefault(); hideDialog(); }
      else if (mode === 'menu') { event.preventDefault(); setMode('intro'); }
    }
  });
  intro.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointerX = (event.clientX - rect.left) / rect.width * 2 - 1;
    pointerY = (event.clientY - rect.top) / rect.height * 2 - 1;
  }, { passive: true });
  document.addEventListener('visibilitychange', restartAnimation);
  reducedMotion.addEventListener?.('change', restartAnimation);

  portal.hidden = false;
  portal.setAttribute('aria-hidden', 'false');
  intro.inert = false;
  menu.inert = true;
  setMode('intro');
})();
