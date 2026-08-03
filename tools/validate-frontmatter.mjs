import fs from 'node:fs/promises';
import path from 'node:path';
import { classifyContentFile } from './lib/classify.mjs';
import { loadCategories, lookupCategory, allSourceTypes, DATE_FIELDS } from './lib/categories.mjs';
import { findAgendaItems } from './lib/agenda.mjs';

// 분류의 정본은 config/categories/<시도>/<시군구>.yaml 이다.
// 여기에 목록을 다시 두면 두 곳이 어긋나므로 상수로 갖지 않는다.

const TRANSCRIPT_SOURCES = new Set(['youtube-auto-caption', 'official-minutes', 'manual']);
const TRANSCRIPT_NOTICE = '> 이 문서는 공식 회의록이 아니라 공개 영상·자동자막을 바탕으로 만든 시민 전사본입니다.';
const DATE_PAIRS = [
  ['posting_starts_at', 'posting_ends_at', '게재'],
  ['event_starts_at', 'event_ends_at', '행사'],
  ['application_starts_at', 'application_deadline', '신청'],
];

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

function isYmd(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// 고지문은 파일 첫 줄이 아니라 frontmatter 를 걷어낸 본문 첫 줄에서 찾아야 한다.
// 파일 첫 줄은 항상 '---' 이기 때문이다.
function firstBodyLine(parsed) {
  for (const line of String(parsed.body ?? '').split(/\r?\n/)) {
    if (line.trim()) return line.trim();
  }
  return '';
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

// 원천 게시판 주소는 자주 사라진다. 사본을 남기거나, 남길 수 없었다는 사실을 기록해야 한다.
function validateArchivePolicy(doc, rule, category, errors) {
  if (rule.archive !== 'required') return;
  const { file, parsed } = doc;
  const data = parsed.data;
  if (hasValue(data.archive_url)) return;

  const escaped = data.archive_status === 'unavailable'
    && isYmd(data.source_checked_at)
    && hasValue(data.archive_note);
  if (escaped) return;

  addMessage(
    errors,
    file,
    lineOf(parsed, 'archive_url'),
    `${category}는 archive_url 이 필요합니다. 웹아카이브가 불가능했다면 `
      + 'archive_status: unavailable + source_checked_at(YYYY-MM-DD) + archive_note 를 함께 적으세요.',
  );
}

function validateDates(doc, rule, category, errors, warnings) {
  const { file, parsed } = doc;
  const data = parsed.data;

  for (const field of DATE_FIELDS) {
    if (hasValue(data[field]) && !isYmd(data[field])) {
      addMessage(errors, file, lineOf(parsed, field), `${field}는 YYYY-MM-DD 형식이어야 합니다.`);
    }
  }

  for (const [startField, endField, label] of DATE_PAIRS) {
    const start = data[startField];
    const end = data[endField];
    if (isYmd(start) && isYmd(end) && start > end) {
      addMessage(errors, file, lineOf(parsed, startField), `${label} 시작일이 종료일보다 늦습니다: ${start} > ${end}`);
    }
  }

  if (hasValue(data.application_starts_at) && !hasValue(data.application_deadline)) {
    addMessage(errors, file, lineOf(parsed, 'application_starts_at'), 'application_starts_at 만 있고 application_deadline 이 없습니다. 시작만 있는 신청 기간은 뜻이 없습니다.');
  }

  // 지난 공고를 나중에 올리는 경우가 있어 차단하지 않는다.
  if (isYmd(data.application_deadline) && isYmd(data.date) && data.application_deadline < data.date) {
    addMessage(warnings, file, lineOf(parsed, 'application_deadline'), `신청 마감일(${data.application_deadline})이 게시일(${data.date})보다 앞섭니다.`);
  }

  // 원천 게시판이 그 값을 실제로 제공하는 분류에만 걸려 있다.
  // 이게 없으면 채용공고에 마감일이 빠진 채 발행돼도 아무도 모른다.
  for (const field of rule.required_dates ?? []) {
    if (!hasValue(data[field])) {
      addMessage(errors, file, lineOf(parsed, field), `${category}는 ${field} 가 필요합니다.`);
    }
  }
}

function validateTranscript(doc, rule, recordId, errors) {
  const { file, parsed } = doc;
  const data = parsed.data;

  if (rule.transcript === true) {
    if (!hasValue(data.transcript_source)) {
      addMessage(errors, file, lineOf(parsed, 'transcript_source'), `${[...TRANSCRIPT_SOURCES].join('|')} 중 하나로 transcript_source 를 적어야 합니다.`);
    } else if (!TRANSCRIPT_SOURCES.has(data.transcript_source)) {
      addMessage(errors, file, lineOf(parsed, 'transcript_source'), `transcript_source 허용값이 아닙니다: ${data.transcript_source}`);
    }

    if (!String(data.screening_scope ?? '').includes('transcript')) {
      addMessage(errors, file, lineOf(parsed, 'screening_scope'), '전사본은 screening_scope 에 transcript 를 포함해야 합니다.');
    }

    if (data.transcript_source === 'youtube-auto-caption') {
      if (firstBodyLine(parsed) !== TRANSCRIPT_NOTICE) {
        addMessage(errors, file, parsed.bodyStartLine ?? 1, `자동자막 전사본은 본문 첫 줄이 고지문이어야 합니다: ${TRANSCRIPT_NOTICE}`);
      }
      const body = String(parsed.body ?? '');
      if (!body.includes('## 정정 표') && !body.includes('정정 없음')) {
        addMessage(errors, file, parsed.bodyStartLine ?? 1, '자동자막 전사본은 "## 정정 표" 절 또는 "정정 없음" 표기가 필요합니다.');
      }
    }
  }

  if (rule.agenda === true) {
    const items = findAgendaItems(parsed.body, recordId);
    const shape = new RegExp(`^${recordId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-a\\d{2}$`);
    for (const item of items) {
      if (!item.explicit) {
        addMessage(errors, file, parsed.bodyStartLine ?? 1, `안건 헤딩에 앵커가 없습니다: "${item.heading}" → {#${recordId}-aNN} 를 붙이세요.`);
      } else if (!shape.test(item.anchor)) {
        addMessage(errors, file, parsed.bodyStartLine ?? 1, `안건 앵커 형식이 맞지 않습니다: ${item.anchor} (기대: ${recordId}-aNN)`);
      }
    }
  }
}

function validateDocument(doc, contentRoot, requirePublished, errors, warnings, registry) {
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
  if (!Array.isArray(data.keywords)) {
    addMessage(errors, file, lineOf(parsed, 'keywords'), 'keywords는 배열이어야 합니다. 예: [청년, 공고]');
  } else if (data.keywords.length > 8) {
    addMessage(errors, file, lineOf(parsed, 'keywords'), `keywords는 최대 8개까지입니다. 현재 ${data.keywords.length}개입니다.`);
  }
  if (hasValue(data.source_url) && !isHttpUrl(data.source_url)) {
    addMessage(errors, file, lineOf(parsed, 'source_url'), 'source_url은 http:// 또는 https:// 로 시작해야 합니다.');
  }

  const parts = path.relative(contentRoot, file).split(path.sep);
  const [sido, sigungu, category] = parts;
  const rule = lookupCategory(registry, sido, sigungu, category);

  // 폴더를 먼저 판정한다. 폴더를 모르면 어떤 source_type 이 맞는지도 말할 수 없으므로
  // 여기서 끝내고 아래 규칙들은 건너뛴다. (같은 원인으로 오류가 두 번 보고되지 않게)
  if (!rule) {
    addMessage(errors, file, 1, `문서분류 폴더가 표준값이 아닙니다: ${category ?? '(없음)'}`);
    return;
  }

  if (hasValue(data.source_type) && !allSourceTypes(registry, sido, sigungu).has(data.source_type)) {
    addMessage(errors, file, lineOf(parsed, 'source_type'), `source_type 허용값이 아닙니다: ${data.source_type}`);
  } else if (hasValue(data.source_type) && data.source_type !== rule.source_type) {
    addMessage(errors, file, lineOf(parsed, 'source_type'), `폴더(${category})와 source_type(${data.source_type})이 일치하지 않습니다. 기대값: ${rule.source_type}`);
  }

  // 인용·근거연결·안건 앵커가 모두 이 값을 쓴다. doc_id 가 없으면 파일명이 곧 ID 다.
  const recordId = hasValue(data.doc_id) ? data.doc_id : path.basename(file, '.md');

  if (rule.doc_id === 'official' && !hasValue(data.doc_id)) {
    addMessage(errors, file, lineOf(parsed, 'doc_id'), `${category}는 행정 문서번호(doc_id)가 필요합니다.`);
  }

  validateArchivePolicy(doc, rule, category, errors);
  validateDates(doc, rule, category, errors, warnings);
  validateTranscript(doc, rule, recordId, errors);
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
    const registry = await loadCategories();
    const docs = await readDocuments(contentRoot);
    for (const doc of docs) validateDocument(doc, contentRoot, args.requirePublished, errors, warnings, registry);
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
