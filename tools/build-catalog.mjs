import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyContentFile } from './lib/classify.mjs';

function usage() {
  return `카탈로그 생성기

사용법:
  node tools/build-catalog.mjs --content <dir> --page-out <file> --data-out <dir>

기본값:
  --content content
  --page-out content/_generated/catalog.md
  --data-out data
`;
}

function parseArgs(argv) {
  const args = { content: 'content', pageOut: 'content/_generated/catalog.md', dataOut: 'data', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--content') {
      i += 1;
      if (!argv[i]) throw new Error('--content 뒤에 폴더 경로가 필요합니다.');
      args.content = argv[i];
    } else if (arg === '--page-out') {
      i += 1;
      if (!argv[i]) throw new Error('--page-out 뒤에 파일 경로가 필요합니다.');
      args.pageOut = argv[i];
    } else if (arg === '--data-out') {
      i += 1;
      if (!argv[i]) throw new Error('--data-out 뒤에 폴더 경로가 필요합니다.');
      args.dataOut = argv[i];
    } else {
      throw new Error(`알 수 없는 옵션입니다: ${arg}`);
    }
  }
  return args;
}

async function walkMarkdown(root) {
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

function cleanValue(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
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
  return items.filter(Boolean);
}

function parseValue(raw) {
  const value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) return splitInlineArray(value);
  return cleanValue(value);
}

