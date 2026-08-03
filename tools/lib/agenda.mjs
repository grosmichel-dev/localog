// 회의록 본문에서 안건 헤딩을 찾는다. build-catalog 와 validate-frontmatter 가 함께 쓴다.
//
// explicit 를 함께 돌려주는 이유: 앵커가 없으면 이 함수가 `${docId}-aNN` 을 지어낸다.
// 그래서 반환값만 봐서는 "사람이 적은 앵커"와 "여기서 만든 앵커"를 구분할 수 없다.
// 카탈로그는 지어낸 앵커라도 링크를 걸어야 하고, 검증기는 사람이 안 적은 것을 잡아야 하므로
// 두 쓰임이 갈린다.
export function findAgendaItems(body, docId) {
  const items = [];
  const lines = String(body ?? '').split(/\r?\n/);
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!heading || !/(제\s*\d+\s*호|안건\s*\d+|○\s*안건)/.test(heading[2])) continue;
    const number = items.length + 1;
    const suffix = `a${String(number).padStart(2, '0')}`;
    const explicitMatch = /\{#([^}]+)\}/.exec(heading[2]);
    const anchor = explicitMatch ? explicitMatch[1] : (docId ? `${docId}-${suffix}` : suffix);
    const title = heading[2].replace(/\s*\{#[^}]+\}\s*$/, '').trim();
    items.push({ title, anchor, explicit: Boolean(explicitMatch), heading: heading[2] });
  }
  return items;
}
