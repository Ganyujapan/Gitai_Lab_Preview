/* GITAI LAB landing-page moth generator.
 * Copied function-for-function from CALIBRATION LAB's makeRandomGenome()
 * and renderGenome() on 2026-10-15, including both parents' alpha mask.
 *
 * This is a *separate, read-only* decoration engine. It never writes scores,
 * histories, IndexedDB, or the active game population.
 * Source of truth for the corresponding genetics: dev/gitai_score_lab.js.
 */
(() => {
  'use strict';
  const SIZE = 128;
  const HALF = SIZE / 2;
  let genetics = null;
  let mask = null;
  let templateAlpha = null;
  const imageCanvas = document.createElement('canvas');
  imageCanvas.width = SIZE;
  imageCanvas.height = SIZE;
  const imageCtx = imageCanvas.getContext('2d');
  let initialized = false;
  let pending = null;

  function clamp(value, minValue, maxValue) {
    return Math.max(minValue, Math.min(maxValue, Number(value)));
  }

  function clamp01(value) {
    return clamp(value, 0, 1);
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

  async function fetchJson(path) {
    const res = await fetch(new URL(path, document.baseURI), { cache: 'force-cache' });
    if (!res.ok) throw new Error('ギタイラボ素材を読み込めませんでした: ' + path);
    return res.json();
  }

  function loadImage(sourceUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('蛾の形状データを読み込めませんでした'));
      image.src = sourceUrl;
    });
  }

  async function initialize() {
    if (initialized) return;
    if (pending) return pending;
    pending = (async () => {
      const [evolution, species] = await Promise.all([
        fetchJson('data/evolution_models/continuous_v1/config.json'),
        fetchJson('species/moth/species.json'),
      ]);
      const localGenetics = evolution.trait_genetics || {};
      if (!Array.isArray(localGenetics.pattern_loci) || !localGenetics.pattern_loci.length) {
        throw new Error('模様生成設定がありません');
      }
      const shape = await loadImage(
        window.GitaiPreviewMaskDataUri
        || new URL(species.genetics.mask_source, document.baseURI).toString()
      );
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = SIZE;
      tempCanvas.height = SIZE;
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      tempCtx.clearRect(0, 0, SIZE, SIZE);
      tempCtx.drawImage(shape, 0, 0, SIZE, SIZE);
      const source = tempCtx.getImageData(0, 0, SIZE, SIZE).data;
      const currentMask = new Uint8Array(SIZE * SIZE);
      const currentAlpha = new Uint8Array(SIZE * SIZE);
      let filled = 0;
      for (let i = 0; i < SIZE * SIZE; i += 1) {
        const alpha = source[i * 4 + 3];
        currentMask[i] = alpha > 0 ? 1 : 0;
        currentAlpha[i] = alpha;
        filled += currentMask[i];
      }
      if (filled < 200) throw new Error('蛾の形状マスクが空です');
      genetics = localGenetics;
      mask = currentMask;
      templateAlpha = currentAlpha;
      initialized = true;
    })();
    try {
      await pending;
    } catch (error) {
      pending = null;
      throw error;
    }
  }

  // Static examples for the evolution-mode menu. The shapes and markings are
  // drawn through the SAME 128px genome renderer/mask as playable moths.
  // They are illustrative, not saved to the game or selected for breeding.
  function makeExperimentExampleGenome(kind) {
    const activeIds = kind === 'warning'
      ? new Set(['twin_spots', 'transverse_band', 'outer_edge'])
      : kind === 'cryptic'
        ? new Set(['cloud_mottle', 'longitudinal_streaks'])
        : new Set();
    const seed = kind === 'white' ? 101 : kind === 'cryptic' ? 402 : 803;
    const modules = {};
    for (const locus of genetics.pattern_loci || []) {
      const params = defaultModuleParams(locus.id, seed);
      const active = activeIds.has(locus.id);
      modules[locus.id] = {
        ...params,
        alleles: active ? [1, 1] : [0, 0],
        ...(active ? {
          valueEffect: kind === 'warning' ? -0.78 : -0.24,
          pigmentHue: kind === 'warning' ? 7 : 123,
          pigmentSaturation: kind === 'warning' ? 0.5 : 0.32,
        } : {}),
      };
    }
    return {
      schema_version: 1,
      baseHue: kind === 'warning' ? 8 : kind === 'cryptic' ? 128 : 0,
      baseSaturation: kind === 'warning' ? 0.85 : kind === 'cryptic' ? 0.42 : 0,
      baseValue: kind === 'warning' ? 0.93 : kind === 'cryptic' ? 0.48 : 1,
      patternContrast: kind === 'warning' ? 0.96 : 0.65,
      textureStrength: kind === 'white' ? 0 : 0.08,
      textureSeed: seed,
      modules,
    };
  }

  function experimentExamples() {
    if (!initialized) return null;
    // Keep the title animation's imageCanvas untouched when menu opens.
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = SIZE;
    previewCanvas.height = SIZE;
    const previewCtx = previewCanvas.getContext('2d');
    if (!previewCtx) return null;
    const images = {};
    for (const kind of ['white', 'cryptic', 'warning']) {
      previewCtx.putImageData(renderGenome(makeExperimentExampleGenome(kind)), 0, 0);
      images[kind] = previewCanvas.toDataURL('image/png');
    }
    return images;
  }

  function next() {
    if (!initialized) return null;
    // One full random draw: *no* survival selection, mutation from the last
    // landing-page moth, GITAI SCORE optimization or other bias.
    const genome = makeRandomGenome();
    imageCtx.putImageData(renderGenome(genome), 0, 0);
    return imageCanvas;
  }

  window.GitaiPortalRandomMoth = Object.freeze({
    initialize, next, experimentExamples,
    get ready() { return initialized; }
  });
})();
