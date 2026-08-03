import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolsDir, '..');
const fixturesRoot = path.join(toolsDir, '__fixtures__');

function fixture(...parts) {
  return path.join(fixturesRoot, ...parts);
}

function script(name) {
  return path.join(toolsDir, name);
}

function runNode(scriptPath, args, env = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function outputOf(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function assertProcess(name, result, expectation) {
  const output = outputOf(result);
  const statusOk = expectation.code === 0 ? result.status === 0 : result.status !== 0;
  const textOk = (expectation.includes ?? []).every((text) => output.includes(text));
  return {
    name,
    ok: statusOk && textOk,
    detail: statusOk && textOk ? '' : `종료코드: ${result.status}\n${output}`.trim(),
  };
}

function sectionBody(markdown, title) {
  const marker = `## ${title}`;
  const start = markdown.indexOf(marker);
  if (start === -1) return '';
  const rest = markdown.slice(start + marker.length);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

async function ensureGpsJpeg() {
  const dir = fixture('pii', 'gps-exif', 'assets');
  await fs.mkdir(dir, { recursive: true });
  const tiff = Buffer.alloc(26);
  tiff.write('MM', 0, 'ascii');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x8825, 10);
  tiff.writeUInt16BE(4, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt32BE(0, 18);
  tiff.writeUInt32BE(0, 22);
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(exif.length + 2);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), length, exif, Buffer.from([0xff, 0xd9])]);
  await fs.writeFile(path.join(dir, 'gps.jpg'), jpeg);
}

async function runValidateTests() {
  const cases = [
    ['validate/valid', 'valid', { code: 0 }],
    ['validate/enum-violation', 'enum-violation', { code: 1, includes: ['source_type 허용값'] }],
    ['validate/nine-keywords', 'nine-keywords', { code: 1, includes: ['keywords는 최대 8개'] }],
    ['validate/duplicate-doc-id', 'duplicate-doc-id', { code: 1, includes: ['doc_id가 중복'] }],
    ['validate/duplicate-basename', 'duplicate-basename', { code: 1, includes: ['파일 이름이 중복'] }],
    ['validate/screened-without-signoff', 'screened-without-signoff', { code: 1, includes: ['screened 공개 서명 필드'] }],
    ['validate/guide-pages', 'guide-pages', { code: 0 }],
    // 기한 필드
    ['validate/simple-notice-dates-empty', 'simple-notice-dates-empty', { code: 0 }],
    ['validate/event-before-start', 'event-before-start', { code: 1, includes: ['행사 시작일이 종료일보다'] }],
    ['validate/application-start-without-deadline', 'application-start-without-deadline', { code: 1, includes: ['application_starts_at 만 있고'] }],
    ['validate/employment-missing-application-deadline', 'employment-missing-application-deadline', { code: 1, includes: ['application_deadline 가 필요합니다'] }],
    ['validate/event-no-dates-ok', 'event-no-dates-ok', { code: 0 }],
    // 칸은 있고 값만 빈 경우 — 파서가 [] 로 만들기 때문에 별도로 고정해야 한다
    ['validate/blank-optional-dates-ok', 'blank-optional-dates-ok', { code: 0 }],
    ['validate/blank-required-date', 'blank-required-date', { code: 1, includes: ['application_deadline 가 필요합니다'] }],
    // 분류 레지스트리
    ['validate/unknown-category-folder', 'unknown-category-folder', { code: 1, includes: ['문서분류 폴더가 표준값이 아닙니다'] }],
    // 전사·안건
    ['validate/transcript-missing-disclaimer', 'transcript-missing-disclaimer', { code: 1, includes: ['본문 첫 줄이 고지문이어야'] }],
    ['validate/agenda-anchor-missing', 'agenda-anchor-missing', { code: 1, includes: ['안건 헤딩에 앵커가 없습니다'] }],
    // 원본 보존
    ['validate/archive-required-no-fallback', 'archive-required-no-fallback', { code: 1, includes: ['archive_url 이 필요합니다'] }],
    ['validate/archive-required-with-fallback', 'archive-required-with-fallback', { code: 0 }],
  ];
  return cases.map(([name, dir, expectation]) => {
    const result = runNode(script('validate-frontmatter.mjs'), ['--content', fixture('validate', dir, 'content'), '--require-published']);
    return assertProcess(name, result, expectation);
  });
}

