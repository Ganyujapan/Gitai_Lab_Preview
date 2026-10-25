/* Exhibition-only handover controller: never alters the production game engine. */
(() => {
  'use strict';
  const home = new URL('./', location.href);
  // Only the first exhibition entry displays the seven-page warning tutorial.
  // Remove its route flag without navigation, so page reloads at generation
  // boundaries never replay the tutorial and never reset exhibit evolution.
  const route = new URL(location.href);
  const showWarningTutorial = route.searchParams.get('tutorial') === '1'
    && route.searchParams.get('experiment') === 'warning_color';
  if (showWarningTutorial) {
    route.searchParams.delete('tutorial');
    history.replaceState(history.state, '', route.toString());
    document.addEventListener('DOMContentLoaded', () => {
      window.GitaiSoloTutorial?.open({ mode: 'warning' });
    }, { once: true });
  }
  const startLabel = document.getElementById('startGeneration');
  const reviewLabel = document.getElementById('reviewGeneration');
  const startOverlay = document.getElementById('startOverlay');
  const reviewOverlay = document.getElementById('reviewOverlay');
  const continueButton = document.getElementById('continueButton');
  let firstGeneration = null;
  let handoverPending = false;

  const button = document.createElement('button');
  button.id = 'exhibitHandover';
  button.type = 'button';
  button.hidden = true;
  button.textContent = '次の人へ交代 →';
  const notice = document.createElement('div');
  notice.id = 'exhibitHandoverNotice';
  notice.hidden = true;
  notice.textContent = '5世代が終了しました。次の人へ交代できます。';
  document.body.append(button, notice);

  function numberFrom(node) {
    const match = (node?.textContent || '').match(/(?:GENERATION|第)\s*(\d+)/i);
    return match ? Number(match[1]) : null;
  }
  function boundary() {
    return startOverlay?.classList.contains('visible') ||
      reviewOverlay?.classList.contains('visible');
  }
  function sync() {
    button.hidden = handoverPending || !boundary();
    if (firstGeneration == null) {
      firstGeneration = numberFrom(startLabel) || numberFrom(reviewLabel);
    }
    const current = numberFrom(reviewLabel);
    notice.hidden = !boundary() || handoverPending || !current ||
      !firstGeneration || current - firstGeneration + 1 < 5;
  }

  async function savedGeneration() {
    const dbName = window.GitaiPagesPreview?.context?.storageNamespace;
    if (!dbName) throw new Error('進化データの保存先が不明です。');
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 2);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        try {
          const tx = db.transaction('meta', 'readonly');
          const get = tx.objectStore('meta').get('current_generation_id');
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(get.error);
        } catch (error) { reject(error); }
        finally { db.close(); }
      };
    });
  }
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  async function safelyHandover() {
    if (handoverPending || !boundary()) return;
    handoverPending = true;
    sync();
    try {
      if (reviewOverlay.classList.contains('visible')) {
        // The stock game does NOT commit a generation when the review first
        // appears. It writes the next generation after "generate" is pressed.
        const previous = await savedGeneration();
        const action = continueButton.textContent || '';
        if (action.includes('次の世代を生成') ||
            action.includes('もう一度送信')) {
          if (continueButton.disabled) throw new Error('次世代を生成できません。');
          button.hidden = false;
          button.disabled = true;
          button.textContent = '進化データを保存中…';
          continueButton.click();
          let committed = false;
          for (let i = 0; i < 180; i += 1) {
            await delay(500);
            const next = await savedGeneration();
            if (next !== previous && /^gen\d{5}$/.test(String(next))) {
              committed = true;
              break;
            }
          }
          if (!committed) {
            throw new Error('世代の保存完了を確認できませんでした。スタッフへお知らせください。');
          }
        } else if (action.includes('同じ世代') || action.includes('最新世代')) {
          // Invalid/stale result: no completed offspring to save.
        } else {
          throw new Error('現在は交代できません。次世代生成後に再度お試しください。');
        }
      }
      location.assign(home.href);
    } catch (error) {
      console.error(error);
      alert(String(error?.message || error));
      button.disabled = false;
      button.textContent = '次の人へ交代 →';
      handoverPending = false;
      sync();
    }
  }
  button.addEventListener('click', safelyHandover);
  // Class transitions are used by the existing game to open/close overlays.
  new MutationObserver(sync).observe(document.body, {
    subtree: true, attributes: true, attributeFilter: ['class'],
    childList: true, characterData: true
  });
  sync();

  // Built-in menu routes must never navigate back to the normal public portal.
  for (const id of ['soloHomeButton', 'resultBackToMenu', 'backToMenu']) {
    document.getElementById(id)?.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      safelyHandover();
    }, true);
  }
  document.getElementById('resetConfirmButton')?.setAttribute('disabled', 'true');
  window.addEventListener('gitai:warning-death-return', () => location.assign(home.href));
})();
