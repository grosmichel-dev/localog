// 예산 CSV 도구 공용 헬퍼.
//
// 원칙
//  - 신규 외부 의존을 만들지 않는다. 저장소에 gray-matter 가 없으므로 쓰지 않는다.
//  - 프론트매터 출력은 tools/validate-frontmatter.mjs · tools/lint-pii.mjs ·
//    tools/build-catalog.mjs 가 각자 갖고 있는 줄 기반 parseFrontmatter 가
//    그대로 읽을 수 있는 형태여야 한다(YAML 전체 문법이 아니다).
//  - CSV 값은 신뢰할 수 없는 입력이다. 문맥별 이스케이프를 거치지 않은 값을
//    본문·프론트매터에 넣지 않는다.

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * RFC4180 계열 CSV 파서.
 * - BOM 제거, CRLF/CR/LF 모두 허용
 * - 큰따옴표 안의 쉼표·개행·이스케이프된 따옴표("") 처리
 * 반환: { headers: string[], rows: Array<Record<string,string>>, rawRows: string[][] }
 */
export function parseCsv(text) {
  const input = String(text ?? '').replace(/^\ufeff/, '');
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  let i = 0;
  let sawAnyChar = false;

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      sawAnyChar = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      record.push(field);
      field = '';
      sawAnyChar = true;
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      record.push(field);
      records.push(record);
      field = '';
      record = [];
      sawAnyChar = false;
      i += 1;
      continue;
    }
    field += ch;
    sawAnyChar = true;
    i += 1;
  }
  if (inQuotes) throw new Error('CSV 의 큰따옴표가 닫히지 않았습니다.');
  if (field !== '' || record.length > 0 || sawAnyChar) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter((row) => row.some((cell) => cell.trim() !== ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [], rawRows: [] };

  const headers = nonEmpty[0].map((cell) => cell.trim());
  const rawRows = nonEmpty.slice(1);
  const rows = rawRows.map((cells) => {
    const row = {};
    headers.forEach((header, index) => {
      row[header] = (cells[index] ?? '').trim();
    });
    return row;
  });
  return { headers, rows, rawRows };
}

/** 헤더 무결성 검사. 문제가 있으면 사유 문자열 배열을 돌려준다(빈 배열 = 정상). */
export function headerProblems(headers) {
  const problems = [];
  if (headers.length === 0) {
    problems.push('CSV 에 헤더 행이 없습니다.');
    return problems;
  }
  const seen = new Map();
  headers.forEach((header, index) => {
    if (header === '') {
      problems.push(`${index + 1}번째 열의 헤더가 비어 있습니다.`);
      return;
    }
    if (seen.has(header)) {
      problems.push(`헤더가 중복입니다: ${header} (${seen.get(header) + 1}번째 열과 ${index + 1}번째 열)`);
      return;
    }
    seen.set(header, index);
  });
  return problems;
}

/**
 * 안정 슬러그.
 * 한글은 보존하고 공백·특수문자는 제거·치환한다.
 * `환경과 ` 와 `환경과` 는 같은 슬러그가 되며, 그 충돌은 호출부가 검사해 중단시킨다
 * (조용한 덮어쓰기 방지 — 슬러그가 알아서 구분해 주지 않는다).
 */