async function runPiiTests() {
  await ensureGpsJpeg();
  const cases = [
    ['pii/masked', 'masked', { code: 0 }],
    ['pii/unmasked-phone', 'unmasked-phone', { code: 1, includes: ['김민수'] }],
    ['pii/unmasked-rrn', 'unmasked-rrn', { code: 1, includes: ['이영희'] }],
    ['pii/gps-exif', 'gps-exif', { code: 1, includes: ['GPS EXIF'] }],
    ['pii/scope-missing', 'scope-missing', { code: 1, includes: ['screening_scope'] }],
    ['pii/public-official', 'public-official', { code: 0 }],
    ['pii/ordinary-words', 'ordinary-words', { code: 0 }],
    ['pii/strong-signals', 'strong-signals', { code: 1, includes: ['홍길동', '김철수', '이영희'] }],
    ['pii/csv-clean', 'csv-clean', { code: 0 }],
    ['pii/csv-structural-column', 'csv-structural-column', { code: 1, includes: ['김철수', '사업명'] }],
    ['pii/csv-exception-ok', 'csv-exception-ok', { code: 0, includes: ['개인정보 검사 예외 1건'] }],
    ['pii/csv-exception-no-reason', 'csv-exception-no-reason', { code: 1, includes: ['5개'] }],
  ];
  return cases.map(([name, dir, expectation]) => {
    const root = fixture('pii', dir);
    const result = runNode(script('lint-pii.mjs'), ['--content', path.join(root, 'content'), '--root', root]);
    return assertProcess(name, result, expectation);
  });
}

