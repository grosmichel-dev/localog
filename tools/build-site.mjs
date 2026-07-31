#!/usr/bin/env node
import { spawnSync, execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { join, relative, resolve, basename } from "node:path"
import { parseFrontmatter, toPosix } from "./lib/budget.mjs"

const TMP_DATA = ".catalog-tmp"
const PUBLIC = "public"
const CONTENT = "content"
const PAIRS = join(TMP_DATA, "budget-pairs.json")
const MANIFEST = join(TMP_DATA, "budget-manifest.json")

if (process.argv.includes("--help")) {
  console.log(`로컬 전체 빌드 (CI 와 같은 순서)

사용법:
  node tools/build-site.mjs [--serve]

순서:
  stale 정리 → 검증 → 개인정보 검사 → 예산 CSV 검증 → 예산 페이지 생성
  → 카탈로그 생성 → quartz 빌드 → 산출물 복사 → 확인 → 생성물 정리

생성된 예산 페이지는 저장소에 남기지 않는다. 빌드가 실패해도 정리는 실행된다.`)
  process.exit(0)
}

const QUARTZ_CLI = "./quartz/bootstrap-cli.mjs"

// ★ process.exit 를 쓰지 않는다. exit 는 finally 를 건너뛰어서
//   "실패했을 때 정리가 안 되는" 정확히 그 상황을 만든다.
function step(label, args) {
  console.log(`\n▶ ${label}`)
  const r = spawnSync(process.execPath, args, { stdio: "inherit" })
  if (r.status !== 0) throw new Error(`실패: ${label} (종료코드 ${r.status ?? 1})`)
}

function walkMarkdown(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === "ENOENT") return out
    throw error
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkMarkdown(full, out)
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full)
  }
  return out
}

