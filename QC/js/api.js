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

const qcApi = {
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


/* ══ [품감] 개별선정 — GitHub(정적) 사이트판(2026-10-15) ══════════════════════════════════════════
 * 개발서버의 /qc-sample/* · /finstmt/* 를 대신한다.
 *   계산·해석: 서버와 같은 파이썬(py/gumiho.zip)을 브라우저(Pyodide)에서 — window.QcStatic.sample(이름, 인자)
 *   공유 자료(감리일정·명부·인뎁스 서식·관리자 조정): 구글 Apps Script 중계의 store(내 드라이브 폴더 하나, 이름마다 파일 하나를 덮어씀)
 *     — 보기는 암호 없이, 올리기·지우기만 관리자 확인(관리자 구글 이메일, 이 브라우저에 기억) (2026-10-16 사용자 지정)
 *   사전제출자료·대사 자료: 이 브라우저 안에서만 읽는다(중계·GitHub 어디에도 보내지 않음)
 *   감사보고서 PDF: 공시뷰어가 주는 파일 이름 머리글을 중계가 읽지 못해 → 전자공시 화면을 새 창으로 연다 */
const PASS_KEY = 'qc.pass';
const getPass = () => { try { return localStorage.getItem(PASS_KEY) || ''; } catch { return ''; } };
const setPass = (v) => { try { if (v) localStorage.setItem(PASS_KEY, v); else localStorage.removeItem(PASS_KEY); } catch { /* */ } };
async function relayPost(payload) {
  const url = relayUrl(); if (!url) throw new ApiError(503, '전자공시 중계(구글 Apps Script) 주소가 없습니다(qc/static/relay_config.js).');
  let r; try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' }); }
  catch (e) { throw new ApiError(502, `중계(구글 Apps Script)에 연결하지 못했습니다: ${e.message || e}`); }
  let d; try { d = await r.json(); } catch { throw new ApiError(502, '중계의 응답을 읽지 못했습니다(웹 앱 액세스 권한이 「모든 사용자」인지 확인하세요).'); }
  if (!d.ok) throw new ApiError(/암호/.test(d.error || '') ? 401 : 502, d.error || '중계 오류');
  return d;
}
let ROLE = null;   /* { view, admin } */
async function role(force = false) {
  if (ROLE && !force) return ROLE;
  const pass = getPass(); if (!pass) return (ROLE = { view: true, admin: false });   /* 보기는 누구나 */
  try { const d = await relayPost({ op: 'auth', pass }); ROLE = { view: true, admin: !!d.admin }; } catch { ROLE = { view: true, admin: false }; }
  return ROLE;
}
/** 관리자 확인 — 관리자 구글 이메일 주소(이 브라우저에 기억). 서식·일정·명부를 올리거나 지울 때만 필요(2026-10-16 사용자 지정).
 *  주소는 사이트 코드에 두지 않고 중계(Apps Script)의 ADMIN_PASS 값과만 견준다(공개 저장소라). 맞으면 { view, admin } */
export async function askPass(message = '') {
  const { showPrompt, showAlert } = await import('./ui/dialog.js');
  setTimeout(() => { const i = document.querySelector('#kd-f0'); if (i) { i.type = 'email'; i.autocomplete = 'email'; } }, 0);
  const v = await showPrompt(`${message ? message + '\n\n' : ''}관리자 구글 이메일 주소를 입력하세요.\n서식·일정·명부를 올릴 때만 필요하며, 이 브라우저가 기억합니다.`, { title: '관리자 확인', placeholder: 'ooo@gmail.com', okText: '확인' });
  if (v == null) return ROLE || { view: true, admin: false };
  setPass(String(v).trim().toLowerCase()); const r = await role(true);
  if (!r.admin) { setPass(''); ROLE = null; await showAlert('관리자 이메일 주소가 아닙니다.', { title: '관리자 확인' }); }
  return r;
}
const STORE = new Map();
/* 보기는 암호 없이(2026-10-16 사용자 지정) — 기억된 관리자 암호가 있으면 같이 보낸다(옛 판 중계와도 맞게) */
async function storeGet(name) {
  if (STORE.has(name)) return STORE.get(name);
  const p = relayPost({ op: 'store_get', pass: getPass(), name }).then((d) => (d.exists ? d.data : ''))
    .catch((e) => { if (e.status === 401) throw new ApiError(401, '공유 자료를 열지 못했습니다 — 중계(구글 Apps Script)를 새 판(Code.gs)으로 다시 배포하면 암호 없이 열립니다.'); throw e; });
  STORE.set(name, p); p.catch(() => STORE.delete(name)); return p;
}
async function storePut(name, data) {
  if (!(await role()).admin) { const r = await askPass(); if (!r.admin) throw new ApiError(403, '관리자 확인(구글 이메일)이 필요합니다.'); }
  const d = await relayPost({ op: 'store_put', pass: getPass(), name, data }); STORE.set(name, Promise.resolve(data)); return d;
}
const jsonOf = async (name, empty) => { const t = await storeGet(name); try { return t ? JSON.parse(t) : empty; } catch { return empty; } };
/* 파이썬 한 번 부르기 — 오류는 서버와 같은 꼴(status·detail) */
async function py(fn, args) {
  if (!window.QcStatic || !window.QcStatic.sample) throw new ApiError(503, '브라우저 파이썬(qc/static/qc_static.js)이 없습니다.');
  let out; try { out = await window.QcStatic.sample(fn, args); } catch (e) { throw new ApiError(500, `처리 중 오류: ${e.message || e}`); }
  if (out && out.error) { const d = out.error.detail; const e = new ApiError(out.error.status, typeof d === 'string' ? d : (d && d.message) || '처리하지 못했습니다.', d); e.detail = d; throw e; }
  return out;
}
const fileB64 = async (f) => ({ name: f.name || '파일', b64: await b64of(f) });
const KINDS = { full: '상근용', part: '비상근용' };
const nowIso = () => new Date().toISOString().slice(0, 19) + '+00:00';
const binResponse = (o) => { const bin = atob(o.b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Response(new Blob([u], { type: o.type || 'application/octet-stream' }), { status: 200, headers: { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(o.name)}` } }); };
const jsonResponse = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
async function scheduleParts() { return { xlsx: await storeGet('schedule_xlsx'), settings: await jsonOf('settings_json', {}) }; }

async function sampleGet(path) {
  const [p, qs] = path.split('?'); const q = new URLSearchParams(qs || '');
  if (p === '/qc-sample/templates') {
    const out = [];
    for (const [kind, label] of Object.entries(KINDS)) { const m = await jsonOf(`tpl_${kind}_meta`, null); out.push({ kind, label, ready: !!m, name: m && m.name, size: m && m.size, date: m && m.date, by: m && m.by }); }
    return out;
  }
  if (p === '/qc-sample/schedule') { const { xlsx, settings } = await scheduleParts(); return py('schedule_view', [xlsx, settings]); }
  if (p === '/qc-sample/holidays') return py('holidays', [q.get('start'), q.get('end')]);
  if (p === '/qc-sample/registers') {
    const regs = {}; for (const k of ['prev', 'next', 'review', 'screened']) regs[k] = await jsonOf(`register_${k}`, null);
    return py('registers_view', [regs, q.get('firm') || '']);
  }
  if (p === '/finstmt/companies') return py('companies', [q.get('q') || '']);
  return null;
}
async function sampleUpload(path, fd) {
  const [p, qs] = path.split('?'); const q = new URLSearchParams(qs || ''); const fy = fd.get('fy') ? Number(fd.get('fy')) : null;
  if (p === '/qc-sample/parse') return py('parse', [fd.get('file').name, await b64of(fd.get('file')), fy]);
  if (p === '/qc-sample/reconcile') return py('reconcile', [await Promise.all(fd.getAll('files').map(fileB64)), fy]);
  if (p === '/qc-sample/other') return py('other', [await fileB64(fd.get('presubmit')), await Promise.all(fd.getAll('files').map(fileB64)), fy]);
  let m = /^\/qc-sample\/templates\/(full|part)$/.exec(p);
  if (m) {
    const f = fd.get('file'); const b64 = await b64of(f); await py('template_check', [f.name, b64]);
    const meta = { name: f.name, size: f.size, date: nowIso(), by: '관리자' };
    await storePut(`tpl_${m[1]}`, b64); await storePut(`tpl_${m[1]}_meta`, JSON.stringify(meta)); return { ok: true, ...meta };
  }
  if (p === '/qc-sample/schedule') {
    const f = fd.get('file'); const b64 = await b64of(f); const res = await py('schedule_check', [b64]);
    const settings = await jsonOf('settings_json', {}); settings.schedule = { name: f.name, date: nowIso(), by: '관리자' };
    await storePut('schedule_xlsx', b64); await storePut('settings_json', JSON.stringify(settings)); return res;
  }
  m = /^\/qc-sample\/registers\/(prev|next|review|screened)$/.exec(p);
  if (m) {
    const f = fd.get('file'); const mode = q.get('mode') || 'replace';
    const old = mode === 'append' ? await jsonOf(`register_${m[1]}`, null) : null;
    const r = await py('register_upload', [m[1], f.name, await b64of(f), mode, old]);
    await storePut(`register_${m[1]}`, JSON.stringify(r.register)); return r.result;
  }
  return null;
}
async function scheduleEdit(fn, args) {
  const { xlsx, settings } = await scheduleParts(); const r = await py(fn, fn === 'schedule_meetings' ? [settings, ...args] : [xlsx, settings, ...args]);
  if (JSON.stringify(r.settings) !== JSON.stringify(settings)) await storePut('settings_json', JSON.stringify(r.settings));
  return r.result;
}
/** qc_sample.js 의 call() 자리(서버 주소 /api/v1/… 를 그대로 받아 Response 꼴로 돌려준다) */
async function fetchRaw(url, options = {}) {
  const u = new URL(url, location.href); const p = u.pathname.replace(/^.*\/api\/v1/, ''); const q = u.searchParams;
  try {
    let m = /^\/qc-sample\/templates\/(full|part)$/.exec(p);
    if (m) { const b64 = await storeGet(`tpl_${m[1]}`); if (!b64) throw new ApiError(404, `${KINDS[m[1]]} 서식이 아직 없습니다. 관리자가 올려 주세요.`);
      const meta = await jsonOf(`tpl_${m[1]}_meta`, {}); return binResponse({ b64, name: meta.name || `in-depth_AR_Format_${KINDS[m[1]]}.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); }
    if (p === '/qc-sample/indepth') {
      const body = JSON.parse(options.body || '{}'); const tpl = await storeGet(`tpl_${body.kind}`);
      return binResponse(await py('indepth', [body, tpl]));
    }
    if (p === '/finstmt/dart/report-versions') return jsonResponse(await py('versions', [q.get('company'), +q.get('year'), q.get('basis') || 'indi', +(q.get('fiscal_month') || 12), q.get('corp_code') || '', q.get('auditor') || '']));
    if (p === '/qc-sample/opinion-basis') return jsonResponse(await py('opinion_basis', [q.get('company'), +q.get('year'), +(q.get('fiscal_month') || 12), q.get('corp_code') || '', q.get('auditor') || '']));
    m = /^\/qc-sample\/dart\/pdf\/(\d{14})$/.exec(p);
    if (m) { window.open(`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${m[1]}`, '_blank', 'noopener');
      throw new ApiError(409, '이 사이트에서는 PDF 를 바로 받지 못해 전자공시 화면을 새 창으로 열었습니다 — 그 화면의 [다운로드]로 받으세요.'); }
    throw only(p);
  } catch (e) { const err = new Error(e.message || String(e)); err.status = e.status || 500; err.detail = e.detail !== undefined ? e.detail : e.message; throw err; }
}
/** [품감] 심의안의 조직·개별 조서(엑셀) — 서버 /qc/workpaper 대신 */
export async function staticWorkpaper(kind, payload, templateBlob) {
  let tpl = '';
  if (kind === 'org') tpl = await b64of(templateBlob);
  else tpl = (await storeGet('tpl_full')) || (await storeGet('tpl_part'));
  const o = await py('workpaper', [kind, payload, tpl]);
  const r = binResponse(o); return { blob: await r.blob(), name: o.name };
}

export const api = {
  fetchRaw, askPass,
  async get(path) {
    if (path.startsWith('/qc-sample/') || path.startsWith('/finstmt/')) { const r = await sampleGet(path); if (r !== null) return r; throw only(path); }
    return qcApi.get(path);
  },
  async upload(path, fd) {
    if (path.startsWith('/qc-sample/')) { const r = await sampleUpload(path, fd); if (r !== null) return r; throw only(path); }
    return qcApi.upload(path, fd);
  },
  async put(path, body) {
    if (path === '/qc-sample/schedule/firm') return scheduleEdit('schedule_firm', [body, false]);
    if (path === '/qc-sample/schedule/meetings') return scheduleEdit('schedule_meetings', [body.rules || {}]);
    return qcApi.put(path, body);
  },
  async del(path) {
    if (path.startsWith('/qc-sample/schedule/firm')) return scheduleEdit('schedule_firm', [{ firm: new URLSearchParams(path.split('?')[1] || '').get('firm') || '' }, true]);
    return qcApi.del(path);
  },
  post: (...a) => qcApi.post(...a), patch: (...a) => qcApi.patch(...a), postBlob: (...a) => qcApi.postBlob(...a), downloadPost: (...a) => qcApi.downloadPost(...a),
};
/* 관리자 여부 = 관리자 암호를 넣었는가(중계가 확인). 이름은 없음(강조할 이름은 각자 [강조할 이름]으로) */
export const auth = { async me() { const r = await role(); return { id: 'github', name: 'GitHub', display_name: '', roles: r.admin ? ['admin'] : [] }; }, async logout() { setPass(''); ROLE = null; } };
