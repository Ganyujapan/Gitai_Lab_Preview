/* Change TEST_MODE to false only when launching the trophy-locked public version. */
(function(root) {
  'use strict';
  const TEST_MODE = true;
  const DEFAULT_ENVIRONMENT = 'kusagi_001';
  const api = Object.freeze({
    testMode: TEST_MODE,
    defaultEnvironment: DEFAULT_ENVIRONMENT,
    releasedEnvironments: Object.freeze([DEFAULT_ENVIRONMENT]),
    testingEnvironments: Object.freeze(['kusagi_001', 'bark_001', 'sand_001']),
  });
  root.GitaiHabitatAccess = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