function trackedFiles() {
  try {
    const out = execFileSync("git", ["ls-files", CONTENT], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    return new Set(out.split(/\r?\n/).filter(Boolean).map((line) => toPosix(line).normalize("NFC")))
  } catch {
    // git 을 못 쓰면 "추적 중일 수도 있다"고 보고 삭제를 막는다(안전한 쪽으로).
    return null
  }
}

/**
 * 이전 실행이 비정상 종료해 남은 생성 노트를 지운다.
 * ★검증기보다 먼저 돌아야 한다 — 남아 있는 stale 노트를 검증기가 먼저 검사해
 *   엉뚱한 실패를 내기 때문이다.
 * ★삭제는 최대한 보수적으로. sentinel 이 하나라도 어긋나면 지우지 않고 중단한다.
 *   빌드가 사람 파일을 지우느니 빌드가 실패하는 편이 낫다.
 */
function staleSweep() {
  console.log("\n▶ 이전 생성물 정리")
  const tracked = trackedFiles()
  const files = walkMarkdown(CONTENT)
  const removed = []
  const blocked = []

  for (const file of files) {
    const text = readFileSync(file, "utf8")
    const { data } = parseFrontmatter(text)
    if (String(data.generated ?? "") !== "true") continue

    const rel = toPosix(file).normalize("NFC")
    const reasons = []
    if (data.generated_by !== "build-budget-pages") reasons.push(`generated_by 가 build-budget-pages 가 아님(${data.generated_by ?? "없음"})`)
    if (!data.source_csv) reasons.push("source_csv 없음")
    if (!data.source_meta) reasons.push("source_meta 없음")
    if (!/^\d{4}-\d{2}-\d{2}-.+\.md$/.test(basename(file))) reasons.push("생성기 명명 규칙과 다름")
    if (tracked === null) reasons.push("git 상태를 확인할 수 없어 추적 여부를 판단할 수 없음")
    else if (tracked.has(rel)) reasons.push("git 이 추적 중인 파일")

    if (reasons.length > 0) blocked.push(`  ${rel} — ${reasons.join(" / ")}`)
    else {
      rmSync(file, { force: true })
      removed.push(rel)
    }
  }

  if (blocked.length > 0) {
    console.error("generated: true 이지만 안전 조건을 만족하지 않아 삭제하지 않았습니다:")
    for (const line of blocked) console.error(line)
    throw new Error("생성물로 보이는 파일을 안전하게 지울 수 없습니다. 위 파일을 직접 확인하세요.")
  }
  console.log(removed.length > 0 ? `  ${removed.length}개 정리` : "  정리할 파일 없음")
}

let generated = []
let validatedPairs = []

try {
  staleSweep()

  step("데이터 표준 검증", ["tools/validate-frontmatter.mjs"])
  step("개인정보 검사", ["tools/lint-pii.mjs"])

  step("예산 CSV 검증", [
    "tools/validate-budget-csv.mjs",
    "--content", CONTENT,
    "--pairs-out", PAIRS,
  ])
  validatedPairs = existsSync(PAIRS) ? JSON.parse(readFileSync(PAIRS, "utf8")) : []

  if (validatedPairs.length > 0) {
    // ★카탈로그 생성보다 반드시 먼저. 순서가 뒤집히면 예산 문서가
    //   catalog.csv / llms.txt 에 실리지 않아 AI 가 자료를 찾지 못한다.
    step("예산 페이지 생성", [
      "tools/build-budget-pages.mjs",
      "--content", CONTENT,
      "--pairs-in", PAIRS,
      "--manifest", MANIFEST,
    ])
    generated = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : []
  } else {
    console.log("\n▶ 예산 페이지 생성\n  대상 없음")
  }

  step("카탈로그 생성", [
    "tools/build-catalog.mjs",
    "--content", CONTENT,
    "--page-out", "content/_generated/catalog.md",
    "--data-out", TMP_DATA,
  ])
  step("Quartz 빌드", [QUARTZ_CLI, "build"])

  console.log("\n▶ 산출물 복사")
  for (const f of ["llms.txt", "catalog.csv"]) {
    cpSync(join(TMP_DATA, f), join(PUBLIC, f))
  }
  if (existsSync("static")) {
    mkdirSync(join(PUBLIC, "static"), { recursive: true })
    cpSync("static", join(PUBLIC, "static"), { recursive: true })
  }

  // 예산 CSV 다운로드 발행 폴백.
  // Quartz 가 content/ 의 비마크다운을 자산으로 내보내지만 이 저장소 구성에서 확정 검증된 바 없어,
  // 없으면 직접 복사한다. ★복사 대상은 검증을 통과한 쌍 목록뿐이다 —
  //   목록 밖 CSV 를 복사하면 서명 없는 원본을 공개하게 된다.
  const contentAbs = resolve(CONTENT)
  const publishedCsv = []
  for (const pair of validatedPairs) {
    const rel = relative(contentAbs, resolve(pair.csv))
    const target = join(PUBLIC, rel)
    if (!existsSync(target)) {
      mkdirSync(join(target, ".."), { recursive: true })
      cpSync(resolve(pair.csv), target)
      console.log(`  복사 ${toPosix(rel)} (Quartz 자동 발행 없음)`)
    }
    publishedCsv.push(target)
  }

  console.log("\n▶ 확인")
  const required = [
    join(PUBLIC, "llms.txt"),
    join(PUBLIC, "catalog.csv"),
    join(PUBLIC, "static", "prompt-generator.html"),
  ]
  const catalogPage = [
    join(PUBLIC, "_generated", "catalog.html"),
    join(PUBLIC, "_generated", "catalog", "index.html"),
  ]

  let ok = true
  for (const f of required) {
    if (existsSync(f)) console.log(`  OK   ${f}`)
    else { console.error(`  없음 ${f}`); ok = false }
  }
  if (catalogPage.some((f) => existsSync(f))) console.log(`  OK   카탈로그 페이지`)
  else { console.error(`  없음 카탈로그 페이지`); ok = false }

  const csvHeader = readFileSync(join(PUBLIC, "catalog.csv"), "utf8").split("\n")[0]
  if (csvHeader.includes("source_commit")) console.log("  OK   catalog.csv 신선도 열")
  else { console.error("  없음 catalog.csv 의 source_commit 열"); ok = false }

  for (const target of publishedCsv) {
    if (existsSync(target)) console.log(`  OK   ${toPosix(relative(PUBLIC, target))} (다운로드)`)
    else { console.error(`  없음 예산 CSV 다운로드: ${target}`); ok = false }
  }
  if (generated.length > 0) {
    // 카탈로그에는 파일명이 아니라 doc_id 가 들어간다. 생성 노트에서 doc_id 를 읽어 대조한다.
    // (생성 노트는 아직 지워지기 전이다 — 정리는 finally 에서 한다.)
    const catalogCsvText = readFileSync(join(PUBLIC, "catalog.csv"), "utf8")
    const missing = []
    for (const file of generated) {
      const { data } = parseFrontmatter(readFileSync(file, "utf8"))
      const docId = String(data.doc_id ?? "")
      if (!docId || !catalogCsvText.includes(docId)) missing.push(`${basename(file)} (doc_id: ${docId || "없음"})`)
    }
    if (missing.length === 0) console.log(`  OK   예산 페이지 ${generated.length}개가 카탈로그에 실림`)
    else {
      console.error(`  없음 카탈로그에 빠진 예산 페이지 ${missing.length}개 — 생성 단계가 카탈로그 생성보다 뒤에 있는지 확인하세요:`)
      for (const item of missing) console.error(`       ${item}`)
      ok = false
    }
  }

  if (!ok) throw new Error("산출물 확인 실패")

  console.log(`\n완료 — ${PUBLIC}/ 에 사이트가 생성되었습니다.`)
} catch (error) {
  console.error(`\n✖ ${error.message}`)
  process.exitCode = 1
} finally {
  // ★성공·실패 양쪽에서 반드시 실행된다. 생성 노트가 추적 디렉터리에 남으면
  //   git status 를 오염시키고 실수 커밋 위험을 만든다.
  for (const file of generated) rmSync(file, { force: true })
  rmSync("content/_generated", { recursive: true, force: true })
  rmSync(TMP_DATA, { recursive: true, force: true })
}

if (process.exitCode === undefined && process.argv.includes("--serve")) {
  step("미리보기", [QUARTZ_CLI, "build", "--serve"])
}
