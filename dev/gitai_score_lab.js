(() => {
  'use strict';

  const ROOT = new URL('../', location.href);
  const GAME_WIDTH = 360;
  const GAME_HEIGHT = 640;
  const SIZE = 128;
  const HALF = SIZE / 2;
  const SAMPLE = 32;

  const previewCanvas = document.getElementById('previewCanvas');
  const previewCtx = previewCanvas.getContext('2d', { willReadFrequently: true });
  const mothCanvas = document.getElementById('mothCanvas');
  const mothCtx = mothCanvas.getContext('2d');
  const environmentSelect = document.getElementById('environmentSelect');
  const iterationsSelect = document.getElementById('iterationsSelect');
  const optimizeButton = document.getElementById('optimizeButton');
  const stopButton = document.getElementById('stopButton');
  const recalcButton = document.getElementById('recalcButton');
  const randomButton = document.getElementById('randomButton');
  const copyButton = document.getElementById('copyButton');
  const progressBar = document.getElementById('progressBar');
  const statusEl = document.getElementById('status');
  const localScoreEl = document.getElementById('localScore');
  const globalScoreEl = document.getElementById('globalScore');
  const colorScoreEl = document.getElementById('colorScore');
  const valueScoreEl = document.getElementById('valueScore');
  const textureScoreEl = document.getElementById('textureScore');
  const outlineScoreEl = document.getElementById('outlineScore');
  const targetText = document.getElementById('targetText');
  const attemptText = document.getElementById('attemptText');
  const genomeJson = document.getElementById('genomeJson');

  let appConfig = null;
  let evolutionConfig = null;
  let genetics = null;
  let environmentConfig = null;
  let backgroundImage = null;
  let backgroundPixels = null;
  let mask = null;
  let templateAlpha = null;
  let scaledForbiddenAreas = [];
  let targetTopLeft = { x: 161, y: 301 };
  let best = null;
  let stopRequested = false;
  let running = false;

  function clamp(value, minValue, maxValue) {
    return Math.max(minValue, Math.min(maxValue, Number(value)));
  }

  function clamp01(value) {
    return clamp(value, 0, 1);
  }

  function mean(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function standardDeviation(values, avg) {
    if (!values.length) return 0;
    const center = avg == null ? mean(values) : avg;
    const variance = values.reduce(
      (sum, value) => sum + (value - center) ** 2,
      0,
    ) / values.length;
    return Math.sqrt(variance);
  }

  function clampScore(value) {
    return clamp(value, 0, 100);
  }

  function scoreSimilarityDifference(diff, tolerance) {
    return clampScore(
      100 * (1 - diff / Math.max(0.0001, tolerance))
    );
  }

  function seededUnit(seed, salt) {
    const x = Math.sin((seed + 1) * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  function circularLerpDeg(a, b, t) {
    const delta = ((Number(b) - Number(a) + 540) % 360) - 180;
    return (Number(a) + delta * t + 360) % 360;
  }

  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    s = clamp01(s);
    v = clamp01(v);
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let rf = 0;
    let gf = 0;
    let bf = 0;
    if (h < 60) [rf, gf, bf] = [c, x, 0];
    else if (h < 120) [rf, gf, bf] = [x, c, 0];
    else if (h < 180) [rf, gf, bf] = [0, c, x];
    else if (h < 240) [rf, gf, bf] = [0, x, c];
    else if (h < 300) [rf, gf, bf] = [x, 0, c];
    else [rf, gf, bf] = [c, 0, x];
    return [
      Math.round((rf + m) * 255),
      Math.round((gf + m) * 255),
      Math.round((bf + m) * 255),
    ];
  }

  function setPixelMirrored(data, x, y, rgba) {
    const xr = SIZE - 1 - x;
    const write = (px) => {
      const offset = (y * SIZE + px) * 4;
      data[offset] = rgba[0];
      data[offset + 1] = rgba[1];
      data[offset + 2] = rgba[2];
      data[offset + 3] = rgba[3];
    };
    write(x);
    write(xr);
  }

  function locusExpression(locus, alleles) {
    const dosage = Number(Boolean(alleles[0])) + Number(Boolean(alleles[1]));
    if (locus.dominance === 'dominant') return dosage > 0 ? 1 : 0;
    if (locus.dominance === 'recessive') return dosage === 2 ? 1 : 0;
    return dosage / 2;
  }

  async function fetchJson(path) {
    const res = await fetch(new URL(path, ROOT), { cache: 'no-store' });
    if (!res.ok) throw new Error(path + ' を読み込めませんでした');
    return res.json();
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('画像を読み込めません: ' + url));
      image.src = url;
    });
  }

  async function loadImageData(url, width, height) {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  }

  function defaultModuleParams(id, seed) {
    const j = (salt, amount) => (seededUnit(seed, salt) * 2 - 1) * amount;
    const phase = seededUnit(seed, 90) * Math.PI * 2;

    if (id === 'central_blotch') {
      return {
        cx: clamp(0.48 + j(1, 0.12), 0.20, 0.78),
        cy: clamp(0.52 + j(2, 0.12), 0.25, 0.78),
        rx: clamp(0.22 + j(3, 0.08), 0.08, 0.38),
        ry: clamp(0.16 + j(4, 0.07), 0.06, 0.32),
        valueEffect: clamp(-0.30 + j(5, 0.14), -0.55, 0.35),
        hueEffect: j(6, 22),
        saturationEffect: j(7, 0.12),
        phase,
        angle: j(8, 18),
        frequency: clamp(1.3 + j(9, 0.4), 0.6, 2.5),
        roughness: clamp(0.18 + j(10, 0.10), 0, 0.5),
      };
    }

    if (id === 'transverse_band') {
      return {
        cx: 0.50,
        cy: clamp(0.50 + j(11, 0.16), 0.20, 0.80),
        rx: 0.50,
        ry: clamp(0.085 + j(12, 0.04), 0.035, 0.18),
        valueEffect: clamp(-0.27 + j(13, 0.15), -0.55, 0.35),
        hueEffect: j(14, 22),
        saturationEffect: j(15, 0.12),
        phase,
        angle: j(16, 10),
        frequency: clamp(1.4 + j(17, 0.5), 0.6, 3.0),
        roughness: clamp(0.18 + j(18, 0.10), 0, 0.55),
      };
    }

    if (id === 'outer_edge') {
      return {
        cx: 0.14,
        cy: 0.52,
        rx: clamp(0.18 + j(21, 0.07), 0.07, 0.34),
        ry: 0.48,
        valueEffect: clamp(-0.24 + j(22, 0.14), -0.50, 0.32),
        hueEffect: j(23, 18),
        saturationEffect: j(24, 0.10),
        phase,
        angle: j(25, 8),
        frequency: clamp(1.2 + j(26, 0.4), 0.6, 2.5),
        roughness: clamp(0.20 + j(27, 0.12), 0, 0.55),
      };
    }

    if (id === 'longitudinal_streaks') {
      return {
        cx: 0.50,
        cy: 0.50,
        rx: 0.50,
        ry: 0.50,
        valueEffect: clamp(-0.22 + j(41, 0.16), -0.52, 0.35),
        hueEffect: j(42, 20),
        saturationEffect: j(43, 0.11),
        phase,
        angle: clamp(j(44, 12), -25, 25),
        frequency: clamp(3.5 + j(45, 1.4), 1.5, 7.0),
        roughness: clamp(0.20 + j(46, 0.14), 0, 0.6),
      };
    }

    if (id === 'cloud_mottle') {
      return {
        cx: 0.50,
        cy: 0.52,
        rx: 0.50,
        ry: 0.48,
        valueEffect: clamp(-0.20 + j(51, 0.18), -0.50, 0.38),
        hueEffect: j(52, 24),
        saturationEffect: j(53, 0.13),
        phase,
        angle: j(54, 45),
        frequency: clamp(2.5 + j(55, 1.0), 1.0, 5.5),
        roughness: clamp(0.45 + j(56, 0.20), 0.10, 0.85),
      };
    }

    if (id === 'ring_spots') {
      return {
        cx: clamp(0.50 + j(61, 0.20), 0.15, 0.85),
        cy: clamp(0.50 + j(62, 0.22), 0.15, 0.85),
        rx: clamp(0.20 + j(63, 0.08), 0.07, 0.38),
        ry: clamp(0.15 + j(64, 0.07), 0.05, 0.32),
        valueEffect: clamp(-0.30 + j(65, 0.16), -0.58, 0.38),
        hueEffect: j(66, 26),
        saturationEffect: j(67, 0.14),
        phase,
        angle: j(68, 30),
        frequency: 1,
        roughness: clamp(0.12 + j(69, 0.08), 0, 0.4),
      };
    }

    if (id === 'diagonal_streak') {
      return {
        cx: clamp(0.50 + j(71, 0.14), 0.22, 0.78),
        cy: clamp(0.50 + j(72, 0.14), 0.22, 0.78),
        rx: clamp(0.09 + j(73, 0.035), 0.035, 0.18),
        ry: 0.55,
        valueEffect: clamp(-0.25 + j(74, 0.16), -0.55, 0.36),
        hueEffect: j(75, 22),
        saturationEffect: j(76, 0.12),
        phase,
        angle: clamp(35 + j(77, 22), 8, 72),
        frequency: clamp(1.2 + j(78, 0.4), 0.7, 2.4),
        roughness: clamp(0.16 + j(79, 0.10), 0, 0.5),
      };
    }

    if (id === 'chevron_pair') {
      return {
        cx: 0.50,
        cy: clamp(0.48 + j(81, 0.16), 0.20, 0.78),
        rx: 0.50,
        ry: clamp(0.055 + j(82, 0.025), 0.025, 0.12),
        valueEffect: clamp(-0.18 + j(83, 0.18), -0.48, 0.38),
        hueEffect: j(84, 24),
        saturationEffect: j(85, 0.13),
        phase,
        angle: clamp(32 + j(86, 20), 8, 68),
        frequency: clamp(1.2 + j(87, 0.35), 0.7, 2.2),
        roughness: clamp(0.16 + j(88, 0.10), 0, 0.5),
      };
    }

    if (id === 'twin_spots') {
      return {
        cx: clamp(0.50 + j(91, 0.24), 0.18, 0.86),
        cy: clamp(0.52 + j(92, 0.22), 0.18, 0.84),
        rx: clamp(0.11 + j(93, 0.05), 0.04, 0.22),
        ry: clamp(0.09 + j(94, 0.045), 0.035, 0.20),
        valueEffect: clamp(-0.20 + j(95, 0.22), -0.52, 0.44),
        hueEffect: j(96, 28),
        saturationEffect: j(97, 0.15),
        phase,
        angle: j(98, 35),
        frequency: 1,
        roughness: clamp(0.12 + j(99, 0.10), 0, 0.45),
      };
    }

    if (id === 'ripple_bands') {
      return {
        cx: 0.50,
        cy: clamp(0.52 + j(101, 0.10), 0.28, 0.72),
        rx: 0.50,
        ry: 0.50,
        valueEffect: clamp(-0.14 + j(102, 0.20), -0.44, 0.42),
        hueEffect: j(103, 24),
        saturationEffect: j(104, 0.14),
        phase,
        angle: clamp(j(105, 16), -30, 30),
        frequency: clamp(4.0 + j(106, 1.8), 1.8, 8.0),
        roughness: clamp(0.24 + j(107, 0.16), 0, 0.65),
      };
    }

    if (id === 'radial_rays') {
      return {
        cx: clamp(0.90 + j(111, 0.08), 0.72, 0.98),
        cy: clamp(0.28 + j(112, 0.10), 0.10, 0.46),
        rx: 0.50,
        ry: 0.58,
        valueEffect: clamp(-0.16 + j(113, 0.20), -0.46, 0.42),
        hueEffect: j(114, 26),
        saturationEffect: j(115, 0.15),
        phase,
        angle: j(116, 18),
        frequency: clamp(5.0 + j(117, 1.8), 2.2, 9.0),
        roughness: clamp(0.20 + j(118, 0.14), 0, 0.60),
      };
    }

    return {
      cx: clamp(0.48 + j(31, 0.18), 0.12, 0.85),
      cy: clamp(0.50 + j(32, 0.18), 0.15, 0.85),
      rx: clamp(0.30 + j(33, 0.10), 0.12, 0.48),
      ry: clamp(0.30 + j(34, 0.10), 0.12, 0.48),
      valueEffect: clamp(-0.22 + j(35, 0.16), -0.50, 0.36),
      hueEffect: j(36, 24),
      saturationEffect: j(37, 0.13),
      phase,
      angle: j(38, 25),
      frequency: clamp(4.0 + j(39, 1.4), 1.8, 8.0),
      roughness: clamp(0.52 + j(40, 0.20), 0.15, 0.9),
    };
  }

  function moduleMaskValue(id, module, xNorm, yNorm, xPx, yPx) {
    const angle = Number(module.angle || 0) * Math.PI / 180;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const dx0 = xNorm - Number(module.cx || 0.5);
    const dy0 = yNorm - Number(module.cy || 0.5);
    const u = dx0 * cosA + dy0 * sinA;
    const v = -dx0 * sinA + dy0 * cosA;
    const frequency = Math.max(0.5, Number(module.frequency || 1));
    const roughness = clamp01(Number(module.roughness || 0));
    const phase = Number(module.phase || 0);

    if (id === 'central_blotch') {
      const dx = u / Math.max(0.02, module.rx);
      const dy = v / Math.max(0.02, module.ry);
      const wobble = roughness * 0.18
        * Math.sin(Math.atan2(dy, dx) * 5 + phase);
      const d2 = dx * dx + dy * dy;
      const edge = 1 + wobble;
      return d2 >= edge ? 0 : Math.pow(1 - d2 / edge, 0.65);
    }

    if (id === 'transverse_band') {
      const wave = (0.025 + roughness * 0.035)
        * Math.sin(xNorm * Math.PI * 2 * frequency + phase);
      const center = Number(module.cy || 0.5) + wave;
      const distance = Math.abs(yNorm - center);
      if (distance >= module.ry) return 0;
      return 1 - distance / Math.max(0.01, module.ry);
    }

    if (id === 'outer_edge') {
      const distance = Math.abs(xNorm - Number(module.cx || 0.14));
      if (distance >= module.rx) return 0;
      const base = 1 - distance / Math.max(0.01, module.rx);
      const serration = 0.82 + 0.18 * Math.sin(
        yNorm * Math.PI * 2 * frequency + phase
      );
      return Math.pow(base, 0.7) * (
        (1 - roughness) + roughness * Math.max(0, serration)
      );
    }

    if (id === 'longitudinal_streaks') {
      const warpedX = xNorm
        + roughness * 0.045
        * Math.sin(yNorm * Math.PI * 2 * 1.7 + phase);
      const stripe = Math.abs(
        Math.sin((warpedX * frequency + phase / Math.PI) * Math.PI)
      );
      const sharp = Math.pow(1 - stripe, 1.8);
      return sharp > 0.18 ? (sharp - 0.18) / 0.82 : 0;
    }

    if (id === 'cloud_mottle') {
      const a = Math.sin(
        (xNorm * frequency * 1.15 + yNorm * 0.75) * Math.PI * 2 + phase
      );
      const b = Math.sin(
        (yNorm * frequency * 0.85 - xNorm * 0.55) * Math.PI * 2
        + phase * 0.73
      );
      const c = Math.sin(
        (xNorm + yNorm) * frequency * Math.PI + phase * 1.37
      );
      const cloud = (a * 0.46 + b * 0.34 + c * 0.20 + 1) / 2;
      const threshold = 0.50 - roughness * 0.10;
      return cloud > threshold
        ? Math.min(1, (cloud - threshold) / (1 - threshold))
        : 0;
    }

    if (id === 'ring_spots') {
      const dx = u / Math.max(0.02, module.rx);
      const dy = v / Math.max(0.02, module.ry);
      const radius = Math.sqrt(dx * dx + dy * dy);
      const width = 0.16 + roughness * 0.10;
      const distance = Math.abs(radius - 0.72);
      if (distance >= width) return 0;
      return 1 - distance / width;
    }

    if (id === 'diagonal_streak') {
      const halfWidth = Math.max(0.02, Number(module.rx || 0.08));
      const distance = Math.abs(u);
      if (distance >= halfWidth) return 0;
      const along = Math.abs(v) / Math.max(0.10, Number(module.ry || 0.55));
      if (along > 1) return 0;
      const waviness = 0.80 + 0.20 * Math.sin(
        v * Math.PI * 2 * frequency + phase
      );
      return (1 - distance / halfWidth)
        * (1 - along * 0.35)
        * ((1 - roughness) + roughness * Math.max(0, waviness));
    }

    if (id === 'chevron_pair') {
      const slope = Math.tan(angle) * 0.42;
      const wave = roughness * 0.025
        * Math.sin(xNorm * Math.PI * 2 * frequency + phase);
      const center = Number(module.cy || 0.5)
        + slope * (1 - xNorm) + wave;
      const distance = Math.abs(yNorm - center);
      const width = Math.max(0.018, Number(module.ry || 0.055));
      if (distance >= width) return 0;
      return Math.pow(1 - distance / width, 0.72);
    }

    if (id === 'twin_spots') {
      const dx = u / Math.max(0.025, Number(module.rx || 0.11));
      const dy = v / Math.max(0.025, Number(module.ry || 0.09));
      const d2 = dx * dx + dy * dy;
      if (d2 >= 1) return 0;
      const edgeWobble = 1
        + roughness * 0.12
        * Math.sin(Math.atan2(dy, dx) * 4 + phase);
      return d2 >= edgeWobble
        ? 0
        : Math.pow(1 - d2 / edgeWobble, 0.55);
    }

    if (id === 'ripple_bands') {
      const tiltedY = yNorm
        + Math.tan(angle) * (xNorm - 0.5) * 0.20;
      const wave = roughness * 0.035
        * Math.sin(xNorm * Math.PI * 2 * 1.35 + phase);
      const signal = Math.abs(
        Math.sin((tiltedY + wave) * Math.PI * frequency + phase)
      );
      const ridge = Math.pow(1 - signal, 2.0);
      return ridge > 0.20 ? (ridge - 0.20) / 0.80 : 0;
    }

    if (id === 'radial_rays') {
      const ox = Number(module.cx || 0.90);
      const oy = Number(module.cy || 0.28);
      const dx = xNorm - ox;
      const dy = yNorm - oy;
      const radius = Math.sqrt(dx * dx + dy * dy);
      if (radius > 0.78) return 0;
      const theta = Math.atan2(dy, dx) + angle;
      const ray = Math.abs(Math.sin(theta * frequency + phase));
      const sharp = Math.pow(1 - ray, 2.2);
      const fade = clamp01(1 - radius / 0.78);
      const modulation = (1 - roughness)
        + roughness * (0.72 + 0.28 * Math.sin(radius * 34 + phase));
      const value = sharp * (0.45 + 0.55 * fade) * modulation;
      return value > 0.16 ? (value - 0.16) / 0.84 : 0;
    }

    const dx = u / Math.max(0.03, module.rx);
    const dy = v / Math.max(0.03, module.ry);
    if (dx * dx + dy * dy > 1) return 0;
    const cellSize = Math.max(2, Math.round(9 - frequency));
    const cellX = Math.floor(xPx / cellSize);
    const cellY = Math.floor(yPx / cellSize);
    const noise = seededUnit(
      Number(module.phase || 0) * 1000 + cellX * 31 + cellY * 101,
      41,
    );
    const threshold = 0.72 - roughness * 0.22;
    return noise > threshold
      ? Math.min(1, (noise - threshold) / (1 - threshold))
      : 0;
  }

  function renderGenome(genome) {
    const child = new ImageData(SIZE, SIZE);

    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < HALF; x += 1) {
        if (!mask[y * SIZE + x]) continue;
        const alpha = templateAlpha[y * SIZE + x] || 255;
        const xNorm = x / Math.max(1, HALF - 1);
        const yNorm = y / Math.max(1, SIZE - 1);

        const smoothTexture =
          0.55 * Math.sin(
            x * 0.20
            + y * 0.055
            + Number(genome.textureSeed || 0) * 0.017
          )
          + 0.45 * Math.sin(
            y * 0.145
            - x * 0.035
            + Number(genome.textureSeed || 0) * 0.031
          );

        let hue = Number(genome.baseHue);
        let sat = Number(genome.baseSaturation);
        let value = Number(genome.baseValue)
          * (1 + smoothTexture * Number(genome.textureStrength || 0));

        const genomeModules = genome.modules || {};
        for (const locus of genetics.pattern_loci || []) {
          const module = genomeModules[locus.id];
          if (!module) continue;
          const expression = locusExpression(locus, module.alleles || [0, 0]);
          if (expression <= 0) continue;

          const maskValue = moduleMaskValue(
            locus.id,
            module,
            xNorm,
            yNorm,
            x,
            y,
          );
          if (maskValue <= 0) continue;

          const amount = expression
            * Number(genome.patternContrast || 0)
            * maskValue;
          value += Number(module.valueEffect || 0) * amount * 0.75;

          if (
            Number.isFinite(Number(module.pigmentHue))
            && Number.isFinite(Number(module.pigmentSaturation))
          ) {
            const colorMix = clamp01(
              amount * Number(genetics.pattern_pigment_mix_scale || 1.0)
            );
            hue = circularLerpDeg(
              hue,
              Number(module.pigmentHue),
              colorMix,
            );
            const patternSatCap = Number(
              genetics.pattern_pigment_saturation_cap || 0.30
            );
            const targetSat = clamp(
              Number(module.pigmentSaturation),
              0,
              patternSatCap,
            );
            sat += (targetSat - sat) * colorMix;
          } else {
            sat += Number(module.saturationEffect || 0) * amount;
            hue = (hue + Number(module.hueEffect || 0) * amount + 360) % 360;
          }
        }

        value = clamp01(value);
        sat = clamp01(sat);
        const rgb = hsvToRgb(hue, sat, value);
        setPixelMirrored(child.data, x, y, [rgb[0], rgb[1], rgb[2], alpha]);
      }
    }

    return child;
  }

  function srgbChannelToLinear(value) {
    const c = value / 255;
    return c <= 0.04045
      ? c / 12.92
      : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function rgbToLab(r, g, b) {
    const rl = srgbChannelToLinear(r);
    const gl = srgbChannelToLinear(g);
    const bl = srgbChannelToLinear(b);
    const x = (
      rl * 0.4124564
      + gl * 0.3575761
      + bl * 0.1804375
    ) / 0.95047;
    const y = (
      rl * 0.2126729
      + gl * 0.7151522
      + bl * 0.0721750
    );
    const z = (
      rl * 0.0193339
      + gl * 0.1191920
      + bl * 0.9503041
    ) / 1.08883;
    const f = (t) => t > 0.008856
      ? Math.cbrt(t)
      : (7.787 * t + 16 / 116);
    const fx = f(x);
    const fy = f(y);
    const fz = f(z);
    return [
      116 * fy - 16,
      500 * (fx - fy),
      200 * (fy - fz),
    ];
  }

  function labDistance(a, b) {
    const dl = a[0] - b[0];
    const da = a[1] - b[1];
    const db = a[2] - b[2];
    return Math.sqrt(dl * dl + da * da + db * db);
  }

  function buildMothAnalysis(imageData) {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE;
    canvas.height = SAMPLE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const src = document.createElement('canvas');
    src.width = SIZE;
    src.height = SIZE;
    src.getContext('2d').putImageData(imageData, 0, 0);
    ctx.clearRect(0, 0, SAMPLE, SAMPLE);
    ctx.drawImage(src, 0, 0, SAMPLE, SAMPLE);
    const pixels = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
    return { SAMPLE, pixels };
  }

  function analyzePlacement(mothAnalysis, x, y, size) {
    const moth = mothAnalysis.pixels;
    const mothL = new Float32Array(SAMPLE * SAMPLE);
    const bgL = new Float32Array(SAMPLE * SAMPLE);
    const alphaMask = new Uint8Array(SAMPLE * SAMPLE);
    const mothValues = [];
    const bgValues = [];
    let colorDiffSum = 0;
    let valueDiffSum = 0;
    let count = 0;

    const sampleBgRgb = (sx, sy) => {
      const px = Math.max(0, Math.min(GAME_WIDTH - 1, Math.round(sx)));
      const py = Math.max(0, Math.min(GAME_HEIGHT - 1, Math.round(sy)));
      const offset = (py * GAME_WIDTH + px) * 4;
      return [
        backgroundPixels[offset],
        backgroundPixels[offset + 1],
        backgroundPixels[offset + 2],
      ];
    };

    for (let sy = 0; sy < SAMPLE; sy += 1) {
      for (let sx = 0; sx < SAMPLE; sx += 1) {
        const i = sy * SAMPLE + sx;
        const mo = i * 4;
        const alpha = moth[mo + 3] / 255;
        if (alpha < 0.20) continue;

        alphaMask[i] = 1;
        const bx = x + (sx + 0.5) * size / SAMPLE;
        const by = y + (sy + 0.5) * size / SAMPLE;
        const bg = sampleBgRgb(bx, by);
        const mlab = rgbToLab(moth[mo], moth[mo + 1], moth[mo + 2]);
        const blab = rgbToLab(bg[0], bg[1], bg[2]);

        mothL[i] = mlab[0];
        bgL[i] = blab[0];
        mothValues.push(mlab[0]);
        bgValues.push(blab[0]);
        colorDiffSum += labDistance(mlab, blab);
        valueDiffSum += Math.abs(mlab[0] - blab[0]);
        count += 1;
      }
    }

    if (!count) {
      return { total: 0, color: 0, value: 0, texture: 0, outline: 0 };
    }

    const colorScore = scoreSimilarityDifference(colorDiffSum / count, 62);
    const valueScore = scoreSimilarityDifference(valueDiffSum / count, 38);

    const mothMeanL = mean(mothValues);
    const bgMeanL = mean(bgValues);
    const mothStd = standardDeviation(mothValues, mothMeanL);
    const bgStd = standardDeviation(bgValues, bgMeanL);

    let mothGradient = 0;
    let bgGradient = 0;
    let gradientCount = 0;
    for (let sy = 0; sy < SAMPLE - 1; sy += 1) {
      for (let sx = 0; sx < SAMPLE - 1; sx += 1) {
        const i = sy * SAMPLE + sx;
        if (
          !alphaMask[i]
          || !alphaMask[i + 1]
          || !alphaMask[i + SAMPLE]
        ) continue;
        mothGradient += (
          Math.abs(mothL[i + 1] - mothL[i])
          + Math.abs(mothL[i + SAMPLE] - mothL[i])
        ) / 2;
        bgGradient += (
          Math.abs(bgL[i + 1] - bgL[i])
          + Math.abs(bgL[i + SAMPLE] - bgL[i])
        ) / 2;
        gradientCount += 1;
      }
    }
    mothGradient /= Math.max(1, gradientCount);
    bgGradient /= Math.max(1, gradientCount);

    const contrastMatch = scoreSimilarityDifference(
      Math.abs(mothStd - bgStd),
      24,
    );
    const edgeMatch = scoreSimilarityDifference(
      Math.abs(mothGradient - bgGradient),
      13,
    );
    const textureScore = contrastMatch * 0.55 + edgeMatch * 0.45;

    let outlineDiff = 0;
    let outlineCount = 0;
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];

    for (let sy = 1; sy < SAMPLE - 1; sy += 1) {
      for (let sx = 1; sx < SAMPLE - 1; sx += 1) {
        const i = sy * SAMPLE + sx;
        if (!alphaMask[i]) continue;

        let outsideDir = null;
        for (const dir of dirs) {
          const ni = (sy + dir[1]) * SAMPLE + (sx + dir[0]);
          if (!alphaMask[ni]) {
            outsideDir = dir;
            break;
          }
        }
        if (!outsideDir) continue;

        const mo = i * 4;
        const mlab = rgbToLab(moth[mo], moth[mo + 1], moth[mo + 2]);
        const outsideX =
          x + (sx + 0.5 + outsideDir[0] * 1.25) * size / SAMPLE;
        const outsideY =
          y + (sy + 0.5 + outsideDir[1] * 1.25) * size / SAMPLE;
        const bg = sampleBgRgb(outsideX, outsideY);
        outlineDiff += labDistance(
          mlab,
          rgbToLab(bg[0], bg[1], bg[2]),
        );
        outlineCount += 1;
      }
    }

    const outlineScore = scoreSimilarityDifference(
      outlineDiff / Math.max(1, outlineCount),
      66,
    );

    const total =
      colorScore * 0.30
      + valueScore * 0.25
      + textureScore * 0.25
      + outlineScore * 0.20;

    return {
      total: clampScore(total),
      color: clampScore(colorScore),
      value: clampScore(valueScore),
      texture: clampScore(textureScore),
      outline: clampScore(outlineScore),
    };
  }

  function isInForbiddenArea(x, y, size) {
    return scaledForbiddenAreas.some((area) => !(
      x + size <= area.x
      || x >= area.x + area.width
      || y + size <= area.y
      || y >= area.y + area.height
    ));
  }

  function legalBounds() {
    const game = appConfig.game;
    const size = Number(game.display_size_px);
    const hudSafeTop =
      Number(game.hud_bar_height_px) + Number(game.hud_clearance_px);
    const hudSafeBottom =
      GAME_HEIGHT
      - Number(game.hud_bar_height_px)
      - Number(game.hud_clearance_px);
    const yMin = Math.max(
      0,
      Number(game.display_y_min_px || 0),
      hudSafeTop,
    );
    const yMax = Math.max(
      yMin,
      Math.min(
        Number(game.display_y_max_px),
        hudSafeBottom,
        GAME_HEIGHT,
      ) - size,
    );
    return {
      size,
      xMin: 0,
      xMax: GAME_WIDTH - size,
      yMin,
      yMax,
    };
  }

  function nearestLegalTopLeft(centerX, centerY) {
    const b = legalBounds();
    const initial = {
      x: clamp(centerX - b.size / 2, b.xMin, b.xMax),
      y: clamp(centerY - b.size / 2, b.yMin, b.yMax),
    };
    if (!isInForbiddenArea(initial.x, initial.y, b.size)) return initial;

    for (let radius = 4; radius <= 180; radius += 4) {
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
        const x = clamp(
          initial.x + Math.cos(angle) * radius,
          b.xMin,
          b.xMax,
        );
        const y = clamp(
          initial.y + Math.sin(angle) * radius,
          b.yMin,
          b.yMax,
        );
        if (!isInForbiddenArea(x, y, b.size)) return { x, y };
      }
    }
    return { x: b.xMin, y: b.yMin };
  }

  function scoreCandidatePositions() {
    const b = legalBounds();
    const points = [];
    const gridX = 10;
    const gridY = 10;

    for (let gy = 0; gy < gridY; gy += 1) {
      for (let gx = 0; gx < gridX; gx += 1) {
        const x = gx * b.xMax / (gridX - 1);
        const y = b.yMin + gy * (b.yMax - b.yMin) / (gridY - 1);
        if (!isInForbiddenArea(x, y, b.size)) {
          points.push({ x, y });
        }
      }
    }
    return points;
  }

  function evaluateGlobal(imageData) {
    const analysis = buildMothAnalysis(imageData);
    const size = legalBounds().size;
    const results = scoreCandidatePositions().map((point) => ({
      ...point,
      ...analyzePlacement(analysis, point.x, point.y, size),
    }));
    results.sort((a, b) => b.total - a.total);
    const top = results.slice(0, Math.min(10, results.length));
    return {
      total: mean(top.map((item) => item.total)),
      color: mean(top.map((item) => item.color)),
      value: mean(top.map((item) => item.value)),
      texture: mean(top.map((item) => item.texture)),
      outline: mean(top.map((item) => item.outline)),
      best: results[0] || null,
      count: results.length,
    };
  }

  function randomActiveAlleles(locus) {
    if (locus.dominance === 'recessive') return [1, 1];
    const r = Math.random();
    if (r < 0.35) return [1, 1];
    if (r < 0.675) return [1, 0];
    return [0, 1];
  }

  function makeRandomGenome() {
    const loci = genetics.pattern_loci || [];
    const shuffled = [...loci].sort(() => Math.random() - 0.5);
    const activeCount = Math.floor(
      Math.random() * (loci.length + 1)
    );
    const activeIds = new Set(
      shuffled.slice(0, activeCount).map((locus) => locus.id)
    );
    const modules = {};

    loci.forEach((locus, index) => {
      const seed = Math.floor(Math.random() * 10000000) + index * 997;
      const base = defaultModuleParams(locus.id, seed);
      const active = activeIds.has(locus.id);
      modules[locus.id] = {
        alleles: active ? randomActiveAlleles(locus) : [0, 0],
        ...base,
        cx: clamp(Number(base.cx) + (Math.random() * 2 - 1) * 0.08, 0.04, 0.96),
        cy: clamp(Number(base.cy) + (Math.random() * 2 - 1) * 0.08, 0.06, 0.94),
        rx: clamp(Number(base.rx) * (0.65 + Math.random() * 0.75), 0.03, 0.58),
        ry: clamp(Number(base.ry) * (0.65 + Math.random() * 0.75), 0.03, 0.60),
        valueEffect: -0.60 + Math.random() * 1.10,
        hueEffect: -80 + Math.random() * 160,
        saturationEffect: -0.38 + Math.random() * 0.76,
        pigmentHue: Math.random() * 360,
        pigmentSaturation: Math.random() * Number(
          genetics.pattern_pigment_saturation_cap || 0.85
        ),
        phase: Math.random() * Math.PI * 2,
        angle: -90 + Math.random() * 180,
        frequency: 0.5 + Math.random() * 8.5,
        roughness: Math.random() * 0.90,
      };
    });

    return {
      schema_version: 1,
      baseHue: Math.random() * 360,
      baseSaturation: Math.random() * 0.85,
      baseValue: 0.10 + Math.random() * 0.90,
      patternContrast: 0.35 + Math.random() * 0.55,
      textureStrength: Math.random() * 0.20,
      textureSeed: Math.floor(Math.random() * 10000000),
      modules,
    };
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mutateGenome(source, scale) {
    const genome = deepClone(source);
    const loci = genetics.pattern_loci || [];
    const operationCount = 1 + Math.floor(Math.random() * 4);
    const s = Math.max(0.10, Number(scale));

    for (let n = 0; n < operationCount; n += 1) {
      const op = Math.floor(Math.random() * 8);

      if (op === 0) {
        genome.baseHue = (
          genome.baseHue + (Math.random() * 2 - 1) * 70 * s + 360
        ) % 360;
      } else if (op === 1) {
        genome.baseSaturation = clamp(
          genome.baseSaturation + (Math.random() * 2 - 1) * 0.25 * s,
          0,
          0.85,
        );
      } else if (op === 2) {
        genome.baseValue = clamp(
          genome.baseValue + (Math.random() * 2 - 1) * 0.30 * s,
          0.10,
          1,
        );
      } else if (op === 3) {
        genome.patternContrast = clamp(
          genome.patternContrast + (Math.random() * 2 - 1) * 0.28 * s,
          0.06,
          0.90,
        );
      } else if (op === 4) {
        genome.textureStrength = clamp(
          genome.textureStrength + (Math.random() * 2 - 1) * 0.10 * s,
          0,
          0.20,
        );
        if (Math.random() < 0.35) {
          genome.textureSeed = Math.floor(Math.random() * 10000000);
        }
      } else {
        const locus = loci[Math.floor(Math.random() * loci.length)];
        const module = genome.modules[locus.id];
        if (!module) continue;

        if (op === 5 && Math.random() < 0.28) {
          const active = Boolean(module.alleles[0] || module.alleles[1]);
          module.alleles = active ? [0, 0] : randomActiveAlleles(locus);
        } else {
          const param = [
            'cx','cy','rx','ry','valueEffect','pigmentHue',
            'pigmentSaturation','angle','frequency','roughness'
          ][Math.floor(Math.random() * 10)];

          if (param === 'cx') {
            module.cx = clamp(module.cx + (Math.random() * 2 - 1) * 0.18 * s, 0.04, 0.96);
          } else if (param === 'cy') {
            module.cy = clamp(module.cy + (Math.random() * 2 - 1) * 0.18 * s, 0.06, 0.94);
          } else if (param === 'rx') {
            module.rx = clamp(module.rx + (Math.random() * 2 - 1) * 0.16 * s, 0.03, 0.58);
          } else if (param === 'ry') {
            module.ry = clamp(module.ry + (Math.random() * 2 - 1) * 0.16 * s, 0.03, 0.60);
          } else if (param === 'valueEffect') {
            module.valueEffect = clamp(
              module.valueEffect + (Math.random() * 2 - 1) * 0.35 * s,
              -0.65,
              0.50,
            );
          } else if (param === 'pigmentHue') {
            module.pigmentHue = (
              Number(module.pigmentHue || 0)
              + (Math.random() * 2 - 1) * 100 * s
              + 360
            ) % 360;
          } else if (param === 'pigmentSaturation') {
            module.pigmentSaturation = clamp(
              Number(module.pigmentSaturation || 0)
              + (Math.random() * 2 - 1) * 0.30 * s,
              0,
              Number(genetics.pattern_pigment_saturation_cap || 0.85),
            );
          } else if (param === 'angle') {
            module.angle = clamp(
              Number(module.angle || 0) + (Math.random() * 2 - 1) * 50 * s,
              -90,
              90,
            );
          } else if (param === 'frequency') {
            module.frequency = clamp(
              Number(module.frequency || 1) + (Math.random() * 2 - 1) * 2.5 * s,
              0.5,
              9,
            );
          } else if (param === 'roughness') {
            module.roughness = clamp(
              Number(module.roughness || 0) + (Math.random() * 2 - 1) * 0.35 * s,
              0,
              0.90,
            );
          }
        }
      }
    }

    return genome;
  }

  function evaluateLocal(genome) {
    const imageData = renderGenome(genome);
    const analysis = buildMothAnalysis(imageData);
    const metrics = analyzePlacement(
      analysis,
      targetTopLeft.x,
      targetTopLeft.y,
      legalBounds().size,
    );
    return { genome, imageData, metrics };
  }

  function putImageDataScaled(ctx, imageData, x, y, width, height) {
    const temp = document.createElement('canvas');
    temp.width = SIZE;
    temp.height = SIZE;
    temp.getContext('2d').putImageData(imageData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(temp, x, y, width, height);
  }

  function drawBackground() {
    previewCtx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    if (backgroundImage) {
      previewCtx.drawImage(backgroundImage, 0, 0, GAME_WIDTH, GAME_HEIGHT);
    } else {
      previewCtx.fillStyle = '#111';
      previewCtx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    }
  }

  function renderPreview(showMarker) {
    drawBackground();
    const b = legalBounds();

    if (best && best.imageData) {
      putImageDataScaled(
        previewCtx,
        best.imageData,
        targetTopLeft.x,
        targetTopLeft.y,
        b.size,
        b.size,
      );
    }

    if (showMarker || !best) {
      previewCtx.save();
      previewCtx.strokeStyle = '#b8f7ff';
      previewCtx.lineWidth = 1.5;
      previewCtx.strokeRect(
        targetTopLeft.x - 1,
        targetTopLeft.y - 1,
        b.size + 2,
        b.size + 2,
      );
      previewCtx.beginPath();
      previewCtx.moveTo(targetTopLeft.x + b.size / 2 - 7, targetTopLeft.y + b.size / 2);
      previewCtx.lineTo(targetTopLeft.x + b.size / 2 + 7, targetTopLeft.y + b.size / 2);
      previewCtx.moveTo(targetTopLeft.x + b.size / 2, targetTopLeft.y + b.size / 2 - 7);
      previewCtx.lineTo(targetTopLeft.x + b.size / 2, targetTopLeft.y + b.size / 2 + 7);
      previewCtx.stroke();
      previewCtx.restore();
    }
  }

  function renderBest(globalMetrics) {
    if (!best) return;
    mothCtx.clearRect(0, 0, SIZE, SIZE);
    mothCtx.putImageData(best.imageData, 0, 0);
    renderPreview(false);

    const m = best.metrics;
    localScoreEl.textContent = String(Math.round(m.total));
    colorScoreEl.textContent = String(Math.round(m.color));
    valueScoreEl.textContent = String(Math.round(m.value));
    textureScoreEl.textContent = String(Math.round(m.texture));
    outlineScoreEl.textContent = String(Math.round(m.outline));

    if (globalMetrics) {
      globalScoreEl.textContent = String(Math.round(globalMetrics.total));
    } else {
      globalScoreEl.textContent = '--';
    }

    genomeJson.value = JSON.stringify(best.genome, null, 2);
    copyButton.disabled = false;
    recalcButton.disabled = false;
  }

  async function recalcGlobal() {
    if (!best) return;
    recalcButton.disabled = true;
    statusEl.textContent = '現行GITAI SCORE v1を背景全体で計算中…';
    await new Promise((resolve) => setTimeout(resolve, 0));
    const global = evaluateGlobal(best.imageData);
    globalScoreEl.textContent = String(Math.round(global.total));
    statusEl.textContent =
      '現行GITAI SCORE v1: ' + global.total.toFixed(2)
      + ' / 評価地点 ' + global.count
      + '。選択地点スコアとは別の値です。';
    recalcButton.disabled = false;
    return global;
  }

  async function optimize() {
    if (running) return;
    running = true;
    stopRequested = false;
    optimizeButton.disabled = true;
    stopButton.disabled = false;
    environmentSelect.disabled = true;
    randomButton.disabled = true;
    recalcButton.disabled = true;
    globalScoreEl.textContent = '--';

    const iterations = Number(iterationsSelect.value || 1000);
    progressBar.max = iterations;
    progressBar.value = 0;
    attemptText.textContent = '0';

    try {
      let currentBest = best;
      if (!currentBest) {
        currentBest = evaluateLocal(makeRandomGenome());
      }

      const warmup = Math.min(80, Math.max(20, Math.floor(iterations * 0.08)));
      for (let i = 0; i < warmup; i += 1) {
        const trial = evaluateLocal(makeRandomGenome());
        if (trial.metrics.total > currentBest.metrics.total) {
          currentBest = trial;
        }
        if (i % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }

      best = currentBest;
      renderBest(null);

      for (let i = 0; i < iterations; i += 1) {
        if (stopRequested) break;

        const progress = i / Math.max(1, iterations - 1);
        const scale = Math.max(0.10, 1 - progress * 0.90);
        let candidateGenome;

        if (Math.random() < 0.075) {
          candidateGenome = makeRandomGenome();
        } else {
          candidateGenome = mutateGenome(best.genome, scale);
        }

        const candidate = evaluateLocal(candidateGenome);
        if (candidate.metrics.total > best.metrics.total) {
          best = candidate;
          renderBest(null);
        }

        progressBar.value = i + 1;
        attemptText.textContent = String(i + 1);
        if (i % 10 === 0) {
          statusEl.textContent =
            '最適化中… ' + (i + 1) + ' / ' + iterations
            + '　現在ベスト ' + best.metrics.total.toFixed(2);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      statusEl.textContent =
        (stopRequested ? '停止しました。' : '局所最適化が完了しました。')
        + ' 現行GITAI SCORE v1を計算しています…';
      renderBest(null);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const global = await recalcGlobal();
      if (global) {
        statusEl.textContent =
          (stopRequested ? '停止時点の結果。' : '最適化完了。')
          + ' 選択地点 ' + best.metrics.total.toFixed(2)
          + ' / 現行GITAI SCORE v1 ' + global.total.toFixed(2);
      }
    } catch (error) {
      console.error(error);
      statusEl.textContent = 'エラー: ' + (error.message || String(error));
    } finally {
      running = false;
      optimizeButton.disabled = false;
      stopButton.disabled = true;
      environmentSelect.disabled = false;
      randomButton.disabled = false;
      recalcButton.disabled = !best;
    }
  }

  async function showRandomGenome() {
    if (running) return;
    best = evaluateLocal(makeRandomGenome());
    renderBest(null);
    statusEl.textContent = 'ランダム個体を表示しました。';
    await recalcGlobal();
  }

  async function loadEnvironment(environmentId) {
    statusEl.textContent = '背景を読み込んでいます…';
    environmentConfig = await fetchJson(
      'environments/' + environmentId + '/environment.json'
    );
    const bgSrc = new URL(environmentConfig.background.src, ROOT).toString();
    backgroundImage = await loadImage(bgSrc);

    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = GAME_WIDTH;
    bgCanvas.height = GAME_HEIGHT;
    const bgCtx = bgCanvas.getContext('2d', { willReadFrequently: true });
    bgCtx.drawImage(backgroundImage, 0, 0, GAME_WIDTH, GAME_HEIGHT);
    backgroundPixels = bgCtx.getImageData(
      0,
      0,
      GAME_WIDTH,
      GAME_HEIGHT,
    ).data;

    const sx = GAME_WIDTH / Number(environmentConfig.background.source_width);
    const sy = GAME_HEIGHT / Number(environmentConfig.background.source_height);
    scaledForbiddenAreas = (environmentConfig.forbidden_areas || []).map((area) => ({
      x: Number(area.x) * sx,
      y: Number(area.y) * sy,
      width: Number(area.width) * sx,
      height: Number(area.height) * sy,
    }));

    targetTopLeft = nearestLegalTopLeft(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    best = null;
    localScoreEl.textContent = '--';
    globalScoreEl.textContent = '--';
    colorScoreEl.textContent = '--';
    valueScoreEl.textContent = '--';
    textureScoreEl.textContent = '--';
    outlineScoreEl.textContent = '--';
    genomeJson.value = '';
    attemptText.textContent = '0';
    updateTargetText();
    renderPreview(true);
    statusEl.textContent = '背景上をタップして目標地点を選び、「最適化開始」を押してください。';
  }

  function updateTargetText() {
    const b = legalBounds();
    const cx = targetTopLeft.x + b.size / 2;
    const cy = targetTopLeft.y + b.size / 2;
    targetText.textContent =
      '中心 x=' + cx.toFixed(1)
      + ', y=' + cy.toFixed(1)
      + ' / 左上 x=' + targetTopLeft.x.toFixed(1)
      + ', y=' + targetTopLeft.y.toFixed(1);
  }

  async function init() {
    try {
      const loaded = await Promise.all([
        fetchJson('config/konchu_univ_alpha.json'),
        fetchJson('data/evolution_models/continuous_v1/config.json'),
        fetchJson('species/moth/species.json'),
      ]);
      appConfig = loaded[0];
      evolutionConfig = loaded[1];
      genetics = evolutionConfig.trait_genetics || {};

      const parentUrl = new URL(
        loaded[2].genetics.mask_source,
        ROOT,
      ).toString();
      const parentData = await loadImageData(parentUrl, SIZE, SIZE);
      mask = new Uint8Array(SIZE * SIZE);
      templateAlpha = new Uint8Array(SIZE * SIZE);
      for (let i = 0; i < SIZE * SIZE; i += 1) {
        const alpha = parentData.data[i * 4 + 3];
        mask[i] = alpha > 0 ? 1 : 0;
        templateAlpha[i] = alpha;
      }

      await loadEnvironment(environmentSelect.value);
      optimizeButton.disabled = false;
      randomButton.disabled = false;
    } catch (error) {
      console.error(error);
      statusEl.textContent = '初期化エラー: ' + (error.message || String(error));
    }
  }

  previewCanvas.addEventListener('pointerdown', (event) => {
    if (running) return;
    const rect = previewCanvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * GAME_WIDTH / rect.width;
    const y = (event.clientY - rect.top) * GAME_HEIGHT / rect.height;
    targetTopLeft = nearestLegalTopLeft(x, y);
    best = null;
    genomeJson.value = '';
    localScoreEl.textContent = '--';
    globalScoreEl.textContent = '--';
    colorScoreEl.textContent = '--';
    valueScoreEl.textContent = '--';
    textureScoreEl.textContent = '--';
    outlineScoreEl.textContent = '--';
    updateTargetText();
    renderPreview(true);
    recalcButton.disabled = true;
    copyButton.disabled = true;
    statusEl.textContent = '目標地点を変更しました。「最適化開始」を押してください。';
  });

  environmentSelect.addEventListener('change', async () => {
    if (running) return;
    await loadEnvironment(environmentSelect.value);
  });

  optimizeButton.addEventListener('click', optimize);

  stopButton.addEventListener('click', () => {
    stopRequested = true;
    stopButton.disabled = true;
  });

  recalcButton.addEventListener('click', recalcGlobal);
  randomButton.addEventListener('click', showRandomGenome);

  copyButton.addEventListener('click', async () => {
    if (!best) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(best.genome, null, 2)
      );
      statusEl.textContent = 'ベスト個体のJSONをコピーしました。';
    } catch (_) {
      genomeJson.focus();
      genomeJson.select();
      statusEl.textContent = 'JSONを選択しました。コピーしてください。';
    }
  });

  init();
})();
