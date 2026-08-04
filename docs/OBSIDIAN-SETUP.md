# 옵시디언 설정 (OBSIDIAN-SETUP)

localog의 콘텐츠 작성 도구는 옵시디언 하나입니다. 아래대로 한 번만 설정하면 됩니다.

## 1. 볼트 열기

1. 옵시디언 실행 → "Open folder as vault" → `localog/` 폴더(저장소 루트)를 선택합니다.
2. `.obsidian/` 설정 폴더는 `.gitignore`에 있어 커밋되지 않습니다. 개인 설정이라, 공유하면 서로 덮어쓰기 때문입니다.

### `index.md` 가 폴더마다 있는 건 정상입니다

`content/` 안에 `index.md` 가 여러 개 보입니다. 폴더마다 하나씩 있는 게 맞습니다 —
그 폴더의 **안내 페이지**이고, 이게 있어야 사이트에서 그 폴더가 목록 페이지로 만들어집니다.
파일 이름이 겹쳐도 괜찮습니다. 검증기도 `index.md` 는 이름 중복 검사에서 빼 둡니다.

> **⚠️ 다만 기록 문서를 `index.md` 로 만들면 절대 안 됩니다.**
> `index.md` 는 "안내 페이지"로 분류돼 **날짜·부서·출처·서명 검사를 통째로 건너뜁니다.**
> 실제 자료를 그 이름으로 저장하면 아무 검증 없이 공개됩니다.
> 기록 문서는 반드시 `YYYY-MM-DD-<식별어>.md` 형식으로 만드세요.

옵시디언에서 `index` 가 여러 개라 헷갈리면, 빠른 전환기(`Ctrl+O`)는 폴더 경로까지 함께 보여 주므로
그걸로 구분하면 됩니다.

## 2. 필수 설정 켜기

- 설정 → Files & Links → **"Automatically update internal links"(파일 이름 변경 시 링크 자동 업데이트)를 켭니다.**
  위키링크(`[[ ]]`)는 파일 이름으로 문서를 찾으므로, 이 설정이 꺼진 채 이름을 바꾸면 링크가 조용히 끊어집니다.

- 설정 → Files & Links → **"Excluded files"(제외된 파일)** 에 아래 5개를 한 줄씩 추가합니다.

  ```
  node_modules
  public
  quartz
  .quartz
  tools
  ```

  **왜 필요한가**: 볼트가 저장소 루트라 옵시디언이 `node_modules` 안에 있는 패키지 README 수천 개까지
  전부 읽습니다(옵시디언은 `.gitignore`를 보지 않습니다). 그러면 그래프뷰가 README로 뒤덮이고,
  검색 결과가 오염되고, 무엇보다 **`[[` 를 칠 때 패키지 문서가 후보로 떠서 잘못 연결하게 됩니다.**

  **안심해도 되는 이유**: 파일을 지우는 게 아니라 옵시디언이 안 보게 하는 것뿐입니다.
  이 설정은 `.obsidian/`에 저장되고 `.gitignore`로 차단되므로 **저장소·사이트·다른 기여자에게 아무 영향이 없습니다.**
  `npm`도 빌드도 그대로 돌아갑니다.

  **한계**: 그래프·검색·자동완성에서는 사라지지만 인덱싱 자체는 계속돼 시작이 조금 느릴 수 있습니다.
  많이 답답하면 볼트를 `content/` 폴더로 좁히는 방법이 있으나, 그러면 이 문서(`docs/`)를
  옵시디언에서 볼 수 없고 Obsidian Git 연결도 다시 잡아야 합니다.

## 3. Git 연결 (둘 중 하나)

| 방법 | 이런 분에게 | 요령 |
|---|---|---|
| Obsidian Git 플러그인 | 옵시디언 안에서 끝내고 싶을 때 | 커뮤니티 플러그인에서 설치. 커밋·푸시를 명령 팔레트로 실행. **반드시 작업 브랜치에서** |
| git CLI (터미널) | 터미널이 익숙할 때 | `git checkout -b 브랜치명`으로 브랜치를 만든 뒤 평소처럼 커밋·푸시 |

## 4. 새 문서 템플릿 (종류별 4종)

문서 종류마다 채울 필드가 다릅니다. 아래 4종을 옵시디언 템플릿 노트로 저장해 두고,
만들려는 문서에 맞는 것을 복사해 값만 채우세요. 필드 규칙의 정본은 `docs/DATA-STANDARD.md`,
분류별 정책의 정본은 `config/categories/<시도>/<시군구>.yaml`입니다.

공통 규칙:

- `review_status: draft`로 시작합니다. 원문 대조·마스킹을 마친 사람만 `screened`로 바꿉니다. 절차는 `docs/SCREENING_SOP.md`.
- `#`로 시작하는 줄은 안내용 메모입니다. 지워도 되고 그대로 둬도 됩니다. **필드 줄 뒤에 붙이지는 마세요** — 뒤에 붙이면 그 글자가 값으로 읽혀 검증이 엉뚱한 오류를 냅니다.
- `필수`라고 적힌 칸은 반드시 채웁니다. 비우면 발행이 막힙니다.
- 해당 없는 날짜 칸은 값을 지어내지 말고 비워 둡니다.