function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { data: {}, body: text };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) return { data: {}, body: text };
  const data = {};
  let listKey = '';
  for (let i = 1; i < end; i += 1) {
    const line = lines[i];
    const listItem = /^\s*-\s+(.+)$/.exec(line);
    if (listItem && listKey) {
      data[listKey].push(cleanValue(listItem[1]));
      continue;
    }
    const field = /^([^:#][^:]*):\s*(.*)$/.exec(line);
    if (!field) continue;
    const key = field[1].trim();
    if (field[2].trim() === '') {
      data[key] = [];
      listKey = key;
    } else {
      data[key] = parseValue(field[2]);
      listKey = '';
    }
  }
  return { data, body: lines.slice(end + 1).join('\n') };
}

function derivePathInfo(contentRoot, file) {
  const rel = path.relative(contentRoot, file);
  const classification = classifyContentFile(contentRoot, file);
  const parts = classification.parts;
  return {
    kind: classification.kind,
    sido: parts[0] ?? '',
    sigungu: parts[1] ?? '',
    category: parts[2] ?? '',
    rel,
    basename: path.basename(file),
    stem: path.basename(file, '.md'),
  };
}

function findAgendaItems(body, docId) {
  const items = [];
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!heading || !/(제\s*\d+\s*호|안건\s*\d+|○\s*안건)/.test(heading[2])) continue;
    const number = items.length + 1;
    const suffix = `a${String(number).padStart(2, '0')}`;
    const explicit = /\{#([^}]+)\}/.exec(heading[2]);
    const anchor = explicit ? explicit[1] : (docId ? `${docId}-${suffix}` : suffix);
    const title = heading[2].replace(/\s*\{#[^}]+\}\s*$/, '').trim();
    items.push({ title, anchor });
  }
  return items;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

async function readDocs(contentRoot) {
  const files = await walkMarkdown(contentRoot);
  const docs = [];
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const parsed = parseFrontmatter(text);
    const info = derivePathInfo(contentRoot, file);
    docs.push({ file, ...info, ...parsed });
  }
  return docs;
}

function docRows(docs) {
  const rows = [];
  for (const doc of docs) {
    const data = doc.data;
    const base = {
      docId: data.doc_id ?? '',
      date: data.date ?? '',
      department: data.department ?? '',
      sourceType: data.source_type ?? '',
      title: data.title ?? doc.stem,
      keywords: asArray(data.keywords).join(', '),
      sourceUrl: data.source_url ?? '',
      archiveUrl: data.archive_url ?? '',
      sigungu: doc.sigungu,
      category: doc.category,
      stem: doc.stem,
      rel: doc.rel,
    };
    const agendas = data.source_type === '구의회 회의록' ? findAgendaItems(doc.body, data.doc_id ?? '') : [];
    if (agendas.length === 0) {
      rows.push({ ...base, rowTitle: base.title, anchor: '' });
    } else {
      for (const agenda of agendas) rows.push({ ...base, rowTitle: agenda.title, anchor: agenda.anchor });
    }
  }
  rows.sort((a, b) => [a.date, a.sigungu, a.category, a.rowTitle].join('\0').localeCompare([b.date, b.sigungu, b.category, b.rowTitle].join('\0'), 'ko'));
  return rows;
}

function wikiLink(row) {
  return row.anchor ? `[[${row.stem}#${row.anchor}]]` : `[[${row.stem}]]`;
}

function mdCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function csvCell(value) {
  const text = String(value ?? '');
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function resolveReferences(docs) {
  const byDocId = new Map(docs.filter((doc) => typeof doc.data.doc_id === 'string' && doc.data.doc_id).map((doc) => [doc.data.doc_id, doc]));
  const linked = [];
  const pending = [];
  for (const doc of docs) {
    const source = doc.data.doc_id ?? doc.stem;
    for (const ref of asArray(doc.data['관련근거'])) {
      if (byDocId.has(ref)) linked.push({ source, target: ref });
      else pending.push({ source, target: ref });
    }
  }
  return { linked, pending };
}

function sourceCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'local';
  }
}

async function pagesUrl() {
  const fromEnv = process.env.PAGES_URL;
  if (fromEnv) return normalizeSiteUrl(fromEnv);
  try {
    const config = await fs.readFile(path.resolve('quartz.config.yaml'), 'utf8');
    const match = /^\s*baseUrl:\s*(.+?)\s*$/m.exec(config);
    if (match) return normalizeSiteUrl(match[1].replace(/^['"]|['"]$/g, ''));
  } catch {}
  return '';
}

function normalizeSiteUrl(value) {
  const trimmed = String(value ?? '').trim().replace(/\/$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function contentUrl(site, rel) {
  if (!site) return '';
  const withoutExt = rel.replace(/\.md$/, '').split(path.sep).join('/');
  return `${site}/${withoutExt.split('/').map(encodeURIComponent).join('/')}`;
}

function catalogUrl(site, fragment = '') {
  if (!site) return '';
  const suffix = fragment ? `#${encodeURIComponent(fragment)}` : '';
  return `${site}/_generated/catalog${suffix}`;
}

function catalogMarkdown(rows, refs) {
  const lines = ['---', 'title: 전체 카탈로그', '---', '', '# 전체 카탈로그', ''];
  if (rows.length === 0) {
    lines.push('아직 등록된 자료가 없습니다.');
  } else {
    lines.push('| 날짜 | 시군구 | 분류 | 부서 | 제목/안건명 | 키워드 | 링크 |', '|---|---|---|---|---|---|---|');
  }
  for (const row of rows) {
    lines.push(`| ${mdCell(row.date)} | ${mdCell(row.sigungu)} | ${mdCell(row.category)} | ${mdCell(row.department)} | ${mdCell(row.rowTitle)} | ${mdCell(row.keywords)} | ${wikiLink(row)} |`);
  }
  if (refs.linked.length > 0) {
    lines.push('', '## 관련근거 연결');
    for (const ref of refs.linked) lines.push(`- \`${ref.source}\` → \`${ref.target}\``);
  }
  if (refs.pending.length > 0) {
    lines.push('', '## 근거 연결 대기');
    for (const ref of refs.pending) lines.push(`- \`${ref.source}\` → \`${ref.target}\``);
  }
  lines.push('');
  return lines.join('\n');
}

function catalogCsv(rows, meta) {
  const header = '문서번호,날짜,부서,출처유형,제목,키워드,원문URL,아카이브URL,앵커,source_commit,generated_at,pages_url';
  const lines = [header];
  for (const row of rows) {
    lines.push([
      row.docId,
      row.date,
      row.department,
      row.sourceType,
      row.rowTitle,
      row.keywords,
      row.sourceUrl,
      row.archiveUrl,
      row.anchor,
      meta.sourceCommit,
      meta.generatedAt,
      meta.pagesUrl,
    ].map(csvCell).join(','));
  }
  return `\ufeff${lines.join('\n')}\n`;
}

function linkList(title, entries) {
  return [`## ${title}`, ...entries.map(([label, href]) => `- [${label}](${href})`), '']; 
}

function guideEntries(guides, site) {
  return guides
    .filter((guide) => guide.basename !== 'index.md')
    .sort((a, b) => a.rel.localeCompare(b.rel, 'ko'))
    .map((guide) => [guide.data.title ?? guide.stem, contentUrl(site, guide.rel)]);
}

function llmsSummary(recordCount) {
  if (recordCount === 0) return '현재 등록된 자료는 0건입니다. 자료가 등록되면 아래 목록에 나타납니다.';
  return `현재 등록된 자료는 ${recordCount}건입니다. 지방정부 공지·공고·회의록을 사람이 검토한 공개 자료로 정리한 시민 기록 아카이브입니다.`;
}

function llmsText(rows, meta, guides, recordCount) {
  const sigungu = [...new Set(rows.map((row) => row.sigungu).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  const categories = [...new Set(rows.map((row) => row.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  const years = [...new Set(rows.map((row) => row.date.slice(0, 4)).filter(Boolean))].sort();
  const lines = [
    '# localog',
    '',
    `> ${llmsSummary(recordCount)}`,
    '',
    `source_commit: ${meta.sourceCommit}`,
    `generated_at: ${meta.generatedAt}`,
    `pages_url: ${meta.pagesUrl}`,
    '',
    ...linkList('전체 카탈로그', [['전체 카탈로그', catalogUrl(meta.pagesUrl)]]),
    ...linkList('지역별', sigungu.map((name) => [name, catalogUrl(meta.pagesUrl, `지역별-${name}`)])),
    ...linkList('분류별', categories.map((name) => [name, catalogUrl(meta.pagesUrl, `분류별-${name}`)])),
    ...linkList('연도별', years.map((year) => [year, catalogUrl(meta.pagesUrl, `연도별-${year}`)])),
    '## 문서별',
    ...rows.map((row) => `- [${row.rowTitle}](${contentUrl(meta.pagesUrl, row.rel)}${row.anchor ? `#${encodeURIComponent(row.anchor)}` : ''})`),
    '',
    ...linkList('안내', guideEntries(guides, meta.pagesUrl)),
  ];
  return lines.join('\n');
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

  try {
    const contentRoot = path.resolve(args.content);
    const pageOut = path.resolve(args.pageOut);
    const dataOut = path.resolve(args.dataOut);
    const docs = await readDocs(contentRoot);
    const recordDocs = docs.filter((doc) => doc.kind === 'record');
    const guideDocs = docs.filter((doc) => doc.kind === 'guide');
    const rows = docRows(recordDocs);
    const refs = resolveReferences(recordDocs);
    const meta = { sourceCommit: sourceCommit(), generatedAt: new Date().toISOString(), pagesUrl: await pagesUrl() };
    await fs.mkdir(path.dirname(pageOut), { recursive: true });
    await fs.mkdir(dataOut, { recursive: true });
    await fs.writeFile(pageOut, catalogMarkdown(rows, refs), 'utf8');
    await fs.writeFile(path.join(dataOut, 'catalog.csv'), catalogCsv(rows, meta), 'utf8');
    await fs.writeFile(path.join(dataOut, 'llms.txt'), llmsText(rows, meta, guideDocs, recordDocs.length), 'utf8');
    console.log(`카탈로그 생성 완료: ${rows.length}행`);
  } catch (error) {
    console.error(`카탈로그 생성 중 오류가 발생했습니다: ${error.message}`);
    process.exit(1);
  }
}

await main();
