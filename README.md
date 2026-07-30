# localog

이미 공개된 지역 행정자료(회의록·공고·고시)를 한곳에 모아, **누구나 자기 AI로 물어볼 수 있게** 정리하는 비영리 시민 아카이브.

- 사람용 사이트: https://grosmichel-dev.github.io/localog
- AI용 카탈로그: https://grosmichel-dev.github.io/localog/llms.txt

첫 대상은 **대전시 대덕구**(구청·구의회)이며, 지역은 폴더로 늘려 갑니다.

---

## 원칙

- **원문 그대로** — 요약·각색하지 않습니다. 해석은 보는 사람의 몫.
- **무료** — 보는 사람도 참여하는 사람도 비용이 들지 않습니다.
- **비영리·정치 중립** — 감시나 홍보가 아니라 "자료는 있는 그대로".

---

## 저장소 구조

```
content/           마크다운 문서 (이것이 진본)
└─ 대전시/대덕구/{구청공지사항,고시공고,구청장회의,구의회회의록}/
originals/         검토·마스킹을 마친 원본 (hwp·pdf)
assets/            이미지 (EXIF 제거본)
static/            시민용 정적 페이지 (프롬프트 생성기 등)
tools/             검증·카탈로그 생성 스크립트
docs/              데이터 표준·운영 규칙
```

**저장소에 없는 것**: 카탈로그(`llms.txt`·`catalog.csv`)는 GitHub Actions가 배포할 때마다 새로 만들어 **사이트에만** 올립니다. 저장소에 커밋하지 않습니다.

**저장소 밖에 있는 것**: 구글폼으로 들어온 미검토 원본과 AI 변환 지침은 로컬 `inbox/` 폴더에 둡니다. 개인정보가 섞여 있을 수 있어 **공개 저장소에 절대 올리지 않습니다.**

---

## 문서 추가하는 법

1. 옵시디언으로 `localog` 폴더를 열고 (`docs/OBSIDIAN-SETUP.md`)
2. `docs/DATA-STANDARD.md` 형식에 맞춰 마크다운 작성
3. 개인정보 마스킹 후 서명 필드 채우기 (`docs/SCREENING_SOP.md`)
4. 브랜치 → PR → 검사 통과 → 병합 (`docs/COMMIT-FLOW.md`)

병합되면 사이트와 카탈로그가 자동으로 갱신됩니다.

---

## 로컬에서 실행

```bash
npm ci
node tools/build-site.mjs    # 전체 빌드 (CI 와 같은 순서)
node tools/run-tests.mjs     # 검증 스크립트 테스트
```

`build-site.mjs` 는 검증 → 개인정보 검사 → 카탈로그 생성 → 사이트 빌드 → 산출물 확인까지 한 번에 하고, 끝나면 생성물을 지워 작업 폴더를 깨끗하게 둡니다.

Node 24 기준입니다(`.node-version`).

---

## 기반

사이트 생성은 [Quartz](https://quartz.jzhao.xyz) v5를 사용합니다(버전 고정, `LICENSE.txt`). 업그레이드는 의도적으로 수동 진행합니다.

법적 근거와 정정·삭제 요청은 `content/legal.md`(사이트에도 게시), 운영 규칙은 `GOVERNANCE.md`를 보세요.
