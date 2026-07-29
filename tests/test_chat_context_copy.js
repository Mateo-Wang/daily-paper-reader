const assert = require('node:assert/strict');
const fs = require('node:fs');

const chat = fs.readFileSync('app/chat.discussion.js', 'utf8');
const css = fs.readFileSync('app/app.css', 'utf8');

assert.ok(chat.includes('id="chat-copy-context-btn"'), 'chat input should expose a copy-context button');
assert.ok(chat.includes("fetchPaperContextFile(paperId, 'md')"), 'copy context should include the generated paper markdown');
assert.ok(chat.includes("fetchPaperContextFile(paperId, 'txt')"), 'copy context should include extracted full paper text');
assert.ok(chat.includes('loadChatHistory(paperId)'), 'copy context should include prior discussion history');
assert.ok(chat.includes('## 我接下来想追问的问题'), 'copied text should leave a clear prompt slot');
assert.ok(chat.includes('navigator.clipboard'), 'copy action should use the browser clipboard API');
const copyBlock = chat.slice(chat.indexOf('const buildPaperClipboardContext ='), chat.indexOf('const renderChatUI ='));
assert.ok(!copyBlock.includes('apiKey'), 'copy-context implementation must not include model credentials');
assert.match(css, /\.chat-copy-context-btn\s*\{[\s\S]*pointer-events:\s*auto/i, 'copy button must remain clickable in the fixed input area');
const chatUi = chat.slice(chat.indexOf('const renderChatUI ='), chat.indexOf('const QUICK_RUN_CONFERENCES ='));
assert.ok(chatUi.indexOf('id="chat-copy-context-btn"') < chatUi.indexOf('id="user-input"'), 'copy button should be rendered in the input box before the textarea');
assert.ok(chatUi.indexOf('id="chat-model-picker"') < chatUi.indexOf('id="chat-questions-toggle-btn"'), 'model picker should be placed before the lower-right send controls');
assert.match(css, /#paper-chat-container \.input-area > \.chat-copy-context-btn\s*\{[\s\S]*position:\s*absolute[\s\S]*top:\s*16px[\s\S]*right:\s*20px/i, 'copy button should sit at the input box upper-right corner');
assert.match(css, /#paper-chat-container \.input-area \.chat-model-picker\s*\{[\s\S]*position:\s*absolute[\s\S]*left:\s*0[\s\S]*bottom:\s*0/i, 'model picker should sit at the input box lower-left corner');
assert.match(css, /#paper-chat-container \.chat-input-submit-actions\s*\{[\s\S]*position:\s*absolute[\s\S]*right:\s*0[\s\S]*bottom:\s*0/i, 'send controls should remain anchored at the lower-right corner');
assert.match(css, /#paper-chat-container #send-btn\s*\{[\s\S]*flex:\s*0 0 auto[\s\S]*white-space:\s*nowrap/i, 'send button should never collapse in the compact mobile input footer');

console.log('chat context copy tests passed');
