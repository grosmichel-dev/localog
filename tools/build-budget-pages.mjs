import fs from 'node:fs/promises';
import path from 'node:path';
import {
  parseCsv,
  parseSimpleYaml,
  computeGroups,
  groupDocId,
  groupStem,
  formatTemplate,
  emitFrontmatter,
  mdCell,
  mdText,
  parseNumber,
  isNumericColumn,
  htmlSafeText,
  toPosix,
} from './lib/budget.mjs';

const SEARCH_TEXT_LIMIT = 2000;
const MAX_KEYWORDS = 8;
const SUMMARY_LABEL_DEFAULT = '전체';

function usage() {
  return `예산 페이지 생성기

사용법:
  node tools/build-budget-pages.mjs --pairs-in <pairs.json> [--content content]
                                    [--manifest <manifest.json>] [--dry-run]

--pairs-in 은 필수다. tools/validate-budget-csv.mjs --pairs-out 이 만든
"검증을 통과한 (csv, meta) 쌍" 목록만 생성 대상이 된다. 이 제약이 없으면
서명 없는 CSV 로도 페이지가 만들어질 수 있다.

생성물은 저장소에 커밋하지 않는다. 프론트매터에 generated: true 와
generated_by: build-budget-pages 가 찍히며 빌드 후 정리 대상이 된다.
`;
}

function parseArgs(argv) {
  const args = { content: 'content', pairsIn: '', manifest: '', dryRun: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--content') {
      i += 1;
      if (!argv[i]) throw new Error('--content 뒤에 폴더 경로가 필요합니다.');
      args.content = argv[i];
    } else if (arg === '--pairs-in') {
      i += 1;
      if (!argv[i]) throw new Error('--pairs-in 뒤에 파일 경로가 필요합니다.');
      args.pairsIn = argv[i];
    } else if (arg === '--manifest') {
      i += 1;
      if (!argv[i]) throw new Error('--manifest 뒤에 파일 경로가 필요합니다.');
      args.manifest = argv[i];
    } else {
      throw new Error(`알 수 없는 옵션입니다: ${arg}`);
    }
  }
  return args;
}

function display(file) {
  return toPosix(path.relative(process.cwd(), file) || file);
}

/** 텍스트 열(수치 열이 아닌 열)의 distinct 값 — 검색 보강과 키워드의 재료. */
function distinctTextValues(rows, headers, numericHeaders, excludeHeaders) {
  const counts = new Map();
  for (const row of rows) {
    for (const header of headers) {
      if (numericHeaders.has(header) || excludeHeaders.has(header)) continue;
      const value = String(row[header] ?? '').trim();
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], 'ko'))
    .map(([value]) => value);
}

/**
 * 표 바깥 평문 검색 보강 블록.
 * Quartz 검색이 표 셀을 놓치는 사례(jackyzha0/quartz#1395)에 대비해,
 * 같은 값들을 표가 아닌 문단으로 한 번 더 싣는다.
 */
function searchReinforcement(values) {
  if (values.length === 0) return '';
  const parts = [];
  let length = 0;
  let truncated = false;
  for (const value of values) {
    const escaped = mdText(value);
    if (length + escaped.length + 2 > SEARCH_TEXT_LIMIT) {
      truncated = true;
      break;
    }
    parts.push(escaped);
    length += escaped.length + 2;
  }
  if (parts.length === 0) return '';
  return `이 문서에 포함된 항목: ${parts.join(', ')}${truncated ? ' 이하 생략' : ''}`;
}

