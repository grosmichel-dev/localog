import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCsv, toPosix } from './lib/budget.mjs';

const MASK_PATTERN = /\[REDACTED_(?:성명|연락처)\]/g;
// 열 제목 자체가 개인정보 맥락인 경우. 예산 CSV 에서 실명이 들어오는 대표적 경로다
// (보조금 수령자·위탁업체 대표·강사료 지급 대상·개인사업자).
const HEADER_NAME_HINT = /(성명|이름|대표자|대표|수령|수령인|지급대상|지급\s*대상|담당자|신청인|신청자|위탁|수탁|강사|계약상대|업체대표)/;
// "셀 전체가 이름 하나" 규칙을 끌 접미사.
// 조직·행정구역 + 회계 용어. 성씨로 시작하는 조직명(홍보과)과 예산 항목(강사료·인건비·여비)이
// 사람 이름으로 오인되는 것을 막는다.
// ★'수' 는 넣지 않는다 — 철수·영수·민수처럼 실제 이름이 대량으로 빠져나간다.
const ORG_SUFFIX = /(과|실|팀|국|부|청|원|소|관|단|처|본부|센터|공사|재단|위원회|사업|학교|병원|지구|동|읍|면|리|비|료|금|액|세|율|권|증)$/;
// 같은 열에서 이 횟수 이상 반복되는 값은 사람 이름이 아니라 분류 값으로 본다.
const CATEGORY_REPEAT_THRESHOLD = 3;
const DEFAULT_EXCEPTIONS = 'docs/pii-exceptions.csv';
const EXCEPTION_COLUMNS = ['파일', '행', '열', '값', '사유'];
// 마크다운에는 열이 없다. 예외 파일의 5칸 계약을 깨지 않으려고 고정 값을 쓴다.
const MARKDOWN_EXCEPTION_COLUMN = '본문';
const SINGLE_SURNAMES = new Set('김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구나민진지엄채원천방공현함변염여추도소석선설마길연위표명기반라왕금옥육인맹제모탁국어은편용'.split(''));
const COMPOUND_SURNAMES = ['남궁', '황보', '제갈', '선우', '독고', '사공'];
const PHONE_PATTERN = /(01\d[-\s]?\d{3,4}[-\s]?\d{4}|0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4})/;
const RRN_PATTERN = /\d{6}[-\s]?[1-4](?:\d{6}|[xX*]{6})/;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const HONORIFIC_PATTERN = /^[\s]*(?:씨|님|군|양)/;
const OFFICIAL_PATTERN = /(의원|구청장|과장|팀장|국장|위원장|서기관|주무관)/;
const NON_NAME_TOKENS = new Set(['연락처', '전화', '휴대폰', '주소', '생년', '생년월일', '주민등록', '이메일', '민원인', '신청자', '대상자', '담당자']);

function usage() {
  return `개인정보/EXIF 점검기

사용법:
  node tools/lint-pii.mjs [--content content] [--root .] [--exceptions docs/pii-exceptions.csv]

검사 내용:
  - 개인정보 단서 주변의 마스킹되지 않은 한국어 성명 후보
  - content/ 안 CSV 의 **모든 셀** (열 단위 제외는 두지 않는다)
  - originals/assets 참조와 screening_scope 불일치
  - assets 안 이미지의 GPS EXIF 또는 PNG eXIf 잔존 여부

오탐 예외는 열 전체를 빼는 방식이 아니라, 예외 파일에
${EXCEPTION_COLUMNS.join(' / ')} 5개를 모두 적은 셀 단위 항목으로만 허용한다.
등록된 예외는 실행할 때마다 전부 로그에 출력된다.
`;
}

function parseArgs(argv) {
  const args = { content: 'content', root: null, exceptions: '', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--content') {
      i += 1;
      if (!argv[i]) throw new Error('--content 뒤에 폴더 경로가 필요합니다.');
      args.content = argv[i];
    } else if (arg === '--root') {
      i += 1;
      if (!argv[i]) throw new Error('--root 뒤에 저장소 경로가 필요합니다.');
      args.root = argv[i];
    } else if (arg === '--exceptions') {
      i += 1;
      if (!argv[i]) throw new Error('--exceptions 뒤에 파일 경로가 필요합니다.');
      args.exceptions = argv[i];
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

function addViolation(violations, file, line, reason) {
  violations.push(`${toDisplayPath(file)}:${line} — ${reason}`);
}

async function walkFiles(root, predicate) {
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
      } else if (entry.isFile() && predicate(entry.name)) {
        files.push(fullPath);
      }
    }
  }
  await walk(root);
  return files;
}

