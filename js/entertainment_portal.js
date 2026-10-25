/* InvisiLab / entertainment-only title + menu.
 * Intro: solid black canvas, fixed generated moth and iridescent water ripples.
 * Menu: minimalist black, matching the battle matchmaking scene.
 * The existing game engine, saved progression, and educational model are untouched.
 */
(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const model = params.get('model') || 'continuous_v1';
  if (model !== 'continuous_v1') return;
  const directSolo = params.get('play') === '1';

  // Font is requested only on the entertainment entrance.
  // If offline (e.g. exhibition iPad), fallback fonts keep the UI usable.
  const fontId = 'gitaiPortalPixelFont';
  if (!document.getElementById(fontId)) {
    const link = document.createElement('link');
    link.id = fontId;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DotGothic16&display=swap';
    document.head.appendChild(link);
  }

  const portal = document.getElementById('entertainmentPortal');
  if (!portal) return;
  const intro = document.getElementById('portalIntro');
  const menu = document.getElementById('portalMenu');
  const canvas = document.getElementById('portalArt');
  const enter = document.getElementById('portalEnter');
  const returnToIntro = document.getElementById('portalToIntro');
  const solo = document.getElementById('portalSolo');
  const experimentModes = document.getElementById('portalEvolutionModes');
  const crypticMode = document.getElementById('portalCrypticMode');
  const warningMode = document.getElementById('portalWarningMode');
  const evolutionBack = document.getElementById('portalEvolutionBack');
  const menuContent = menu?.querySelector('.portal-menu-content');
  const shared = document.getElementById('portalShared');
  const mystery = document.getElementById('portalMystery');
  const dialog = document.getElementById('portalDialog');
  const dialogTitle = document.getElementById('portalDialogTitle');
  const dialogText = document.getElementById('portalDialogText');
  const closeDialog = document.getElementById('portalDialogClose');
  const backToMenu = document.getElementById('portalBackToMenu');
  const resultBackToMenu = document.getElementById('resultBackToMenu');
  const soloHomeButton = document.getElementById('soloHomeButton');
  const reviewOverlay = document.getElementById('reviewOverlay');
  const startOverlay = document.getElementById('startOverlay');
  const nicknameInput = document.getElementById('portalNickname');
  const NICKNAME_KEY = 'gitai-player-nickname-v1';
  const LEGACY_SHARE_NAME_KEY = 'gitai-preview-share-name-v1';

  function readNickname() {
    try {
      const current = localStorage.getItem(NICKNAME_KEY);
      const value = current !== null ? current
        : localStorage.getItem(LEGACY_SHARE_NAME_KEY);
      return String(value || '').trim().slice(0, 16);
    } catch (_) {
      return '';
    }
  }

  function persistNickname(value) {
    const name = String(value || '').trim().slice(0, 16);
    try {
      // Save even an empty value so an older share name cannot reappear.
      localStorage.setItem(NICKNAME_KEY, name);
    } catch (_) {}
    return name;
  }

  if (nicknameInput) {
    nicknameInput.value = readNickname();
    nicknameInput.addEventListener('input', () => {
      nicknameInput.removeAttribute('aria-invalid');
      persistNickname(nicknameInput.value);
    });
    nicknameInput.addEventListener('change', () => {
      nicknameInput.value = persistNickname(nicknameInput.value);
    });
  }

  function ensureNickname() {
    if (!nicknameInput) return true;
    const value = persistNickname(nicknameInput.value);
    if (value) return true;
    nicknameInput.setAttribute('aria-invalid', 'true');
    nicknameInput.focus({ preventScroll: true });
    return false;
  }

  if (!intro || !menu || !canvas || !enter || !solo || !shared || !mystery) return;

  const width = 180;
  const height = 320;
  const lineWidth = 360;
  const lineHeight = 640;
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
  let pointerX = 0;
  let pointerY = 0;
  const tapBursts = [];
  let titleMothCanvas = null;
  const slowTime = (time) => time * 0.001;

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


  // All intro decoration is procedural: true black background, a stationary
  // generated moth, and rainbow-coloured circular water ripples at tap points.
  // It never changes moth position or draws scene ornaments or a specimen disc.
  // The supplied 720×1280 jungle image repeats each source pixel in an 8×8
  // block. This losslessly reduced 90×160 PNG recreates it pixel-for-pixel
  // when drawn nearest-neighbor over the 360×640 logical title canvas.
  let titleBackgroundImage = null;
  const TITLE_MOTH_X = 180;
  const TITLE_MOTH_Y = 350;
  const RIPPLE_MS = 1750;
  function renderLineArtwork(timestamp) {
    const c = ctx;
    c.setTransform(2, 0, 0, 2, 0, 0);
    if (titleBackgroundImage && titleBackgroundImage.complete
        && titleBackgroundImage.naturalWidth > 0) {
      c.imageSmoothingEnabled = false;
      c.drawImage(titleBackgroundImage, 0, 0, lineWidth, lineHeight);
    } else {
      // Black is a fallback only while the jungle asset loads.
      c.fillStyle = '#000';
      c.fillRect(0, 0, lineWidth, lineHeight);
    }

    // Water-drop ripples: multiple concentric, continuous, gently glowing
    // circular waves. The hue travels through the entire rainbow over time.
    for (let i = tapBursts.length - 1; i >= 0; i--) {
      const burst = tapBursts[i];
      const progress = Math.max(0, (timestamp - burst.time) / RIPPLE_MS);
      if (progress >= 1) {
        tapBursts.splice(i, 1);
        continue;
      }
      const opacity = Math.pow(1 - progress, 1.25);
      for (let ring = 0; ring < 3; ring++) {
        const delayed = Math.max(0, progress - ring * 0.092);
        if (delayed === 0 && progress < ring * 0.092) continue;
        const radius = 3 + delayed * 375;
        const hue = (timestamp * 0.16 + ring * 78 + burst.hueOffset) % 360;
        c.beginPath();
        c.arc(burst.x, burst.y, radius, 0, Math.PI * 2);
        c.strokeStyle = `hsl(${hue} 100% ${ring === 0 ? 71 : 65}%)`;
        // Blurred Canvas shadows were very expensive on iOS's 720x1280
        // backing buffer. Two lightweight strokes approximate the glow
        // without a per-wave shadow-blur compositing pass.
        c.globalAlpha = opacity * (1 - ring * 0.24) * 0.20;
        c.lineWidth = ring === 0 ? 6 : 4;
        c.stroke();
        c.globalAlpha = opacity * (1 - ring * 0.24);
        c.lineWidth = ring === 0 ? 2 : 1.4;
        c.stroke();
      }
      c.globalAlpha = 1;
    }

    // Only its pattern changes on tap. All paint frames use identical x/y,
    // scale and rotation; there is no pointer tracking or attraction impulse.
    c.save();
    c.translate(TITLE_MOTH_X, TITLE_MOTH_Y);
    c.imageSmoothingEnabled = false;
    if (titleMothCanvas) {
      // Preserve the real 128px symmetric moth, without the old pale circle.
      c.drawImage(titleMothCanvas, -119, -119, 238, 238);
    } else {
      c.strokeStyle = '#f2f0e9';
      c.lineWidth = 1.8;
      c.beginPath();
      c.moveTo(0, -47);
      c.bezierCurveTo(-44, -64, -101, -53, -95, 12);
      c.bezierCurveTo(-65, 60, -25, 85, 0, 42);
      c.bezierCurveTo(25, 85, 65, 60, 95, 12);
      c.bezierCurveTo(101, -53, 44, -64, 0, -47);
      c.stroke();
      c.beginPath();
      c.moveTo(0, -45);
      c.lineTo(0, 46);
      c.stroke();
    }
    c.restore();
  }

  function renderScene(time) {
    if (mode === 'intro') {
      renderLineArtwork(time);
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
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
    // Render on *every* vsync while water ripples exist: no 30ms throttle.
    // The display clock's timestamp preserves smooth wave velocity even when
    // an individual frame is delayed on a busy phone.
    if (!active || document.hidden || portal.hidden || mode !== 'intro') return;
    renderScene(timestamp);
    // No continuous idle redrawing. Stationary moth stays visible as a static
    // canvas image after the last ripple fades, saving iPad battery/heat.
    if (!reducedMotion.matches && tapBursts.length) {
      raf = window.requestAnimationFrame(frame);
    }
  }
  function restartAnimation() {
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
    if (!active || document.hidden || portal.hidden || mode !== 'intro') return;
    renderScene(now());
    if (!reducedMotion.matches && tapBursts.length) {
      raf = window.requestAnimationFrame(frame);
    }
  }

  // Only the intro canvas background is replaced. Menu and game artwork,
  // moth position, gestures, ripple timing, and sounds remain unchanged.
  titleBackgroundImage = new Image();
  titleBackgroundImage.onload = () => {
    if (active && mode === 'intro' && !portal.hidden) renderScene(now());
  };
  titleBackgroundImage.src = new URL(
    'img/backgrounds/bg_jungle_title_90x160.png', document.baseURI
  ).href;

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
    // Intro is high-resolution ripple artwork; menu retains original 180x320.
    const introResolution = nextMode === 'intro';
    canvas.width = introResolution ? lineWidth * 2 : width;
    canvas.height = introResolution ? lineHeight * 2 : height;
    ctx.imageSmoothingEnabled = false;
    portal.classList.toggle('portal-line-mode', introResolution);
    tapBursts.length = 0;
    window.GitaiTrophies?.close?.();
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

  // The game reloads this page to advance generations. Remember SOLO mode in
  // the URL so the entertainment title does not reopen after every generation.
  // replaceState does not reload the page or touch evolution/IndexedDB data.
  function setSoloRoute(isPlaying) {
    try {
      const url = new URL(window.location.href);
      if (isPlaying) url.searchParams.set('play', '1');
      else {
        url.searchParams.delete('play');
        url.searchParams.delete('portal');
      }
      window.history.replaceState(window.history.state, '', url.toString());
    } catch (error) {
      console.warn('Could not update SOLO navigation URL:', error);
    }
  }

  function showMenu() {
    // Returning to the menu must not auto-launch the experiment on refresh.
    if (experimentModes) experimentModes.hidden = true;
    if (menuContent) menuContent.inert = false;
    if (nicknameInput) nicknameInput.value = readNickname();
    setSoloRoute(false);
    portal.hidden = false;
    portal.setAttribute('aria-hidden', 'false');
    active = true;
    setMode('menu');
    returnToIntro.focus({ preventScroll: true });
  }

  function startSolo() {
    setSoloRoute(true);
    document.documentElement.classList.remove('pixel-portal-pending');
    active = false;
    window.cancelAnimationFrame(raf);
    raf = 0;
    portal.hidden = true;
    portal.setAttribute('aria-hidden', 'true');
    // Do not reset or mutate the existing IndexedDB evolution state.
    if (backToMenu) backToMenu.hidden = false;
    if (soloHomeButton) {
      soloHomeButton.hidden = Boolean(
        startOverlay?.classList.contains('visible')
        || reviewOverlay?.classList.contains('visible')
      );
    }
    // Background has already been selected: start or resume SOLO immediately.
    // The tutorial now happens BEFORE the habitat picker, once per mode entry.
    window.dispatchEvent(new Event('gitai:solo-resume'));
    const startButton = document.getElementById('startButton');
    if (!startOverlay?.classList.contains('visible') || !startButton) return;
    if (!startButton.disabled) {
      startButton.click();
    } else {
      window.addEventListener('gitai:solo-assets-ready', () => {
        if (portal.hidden && startOverlay.classList.contains('visible') && !startButton.disabled) {
          startButton.click();
        }
      }, { once: true });
    }
  }

  function randomizeTitleMoth() {
    const generator = window.GitaiPortalRandomMoth;
    if (!generator?.ready) {
      return;
    }
    try {
      const canvas = generator.next();
      if (canvas) titleMothCanvas = canvas;
      // The next active ripple frame will draw this specimen; if the page
      // is idle, refresh just once without restarting a permanent RAF loop.
      if (canvas && active && mode === 'intro' && !raf) {
        renderScene(now());
      }
    } catch (error) {
      console.warn('Top-page random moth could not be drawn:', error);
    }
  }

  // Initialize once in the title's background. Neither progress nor
  // random patterns are saved, scored, or handed to the game.
  if (window.GitaiPortalRandomMoth) {
    window.GitaiPortalRandomMoth.initialize()
      .then(() => {
        // Draw an initial independent specimen as soon as assets are ready.
        randomizeTitleMoth();
      })
      .catch((error) => {
        console.warn('Using fallback title moth artwork:', error);
      });
  }

  // The START button is the *only* navigation action on the title.
  // Every other tap changes only the fixed moth pattern and makes rainbow water ripples.
  enter.addEventListener('click', (event) => {
    event.stopPropagation();
    showMenu();
  });
  intro.addEventListener('pointerdown', (event) => {
    if (event.target === enter || enter.contains(event.target)) return;
    if (mode !== 'intro' || event.button > 0) return;
    randomizeTitleMoth();
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const x = Math.max(10, Math.min(lineWidth - 10,
      (event.clientX - box.left) * lineWidth / box.width));
    const y = Math.max(10, Math.min(lineHeight - 10,
      (event.clientY - box.top) * lineHeight / box.height));
    tapBursts.push({ x, y, time: now(), hueOffset: Math.random() * 360 });
    if (tapBursts.length > 5) tapBursts.shift();
    if (reducedMotion.matches) renderScene(now());
    else if (!raf) restartAnimation();
  });
  returnToIntro.addEventListener('click', () => {
    setMode('intro');
    enter.focus({ preventScroll: true });
  });
  function playEnvironment(environmentId) {
    const current = params.get('env') === 'sand' ? 'sand_001'
      : params.get('env') === 'bark' ? 'bark_001'
      : params.get('env') || 'kusagi_001';
    if (current === environmentId && params.get('experiment') !== 'warning_color') {
      if (!ensureNickname()) return;
      startSolo();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('model', 'continuous_v1');
    url.searchParams.set('env', environmentId);
    url.searchParams.delete('experiment');
    url.searchParams.delete('fog');
    // An environment switch must not carry an unrelated save-slot namespace.
    url.searchParams.delete('slot');
    if (params.get('experiment') === 'warning_color') {
      url.searchParams.delete('run');
    }
    url.searchParams.delete('play');
    url.searchParams.set('portal', 'auto-play-environment');
    window.location.assign(url.toString());
  }
  function showEnvironmentPicker() {
    if (window.GitaiTrophies?.open) {
      window.GitaiTrophies.open({ onChoose: playEnvironment });
    } else {
      // Optional UI failure must never make the existing game unplayable.
      startSolo();
    }
  }
  function beginSoloTutorial() {
    // Menu → tutorial (4 slides, or skip) → habitat selection → live game.
    // Do not repeat tutorial on the environment's auto-play page load.
    if (window.GitaiSoloTutorial?.open) {
      window.GitaiSoloTutorial.open({ onDone: showEnvironmentPicker });
    } else {
      // The tutorial is optional; a loading failure must not block the picker.
      showEnvironmentPicker();
    }
  }
  function closeEvolutionModePicker() {
    if (experimentModes) experimentModes.hidden = true;
    if (menuContent) menuContent.inert = false;
    solo.focus({ preventScroll: true });
  }
  let experimentExamplesLoaded = false;
  let experimentExamplesPending = null;
  function populateExperimentCardMoths() {
    if (experimentExamplesLoaded || experimentExamplesPending) return;
    const renderer = window.GitaiPortalRandomMoth;
    if (!renderer?.initialize || !renderer?.experimentExamples) return;
    experimentExamplesPending = renderer.initialize().then(() => {
      const samples = renderer.experimentExamples();
      if (!samples || !experimentModes) return;
      for (const img of experimentModes.querySelectorAll('img[data-experiment-moth]')) {
        const sample = samples[img.dataset.experimentMoth];
        if (sample) img.src = sample;
      }
      experimentExamplesLoaded = true;
    }).catch(error => {
      // The visual samples are optional and never block either game mode.
      console.warn('Could not draw experiment card moths:', error);
    }).finally(() => {
      experimentExamplesPending = null;
    });
  }

  function openEvolutionModePicker() {
    if (!ensureNickname()) return;
    if (!experimentModes) {
      beginSoloTutorial();
      return;
    }
    experimentModes.hidden = false;
    populateExperimentCardMoths();
    if (menuContent) menuContent.inert = true;
    crypticMode?.focus({ preventScroll: true });
  }
  function beginWarningExperiment() {
    const url = new URL(window.location.href);
    url.searchParams.set('model', 'continuous_v1');
    url.searchParams.set('env', 'kusagi_001');
    url.searchParams.set('experiment', 'warning_color');
    // A fresh fog experiment has its own Run; existing warning_color_v6
    // generations remain available through the legacy URL when needed.
    url.searchParams.set('run', 'warning_color_fog_v2');
    url.searchParams.set('fog', '1');
    // Entering a different mode never inherits the previous mode's save slot.
    url.searchParams.delete('slot');
    url.searchParams.delete('play');
    // IMPORTANT iOS Safari: tapping the mode card must not navigate:
    // reloading destroys the already-playing native rainforest audio.
    // The warning tutorial uses the same fixed Leaf 1 art on either route
    // and can play fully in this document without touching experiment data.
    const launchWarningGame = () => {
      // The game engine reads model/run/env only at document initialization,
      // so the sole necessary navigation happens AFTER the tutorial.
      // The destination uses the existing auto-start route, not a repeated
      // tutorial. Ambient audio resumes on the next real user gesture if iOS
      // rejects cross-document autoplay.
      url.searchParams.set('portal', 'auto-play-warning');
      window.location.assign(url.toString());
    };
    if (window.GitaiSoloTutorial?.open) {
      window.GitaiSoloTutorial.open({
        mode: 'warning',
        onDone: launchWarningGame
      });
    } else {
      launchWarningGame();
    }
  }
  solo.addEventListener('click', openEvolutionModePicker);
  crypticMode?.addEventListener('click', () => {
    closeEvolutionModePicker();
    beginSoloTutorial();
  });
  warningMode?.addEventListener('click', () => {
    closeEvolutionModePicker();
    beginWarningExperiment();
  });
  evolutionBack?.addEventListener('click', closeEvolutionModePicker);
  shared.addEventListener('click', () => showDialog('shared'));
  mystery.addEventListener('click', () => showDialog('mystery'));
  closeDialog.addEventListener('click', hideDialog);
  function returnToMenuWithoutReset() {
    window.dispatchEvent(new Event('gitai:solo-pause'));
    if (soloHomeButton) soloHomeButton.hidden = true;
    showMenu();
  }
  window.addEventListener('gitai:warning-death-return', () => {
    showMenu();
    setMode('intro');
    enter.focus({ preventScroll: true });
  });
  if (backToMenu) backToMenu.addEventListener('click', returnToMenuWithoutReset);
  if (resultBackToMenu) resultBackToMenu.addEventListener('click', returnToMenuWithoutReset);
  if (soloHomeButton) soloHomeButton.addEventListener('click', returnToMenuWithoutReset);
  portal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!dialog.hidden) { event.preventDefault(); hideDialog(); }
      else if (experimentModes && !experimentModes.hidden) {
        event.preventDefault(); closeEvolutionModePicker();
      }
      else if (mode === 'menu') { event.preventDefault(); setMode('intro'); }
    }
  });
  document.addEventListener('visibilitychange', restartAnimation);
  reducedMotion.addEventListener?.('change', restartAnimation);

  portal.hidden = directSolo;
  portal.setAttribute('aria-hidden', String(directSolo));
  intro.inert = directSolo;
  menu.inert = true;
  // Direct SOLO page loads must also initialize the menu for an eventual return.
  const portalTarget = params.get('portal');
  setMode(directSolo || portalTarget === 'menu' || portalTarget === 'auto-play-environment' ? 'menu' : 'intro');
  if (directSolo) {
    active = false;
    window.cancelAnimationFrame(raf);
    raf = 0;
    if (backToMenu) backToMenu.hidden = false;
    if (soloHomeButton) soloHomeButton.hidden = Boolean(reviewOverlay?.classList.contains('visible'));
  }
  if (!directSolo && portalTarget === 'warning-tutorial') {
    if (params.get('experiment') === 'warning_color' && readNickname()) {
      // The tutorial and game now live in the SAME document. Skipping it
      // starts SOLO without destroying the audio element or resetting data.
      if (window.GitaiSoloTutorial?.open) {
        window.GitaiSoloTutorial.open({ mode: 'warning', onDone: startSolo });
      } else {
        startSolo();
      }
    } else {
      showMenu();
    }
  }
  if (!directSolo && portalTarget === 'auto-play-warning') {
    if (params.get('experiment') === 'warning_color' && readNickname()) {
      startSolo();
    } else {
      showMenu();
    }
  }
  if (!directSolo && portalTarget === 'auto-play-environment') {
    window.GitaiTrophies?.refresh?.().then((status) => {
      if (!active) return;
      const env = params.get('env') === 'sand' ? 'sand_001'
        : params.get('env') === 'bark' ? 'bark_001'
        : params.get('env') || 'kusagi_001';
      const entry = status?.environments?.find((e) => e.id === env);
      if (entry?.unlocked && entry.playable && ensureNickname()) startSolo();
      else if (readNickname()) showEnvironmentPicker();
    }).catch(showEnvironmentPicker);
  }
})();
