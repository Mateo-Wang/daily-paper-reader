const assert = require('node:assert/strict');
const fs = require('node:fs');

const chat = fs.readFileSync('app/chat.discussion.js', 'utf8');
const css = fs.readFileSync('app/app.css', 'utf8');

assert.ok(chat.includes('id="chat-copy-context-btn"'), 'chat footer should expose a copy-context button');
assert.ok(chat.includes("fetchPaperContextFile(paperId, 'md')"), 'copy context should include the generated paper markdown');
assert.ok(chat.includes("fetchPaperContextFile(paperId, 'txt')"), 'copy context should include extracted full paper text');
assert.ok(chat.includes('loadChatHistory(paperId)'), 'copy context should include prior discussion history');
assert.ok(chat.includes('## 我接下来想追问的问题'), 'copied text should leave a clear prompt slot');
assert.ok(chat.includes('navigator.clipboard'), 'copy action should use the browser clipboard API');
const copyBlock = chat.slice(chat.indexOf('const buildPaperClipboardContext ='), chat.indexOf('const renderChatUI ='));
assert.ok(!copyBlock.includes('apiKey'), 'copy-context implementation must not include model credentials');
assert.match(css, /\.chat-copy-context-btn\s*\{[\s\S]*pointer-events:\s*auto/i, 'copy button must remain clickable in the fixed footer');

console.log('chat context copy tests passed');
