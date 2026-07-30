# 옵시디언 설정 (OBSIDIAN-SETUP)

localog의 콘텐츠 작성 도구는 옵시디언 하나입니다. 아래대로 한 번만 설정하면 됩니다.

## 1. 볼트 열기

1. 옵시디언 실행 → "Open folder as vault" → `localog/` 폴더(저장소 루트)를 선택합니다.
2. `.obsidian/` 설정 폴더는 `.gitignore`에 있어 커밋되지 않습니다. 개인 설정이라, 공유하면 서로 덮어쓰기 때문입니다.

## 2. 필수 설정 켜기

- 설정 → Files & Links → **"Automatically update internal links"(파일 이름 변경 시 링크 자동 업데이트)를 켭니다.**
  위키링크(`[[ ]]`)는 파일 이름으로 문서를 찾으므로, 이 설정이 꺼진 채 이름을 바꾸면 링크가 조용히 끊어집니다.

## 3. Git 연결 (둘 중 하나)

| 방법 | 이런 분에게 | 요령 |
|---|---|---|
| Obsidian Git 플러그인 | 옵시디언 안에서 끝내고 싶을 때 | 커뮤니티 플러그인에서 설치. 커밋·푸시를 명령 팔레트로 실행. **반드시 작업 브랜치에서** |
| git CLI (터미널) | 터미널이 익숙할 때 | `git checkout -b 브랜치명`으로 브랜치를 만든 뒤 평소처럼 커밋·푸시 |

## 4. 새 문서 템플릿

새 문서는 아래 프론트매터로 시작합니다. 옵시디언 템플릿 노트로 저장해 두면 편합니다.
필드 규칙의 정본은 `docs/DATA-STANDARD.md`입니다.

```markdown
---
title: 
date: 
department: 
source_type: 
keywords: []
source_url: 
archive_url: 
doc_id: 
관련근거: []
review_status: draft
pii_screened_by: 
screened_at: 
screening_scope: 
---
```

- `review_status: draft`로 시작합니다. 원문 대조·마스킹을 마친 사람만 `screened`로 바꿉니다. 절차는 `docs/SCREENING_SOP.md`.
- `archive_url`과 `doc_id`는 고시공고·구청 공지사항에서 필수입니다. 회의록이면 `doc_id`를 내부 형식(`YYYY-MM-DD-<분류>-NN`)으로 만듭니다.

## 5. 반드시 지킬 것: main에 직접 커밋 금지

콘텐츠 변경은 언제나 **브랜치 → PR → CI 통과 → 병합** 순서입니다. Obsidian Git을 쓰더라도 브랜치에서 작업하세요.
main 직접 푸시는 저장소 보호 규칙이 거부합니다. 전체 흐름은 `docs/COMMIT-FLOW.md`.