export function slugify(value) {
  return String(value ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[\s_/\\]+/g, '-')
    .replace(/[^0-9a-z가-힣-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** doc_id 정규형 여부 — validate-frontmatter.mjs 의 isNormalizedDocId 와 같은 규칙. */
export function isNormalizedDocId(value) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && !/[\s()（）]/.test(value)
    && !/--+/.test(value)
    && !/^-|-$/.test(value);
}

/** 한 줄짜리 안전한 스칼라로 정규화. 비면 빈 문자열. */
export function scalarText(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(CONTROL_CHARS, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * 프론트매터 스칼라 값.
 * 줄 기반 파서의 cleanValue 가 "앞뒤가 같은 따옴표면 벗겨내는" 동작을 하므로,
 * 값이 통째로 따옴표에 감싸인 것처럼 보이지 않게 앞뒤 따옴표를 제거한다.
 */
export function frontmatterScalar(value) {
  return scalarText(value).replace(/^["']+|["']+$/g, '').trim();
}

/** 인라인 배열 항목 값 — 쉼표·대괄호·따옴표는 파서를 깨뜨리므로 제거한다. */
export function frontmatterArrayItem(value) {
  return frontmatterScalar(value).replace(/[,[\]"']/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * 프론트매터 블록 생성.
 * entries = [key, value] 배열. 값이 배열이면 인라인 배열로, 비면 필드를 생략한다
 * (빈 값을 쓰면 기존 파서가 그 키를 "리스트 시작"으로 오해한다).
 */
export function emitFrontmatter(entries) {
  const lines = ['---'];
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      const items = value.map(frontmatterArrayItem).filter(Boolean);
      if (items.length === 0) continue;
      lines.push(`${key}: [${items.join(', ')}]`);
      continue;
    }
    const scalar = frontmatterScalar(value);
    if (!scalar) continue;
    lines.push(`${key}: ${scalar}`);
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * 마크다운 본문 텍스트 이스케이프.
 * - HTML 특수문자를 엔티티로 바꿔 raw HTML 로 해석될 여지를 없앤다.
 * - 대괄호를 이스케이프해 `[x](javascript:...)` 같은 링크 문법이 만들어지지 않게 한다.
 * 지금 이 저장소에는 rehype-raw 가 없어 raw HTML 이 렌더되지 않지만, 그것은
 * 의도된 방어가 아니라 부수적 성질이므로 이 이스케이프를 제거하지 말 것.
 */
export function mdText(value) {
  return scalarText(value)
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

/** 마크다운 표 셀 이스케이프 — mdText 에 더해 파이프까지 막는다. */
export function mdCell(value) {
  return mdText(value).replace(/\|/g, '\\|');
}

/**
 * 프론트매터에 들어갈 CSV 유래 값(제목·키워드) 이스케이프.
 * 프론트매터 값도 결국 페이지에 렌더되므로 꺾쇠를 그대로 두면 안 된다.
 * 다만 mdText 와 달리 대괄호·역슬래시는 건드리지 않는다 — 제목에 `\[` 가 보이면 안 되기 때문.
 * meta 에서 온 값(source_url 등)에는 쓰지 않는다. URL 의 & 가 망가진다.
 */
export function htmlSafeText(value) {
  return scalarText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 숫자 파싱. 쉼표·공백·통화기호를 제거하고 수치로 만든다.
 * 수치가 아니면 null.
 */
export function parseNumber(value) {
  const text = String(value ?? '').replace(/[,\s₩원]/g, '');
  if (text === '' || !/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

/** 열이 수치 열인지 판정 — 값이 있는 셀의 대부분이 숫자면 수치 열로 본다. */
export function isNumericColumn(rows, header) {
  let filled = 0;
  let numeric = 0;
  for (const row of rows) {
    const raw = row[header];
    if (raw === undefined || raw === '') continue;
    filled += 1;
    if (parseNumber(raw) !== null) numeric += 1;
  }
  return filled > 0 && numeric / filled >= 0.8;
}

const QUOTE_TRIM = /^["']|["']$/g;

/**
 * 최소 프론트매터 파서 — 기존 도구들의 파서와 같은 규칙.
 * stale 정리 sentinel 확인처럼 "생성기가 쓴 값을 되읽는" 용도로만 쓴다.
 */
export function parseFrontmatter(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { data: {}, body: text };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) return { data: {}, body: text };
  const data = {};
  let listKey = '';
  for (let i = 1; i < end; i += 1) {
    const line = lines[i];
    const listItem = /^\s*-\s+(.+)$/.exec(line);
    if (listItem && listKey) {
      data[listKey].push(listItem[1].trim().replace(QUOTE_TRIM, ''));
      continue;
    }
    const field = /^([^:#][^:]*):\s*(.*)$/.exec(line);
    if (!field) continue;
    const key = field[1].trim();
    const raw = field[2].trim();
    if (raw === '') {
      data[key] = [];
      listKey = key;
      continue;
    }
    listKey = '';
    if (raw.startsWith('[') && raw.endsWith(']')) {
      data[key] = raw
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(QUOTE_TRIM, ''))
        .filter(Boolean);
    } else {
      data[key] = raw.replace(QUOTE_TRIM, '');
    }
  }
  return { data, body: lines.slice(end + 1).join('\n') };
}

/**
 * 최소 YAML 파서 — `*.meta.yaml` 전용.
 * 지원: `key: 스칼라`, `key: [a, b]`, `key:` 다음 줄들의 `- item`, `#` 주석.
 * 중첩 매핑은 지원하지 않으며 발견 시 예외를 던진다(스펙이 평면 구조를 요구한다).
 */
export function parseSimpleYaml(text) {
  const data = {};
  const lines = String(text ?? '').replace(/^\ufeff/, '').split(/\r?\n/);
  let listKey = '';
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;

    const listItem = /^\s+-\s+(.+?)\s*$/.exec(rawLine);
    if (listItem) {
      if (!listKey) throw new Error(`${i + 1}번째 줄: 목록 항목의 상위 키가 없습니다.`);
      data[listKey].push(stripComment(listItem[1]).replace(QUOTE_TRIM, ''));
      continue;
    }

    if (/^\s/.test(rawLine)) {
      throw new Error(`${i + 1}번째 줄: 중첩 구조는 지원하지 않습니다. meta.yaml 은 평면 구조여야 합니다.`);
    }

    const field = /^([^:#]+):\s*(.*)$/.exec(rawLine);
    if (!field) throw new Error(`${i + 1}번째 줄을 해석할 수 없습니다: ${rawLine}`);
    const key = field[1].trim();
    const value = stripComment(field[2]);
    if (value === '') {
      data[key] = [];
      listKey = key;
      continue;
    }
    listKey = '';
    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(QUOTE_TRIM, ''))
        .filter(Boolean);
    } else {
      data[key] = value.replace(QUOTE_TRIM, '');
    }
  }
  return data;
}

function stripComment(value) {
  let out = '';
  let quote = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (!quote && (ch === '"' || ch === "'")) quote = ch;
    else if (quote && ch === quote) quote = '';
    else if (!quote && ch === '#' && /\s/.test(value[i - 1] ?? ' ')) break;
    out += ch;
  }
  return out.trim();
}

/** `{열이름}` 자리표시자를 행 값으로 치환. 참조된 열 이름 목록도 함께 돌려준다. */
export function formatTemplate(template, values) {
  const used = [];
  const text = String(template ?? '').replace(/\{([^{}]+)\}/g, (_, name) => {
    const key = name.trim();
    used.push(key);
    return values[key] ?? '';
  });
  return { text, used };
}

/** 템플릿이 참조하는 열 이름만 추출. */
export function templateColumns(template) {
  const names = [];
  const pattern = /\{([^{}]+)\}/g;
  let match;
  while ((match = pattern.exec(String(template ?? ''))) !== null) names.push(match[1].trim());
  return names;
}

export function toPosix(value) {
  return String(value ?? '').split('\\').join('/');
}

/**
 * split_by 열 기준 그룹 계산.
 * 검증기와 생성기가 **같은 함수**를 써야 "검증은 통과했는데 생성이 다르게 쪼개는" 어긋남이 없다.
 *
 * 합계행 규약(meta.total_column / meta.total_value)이 있으면:
 *  - split 값이 특정 그룹과 같은 합계행 → 그 그룹의 원문 합계행
 *  - split 값이 빈 합계행 → 전체(총괄) 원문 합계행
 * 합계행은 데이터 그룹에 포함하지 않는다.
 *
 * 반환: { groups, grandTotalRow, collisions, emptyValueCount }
 *  - collisions: 서로 다른 원본 값이 같은 슬러그로 접히는 경우(조용한 덮어쓰기 위험)
 */
export function computeGroups(rows, meta) {
  const splitBy = meta.split_by;
  const totalColumn = meta.total_column;
  const totalValue = meta.total_value;
  const hasTotalRule = Boolean(totalColumn) && Boolean(totalValue);
  const isTotalRow = (row) => hasTotalRule && String(row[totalColumn] ?? '').trim() === String(totalValue).trim();

  const totalRows = [];
  const order = [];
  const byValue = new Map();
  let emptyValueCount = 0;

  for (const row of rows) {
    if (isTotalRow(row)) {
      totalRows.push(row);
      continue;
    }
    const value = String(row[splitBy] ?? '').trim();
    if (!value) {
      emptyValueCount += 1;
      continue;
    }
    if (!byValue.has(value)) {
      byValue.set(value, []);
      order.push(value);
    }
    byValue.get(value).push(row);
  }

  const totalRowFor = (value) => totalRows.find((row) => String(row[splitBy] ?? '').trim() === value) ?? null;
  const grandTotalRow = totalRows.find((row) => String(row[splitBy] ?? '').trim() === '') ?? null;

  const groups = order.map((value) => ({
    value,
    slug: slugify(value),
    rows: byValue.get(value),
    totalRow: totalRowFor(value),
  }));

  const bySlug = new Map();
  for (const group of groups) {
    const key = group.slug || '(빈 슬러그)';
    if (!bySlug.has(key)) bySlug.set(key, []);
    bySlug.get(key).push(group.value);
  }
  const collisions = [...bySlug.entries()]
    .filter(([, values]) => values.length > 1 || values.some((value) => !slugify(value)))
    .map(([slug, values]) => ({ slug, values }));

  return { groups, grandTotalRow, totalRows, collisions, emptyValueCount };
}

/** 생성될 노트의 doc_id. 총괄 노트는 value 없이 호출한다. */
export function groupDocId(prefix, slug) {
  return slug ? `${prefix}-${slug}` : `${prefix}-총괄`;
}

/**
 * 생성될 노트의 파일명 stem. 부모 규약의 `YYYY-MM-DD-<식별어>` 형태를 지킨다.
 * CSV 이름이 `2026-세출예산` 처럼 연도로 시작하면 날짜 접두사와 겹쳐 보이므로 그 연도만 떼어낸다
 * (`2026-01-01-2026-세출예산-환경과` → `2026-01-01-세출예산-환경과`).
 * 검증기와 생성기가 같은 함수를 쓰므로 이름이 어긋날 일은 없다.
 */
export function groupStem(date, sourceStem, slug) {
  const tail = slug || '총괄';
  const base = slugify(String(sourceStem ?? '').replace(/^\d{4}-/, '')) || slugify(sourceStem);
  return `${date}-${base}-${tail}`;
}
