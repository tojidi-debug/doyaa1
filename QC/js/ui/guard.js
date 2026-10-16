/* 오른쪽 버튼과 개발자 도구 단축키를 막는다 (담당부서 요청).
 *
 *     import './ui/guard.js';
 *
 * 물어 오기만 하면 걸린다 — 부를 함수가 없다.
 *
 * ## ⚠️ 이것은 소스 보기를 막지 못한다
 *
 * 막히는 것은 **오른쪽 버튼 차림표**와 **F12 · Ctrl+Shift+I** 뿐이다. 아래는
 * 전부 그대로 통한다:
 *
 *     Ctrl+U                소스 보기
 *     Ctrl+S                통째로 저장
 *     브라우저 차림표 → 도구 → 개발자 도구
 *     view-source:https://…/index.html
 *     curl · 프록시 · 확장 프로그램
 *
 * 정적 파일을 그대로 내려주는 구조라 **원리상** 막을 수 없다. 「실수로 오른쪽
 * 버튼을 누르는 것」을 줄이는 정도이고, 그 이상으로 기대하면 안 된다.
 * **진짜로 가려야 할 것이 있다면 그것은 서버에 두고 API 로만 주는 문제다.**
 * 같은 말이 DESIGN.md 에도 적혀 있다.
 *
 * ## 왜 한 곳에 모았나
 *
 * 예전에는 `js/fss.js` 와 옛 `js/qna.js` 두 곳에 같은 네 줄이 복사돼 있었고
 * (`js/work_flow.js` 머리말에는 「우클릭·F12 차단은 옮기지 않았다」가 적혀 있었다),
 * 화면마다 되기도 하고 안 되기도 했다. 한 곳에 두면 그 갈림이 없어진다.
 *
 * ## ⚠️ 글자 고르기와 복사는 막지 않는다
 *
 * 이 화면들은 기준서·지적사례를 **읽어서 조서에 옮겨 적는** 데 쓴다. 복사를 막으면
 * 그 일이 통째로 막힌다. 여기서는 차림표만 막는다.
 */

document.addEventListener('contextmenu', (event) => event.preventDefault());

document.addEventListener('keydown', (event) => {
  // F12
  if (event.key === 'F12') { event.preventDefault(); return; }
  // Ctrl+Shift+I · Ctrl+Shift+J · Ctrl+Shift+C (요소 검사)
  if (event.ctrlKey && event.shiftKey && ['I', 'J', 'C'].includes(event.key.toUpperCase())) {
    event.preventDefault();
  }
});

/* GitHub(정적) 사이트만 — 소스 보기·통째 저장 단축키도 막는다 */
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && ['u', 's'].includes(String(event.key).toLowerCase())) event.preventDefault();
});
