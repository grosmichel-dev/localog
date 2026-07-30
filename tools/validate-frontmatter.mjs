import fs from 'node:fs/promises';
import path from 'node:path';
import { classifyContentFile } from './lib/classify.mjs';

const SOURCE_TYPES = new Set(['구청 공지사항', '고시공고', '구청장회의(유튜브)', '구의회 회의록']);
const FOLDER_SOURCE_TYPES = new Map([
  ['구청공지사항', '구청 공지사항'],
  ['고시공고', '고시공고'],
  ['구청장회의', '구청장회의(유튜브)'],
  ['구의회회의록', '구의회 회의록'],
]);

function usage() {
  return `프론트매터 검증기

사용법:
  node tools/validate-frontmatter.mjs [--content content] [--require-published]

검사 내용:
  - 필수 프론트매터, source_type, 폴더↔출처유형 일치
  - doc_id/archive_url, doc_id 정규화, doc_id/파일명 중복
  - 공개 서명(screened) 필수 필드
`;
}

function parseArgs(argv) {
  const args = { content: 'content', requirePublished: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--require-published') args.requirePublished = true;
    else if (arg === '--content') {
      i += 1;
      if (!argv[i]) throw new Error('--content 뒤에 폴더 경로가 필요합니다.');
      args.content = argv[i];
    } else {
      throw new Error(`알 수 없는 옵션입니다: ${arg}`);
    }
  }
  return args;
}

function toDisplayPath(file) {
  const relative = path.relative(process.cwd(), file) || file;
  return relative.split(path.sep).join('/');
}

async function listMarkdownFiles(root) {
  const files = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(root, fullPath).split(path.sep);
      if (entry.isDirectory()) {
        if (rel[0] === '_generated') continue;
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }
  await walk(root);
  return files;
}

function splitInlineArray(value) {
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  const items = [];
  let current = '';
  let quote = '';
  for (const ch of inner) {
    if ((ch === '"' || ch === "'") && !quote) quote = ch;
    else if (ch === quote) quote = '';
    else if (ch === ',' && !quote) {
      items.push(cleanValue(current));
      current = '';
      continue;
    }
    current += ch;
  }
  items.push(cleanValue(current));
  return items;
}

function cleanValue(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseValue(raw) {
  const value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) return splitInlineArray(value);
  return cleanValue(value);
}

