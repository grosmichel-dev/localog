import fs from 'node:fs/promises';
import path from 'node:path';

// 문서가 가리키는 원본·이미지가 실제로 발행됐는지 확인한다.
//
// 소스(content/*.md)가 아니라 빌드 산출물(public/*.html)의 href 를 본다.
// Quartz 가 링크를 다시 쓰기 때문이다 — 예컨대 ASCII 대문자를 소문자로 바꾼다.
// 그래서 파일이 복사돼 있어도 링크는 404 가 될 수 있고, 소스만 봐서는 그걸 못 잡는다.
// 브라우저가 실제로 요청할 주소를 그대로 검사해야 한다.

function usage() {
  return `발행된 참조 검사기

사용법:
  node tools/check-published-refs.mjs [--public public]

검사 내용:
  public/ 의 HTML 이 가리키는 originals/·assets/ 파일이 실제로 있는지
`;
}

function parseArgs(argv) {
  const args = { public: 'public', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
    else if (argv[i] === '--public') {
      i += 1;
      if (!argv[i]) throw new Error('--public 뒤에 폴더 경로가 필요합니다.');
      args.public = argv[i];
    } else throw new Error(`알 수 없는 옵션입니다: ${argv[i]}`);
  }
  return args;
}

async function walk(root, predicate) {
  const found = [];
  async function step(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await step(full);
      else if (predicate(entry.name)) found.push(full);
    }
  }
  await step(root);
  return found;
}

function toDisplay(file) {
  return (path.relative(process.cwd(), file) || file).split(path.sep).join('/');
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

  const publicRoot = path.resolve(args.public);
  const pages = await walk(publicRoot, (name) => name.endsWith('.html'));
  const missing = [];
  let checked = 0;

  for (const page of pages) {
    const html = await fs.readFile(page, 'utf8');
    const pageDir = path.dirname(page);
    for (const match of html.matchAll(/href="([^"]*(?:originals|assets)\/[^"]+)"/g)) {
      const href = match[1];
      if (/^https?:\/\//.test(href)) continue;
      const decoded = decodeURIComponent(href.split('#')[0].split('?')[0]);
      const target = path.resolve(pageDir, decoded);
      checked += 1;
      try {
        await fs.access(target);
      } catch {
        missing.push(`${toDisplay(page)} → ${decoded}`);
      }
    }
  }

  if (missing.length > 0) {
    console.error('::error::문서가 가리키는 원본·이미지가 발행되지 않았습니다. 링크가 404 가 됩니다.');
    for (const line of missing) console.error(`  ${line}`);
    console.error('originals/·assets/ 가 public/ 로 복사됐는지, 파일 이름에 대문자가 섞이지 않았는지 확인하세요.');
    process.exit(1);
  }

  console.log(`발행된 참조 확인 완료: ${checked}건`);
}

await main();
