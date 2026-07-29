const assert = require('node:assert/strict');

const {
  buildObsidianNote,
  makeCollisionFileName,
  resolveFolder,
  sanitizeFileName,
  writeNoteWithoutOverwrite,
} = require('../app/obsidian-export-utils.js');

const samplePageMarkdown = `---
title: A / Unsafe: Title? for <Windows>
title_zh: 用于测试的论文
authors: "Ada Lovelace, Grace Hopper"
date: 2026-07-28
pdf: "https://arxiv.org/pdf/2607.12345v1"
tags: ["query:robotics", "keyword:world-model"]
score: 9.0
evidence: 适合机器人研究。
tldr: 这是一个简短概述。
source: arxiv
---

## 摘要

中文摘要。

## Abstract

English abstract.

## 论文详细总结

不应被当作摘要导出。
`;

function testFilenameIsCrossPlatformSafe() {
  assert.equal(
    sanitizeFileName('A / Unsafe: Title? for <Windows>'),
    'A Unsafe Title for Windows',
  );
  assert.equal(sanitizeFileName('CON', 'paper'), 'paper');
}

function testMatchedTagAndDrivingFallbackChooseExpectedFolder() {
  assert.deepEqual(
    resolveFolder({
      matched_query_tag: 'robotics',
      tags: ['query:driving', 'query:robotics'],
    }),
    { name: 'robotics', sourceTag: 'query:robotics' },
  );
  assert.deepEqual(
    resolveFolder({ tags: ['query:robotics', 'query:driving'] }),
    { name: 'driving', sourceTag: 'query:driving' },
  );
}

function testNoteContainsMetadataAndAllPaperSections() {
  const note = buildObsidianNote({
    paperId: '202607/28/2607.12345v1-example',
    pageMd: samplePageMarkdown,
    pageUrl: 'https://example.test/#/202607/28/2607.12345v1-example',
    generatedAt: '2026-07-29T00:00:00.000Z',
  });

  assert.equal(note.folderName, 'robotics');
  assert.equal(note.fileName, 'A Unsafe Title for Windows.md');
  assert.match(note.markdown, /dpr_paper_id: "202607\/28\/2607\.12345v1-example"/);
  assert.match(note.markdown, /query_tag: "query:robotics"/);
  assert.match(note.markdown, /arxiv_id: "2607\.12345v1"/);
  assert.match(note.markdown, /## 推荐理由\n\n适合机器人研究。/);
  assert.match(note.markdown, /## 概述\n\n这是一个简短概述。/);
  assert.match(note.markdown, /## 摘要\n\n中文摘要。/);
  assert.match(note.markdown, /## Abstract\n\nEnglish abstract。?/);
  assert.match(note.markdown, /## 论文详细总结\n\n不应被当作摘要导出。/);
  assert.ok(note.markdown.includes('<!-- dpr-source-block:'));
}

function testCollisionFileKeepsTitleAndAddsStablePaperId() {
  assert.equal(
    makeCollisionFileName('A Paper.md', '2607.12345v1'),
    'A Paper [2607.12345v1].md',
  );
}

const createMemoryDirectory = (initialFiles = {}) => {
  const files = new Map(Object.entries(initialFiles));
  return {
    files,
    async getFileHandle(name, options) {
      if (!files.has(name)) {
        if (!options || !options.create) {
          const error = new Error('not found');
          error.name = 'NotFoundError';
          throw error;
        }
        files.set(name, '');
      }
      return {
        async getFile() {
          const content = files.get(name) || '';
          return {
            size: Buffer.byteLength(content),
            async text() { return content; },
          };
        },
        async createWritable(options = {}) {
          let next = options.keepExistingData ? files.get(name) || '' : '';
          return {
            async write(content) {
              if (content && typeof content === 'object' && content.type === 'write') {
                const position = Number(content.position) || 0;
                const data = String(content.data || '');
                next = next.slice(0, position) + data + next.slice(position + data.length);
                return;
              }
              next = String(content);
            },
            async close() { files.set(name, next); },
          };
        },
      };
    },
  };
};

async function testWriterNeverOverwritesAndUsesStableCollisionName() {
  const samePaper = '---\ndpr_paper_id: "same-paper"\n---\nexisting\n';
  const directory = createMemoryDirectory({
    'A Paper.md': 'a different note',
    'Same Paper.md': samePaper,
  });
  const saved = await writeNoteWithoutOverwrite(directory, {
    fileName: 'A Paper.md',
    paperId: 'paper-123',
    markdown: 'new paper',
  });
  assert.deepEqual(saved, { status: 'saved', fileName: 'A Paper [paper-123].md' });
  assert.equal(directory.files.get('A Paper.md'), 'a different note');
  assert.equal(directory.files.get('A Paper [paper-123].md'), 'new paper');

  const exists = await writeNoteWithoutOverwrite(directory, {
    fileName: 'Same Paper.md',
    paperId: 'same-paper',
    markdown: 'must not replace',
  });
  assert.deepEqual(exists, { status: 'exists', fileName: 'Same Paper.md' });
  assert.equal(directory.files.get('Same Paper.md'), samePaper);
}

async function testWriterAppendsOnlyNewDetailedSections() {
  const initial = buildObsidianNote({
    paperId: 'paper-with-detail',
    pageMd: `${samplePageMarkdown}\n## 技术细节\n\n第一版技术细节。`,
    pageUrl: 'https://example.test/paper',
    generatedAt: '2026-07-29T00:00:00.000Z',
  });
  const directory = createMemoryDirectory({ 'Detailed Paper.md': initial.markdown });
  const refreshed = buildObsidianNote({
    paperId: 'paper-with-detail',
    pageMd: `${samplePageMarkdown}\n## 技术细节\n\n第一版技术细节。\n\n## 新实验\n\n新增实验结果。`,
    pageUrl: 'https://example.test/paper',
    generatedAt: '2026-07-30T00:00:00.000Z',
  });
  refreshed.fileName = 'Detailed Paper.md';
  const updated = await writeNoteWithoutOverwrite(directory, refreshed);
  const afterFirstUpdate = directory.files.get('Detailed Paper.md');
  assert.deepEqual(updated, { status: 'updated', fileName: 'Detailed Paper.md', addedBlocks: 1 });
  assert.match(afterFirstUpdate, /## 新实验\n\n新增实验结果。/);
  assert.equal((afterFirstUpdate.match(/## 新实验/g) || []).length, 1);

  const unchanged = await writeNoteWithoutOverwrite(directory, refreshed);
  assert.deepEqual(unchanged, { status: 'exists', fileName: 'Detailed Paper.md' });
  assert.equal(directory.files.get('Detailed Paper.md'), afterFirstUpdate);
}

testFilenameIsCrossPlatformSafe();
testMatchedTagAndDrivingFallbackChooseExpectedFolder();
testNoteContainsMetadataAndAllPaperSections();
testCollisionFileKeepsTitleAndAddsStablePaperId();
testWriterNeverOverwritesAndUsesStableCollisionName()
  .then(testWriterAppendsOnlyNewDetailedSections)
  .then(() => console.log('obsidian export utility tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
