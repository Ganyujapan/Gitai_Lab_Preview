/* GITAI LAB — motion study 01.
   Goal: test the feel of layered, continuously moving vector illustrations.
   Animation and illustration markup are intentionally decoupled so that
   client-provided / generated SVG assets can be swapped individually.
   This experiment does not touch the evolution engine or saved state.
*/
(() => {
  'use strict';

  const root = document.getElementById('motionHome');
  const scene = document.getElementById('kineticScene');
  const toggle = document.getElementById('motionToggle');
  const label = document.getElementById('motionToggleLabel');
  const start = document.getElementById('startExperience');
  if (!root || !scene || !toggle || !start) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const drawings = [...scene.querySelectorAll('[data-motion]')];
  const config = {
    'halo':      {x:10, y:12, r: 2, speed:.32,phase:.3, depth:.5},
    'orbit':     {x:14, y:13, r: 8, speed:.23,phase:2.0,depth:.75},
    'disc':      {x:16, y:18, r:-4, speed:.36,phase:2.9,depth:.4},
    'branch':    {x:27, y:27, r:13, speed:.41,phase:4.3,depth:1.3},
    'leaf-one':  {x:36, y:25, r:28, speed:.49,phase:.7,depth:1.8},
    'leaf-two':  {x:45, y:33, r:-31,speed:.35,phase:3.1,depth:2.2},
    'flower':    {x:30, y:20, r:20, speed:.29,phase:4.8,depth:1.8},
    'moth':      {x:26, y:20, r: 7, speed:.39,phase:2.3,depth:1.3},
    'tag':       {x:22, y:15, r: 5, speed:.23,phase:1.2,depth:1.0},
    'spark-one': {x:48, y:41, r:40, speed:.42,phase:4.4,depth:2.3},
    'spark-two': {x:38, y:36, r:-28,speed:.51,phase:1.4,depth:2.1},
    'star':      {x:31, y:20, r:25, speed:.37,phase:3.3,depth:1.4}
  };

  const sprites = drawings.map(node => ({
    node,
    motion: config[node.dataset.motion] || config['moth']
  }));

  let preset = 'float';
  let raf = 0;
  let timeOrigin = 0;
  let elapsedWhenHidden = 0;
  let lastFrame = 0;
  let pointerX = 0;
  let pointerY = 0;
  let pointerTargetX = 0;
  let pointerTargetY = 0;
  let leaving = false;

  function motionFrame(now) {
    raf = 0;
    if (document.hidden || leaving) return;

    if (!timeOrigin) timeOrigin = now - elapsedWhenHidden;
    const t = (now - timeOrigin) / 1000;
    const dt = lastFrame ? Math.min(.075, (now - lastFrame) / 1000) : .017;
    lastFrame = now;
    const easing = 1 - Math.exp(-dt * 5.6);
    pointerX += (pointerTargetX - pointerX) * easing;
    pointerY += (pointerTargetY - pointerY) * easing;

    const multiplier = Math.max(.57, Math.min(1.20, scene.clientWidth / 550));
    for (const sprite of sprites) {
      const p = sprite.motion;
      const k = p.speed;
      const phase = p.phase;
      let dx, dy, angle;
      if (preset === 'flow') {
        // Larger, crossing horizontal paths (kinetic editorial arrangement).
        // Different speeds/phases avoid mechanical synchronisation.
        dx = Math.sin(t * k * 1.44 + phase) * p.x * 2.7
             + Math.sin(t * k * .53 + phase * 2) * p.x * .53;
        dy = Math.cos(t * k * .82 + phase * .75) * p.y * 1.7;
        angle = Math.sin(t * k * .65 + phase) * p.r * 1.25;
      } else {
        // Broad, quiet, independent drifting motions.
        dx = Math.sin(t * k + phase) * p.x
             + Math.cos(t * k * .48 + phase * 1.7) * p.x * .30;
        dy = Math.cos(t * k * .78 + phase * .9) * p.y;
        angle = Math.sin(t * k * .72 + phase) * p.r;
      }
      dx += pointerX * (p.depth * 6.6);
      dy += pointerY * (p.depth * 4.3);
      sprite.node.style.transform =
        'translate3d(' + (dx * multiplier).toFixed(2) + 'px,' +
          (dy * multiplier).toFixed(2) + 'px,0) rotate(' + angle.toFixed(2) + 'deg)';
    }
    raf = window.requestAnimationFrame(motionFrame);
  }

  function stop() {
    window.cancelAnimationFrame(raf);
    raf = 0;
  }

  function resume() {
    stop();
    lastFrame = 0;
    if (leaving || document.hidden) return;
    if (reducedMotion.matches) {
      for (const sprite of sprites) sprite.node.style.transform = '';
      pointerX = pointerY = 0;
      return;
    }
    // Start at a shared relative time, including after returning from another tab.
    timeOrigin = 0;
    elapsedWhenHidden = 0;
    raf = window.requestAnimationFrame(motionFrame);
  }

  function changeMode() {
    preset = preset === 'float' ? 'flow' : 'float';
    root.dataset.preset = preset;
    const flow = preset === 'flow';
    label.textContent = flow ? 'FLOW' : 'DRIFT';
    toggle.setAttribute('aria-pressed', String(flow));
  }

  function enterLab() {
    if (leaving) return;
    leaving = true;
    stop();
    root.classList.add('is-leaving');
    const url = '../?model=continuous_v1&portal=menu&v=20261015-motion01';
    if (reducedMotion.matches) {
      window.location.assign(url);
    } else {
      window.setTimeout(() => window.location.assign(url), 680);
    }
  }

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    changeMode();
  });
  start.addEventListener('click', (event) => {
    event.preventDefault();
    enterLab();
  });

  // Same one-tap entrance behaviour as the previous concept.
  root.addEventListener('click', (event) => {
    if (event.target.closest('button,a')) return;
    enterLab();
  });
  scene.addEventListener('pointermove', (event) => {
    if (reducedMotion.matches || event.pointerType === 'touch') return;
    const r = scene.getBoundingClientRect();
    if (!r.width || !r.height) return;
    pointerTargetX = Math.max(-1, Math.min(1, (event.clientX - r.left) / r.width * 2 - 1));
    pointerTargetY = Math.max(-1, Math.min(1, (event.clientY - r.top) / r.height * 2 - 1));
  }, {passive:true});
  scene.addEventListener('pointerleave', () => {
    pointerTargetX = 0;
    pointerTargetY = 0;
  }, {passive:true});

  document.addEventListener('visibilitychange', resume);
  reducedMotion.addEventListener?.('change', resume);
  resume();

  // UI for screenshot comparisons / deterministic preview support.
  window.gitaiMotionStudy = {
    get preset() { return preset; },
    pause: stop,
    play: resume,
    setMode(value) { if (value !== 'float' && value !== 'flow') return; if (value !== preset) changeMode(); }
  };
})();