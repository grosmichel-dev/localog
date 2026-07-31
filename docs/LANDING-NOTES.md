# 첫 화면 구현 메모

## 마크다운 안에서 HTML을 써도 되는가 → 된다 (2026-07-31 실측)

`content/index.md` 에 `<div class="lg-cards"><a class="lg-card" href="./how-to">…</a></div>` 를 넣고
`node tools/build-site.mjs` 로 빌드한 결과, `public/index.html` 에 태그가 **그대로 남았다.**

```html
<div class="lg-cards"><a class="lg-card internal internal-link alias" href="./how-to" data-slug="how-to">…</a></div>
```

두 가지를 확인했다.

1. **HTML이 이스케이프되지 않는다** → 첫 화면 링크 카드를 HTML로 짜도 된다.
2. **HTML 안의 `href` 도 Quartz가 내부 링크로 해석한다** → `class="internal"` 과 `data-slug` 가 자동으로 붙는다.
   즉 카드 안에서 `href="./how-to"` 처럼 써도 위키링크와 똑같이 동작한다(팝오버·SPA 이동 포함).

그래서 마크다운 표로 우회할 필요가 없다. 다시 실험하지 말 것.

## 주의

- 카드에 **JavaScript 는 넣지 않는다.** 링크만 쓴다(정적 페이지 원칙 + 새니타이즈 위험 회피).
- 스타일은 `quartz/styles/custom.scss` 에만 둔다. 인라인 `style=` 속성 금지(다크모드 대응이 깨진다).