function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return { data: {}, lines: {}, body: text, bodyStartLine: 1, error: '프론트매터 시작 구분자(---)가 없습니다.' };
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) {
    return { data: {}, lines: {}, body: text, bodyStartLine: 1, error: '프론트매터 종료 구분자(---)가 없습니다.' };
  }
  const data = {};
  const fieldLines = {};
  let listKey = '';
  for (let i = 1; i < end; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const listItem = /^\s*-\s+(.+)$/.exec(line);
    if (listItem && listKey) {
      data[listKey].push(cleanValue(listItem[1]));
      continue;
    }
    const field = /^([^:#][^:]*):\s*(.*)$/.exec(line);
    if (!field) continue;
    const key = field[1].trim();
    const rawValue = field[2];
    fieldLines[key] = i + 1;
    if (rawValue.trim() === '') {
      data[key] = [];
      listKey = key;
    } else {
      data[key] = parseValue(rawValue);
      listKey = '';
    }
  }
  return { data, lines: fieldLines, body: lines.slice(end + 1).join('\n'), bodyStartLine: end + 2 };
}

function lineOf(parsed, field) {
  return parsed.lines[field] ?? 1;
}

function hasValue(value) {
  return typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null;
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

function isUtcIso(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function isNormalizedDocId(value) {
  return typeof value === 'string'
    && value === value.trim()
    && !/[\s()（）]/.test(value)
    && !/--+/.test(value)
    && !/^-|-$/.test(value);
}

function addMessage(messages, file, line, reason) {
  messages.push(`${toDisplayPath(file)}:${line} — ${reason}`);
}

async function readDocuments(contentRoot) {
  const files = await listMarkdownFiles(contentRoot);
  const docs = [];
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const classification = classifyContentFile(contentRoot, file);
    docs.push({ file, basename: path.basename(file), guidePage: classification.kind === 'guide', parsed: parseFrontmatter(text) });
  }
  return docs;
}

function validateGuidePage(doc, errors) {
  const { file, parsed } = doc;
  if (parsed.error) addMessage(errors, file, 1, parsed.error);
  if (!hasValue(parsed.data.title)) addMessage(errors, file, lineOf(parsed, 'title'), '안내 페이지에는 title 필드가 필요합니다.');
}

function validateDocument(doc, contentRoot, requirePublished, errors, warnings) {
  const { file, parsed } = doc;
  const data = parsed.data;
  if (doc.guidePage) {
    validateGuidePage(doc, errors);
    return;
  }
  if (parsed.error) addMessage(errors, file, 1, parsed.error);

  for (const field of ['title', 'date', 'department', 'source_type', 'keywords', 'source_url']) {
    if (!hasValue(data[field])) addMessage(errors, file, lineOf(parsed, field), `필수 필드가 없습니다: ${field}`);
  }

  if (hasValue(data.date) && !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    addMessage(errors, file, lineOf(parsed, 'date'), 'date는 YYYY-MM-DD 형식이어야 합니다.');
  }
  if (hasValue(data.source_type) && !SOURCE_TYPES.has(data.source_type)) {
    addMessage(errors, file, lineOf(parsed, 'source_type'), `source_type 허용값이 아닙니다: ${data.source_type}`);
  }
  if (!Array.isArray(data.keywords)) {
    addMessage(errors, file, lineOf(parsed, 'keywords'), 'keywords는 배열이어야 합니다. 예: [청년, 공고]');
  } else if (data.keywords.length > 8) {
    addMessage(errors, file, lineOf(parsed, 'keywords'), `keywords는 최대 8개까지입니다. 현재 ${data.keywords.length}개입니다.`);
  }
  if (hasValue(data.source_url) && !isHttpUrl(data.source_url)) {
    addMessage(errors, file, lineOf(parsed, 'source_url'), 'source_url은 http:// 또는 https:// 로 시작해야 합니다.');
  }

  const parts = path.relative(contentRoot, file).split(path.sep);
  const category = parts[2];
  const expectedType = FOLDER_SOURCE_TYPES.get(category);
  if (!expectedType) {
    addMessage(errors, file, 1, `문서분류 폴더가 표준값이 아닙니다: ${category ?? '(없음)'}`);
  } else if (hasValue(data.source_type) && data.source_type !== expectedType) {
    addMessage(errors, file, lineOf(parsed, 'source_type'), `폴더(${category})와 source_type(${data.source_type})이 일치하지 않습니다. 기대값: ${expectedType}`);
  }

  if (data.source_type === '고시공고' || data.source_type === '구청 공지사항') {
    if (!hasValue(data.doc_id)) addMessage(errors, file, lineOf(parsed, 'doc_id'), '고시공고/구청 공지사항은 doc_id가 필요합니다.');
    if (!hasValue(data.archive_url)) addMessage(errors, file, lineOf(parsed, 'archive_url'), '고시공고/구청 공지사항은 archive_url이 필요합니다.');
  }
  if (hasValue(data.doc_id) && !isNormalizedDocId(data.doc_id)) {
    addMessage(errors, file, lineOf(parsed, 'doc_id'), 'doc_id가 정규화 형식이 아닙니다. 공백/괄호 없이 단일 하이픈(-)으로 구분해야 합니다.');
  }

  if (data.review_status === 'screened') {
    for (const field of ['pii_screened_by', 'screened_at', 'screening_scope']) {
      if (!hasValue(data[field])) addMessage(errors, file, lineOf(parsed, field), `screened 공개 서명 필드가 없습니다: ${field}`);
    }
    if (hasValue(data.screened_at) && !isUtcIso(data.screened_at)) {
      addMessage(errors, file, lineOf(parsed, 'screened_at'), 'screened_at은 UTC ISO-8601 형식이며 Z로 끝나야 합니다.');
    }
  } else {
    const target = requirePublished ? errors : warnings;
    addMessage(target, file, lineOf(parsed, 'review_status'), 'BLOCKED-FROM-PUBLISH: review_status가 screened가 아니어서 공개 대상이 아닙니다.');
  }
}

function validateDuplicates(docs, errors) {
  const docIds = new Map();
  const basenames = new Map();
  for (const doc of docs) {
    if (doc.guidePage) continue;
    const docId = doc.parsed.data.doc_id;
    if (typeof docId === 'string' && docId.trim()) {
      if (docIds.has(docId)) {
        addMessage(errors, doc.file, lineOf(doc.parsed, 'doc_id'), `doc_id가 중복입니다: ${docId} (처음: ${toDisplayPath(docIds.get(docId).file)})`);
      } else {
        docIds.set(docId, doc);
      }
    }
    if (basenames.has(doc.basename)) {
      addMessage(errors, doc.file, 1, `파일 이름이 중복입니다: ${doc.basename} (처음: ${toDisplayPath(basenames.get(doc.basename).file)})`);
    } else {
      basenames.set(doc.basename, doc);
    }
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`오류: ${error.message}`);
    console.error(usage());
    process.exit(1);
  }
  if (args.help) {
    console.log(usage());
    return;
  }

  const contentRoot = path.resolve(args.content);
  const errors = [];
  const warnings = [];
  try {
    const docs = await readDocuments(contentRoot);
    for (const doc of docs) validateDocument(doc, contentRoot, args.requirePublished, errors, warnings);
    validateDuplicates(docs, errors);
  } catch (error) {
    console.error(`검증 중 오류가 발생했습니다: ${error.message}`);
    process.exit(1);
  }

  for (const warning of warnings) console.warn(warning);
  for (const error of errors) console.error(error);
  if (errors.length > 0) process.exit(1);
}

await main();
