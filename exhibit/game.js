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
  const VISIT_KEY = 'gitai-exhibit-visit-start-v1';
  const HANDOVER_KEY = 'gitai-exhibit-handover-v1';
  const mode = route.searchParams.get('experiment') === 'warning_color'
    ? 'warning' : 'cryptic';
  let firstGeneration = null;
  let handoverPending = false;
  try {
    const saved = JSON.parse(sessionStorage.getItem(VISIT_KEY) || 'null');
    if (saved?.mode === mode && Number.isInteger(saved.start) && saved.start > 0) {
      firstGeneration = saved.start;
    }
  } catch (_) {}

  // Only at generation results: never a floating button during actual play.
  const button = document.createElement('button');
  button.id = 'exhibitHandover';
  button.type = 'button';
  button.hidden = true;
  button.textContent = '次の人へ変わる';
  reviewOverlay?.querySelector('.review-actions')?.insertAdjacentElement('afterend', button);
  const notice = document.createElement('p');
  notice.id = 'exhibitHandoverNotice';
  notice.hidden = true;
  notice.textContent = '5世代おつかれさま！「次へ」で進化シアターを再生します。';
  reviewOverlay?.querySelector('.review-actions')?.insertAdjacentElement('beforebegin', notice);

  function numberFrom(node) {
    const match = (node?.textContent || '').match(/(?:GENERATION|第)\s*(\d+)/i);
    return match ? Number(match[1]) : null;
  }
  function ensureVisitorStart() {
    const current = numberFrom(startLabel) || numberFrom(reviewLabel);
    if (current === null) return;
    if (firstGeneration === null || current < firstGeneration) {
      firstGeneration = current;
      try { sessionStorage.setItem(VISIT_KEY, JSON.stringify({ mode, start: current })); } catch (_) {}
    }
  }
  function sync() {
    ensureVisitorStart();
    const atReview = !!reviewOverlay?.classList.contains('visible');
    const completed = numberFrom(reviewLabel);
    const valid = atReview && completed !== null && firstGeneration !== null
      && completed >= firstGeneration
      && !continueButton.disabled
      && /^(次の世代を生成|次へ（進化シアター）)$/.test(continueButton.textContent.trim());
    const finishedFive = valid && completed - firstGeneration + 1 >= 5;
    button.hidden = !valid || finishedFive || handoverPending;
    notice.hidden = !finishedFive || handoverPending;
    if (finishedFive && !handoverPending
        && continueButton.textContent !== '次へ（進化シアター）') {
      continueButton.textContent = '次へ（進化シアター）';
    }
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

  // In the warning experiment, the main game writes its remaining life only
  // AFTER the offspring's IndexedDB transaction commits. Resetting at the
  // first sight of the new DB pointer would race with that ordinary write
  // and could leave the next visitor with the previous visitor's low life.
  // The generation-ready button becomes unhidden only after the game's
  // life-saving step has completed. This waits for BOTH, not just the DB.
  async function resetWarningLifeForNextVisitor(nextGenerationId) {
    if (mode !== 'warning') return;
    const initial = window.GitaiWarningColor?.LIFE_INITIAL_THIRDS;
    if (initial !== 30) {
      throw Error('ライフ初期値を確認できません。スタッフにお知らせください。');
    }
    const readyButton = document.getElementById('generationContinueButton');
    let gameReady = false;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      if (readyButton?.hidden === false) {
        gameReady = true;
        break;
      }
      await delay(500);
    }
    if (!gameReady) {
      throw Error('次世代のライフ保存完了を確認できませんでした。スタッフにお知らせください。');
    }
    const namespace = window.GitaiPagesPreview?.context?.storageNamespace;
    if (!namespace || await savedGeneration() !== nextGenerationId) {
      throw Error('交代前に世代番号が変更されました。ライフは変更していません。');
    }
    const key = 'gitai-warning-life-v1:' + namespace;
    const freshLife = JSON.stringify({
      generation_id: nextGenerationId,
      thirds: initial
    });
    try {
      localStorage.setItem(key, freshLife);
      if (localStorage.getItem(key) !== freshLife) {
        throw Error('保存結果が一致しません。');
      }
    } catch (error) {
      throw Error('次の来場者のライフ10を保存できませんでした。'
        + '進化データは保存済みの可能性があります。スタッフにお知らせください。');
    }
  }

  async function safelyHandover() {
    if (handoverPending || !reviewOverlay?.classList.contains('visible')) return;
    ensureVisitorStart();
    const completed = numberFrom(reviewLabel);
    if (!completed || !firstGeneration || completed < firstGeneration
      || continueButton.disabled
      || !/^(次の世代を生成|次へ（進化シアター）)$/.test(continueButton.textContent.trim())) return;
    handoverPending = true;
    button.disabled = true;
    button.textContent = '進化データを保存中…';
    sync();
    try {
      // In the real simulator, the offspring generation is written only AFTER
      // the result's "next generation" action. Do not hand over incomplete data.
      const previous = await savedGeneration();
      continueButton.click();
      let committedGeneration = null;
      for (let i = 0; i < 180; i += 1) {
        await delay(500);
        const next = await savedGeneration();
        if (/^gen(?:\d{5}|[1-9]\d{5,})$/.test(String(next)) && Number(next.slice(3)) > completed
          && next !== previous) {
          committedGeneration = next;
          break;
        }
        // A failed/invalid mutation returns to the result panel; do not
        // navigate away or claim its uncommitted generation succeeded.
        if (reviewOverlay.classList.contains('visible')
            && /^(同じ世代|最新世代|もう一度送信|容量確認)/.test(continueButton.textContent)) {
          break;
        }
      }
      if (!committedGeneration) throw Error('世代の保存完了を確認できませんでした。スタッフへお知らせください。');
      // Visitor-specific lives reset ONLY for a completed handover. The
      // evolution DB, genomes, images, history and ordinary continuous play
      // remain unchanged. Never reset on unsuccessful evolution or retry.
      await resetWarningLifeForNextVisitor(committedGeneration);
      sessionStorage.setItem(HANDOVER_KEY, JSON.stringify({
        mode, start: firstGeneration, end: completed
      }));
      // This visitor has now finished. Do NOT wait until they watch the
      // closing theater and press its final Next button to reset the visit
      // counter: Safari may be closed or backgrounded during playback.
      // The independent HANDOVER_KEY still lets the next page show this
      // visitor's generations without reopening or modifying their data.
      sessionStorage.removeItem(VISIT_KEY);
      const nextPage = new URL('modes.html', home.href);
      nextPage.searchParams.set('handover', '1');
      location.assign(nextPage.href);
    } catch (error) {
      console.error(error);
      alert(String(error?.message || error));
      button.disabled = false;
      button.textContent = '次の人へ変わる';
      handoverPending = false;
      sync();
    }
  }
  button.addEventListener('click', safelyHandover);
  // The fifth result's normal "Next" action is replaced by the handover flow.
  // Programmatic click from safelyHandover passes because handoverPending=true.
  continueButton?.addEventListener('click', event => {
    const completed = numberFrom(reviewLabel);
    if (!handoverPending && reviewOverlay?.classList.contains('visible')
      && completed && firstGeneration && completed - firstGeneration + 1 >= 5
      && continueButton.textContent === '次へ（進化シアター）') {
      event.preventDefault();
      event.stopImmediatePropagation();
      void safelyHandover();
    }
  }, true);
  new MutationObserver(sync).observe(document.body, {
    subtree: true, attributes: true, attributeFilter: ['class'],
    childList: true, characterData: true
  });
  window.addEventListener('gitai:solo-assets-ready', sync);
  sync();

  // Exhibition game HTML inherits #portalBackToMenu (not #backToMenu).
  // The production handler pauses SOLO and shows its hidden portal.
  // Intercept in capture phase to prevent a paused, invisible screen.
  document.getElementById('portalBackToMenu')?.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (handoverPending) return;
    if (startOverlay?.classList.contains('visible')
        && !reviewOverlay?.classList.contains('visible')) {
      // Start-screen return never discards a saved generation.
      location.assign(home.href);
    }
  }, true);

  // Defensive interception for other portal controls, hidden in exhibition.
  for (const id of ['soloHomeButton', 'resultBackToMenu']) {
    document.getElementById(id)?.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!handoverPending && reviewOverlay?.classList.contains('visible')) {
        void safelyHandover();
      }
    }, true);
  }
  document.getElementById('resetConfirmButton')?.setAttribute('disabled', 'true');
  window.addEventListener('gitai:warning-death-return', () => location.assign(home.href));
})();
