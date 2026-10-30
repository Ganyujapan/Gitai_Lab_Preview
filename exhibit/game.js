/* Exhibition-only handover controller: never alters the production game engine. */
(() => {
  'use strict';
  const home = new URL('./', location.href);
  // Show the selected mode's tutorial only at visitor entry, never on
  // generation reloads. Removing the flag does not alter persisted evolution.
  const route = new URL(location.href);
  const tutorialMode = route.searchParams.get('tutorial') === '1'
    ? (route.searchParams.get('experiment') === 'warning_color' ? 'warning' : 'solo')
    : null;
  if (tutorialMode) {
    route.searchParams.delete('tutorial');
    history.replaceState(history.state, '', route.toString());
    document.addEventListener('DOMContentLoaded', () => {
      window.GitaiSoloTutorial?.open({ mode: tutorialMode });
    }, { once: true });
  }
  const startLabel = document.getElementById('startGeneration');
  const reviewLabel = document.getElementById('reviewGeneration');
  const startOverlay = document.getElementById('startOverlay');
  const reviewOverlay = document.getElementById('reviewOverlay');
  const continueButton = document.getElementById('continueButton');
  const VISIT_KEY = 'gitai-exhibit-visit-start-v1';
  // Session storage may be discarded when iPadOS terminates a standalone PWA.
  // Mirror each experiment's visit boundary in localStorage so re-opening the
  // same saved evolution does not silently award five more generations.
  const DURABLE_VISIT_PREFIX = 'gitai-exhibit-visit-start-durable-v1:';
  const HANDOVER_KEY = 'gitai-exhibit-handover-v1';
  // Persist the submission intent BEFORE advancing a generation. A page reload
  // between the IndexedDB commit and life/session writes must not evolve again.
  const PENDING_HANDOVER_KEY = 'gitai-exhibit-handover-pending-v1';
  const DURABLE_PENDING_PREFIX = 'gitai-exhibit-handover-pending-durable-v1:';
  const generationId = n => 'gen' + String(n).padStart(5, '0');
  const mode = route.searchParams.get('experiment') === 'warning_color'
    ? 'warning' : 'cryptic';
  let firstGeneration = null;
  let handoverPending = false;
  let visitFinished = false;
  // If offspring have committed but a later life/session write fails,
  // a handover retry must NEVER call the evolution submit button again.
  let committedOffspringForHandover = null;
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
  // Show the visitor's own five-generation allowance on the result screen,
  // not a floating in-round HUD. This is display-only: saved generations,
  // handover limits and experiment data are unchanged.
  const progress = document.createElement('p');
  progress.id = 'exhibitVisitProgress';
  progress.hidden = true;
  progress.setAttribute('role', 'status');
  reviewOverlay?.querySelector('.review-actions')?.insertAdjacentElement('beforebegin', progress);

  function numberFrom(node) {
    const match = (node?.textContent || '').match(/(?:GENERATION|第)\s*(\d+)/i);
    return match ? Number(match[1]) : null;
  }
  function visitStorage() {
    const namespace = window.GitaiPagesPreview?.context?.storageNamespace;
    return namespace ? {
      namespace, key: DURABLE_VISIT_PREFIX + namespace
    } : null;
  }
  function ensureVisitorStart() {
    if (visitFinished) return;
    const current = numberFrom(startLabel) || numberFrom(reviewLabel);
    const storage = visitStorage();
    // The startup labels are placeholders until the actual experiment loads.
    if (current === null || !storage) return;
    let durable = null;
    try { durable = JSON.parse(localStorage.getItem(storage.key) || 'null'); } catch (_) {}
    if (durable?.mode === mode && durable.namespace === storage.namespace
        && Number.isSafeInteger(durable.start) && durable.start > 0
        && durable.start <= current
        && (firstGeneration === null || durable.start < firstGeneration)) {
      firstGeneration = durable.start;
    }
    if (firstGeneration === null || current < firstGeneration) firstGeneration = current;
    const visit = {mode, start: firstGeneration};
    try {
      const saved = JSON.parse(sessionStorage.getItem(VISIT_KEY) || 'null');
      if (saved?.mode !== mode || saved.start !== firstGeneration) {
        sessionStorage.setItem(VISIT_KEY, JSON.stringify(visit));
      }
    } catch (_) {}
    try {
      if (durable?.mode !== mode || durable.namespace !== storage.namespace
          || durable.start !== firstGeneration) {
        localStorage.setItem(storage.key, JSON.stringify({
          ...visit, namespace: storage.namespace
        }));
      }
    } catch (_) {}
  }
  function sync() {
    ensureVisitorStart();
    const atReview = !!reviewOverlay?.classList.contains('visible');
    const completed = numberFrom(reviewLabel);
    const valid = atReview && completed !== null && firstGeneration !== null
      && completed >= firstGeneration
      && !continueButton.disabled
      && /^(次の世代を生成|次へ|次へ（進化シアター）)$/.test(continueButton.textContent.trim());
    const generationsPlayed = valid ? completed - firstGeneration + 1 : 0;
    const finishedFive = valid && generationsPlayed >= 5;
    const showProgress = valid && !handoverPending;
    progress.hidden = !showProgress;
    if (showProgress) {
      const label = '今回のプレイ：' + Math.min(generationsPlayed, 5) + ' / 5世代';
      // A MutationObserver watches the results subtree. Avoid a self-triggered
      // observer loop by updating text only when the progress actually changes.
      if (progress.textContent !== label) progress.textContent = label;
    }
    button.hidden = !valid || finishedFive || handoverPending;
    notice.hidden = !finishedFive || handoverPending;
    // Make ordinary continuation the primary action; preserve the existing
    // fifth-generation handover interception and save-before-navigation.
    if (valid && !handoverPending && continueButton.textContent !== '次へ') {
      continueButton.textContent = '次へ';
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
  async function resetWarningLifeForNextVisitor(nextGenerationId, afterReload = false) {
    if (mode !== 'warning') return;
    const initial = window.GitaiWarningColor?.LIFE_INITIAL_THIRDS;
    if (initial !== 30) {
      throw Error('ライフ初期値を確認できません。スタッフにお知らせください。');
    }
    if (afterReload) {
      // The ready overlay is not restored after a full reload. Only trust the
      // persisted life written by the main game for the exact committed child.
      const key = 'gitai-warning-life-v1:'
        + window.GitaiPagesPreview?.context?.storageNamespace;
      let stored;
      try { stored = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) {}
      if (stored?.generation_id !== nextGenerationId
          || !Number.isInteger(stored?.thirds)
          || stored.thirds < 0 || stored.thirds > initial) {
        throw Error('再読み込み後のライフ保存を確認できません。'
          + '進化データは変更せず停止しました。スタッフにお知らせください。');
      }
    } else {
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

  function finishSavedHandover(intent) {
    sessionStorage.setItem(HANDOVER_KEY, JSON.stringify({
      mode: intent.mode, start: intent.start, end: intent.end
    }));
    // Clear the persistent visitor boundary only AFTER the offspring and
    // life have been committed. A failure keeps recovery available.
    const storage = visitStorage();
    if (!storage) throw Error('交代前の保存先を確認できません。');
    const durablePendingKey = DURABLE_PENDING_PREFIX + storage.namespace;
    localStorage.removeItem(storage.key);
    localStorage.removeItem(durablePendingKey);
    if (localStorage.getItem(storage.key) !== null
        || localStorage.getItem(durablePendingKey) !== null) {
      throw Error('来場者交代の完了を保存できませんでした。');
    }
    sessionStorage.removeItem(VISIT_KEY);
    sessionStorage.removeItem(PENDING_HANDOVER_KEY);
    visitFinished = true;
    const nextPage = new URL('modes.html', home.href);
    nextPage.searchParams.set('handover', '1');
    location.assign(nextPage.href);
  }

  // Full page reload or tab restoration: finish ONLY a proven, already
  // committed handover. Never click the evolution submit button in recovery.
  let recoveryRunning = false;
  async function recoverPendingHandover() {
    if (recoveryRunning || handoverPending) return;
    const namespace = window.GitaiPagesPreview?.context?.storageNamespace;
    if (!namespace) return; // game model may still be initializing
    let sessionIntent = null;
    let durableIntent = null;
    try { sessionIntent = JSON.parse(sessionStorage.getItem(PENDING_HANDOVER_KEY) || 'null'); }
    catch (_) {}
    try {
      durableIntent = JSON.parse(localStorage.getItem(DURABLE_PENDING_PREFIX + namespace) || 'null');
    } catch (_) {}
    // The single legacy session key may belong to the OTHER exhibit mode.
    // Never apply its pending generation to the currently opened namespace.
    const sessionMatches = sessionIntent?.mode === mode && sessionIntent.namespace === namespace;
    const intent = durableIntent || (sessionMatches ? sessionIntent : null);
    if (!intent) return;
    recoveryRunning = true;
    try {
      if (durableIntent && sessionMatches
          && (durableIntent.mode !== sessionIntent.mode
              || durableIntent.namespace !== sessionIntent.namespace
              || durableIntent.start !== sessionIntent.start
              || durableIntent.end !== sessionIntent.end
              || durableIntent.previous !== sessionIntent.previous
              || durableIntent.next !== sessionIntent.next)) {
        throw Error('交代の記録が一致しません。安全のため処理を停止しました。');
      }
      if (intent.mode !== mode || intent.namespace !== namespace
          || !Number.isSafeInteger(intent.start) || intent.start < 1
          || !Number.isSafeInteger(intent.end) || intent.end < intent.start
          || intent.end - intent.start > 4
          || intent.previous !== generationId(intent.end)
          || intent.next !== generationId(intent.end + 1)) {
        throw Error('交代記録の照合に失敗しました。進化データは変更していません。');
      }
      const current = await savedGeneration();
      if (current === intent.previous) return; // original commit did not finish
      if (current !== intent.next) {
        throw Error('再読み込み中に世代が変更されました。交代を中断しました。');
      }
      // A fully committed game has already saved this generation's life.
      // If the life write was interrupted, fail closed rather than guessing.
      await resetWarningLifeForNextVisitor(current, true);
      finishSavedHandover(intent);
    } catch (error) {
      console.error(error);
      alert(String(error?.message || error));
    } finally {
      recoveryRunning = false;
    }
  }

  async function safelyHandover() {
    if (handoverPending || !reviewOverlay?.classList.contains('visible')) return;
    ensureVisitorStart();
    const completed = numberFrom(reviewLabel);
    if (!completed || !firstGeneration || completed < firstGeneration
      || continueButton.disabled
      || !/^(次の世代を生成|次へ|次へ（進化シアター）)$/.test(continueButton.textContent.trim())) return;
    handoverPending = true;
    button.disabled = true;
    button.textContent = '進化データを保存中…';
    sync();
    try {
      // In the real simulator, the offspring generation is written only AFTER
      // the result's "next generation" action. Do not hand over incomplete data.
      if (committedOffspringForHandover) {
        // A previous attempt already advanced the generation. This retry
        // only completes its post-commit life/handover metadata.
        if (await savedGeneration() !== committedOffspringForHandover) {
          throw Error('別の画面で世代が変更されました。交代は再試行できません。');
        }
      } else {
        const previous = await savedGeneration();
        if (previous !== generationId(completed)) {
          throw Error('保存済み世代が結果画面と一致しません。交代を中断しました。');
        }
        const namespace = window.GitaiPagesPreview?.context?.storageNamespace;
        if (!namespace) throw Error('進化データの保存先が不明です。');
        const intent = {
          mode, start: firstGeneration, end: completed, namespace,
          previous, next: generationId(completed + 1)
        };
        const serialized = JSON.stringify(intent);
        // Both writes must be durable before a next-generation submit. If
        // iPadOS kills the PWA and drops sessionStorage, localStorage retains
        // the exact intent so the already-committed child is not resubmitted.
        localStorage.setItem(DURABLE_PENDING_PREFIX + namespace, serialized);
        if (localStorage.getItem(DURABLE_PENDING_PREFIX + namespace) !== serialized) {
          throw Error('交代の保護記録を保持できません。進化データは変更していません。');
        }
        sessionStorage.setItem(PENDING_HANDOVER_KEY, serialized);
        if (sessionStorage.getItem(PENDING_HANDOVER_KEY) !== serialized) {
          throw Error('交代の保護記録を保存できません。進化データは変更していません。');
        }
        continueButton.click();
        for (let i = 0; i < 180; i += 1) {
          await delay(500);
          const next = await savedGeneration();
          if (/^gen(?:\d{5}|[1-9]\d{5,})$/.test(String(next))
              && next === generationId(completed + 1)) {
            committedOffspringForHandover = next;
            break;
          }
          // A failed/invalid mutation returns to the result panel; do not
          // navigate away or claim its uncommitted generation succeeded.
          if (reviewOverlay.classList.contains('visible')
              && /^(同じ世代|最新世代|もう一度送信|容量確認)/.test(continueButton.textContent)) {
            break;
          }
        }
      }
      if (!committedOffspringForHandover) throw Error('世代の保存完了を確認できませんでした。スタッフへお知らせください。');
      // Visitor-specific lives reset ONLY for a completed handover. The
      // evolution DB, genomes, images, history and ordinary continuous play
      // remain unchanged. Never reset on unsuccessful evolution or retry.
      await resetWarningLifeForNextVisitor(committedOffspringForHandover);
      // Clear the visit counter BEFORE theater playback. This also clears the
      // pre-commit recovery marker, but only after all writes have succeeded.
      finishSavedHandover({
        mode, start: firstGeneration, end: completed
      });
    } catch (error) {
      console.error(error);
      // The original result is ordinarily covered by the generation-ready
      // overlay after a successful offspring commit. If only the life or
      // session storage failed, show the result again so the administrator
      // can retry WITHOUT starting another evolution/offspring generation.
      if (committedOffspringForHandover) {
        document.getElementById('generationOverlay')?.classList.remove('visible');
        reviewOverlay.classList.add('visible');
      }
      alert(String(error?.message || error));
      button.disabled = false;
      button.textContent = committedOffspringForHandover
        ? '次の人へ変わる（保存の再試行）' : '次の人へ変わる';
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
      && continueButton.textContent === '次へ') {
      event.preventDefault();
      event.stopImmediatePropagation();
      void safelyHandover();
    }
  }, true);
  new MutationObserver(sync).observe(document.body, {
    subtree: true, attributes: true, attributeFilter: ['class'],
    childList: true, characterData: true
  });
  window.addEventListener('gitai:solo-assets-ready', () => {
    sync();
    void recoverPendingHandover();
  });
  sync();
  // Covers reloads where game initialization completed before this script ran.
  void recoverPendingHandover();

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
  // Exhibition death: the simulator's retry button restores the SAME saved
  // generation and ten hearts. It must not navigate to the mode picker.
  const deathHandover = document.getElementById('warningDeathHandover');
  deathHandover?.addEventListener('click', () => {
    if (handoverPending || document.getElementById('warningToxicDeath')?.hidden) return;
    const storage = visitStorage();
    if (!storage) {
      alert('保存済み世代を確認できません。スタッフへお知らせください。');
      return;
    }
    try {
      // The failed generation was never submitted; unlike ordinary handover,
      // there is NO next-generation commit and no theater playback.
      // Reset only this visitor's allowance, never any evolution history.
      sessionStorage.removeItem(VISIT_KEY);
      localStorage.removeItem(storage.key);
      if (localStorage.getItem(storage.key) !== null) throw Error('交代情報の更新に失敗しました');
      location.assign(home.href);
    } catch (error) {
      alert('交代処理を完了できません。データは保持されています。' + String(error?.message || error));
    }
  });
})();