### 템플릿 1 — 게시판형·문서번호 있음 (고시공고·입찰공고)

원천 게시판에 고시공고번호가 있는 분류입니다.

```markdown
---
title: 
date: 
department: 
source_type: 고시공고
keywords: []
source_url: 
archive_url: 
# doc_id 필수 — 게시판의 고시공고번호 그대로 (예 대덕구-청년정책과-2026-0517)
doc_id: 
관련근거: []
review_status: draft
pii_screened_by: 
screened_at: 
screening_scope: 
---
```

- 입찰공고면 `source_type: 입찰공고`로 바꿉니다.
- **게재기간은 받지 않습니다.** 공고가 게시판에 걸려 있는 기간일 뿐, 신청 마감과 뜻이 다릅니다.
  신청 마감이 따로 있으면 `application_deadline` 줄을 추가하세요.

### 템플릿 2 — 게시판형·문서번호 없음 (공지사항·채용공고·행사소식·보도해명·도시계획고시공고)

원천 게시판에 문서번호가 없는 분류입니다. `doc_id`를 적지 않습니다 — **파일명이 곧 ID**가 됩니다.

```markdown
---
title: 
date: 
department: 
source_type: 공지사항
keywords: []
source_url: 
archive_url: 
관련근거: []
review_status: draft
pii_screened_by: 
screened_at: 
screening_scope: 
---
```

종류별로 고치는 것:

- **채용공고**: `source_type: 채용공고`로 바꾸고 아래 두 줄을 추가합니다.

  ```markdown
  application_starts_at: 
  # application_deadline 필수 — 게시판의 채용마감일 그대로
  application_deadline: 
  ```

- **행사소식**: `source_type: 행사소식`으로 바꾸고 아래 세 줄을 추가합니다.
  게시판에 날짜가 안 적혀 있으면 비워 둡니다. (행사소식은 날짜가 없어도 발행됩니다)

  ```markdown
  event_starts_at: 
  event_ends_at: 
  application_deadline: 
  ```

- **보도해명 / 도시계획고시공고**: `source_type`만 각각 `보도해명` / `도시계획고시공고`로 바꿉니다.
- `archive_url`은 공지사항·채용공고·도시계획고시공고에서 필수입니다. (행사소식·보도해명은 선택)
  웹아카이브가 불가능했다면 `docs/DATA-STANDARD.md` §5-2의 탈출구 3종 세트를 대신 적으세요.

### 템플릿 3 — 회의록형 (구청장회의·구의회회의록)

```markdown
---
title: 
date: 
department: 
source_type: 구의회 회의록
keywords: []
source_url: 
transcript_source: youtube-auto-caption
관련근거: []
review_status: draft
pii_screened_by: 
screened_at: 
screening_scope: 
---

> 이 문서는 공식 회의록이 아니라 공개 영상·자동자막을 바탕으로 만든 시민 전사본입니다.
> 의미 확인이 필요하면 원문 영상 또는 공식 회의록을 우선합니다.

## 안건 1: (안건 제목) {#파일명-a01}

(발언 내용)

## 정정 표

| # | 자막 원문 | 고친 값 | 재확인 |
|---|---|---|---|
| 1 |  |  | ☐ |
```

- 구청장회의면 `source_type: 구청장회의(유튜브)`로 바꿉니다.
- 첫머리 고지문은 **한 글자도 바꾸면 안 됩니다.** 검증기가 문자열 그대로 비교합니다.
- 안건 앵커의 `파일명` 자리에는 이 파일의 이름(.md 뺀 것)을 넣습니다.
  예: 파일이 `2026-05-14-정례회-예산심의.md`면 `{#2026-05-14-정례회-예산심의-a01}`.
  **모든 안건 헤딩에 앵커가 있어야** 발행됩니다.
- 고칠 자막이 없으면 정정 표 대신 `정정 없음` 한 줄을 적습니다.
- `screening_scope`에는 `transcript`를 포함합니다. (예: `markdown+transcript`)
- `archive_url`은 적지 않습니다. (유튜브·회의록은 보존 정책 대상이 아님)

### 템플릿 4 — 예산서형 (CSV + meta)

**⚠️ 예산서는 마크다운 문서를 손으로 만들지 않습니다.** 표가 본질인 자료라서
`.csv`(진본)와 `.meta.yaml`(분할 규칙 + 사람 서명) 두 파일만 커밋하면, 문서는 빌드가 자동으로 만듭니다.
손으로 만든 `.md`가 커밋되면 CI가 잡아냅니다.

파일 규약은 `docs/BUDGET-CSV-SPEC.md`, 실제 작업 절차는 `docs/BUDGET-HOWTO.md`를 따르세요.

## 5. 반드시 지킬 것: main에 직접 커밋 금지

콘텐츠 변경은 언제나 **브랜치 → PR → CI 통과 → 병합** 순서입니다. Obsidian Git을 쓰더라도 브랜치에서 작업하세요.
main 직접 푸시는 저장소 보호 규칙이 거부합니다. 전체 흐름은 `docs/COMMIT-FLOW.md`.
