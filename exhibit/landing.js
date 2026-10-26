(() => {
  'use strict';
  const offline = document.getElementById('offlineStatus');
  const version = document.getElementById('buildVersion');
  const storage = document.getElementById('storageStatus');
  const splash = document.getElementById('exhibitSplash');
  const start = document.getElementById('exhibitSplashStart');
  const visitKey = 'gitai-exhibit-visit-start-v1';
  const handoverRoute = new URL(location.href).searchParams.get('handover') === '1';
  function showMenu() {
    splash.hidden = true;
    document.getElementById('exhibitModeSelection').hidden = false;
  }
  function showSplash() {
    splash.hidden = false;
    document.getElementById('exhibitModeSelection').hidden = true;
  }
  window.GitaiExhibitLanding = { showMenu, showSplash };
  if (handoverRoute) showMenu(); else showSplash();
  start.addEventListener('click', () => {
    // Reset the VISITOR's counter only. All evolution/IndexedDB data survives.
    try { sessionStorage.removeItem(visitKey); } catch (_) {}
    showMenu();
  });
  async function setup() {
    if (!('serviceWorker' in navigator) || !('caches' in window)) {
      offline.textContent = 'この端末ではオフライン機能を利用できません。';
      return;
    }
    try {
      await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
      const response = await caches.match(new URL('./game.html', location.href), { ignoreSearch: true });
      offline.textContent = response?.ok
        ? '✓ オフライン用ゲームファイルを保存済み'
        : '初回のダウンロードが未完了です。通信がある状態で再起動してください。';
      if (!response?.ok) return;
      try {
        const info = await fetch('./version.json', { cache: 'no-store' }).then(r => r.json());
        version.textContent = 'アプリ版: ' + String(info.build || '').slice(0, 12);
      } catch (_) { version.textContent = 'アプリ版: オフライン保存済み'; }
    } catch (error) {
      offline.textContent = 'オフライン準備に失敗しました。通信と空き容量をご確認ください。';
      console.error(error);
    }
    if (navigator.storage?.persisted) {
      try {
        let permanent = await navigator.storage.persisted();
        if (!permanent && navigator.storage.persist) {
          permanent = await navigator.storage.persist();
        }
        storage.textContent = permanent
          ? '✓ 永続ストレージが許可されています'
          : '保存領域の永続化は未許可です。JSONバックアップが必要です。';
      } catch (_) {
        storage.textContent = '保存領域の永続化を確認できません。';
      }
    }
  }
  setup();
})();
