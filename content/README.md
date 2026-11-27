# 글 올리는 법 (3단계)

1. `content/reports/` 에는 긴 리포트(PDF)를, `content/notes/` 에는 짧은 칼럼(`.md`)을 올립니다. (GitHub 웹에서 폴더를 열고 **Add file → Upload files** 로 끌어놓으면 됩니다.)
2. `content/index.json` 의 `items` 목록에 그 파일 한 줄을 추가합니다 — `kind`(reports/notes), `path`, `title`, `date`, `summary`.
3. **Commit changes** 를 누르면 1~2분 뒤 사이트 '글' 탭에 나타납니다.

PDF는 클릭하면 브라우저 새 탭에서 열립니다(아이폰은 미리보기 대신 내려받기 링크가 함께 표시됩니다). `index.json` 에 없는 파일은 목록에 나오지 않습니다.
