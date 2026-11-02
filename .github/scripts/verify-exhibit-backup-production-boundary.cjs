'use strict';
// Exhibition backup audit: enforce the production/sandbox boundary across
// the real built Pages artifact. This test reads files only and NEVER opens
// IndexedDB, imports an actual user's archive, or resets a game.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const site=process.argv[2]||'_site';
const exhibit=path.join(site,'exhibit');
const read=p=>fs.readFileSync(path.join(exhibit,p),'utf8');
const mode=read('modes.html');
const game=read('game.html');
const home=read('index.html');
const admin=read('admin.js');
const engine=read('js/pages_preview.js');
const worker=read('sw.js');
const rehearsal=read('backup_restore_atomic_v2.js');
const preflight=read('backup_restore_preflight_v2.js');
const partWriter=read('backup_v2.js');
const build=fs.readFileSync('exhibit/build.py','utf8');
const visitorPages=[home,mode,game];
// Large v2 RESTORE is not available on a real game DB. It must NEVER become
// a production import even if an experimental bundle is cached offline.
for(const [index,html] of visitorPages.entries()){
 for(const forbidden of ['backup_restore_atomic_v2.js',
    'backup_checkpoint_v2.js','backup_upgrade_preflight_v2.js']){
   assert.ok(!html.includes('src="'+forbidden+'"'),
     'visitor entry '+index+' unexpectedly executes '+forbidden);
 }
}
assert.match(mode,/<script src="backup_v2\.js" defer>/,
 'read-only v2 file validation may be loaded on mode selection');
assert.match(mode,/<script src="backup_restore_preflight_v2\.js" defer>/);
assert.match(preflight,/safeToRestore: false/);
assert.match(rehearsal,/gitai-backup-rehearsal/);
assert.match(rehearsal,/SANDBOX\.test\(db\.name/);
assert.match(partWriter,/No database writes occur in this module/);
assert.doesNotMatch(admin,/backup_v2_stage/,'admin must not touch future v3 staging store');
assert.match(admin,/const BACKUP_SCHEMA = 'gitai-exhibit-backup-v1'/);
assert.match(admin,/const MAX_BACKUP_BYTES = 150 \* 1024 \* 1024/);
assert.match(admin,/const MAX_BACKUP_ENTRIES = 20000/);
assert.match(engine,/const DB_VERSION = 2/);
assert.match(admin,/db\.version !== 2/);
assert.ok(!build.includes('DB_VERSION = 3'),'exhibit build must not migrate actual DB');
assert.match(build,/gitai-exhibit-2026-/);
assert.match(admin,/pending_warning_life_restore_v1/);
assert.match(admin,/restoreMutationBusy = true/);
assert.match(admin,/tx\.objectStore\(store\)\.clear\(\)|objectStore\.clear\(\)/);
assert.match(admin,/const tx = db\.transaction\(STORES, 'readwrite'\)/,
 'full v1 restore must be within one transaction');
assert.match(admin,/snapshotStores\(db\)/);
assert.match(admin,/verifyExportCurrentSnapshot\(snapshot, modeId\)/);
assert.match(admin,/checkBackupExportLimits\(envelope, file\.size\)/);
assert.match(admin,/validateBackup\(await file\.text\(\), selected\)/);
assert.match(admin,/if \(backwards && !confirm\(/,
 'backwards history restore must have a second confirmation');
assert.match(admin,/navigator\.share\(\{/);
assert.match(admin,/保存が完了したとは限りません/);
assert.match(worker,/Cache cleanup is scoped to exhibition versions; IndexedDB is untouched/);
// Rollback, test-only v2 migration, or user data deletion are NOT part of
// this release. Dedicated dynamic tests cover actual backup transactions.
console.log('Exhibit backup production audit: v1 atomic read/export/import, 20k/150MiB caps, life recovery, sandboxed v2, no automatic save/DB migration; source boundary OK.');
console.log('Known risk: a valid v1 export still requires an iPad Files save AND file re-selection to establish backup possession; v2 live migration and high-volume Safari quota are not certified.');
