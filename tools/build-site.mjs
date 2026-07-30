#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

const TMP_DATA = ".catalog-tmp"
const PUBLIC = "public"

if (process.argv.includes("--help")) {
  console.log(`로컬 전체 빌드 (CI 와 같은 순서)

사용법:
  node tools/build-site.mjs [--serve]

순서:
  검증 → 개인정보 검사 → 카탈로그 생성 → quartz 빌드 → 산출물 복사 → 확인`)
  process.exit(0)
}

const QUARTZ_CLI = "./quartz/bootstrap-cli.mjs"

function step(label, args) {
  console.log(`\n▶ ${label}`)
  const r = spawnSync(process.execPath, args, { stdio: "inherit" })
  if (r.status !== 0) {
    console.error(`\n✖ 실패: ${label}`)
    process.exit(r.status ?? 1)
  }
}

step("데이터 표준 검증", ["tools/validate-frontmatter.mjs"])
step("개인정보 검사", ["tools/lint-pii.mjs"])
step("카탈로그 생성", [
  "tools/build-catalog.mjs",
  "--content", "content",
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

if (!ok) process.exit(1)

rmSync("content/_generated", { recursive: true, force: true })
rmSync(TMP_DATA, { recursive: true, force: true })

console.log(`\n완료 — ${PUBLIC}/ 에 사이트가 생성되었습니다.`)
if (process.argv.includes("--serve")) {
  step("미리보기", [QUARTZ_CLI, "build", "--serve"])
}
