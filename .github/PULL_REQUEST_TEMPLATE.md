## 변경 요약

(무엇을 추가·수정했는지 한두 줄)

## 공개 전 확인 (콘텐츠 PR이면 전부 체크)

### 민간인 개인정보
- [ ] 원문과 대조해 민간인 실명·연락처·사생활 진술을 확인했고, `[REDACTED_성명]` / `[REDACTED_연락처]`로 마스킹했다
- [ ] 프론트매터 서명을 채웠다: `review_status: screened` · `pii_screened_by` · `screened_at` · `screening_scope`

### 원본·이미지 (originals/ · assets/)
- [ ] PDF·스캔본은 OCR 또는 육안으로 전체를 확인했다
- [ ] 사진은 EXIF(촬영 위치·기기 정보)를 제거했다
- [ ] 안전하게 확인하지 못한 원본은 커밋하지 않고 `source_url` / `archive_url`만 남겼다
- [ ] 실제 검사 범위를 `screening_scope`에 그대로 적었다

### 제3자 저작물
- [ ] 상업 지도 캡처, 언론 기사 발췌, 외부 용역 이미지(조감도·도면) 등이 섞여 있지 않은지 확인했다

### 데이터 표준
- [ ] `docs/DATA-STANDARD.md`를 지켰다 (필수 필드, `source_type` 4값, `doc_id` 규칙, 파일 이름 규칙, `keywords` 8개 이하)

---

인프라 PR(콘텐츠 변경 없음)이면 위 대신 여기에 체크:
- [ ] 콘텐츠(content/ · originals/ · assets/) 변경 없음
