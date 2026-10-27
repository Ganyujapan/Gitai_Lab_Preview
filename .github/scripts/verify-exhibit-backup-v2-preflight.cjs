'use strict';
// RE2-EXH-02 (foundation only). Pure in-memory files; NEVER access IndexedDB.
const assert = require('node:assert/strict');
const cryptoNode = require('node:crypto');
// Node 22+ exposes globalThis.crypto as a read-only WebCrypto getter.
globalThis.indexedDB = {open() { throw Error('Data must never be opened'); }};
const {SCHEMA, PART_SCHEMA, MAX_PART_BYTES, validateManifest, verifyPartIntegrity} =
  require('../../exhibit/backup_v2.js');

class TestFile extends Blob {
  constructor(parts, name, options) { super(parts, options); this.name = name; }
}
const jsonFile = (name, body) =>
  new TestFile([JSON.stringify(body)], name, {type: 'application/json'});
const sha256 = async file =>
  cryptoNode.createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex');

const db = 'gitai-exhibit-2026-test-cryptic';
const gen = 'gen00035';
async function makeFixture(options = {}) {
  const records = {
    images: Array.from({length: 60}, (_, i) =>
      ({key: gen + ':' + String(i + 1).padStart(2, '0'), value: {$type: 'Blob', mime: 'image/png', data: 'AA=='}})),
    meta: [{key: 'current_generation_id', value: gen},
      ...Array.from({length: 60}, (_, i) =>
        ({key: 'genome:' + gen + ':' + String(i + 1).padStart(2, '0'),
          value: {schema_version: 1, baseHue: i}}))],
    theater_frames: [{key: 'frame:' + gen, value: {generation: gen}}]
  };
  if (options.mutateRecords) options.mutateRecords(records);
  const parts = [];
  const files = [];
  // Split the first store across two files to exercise cross-part key tracking.
  const groups = [
    ['images', records.images.slice(0, 30)],
    ['meta', records.meta],
    ['images', records.images.slice(30)],
    ['theater_frames', records.theater_frames]
  ];
  for (const [store, entries] of groups) {
    const index = parts.length;
    const fileName = 'part-' + String(index).padStart(5, '0') + '.json';
    const file = jsonFile(fileName, {
      schema: PART_SCHEMA, mode: 'cryptic', database: db,
      currentGeneration: gen, index, store, entries
    });
    parts.push({index, store, file: fileName, bytes: file.size,
      entries: entries.length, sha256: await sha256(file)});
    files.push(file);
  }
  const manifest = {
    schema: SCHEMA, mode: 'cryptic', database: db,
    databaseVersion: 2, createdAt: '2026-10-27T00:00:00Z',
    currentGeneration: gen, parts,
    totals: {entries: records.images.length + records.meta.length + records.theater_frames.length,
      byStore: {images: records.images.length, meta: records.meta.length,
        theater_frames: records.theater_frames.length}}
  };
  return {manifest, files, manifestFile: jsonFile('manifest.json', manifest)};
}

(async () => {
  const fixture = await makeFixture();
  const seen = [];
  const result = await verifyPartIntegrity(fixture.manifestFile, fixture.files, 'cryptic', db,
    (store, key, value) => { seen.push([store, key]); assert.notEqual(value, undefined); });
  assert.equal(result.entries, 122);
  assert.equal(result.generation, gen);
  assert.equal(result.integrityOnly, true);
  assert.equal(seen.length, 122);
  assert.equal(globalThis.indexedDB.open.name, 'open');

  async function rejectFixture(f, pattern) {
    await assert.rejects(verifyPartIntegrity(f.manifestFile, f.files, 'cryptic', db), pattern);
  }
  const wrongMode = await makeFixture();
  await assert.rejects(verifyPartIntegrity(wrongMode.manifestFile, wrongMode.files, 'warning', db),
    /モード/);
  const wrongDb = await makeFixture();
  await assert.rejects(verifyPartIntegrity(wrongDb.manifestFile, wrongDb.files, 'cryptic', 'other-db'),
    /モード/);
  const missing = await makeFixture();
  missing.files.pop();
  await rejectFixture(missing, /不足・過剰/);

  const duplicatedFile = await makeFixture();
  duplicatedFile.files[1] = duplicatedFile.files[0];
  await rejectFixture(duplicatedFile, /重複/);

  const corruptBytes = await makeFixture();
  corruptBytes.files[0] = new TestFile([await corruptBytes.files[0].text() + ' '],
    corruptBytes.files[0].name);
  await rejectFixture(corruptBytes, /容量不一致/);
  const sameSizeCorruption = await makeFixture();
  const original = await sameSizeCorruption.files[0].text();
  sameSizeCorruption.files[0] = new TestFile(['?' + original.slice(1)],
    sameSizeCorruption.files[0].name);
  await rejectFixture(sameSizeCorruption, /破損/);

  const wrongPartIndex = await makeFixture();
  wrongPartIndex.manifest.parts[1].index = 3;
  wrongPartIndex.manifestFile = jsonFile('manifest.json', wrongPartIndex.manifest);
  await rejectFixture(wrongPartIndex, /索引/);

  const maliciousPath = await makeFixture();
  maliciousPath.manifest.parts[0].file = '../outside.json';
  maliciousPath.manifestFile = jsonFile('manifest.json', maliciousPath.manifest);
  await rejectFixture(maliciousPath, /索引/);

  const hugeIndex = await makeFixture();
  hugeIndex.manifest.parts[0].bytes = MAX_PART_BYTES + 1;
  hugeIndex.manifestFile = jsonFile('manifest.json', hugeIndex.manifest);
  await rejectFixture(hugeIndex, /索引/);

  const totalsMismatch = await makeFixture();
  totalsMismatch.manifest.totals.entries += 1;
  totalsMismatch.manifestFile = jsonFile('manifest.json', totalsMismatch.manifest);
  await rejectFixture(totalsMismatch, /総件数/);

  const duplicateAcrossParts = await makeFixture({mutateRecords(records) {
    records.images[59].key = records.images[0].key;
  }});
  await rejectFixture(duplicateAcrossParts, /重複/);
  const missingDna = await makeFixture({mutateRecords(records) {
    records.meta[10].key = 'old-genome';
  }});
  await rejectFixture(missingDna, /DNAが不足/);
  const missingImage = await makeFixture({mutateRecords(records) {
    records.images[59].key = 'old-image';
  }});
  await rejectFixture(missingImage, /画像・DNAが不足/);
  const alteredPointer = await makeFixture({mutateRecords(records) {
    records.meta[0].value = 'gen00034';
  }});
  await rejectFixture(alteredPointer, /参照先/);

  // A callback error is propagated without any database mutation. Full
  // semantic DNA/PNG checks are intentionally a later integration stage.
  await assert.rejects(verifyPartIntegrity(fixture.manifestFile, fixture.files,
    'cryptic', db, (store) => { if (store === 'images') throw Error('Bad PNG'); }), /Bad PNG/);

  // A manifest-only count validator never touches the file objects.
  validateManifest(fixture.manifest, 'cryptic', db);
  console.log('RE2-EXH-02 v2 groundwork: bounded part hashes, ordering, missing/extra, cross-part duplicates, current 60 PNG/DNA refs and read-only guarantee OK.');
})().catch(error => { console.error(error); process.exitCode = 1; });
