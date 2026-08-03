import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

// 저장소가 "type": "module" 이라 require 는 죽는다. 파서는 이미 있는 yaml 패키지를 쓴다.
// 수제 파서(parseFrontmatter·parseSimpleYaml)는 중첩을 못 다뤄 레지스트리에 쓸 수 없다.

export const DATE_FIELDS = [
  'posting_starts_at',
  'posting_ends_at',
  'application_starts_at',
  'application_deadline',
  'event_starts_at',
  'event_ends_at',
];

const DOC_ID_MODES = new Set(['official', 'internal']);
const ARCHIVE_MODES = new Set(['required', 'optional', 'none']);

function asArray(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

// 오타 하나(requred_dates)로 강제가 통째로 사라지고 아무도 모르는 상황을 막는다.
function validateRule(where, folder, rule) {
  if (!rule || typeof rule !== 'object') {
    throw new Error(`${where} 의 분류 '${folder}' 가 비어 있거나 객체가 아닙니다.`);
  }
  if (!rule.source_type || typeof rule.source_type !== 'string') {
    throw new Error(`${where} 의 분류 '${folder}' 에 source_type 이 없습니다.`);
  }
  if (rule.doc_id !== undefined && !DOC_ID_MODES.has(rule.doc_id)) {
    throw new Error(`${where} 의 분류 '${folder}' 의 doc_id 는 official|internal 이어야 합니다. 현재: ${rule.doc_id}`);
  }
  if (rule.archive !== undefined && !ARCHIVE_MODES.has(rule.archive)) {
    throw new Error(`${where} 의 분류 '${folder}' 의 archive 는 required|optional|none 이어야 합니다. 현재: ${rule.archive}`);
  }

  const dates = asArray(rule.dates);
  const requiredDates = asArray(rule.required_dates);

  for (const [key, list] of [['dates', dates], ['required_dates', requiredDates]]) {
    for (const field of list) {
      if (!DATE_FIELDS.includes(field)) {
        throw new Error(
          `${where} 의 분류 '${folder}' 의 ${key} 에 알 수 없는 날짜 필드가 있습니다: ${field}\n` +
            `쓸 수 있는 값: ${DATE_FIELDS.join(', ')}`,
        );
      }
    }
  }

  // 템플릿에 없는 칸을 필수로 걸면 기여자는 존재조차 모르는 필드 때문에 막힌다.
  for (const field of requiredDates) {
    if (!dates.includes(field)) {
      throw new Error(
        `${where} 의 분류 '${folder}' 의 required_dates 는 dates 의 부분집합이어야 합니다. ` +
          `dates 에 없는 값: ${field}`,
      );
    }
  }
}

async function loadMunicipality(file, where) {
  const raw = await fs.readFile(file, 'utf8');
  const parsed = parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${where} 를 읽었지만 분류가 하나도 없습니다.`);
  }

  const bySourceType = new Map();
  for (const [folder, rule] of Object.entries(parsed)) {
    validateRule(where, folder, rule);
    // source_type 유일성은 지자체 파일 안에서만 요구한다.
    // 유성구도 '고시공고' 를 쓸 수 있어야 하므로 전역 유일성은 강제하지 않는다.
    const seen = bySourceType.get(rule.source_type);
    if (seen) {
      throw new Error(
        `${where} 에서 source_type '${rule.source_type}' 이 중복됩니다: '${seen}' 와 '${folder}'`,
      );
    }
    bySourceType.set(rule.source_type, folder);
  }
  return parsed;
}

export async function loadCategories(root = 'config/categories') {
  const abs = path.resolve(root);
  const registry = {};

  let sidoEntries;
  try {
    sidoEntries = await fs.readdir(abs, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`분류 레지스트리 폴더가 없습니다: ${root}`);
    }
    throw error;
  }

  for (const sidoEntry of sidoEntries) {
    if (!sidoEntry.isDirectory()) continue;
    const sido = sidoEntry.name;
    const sidoDir = path.join(abs, sido);
    const files = await fs.readdir(sidoDir, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile()) continue;
      if (!file.name.endsWith('.yaml') && !file.name.endsWith('.yml')) continue;
      const sigungu = file.name.replace(/\.ya?ml$/, '');
      const full = path.join(sidoDir, file.name);
      const where = `${sido}/${file.name}`;
      registry[sido] = registry[sido] ?? {};
      registry[sido][sigungu] = await loadMunicipality(full, where);
    }
  }

  return registry;
}

export function lookupCategory(registry, sido, sigungu, folder) {
  return registry?.[sido]?.[sigungu]?.[folder] ?? null;
}

export function allSourceTypes(registry, sido, sigungu) {
  const municipality = registry?.[sido]?.[sigungu];
  if (!municipality) return new Set();
  return new Set(Object.values(municipality).map((rule) => rule.source_type));
}
