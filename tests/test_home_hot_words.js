const assert = require('node:assert/strict');
const hotWords = require('../app/home-hot-words.js');

function testSidebarDateFoldersAreDeduplicated() {
  const folders = hotWords.dateFoldersFromSidebar(`
    * <a href="#/202607/29/paper-a">A</a>
    * <a href="#/202607/29/paper-b">B</a>
    * <a href="#/202607/18/paper-c">C</a>
  `);
  assert.deepEqual(folders, ['202607/29', '202607/18']);
}

function testRecentFoldersSupportDailyAndRangeReports() {
  const recent = hotWords.recentFolders([
    '202607/29',
    '202607/12',
    '20260629-20260728',
  ], 3);
  assert.deepEqual(recent, ['202607/29', '20260629-20260728']);
}

function testTwoWeekWindowUsesLatestAvailableDataRatherThanWallClock() {
  const windowed = hotWords.selectWindow([
    { paper_id: 'inside', date: '2026-07-29', title_en: 'Inside' },
    { paper_id: 'edge', date: '2026-07-16', title_en: 'Edge' },
    { paper_id: 'outside', date: '2026-07-15', title_en: 'Outside' },
  ], 14);
  assert.equal(windowed.start, hotWords.dateStamp('2026-07-16'));
  assert.deepEqual(windowed.records.map((item) => item.key).sort(), ['edge', 'inside']);
}

function testCloudPrefersUsefulPhrasesAndCapsRepeatedTextPerPaper() {
  const cloud = hotWords.buildWordCloud([
    {
      key: 'one',
      title: 'Vision-Language-Action Models for Autonomous Driving',
      abstract: 'Vision language action is useful. Vision language action is useful.',
    },
    {
      key: 'two',
      title: 'World Models for Robot Manipulation',
      abstract: 'Autonomous driving needs a world model.',
    },
  ], 20);
  const byWord = Object.fromEntries(cloud.map((item) => [item.word, item]));
  assert.ok(byWord['vision language action']);
  assert.ok(byWord['world model']);
  assert.ok(byWord['autonomous driving']);
  assert.equal(byWord.model, undefined, 'generic bare model should be filtered');
  assert.equal(byWord['vision language action'].documents, 1, 'one paper only contributes one document hit');
}

function testDuplicatePaperRecordsDoNotInflateTheCloud() {
  const windowed = hotWords.selectWindow([
    { paper_id: 'same', date: '2026-07-29', title_en: 'Diffusion Models for Robotics' },
    { paper_id: 'same', date: '2026-07-29', title_en: 'Diffusion Models for Robotics' },
  ], 14);
  assert.equal(windowed.records.length, 1);
}

testSidebarDateFoldersAreDeduplicated();
testRecentFoldersSupportDailyAndRangeReports();
testTwoWeekWindowUsesLatestAvailableDataRatherThanWallClock();
testCloudPrefersUsefulPhrasesAndCapsRepeatedTextPerPaper();
testDuplicatePaperRecordsDoNotInflateTheCloud();
console.log('home hot words tests passed');
