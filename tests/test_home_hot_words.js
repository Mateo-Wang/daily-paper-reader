const assert = require('node:assert/strict');
const hotWords = require('../app/home-hot-words.js');

function testCuratedPayloadKeepsOnlyConciseUniqueTopics() {
  const data = hotWords.validPayload({
    record_count: 42,
    window: { start: '2026-07-16', end: '2026-07-29' },
    topics: [
      { phrase_en: 'future-frame supervision', summary_zh: '用未来状态约束表征学习' },
      { phrase_en: 'contact-rich tactile modeling', summary_zh: '面向复杂接触的多模态建模' },
      { phrase_en: 'world-model-guided planning', summary_zh: '预测动态辅助候选轨迹筛选' },
      { phrase_en: 'latent action pretraining', summary_zh: '从视频中学习可迁移的潜在动作' },
      { phrase_en: ' FUTURE-frame supervision ', summary_zh: '重复项应被过滤' },
    ],
  });
  assert.ok(data);
  assert.equal(data.recordCount, 42);
  assert.equal(data.topics.length, 4);
  assert.deepEqual(data.topics.map((topic) => topic.phrase_en), [
    'future-frame supervision',
    'contact-rich tactile modeling',
    'world-model-guided planning',
    'latent action pretraining',
  ]);
}

function testPayloadRejectsNoisyOrInsufficientData() {
  assert.equal(hotWords.validTopic({ phrase_en: 'single', summary_zh: '词数不足' }), null);
  assert.equal(hotWords.validTopic({ phrase_en: 'one two three four five six seven eight', summary_zh: '过长' }), null);
  assert.ok(hotWords.validPayload({ topics: [
    { phrase_en: 'future-frame supervision', summary_zh: 'a' },
    { phrase_en: 'contact-rich tactile modeling', summary_zh: 'b' },
    { phrase_en: 'world-model-guided planning', summary_zh: 'c' },
  ] }));
  assert.equal(hotWords.validPayload({ topics: [
    { phrase_en: 'future-frame supervision', summary_zh: 'a' },
    { phrase_en: 'contact-rich tactile modeling', summary_zh: 'b' },
  ] }), null);
}

testCuratedPayloadKeepsOnlyConciseUniqueTopics();
testPayloadRejectsNoisyOrInsufficientData();
console.log('home curated topic tests passed');
