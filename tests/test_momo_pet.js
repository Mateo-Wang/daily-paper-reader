const assert = require('node:assert/strict');
const fs = require('node:fs');

const pet = require('../app/momo-pet.js');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('app/app.css', 'utf8');
const manifest = JSON.parse(fs.readFileSync('app/pets/momo/pet.json', 'utf8'));

function testDirectionMapping() {
  assert.equal(pet.directionIndex(0, -100), 0, 'up should be direction 000');
  assert.equal(pet.directionIndex(100, -100), 2, 'upper-right should be direction 045');
  assert.equal(pet.directionIndex(100, 0), 4, 'right should be direction 090');
  assert.equal(pet.directionIndex(0, 100), 8, 'down should be direction 180');
  assert.equal(pet.directionIndex(-100, 0), 12, 'left should be direction 270');
  assert.equal(pet.directionIndex(0, 0), null, 'neutral vector should fall back to idle');
  assert.deepEqual(pet.directionCell(0), { row: 9, column: 0 });
  assert.deepEqual(pet.directionCell(7), { row: 9, column: 7 });
  assert.deepEqual(pet.directionCell(8), { row: 10, column: 0 });
  assert.deepEqual(pet.directionCell(15), { row: 10, column: 7 });
}

function testAtlasContract() {
  const expected = {
    idle: [0, 6],
    runRight: [1, 8],
    runLeft: [2, 8],
    wave: [3, 4],
    jump: [4, 5],
    startled: [5, 8],
    doze: [6, 6],
    play: [7, 6],
    preen: [8, 6],
  };
  Object.entries(expected).forEach(([name, [row, frames]]) => {
    assert.equal(pet.ANIMATIONS[name].row, row, `${name} should use the contract row`);
    assert.equal(pet.ANIMATIONS[name].frames, frames, `${name} should use the contract frame count`);
    assert.equal(pet.ANIMATIONS[name].durations.length, frames, `${name} needs one duration per frame`);
  });
  assert.deepEqual(pet.framePosition(0, 0), { x: 0, y: 0 });
  assert.deepEqual(pet.framePosition(10, 7), { x: 100, y: 100 });
}

function testDragClampingAndPersistenceRatios() {
  assert.deepEqual(
    pet.normalizedPosition(-100, 900, 96, 103, 1280, 720),
    { x: 6, y: 611, xRatio: 0, yRatio: 1 },
  );
  const middle = pet.normalizedPosition(592, 308.5, 96, 103, 1280, 720);
  assert.ok(Math.abs(middle.xRatio - 0.5) < 0.01);
  assert.ok(Math.abs(middle.yRatio - 0.5) < 0.01);
}

function testNonBlockingLoaderAndAccessibilityCss() {
  const momoLoad = html.indexOf("path: 'app/momo-pet.js'");
  const mainDeferredLoad = html.indexOf("path: 'app/chat.discussion.js'");
  assert.ok(momoLoad >= 0, 'the pet module should be loaded');
  assert.ok(momoLoad < mainDeferredLoad, 'the independent pet enhancement should be started separately');
  assert.match(html, /墨墨加载失败，已跳过宠物增强/, 'pet failure should be handled without blocking the app');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, 'reduced motion must be supported');
  assert.match(css, /\.dpr-momo-pet\[hidden\]/, 'the pet must support temporary hiding');
  assert.match(css, /\.dpr-momo-restore/, 'a discoverable restore control must exist');
  assert.match(css, /touch-action:\s*none/, 'dragging must be reliable on pointer devices');
  assert.match(css, /--dpr-momo-width:\s*72px/, 'desktop pet should keep the approved half-size footprint');
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*--dpr-momo-width:\s*60px/, 'mobile pet should shrink further');
  assert.match(css, /transform-origin:\s*50% 100%/, 'frame scale compensation should grow from the feet baseline');
  assert.match(fs.readFileSync('app/momo-pet.js', 'utf8'), /FRAME_SCALE_COMPENSATION/, 'wing-spread frames should preserve perceived body scale');
}

function testPackagedPetAssetContract() {
  assert.equal(manifest.spriteVersionNumber, 2);
  assert.equal(manifest.spritesheetPath, 'spritesheet.webp');
  const stat = fs.statSync('app/pets/momo/spritesheet.webp');
  assert.ok(stat.size > 1024 * 1024, 'the production spritesheet should be a real packaged image');
  const validation = JSON.parse(fs.readFileSync('app/pets/momo/qa/release-validation.json', 'utf8'));
  assert.equal(validation.ok, true, 'the production spritesheet must pass its atlas validation');
  assert.equal(validation.width, 1536);
  assert.equal(validation.height, 2288);
  assert.equal(validation.transparent_rgb_residue_pixels, 0);
}

testDirectionMapping();
testAtlasContract();
testDragClampingAndPersistenceRatios();
testNonBlockingLoaderAndAccessibilityCss();
testPackagedPetAssetContract();
console.log('momo pet tests passed');