function cleanValue(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitInlineArray(value) {
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map((item) => cleanValue(item)).filter(Boolean);
}

function parseValue(raw) {
  const value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) return splitInlineArray(value);
  return cleanValue(value);
}

function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { data: {}, body: text, bodyStartLine: 1 };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) return { data: {}, body: text, bodyStartLine: 1 };
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
  return { data, body: lines.slice(end + 1).join('\n'), bodyStartLine: end + 2 };
}

function isPublicOfficialContext(line, start, end) {
  const adjacent = line.slice(Math.max(0, start - 10), Math.min(line.length, end + 10));
  return OFFICIAL_PATTERN.test(adjacent);
}

function namePart(token) {
  if (/[씨님군양]$/.test(token) && token.length > 2) return token.slice(0, -1);
  return token;
}

function startsWithKnownSurname(token) {
  return COMPOUND_SURNAMES.some((surname) => token.startsWith(surname)) || SINGLE_SURNAMES.has(token[0]);
}

function hasStrongPiiSignal(line, token, start, end) {
  const tokenWithoutHonorific = namePart(token);
  if (tokenWithoutHonorific !== token) return true;
  const after = line.slice(end, Math.min(line.length, end + 8));
  const window = line.slice(Math.max(0, start - 40), Math.min(line.length, end + 40));
  return HONORIFIC_PATTERN.test(after)
    || PHONE_PATTERN.test(window)
    || RRN_PATTERN.test(window)
    || EMAIL_PATTERN.test(window);
}

function likelyPersonalName(line, token, start, end, forceSignal = false) {
  const tokenWithoutHonorific = namePart(token);
  if (tokenWithoutHonorific.length < 2 || tokenWithoutHonorific.length > 4) return '';
  if (NON_NAME_TOKENS.has(tokenWithoutHonorific)) return '';
  if (!startsWithKnownSurname(tokenWithoutHonorific)) return '';
  if (!forceSignal && !hasStrongPiiSignal(line, token, start, end)) return '';
  return tokenWithoutHonorific;
}

function lintNames(file, relFile, parsed, exceptions, violations) {
  // 공지문에 부서 연락처가 있으면 그 둘레의 평범한 낱말(제출방법·신청서류 등)이 성씨로 시작한다는
  // 이유만으로 매번 걸린다. 탐지를 느슨하게 하는 대신, CSV 와 똑같이 파일·행·값이 모두 맞는
  // 예외만 눈감아 준다. 무엇을 눈감았는지는 실행할 때마다 로그에 남는다.
  const allowed = new Set(
    exceptions
      .filter((entry) => entry.file.normalize('NFC') === relFile.normalize('NFC'))
      .map((entry) => exceptionKey(entry.row, entry.column, entry.value)),
  );
  const lines = parsed.body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const originalLine = lines[index];
    const line = originalLine.replace(MASK_PATTERN, ' '.repeat(18));
    const lineNumber = parsed.bodyStartLine + index;
    const candidates = line.matchAll(/[가-힣]{2,4}/g);
    for (const match of candidates) {
      const token = match[0];
      const start = match.index ?? 0;
      const end = start + token.length;
      if (isPublicOfficialContext(line, start, end)) continue;
      const name = likelyPersonalName(line, token, start, end);
      if (!name) continue;
      if (allowed.has(exceptionKey(lineNumber, MARKDOWN_EXCEPTION_COLUMN, name))) continue;
      addViolation(
        violations,
        file,
        lineNumber,
        `마스킹되지 않은 개인정보 후보가 있습니다: ${name} — 실제로 개인정보가 아니라면 예외 파일에 ${EXCEPTION_COLUMNS.join('/')} 5개를 적어 등록하세요(열은 '${MARKDOWN_EXCEPTION_COLUMN}').`,
      );
      break;
    }
  }
}

function lintReferenceScopes(file, text, screeningScope, violations) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const refs = lines[index].matchAll(/\b(originals|assets)\/[\w가-힣().%+\-\/]+/g);
    for (const ref of refs) {
      const scopeName = ref[1];
      if (!String(screeningScope ?? '').includes(scopeName)) {
        addViolation(violations, file, index + 1, `${scopeName}/ 참조가 있지만 screening_scope에 ${scopeName}가 없습니다: ${ref[0]}`);
      }
    }
  }
}

function pngHasExif(bytes) {
  if (bytes.length < 8 || bytes.compare(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 0, 8, 0, 8) !== 0) return false;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'eXIf') return true;
    offset += 12 + length;
  }
  return false;
}

function jpegHasGpsExif(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return false;
    const segmentLength = bytes.readUInt16BE(offset);
    const segmentStart = offset + 2;
    const segmentEnd = segmentStart + segmentLength - 2;
    if (marker === 0xe1 && bytes.toString('ascii', segmentStart, segmentStart + 6) === 'Exif\0\0') {
      if (jpegExifHasGpsIfd(bytes, segmentStart + 6, segmentEnd)) return true;
    }
    offset = segmentEnd;
  }
  return false;
}

