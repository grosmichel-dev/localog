---
title: MCP 연결하기
description: localog 아카이브를 MCP 서버로 AI 도구에 등록하는 방법. 한 번 등록하면 자동으로 최신 자료를 읽습니다.
---

AI 도구에 주소를 한 번만 등록해 두면 이후로는 **자동으로 최신 자료**를 읽습니다. 매번 목록을 복사·붙여넣기 하지 않아도 됩니다.

> 설정 없이 그냥 써 보고 싶다면 → **[지금 바로 물어보기](https://grosmichel-dev.gitmcp.io/localog/chat)** (브라우저에서 바로 질문)

## 서버 주소

```
https://grosmichel-dev.gitmcp.io/localog
```

사이트 주소(`grosmichel-dev.github.io/localog`)에서 `github.io` 를 `gitmcp.io` 로 바꾼 형태입니다. [GitMCP](https://gitmcp.io)라는 무료 서비스가 이 아카이브를 MCP 서버로 변환해 줍니다.

> **주소를 정확히 이 형태로 쓰세요.** `gitmcp.io/grosmichel-dev/localog` (저장소 변형)로 쓰면 GitHub 저장소를 읽는데, 자료 목록(`llms.txt`)은 저장소에 커밋하지 않고 **사이트에만** 올리기 때문에 목록을 못 찾습니다. 위의 **Pages 변형**이라야 목록을 먼저 읽고 개별 문서를 가져갑니다.

## 도구별 설정

### Claude Desktop

`claude_desktop_config.json` (설정 → 개발자 → 설정 편집)

```json
{
  "mcpServers": {
    "localog": {
      "command": "npx",
      "args": ["mcp-remote", "https://grosmichel-dev.gitmcp.io/localog"]
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "localog": {
      "url": "https://grosmichel-dev.gitmcp.io/localog"
    }
  }
}
```

### VS Code

`.vscode/mcp.json`

```json
{
  "servers": {
    "localog": {
      "type": "sse",
      "url": "https://grosmichel-dev.gitmcp.io/localog"
    }
  }
}
```

Windsurf·Cline·Highlight AI 등 다른 도구의 설정 예시는 [GitMCP 안내 페이지](https://grosmichel-dev.gitmcp.io/localog)에서 볼 수 있습니다.

등록하면 AI가 자료 목록(`llms.txt`)을 먼저 읽고, 질문과 관련된 문서만 그때그때 가져갑니다.

## 잘 안 될 때

GitMCP는 우리가 운영하는 서비스가 아니라 **외부 무료 서비스**입니다. 접속이 안 되거나 최신 자료가 안 보이면:

1. [[how-to|사용법]]의 **방법 2**(목록 주소 붙여넣기 / 전문 복사)로 쓰세요. 이 방법은 외부 서비스를 거치지 않습니다.
2. 자료 목록은 항상 [여기](https://grosmichel-dev.github.io/localog/llms.txt)에서 직접 볼 수 있습니다.
3. 저장소를 직접 내려받아 로컬 경로로 붙여 쓰는 방법도 있습니다: [GitHub 저장소](https://github.com/grosmichel-dev/localog)

## 참고

- 유료 요금제가 필요한 AI 도구가 있습니다(도구 쪽 정책).
- 캐시 때문에 방금 올린 자료가 바로 안 보일 수 있습니다.
