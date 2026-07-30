const assert = require('node:assert/strict');
const fs = require('node:fs');

const plugin = fs.readFileSync('app/docsify-plugin.js', 'utf8');
const css = fs.readFileSync('app/app.css', 'utf8');

assert.ok(plugin.includes('class="paper-hero"'), 'paper pages should render a dedicated hero');
assert.ok(plugin.includes('class="paper-hero-actions"'), 'hero should retain the action row');
assert.ok(plugin.includes('paper-title-en paper-title-primary'), 'English title should be the hero primary title');
assert.ok(plugin.includes('paper-title-zh paper-title-subtitle'), 'Chinese title should be the hero subtitle');
assert.ok(plugin.includes('data-pdf-preview-toggle'), 'PDF preview control must remain available');
assert.ok(plugin.includes('class="dpr-pdf-download-link"'), 'PDF download control must remain available');
assert.ok(plugin.includes('data-obsidian-connect'), 'Obsidian folder picker must remain available');
assert.ok(plugin.includes('data-obsidian-import'), 'Obsidian import must remain available');
assert.ok(plugin.includes('class="paper-section-heading"><span>Quick Read</span><h2>速览</h2>'), 'quick read should have an explicit first section heading');
assert.ok(plugin.includes('class="paper-glance-summary-label">全文概括'), 'TLDR should render as the full-width quick-read summary card');
assert.ok(plugin.includes('<strong>概述</strong>'), 'the metadata overview row should remain available');
assert.ok(plugin.includes('extractQuickReadTldr'), 'full summary should use the detailed TLDR from the source quick-read section');
assert.ok(plugin.includes('stripLegacyQuickReadSection'), 'legacy Markdown quick-read content should be removed after rendering the new cards');
assert.ok(plugin.includes("if (root.querySelector('.paper-hero'))"), 'hero pages should skip the legacy duplicate title bar');

assert.match(css, /body\.dpr-paper-page \.paper-glance-row\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/, 'desktop quick read should use a roomy 2×2 grid');
assert.match(css, /@media \(max-width: 760px\)[\s\S]*paper-glance-row\s*\{[\s\S]*grid-template-columns:\s*1fr/, 'mobile quick read should stack cleanly');
assert.match(css, /body\.dpr-paper-page \.dpr-page-content > h2 > a[\s\S]*color:\s*var\(--dpr-paper-ink\) !important/, 'markdown heading links should use the reading-page title color');
assert.match(css, /--dpr-paper-heading:\s*#302b45/, 'paper headings should use the purple-tinted graphite color');
assert.match(css, /\.dpr-page-content > h2 > a \*[\s\S]*color:\s*inherit !important/, 'nested Docsify heading text should inherit the paper heading color');
assert.match(css, /\.dpr-page-content > h3 > a \*[\s\S]*color:\s*inherit !important/, 'nested third-level heading text should inherit the paper heading color');
assert.match(css, /body\.dpr-paper-page \.paper-glance-summary\s*\{[\s\S]*border-left:\s*4px solid var\(--dpr-paper-violet\)/, 'full summary should be a distinct purple-accented card');

console.log('paper detail layout tests passed');
