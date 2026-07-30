import fs from 'node:fs/promises';
import path from 'node:path';

const REQUIRED_FILES = ['GOVERNANCE.md', 'docs/SCREENING_SOP.md', 'docs/source-availability-check.md'];

function usage() {
  return `거버넌스 문서 점검기

사용법:
  node tools/gate-check.mjs [--root .]

필수 문서:
  - GOVERNANCE.md
  - docs/SCREENING_SOP.md
  - docs/source-availability-check.md

각 문서는 공백을 제외한 실제 내용이 200자 이상이어야 합니다.
`;
}

function parseArgs(argv) {
  const args = { root: '.', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--root') {
      i += 1;
      if (!argv[i]) throw new Error('--root 뒤에 저장소 경로가 필요합니다.');
      args.root = argv[i];
    } else {
      throw new Error(`알 수 없는 옵션입니다: ${arg}`);
    }
  }
  return args;
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

  const root = path.resolve(args.root);
  const failures = [];
  for (const relative of REQUIRED_FILES) {
    const file = path.join(root, relative);
    try {
      const text = await fs.readFile(file, 'utf8');
      const realLength = text.replace(/\s/g, '').length;
      if (realLength < 200) failures.push(`${relative}: 실제 내용이 200자 미만입니다. 현재 ${realLength}자입니다.`);
    } catch (error) {
      if (error?.code === 'ENOENT') failures.push(`${relative}: 파일이 없습니다.`);
      else failures.push(`${relative}: 읽을 수 없습니다. ${error.message}`);
    }
  }

  for (const failure of failures) console.error(failure);
  if (failures.length > 0) process.exit(1);
  console.log('거버넌스 문서 점검 통과');
}

await main();
