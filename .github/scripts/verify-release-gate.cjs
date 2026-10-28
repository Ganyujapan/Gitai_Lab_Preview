'use strict';
// CI-01: a PR-only check must never be bypassed by a direct main push
// or manual production Pages deployment.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const deploy = fs.readFileSync('.github/workflows/deploy-pages.yml','utf8');
const verify = fs.readFileSync('.github/workflows/verify-public-preview.yml','utf8');
assert.match(verify, /^  workflow_call:\s*$/m, 'PR verification must be reusable');
assert.match(verify, /^  pull_request:\s*$/m, 'PR validation must remain enabled');
assert.match(verify, /branches:\s*\[main\]/, 'PRs into main must be validated');
assert.match(verify, /^permissions:\s*\n  contents: read/m, 'Validation must have read-only repository permissions');
assert.match(deploy, /^  push:\s*\n    branches: \[main\]/m, 'Main push deploy must remain enabled');
assert.match(deploy, /^  workflow_dispatch:/m, 'Manual releases must be gated too');
assert.match(deploy, /^  verify:\s*\n(?:[^\n]*\n)*?    uses: \.\/\.github\/workflows\/verify-public-preview\.yml/m,
  'Production must call the same full PR validation workflow');
assert.match(deploy, /^  deploy:\s*\n    needs: verify\s*$/m,
  'Pages deploy must depend on full verification success');
assert.match(deploy, /^  verify:\s*\n(?:[^\n]*\n)*?    permissions:\s*\n      contents: read/m,
  'Full validation job must not have Pages/write credentials');
// CI-02: the release gate must accept ONLY verified immutable Action SHAs.
assert.match(deploy, /actions\/upload-pages-artifact@7b1f4a764d45c48632c6b24a0339c27f5614fb0b/, 'Pages upload preserved');
assert.match(deploy, /actions\/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e/, 'Pages deployment preserved');
const required = [
  'verify-author-news.cjs',
  'verify-tutorial.cjs',
  'verify-sfx.cjs',
  'verify-exhibit-landing-theater.cjs',
  'verify-battle-seal.cjs',
  'verify-experiment-reset.cjs',
  'exhibit/verify_mutation_profile.cjs',
  'exhibit/build.py'
];
for (const name of required) {
  assert.ok(verify.includes(name), 'Missing blocking public/exhibit check: ' + name);
}
assert.ok(verify.includes('node --check _site/exhibit/game.js'));
assert.ok(verify.includes('node --check _site/exhibit/js/pages_preview.js'));
console.log('CI-01: PR, main push and manual release all require the same read-only source, save, battle, audio, tutorial and exhibit verification.');