async function runCatalogTests() {
  const tmp = fixture('tmp');
  const mixedTmp = path.join(tmp, 'mixed');
  const pageOut = path.join(mixedTmp, 'catalog.md');
  const dataOut = path.join(mixedTmp, 'data');
  await fs.rm(tmp, { recursive: true, force: true });
  const result = runNode(script('build-catalog.mjs'), [
    '--content', fixture('catalog', 'exact', 'content'),
    '--page-out', pageOut,
    '--data-out', dataOut,
  ], { GITHUB_SHA: 'fixture-sha', PAGES_URL: 'https://pages.example/localog' });
  const checks = [assertProcess('catalog/build-command', result, { code: 0, includes: ['카탈로그 생성 완료: 5행'] })];
  if (result.status !== 0) return checks;

  const page = await fs.readFile(pageOut, 'utf8');
  const csv = await fs.readFile(path.join(dataOut, 'catalog.csv'), 'utf8');
  const llms = await fs.readFile(path.join(dataOut, 'llms.txt'), 'utf8');
  const header = '\ufeff문서번호,날짜,부서,출처유형,제목,키워드,원문URL,아카이브URL,앵커,게재시작,게재종료,신청시작,신청마감,행사시작,행사종료,source_commit,generated_at,pages_url';
  const assertions = [
    ['catalog/page-row-count', (page.match(/^\| 2026-/gm) ?? []).length === 5, '카탈로그 페이지 행 수가 5가 아닙니다.'],
    ['catalog/explicit-anchor', page.includes('[[2026-03-01-회의록#2026-03-01-구의회회의록-01-a01]]'), '명시 앵커 링크가 없습니다.'],
    ['catalog/synth-anchor-a02', page.includes('[[2026-03-01-회의록#2026-03-01-구의회회의록-01-a02]]'), '합성 a02 앵커 링크가 없습니다.'],
    ['catalog/synth-anchor-a03', page.includes('[[2026-03-01-회의록#2026-03-01-구의회회의록-01-a03]]'), '합성 a03 앵커 링크가 없습니다.'],
    ['catalog/exact-reference', page.includes('`대덕구-기획예산과-2026-12` → `대덕구-기획예산과-2026-1`'), '정확 일치 관련근거 연결이 없습니다.'],
    ['catalog/pending-reference', page.includes('`대덕구-기획예산과-2026-12` → `대덕구-기획예산과-2026-99`'), '미등록 관련근거가 대기로 기록되지 않았습니다.'],
    ['catalog/csv-header', csv.startsWith(header), 'CSV BOM 또는 헤더가 정확하지 않습니다.'],
    ['catalog/csv-row-count', csv.trimEnd().split(/\r?\n/).length === 6, 'CSV 행 수가 헤더 포함 6이 아닙니다.'],
    ['catalog/csv-metadata', csv.includes('fixture-sha') && csv.includes('https://pages.example/localog'), 'CSV 메타데이터가 반복되지 않았습니다.'],
    ['catalog/llms-shape', llms.startsWith('# localog\n\n>') && llms.includes('source_commit: fixture-sha') && llms.includes('## 지역별'), 'llms.txt 형식 또는 메타데이터가 맞지 않습니다.'],
    ['catalog/mixed-guide-filter', !csv.includes('카탈로그 혼합 fixture 안내') && !page.includes('카탈로그 혼합 fixture 안내'), '혼합 fixture에서 안내 페이지가 자료 행으로 섞였습니다.'],
  ];
  const guideTmp = path.join(tmp, 'guide-only');
  const guidePageOut = path.join(guideTmp, 'catalog.md');
  const guideDataOut = path.join(guideTmp, 'data');
  const guideResult = runNode(script('build-catalog.mjs'), [
    '--content', fixture('catalog', 'guide-only', 'content'),
    '--page-out', guidePageOut,
    '--data-out', guideDataOut,
  ], { GITHUB_SHA: 'fixture-sha', PAGES_URL: 'https://pages.example/localog' });
  const guideChecks = [assertProcess('catalog/guide-only-command', guideResult, { code: 0, includes: ['카탈로그 생성 완료: 0행'] })];
  if (guideResult.status === 0) {
    const guidePage = await fs.readFile(guidePageOut, 'utf8');
    const guideCsv = await fs.readFile(path.join(guideDataOut, 'catalog.csv'), 'utf8');
    const guideLlms = await fs.readFile(path.join(guideDataOut, 'llms.txt'), 'utf8');
    const emptySections = ['지역별', '분류별', '연도별', '문서별'].every((title) => !sectionBody(guideLlms, title).includes('- ['));
    guideChecks.push(
      { name: 'catalog/guide-only-csv-header-only', ok: guideCsv === `${header}\n`, detail: '안내 페이지만 있을 때 CSV가 헤더 한 줄만 남지 않았습니다.' },
      { name: 'catalog/guide-only-page-empty', ok: guidePage.includes('아직 등록된 자료가 없습니다.') && !guidePage.includes('| 날짜 |'), detail: '자료 없음 카탈로그 페이지가 올바르지 않습니다.' },
      { name: 'catalog/guide-only-empty-record-sections', ok: emptySections, detail: 'llms.txt의 자료 섹션에 안내 페이지가 섞였습니다.' },
      { name: 'catalog/guide-only-guide-section', ok: sectionBody(guideLlms, '안내').includes('사용법 — 내 AI로 물어보기') && sectionBody(guideLlms, '안내').includes('이용 안내 · 법적 고지') && sectionBody(guideLlms, '안내').includes('커넥터로 등록하기 (숙련자용)'), detail: 'llms.txt 안내 섹션에 guide page 링크가 없습니다.' },
      { name: 'catalog/guide-only-zero-summary', ok: guideLlms.includes('현재 등록된 자료는 0건입니다'), detail: 'llms.txt 요약에 0건 안내가 없습니다.' },
    );
  }
  // 기한이 세 산출물에 모두 실리는지. CSV 에만 있으면 AI 가 마감일을 못 본다.
  const dateTmp = path.join(tmp, 'dates');
  const datePageOut = path.join(dateTmp, 'catalog.md');
  const dateDataOut = path.join(dateTmp, 'data');
  const dateResult = runNode(script('build-catalog.mjs'), [
    '--content', fixture('catalog', 'dates', 'content'),
    '--page-out', datePageOut,
    '--data-out', dateDataOut,
  ], { GITHUB_SHA: 'fixture-sha', PAGES_URL: 'https://pages.example/localog' });
  const dateChecks = [assertProcess('catalog/dates-command', dateResult, { code: 0 })];
  if (dateResult.status === 0) {
    const datePage = await fs.readFile(datePageOut, 'utf8');
    const dateCsv = await fs.readFile(path.join(dateDataOut, 'catalog.csv'), 'utf8');
    const dateLlms = await fs.readFile(path.join(dateDataOut, 'llms.txt'), 'utf8');
    const everywhere = (value) => dateCsv.includes(value) && dateLlms.includes(value) && datePage.includes(value);
    dateChecks.push(
      { name: 'catalog/dates-application-deadline-everywhere', ok: everywhere('2026-08-05'), detail: '신청마감(2026-08-05)이 csv·llms.txt·catalog.md 세 곳에 모두 있지 않습니다.' },
      { name: 'catalog/dates-event-start-everywhere', ok: everywhere('2026-08-10'), detail: '행사시작(2026-08-10)이 세 산출물에 모두 있지 않습니다.' },
      { name: 'catalog/dates-event-end-everywhere', ok: everywhere('2026-08-12'), detail: '행사종료(2026-08-12)가 세 산출물에 모두 있지 않습니다.' },
      { name: 'catalog/dates-summary-in-llms', ok: dateLlms.includes('일정: 신청 2026-08-01~2026-08-05; 행사 2026-08-10~2026-08-12'), detail: 'llms.txt 에 일정 요약 문장이 없습니다.' },
      { name: 'catalog/stem-reference-linked', ok: sectionBody(datePage, '관련근거 연결').includes('`2026-08-04-나` → `2026-08-03-가`'), detail: 'doc_id 없는 문서를 파일명으로 가리킨 관련근거가 연결되지 않았습니다.' },
      { name: 'catalog/stem-reference-not-pending', ok: !datePage.includes('## 근거 연결 대기'), detail: '파일명 기반 관련근거가 대기로 빠졌습니다.' },
    );
  }

  const all = [
    ...checks,
    ...assertions.map(([name, ok, detail]) => ({ name, ok, detail: ok ? '' : detail })),
    ...guideChecks,
    ...dateChecks,
  ];
  await fs.rm(tmp, { recursive: true, force: true });
  return all;
}

