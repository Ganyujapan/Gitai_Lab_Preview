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
assert.match(deploy, /^  build:\s*\n    needs: verify\s*$/m,
  'Read-only artifact build must depend on the PR validation gate');
assert.match(deploy, /^  deploy:\s*\n(?:    #[^\n]*\n)*    needs: \[verify, build\]\s*$/m,
  'Privileged Pages deployment must depend on both validation and artifact build');
const jobsStart=deploy.indexOf('\njobs:\n');
const verifyStart=deploy.indexOf('\n  verify:\n',jobsStart);
const buildStart=deploy.indexOf('\n  build:\n',verifyStart);
const deployStart=deploy.indexOf('\n  deploy:\n',buildStart);
assert.ok(jobsStart>=0&&verifyStart>jobsStart&&buildStart>verifyStart&&deployStart>buildStart,
  'Verification, build, deploy jobs must be separate');
const verificationJob=deploy.slice(verifyStart,buildStart);
const buildJob=deploy.slice(buildStart,deployStart);
const publishJob=deploy.slice(deployStart);
assert.match(verificationJob,/permissions:\s*\n      contents: read\s*\n/,
  'Validation must remain read-only');
assert.match(buildJob,/permissions:\s*\n      contents: read\s*\n/,
  'Artifact build must remain read-only');
assert.doesNotMatch(verificationJob+buildJob,/\bpages: write\b|\bid-token: write\b/,
  'Validation and build must not have Pages or OIDC publishing permissions');
assert.match(publishJob,/permissions:\s*\n      pages: write\s*\n      id-token: write\s*\n/,
  'Publish job must carry the scoped Pages and OIDC permissions');
assert.doesNotMatch(publishJob,/actions\/checkout@|\brun:|actions\/upload-pages-artifact@/,
  'Privileged publish job must not checkout, run scripts, or build/upload');
assert.match(buildJob,/actions\/upload-pages-artifact@/,
  'Unprivileged build must upload the Pages artifact');
assert.match(publishJob,/actions\/deploy-pages@/,
  'Privileged deploy job must publish the Pages artifact');
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
