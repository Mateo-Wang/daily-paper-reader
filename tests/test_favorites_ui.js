const assert = require('node:assert/strict');
const fs = require('node:fs');

const index = fs.readFileSync('index.html', 'utf8');
const sidebar = fs.readFileSync('app/dpr-sidebar.js', 'utf8');
const plugin = fs.readFileSync('app/docsify-plugin.js', 'utf8');
const ambient = fs.readFileSync('app/paper-ambient.js', 'utf8');
const css = fs.readFileSync('app/app.css', 'utf8');
const data = JSON.parse(fs.readFileSync('data/favorites.json', 'utf8'));

assert.ok(index.indexOf("path: 'app/favorites.js'") < index.indexOf("path: 'app/dpr-sidebar.js'"), 'favorites must load before sidebar rendering');
assert.ok(index.includes("path: 'app/paper-ambient.js'"), 'paper-only ambient enhancement should be loaded');
assert.equal(data.version, 1);
assert.ok(data.favorites && typeof data.favorites === 'object' && !Array.isArray(data.favorites));
Object.entries(data.favorites).forEach(([paperId, favorite]) => {
  assert.equal(favorite.paper_id, paperId, 'favorite entries should remain deduplicated by paper_id');
});

assert.ok(sidebar.includes('data-filter="favorites"'), 'sidebar should expose an 已收藏 entry');
assert.ok(sidebar.includes('data-favorite-filter="tag"'), 'favorite list should filter by tag');
assert.ok(sidebar.includes('data-favorite-filter="score"'), 'favorite list should filter by score');
assert.ok(sidebar.includes('data-favorite-filter="date"'), 'favorite list should filter by date');
assert.ok(sidebar.includes('data-favorite-remove-selected'), 'favorite list should support batch removal');
assert.ok(sidebar.includes('data-favorite-export="md"'), 'favorite list should export Markdown');
assert.ok(sidebar.includes('data-favorite-export="csv"'), 'favorite list should export CSV');

assert.ok(plugin.includes('data-paper-favorite-toggle'), 'paper detail hero should expose a favorite button');
assert.ok(plugin.includes('bindPaperFavorite'), 'paper detail favorite interaction must be bound after rendering');
assert.ok(plugin.includes('favoriteSnapshotForCurrentPaper'), 'paper metadata should be passed to the repository favorite store');

assert.match(css, /\.dpr-sidebar-favorite-btn\.is-favorite\s*\{[^}]*color:\s*#dc2626/i, 'favorited sidebar cards should show a red star');
assert.match(css, /\.paper-favorite-toggle\.is-favorite\s*\{[^}]*#fff1f3/i, 'favorited detail button should use the red selected state');
assert.match(css, /#dpr-sidebar-v2\.is-filter-favorites\s+\.dpr-sidebar-favorite-filters\s*\{[^}]*display:\s*block/i, 'favorite filters should appear only in favorite mode');
assert.match(css, /\.dpr-cursor-petals\s*\{[^}]*pointer-events:\s*none/i, 'ambient motion must never block page controls');
assert.ok(ambient.includes("prefers-reduced-motion: reduce"), 'ambient motion should respect reduced-motion preferences');
assert.ok(ambient.includes("document.body.classList.contains('dpr-paper-page')"), 'ambient motion should run only on paper pages');
assert.ok(ambient.includes('MutationObserver'), 'ambient layer should be removed when leaving a paper route');

console.log('favorites UI contract tests passed');
