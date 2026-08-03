import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCategories, lookupCategory } from './lib/categories.mjs';
import {
  parseCsv,
  headerProblems,
  parseSimpleYaml,
  parseFrontmatter,
  templateColumns,
  computeGroups,
  groupDocId,
  groupStem,
  isNormalizedDocId,
  toPosix,
} from './lib/budget.mjs';

const META_SUFFIX = '.meta.yaml';
const REQUIRED_FIELDS = [
  'split_by',
  'title_format',
  'doc_id_prefix',
  'date',
  'department',
  'source_type',
  'source_url',
];
const SIGNOFF_FIELDS = ['pii_screened_by', 'screened_at', 'screening_scope'];

function usage() {
  return `예산 CSV/meta 검증기

사용법:
  node tools/validate-budget-csv.mjs [--content content] [--pairs-out <file.json>]

검사 내용:
  - meta.yaml 필수 필드 · 서명(review_status 값이 정확히 screened)
  - split_by / title_format / summary_group 이 가리키는 열이 CSV 에 실재하는지
  - CSV 헤더 중복·공백, 인코딩, 슬러그 충돌
  - 생성될 doc_id · 파일명이 기존 문서와 충돌하지 않는지
  - 짝 meta 가 없는 고아 CSV (서명 없이 공개될 수 있으므로 차단)

--pairs-out 을 주면 검증을 통과한 (csv, meta) 쌍 목록을 JSON 으로 기록한다.
이 목록에 있는 쌍만 생성·발행 대상이 된다.
`;
}

function parseArgs(argv) {
  const args = { content: 'content', pairsOut: '', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--content') {
      i += 1;
      if (!argv[i]) throw new Error('--content 뒤에 폴더 경로가 필요합니다.');
      args.content = argv[i];
    } else if (arg === '--pairs-out') {
      i += 1;
      if (!argv[i]) throw new Error('--pairs-out 뒤에 파일 경로가 필요합니다.');
      args.pairsOut = argv[i];
    } else {
      throw new Error(`알 수 없는 옵션입니다: ${arg}`);
    }
  }
  return args;
}

function display(file) {
  return toPosix(path.relative(process.cwd(), file) || file);
}

async function walk(root, predicate) {
  const files = [];
  async function visit(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep);
      if (entry.isDirectory()) {
        if (rel[0] === '_generated') continue;
        await visit(full);
      } else if (entry.isFile() && predicate(entry.name)) {
        files.push(full);
      }
    }
  }
  await visit(root);
  return files;
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