function markdownTable(headers, rows, totalRow) {
  const lines = [
    `| ${headers.map(mdCell).join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
  ];
  for (const row of rows) {
    lines.push(`| ${headers.map((header) => mdCell(row[header])).join(' | ')} |`);
  }
  if (totalRow) {
    lines.push(`| ${headers.map((header) => mdCell(totalRow[header])).join(' | ')} |`);
  }
  return lines.join('\n');
}

function buildKeywords(metaKeywords, values) {
  const seen = new Set();
  const out = [];
  // meta 의 키워드는 사람이 쓴 값, values 는 CSV 에서 온 값이다. 후자는 이스케이프한다.
  const merged = [
    ...(Array.isArray(metaKeywords) ? metaKeywords : []),
    ...values.map(htmlSafeText),
  ];
  for (const keyword of merged) {
    const clean = String(keyword ?? '').trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

function noteFrontmatter({ title, meta, docId, hasTotalRow, sourceCsvRel, sourceMetaRel, keywords }) {
  return emitFrontmatter([
    ['title', title],
    ['date', meta.date],
    ['department', meta.department],
    ['source_type', meta.source_type],
    ['keywords', keywords],
    ['source_url', meta.source_url],
    ['archive_url', meta.archive_url],
    ['doc_id', docId],
    // 서명은 생성기가 만들지 않는다. 진본 CSV 를 사람이 검토한 사실을 그대로 상속할 뿐이다.
    ['review_status', meta.review_status],
    ['pii_screened_by', meta.pii_screened_by],
    ['screened_at', meta.screened_at],
    ['screening_scope', meta.screening_scope],
    // 아래 4개는 빌드 정리(stale sweep)의 sentinel 이자 Quartz 마커 주입의 판별 기준이다.
    ['generated', 'true'],
    ['generated_by', 'build-budget-pages'],
    ['source_csv', sourceCsvRel],
    ['source_meta', sourceMetaRel],
    ['budget_has_total_row', hasTotalRow ? 'true' : 'false'],
  ]);
}

function downloadSection(csvName) {
  return [
    '## 원본 데이터',
    '',
    `이 표의 진본은 CSV 파일입니다. 내려받아 엑셀에서 자유롭게 합계·필터·피벗할 수 있습니다.`,
    '',
    `- [${mdText(csvName)}](${encodeURI(csvName)})`,
  ].join('\n');
}

function totalNotice(hasTotalRow) {
  if (!hasTotalRow) return '';
  return [
    '> **원문 합계 (원문 그대로 · 사이트 계산 아님 · 필터와 무관)**',
    '> 표 마지막 줄은 원문 예산서에 실려 있는 합계를 그대로 옮긴 것입니다.',
    '> 표 위의 `현재 화면 합계` 는 지금 화면에 보이는 행만 더한 값이라 필터를 걸면 서로 달라집니다.',
    '> 공식 수치는 원문 합계와 원문 링크를 기준으로 확인하세요.',
  ].join('\n');
}

function buildGroupNote({ group, meta, headers, csvName, summaryStem, sourceCsvRel, sourceMetaRel, numericHeaders }) {
  // title_format 은 사람이 쓴 템플릿이지만 채워 넣는 값은 CSV 에서 온다. 값 쪽만 이스케이프한다.
  const safeRow = {};
  for (const [key, value] of Object.entries({ ...group.rows[0], [meta.split_by]: group.value })) {
    safeRow[key] = htmlSafeText(value);
  }
  const { text: title } = formatTemplate(meta.title_format, safeRow);
  const docId = groupDocId(meta.doc_id_prefix, group.slug);
  // split 열은 제목에 이미 있고, 합계 구분 열(예: 일반/합계)은 검색어로 무의미하므로 뺀다.
  const excluded = new Set([meta.split_by, meta.total_column].filter(Boolean));
  const values = distinctTextValues(group.rows, headers, numericHeaders, excluded);
  const keywords = buildKeywords(meta.keywords, [group.value, ...values]);

  const blocks = [
    noteFrontmatter({
      title,
      meta,
      docId,
      hasTotalRow: Boolean(group.totalRow),
      sourceCsvRel,
      sourceMetaRel,
      keywords,
    }),
    '',
    searchReinforcement([group.value, ...values]),
    '',
    markdownTable(headers, group.rows, group.totalRow),
    '',
    totalNotice(Boolean(group.totalRow)),
    '',
    downloadSection(csvName),
    '',
    `## 함께 보기`,
    '',
    `- [[${summaryStem}]]`,
  ];
  return `${blocks.filter((block) => block !== '').join('\n\n')}\n`;
}

