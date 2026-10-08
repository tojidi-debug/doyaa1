/* GitHub(정적) 사이트용 api.js — 서버가 없는 곳에서 js/api.js 자리에 들어간다(qc_static_build.py 가 바꿔 끼운다, 2026-10-08).
 *
 * 되는 것: 회계법인 이름 찾기(qc/firms.json) · 기본 서식 · 심의안 초안 작성·hwpx·강평·평가표(엑셀, Pyodide)
 * 안 되는 것(전자공시는 다른 사이트의 브라우저에서 직접 부를 수 없다 — CORS·공개 중계 차단):
 *   보고서 목록·사업보고서 읽기·외감회사대사·PDF 미리보기 → 개발서버에서 [정보 내보내기(JSON)] 한 파일을 [회계법인 정보 불러오기]로.
 */
export class ApiError extends Error {
  constructor(status, message, data) { super(message); this.name = 'ApiError'; this.status = status; this.data = data; }
}
const only = (what) => new ApiError(503, `「${what}」 기능은 이 사이트(서버 없음)에서는 할 수 없습니다. 개발서버 화면에서 [정보 내보내기(JSON)]로 받은 파일을 왼쪽 [회계법인 정보 불러오기(JSON)]로 불러오세요.`);
const norm = (s) => String(s || '').replace(/\s+/g, '').replace(/[()（）㈜]|주식회사|유한회사/g, '').toLowerCase();
let FIRMS = null;
async function firms(q) {
  if (!FIRMS) { const r = await fetch('qc/firms.json', { cache: 'no-store' }); if (!r.ok) throw new ApiError(r.status, '회계법인 목록(qc/firms.json)을 받지 못했습니다.'); FIRMS = await r.json(); }
  const want = norm(q).replace('회계법인', ''); if (!want) return { items: [] };
  const items = FIRMS.filter(f => norm(f.corp_name).replace('회계법인', '').includes(want)).sort((a, b) => a.corp_name.length - b.corp_name.length || a.corp_name.localeCompare(b.corp_name)).slice(0, 50);
  return { items };
}
export const api = {
  async get(path) {
    if (path.startsWith('/qc/templates')) return { templates: [], active_id: null, builtin: 'qc/templates/심의안.hwpx' };
    if (path.startsWith('/qc/firms?')) return firms(new URLSearchParams(path.split('?')[1]).get('q'));
    if (path.startsWith('/qc/firms/')) throw only('전자공시 사업보고서 목록 조회');
    if (path.startsWith('/qc/reports/')) throw only('사업보고서 원문 읽기');
    if (path.startsWith('/qc/audited')) throw only('전자공시 감사보고서 검색(외감회사대사)');
    throw only(path);
  },
  async post(path) { throw only(path); },
  async put(path) { throw only(path); },
  async patch(path) { throw only(path); },
  async del() { throw only('서식 지우기'); },
  async upload(path) { throw only(path.includes('reconcile') ? '외감회사대사' : '서식 올리기'); },
  async postBlob(path) {
    if (path === '/agenda/hwp/pdf') throw new ApiError(503, '심의안(미리보기) PDF는 개발서버에서만 됩니다(한글→PDF 변환기가 서버에 있음). [심의안 초안(hwpx)]을 내려받아 한글에서 확인하세요.');
    throw only(path);
  },
  async downloadPost(path) { throw only(path); },
};
export const auth = { async me() { return { id: 'github', name: 'GitHub', roles: [] }; }, async logout() { /* */ } };