function jpegExifHasGpsIfd(bytes, tiffStart, segmentEnd) {
  const little = bytes.toString('ascii', tiffStart, tiffStart + 2) === 'II';
  const big = bytes.toString('ascii', tiffStart, tiffStart + 2) === 'MM';
  if (!little && !big) return false;
  const read16 = (offset) => (little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset));
  const read32 = (offset) => (little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset));
  if (read16(tiffStart + 2) !== 42) return false;
  const ifd0 = tiffStart + read32(tiffStart + 4);
  if (ifd0 + 2 > segmentEnd) return false;
  const entries = read16(ifd0);
  for (let i = 0; i < entries; i += 1) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > segmentEnd) return false;
    if (read16(entry) === 0x8825) return true;
  }
  return false;
}

/**
 * 셀 단위 예외 목록을 읽는다.
 * 열 전체를 검사에서 빼는 기능은 **의도적으로 제공하지 않는다** — 예산 CSV 의
 * 사업명·부서 같은 구조 열에도 실명이 들어올 수 있어서, 열을 빼면 그 경로로
 * 개인정보가 무검사 공개된다.
 */
/**
 * 예외 조회 키. 키를 만드는 곳이 두 군데면 구분자가 어긋나 예외가 조용히 무시된다
 * (실제로 그렇게 한 번 깨졌다). 반드시 이 함수 하나만 쓴다.
 * 한글 경로·값은 NFC 로 정규화해 NFD/NFC 차이로 어긋나지 않게 한다.
 */
function exceptionKey(row, column, value) {
  return [row, String(column ?? '').normalize('NFC'), String(value ?? '').normalize('NFC')].join('\u0000');
}

async function loadExceptions(file, violations) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const { headers, rows } = parseCsv(text);
  const missingColumns = EXCEPTION_COLUMNS.filter((column) => !headers.includes(column));
  if (missingColumns.length > 0) {
    addViolation(violations, file, 1, `예외 파일에 필요한 열이 없습니다: ${missingColumns.join(', ')}`);
    return [];
  }
  const entries = [];
  rows.forEach((row, index) => {
    const entry = {
      file: toPosix(row['파일'] ?? ''),
      row: Number.parseInt(row['행'] ?? '', 10),
      column: row['열'] ?? '',
      value: row['값'] ?? '',
      reason: (row['사유'] ?? '').trim(),
    };
    const empty = EXCEPTION_COLUMNS.filter((column) => String(row[column] ?? '').trim() === '');
    if (empty.length > 0) {
      addViolation(violations, file, index + 2, `예외 항목에 빈 항목이 있습니다: ${empty.join(', ')} — 5개(${EXCEPTION_COLUMNS.join('/')})를 모두 적어야 예외로 인정합니다.`);
      return;
    }
    if (!Number.isInteger(entry.row) || entry.row < 1) {
      addViolation(violations, file, index + 2, `예외 항목의 '행' 이 1 이상의 정수가 아닙니다: ${row['행']}`);
      return;
    }
    entries.push(entry);
  });
  return entries;
}

function reportExceptions(file, entries) {
  if (entries.length === 0) return;
  console.log(`개인정보 검사 예외 ${entries.length}건 (${toDisplayPath(file)}) — 무엇을 눈감았는지 항상 표시합니다:`);
  for (const entry of entries) {
    console.log(`  - ${entry.file} 행${entry.row} [${entry.column}] "${entry.value}" ← ${entry.reason}`);
  }
}

/**
 * CSV 의 모든 셀을 검사한다.
 * 문맥은 행 전체로 잡는다 — 전화번호나 주민번호가 옆 셀에 있어도 신호로 쓰기 위해서다.
 * 열 제목 자체가 개인정보 맥락(수령인·대표자 등)이면 그 열은 신호가 약해도 성명 후보로 본다.
 */