function buildSummaryNote({ groups, meta, grandTotalRow, csvName, groupStems, sourceCsvRel, sourceMetaRel, amountColumn }) {
  const { text: title } = formatTemplate(meta.title_format, { [meta.split_by]: SUMMARY_LABEL_DEFAULT });
  const docId = groupDocId(meta.doc_id_prefix, '');
  const summaryColumn = meta.summary_group || meta.split_by;
  const keywords = buildKeywords(meta.keywords, groups.map((group) => group.value));

  const aggregateHeader = amountColumn
    ? `| ${mdCell(summaryColumn)} | 행 수 | ${mdCell(amountColumn)} 집계 | 문서 |`
    : `| ${mdCell(summaryColumn)} | 행 수 | 문서 |`;
  const aggregateDivider = amountColumn ? '|---|---|---|---|' : '|---|---|---|';
  const aggregateRows = groups.map((group, index) => {
    const sum = amountColumn
      ? group.rows.reduce((acc, row) => acc + (parseNumber(row[amountColumn]) ?? 0), 0)
      : null;
    const link = `[[${groupStems[index]}]]`;
    return amountColumn
      ? `| ${mdCell(group.value)} | ${group.rows.length} | ${sum.toLocaleString('ko-KR')} | ${link} |`
      : `| ${mdCell(group.value)} | ${group.rows.length} | ${link} |`;
  });

  const blocks = [
    noteFrontmatter({
      title,
      meta,
      docId,
      hasTotalRow: false,
      sourceCsvRel,
      sourceMetaRel,
      keywords,
    }),
    '',
    searchReinforcement(groups.map((group) => group.value)),
    '',
    '## 집계',
    '',
    [
      '> 아래 표는 **이 사이트가 CSV 를 더해 만든 집계**입니다. 원문 예산서에 실린 공식 수치가 아닙니다.',
      '> 공식 수치는 각 문서의 원문 합계와 원문 링크에서 확인하세요.',
    ].join('\n'),
    '',
    [aggregateHeader, aggregateDivider, ...aggregateRows].join('\n'),
    '',
    grandTotalRow && amountColumn
      ? [
        '## 원문 전체 합계',
        '',
        '> 아래 값은 **원문 예산서에 실린 전체 합계를 그대로 옮긴 것**입니다(사이트 계산 아님).',
        '',
        `- ${mdText(amountColumn)}: ${mdText(grandTotalRow[amountColumn])}`,
      ].join('\n')
      : '',
    '',
    downloadSection(csvName),
  ];
  return `${blocks.filter((block) => block !== '').join('\n\n')}\n`;
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
  if (!args.pairsIn) {
    console.error('오류: --pairs-in 이 필요합니다. 먼저 tools/validate-budget-csv.mjs --pairs-out 으로 검증 통과 쌍 목록을 만드세요.');
    console.error(usage());
    process.exit(1);
  }

  const contentRoot = path.resolve(args.content);
  const written = [];

  try {
    const pairsRaw = await fs.readFile(path.resolve(args.pairsIn), 'utf8');
    const pairs = JSON.parse(pairsRaw);
    if (!Array.isArray(pairs)) throw new Error('쌍 목록이 배열이 아닙니다.');

    for (const pair of pairs) {
      const csvFile = path.resolve(pair.csv);
      const metaFile = path.resolve(pair.meta);
      const meta = parseSimpleYaml(await fs.readFile(metaFile, 'utf8'));
      const { headers, rows } = parseCsv(await fs.readFile(csvFile, 'utf8'));
      const { groups, grandTotalRow, collisions } = computeGroups(rows, meta);

      if (collisions.length > 0) {
        // 검증기가 이미 막았어야 하는 상태다. 여기서도 쓰지 않고 멈춘다.
        for (const collision of collisions) {
          console.error(`${display(csvFile)} — 슬러그 충돌 '${collision.slug}' ← ${collision.values.join(', ')}`);
        }
        throw new Error('슬러그가 충돌해 페이지를 덮어쓸 수 있습니다. 생성을 중단합니다.');
      }

      const dir = path.dirname(csvFile);
      const sourceStem = path.basename(csvFile, path.extname(csvFile));
      const csvName = path.basename(csvFile);
      const sourceCsvRel = toPosix(path.relative(contentRoot, csvFile));
      const sourceMetaRel = toPosix(path.relative(contentRoot, metaFile));
      const numericHeaders = new Set(headers.filter((header) => isNumericColumn(rows, header)));
      const amountColumn = meta.amount_column
        || headers.find((header) => numericHeaders.has(header))
        || '';

      const groupStems = groups.map((group) => groupStem(meta.date, sourceStem, group.slug));
      const summaryStem = groupStem(meta.date, sourceStem, '');

      const outputs = groups.map((group, index) => ({
        file: path.join(dir, `${groupStems[index]}.md`),
        text: buildGroupNote({
          group,
          meta,
          headers,
          csvName,
          summaryStem,
          sourceCsvRel,
          sourceMetaRel,
          numericHeaders,
        }),
      }));
      outputs.push({
        file: path.join(dir, `${summaryStem}.md`),
        text: buildSummaryNote({
          groups,
          meta,
          grandTotalRow,
          csvName,
          groupStems,
          sourceCsvRel,
          sourceMetaRel,
          amountColumn,
        }),
      });

      for (const output of outputs) {
        if (args.dryRun) {
          console.log(`  (dry-run) ${display(output.file)}`);
        } else {
          await fs.writeFile(output.file, output.text, 'utf8');
          console.log(`  생성 ${display(output.file)}`);
        }
        written.push(output.file);
      }
    }
  } catch (error) {
    console.error(`예산 페이지 생성 중 오류가 발생했습니다: ${error.message}`);
    process.exit(1);
  }

  if (args.manifest && !args.dryRun) {
    const out = path.resolve(args.manifest);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, `${JSON.stringify(written, null, 2)}\n`, 'utf8');
  }

  console.log(`예산 페이지 ${args.dryRun ? '확인' : '생성'} 완료: ${written.length}개`);
}

await main();