async function runBudgetTests() {
  const checks = [];
  const tmp = fixture('tmp-budget');
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(tmp, { recursive: true });

  const validateCases = [
    ['budget/valid', 'valid', { code: 0, includes: ['검증 완료: 1쌍'] }],
    ['budget/hostile-input-passes-validation', 'hostile', { code: 0 }],
    ['budget/orphan-csv-blocked', 'orphan-csv', { code: 1, includes: ['짝이 되는'] }],
    ['budget/draft-signoff-blocked', 'draft-signoff', { code: 1, includes: ['정확히'] }],
    ['budget/missing-column-blocked', 'missing-column', { code: 1, includes: ['가리키는 열이 CSV 에 없습니다'] }],
    ['budget/slug-collision-blocked', 'slug-collision', { code: 1, includes: ['같은 슬러그로 겹칩니다'] }],
  ];
  for (const [name, dir, expectation] of validateCases) {
    const result = runNode(script('validate-budget-csv.mjs'), ['--content', fixture('budget', dir, 'content')]);
    checks.push(assertProcess(name, result, expectation));
  }

  checks.push(
    assertProcess(
      'budget/pairs-in-required',
      runNode(script('build-budget-pages.mjs'), ['--content', fixture('budget', 'valid', 'content')]),
      { code: 1, includes: ['--pairs-in 이 필요합니다'] },
    ),
  );

  const work = path.join(tmp, 'hostile');
  await fs.cp(fixture('budget', 'hostile', 'content'), path.join(work, 'content'), { recursive: true });
  const pairsOut = path.join(tmp, 'pairs.json');
  const contentDir = path.join(work, 'content');

  checks.push(
    assertProcess(
      'budget/hostile-validate',
      runNode(script('validate-budget-csv.mjs'), ['--content', contentDir, '--pairs-out', pairsOut]),
      { code: 0 },
    ),
  );
  const generate = runNode(script('build-budget-pages.mjs'), [
    '--content', contentDir,
    '--pairs-in', pairsOut,
    '--manifest', path.join(tmp, 'manifest.json'),
  ]);
  checks.push(assertProcess('budget/hostile-generate', generate, { code: 0, includes: ['생성 완료: 4개'] }));

  if (generate.status === 0) {
    const noteDir = path.join(contentDir, '대전시', '대덕구', '예산서');
    const env = await fs.readFile(path.join(noteDir, '2026-01-01-악성입력-환경과.md'), 'utf8');
    const welfare = await fs.readFile(path.join(noteDir, '2026-01-01-악성입력-복지과.md'), 'utf8');
    const construction = await fs.readFile(path.join(noteDir, '2026-01-01-악성입력-건설과.md'), 'utf8');
    const summary = await fs.readFile(path.join(noteDir, '2026-01-01-악성입력-총괄.md'), 'utf8');
    const tableLines = welfare.split('\n').filter((line) => line.startsWith('|')).length;

    const assertions = [
      ['budget/escape-script-tag', env.includes('&lt;script&gt;') && !env.includes('<script>'), 'script 태그가 문자로 이스케이프되지 않았습니다.'],
      ['budget/escape-img-onerror', !env.includes('<img'), 'img 태그가 문자로 이스케이프되지 않았습니다.'],
      ['budget/escape-pipe', welfare.includes('파이프\\|포함\\|사업'), '셀 안의 파이프가 이스케이프되지 않아 표가 깨집니다.'],
      ['budget/escape-link-brackets', construction.includes('\\[클릭\\]') && !construction.includes('[클릭](javascript:'), '대괄호가 이스케이프되지 않아 javascript: 링크가 만들어질 수 있습니다.'],
      ['budget/frontmatter-not-raw-html', !env.split('---')[1].includes('<script>') && !env.split('---')[1].includes('<img'), '프론트매터(keywords·title)에 CSV 의 raw HTML 이 그대로 들어갔습니다.'],
      ['budget/newline-cell-keeps-table-shape', tableLines === 4, `개행 포함 셀이 표 구조를 깨뜨렸습니다(표 줄 수 ${tableLines}, 기대 4).`],
      ['budget/signoff-inherited', env.includes('review_status: screened') && env.includes('pii_screened_by: fixture-reviewer'), '진본 CSV 의 서명이 생성 노트에 상속되지 않았습니다.'],
      ['budget/stale-sentinels', env.includes('generated: true') && env.includes('generated_by: build-budget-pages') && env.includes('source_csv:') && env.includes('source_meta:'), '빌드 정리용 sentinel 필드가 빠졌습니다.'],
      ['budget/search-reinforcement-outside-table', env.split('\n').some((line) => line.startsWith('이 문서에 포함된 항목:')), '표 바깥 검색 보강 블록이 없습니다.'],
      ['budget/summary-marks-aggregate', summary.includes('이 사이트가 CSV 를 더해 만든 집계'), '총괄 노트가 집계임을 명시하지 않았습니다.'],
      ['budget/summary-keeps-source-total', summary.includes('원문 전체 합계'), '총괄 노트에 원문 전체 합계 표기가 없습니다.'],
      ['budget/total-row-flag', env.includes('budget_has_total_row:'), '합계행 여부 플래그가 없습니다.'],
    ];
    checks.push(...assertions.map(([name, ok, detail]) => ({ name, ok, detail: ok ? '' : detail })));
  }

  await fs.rm(tmp, { recursive: true, force: true });
  return checks;
}

