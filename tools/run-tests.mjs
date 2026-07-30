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
  const header = '\ufeff문서번호,날짜,부서,출처유형,제목,키워드,원문URL,아카이브URL,앵커,source_commit,generated_at,pages_url';
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
  const all = [...checks, ...assertions.map(([name, ok, detail]) => ({ name, ok, detail: ok ? '' : detail })), ...guideChecks];
  await fs.rm(tmp, { recursive: true, force: true });
  return all;
}

async function main() {
  const results = [
    ...(await runValidateTests()),
    ...(await runPiiTests()),
    ...(await runCatalogTests()),
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
