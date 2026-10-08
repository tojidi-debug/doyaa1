/* GitHub(정적) 사이트용 api.js — 서버가 없는 곳에서 js/api.js 자리에 들어간다(qc_static_build.py 가 바꿔 끼운다, 2026-10-08).
 *
 * 되는 것: 회계법인 이름 찾기(qc/firms.json) · 기본 서식 · 심의안 초안 작성·hwpx·강평·평가표(엑셀, Pyodide)
 * 전자공시(2026-10-08 추가): window.QC_RELAY(구글 Apps Script 중계, relay/Code.gs)가 있으면
 *   보고서 목록(list.json)·사업보고서 원문(document.xml)·기업개황(company.json)을 중계로 받고,
 *   원문 해석은 서버와 같은 파이썬(py/qc_firm.py = dart_firm.py 의 순수 함수)을 브라우저(Pyodide)에서 돌린다.
 *   외감회사대사·외부감사보고서 수: 공시통합검색(dsab007)을 중계가 받고, 대사·엑셀은 py/qc_audited.py(= services/qc_audited.py)를 Pyodide 로.
 *   심의안 미리보기: qc/static/hwp_preview.js(rhwp WebAssembly).
 * 안 되는 것: 사업보고서 PDF 내려받기(→ 전자공시 화면을 새 창으로 연다).
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
/* ── 전자공시 중계 ── */
const relayUrl = () => { let v = ''; try { v = localStorage.getItem('qc.relay') || ''; } catch { /* */ } return v || window.QC_RELAY || ''; };
export const hasRelay = () => !!relayUrl();
async function relay(params) {
  const url = relayUrl(); if (!url) throw only('전자공시 조회(중계 주소 없음)');
  let r; try { r = await fetch(`${url}?${new URLSearchParams(params)}`, { redirect: 'follow' }); } catch (e) { throw new ApiError(502, `전자공시 중계(구글 Apps Script)에 연결하지 못했습니다: ${e.message || e}`); }
  if (!r.ok) throw new ApiError(r.status, `전자공시 중계가 응답하지 않았습니다(${r.status}).`);
  let d; try { d = await r.json(); } catch { throw new ApiError(502, '전자공시 중계의 응답을 읽지 못했습니다(웹 앱 액세스 권한이 「모든 사용자」인지 확인하세요).'); }
  if (!d.ok) throw new ApiError(502, d.error || '전자공시 중계 오류');
  return d;
}
const DART_HELP = { '010': '등록되지 않은 OpenDART 인증키입니다(중계의 DART_KEY 확인).', '011': '사용할 수 없는 OpenDART 인증키입니다.', '012': '접근할 수 없는 IP 입니다.', '020': 'OpenDART 하루 요청 한도를 넘었습니다. 내일 다시 해 주세요.', '100': 'OpenDART 요청 값이 올바르지 않습니다.', '800': 'OpenDART 시스템 점검 중입니다.', '900': 'OpenDART 정의되지 않은 오류입니다.' };
function dartCheck(p) { const s = String((p || {}).status || ''); if (s === '000' || s === '' || s === '013') return; throw new ApiError(502, DART_HELP[s] || `OpenDART 오류(${s}): ${(p || {}).message || '내용 없음'}`); }
const REPORT_RE = /회계법인사업보고서\s*\((\d{4})\.(\d{2})\)/;
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
/* 서버 dart_firm.list_reports 와 같은 규칙: 최근 years 개 사업연도의 회계법인사업보고서(정정 포함), 최신순 */
const LISTS = new Map();   /* 같은 법인·기간은 한 번만 받는다(OpenDART 하루 한도 아끼기) */
function listReports(corp, years) {
  const k = `${corp}|${years}`; if (!LISTS.has(k)) { const p = fetchReports(corp, years); LISTS.set(k, p); p.catch(() => LISTS.delete(k)); }
  return LISTS.get(k);
}
async function fetchReports(corp, years) {
  const today = new Date(); const items = []; let corpName = '';
  for (let page = 1; page <= 20; page++) {
    const p = (await relay({ op: 'list', corp_code: corp, bgn_de: `${today.getFullYear() - years - 1}0101`, end_de: ymd(today), page_no: page })).data || {};
    if (String(p.status) === '013') break;
    dartCheck(p);
    for (const it of p.list || []) {
      const name = String(it.report_nm || ''); const m = REPORT_RE.exec(name); if (!m) continue;
      corpName = corpName || String(it.corp_name || ''); const year = +m[1], month = +m[2];
      if (year < today.getFullYear() - years) continue;
      items.push({ rcept_no: it.rcept_no, rcept_dt: it.rcept_dt, report_nm: name, period: `${year}.${m[2]}`, year, month, corrected: name.includes('정정'), viewer_url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${it.rcept_no}` });
    }
    if (page >= +(p.total_page || 1)) break;
  }
  items.sort((a, b) => (b.period + b.rcept_dt).localeCompare(a.period + a.rcept_dt));
  return { corp_code: corp, corp_name: corpName, items };
}
const PARSED = new Map();
function parsed(no) {
  if (!PARSED.has(no)) {
    const p = (async () => { const d = await relay({ op: 'doc', rcept_no: no }); return JSON.parse(await window.QcStatic.parseFirm(d.b64, no)); })();
    PARSED.set(no, p); p.catch(() => PARSED.delete(no));
  }
  return PARSED.get(no).then(x => JSON.parse(JSON.stringify(x)));
}
const fmtBiz = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : (v || null); };
const fmtCorp = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length === 13 ? `${d.slice(0, 6)}-${d.slice(6)}` : (v || null); };
const why = (e) => String((e && e.message) || e);
/* 서버 dart_firm.firm_profile 과 같은 순서: 당기 보고서 + 전년도(같은 달) 보고서의 인원현황 + 기업개황 등록번호 */
async function firmProfile(no, corp) {
  const reports = await listReports(corp, 7);
  const cur = reports.items.find(r => r.rcept_no === no); if (!cur) throw new ApiError(422, '그 접수번호는 이 회계법인의 사업보고서 목록에 없습니다.');
  const result = await parsed(no);
  const prevYear = cur.year - 1, month = cur.month, mm = String(month).padStart(2, '0');
  const prevs = reports.items.filter(r => r.year === prevYear && r.month === month); let prevInfo = null;
  if (prevs.length) {
    const prev = prevs.reduce((a, b) => (b.rcept_dt > a.rcept_dt ? b : a));
    try { const pr = await parsed(prev.rcept_no); for (const k of Object.keys(result.staff)) result.staff[k][1] = pr.staff[k][0]; prevInfo = { rcept_no: prev.rcept_no, report_nm: prev.report_nm, period: prev.period }; }
    catch (e) { result.warnings.push(`전년도 사업보고서(${prev.report_nm})를 읽지 못해 인원현황 전기가 비었습니다: ${why(e)}`); }
  } else result.warnings.push(`전년도(${prevYear}.${mm}) 사업보고서가 없어 인원현황 전기가 비었습니다.`);
  Object.assign(result, { corp_code: corp, corp_name: reports.corp_name, report_nm: cur.report_nm, period: cur.period, year: cur.year, month: cur.month, prev_period: `${prevYear}.${mm}`, prev: prevInfo });
  try { const c = (await relay({ op: 'company', corp_code: corp })).data || {}; dartCheck(c); result.general.biz_no = fmtBiz(c.bizr_no); result.general.corp_no = fmtCorp(c.jurir_no); }
  catch (e) { result.general.biz_no = result.general.corp_no = null; result.warnings.push(`사업자·법인등록번호를 기업개황에서 읽지 못했습니다: ${why(e)}`); }
  return result;
}

/* ── 외감회사대사(서버 /qc/audited · /qc/audited.xlsx · /qc/reconcile 와 같은 결과) ── */
const PAGES = new Map();   /* 같은 제출인·기간의 검색은 한 번만 */
function dsabPages(filer, s, e) {
  const k = `${filer}|${s}|${e}`;
  if (!PAGES.has(k)) { const p = relay({ op: 'dsab', filer, start: s.replace(/-/g, ''), end: e.replace(/-/g, '') }).then(d => d.pages || []); PAGES.set(k, p); p.catch(() => PAGES.delete(k)); }
  return PAGES.get(k);
}
async function auditCtx(get) {
  if (!hasRelay()) throw only('전자공시 감사보고서 검색(외감회사대사)');
  const filer = String(get('filer') || '').replace(/\s+/g, ''); if (filer.length < 2) throw new ApiError(422, '제출인명(회계법인명)이 비었습니다.');
  let s, e; try { [s, e] = JSON.parse(await window.QcStatic.audited('web_period', [get('start') || '', get('end') || ''])); } catch (x) { throw new ApiError(422, why(x)); }
  const pages = JSON.stringify(await dsabPages(filer, s, e));
  return { filer, s, e, pages, mx: get('max_period') || '', mn: get('min_period') || '' };
}
const pyCall = async (fn, args) => { try { return await window.QcStatic.audited(fn, args); } catch (x) { throw new ApiError(422, why(x)); } };
async function b64of(file) { const u = new Uint8Array(await file.arrayBuffer()); let out = ''; for (let i = 0; i < u.length; i += 0x8000) out += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(out); }
async function reconcileCall(fd, asXlsx) {
  const c = await auditCtx((k) => fd.get(k)); const f = fd.get('file');
  return { c, out: await pyCall('web_reconcile', [c.pages, await b64of(f), f.name || '', c.filer, +(fd.get('year') || 0), c.s, c.e, c.mx, c.mn, asXlsx, fd.get('aliases') || '']) };
}
/** qc.js reconDownload 의 정적 사이트판: 서버 주소 대신 브라우저에서 엑셀을 만든다 → { blob, name } */
export async function staticDownload(url, body) {
  if (url.includes('/qc/audited.xlsx')) {
    const q = new URLSearchParams(url.split('?')[1] || ''); const c = await auditCtx((k) => q.get(k));
    return { blob: await pyCall('web_audited_xlsx', [c.pages, c.filer, c.s, c.e, c.mx, c.mn]), name: `외감대상회사_${c.filer}_${c.e.slice(2).replace(/-/g, '')}.xlsx` };
  }
  if (url.includes('/qc/reconcile')) {
    const { c, out } = await reconcileCall(body, true); const y = +(body.get('year') || 0);
    return { blob: out, name: `외감회사대사_${c.filer}_${y === -1 ? '전체' : (y || '')}.xlsx` };
  }
  throw only(url);
}

export const api = {
  async get(path) {
    if (path.startsWith('/qc/templates')) return { templates: [], active_id: null, builtin: 'qc/templates/심의안.hwpx' };
    if (path.startsWith('/qc/firms?')) return firms(new URLSearchParams(path.split('?')[1]).get('q'));
    if (path.startsWith('/qc/firms/')) {
      if (!hasRelay()) throw only('전자공시 사업보고서 목록 조회');
      const [, code] = /^\/qc\/firms\/(\d{8})\/reports/.exec(path) || []; if (!code) throw only(path);
      const years = +(new URLSearchParams(path.split('?')[1] || '').get('years') || 5);
      const out = await listReports(code, years);
      if (!out.items.length) throw new ApiError(404, `최근 ${years}개 사업연도의 회계법인사업보고서가 전자공시에 없습니다.`);
      return out;
    }
    if (path.startsWith('/qc/reports/')) {
      if (!hasRelay()) throw only('사업보고서 원문 읽기');
      const m = /^\/qc\/reports\/(\d{14})\/profile\?corp_code=(\d{8})/.exec(path); if (!m) throw only(path);
      return firmProfile(m[1], m[2]);
    }
    if (path.startsWith('/qc/audited?')) {
      const q = new URLSearchParams(path.split('?')[1]); const c = await auditCtx((k) => q.get(k));
      return JSON.parse(await pyCall('web_audited', [c.pages, c.filer, c.s, c.e, c.mx, c.mn]));
    }
    throw only(path);
  },
  async post(path) { throw only(path); },
  async put(path) { throw only(path); },
  async patch(path) { throw only(path); },
  async del() { throw only('서식 지우기'); },
  async upload(path, fd) {
    if (path === '/qc/reconcile') return JSON.parse((await reconcileCall(fd, false)).out);
    throw only('서식 올리기');
  },
  async postBlob(path, body) {
    if (path === '/agenda/hwp/pdf') {   /* 서버 변환기(rhwp)의 브라우저판으로 그린 HTML 미리보기 */
      const { previewHtml } = await import('../qc/static/hwp_preview.js');
      try { return await previewHtml(body); } catch (e) { throw new ApiError(500, `미리보기를 만들지 못했습니다: ${e.message || e}`); }
    }
    throw only(path);
  },
  async downloadPost(path) { throw only(path); },
};
export const auth = { async me() { return { id: 'github', name: 'GitHub', roles: [] }; }, async logout() { /* */ } };