// 로더는 하위 프로세스가 아니라 직접 불러 검사한다.
// 레지스트리 오타가 조용히 통과하면 required_dates 강제가 통째로 사라지기 때문이다.
async function runCategoryTests() {
  const { loadCategories, lookupCategory } = await import('./lib/categories.mjs');
  const checks = [];

  const registry = await loadCategories();
  checks.push({
    name: 'categories/daedeok-loaded',
    ok: Object.keys(registry?.['대전시']?.['대덕구'] ?? {}).length === 10,
    detail: '대덕구 분류 10개가 적재되지 않았습니다.',
  });
  checks.push({
    name: 'categories/unknown-folder-null',
    ok: lookupCategory(registry, '대전시', '대덕구', '없는폴더') === null,
    detail: '없는 폴더 조회가 null 이 아닙니다.',
  });
  checks.push({
    name: 'categories/required-dates-loaded',
    ok: lookupCategory(registry, '대전시', '대덕구', '채용공고')?.required_dates?.includes('application_deadline') === true,
    detail: '채용공고의 required_dates 가 적재되지 않았습니다.',
  });

  let duplicateMessage = '';
  try {
    await loadCategories(fixture('categories', 'duplicate-source-type'));
  } catch (error) {
    duplicateMessage = String(error.message);
  }
  checks.push({
    name: 'categories/duplicate-source-type',
    ok: duplicateMessage.includes('중복') && duplicateMessage.includes('가나다') && duplicateMessage.includes('라마바'),
    detail: `source_type 중복이 두 폴더명과 함께 보고되지 않았습니다: ${duplicateMessage || '(throw 하지 않음)'}`,
  });

  return checks;
}

async function main() {
  const results = [
    ...(await runValidateTests()),
    ...(await runPiiTests()),
    ...(await runCatalogTests()),
    ...(await runCategoryTests()),
    ...(await runBudgetTests()),
  ];
  for (const result of results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}`);
    if (!result.ok && result.detail) console.log(result.detail);
  }
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n결과: ${results.length - failed}/${results.length} PASS`);
  if (failed > 0) process.exit(1);
}

await main();
