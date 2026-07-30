/**
 * DPR Home Research Topics
 *
 * The homepage deliberately renders a compact, editorially curated topic
 * collection.  DeepSeek creates docs/hot-words.json in the existing daily and
 * frontier pipelines; this browser module only validates and presents that
 * generated public data.  We never fall back to a noisy term-frequency cloud.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  var api = factory();
  root.DPRHomeHotWords = api;
  api.autoInit(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TOPICS_URL = 'docs/hot-words.json';
  var MAX_TOPICS = 7;

  function text(value) { return String(value == null ? '' : value); }

  function escapeHtml(value) {
    return text(value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function cleanPhrase(value) {
    return text(value).replace(/\s+/g, ' ').trim().replace(/^[\-–—]+|[\-–—]+$/g, '');
  }

  function validTopic(value) {
    if (!value || typeof value !== 'object') return null;
    var phrase = cleanPhrase(value.phrase_en);
    var summary = text(value.summary_zh).trim();
    var words = phrase.match(/[a-z0-9]+/gi) || [];
    if (!summary || words.length < 2 || words.length > 7 || phrase.length > 84 || summary.length > 96) return null;
    return { phrase_en: phrase, summary_zh: summary };
  }

  function validPayload(payload) {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.topics)) return null;
    var seen = {};
    var topics = payload.topics.map(validTopic).filter(function (topic) {
      if (!topic) return false;
      var key = topic.phrase_en.toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).slice(0, MAX_TOPICS);
    if (topics.length < 4) return null;
    var windowInfo = payload.window && typeof payload.window === 'object' ? payload.window : {};
    return {
      topics: topics,
      recordCount: Math.max(0, Number(payload.record_count) || 0),
      start: text(windowInfo.start).slice(0, 10),
      end: text(windowInfo.end).slice(0, 10),
    };
  }

  function fetchTopics(win) {
    if (!win || typeof win.fetch !== 'function') return Promise.reject(new Error('fetch unavailable'));
    return win.fetch(TOPICS_URL, { cache: 'no-store' }).then(function (response) {
      if (!response || !response.ok) throw new Error('HTTP ' + (response && response.status || 0));
      return response.json();
    }).then(function (payload) {
      var valid = validPayload(payload);
      if (!valid) throw new Error('invalid curated topic data');
      return valid;
    });
  }

  function renderPanel(container, data) {
    if (!container) return;
    var range = data.start && data.end ? data.start + ' — ' + data.end : '近两周';
    var cards = data.topics.map(function (topic, index) {
      return '<button type="button" class="dpr-home-hot-topic" data-dpr-hot-topic="' +
        escapeHtml(topic.phrase_en) + '" data-dpr-topic-index="' + index + '">' +
        '<span class="dpr-home-hot-topic-index">0' + (index + 1) + '</span>' +
        '<span class="dpr-home-hot-topic-name">' + escapeHtml(topic.phrase_en) + '</span>' +
        '<span class="dpr-home-hot-topic-summary">' + escapeHtml(topic.summary_zh) + '</span>' +
        '<span class="dpr-home-hot-topic-arrow" aria-hidden="true">↗</span></button>';
    }).join('');
    container.innerHTML =
      '<div class="dpr-home-panel-header">' +
      '<div><p class="dpr-home-hotwords-eyebrow">DEEPSEEK CURATED</p><h3 class="dpr-home-hotwords-title">AI 精选研究主题</h3>' +
      '<p class="dpr-home-hotwords-range">' + escapeHtml(range) + ' · 基于 ' + data.recordCount + ' 篇论文与 AI 前沿</p></div>' +
      '<span class="dpr-home-hotwords-live" aria-label="由 DeepSeek 提炼">CURATED</span></div>' +
      '<div class="dpr-home-hotwords-cloud" aria-label="精选英文研究主题">' + cards + '</div>' +
      '<p class="dpr-home-hotwords-hint">点击主题，可在左侧论文库中继续检索</p>';
  }

  function renderLoading(container) {
    if (!container) return;
    container.innerHTML = '<div class="dpr-home-panel-header"><div><p class="dpr-home-hotwords-eyebrow">DEEPSEEK CURATED</p><h3 class="dpr-home-hotwords-title">AI 精选研究主题</h3><p class="dpr-home-hotwords-range">正在整理近两周论文与 AI 前沿…</p></div><span class="dpr-home-hotwords-live">CURATED</span></div><div class="dpr-home-hotwords-cloud is-loading" aria-busy="true"><span></span><span></span><span></span><span></span></div>';
  }

  function renderUnavailable(container) {
    if (!container) return;
    container.innerHTML = '<div class="dpr-home-panel-header"><div><p class="dpr-home-hotwords-eyebrow">DEEPSEEK CURATED</p><h3 class="dpr-home-hotwords-title">AI 精选研究主题</h3><p class="dpr-home-hotwords-range">下一次数据更新后显示</p></div><span class="dpr-home-hotwords-live">CURATED</span></div><div class="dpr-home-hotwords-empty"><strong>正在等待精选主题</strong><span>DeepSeek 会从近期论文与 AI 前沿中提炼少量值得关注的技术信号。</span></div>';
  }

  function findContainer(win) {
    if (!win || !win.document) return null;
    return win.document.querySelector('[data-dpr-home-hotwords]') || win.document.querySelector('.dpr-home-promo-card');
  }

  function isHome(win) {
    var hash = text(win && win.location && win.location.hash);
    return !hash || hash === '#' || /^#\/?$/.test(hash);
  }

  function searchForTopic(win, phrase) {
    if (win && win.DPRSidebar && typeof win.DPRSidebar.searchPapers === 'function') {
      win.DPRSidebar.searchPapers(phrase);
      return;
    }
    var input = win && win.document && win.document.querySelector('.dpr-sidebar-search');
    if (input) {
      input.value = phrase;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function refresh(win) {
    if (!isHome(win)) return Promise.resolve(null);
    var container = findContainer(win);
    if (!container || container.getAttribute('data-dpr-hotwords-loading') === '1') return Promise.resolve(null);
    container.classList.remove('dpr-home-promo-card');
    container.classList.add('dpr-home-hotwords-card', 'dpr-home-panel');
    container.setAttribute('data-dpr-home-hotwords', '');
    container.setAttribute('data-dpr-hotwords-loading', '1');
    renderLoading(container);
    return fetchTopics(win).then(function (data) {
      renderPanel(container, data);
      return data;
    }).catch(function () {
      renderUnavailable(container);
      return null;
    }).finally(function () {
      container.removeAttribute('data-dpr-hotwords-loading');
    });
  }

  function autoInit(win) {
    if (!win || !win.document || win.__dprHotWordsInit) return;
    win.__dprHotWordsInit = true;
    win.document.addEventListener('click', function (event) {
      var target = event.target && event.target.closest ? event.target.closest('[data-dpr-hot-topic]') : null;
      if (!target) return;
      event.preventDefault();
      searchForTopic(win, target.getAttribute('data-dpr-hot-topic'));
    });
    win.document.addEventListener('dpr-docsify-ready', function () { refresh(win); });
    win.addEventListener('hashchange', function () {
      win.setTimeout(function () { refresh(win); }, 0);
    });
    win.setTimeout(function () { refresh(win); }, 0);
  }

  return {
    validTopic: validTopic,
    validPayload: validPayload,
    fetchTopics: fetchTopics,
    refresh: refresh,
    autoInit: autoInit,
  };
});
