# 도메인 전환 체크리스트 (DOMAIN-MIGRATION)

구청 제공 도메인(또는 자체 도메인)이 확정되는 날 이 체크리스트대로 진행합니다.
**실제 DNS·CNAME 전환은 현재 범위 밖입니다.** 이 문서는 그날을 위한 준비물입니다.

- 현재 주소: `https://grosmichel-dev.github.io/localog`
- 새 주소: (작성 필요: 확정 도메인)

## 1. URL 리터럴 일괄 교체 대상

사이트 주소가 글자로 박혀 있는 곳을 전부 바꿔야 합니다. 하나라도 빠지면 옛 주소를 안내하는 화면이 남습니다.

- [ ] 기본 프롬프트 템플릿 (사용법 페이지의 복붙 문장에 든 카탈로그 링크)
- [ ] GitMCP 가이드 (github.io 주소를 gitmcp.io로 바꿔 쓰는 안내문)
- [ ] 배포 워크플로 (`.github/workflows/` 안의 사이트 주소·baseUrl 설정)
- [ ] 카탈로그 생성기가 찍는 `llms.txt` / `catalog.csv`의 `pages_url` 값
- [ ] `AI-ENTRY.md` 포인터 (Pages의 `llms.txt`를 가리키는 링크)

## 2. CNAME 플러그인 켜기

- [ ] `quartz.config.yaml`에서 `@quartz-community/cname` 플러그인을 `false`에서 활성으로 바꾸고 새 도메인을 넣습니다.
- 지금 일부러 `false`로 둔 이유: 프로젝트 페이지(`github.io/localog`) 상태에서 CNAME 파일이 생기면 사이트가 깨지기 때문입니다.

## 3. 전환 후 검증

- [ ] 새 도메인으로 사이트와 `llms.txt` / `catalog.csv`가 200으로 열린다.
- [ ] **옛 github.io 주소가 새 도메인으로 301 리다이렉트된다.**
      (GitHub Pages는 custom domain을 설정하면 자동으로 리다이렉트합니다. `curl -I 옛주소`로 `301` + `Location:` 헤더를 확인)
- [ ] 이미 배포된 프롬프트나 다른 사이트에 남은 옛 링크가 끊기지 않았는지 확인한다.
      (시민의 AI가 저장해 둔 링크가 깨지면 신뢰가 상합니다)
- [ ] GitMCP 경로를 새 주소 기준으로 다시 검증한다.

## 4. 범위 밖 (지금 하지 않음)

- 실제 DNS 신청·전환 작업
- 도메인 계약·비용 협의 (구청과의 협의 사항)