function isUtcIso(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/** 기존 마크다운의 doc_id / 파일명 수집. 생성된 노트는 제외한다(재실행 시 자기 자신과 충돌하지 않도록). */
async function collectExisting(contentRoot) {
  const files = await walk(contentRoot, (name) => name.endsWith('.md'));
  const docIds = new Map();
  const stems = new Map();
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const { data } = parseFrontmatter(text);
    if (String(data.generated ?? '') === 'true') continue;
    const docId = typeof data.doc_id === 'string' ? data.doc_id.trim() : '';
    if (docId) docIds.set(docId, file);
    stems.set(path.basename(file, '.md'), file);
  }
  return { docIds, stems };
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
  const pairs = [];
  const add = (file, reason) => errors.push(`${display(file)} — ${reason}`);

  try {
    const registry = await loadCategories();
    const metaFiles = await walk(contentRoot, (name) => name.endsWith(META_SUFFIX));
    const csvFiles = await walk(contentRoot, (name) => name.toLowerCase().endsWith('.csv'));
    const existing = await collectExisting(contentRoot);

    // 역방향: 짝 meta 없는 CSV 는 서명 없이 공개될 수 있으므로 차단한다.
    const metaSet = new Set(metaFiles.map((file) => file.slice(0, -META_SUFFIX.length)));
    for (const csv of csvFiles) {
      const stem = csv.slice(0, -path.extname(csv).length);
      if (!metaSet.has(stem)) {
        add(csv, `짝이 되는 ${path.basename(stem)}${META_SUFFIX} 가 없습니다. content/ 의 비마크다운 파일은 공개 다운로드로 발행되므로, 사람 서명이 없는 CSV 는 둘 수 없습니다.`);
      }
    }

    const prefixOwners = new Map();
    const plannedDocIds = new Map();
    const plannedStems = new Map();

    for (const metaFile of metaFiles) {
      const stem = metaFile.slice(0, -META_SUFFIX.length);
      const csvFile = `${stem}.csv`;

      let meta;
      try {
        meta = parseSimpleYaml(await fs.readFile(metaFile, 'utf8'));
      } catch (error) {
        add(metaFile, `meta.yaml 을 해석할 수 없습니다: ${error.message}`);
        continue;
      }

      let missing = false;
      for (const field of REQUIRED_FIELDS) {
        if (!nonEmpty(meta[field])) {
          add(metaFile, `필수 필드가 없습니다: ${field}`);
          missing = true;
        }
      }

      // 서명: 존재 여부가 아니라 값까지 본다. review_status: draft 가 통과하면 미검수 원본이 공개된다.
      if (meta.review_status !== 'screened') {
        add(metaFile, `review_status 는 정확히 'screened' 여야 합니다. 현재: ${meta.review_status ?? '(없음)'} — 검토가 끝나지 않은 CSV 는 공개할 수 없습니다.`);
        missing = true;
      }
      for (const field of SIGNOFF_FIELDS) {
        if (!nonEmpty(meta[field])) {
          add(metaFile, `공개 서명 필드가 비어 있습니다: ${field}`);
          missing = true;
        }
      }
      if (nonEmpty(meta.screened_at) && !isUtcIso(meta.screened_at)) {
        add(metaFile, 'screened_at 은 UTC ISO-8601 형식이며 Z 로 끝나야 합니다.');
      }
      if (nonEmpty(meta.date) && !/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) {
        add(metaFile, 'date 는 YYYY-MM-DD 형식이어야 합니다.');
        missing = true;
      }
      if (nonEmpty(meta.source_url) && !isHttpUrl(meta.source_url)) {
        add(metaFile, 'source_url 은 http:// 또는 https:// 로 시작해야 합니다.');
      }
      // '예산서' 문자열로 판정하면 다른 시군구가 다른 이름을 쓰는 순간 깨진다.
      // 폴더에서 분류를 찾아 csv_pair 규약 대상인지 본다 (validate-frontmatter 와 동일 패턴).
      const budgetParts = path.relative(contentRoot, metaFile).split(path.sep);
      const budgetRule = lookupCategory(registry, budgetParts[0], budgetParts[1], budgetParts[2]);
      if (budgetRule?.csv_pair !== true) {
        add(metaFile, `이 폴더는 CSV 진본 규약(csv_pair) 대상이 아닙니다: ${budgetParts[2] ?? '(없음)'}`);
        missing = true;
      } else if (nonEmpty(meta.source_type) && meta.source_type !== budgetRule.source_type) {
        add(metaFile, `예산 meta 의 source_type 은 '${budgetRule.source_type}' 여야 합니다. 현재: ${meta.source_type}`);
        missing = true;
      }
      if (Array.isArray(meta.keywords) && meta.keywords.length > 8) {
        add(metaFile, `keywords 는 최대 8개입니다. 현재 ${meta.keywords.length}개입니다.`);
      }
      if (nonEmpty(meta.doc_id_prefix) && !isNormalizedDocId(meta.doc_id_prefix)) {
        add(metaFile, 'doc_id_prefix 가 정규형이 아닙니다. 공백·괄호 없이 단일 하이픈(-)으로 구분해야 합니다.');
        missing = true;
      }
      if (nonEmpty(meta.doc_id_prefix)) {
        if (prefixOwners.has(meta.doc_id_prefix)) {
          add(metaFile, `doc_id_prefix 가 중복입니다: ${meta.doc_id_prefix} (처음: ${display(prefixOwners.get(meta.doc_id_prefix))})`);
          missing = true;
        } else {
          prefixOwners.set(meta.doc_id_prefix, metaFile);
        }
      }
      const hasTotalColumn = nonEmpty(meta.total_column);
      const hasTotalValue = nonEmpty(meta.total_value);
      if (hasTotalColumn !== hasTotalValue) {
        add(metaFile, 'total_column 과 total_value 는 함께 지정하거나 함께 생략해야 합니다.');
      }

      let csvText;
      try {
        csvText = await fs.readFile(csvFile, 'utf8');
      } catch (error) {
        add(metaFile, `짝이 되는 CSV 가 없습니다: ${display(csvFile)}`);
        continue;
      }

      let parsed;
      try {
        parsed = parseCsv(csvText);
      } catch (error) {
        add(csvFile, `CSV 를 해석할 수 없습니다: ${error.message}`);
        continue;
      }

      for (const problem of headerProblems(parsed.headers)) add(csvFile, problem);
      if (parsed.rows.length === 0) add(csvFile, '데이터 행이 없습니다.');

      const headerSet = new Set(parsed.headers);
      const referenced = new Map([
        ['split_by', nonEmpty(meta.split_by) ? [meta.split_by] : []],
        ['title_format', templateColumns(meta.title_format)],
        ['summary_group', nonEmpty(meta.summary_group) ? [meta.summary_group] : []],
        ['amount_column', nonEmpty(meta.amount_column) ? [meta.amount_column] : []],
        ['total_column', hasTotalColumn ? [meta.total_column] : []],
      ]);
      let columnMissing = false;
      for (const [field, columns] of referenced) {
        for (const column of columns) {
          if (!headerSet.has(column)) {
            add(metaFile, `${field} 가 가리키는 열이 CSV 에 없습니다: ${column} (CSV 헤더: ${parsed.headers.join(', ')})`);
            columnMissing = true;
          }
        }
      }
      if (templateColumns(meta.title_format).length === 0) {
        add(metaFile, 'title_format 에 {열이름} 자리표시자가 하나도 없습니다. 그룹마다 제목이 같아져 문서를 구분할 수 없습니다.');
      }

      if (missing || columnMissing) continue;

      const { groups, collisions, emptyValueCount } = computeGroups(parsed.rows, meta);
      if (collisions.length > 0) {
        for (const collision of collisions) {
          add(csvFile, `split_by(${meta.split_by}) 값이 같은 슬러그로 겹칩니다 — 한 페이지가 다른 페이지를 덮어쓰게 됩니다. 슬러그 '${collision.slug}' ← ${collision.values.map((v) => JSON.stringify(v)).join(', ')}`);
        }
        continue;
      }
      if (groups.length === 0) {
        add(csvFile, `split_by(${meta.split_by}) 로 만들 수 있는 그룹이 없습니다. 열 이름이나 합계행 규약을 확인하세요.`);
        continue;
      }
      if (emptyValueCount > 0) {
        add(csvFile, `split_by(${meta.split_by}) 값이 비어 있는 데이터 행이 ${emptyValueCount}개 있습니다. 합계행이면 total_column/total_value 로 표시하세요.`);
        continue;
      }

      const sourceStem = path.basename(stem);
      const planned = [
        ...groups.map((group) => ({ docId: groupDocId(meta.doc_id_prefix, group.slug), stem: groupStem(meta.date, sourceStem, group.slug), label: group.value })),
        { docId: groupDocId(meta.doc_id_prefix, ''), stem: groupStem(meta.date, sourceStem, ''), label: '총괄' },
      ];
      let clash = false;
      for (const item of planned) {
        if (existing.docIds.has(item.docId)) {
          add(metaFile, `생성될 doc_id 가 기존 문서와 충돌합니다: ${item.docId} (기존: ${display(existing.docIds.get(item.docId))})`);
          clash = true;
        }
        if (plannedDocIds.has(item.docId)) {
          add(metaFile, `생성될 doc_id 가 다른 예산서와 충돌합니다: ${item.docId} (처음: ${display(plannedDocIds.get(item.docId))})`);
          clash = true;
        } else {
          plannedDocIds.set(item.docId, metaFile);
        }
        if (existing.stems.has(item.stem)) {
          add(metaFile, `생성될 파일 이름이 기존 문서와 충돌합니다: ${item.stem}.md (기존: ${display(existing.stems.get(item.stem))})`);
          clash = true;
        }
        if (plannedStems.has(item.stem)) {
          add(metaFile, `생성될 파일 이름이 다른 예산서와 충돌합니다: ${item.stem}.md (처음: ${display(plannedStems.get(item.stem))})`);
          clash = true;
        } else {
          plannedStems.set(item.stem, metaFile);
        }
      }
      if (clash) continue;

      pairs.push({ csv: csvFile, meta: metaFile, groups: groups.length });
    }
  } catch (error) {
    console.error(`예산 CSV 검증 중 오류가 발생했습니다: ${error.message}`);
    process.exit(1);
  }

  for (const error of errors) console.error(error);
  if (errors.length > 0) {
    console.error(`\n예산 CSV 검증 실패: ${errors.length}건`);
    process.exit(1);
  }

  if (args.pairsOut) {
    const out = path.resolve(args.pairsOut);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, `${JSON.stringify(pairs.map(({ csv, meta }) => ({ csv, meta })), null, 2)}\n`, 'utf8');
  }

  if (pairs.length === 0) {
    console.log('예산 CSV 검증 완료: 대상 없음');
    return;
  }
  console.log(`예산 CSV 검증 완료: ${pairs.length}쌍`);
  for (const pair of pairs) console.log(`  OK   ${display(pair.csv)} (그룹 ${pair.groups}개)`);
}

await main();
