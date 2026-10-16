const test = require('node:test');
const assert = require('node:assert/strict');
const {mothSize,needsRebuild,VERSION} = require('../js/theater_scale.js');

test('replay moth uses the exact game/background cover scale, not cell fill', () => {
  const dims = {frameWidth:600,frameHeight:1000,cellWidth:100,cellHeight:90};
  assert.equal(mothSize({...dims,gameMothSize:38}),63);
  const originalTheater = Math.floor(Math.min(dims.cellWidth*0.78,dims.cellHeight*0.82));
  assert.equal(originalTheater,73);
  assert.ok(mothSize({...dims,gameMothSize:38}) < originalTheater);
});

test('ratio follows source game sprite size and never overlaps theater cells', () => {
  assert.equal(mothSize({
    gameMothSize:30,frameWidth:600,frameHeight:1000,cellWidth:100,cellHeight:90,
  }),50);
  assert.equal(mothSize({
    gameMothSize:80,frameWidth:600,frameHeight:1000,cellWidth:100,cellHeight:90,
  }),86);
});

test('existing cached frames need a one-time visual rebuild without changing generations', () => {
  assert.equal(VERSION,2);
  assert.equal(needsRebuild({schema_version:1,image_blob:{}}),true);
  assert.equal(needsRebuild({render_version:1}),true);
  assert.equal(needsRebuild({render_version:2}),false);
});
