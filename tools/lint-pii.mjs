import fs from 'node:fs/promises';
import path from 'node:path';

const MASK_PATTERN = /\[REDACTED_(?:성명|연락처)\]/g;
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
  node tools/lint-pii.mjs [--content content] [--root .]

검사 내용:
  - 개인정보 단서 주변의 마스킹되지 않은 한국어 성명 후보
  - originals/assets 참조와 screening_scope 불일치
  - assets 안 이미지의 GPS EXIF 또는 PNG eXIf 잔존 여부
`;
}

function parseArgs(argv) {
  const args = { content: 'content', root: null, help: false };
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

function likelyPersonalName(line, token, start, end) {
  const tokenWithoutHonorific = namePart(token);
  if (tokenWithoutHonorific.length < 2 || tokenWithoutHonorific.length > 4) return '';
  if (NON_NAME_TOKENS.has(tokenWithoutHonorific)) return '';
  if (!startsWithKnownSurname(tokenWithoutHonorific)) return '';
  if (!hasStrongPiiSignal(line, token, start, end)) return '';
  return tokenWithoutHonorific;
}

function lintNames(file, parsed, violations) {
  const lines = parsed.body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const originalLine = lines[index];
    const line = originalLine.replace(MASK_PATTERN, ' '.repeat(18));
    const candidates = line.matchAll(/[가-힣]{2,4}/g);
    for (const match of candidates) {
      const token = match[0];
      const start = match.index ?? 0;
      const end = start + token.length;
      if (isPublicOfficialContext(line, start, end)) continue;
      const name = likelyPersonalName(line, token, start, end);
      if (!name) continue;
      addViolation(violations, file, parsed.bodyStartLine + index, `마스킹되지 않은 개인정보 후보가 있습니다: ${name}`);
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
    const markdownFiles = await walkFiles(contentRoot, (name) => name.endsWith('.md'));
    for (const file of markdownFiles) {
      const text = await fs.readFile(file, 'utf8');
      const parsed = parseFrontmatter(text);
      lintNames(file, parsed, violations);
      lintReferenceScopes(file, text, parsed.data.screening_scope, violations);
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
