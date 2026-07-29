(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.DPRObsidianExportUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const WINDOWS_RESERVED_NAMES = new Set([
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
  ]);

  const normalizeText = (value) => String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  const parseInlineArray = (value) => {
    const text = normalizeText(value);
    if (!text.startsWith('[') || !text.endsWith(']')) return [];
    const items = [];
    let current = '';
    let quote = '';
    for (const ch of text.slice(1, -1)) {
      if ((ch === '"' || ch === "'") && (!quote || quote === ch)) {
        quote = quote ? '' : ch;
        current += ch;
      } else if (ch === ',' && !quote) {
        if (current.trim()) items.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) items.push(current.trim());
    return items
      .map((item) => item.replace(/^["']|["']$/g, '').trim())
      .filter(Boolean);
  };

  const parseSimpleFrontMatter = (yamlText) => {
    const meta = {};
    const lines = String(yamlText || '').replace(/\r\n/g, '\n').split('\n');
    for (const raw of lines) {
      if (!raw.trim() || /^\s/.test(raw)) continue;
      const colonIdx = raw.indexOf(':');
      if (colonIdx < 1) continue;
      const key = raw.slice(0, colonIdx).trim();
      const value = raw.slice(colonIdx + 1).trim();
      if (!key) continue;
      meta[key] = value.startsWith('[') && value.endsWith(']')
        ? parseInlineArray(value)
        : value.replace(/^["']|["']$/g, '').replace(/\\"/g, '"');
    }
    return meta;
  };

  const stripFrontMatter = (content) => {
    const text = String(content || '').replace(/\r\n/g, '\n');
    if (!text.startsWith('---\n')) return { meta: null, body: text };
    const endIdx = text.indexOf('\n---\n', 4);
    if (endIdx < 0) return { meta: null, body: text };
    return {
      meta: parseSimpleFrontMatter(text.slice(4, endIdx)),
      body: text.slice(endIdx + 5).trim(),
    };
  };

  const asStringArray = (value) => {
    if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
    return parseInlineArray(value);
  };

  // Folder names are derived exclusively from query tags and constrained to one path segment.
  const sanitizeFolderName = (value) => {
    const candidate = normalizeText(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
    const safe = candidate.replace(/^-+|-+$/g, '').slice(0, 64);
    return safe && !WINDOWS_RESERVED_NAMES.has(safe.toUpperCase()) ? safe : '';
  };

  const queryTagsFromMeta = (meta) => asStringArray(meta && meta.tags)
    .filter((tag) => /^query:/i.test(tag))
    .map((tag) => ({ raw: tag, name: sanitizeFolderName(tag.slice(6)) }))
    .filter((tag) => tag.name);

  const resolveFolder = (meta) => {
    const queryTags = queryTagsFromMeta(meta || {});
    const matched = sanitizeFolderName(meta && meta.matched_query_tag);
    if (matched) {
      const match = queryTags.find((tag) => tag.name === matched);
      return { name: matched, sourceTag: match ? match.raw : `query:${matched}` };
    }
    const driving = queryTags.find((tag) => tag.name === 'driving');
    if (driving) return { name: driving.name, sourceTag: driving.raw };
    if (queryTags.length) return { name: queryTags[0].name, sourceTag: queryTags[0].raw };
    return { name: 'unclassified', sourceTag: '' };
  };

  const sanitizeFileName = (title, fallback) => {
    let name = normalizeText(title || fallback || 'Untitled paper');
    try { name = name.normalize('NFKC'); } catch { /* older browser: keep source text */ }
    name = name
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[<>:"/\\|?*]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .trim();
    if (!name || WINDOWS_RESERVED_NAMES.has(name.toUpperCase())) {
      name = normalizeText(fallback || 'Untitled paper').replace(/[<>:"/\\|?*]/g, ' ').trim();
    }
    return (name || 'Untitled paper').slice(0, 180).trim();
  };

  const extractSection = (body, headingNames) => {
    const lines = normalizeText(body).split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i].match(/^#{1,6}\s+(.+?)\s*$/);
      if (match && headingNames.includes(match[1].toLowerCase())) {
        start = i + 1;
        break;
      }
    }
    if (start < 0) return '';
    const section = [];
    for (let i = start; i < lines.length; i += 1) {
      if (/^#{1,6}\s+/.test(lines[i])) break;
      section.push(lines[i]);
    }
    return section.join('\n').trim();
  };

  const yamlValue = (value) => JSON.stringify(normalizeText(value));

  const markdownValue = (value) => normalizeText(value).replace(/\n{3,}/g, '\n\n');

  const extractArxivId = (pdfUrl) => {
    const match = normalizeText(pdfUrl).match(/arxiv\.org\/(?:pdf|abs)\/([^?#/]+)/i);
    return match ? match[1].replace(/\.pdf$/i, '') : '';
  };

  const buildObsidianNote = ({ paperId, pageMd, pageUrl, generatedAt }) => {
    const parsed = stripFrontMatter(pageMd || '');
    const meta = parsed.meta || {};
    const title = normalizeText(meta.title) || normalizeText(meta.title_zh) || normalizeText(paperId) || 'Untitled paper';
    const titleZh = normalizeText(meta.title_zh);
    const tags = asStringArray(meta.tags);
    const folder = resolveFolder(meta);
    const abstract = extractSection(parsed.body, ['abstract']) || normalizeText(meta.abstract_en);
    const chineseAbstract = extractSection(parsed.body, ['摘要']);
    const generated = normalizeText(generatedAt) || new Date().toISOString();
    const fileName = `${sanitizeFileName(title, paperId)}.md`;
    const obsidianTags = ['paper', 'daily-paper-reader', folder.name]
      .filter(Boolean)
      .map((tag) => `  - ${yamlValue(tag)}`);
    const lines = [
      '---',
      `title: ${yamlValue(title)}`,
      `title_zh: ${yamlValue(titleZh)}`,
      `authors: ${yamlValue(meta.authors)}`,
      `date: ${yamlValue(meta.date)}`,
      `source: ${yamlValue(meta.source)}`,
      `score: ${yamlValue(meta.score)}`,
      `dpr_paper_id: ${yamlValue(paperId)}`,
      `query_tag: ${yamlValue(folder.sourceTag)}`,
      `arxiv_id: ${yamlValue(extractArxivId(meta.pdf))}`,
      `pdf: ${yamlValue(meta.pdf)}`,
      `source_page: ${yamlValue(pageUrl)}`,
      `exported_at: ${yamlValue(generated)}`,
      'tags:',
      ...obsidianTags,
      '---',
      '',
      `# ${title}`,
    ];
    if (titleZh && titleZh !== title) lines.push('', `> ${titleZh}`);
    lines.push('', '## 推荐理由', '', markdownValue(meta.evidence) || '—');
    lines.push('', '## 概述', '', markdownValue(meta.tldr) || '—');
    if (chineseAbstract) lines.push('', '## 摘要', '', chineseAbstract);
    if (abstract) lines.push('', '## Abstract', '', abstract);
    lines.push('', '## 链接', '');
    if (meta.pdf) lines.push(`- [PDF](${normalizeText(meta.pdf)})`);
    if (pageUrl) lines.push(`- [Daily Paper Reader](${normalizeText(pageUrl)})`);
    if (!meta.pdf && !pageUrl) lines.push('- —');
    if (tags.length) lines.push('', `> 原始标签：${tags.join(' · ')}`);

    return {
      folderName: folder.name,
      sourceTag: folder.sourceTag,
      fileName,
      paperId: normalizeText(paperId),
      markdown: lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n',
    };
  };

  const makeCollisionFileName = (fileName, paperId) => {
    const dot = fileName.lastIndexOf('.');
    const base = dot > 0 ? fileName.slice(0, dot) : fileName;
    const extension = dot > 0 ? fileName.slice(dot) : '.md';
    const suffix = sanitizeFileName(paperId || 'paper', 'paper').slice(0, 48);
    return `${base.slice(0, Math.max(1, 180 - suffix.length - 3))} [${suffix}]${extension}`;
  };

  const isNotFoundError = (error) => !!(error && error.name === 'NotFoundError');

  const readExistingFile = async (directory, fileName) => {
    try {
      const handle = await directory.getFileHandle(fileName, { create: false });
      const file = await handle.getFile();
      return { handle, text: await file.text() };
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  };

  const belongsToPaper = (text, paperId) => {
    const marker = `dpr_paper_id: ${JSON.stringify(normalizeText(paperId))}`;
    return String(text || '').includes(marker);
  };

  // Create a note only when no existing note uses that file name. Existing notes are never
  // replaced: the same paper reports `exists`, while another paper gets a stable suffix.
  const writeNoteWithoutOverwrite = async (directory, note) => {
    let candidate = note.fileName;
    for (let index = 0; index < 50; index += 1) {
      const existing = await readExistingFile(directory, candidate);
      if (existing) {
        if (belongsToPaper(existing.text, note.paperId)) {
          return { status: 'exists', fileName: candidate };
        }
        const collisionBase = makeCollisionFileName(note.fileName, note.paperId);
        candidate = index === 0
          ? collisionBase
          : collisionBase.replace(/\.md$/i, `-${index + 1}.md`);
        continue;
      }

      // A second check after create prevents an accidental overwrite if another writer
      // creates the same name between the first lookup and this call.
      const fileHandle = await directory.getFileHandle(candidate, { create: true });
      const createdFile = await fileHandle.getFile();
      if (createdFile.size > 0) {
        if (belongsToPaper(await createdFile.text(), note.paperId)) {
          return { status: 'exists', fileName: candidate };
        }
        candidate = makeCollisionFileName(note.fileName, `${note.paperId}-${index + 1}`);
        continue;
      }
      const writable = await fileHandle.createWritable({ keepExistingData: false });
      try {
        await writable.write(note.markdown);
      } finally {
        await writable.close();
      }
      return { status: 'saved', fileName: candidate };
    }
    throw new Error('同名笔记过多，未写入任何文件。');
  };

  return {
    parseSimpleFrontMatter,
    stripFrontMatter,
    resolveFolder,
    sanitizeFileName,
    extractSection,
    buildObsidianNote,
    makeCollisionFileName,
    writeNoteWithoutOverwrite,
  };
});
