/*
 * 예산 표 화면 컨트롤 — 검색 필터 · 열 정렬 · 현재 화면 합계.
 *
 * 설계 원칙
 *  - 무의존. 빌드 도구도 프레임워크도 쓰지 않는다.
 *  - 점진적 향상. 이 스크립트가 없거나 실패해도 표와 다운로드 링크는 그대로 보인다.
 *  - 마커(.budget-table-controls)가 없는 페이지에서는 아무것도 하지 않는다.
 *  - Quartz 는 클라이언트 라우팅을 쓰므로 nav 이벤트에서 다시 초기화한다. 중복 부착은 막는다.
 *
 * ★합계에 대하여
 *  원문 합계행은 사이트가 계산한 값이 아니라 원문 예산서에 실려 있던 값이다. 필터를 걸면
 *  화면의 행과 원문 합계가 어긋나므로, "현재 화면 합계"를 따로 계산해 보여주고 두 수치에
 *  각각 라벨을 붙인다. 현재 화면 합계는 보이는 것의 합일 뿐 공식 수치가 아니다.
 */
;(function () {
  var NUM_CLEAN = /[,\s₩원]/g
  var NUM_SHAPE = /^-?\d+(?:\.\d+)?$/

  function parseNumber(text) {
    var cleaned = String(text == null ? '' : text).replace(NUM_CLEAN, '')
    if (cleaned === '' || !NUM_SHAPE.test(cleaned)) return null
    var value = Number(cleaned)
    return isFinite(value) ? value : null
  }

  function formatNumber(value) {
    try {
      return value.toLocaleString('ko-KR')
    } catch (e) {
      return String(value)
    }
  }

  function findTable(marker) {
    var el = marker.nextElementSibling
    while (el) {
      if (el.tagName === 'TABLE') return el
      if (el.querySelector) {
        var nested = el.querySelector('table')
        if (nested) return nested
      }
      el = el.nextElementSibling
    }
    return null
  }

  function makeEl(tag, className, text) {
    var el = document.createElement(tag)
    if (className) el.className = className
    if (text != null) el.textContent = text
    return el
  }

  // Quartz 가 표를 .table-container 로 감싸므로 마커가 그 안에 갇힌다 — 그대로 두면 패널이 표와 함께 가로 스크롤된다
  function moveOutOfScrollBox(marker) {
    var parent = marker.parentElement
    if (parent && parent.classList && parent.classList.contains('table-container') && parent.parentElement) {
      parent.parentElement.insertBefore(marker, parent)
    }
  }

  function attach(marker) {
    if (marker.dataset.budgetTableReady === '1') return
    moveOutOfScrollBox(marker)
    var table = findTable(marker)
    if (!table) return

    var headCells = table.querySelectorAll('thead th')
    var body = table.querySelector('tbody')
    if (!headCells.length || !body) return

    var allRows = Array.prototype.slice.call(body.rows)
    if (!allRows.length) return

    marker.dataset.budgetTableReady = '1'

    // 원문 합계행은 생성기가 표의 마지막 줄에 놓는다.
    var hasTotalRow = marker.dataset.hasTotalRow === 'true'
    var totalRow = hasTotalRow ? allRows[allRows.length - 1] : null
    var dataRows = hasTotalRow ? allRows.slice(0, -1) : allRows
    if (totalRow) {
      totalRow.classList.add('budget-total-row')
      var firstCell = totalRow.cells[0]
      if (firstCell) {
        var badge = makeEl('span', 'budget-total-badge', '원문 합계')
        badge.title = '원문 예산서에 실려 있던 값 그대로입니다. 사이트가 계산한 값이 아니며 필터와 무관합니다.'
        firstCell.appendChild(document.createTextNode(' '))
        firstCell.appendChild(badge)
      }
    }

    // 수치 열 판정 — 값이 있는 셀의 대부분이 숫자면 수치 열로 본다.
    var numericColumns = []
    for (var c = 0; c < headCells.length; c += 1) {
      var filled = 0
      var numeric = 0
      for (var r = 0; r < dataRows.length; r += 1) {
        var cell = dataRows[r].cells[c]
        if (!cell) continue
        var raw = cell.textContent.trim()
        if (!raw) continue
        filled += 1
        if (parseNumber(raw) !== null) numeric += 1
      }
      if (filled > 0 && numeric / filled >= 0.8) numericColumns.push(c)
    }

    // --- 컨트롤 UI ---
    var panel = makeEl('div', 'budget-controls')

    var searchWrap = makeEl('div', 'budget-search')
    var input = document.createElement('input')
    input.type = 'search'
    input.className = 'budget-search-input'
    input.placeholder = '이 표에서 찾기 (부서·사업명·비목 등)'
    input.setAttribute('aria-label', '이 표에서 찾기')
    var count = makeEl('span', 'budget-count', '')
    searchWrap.appendChild(input)
    searchWrap.appendChild(count)

    var sums = makeEl('div', 'budget-sums')
    var sumsLabel = makeEl('span', 'budget-sums-label', '현재 화면 합계')
    sumsLabel.title = '지금 화면에 보이는 행만 더한 값입니다. 공식 수치가 아니며, 원문 합계와 다를 수 있습니다.'
    var sumsValues = makeEl('span', 'budget-sums-values', '')
    sums.appendChild(sumsLabel)
    sums.appendChild(sumsValues)

    panel.appendChild(searchWrap)
    if (numericColumns.length) panel.appendChild(sums)
    marker.appendChild(panel)

    // --- 필터 ---
    var rowText = dataRows.map(function (row) {
      return row.textContent.toLowerCase()
    })

    function refresh() {
      var query = input.value.trim().toLowerCase()
      var visible = 0
      for (var i = 0; i < dataRows.length; i += 1) {
        var match = !query || rowText[i].indexOf(query) !== -1
        dataRows[i].style.display = match ? '' : 'none'
        if (match) visible += 1
      }
      count.textContent = query
        ? visible + '개 표시 (전체 ' + dataRows.length + '개)'
        : '전체 ' + dataRows.length + '개'

      if (!numericColumns.length) return
      var parts = []
      for (var n = 0; n < numericColumns.length; n += 1) {
        var col = numericColumns[n]
        var total = 0
        for (var k = 0; k < dataRows.length; k += 1) {
          if (dataRows[k].style.display === 'none') continue
          var cell = dataRows[k].cells[col]
          if (!cell) continue
          var value = parseNumber(cell.textContent.trim())
          if (value !== null) total += value
        }
        var name = headCells[col] ? headCells[col].textContent.trim() : '합계'
        parts.push(name + ' ' + formatNumber(total))
      }
      sumsValues.textContent = parts.join(' · ')
    }

    input.addEventListener('input', refresh)

    // --- 정렬 ---
    var sortState = { column: -1, asc: true }

    function sortBy(column) {
      if (sortState.column === column) sortState.asc = !sortState.asc
      else {
        sortState.column = column
        sortState.asc = true
      }
      var isNumeric = numericColumns.indexOf(column) !== -1
      var direction = sortState.asc ? 1 : -1

      dataRows.sort(function (a, b) {
        var av = a.cells[column] ? a.cells[column].textContent.trim() : ''
        var bv = b.cells[column] ? b.cells[column].textContent.trim() : ''
        if (isNumeric) {
          var an = parseNumber(av)
          var bn = parseNumber(bv)
          if (an === null && bn === null) return 0
          if (an === null) return 1
          if (bn === null) return -1
          return (an - bn) * direction
        }
        return av.localeCompare(bv, 'ko') * direction
      })

      // 원문 합계행은 정렬 대상이 아니며 항상 맨 아래에 둔다.
      for (var i = 0; i < dataRows.length; i += 1) body.appendChild(dataRows[i])
      if (totalRow) body.appendChild(totalRow)

      for (var h = 0; h < headCells.length; h += 1) {
        headCells[h].removeAttribute('aria-sort')
        headCells[h].classList.remove('budget-sorted-asc', 'budget-sorted-desc')
      }
      headCells[column].setAttribute('aria-sort', sortState.asc ? 'ascending' : 'descending')
      headCells[column].classList.add(sortState.asc ? 'budget-sorted-asc' : 'budget-sorted-desc')
    }

    for (var h = 0; h < headCells.length; h += 1) {
      ;(function (column) {
        var th = headCells[column]
        th.classList.add('budget-sortable')
        th.tabIndex = 0
        th.setAttribute('role', 'button')
        th.title = '클릭하면 이 열로 정렬합니다'
        th.addEventListener('click', function () {
          sortBy(column)
        })
        th.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            sortBy(column)
          }
        })
      })(h)
    }

    refresh()
  }

  function init() {
    var markers = document.querySelectorAll('.budget-table-controls')
    if (!markers.length) return // 예산 페이지가 아니면 아무것도 하지 않는다
    Array.prototype.forEach.call(markers, function (marker) {
      try {
        attach(marker)
      } catch (error) {
        // 컨트롤이 실패해도 표는 그대로 보여야 한다.
        if (window.console && console.warn) console.warn('budget-table:', error)
      }
    })
  }

  document.addEventListener('nav', init)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
