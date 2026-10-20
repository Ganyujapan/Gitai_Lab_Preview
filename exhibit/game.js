/* Runs only in the duplicated /exhibit/game.html; no normal-game source is changed. */
(() => {
  'use strict';
  const menuUrl = new URL('./', location.href);
  let entryGeneration = null;
  const startLabel = document.getElementById('startGeneration');
  const reviewLabel = document.getElementById('reviewGeneration');
  const button = document.createElement('button');
  button.id = 'exhibitHandover';
  button.type = 'button';
  button.hidden = true;
  button.textContent = '次の人へ交代 →';
  const notice = document.createElement('div');
  notice.id = 'exhibitHandoverNotice';
  notice.hidden = true;
  notice.textContent = '5世代のプレイが終了しました。次の人へ交代できます。';
  document.body.append(button, notice);

  function generationNumber(node) {
    const text = node?.textContent || '';
    const match = text.match(/(?:GENERATION|第)\s*(\d+)/i);
    return match ? Number(match[1]) : null;
  }
  function safeBoundary() {
    return ['startOverlay', 'reviewOverlay', 'evolutionOverlay']
      .some(id => document.getElementById(id)?.classList.contains('visible'));
  }
  function sync() {
    const onBoundary = safeBoundary();
    button.hidden = !onBoundary;
    if (entryGeneration == null) {
      entryGeneration = generationNumber(startLabel) || generationNumber(reviewLabel);
    }
    const current = generationNumber(reviewLabel);
    notice.hidden = !onBoundary || !current || !entryGeneration || current - entryGeneration + 1 < 5;
  }
  button.addEventListener('click', () => {
    // Available only at a safe boundary, never during a round/save transition.
    if (!safeBoundary()) return;
    location.assign(menuUrl.href);
  });
  // Hide all game preview controls, including dynamic badges added after boot.
  const observer = new MutationObserver(sync);
  observer.observe(document.body, {
    subtree: true, attributes: true, attributeFilter: ['class'],
    childList: true, characterData: true
  });
  sync();
  // Redirect the built-in return controls if they become reachable.
  for (const id of ['soloHomeButton', 'resultBackToMenu', 'backToMenu']) {
    document.getElementById(id)?.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (safeBoundary()) location.assign(menuUrl.href);
    }, true);
  }
  // Lock reset confirmation out of visitor UI. This is kiosk protection, not cryptographic authentication.
  document.getElementById('resetConfirmButton')?.setAttribute('disabled', 'true');
  window.addEventListener('gitai:warning-death-return', () => location.assign(menuUrl.href));
})();
