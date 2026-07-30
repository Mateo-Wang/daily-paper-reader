/**
 * DPR repository favorites
 *
 * The repository JSON file is the single source of truth. No favorite state is
 * stored in localStorage, IndexedDB, Supabase, or cookies. Writes reuse the
 * GitHub token that Daily Paper Reader already decrypts for repository tasks.
 */
(function (root, factory) {
  var api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DPRFavorites = api;
})(typeof window !== 'undefined' ? window : globalThis, function (win) {
  'use strict';

  var DATA_PATH = 'data/favorites.json';
  var SCHEMA_VERSION = 1;
  var MAX_WRITE_ATTEMPTS = 4;
  var cache = null;
  var cachePromise = null;
  var repoContextPromise = null;

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeTag(tag) {
    if (tag && typeof tag === 'object') {
      var kind = clean(tag.kind || 'query').toLowerCase();
      var label = clean(tag.label || tag.value || '');
      return label ? { kind: kind || 'query', label: label } : null;
    }
    var text = clean(tag);
    if (!text) return null;
    var splitAt = text.indexOf(':');
    if (splitAt > 0) {
      return {
        kind: clean(text.slice(0, splitAt)).toLowerCase() || 'query',
        label: clean(text.slice(splitAt + 1)),
      };
    }
    return { kind: 'query', label: text };
  }

  function normalizeTags(tags) {
    var seen = {};
    var result = [];
    safeArray(tags).forEach(function (tag) {
      var normalized = normalizeTag(tag);
      if (!normalized || !normalized.label) return;
      var key = (normalized.kind + ':' + normalized.label).toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      result.push(normalized);
    });
    return result;
  }

  function decodeRoute(value) {
    var text = clean(value);
    try {
      return decodeURIComponent(text);
    } catch (e) {
      return text;
    }
  }

  function normalizePaperId(value, source) {
    var raw = decodeRoute(value)
      .replace(/^https?:\/\/[^/]+/i, '')
      .replace(/^#\/?/, '')
      .replace(/^\/+/, '')
      .split(/[?#]/)[0];
    var arxiv = raw.match(/(?:^|\/)(\d{4}\.\d{4,5})(?:v\d+)?(?:[-/]|$)/i);
    if (!arxiv) arxiv = raw.match(/arxiv[:/\s-]*(\d{4}\.\d{4,5})(?:v\d+)?/i);
    if (arxiv) return 'arxiv:' + arxiv[1].toLowerCase();

    var segments = raw.split('/').filter(Boolean);
    var leaf = clean(segments[segments.length - 1] || raw)
      .replace(/\.md$/i, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9._:-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    if (!leaf) return '';
    var prefix = clean(source).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
    return (prefix || 'paper') + ':' + leaf;
  }

  function normalizeRoute(href) {
    var value = clean(href);
    if (!value) return '';
    var hashIndex = value.indexOf('#/');
    if (hashIndex >= 0) value = value.slice(hashIndex);
    if (value.indexOf('#/') === 0) return value.split('?')[0];
    return '#/' + value.replace(/^#?\/?/, '').split('?')[0];
  }

  function normalizeScore(value) {
    var score = Number(value);
    return isFinite(score) ? Math.round(score * 10) / 10 : null;
  }

  function normalizeFavoriteSnapshot(input, now) {
    var item = input && typeof input === 'object' ? input : {};
    var href = normalizeRoute(item.href || item.route || item.id || '');
    var source = clean(item.source || '');
    var id = normalizePaperId(item.paper_id || item.paperId || item.id || href, source);
    if (!id) throw new Error('无法识别论文唯一 ID。');
    var addedAt = clean(item.added_at || item.addedAt || now || new Date().toISOString());
    return {
      paper_id: id,
      href: href,
      title: clean(item.title || item.title_en || item.titleEn || id),
      title_zh: clean(item.title_zh || item.titleZh || ''),
      source: source,
      date: clean(item.date || item.published || item.published_at || ''),
      score: normalizeScore(item.score),
      tags: normalizeTags(item.tags),
      added_at: addedAt,
    };
  }

  function emptyData() {
    return { version: SCHEMA_VERSION, updated_at: '', favorites: {} };
  }

  function normalizeData(raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    var result = emptyData();
    result.updated_at = clean(source.updated_at || source.updatedAt || '');
    var values = source.favorites && typeof source.favorites === 'object'
      ? source.favorites
      : {};
    if (Array.isArray(values)) {
      values.forEach(function (item) {
        try {
          var favorite = normalizeFavoriteSnapshot(item, item && (item.added_at || item.addedAt));
          result.favorites[favorite.paper_id] = favorite;
        } catch (e) {}
      });
      return result;
    }
    Object.keys(values).sort().forEach(function (key) {
      try {
        var item = Object.assign({}, values[key] || {}, { paper_id: key });
        var favorite = normalizeFavoriteSnapshot(item, item.added_at || item.addedAt);
        result.favorites[favorite.paper_id] = favorite;
      } catch (e) {}
    });
    return result;
  }

  function stableData(data) {
    var normalized = normalizeData(data);
    var favorites = {};
    Object.keys(normalized.favorites).sort().forEach(function (id) {
      favorites[id] = normalized.favorites[id];
    });
    return {
      version: SCHEMA_VERSION,
      updated_at: normalized.updated_at,
      favorites: favorites,
    };
  }

  function utf8ToBase64(text) {
    if (typeof Buffer !== 'undefined') return Buffer.from(String(text), 'utf8').toString('base64');
    var bytes = new TextEncoder().encode(String(text));
    var binary = '';
    for (var i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return win.btoa(binary);
  }

  function base64ToUtf8(value) {
    var compact = clean(value).replace(/\s+/g, '');
    if (!compact) return '';
    if (typeof Buffer !== 'undefined') return Buffer.from(compact, 'base64').toString('utf8');
    var binary = win.atob(compact);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function readGithubToken() {
    try {
      var secret = win.decoded_secret_private || {};
      if (secret.github && secret.github.token) return clean(secret.github.token);
    } catch (e) {}
    try {
      var raw = win.localStorage && win.localStorage.getItem('github_token_data');
      var parsed = raw ? JSON.parse(raw) : null;
      return clean(parsed && parsed.token);
    } catch (e) {
      return '';
    }
  }

  function parseGithubPagesLocation() {
    var location = win.location || {};
    var host = clean(location.hostname).toLowerCase();
    var match = host.match(/^([^.]+)\.github\.io$/i);
    if (!match) return null;
    var path = clean(location.pathname).replace(/^\/+/, '');
    var repo = path.split('/')[0];
    return repo ? { owner: match[1], repo: repo } : null;
  }

  function fetchJson(url, init) {
    return win.fetch(url, init || {}).then(function (response) {
      if (!response.ok) {
        var error = new Error('HTTP ' + response.status);
        error.status = response.status;
        throw error;
      }
      return response.json();
    });
  }

  function readRepoOwnerFile() {
    var candidates = ['docs/.repo-owner.json', '.repo-owner.json'];
    var index = 0;
    function next() {
      if (index >= candidates.length) return Promise.resolve(null);
      var url = candidates[index++];
      return fetchJson(url + '?dpr=' + Date.now(), { cache: 'no-store' })
        .then(function (data) {
          return data && data.owner && data.repo
            ? { owner: clean(data.owner), repo: clean(data.repo) }
            : next();
        })
        .catch(next);
    }
    return next();
  }

  function resolveRepoContext(force) {
    if (!force && repoContextPromise) return repoContextPromise;
    repoContextPromise = Promise.resolve(parseGithubPagesLocation() || readRepoOwnerFile())
      .then(function (context) {
        return Promise.resolve(context).then(function (resolved) {
          if (!resolved || !resolved.owner || !resolved.repo) {
            throw new Error('无法识别当前 GitHub 仓库。');
          }
          var token = readGithubToken();
          var headers = { Accept: 'application/vnd.github+json' };
          if (token) headers.Authorization = 'Bearer ' + token;
          return win.fetch(
            'https://api.github.com/repos/' + encodeURIComponent(resolved.owner) + '/' + encodeURIComponent(resolved.repo),
            { headers: headers },
          ).then(function (response) {
            if (!response.ok) return resolved;
            return response.json().then(function (repo) {
              return {
                owner: resolved.owner,
                repo: resolved.repo,
                branch: clean(repo && repo.default_branch) || 'main',
              };
            });
          }).catch(function () { return resolved; });
        });
      });
    return repoContextPromise;
  }

  function githubHeaders(token) {
    var headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
  }

  function contentsUrl(context) {
    return 'https://api.github.com/repos/' + encodeURIComponent(context.owner) + '/' +
      encodeURIComponent(context.repo) + '/contents/' + DATA_PATH.split('/').map(encodeURIComponent).join('/');
  }

  function fetchRepositoryData(context, token) {
    var url = contentsUrl(context) + '?ref=' + encodeURIComponent(context.branch || 'main') + '&dpr=' + Date.now();
    return win.fetch(url, { headers: githubHeaders(token), cache: 'no-store' }).then(function (response) {
      if (response.status === 404) return { data: emptyData(), sha: '' };
      if (!response.ok) {
        var error = new Error('读取收藏文件失败（GitHub HTTP ' + response.status + '）。');
        error.status = response.status;
        throw error;
      }
      return response.json().then(function (payload) {
        var parsed = emptyData();
        try {
          parsed = normalizeData(JSON.parse(base64ToUtf8(payload.content || '')));
        } catch (error) {
          var invalid = new Error('收藏文件格式异常，已停止写入以保护现有数据。');
          invalid.cause = error;
          throw invalid;
        }
        return { data: parsed, sha: clean(payload.sha) };
      });
    });
  }

  function fetchStaticData() {
    return fetchJson(DATA_PATH + '?dpr=' + Date.now(), { cache: 'no-store' }).then(normalizeData);
  }

  function dispatch(name, detail) {
    if (!win.document || typeof win.document.dispatchEvent !== 'function') return;
    try {
      win.document.dispatchEvent(new win.CustomEvent(name, { detail: detail || {} }));
    } catch (e) {}
  }

  function setCache(data, source) {
    cache = stableData(data);
    dispatch('dpr-favorites-changed', { data: cache, source: source || 'load' });
    return cache;
  }

  function load(options) {
    var opts = options || {};
    if (!opts.force && cache) return Promise.resolve(cache);
    if (!opts.force && cachePromise) return cachePromise;
    cachePromise = resolveRepoContext(!!opts.force)
      .then(function (context) {
        return fetchRepositoryData(context, readGithubToken()).then(function (result) {
          return setCache(result.data, 'github');
        });
      })
      .catch(function () {
        return fetchStaticData().then(function (data) { return setCache(data, 'static'); });
      })
      .finally(function () { cachePromise = null; });
    return cachePromise;
  }

  function isFavorite(value) {
    var id = normalizePaperId(value);
    return !!(id && cache && cache.favorites && cache.favorites[id]);
  }

  function getEntries() {
    var data = cache || emptyData();
    return Object.keys(data.favorites || {}).map(function (id) { return data.favorites[id]; })
      .sort(function (a, b) { return clean(b.added_at).localeCompare(clean(a.added_at)); });
  }

  function updateManyRepository(snapshots, shouldFavorite) {
    var token = readGithubToken();
    if (!token) {
      return Promise.reject(new Error('请先解锁项目密钥，再修改仓库收藏。'));
    }
    var normalizedById = {};
    safeArray(snapshots).forEach(function (snapshot) {
      var favorite = normalizeFavoriteSnapshot(snapshot);
      normalizedById[favorite.paper_id] = favorite;
    });
    var normalized = Object.keys(normalizedById).sort().map(function (id) { return normalizedById[id]; });
    if (!normalized.length) return Promise.resolve(cache || emptyData());
    dispatch('dpr-favorites-saving', {
      paper_ids: normalized.map(function (item) { return item.paper_id; }),
      favorite: !!shouldFavorite,
    });
    return resolveRepoContext(true).then(function (context) {
      var attempt = 0;
      function writeLatest() {
        attempt += 1;
        return fetchRepositoryData(context, token).then(function (current) {
          var next = stableData(current.data);
          normalized.forEach(function (item) {
            var existing = next.favorites[item.paper_id];
            if (shouldFavorite) {
              next.favorites[item.paper_id] = Object.assign({}, item, {
                added_at: existing && existing.added_at || item.added_at,
              });
            } else {
              delete next.favorites[item.paper_id];
            }
          });
          next.updated_at = new Date().toISOString();
          next = stableData(next);

          var before = JSON.stringify(stableData(current.data).favorites);
          var after = JSON.stringify(next.favorites);
          if (before === after) return setCache(next, 'noop');

          var payload = {
            message: normalized.length === 1
              ? (shouldFavorite ? 'chore: favorite ' : 'chore: unfavorite ') + normalized[0].paper_id
              : 'chore: update ' + normalized.length + ' paper favorites',
            content: utf8ToBase64(JSON.stringify(next, null, 2) + '\n'),
            branch: context.branch || 'main',
          };
          if (current.sha) payload.sha = current.sha;
          return win.fetch(contentsUrl(context), {
            method: 'PUT',
            headers: Object.assign({ 'Content-Type': 'application/json' }, githubHeaders(token)),
            body: JSON.stringify(payload),
          }).then(function (response) {
            if ((response.status === 409 || response.status === 422) && attempt < MAX_WRITE_ATTEMPTS) {
              return writeLatest();
            }
            if (!response.ok) {
              var error = new Error('保存收藏失败（GitHub HTTP ' + response.status + '）。');
              error.status = response.status;
              throw error;
            }
            return setCache(next, 'write');
          });
        });
      }
      return writeLatest();
    }).catch(function (error) {
      dispatch('dpr-favorites-error', {
        paper_ids: normalized.map(function (item) { return item.paper_id; }),
        favorite: !!shouldFavorite,
        message: error && error.message || '收藏操作失败。',
      });
      throw error;
    });
  }

  function updateRepository(snapshot, shouldFavorite) {
    return updateManyRepository([snapshot], shouldFavorite);
  }

  function toggle(snapshot) {
    var normalized = normalizeFavoriteSnapshot(snapshot);
    return updateRepository(normalized, !isFavorite(normalized.paper_id));
  }

  function escapeMarkdown(value) {
    return clean(value).replace(/([\\`*_{}\[\]<>])/g, '\\$1');
  }

  function exportMarkdown(entries) {
    var list = safeArray(entries).map(function (entry) {
      return normalizeFavoriteSnapshot(entry, entry && entry.added_at);
    });
    var lines = ['# 已收藏论文', '', '共 ' + list.length + ' 篇。', ''];
    list.forEach(function (item) {
      var title = escapeMarkdown(item.title || item.title_zh || item.paper_id);
      var href = clean(item.href);
      lines.push('- ' + (href ? '[' + title + '](' + href + ')' : title));
      var meta = [item.date, item.score == null ? '' : 'Score ' + item.score]
        .concat(item.tags.map(function (tag) { return tag.label; })).filter(Boolean);
      if (meta.length) lines.push('  - ' + meta.map(escapeMarkdown).join(' · '));
    });
    return lines.join('\n') + '\n';
  }

  function csvCell(value) {
    return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
  }

  function exportCsv(entries) {
    var rows = [['paper_id', 'title', 'title_zh', 'date', 'score', 'tags', 'href', 'added_at']];
    safeArray(entries).forEach(function (entry) {
      var item = normalizeFavoriteSnapshot(entry, entry && entry.added_at);
      rows.push([
        item.paper_id, item.title, item.title_zh, item.date,
        item.score == null ? '' : item.score,
        item.tags.map(function (tag) { return tag.label; }).join('|'),
        item.href, item.added_at,
      ]);
    });
    return rows.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  function setDataForTest(data) {
    cache = stableData(data);
    return cache;
  }

  var api = {
    DATA_PATH: DATA_PATH,
    load: load,
    refresh: function () { return load({ force: true }); },
    getData: function () { return cache || emptyData(); },
    getEntries: getEntries,
    isFavorite: isFavorite,
    update: updateRepository,
    updateMany: updateManyRepository,
    toggle: toggle,
    normalizePaperId: normalizePaperId,
    normalizeFavoriteSnapshot: normalizeFavoriteSnapshot,
    normalizeData: normalizeData,
    exportMarkdown: exportMarkdown,
    exportCsv: exportCsv,
    _setDataForTest: setDataForTest,
    _utf8ToBase64: utf8ToBase64,
    _base64ToUtf8: base64ToUtf8,
  };

  if (win && win.document && typeof win.fetch === 'function') {
    api.ready = load().catch(function () { return emptyData(); });
  } else {
    api.ready = Promise.resolve(emptyData());
  }
  return api;
});
