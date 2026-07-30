/**
 * DPR Home Hot Words
 *
 * A deliberately small, dependency-free homepage word cloud.  The data is
 * computed in the browser from the same generated paper metadata that powers
 * the reader, plus the editorial AI-frontier index.  Nothing is sent away.
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

  var SIDEBAR_URL = 'docs/_sidebar.md';
  var FRONTIER_URL = 'docs/frontier/index.json';
  var WINDOW_DAYS = 14;
  var MAX_WORDS = 26;
  var STOP_WORDS = {
    a: 1, an: 1, and: 1, are: 1, as: 1, at: 1, be: 1, been: 1, between: 1,
    by: 1, can: 1, for: 1, from: 1, in: 1, into: 1, is: 1, it: 1, its: 1,
    of: 1, on: 1, or: 1, our: 1, that: 1, the: 1, their: 1, this: 1,
    through: 1, to: 1, using: 1, via: 1, we: 1, with: 1, within: 1,
    while: 1, across: 1, than: 1, these: 1, those: 1, they: 1, which: 1, under: 1,
    new: 1, novel: 1, approach: 1, approaches: 1, based: 1, framework: 1,
    method: 1, methods: 1, model: 1, models: 1, paper: 1, papers: 1,
    performance: 1, proposed: 1, propose: 1, results: 1, task: 1, tasks: 1,
    existing: 1, introduce: 1, introduced: 1, introduces: 1, present: 1,
    demonstrate: 1, demonstrates: 1, show: 1, shows: 1, study: 1,
    towards: 1, use: 1, used: 1, learning: 1, data: 1, large: 1,
  };
  var PHRASES = [
    ['vision language action', /\bvision[\s-]+language[\s-]+action(?:[\s-]+models?)?\b/gi],
    ['vision language model', /\bvision[\s-]+language[\s-]+models?\b/gi],
    ['world model', /\bworld[\s-]+models?\b/gi],
    ['autonomous driving', /\bautonomous[\s-]+driving\b/gi],
    ['reinforcement learning', /\breinforcement[\s-]+learning\b/gi],
    ['foundation model', /\bfoundation[\s-]+models?\b/gi],
    ['large language model', /\blarge[\s-]+language[\s-]+models?\b/gi],
    ['robot manipulation', /\brobot(?:ic)?[\s-]+manipulation\b/gi],
    ['end to end', /\bend[\s-]+to[\s-]+end\b/gi],
    ['diffusion model', /\bdiffusion[\s-]+models?\b/gi],
    ['multi agent', /\bmulti[\s-]+agent\b/gi],
  ];

  function text(value) { return String(value == null ? '' : value); }

  function dateStamp(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(value).trim());
    if (!match) return 0;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function dateLabel(stamp) {
    if (!stamp) return '';
    return new Date(stamp).toISOString().slice(0, 10);
  }

  function makePaperKey(item) {
    var id = text(item && (item.paper_id || item.id || item.url || item.path)).trim();
    if (id) return id.toLowerCase();
    return (text(item && item.title_en) || text(item && item.title)).trim().toLowerCase();
  }

  function normalisePaper(item, kind) {
    var source = item || {};
    return {
      key: makePaperKey(source),
      date: text(source.discovered_at || source.selected_at || source.date || source.published_at),
      title: text(source.title_en || source.title),
      abstract: text(source.abstract_en || source.abstract || source.summary),
      kind: kind || 'paper',
    };
  }

  function uniquePapers(items) {
    var seen = {};
    return (items || []).filter(function (item) {
      var key = makePaperKey(item);
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function selectWindow(items, days) {
    var records = uniquePapers(items || []).map(function (item) { return normalisePaper(item, item.kind); });
    var latest = records.reduce(function (max, item) { return Math.max(max, dateStamp(item.date)); }, 0);
    if (!latest) return { records: [], start: 0, end: 0 };
    var start = latest - (Math.max(1, Number(days) || WINDOW_DAYS) - 1) * 86400000;
    return {
      records: records.filter(function (item) {
        var stamp = dateStamp(item.date);
        return stamp >= start && stamp <= latest;
      }),
      start: start,
      end: latest,
    };
  }

  function addWeight(counts, documents, word, weight, key) {
    var token = text(word).trim().toLowerCase();
    if (!token || token.length < 3 || STOP_WORDS[token]) return;
    counts[token] = (counts[token] || 0) + weight;
    documents[token] = documents[token] || {};
    documents[token][key] = true;
  }

  function countText(counts, documents, source, weight, documentKey) {
    var residual = text(source).toLowerCase();
    PHRASES.forEach(function (entry) {
      var found = false;
      residual = residual.replace(entry[1], function () {
        found = true;
        return ' ';
      });
      if (found) addWeight(counts, documents, entry[0], weight * 1.35, documentKey);
    });
    var tokens = residual.match(/[a-z][a-z0-9-]{2,}/g) || [];
    var present = {};
    tokens.forEach(function (token) {
      var normalized = token.replace(/'s$/i, '');
      if (/ies$/i.test(normalized)) normalized = normalized.slice(0, -3) + 'y';
      if (present[normalized]) return;
      present[normalized] = true;
      addWeight(counts, documents, normalized, weight, documentKey);
    });
  }

  function buildWordCloud(records, limit) {
    var counts = {};
    var documents = {};
    (records || []).forEach(function (record, index) {
      var key = text(record.key || record.paper_id || record.id || index);
      countText(counts, documents, record.title, 3, key);
      countText(counts, documents, record.abstract, 1, key);
    });
    return Object.keys(counts).map(function (word) {
      return { word: word, score: counts[word], documents: Object.keys(documents[word] || {}).length };
    }).filter(function (item) {
      return item.documents >= 1 && item.score >= 2.5;
    }).sort(function (a, b) {
      return b.score - a.score || b.documents - a.documents || a.word.localeCompare(b.word);
    }).slice(0, Math.max(1, Number(limit) || MAX_WORDS));
  }

  function dateFoldersFromSidebar(content) {
    var folders = {};
    var regex = /#\/((?:\d{6}\/\d{2})|(?:\d{8}-\d{8}))\//g;
    var match;
    while ((match = regex.exec(text(content)))) {
      folders[match[1]] = true;
    }
    return Object.keys(folders).sort().reverse();
  }

  function folderDateStamp(folder) {
    var textFolder = text(folder);
    var compact = /^(\d{6})\/(\d{2})$/.exec(textFolder);
    if (compact) return dateStamp(compact[1].slice(0, 4) + '-' + compact[1].slice(4) + '-' + compact[2]);
    var range = /^\d{8}-(\d{8})$/.exec(textFolder);
    if (range) return dateStamp(range[1].slice(0, 4) + '-' + range[1].slice(4, 6) + '-' + range[1].slice(6));
    return 0;
  }

  function recentFolders(folders, days) {
    var sorted = (folders || []).slice().sort(function (a, b) { return folderDateStamp(b) - folderDateStamp(a); });
    var latest = sorted.reduce(function (max, folder) { return Math.max(max, folderDateStamp(folder)); }, 0);
    var lowerBound = latest - ((Number(days) || (WINDOW_DAYS + 7)) - 1) * 86400000;
    return sorted.filter(function (folder) { return folderDateStamp(folder) >= lowerBound; });
  }

  function fetchJson(win, url) {
    if (!win || typeof win.fetch !== 'function') return Promise.reject(new Error('fetch unavailable'));
    return win.fetch(url, { cache: 'no-store' }).then(function (response) {
      if (!response || !response.ok) throw new Error('HTTP ' + (response && response.status || 0));
      return response.json();
    });
  }

  function fetchText(win, url) {
    if (!win || typeof win.fetch !== 'function') return Promise.reject(new Error('fetch unavailable'));
    return win.fetch(url, { cache: 'no-store' }).then(function (response) {
      if (!response || !response.ok) throw new Error('HTTP ' + (response && response.status || 0));
      return response.text();
    });
  }

  function loadRecords(win) {
    return Promise.all([
      fetchText(win, SIDEBAR_URL).catch(function () { return ''; }),
      fetchJson(win, FRONTIER_URL).catch(function () { return { entries: [] }; }),
    ]).then(function (result) {
      var folders = recentFolders(dateFoldersFromSidebar(result[0]), WINDOW_DAYS + 7);
      return Promise.all(folders.map(function (folder) {
        return fetchJson(win, 'docs/' + folder + '/papers.meta.json').catch(function () { return null; });
      })).then(function (dailyMetadata) {
        var papers = [];
        dailyMetadata.forEach(function (meta) {
          (meta && Array.isArray(meta.papers) ? meta.papers : []).forEach(function (paper) {
            papers.push(Object.assign({}, paper, {
              kind: 'paper',
              discovered_at: meta.generated_at || meta.date || meta.label || '',
            }));
          });
        });
        var frontier = result[1] && Array.isArray(result[1].entries) ? result[1].entries : [];
        return papers.concat(frontier.map(function (entry) {
          return Object.assign({}, entry, { kind: 'frontier' });
        }));
      });
    });
  }

  function escapeHtml(value) {
    return text(value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function renderPanel(container, cloud, windowInfo) {
    if (!container) return;
    var range = windowInfo.start && windowInfo.end
      ? dateLabel(windowInfo.start) + ' — ' + dateLabel(windowInfo.end)
      : '等待新的论文数据';
    var words = cloud.map(function (item, index) {
      var classes = index < 3 ? ' is-major' : index < 9 ? ' is-medium' : '';
      return '<button type="button" class="dpr-hot-word' + classes + '" data-dpr-hot-word="' +
        escapeHtml(item.word) + '" title="appears in ' + item.documents + ' paper' + (item.documents === 1 ? '' : 's') + '">' +
        escapeHtml(item.word) + '</button>';
    }).join('');
    container.innerHTML =
      '<div class="dpr-home-panel-header">' +
      '<div><h3 class="dpr-home-hotwords-title">近两周研究热点</h3>' +
      '<p class="dpr-home-hotwords-range">' + escapeHtml(range) + ' · 共分析 ' + windowInfo.records.length + ' 篇论文与 AI 前沿</p></div>' +
      '<span class="dpr-home-hotwords-live" aria-label="数据会随论文更新">LIVE</span></div>' +
      '<div class="dpr-home-hotwords-cloud" aria-label="高频英文关键词词云">' +
      (words || '<p class="dpr-home-hotwords-empty">等待新的论文数据，热点将在这里形成。</p>') +
      '</div>' +
      '<p class="dpr-home-hotwords-hint">点击关键词，可在左侧论文库中继续检索</p>';
  }

  function renderLoading(container) {
    if (!container) return;
    container.innerHTML = '<div class="dpr-home-panel-header"><div><h3 class="dpr-home-hotwords-title">近两周研究热点</h3><p class="dpr-home-hotwords-range">正在汇总最新论文与 AI 前沿…</p></div><span class="dpr-home-hotwords-live">LIVE</span></div><div class="dpr-home-hotwords-cloud is-loading" aria-busy="true"><span></span><span></span><span></span><span></span><span></span></div>';
  }

  function findContainer(win) {
    if (!win || !win.document) return null;
    return win.document.querySelector('[data-dpr-home-hotwords]') || win.document.querySelector('.dpr-home-promo-card');
  }

  function isHome(win) {
    var hash = text(win && win.location && win.location.hash);
    return !hash || hash === '#' || /^#\/?$/.test(hash);
  }

  function searchForWord(win, word) {
    if (win && win.DPRSidebar && typeof win.DPRSidebar.searchPapers === 'function') {
      win.DPRSidebar.searchPapers(word);
      return;
    }
    var input = win && win.document && win.document.querySelector('.dpr-sidebar-search');
    if (input) {
      input.value = word;
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
    return loadRecords(win).then(function (records) {
      var windowInfo = selectWindow(records, WINDOW_DAYS);
      renderPanel(container, buildWordCloud(windowInfo.records, MAX_WORDS), windowInfo);
      container.removeAttribute('data-dpr-hotwords-loading');
      return windowInfo;
    }).catch(function () {
      renderPanel(container, [], { records: [], start: 0, end: 0 });
      container.removeAttribute('data-dpr-hotwords-loading');
      return null;
    });
  }

  function autoInit(win) {
    if (!win || !win.document || win.__dprHotWordsInit) return;
    win.__dprHotWordsInit = true;
    win.document.addEventListener('click', function (event) {
      var target = event.target && event.target.closest ? event.target.closest('[data-dpr-hot-word]') : null;
      if (!target) return;
      event.preventDefault();
      searchForWord(win, target.getAttribute('data-dpr-hot-word'));
    });
    win.document.addEventListener('dpr-docsify-ready', function () { refresh(win); });
    win.addEventListener('hashchange', function () {
      win.setTimeout(function () { refresh(win); }, 0);
    });
    win.setTimeout(function () { refresh(win); }, 0);
  }

  return {
    dateStamp: dateStamp,
    dateFoldersFromSidebar: dateFoldersFromSidebar,
    recentFolders: recentFolders,
    selectWindow: selectWindow,
    buildWordCloud: buildWordCloud,
    loadRecords: loadRecords,
    refresh: refresh,
    autoInit: autoInit,
  };
});
