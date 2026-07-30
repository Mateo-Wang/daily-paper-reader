const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve('app/favorites.js');

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

function encode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

async function run() {
  const events = [];
  const writes = [];
  let putAttempts = 0;
  let conflictsRemaining = 0;
  let repositoryData = {
    version: 1,
    updated_at: '',
    favorites: {
      'arxiv:2607.08375': {
        paper_id: 'arxiv:2607.08375',
        href: '#/range/2607.08375v1-paper',
        title: 'Existing title',
        title_zh: '',
        source: 'arxiv',
        date: '2026-07-09',
        score: 9,
        tags: [{ kind: 'query', label: 'driving' }],
        added_at: '2026-07-30T00:00:00.000Z',
      },
    },
  };

  global.window = {
    location: {
      hostname: 'mateo-wang.github.io',
      pathname: '/daily-paper-reader/',
    },
    decoded_secret_private: { github: { token: 'test-token' } },
    document: {
      dispatchEvent(event) { events.push(event); },
    },
    CustomEvent: function CustomEvent(name, init) {
      this.type = name;
      this.detail = init && init.detail;
    },
    fetch: async (url, init = {}) => {
      if (/api\.github\.com\/repos\/mateo-wang\/daily-paper-reader$/.test(url)) {
        return response(200, { default_branch: 'main' });
      }
      if (/\/contents\/data\/favorites\.json/.test(url) && (!init.method || init.method === 'GET')) {
        return response(200, { sha: 'sha-current', content: encode(repositoryData) });
      }
      if (/\/contents\/data\/favorites\.json/.test(url) && init.method === 'PUT') {
        putAttempts += 1;
        if (conflictsRemaining > 0) {
          conflictsRemaining -= 1;
          return response(409, {});
        }
        const payload = JSON.parse(init.body);
        repositoryData = JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8'));
        writes.push(payload);
        return response(200, { content: { sha: 'sha-next' } });
      }
      return response(404, {});
    },
  };

  delete require.cache[modulePath];
  const favorites = require(modulePath);
  await favorites.ready;

  assert.equal(favorites.normalizePaperId('#/range/2607.08375v1-paper'), 'arxiv:2607.08375');
  assert.equal(favorites.normalizePaperId('#/range/2607.08375v4-paper'), 'arxiv:2607.08375');
  assert.equal(favorites.getEntries().length, 1);
  assert.equal(favorites.isFavorite('2607.08375v9'), true);

  const updated = {
    id: '#/range/2607.08375v2-paper',
    href: '#/range/2607.08375v2-paper',
    title: 'Updated title',
    source: 'arxiv',
    date: '2026-07-09',
    score: 9.1,
    tags: ['query:driving', 'query:driving'],
  };
  await favorites.update(updated, true);
  assert.equal(Object.keys(repositoryData.favorites).length, 1, 'arXiv versions must not duplicate a favorite');
  assert.equal(repositoryData.favorites['arxiv:2607.08375'].title, 'Updated title');
  assert.equal(repositoryData.favorites['arxiv:2607.08375'].tags.length, 1);
  assert.equal(writes.length, 1);

  await favorites.update(updated, true);
  assert.equal(writes.length, 1, 'an identical favorite update must be idempotent');

  const markdown = favorites.exportMarkdown(favorites.getEntries());
  const csv = favorites.exportCsv(favorites.getEntries());
  assert.match(markdown, /# 已收藏论文/);
  assert.match(markdown, /Updated title/);
  assert.match(csv, /"paper_id","title","title_zh"/);
  assert.match(csv, /arxiv:2607\.08375/);

  await favorites.update(updated, false);
  assert.equal(Object.keys(repositoryData.favorites).length, 0);
  assert.equal(writes.length, 2);
  conflictsRemaining = 1;
  const attemptsBeforeBatch = putAttempts;
  await favorites.updateMany([
    updated,
    {
      id: '#/20260730/2607.23909v1-unified-diffusion-transformer',
      href: '#/20260730/2607.23909v1-unified-diffusion-transformer',
      title: 'Unified Diffusion Transformer',
      source: 'arxiv',
      date: '2026-07-27',
      score: 9,
      tags: ['query:robotics'],
    },
  ], true);
  assert.equal(Object.keys(repositoryData.favorites).length, 2);
  assert.equal(writes.length, 3, 'a batch favorite operation should create one repository write');
  assert.equal(putAttempts, attemptsBeforeBatch + 2, 'a concurrent SHA conflict should refetch and retry safely');
  assert.ok(events.some((event) => event.type === 'dpr-favorites-changed'));

  delete global.window;
  delete require.cache[modulePath];
  console.log('favorites tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
