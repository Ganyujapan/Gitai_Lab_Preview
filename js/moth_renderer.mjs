// Drawing functions copied verbatim from dev/gitai_score_lab.js; keep the source unchanged.
// Independent schema_version:1 renderer. No evolution or persistence side effects.
import './mask_data.js';
const SIZE=128, HALF=64;
let genetics, mask, templateAlpha, initialization;
const root=new URL('../',import.meta.url);
async function initialize(){
  const response=await fetch(new URL('data/evolution_models/continuous_v1/config.json',root));
  if(!response.ok)throw Error('描画設定を読み込めません');
  const config=await response.json();
  if(config.config_id!=='continuous_v1_frozen_v23')throw Error('未対応の描画設定です');
  genetics=config.trait_genetics;
  const image=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('輪郭画像を読み込めません'));i.src=window.GitaiPreviewMaskDataUri;});
  const canvas=document.createElement('canvas');canvas.width=canvas.height=SIZE;
  const context=canvas.getContext('2d');context.drawImage(image,0,0,SIZE,SIZE);
  const data=context.getImageData(0,0,SIZE,SIZE).data;
  mask=new Uint8Array(SIZE*SIZE);templateAlpha=new Uint8Array(SIZE*SIZE);
  for(let i=0;i<mask.length;i++){templateAlpha[i]=data[i*4+3];mask[i]=templateAlpha[i]>0?1:0;}
}
function ready(){return initialization ||= initialize().catch(e=>{initialization=null;throw e;});}
export function parseGenome(input){
  const g=typeof input==='string'?JSON.parse(input):JSON.parse(JSON.stringify(input));
  if(!g||Array.isArray(g)||Number(g.schema_version)!==1||!g.modules||typeof g.modules!=='object'||Array.isArray(g.modules))throw Error('schema_version: 1 のGenome JSONを入力してください');
  for(const key of ['baseHue','baseSaturation','baseValue'])if(g[key]===null||g[key]===''||!Number.isFinite(Number(g[key])))throw Error(key+' が不正です');
  for(const key of ['patternContrast','textureStrength','textureSeed'])if(g[key]!==undefined&&(g[key]===null||!Number.isFinite(Number(g[key]))))throw Error(key+' が不正です');
  for(const [key,v] of Object.entries(g)){if(typeof v==='number'&&!Number.isFinite(v))throw Error(key+' が不正です');}
  for(const [id,m] of Object.entries(g.modules)){
    if(!m||typeof m!=='object'||Array.isArray(m))throw Error(id+' が不正です');
    for(const [key,v] of Object.entries(m))if(key!=='alleles'&&(v===null||typeof v==='object'||!Number.isFinite(Number(v))))throw Error(id+'.'+key+' が不正です');
    if(m.alleles&&(!Array.isArray(m.alleles)||m.alleles.length!==2||!m.alleles.every(a=>a===0||a===1)))throw Error(id+' のallelesが不正です');
    for(const key of ['rx','ry'])if(!Number.isFinite(Number(m[key]))||Number(m[key])<=0)throw Error(id+'.'+key+' が不正です');
  }
  return g;
}
export async function renderImageData(input){const g=parseGenome(input);await ready();return renderGenome(g);}
export async function renderToCanvas(input){const data=await renderImageData(input);const c=document.createElement('canvas');c.width=c.height=SIZE;c.getContext('2d').putImageData(data,0,0);return c;}
export async function toPNG(input){const c=await renderToCanvas(input);return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('PNG生成に失敗しました')),'image/png'));}

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
