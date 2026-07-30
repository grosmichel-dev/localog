---
title: 커넥터로 등록하기 (숙련자용)
---

한 번만 등록해 두면 이후로는 **자동으로 최신 자료**를 읽습니다. 매번 목록을 복사·붙여넣기 하지 않아도 됩니다.

> 이건 **선택 기능**입니다. 대부분은 [[how-to|사용법]]의 방법 1만으로 충분합니다.

## 등록 주소

```
https://grosmichel-dev.gitmcp.io/localog
```

사이트 주소(`grosmichel-dev.github.io/localog`)에서 `github.io` 를 `gitmcp.io` 로 바꾼 것입니다. [GitMCP](https://gitmcp.io)라는 무료 서비스가 이 아카이브를 AI가 읽을 수 있는 형태로 바꿔 줍니다.

## 등록 방법

지원하는 AI 도구(Claude, Cursor, VS Code, Cline 등)의 **커넥터 / MCP 서버** 설정에 위 주소를 추가하면 됩니다. 도구마다 메뉴 이름이 조금씩 다릅니다.

등록하면 AI가 이 아카이브의 자료 목록(`llms.txt`)을 먼저 읽고, 필요한 문서만 그때그때 가져갑니다.

## 잘 안 될 때

GitMCP는 우리가 운영하는 서비스가 아니라 **외부 무료 서비스**입니다. 접속이 안 되거나 최신 자료가 안 보이면:

1. [[how-to|사용법]]의 **방법 1·2**(목록 주소 붙여넣기 / 전문 복사)로 쓰세요. 이 방법은 외부 서비스에 의존하지 않습니다.
2. 자료 목록은 항상 [여기](https://grosmichel-dev.github.io/localog/llms.txt)에서 직접 볼 수 있습니다.
3. 저장소를 직접 내려받아 쓰는 방법도 있습니다: [GitHub 저장소](https://github.com/grosmichel-dev/localog)

## 참고

- 유료 요금제가 필요한 AI 도구가 있습니다(도구 쪽 정책).
- 커넥터가 자료를 잠시 기억(캐시)해서, 방금 올린 자료가 바로 안 보일 수 있습니다.