function lintCsvCells(file, relFile, text, exceptions, violations) {
  let parsed;
  try {
    parsed = parseCsv(text);
  } catch (error) {
    addViolation(violations, file, 1, `CSV 를 해석할 수 없습니다: ${error.message}`);
    return;
  }
  const { headers, rows } = parsed;
  const allowed = new Set(
    exceptions
      .filter((entry) => entry.file.normalize('NFC') === relFile.normalize('NFC'))
      .map((entry) => exceptionKey(entry.row, entry.column, entry.value)),
  );

  // 열별 값 빈도. 같은 값이 여러 행에 반복되면 분류 값이지 사람 이름이 아니다.
  const columnCounts = new Map();
  for (const header of headers) {
    const counts = new Map();
    for (const row of rows) {
      const value = String(row[header] ?? '').trim();
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    columnCounts.set(header, counts);
  }

  rows.forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const rowText = headers.map((header) => String(row[header] ?? '')).join(' ');
    const offsets = new Map();
    let cursor = 0;
    for (const header of headers) {
      offsets.set(header, cursor);
      cursor += String(row[header] ?? '').length + 1;
    }

    for (const header of headers) {
      const cell = String(row[header] ?? '');
      if (!cell.trim()) continue;
      if (allowed.has(exceptionKey(rowNumber, header, cell))) continue;
      // 셀 전체가 이름 하나뿐이면 그 자체로 강한 신호로 본다.
      // 단 '홍보과'·'주민센터'처럼 성씨로 시작하는 조직명이 오탐 나므로 조직 접미사는 제외한다.
      const trimmed = cell.trim();
      const repeats = (columnCounts.get(header)?.get(trimmed) ?? 0) >= CATEGORY_REPEAT_THRESHOLD;
      const wholeCellName = /^[가-힣]{2,4}$/.test(trimmed) && !ORG_SUFFIX.test(trimmed) && !repeats;
      // 열 제목이 개인정보 맥락이면(수령인·대표자 등) 접미사·반복 여부와 무관하게 본다.
      const headerStrong = HEADER_NAME_HINT.test(header) || wholeCellName;
      const masked = cell.replace(MASK_PATTERN, ' '.repeat(18));
      for (const match of masked.matchAll(/[가-힣]{2,4}/g)) {
        const token = match[0];
        const start = (offsets.get(header) ?? 0) + (match.index ?? 0);
        const end = start + token.length;
        if (!headerStrong && isPublicOfficialContext(rowText, start, end)) continue;
        const name = likelyPersonalName(rowText, token, start, end, headerStrong);
        if (!name) continue;
        addViolation(
          violations,
          file,
          rowNumber + 1,
          `마스킹되지 않은 개인정보 후보가 있습니다: ${name} (행${rowNumber}, 열 '${header}', 값 "${cell}") — 실제로 개인정보가 아니라면 예외 파일에 ${EXCEPTION_COLUMNS.join('/')} 5개를 적어 등록하세요.`,
        );
        break;
      }
    }
  });
}

async function lintImages(root, violations) {
  const assetsRoot = path.join(root, 'assets');
  const images = await walkFiles(assetsRoot, (name) => /\.(?:jpe?g|png)$/i.test(name));
  for (const image of images) {
    const bytes = await fs.readFile(image);
    const lower = image.toLowerCase();
    if ((lower.endsWith('.jpg') || lower.endsWith('.jpeg')) && jpegHasGpsExif(bytes)) {
      addViolation(violations, image, 1, '이미지에 GPS EXIF 정보가 남아 있습니다.');
    }
    if (lower.endsWith('.png') && pngHasExif(bytes)) {
      addViolation(violations, image, 1, 'PNG 이미지에 eXIf 청크가 남아 있습니다.');
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
  const repoRoot = path.resolve(args.root ?? path.dirname(contentRoot));
  const violations = [];
  try {
    const exceptionsFile = path.resolve(args.exceptions || path.join(repoRoot, DEFAULT_EXCEPTIONS));
    const exceptions = await loadExceptions(exceptionsFile, violations);
    reportExceptions(exceptionsFile, exceptions);

    const markdownFiles = await walkFiles(contentRoot, (name) => name.endsWith('.md'));
    for (const file of markdownFiles) {
      const text = await fs.readFile(file, 'utf8');
      const parsed = parseFrontmatter(text);
      lintNames(file, toPosix(path.relative(repoRoot, file)), parsed, exceptions, violations);
      lintReferenceScopes(file, text, parsed.data.screening_scope, violations);
    }

    // content/ 안의 CSV 는 공개 다운로드 자산으로 나가므로 진본 자체를 검사한다.
    // 여기서 1회 걸러야 그 CSV 에서 생성되는 문서 N개가 함께 안전해진다.
    const csvFiles = await walkFiles(contentRoot, (name) => name.toLowerCase().endsWith('.csv'));
    for (const file of csvFiles) {
      const text = await fs.readFile(file, 'utf8');
      lintCsvCells(file, toPosix(path.relative(repoRoot, file)), text, exceptions, violations);
    }

    await lintImages(repoRoot, violations);
  } catch (error) {
    console.error(`개인정보 점검 중 오류가 발생했습니다: ${error.message}`);
    process.exit(1);
  }

  for (const violation of violations) console.error(violation);
  if (violations.length > 0) process.exit(1);
}

await main();
