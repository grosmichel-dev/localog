import { readFileSync } from "node:fs"
import path from "node:path"
import { Root, Element, Parent } from "hast"
import { QuartzTransformerPlugin } from "../types"

/*
 * 예산 페이지(build-budget-pages 가 만든 문서)의 첫 표 앞에 컨트롤 마커를 넣고,
 * 검색·정렬·현재 화면 합계 스크립트를 인라인으로 싣는다.
 *
 * 왜 마크다운 본문이 아니라 여기인가
 *  quartz/processors/parse.ts 는 remarkRehype({ allowDangerousHtml: true }) 만 쓰고
 *  rehype-raw 가 없다. 본문에 적은 raw <div>·<script> 는 DOM 에 생성되지 않는다.
 *
 * 왜 외부 스크립트가 아니라 인라인인가
 *  Quartz 는 플러그인이 준 src 를 그대로 쓴다(baseUrl 을 붙여주지 않는다).
 *  이 사이트는 <owner>.github.io/localog 아래에 있어 루트 절대경로는 배포본에서 404 가 된다.
 *
 * 왜 로컬 플러그인이 아니라 벤더링 트리인가
 *  로컬 플러그인은 .quartz/plugins 로 심볼릭 링크되는데 Windows 에서 EPERM 으로 실패한다.
 *  형님이 로컬 미리보기를 못 하게 되므로 내장 트랜스포머로 넣는다.
 */

const MARKER_CLASS = "budget-table-controls"
const GENERATED_BY = "build-budget-pages"

function loadControlScript(): string {
  const scriptPath = path.join(process.cwd(), "static", "budget-table.js")
  try {
    return readFileSync(scriptPath, "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `BudgetTable: ${scriptPath} 를 읽을 수 없습니다. 이 파일이 없으면 예산 표의 정렬·검색·합계가 동작하지 않습니다. (${message})`,
    )
  }
}

function findFirstTable(
  node: Root | Element | Parent,
  parent: Parent | null,
  index: number | null,
): { parent: Parent; index: number } | null {
  if ((node as Element).type === "element" && (node as Element).tagName === "table") {
    return parent !== null && index !== null ? { parent, index } : null
  }
  const children = (node as Parent).children ?? []
  for (let i = 0; i < children.length; i += 1) {
    const hit = findFirstTable(children[i] as Element, node as Parent, i)
    if (hit) return hit
  }
  return null
}

export const BudgetTable: QuartzTransformerPlugin = () => {
  const script = loadControlScript()

  return {
    name: "BudgetTable",

    htmlPlugins() {
      return [
        () => (tree: Root, file: { data?: { frontmatter?: Record<string, unknown> } }) => {
          const frontmatter = file?.data?.frontmatter
          if (!frontmatter || frontmatter.generated_by !== GENERATED_BY) return

          const hit = findFirstTable(tree, null, null)
          if (!hit) return

          const hasTotalRow =
            frontmatter.budget_has_total_row === true || frontmatter.budget_has_total_row === "true"

          hit.parent.children.splice(hit.index, 0, {
            type: "element",
            tagName: "div",
            properties: {
              className: [MARKER_CLASS],
              "data-has-total-row": hasTotalRow ? "true" : "false",
            },
            children: [],
          } as Element)
        },
      ]
    },

    externalResources() {
      return {
        js: [
          {
            script,
            loadTime: "afterDOMReady",
            contentType: "inline",
            spaPreserve: true,
          },
        ],
      }
    },
  }
}
