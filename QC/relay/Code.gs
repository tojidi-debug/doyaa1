/**
 * [품감] 심의안 · 개별선정 — 전자공시 중계 + 공유 자료 보관(구글 Apps Script 웹 앱)   2026-10-15
 *
 * 왜 필요한가: GitHub 사이트(브라우저)는 전자공시(opendart.fss.or.kr · dart.fss.or.kr)를 직접 부를 수 없고(CORS),
 *            인증키·직원 명단을 공개 사이트에 둘 수도 없다. 이 스크립트가 키를 숨긴 채 대신 받아 주고,
 *            개별선정의 공유 자료(감리일정·명부·인뎁스 서식·관리자 조정 이력)는 「내 드라이브」 폴더 하나에 둔다
 *            (이름마다 파일 하나를 계속 덮어씀 · 새 파일·시트를 계속 만들거나 휴지통에 옛 판을 남기지 않음 ·
 *             품감 일정·명부 보기는 열람 암호, 서식은 누구나, 올리기는 관리자 이메일+관리자 암호 둘 다 확인).
 *
 * 스크립트 속성(프로젝트 설정 ⚙ → 스크립트 속성) — ※ 키·암호를 이 코드에 적지 마세요.
 *   DART_KEY    OpenDART 인증키(40자)                                   — 필수(기존)
 *   VIEW_PASS   열람 암호(팀원) — 품감 일정·명부를 볼 때만 묻는다. 인뎁스 서식은 암호 없이(2026-10-16)
 *   ADMIN_PASS  관리자 암호 — 공유 자료 올리기·고치기 때 사이트에서 관리자 이메일(사이트가 확인)과 이 암호를 둘 다 맞게 넣어야 관리자(2중 확인, 2026-10-16)
 *   ADMIN_EMAIL (선택) 관리자 구글 이메일 — 적어 두면 중계도 이메일을 한 번 더 견준다
 *   GEMINI_API_KEY  (선택) 구글 AI Studio API 키 — 심사·조서 검토의 [AI 보강·AI 종합 검토]. PROMPT 스크립트에 넣은 것과 같은 값 · 모델은 자동(그때 쓸 수 있는 가장 새 flash) — GEMINI_MODEL 은 특정 모델로 고정하고 싶을 때만
 *   FOLDER_ID   자료 폴더 ID — 비워 두면 처음 저장할 때 「QC_개별선정_공유자료」 폴더를 만들고 스스로 적는다
 *
 * 기능(op)
 *   ping · list · doc · company · dsab   — 2026-10-08 판 그대로(심의안 사이트가 쓴다. 바꾸지 않음)
 *   api      OpenDART 원문 API 중 list.json · company.json · document.xml 만 — 인증키는 이 스크립트가 붙인다
 *   web      공시뷰어(dart.fss.or.kr)의 정해진 주소만 GET — 감사보고서 PDF 받기(뷰어 → PDF 목록 → PDF, 쿠키는 사이트가 넘겨줌)
 *   wiki · kasb · ai   (2026-11-27 심사·조서 검토) 회계위키 MCP 조회 · 회계기준원 열람서비스 조문 · 구글 AI Studio(Gemini) — ai 는 열람 암호 필요, 키는 스크립트 속성 GEMINI_API_KEY
 *   auth     열람 암호 · 관리자(이메일+암호) 확인 → { view, admin }
 *   store_list · store_get        (열람 암호)   공유 자료 목록 · 하나 읽기 — 인뎁스 서식(tpl_…)만 암호 없이
 *   store_put · store_del         (관리자 이메일+암호) 공유 자료 덮어쓰기(POST) · 비우기
 *   개별선정의 사전제출자료·대사 자료·매출장은 여기로 보내지 않는다(브라우저 안에서만 읽고 버린다).
 *
 * 배포: 처음이면 배포 → 새 배포 → 유형 「웹 앱」 → 실행 사용자 「나」 · 액세스 권한 「모든 사용자」.
 *       고칠 때는 배포 → 배포 관리 → (연필) 편집 → 버전 「새 버전」 → 배포 — 이렇게 하면 웹 앱 URL 이 바뀌지 않는다.
 *       처음 store 를 쓸 때 드라이브 권한 승인 창이 한 번 뜬다(편집기에서 setupFolder 를 한 번 실행해 미리 승인해도 된다).
 */
const OPENDART = 'https://opendart.fss.or.kr/api/';
const DART = 'https://dart.fss.or.kr';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const API_PATHS = ['list.json', 'company.json', 'document.xml'];
const WEB_PATHS = [/^\/dsaf001\/main\.do$/, /^\/pdf\/download\/main\.do$/, /^\/pdf\/download\/pdf\.do$/];
const STORE_NAME = /^[A-Za-z0-9_.\-]{1,80}$/;
const MAX_BYTES = 40 * 1024 * 1024;      // 한 번에 돌려줄 원문·PDF 상한(웹 앱 응답 한도 안쪽)
const MAX_STORE = 20 * 1024 * 1024;      // 공유 자료 한 건 상한(글자 수)
const PART_CHARS = 3 * 1024 * 1024;     // 조각 하나 글자 수(한글이 섞여도 setContent 10MB 아래)
const PART_RE = /\.part\d+$/;            // 조각 파일 이름(목록에서 숨김)

function doGet(e) { return handle_((e && e.parameter) || {}); }

/* 큰 자료(공유 자료 저장)는 POST — 사이트가 Content-Type: text/plain 으로 JSON 을 보낸다(브라우저 사전 확인 요청이 없게) */
function doPost(e) {
  let p = {};
  try { p = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return out_({ ok: false, error: '요청 본문(JSON)을 읽지 못했습니다.' }); }
  return handle_(p);
}

function handle_(p) {
  try {
    const props = PropertiesService.getScriptProperties();
    const key = props.getProperty('DART_KEY');
    if (!key) return out_({ ok: false, error: '중계에 OpenDART 인증키가 없습니다(스크립트 속성 DART_KEY).' });
    if (p.op === 'ping') return out_({ ok: true, op: 'ping', version: '2026-11-27', store: true });

    // ── 2026-10-08 판(심의안) — 그대로 ──
    if (p.op === 'list') {
      need_(/^\d{8}$/.test(p.corp_code || ''), '고유번호(8자리)가 아닙니다.');
      need_(/^\d{8}$/.test(p.bgn_de || '') && /^\d{8}$/.test(p.end_de || ''), '조회 기간(YYYYMMDD)이 올바르지 않습니다.');
      const page = Math.min(Math.max(parseInt(p.page_no || '1', 10) || 1, 1), 20);
      const r = fetch_('list.json', { crtfc_key: key, corp_code: p.corp_code, bgn_de: p.bgn_de, end_de: p.end_de,
        pblntf_ty: 'F', last_reprt_at: 'N', page_count: '100', page_no: String(page), sort: 'date', sort_mth: 'desc' });
      return out_({ ok: true, data: JSON.parse(r.getContentText('UTF-8')) });
    }
    if (p.op === 'doc') {
      need_(/^\d{14}$/.test(p.rcept_no || ''), '14자리 접수번호가 아닙니다.');
      const r = fetch_('document.xml', { crtfc_key: key, rcept_no: p.rcept_no });
      return out_({ ok: true, b64: Utilities.base64Encode(r.getContent()) });
    }
    if (p.op === 'company') {
      need_(/^\d{8}$/.test(p.corp_code || ''), '고유번호(8자리)가 아닙니다.');
      const r = fetch_('company.json', { crtfc_key: key, corp_code: p.corp_code });
      return out_({ ok: true, data: JSON.parse(r.getContentText('UTF-8')) });
    }
    if (p.op === 'dsab') {   /* 서버 qc_audited.search_by_filer 와 같은 검색. 쪽마다 표 부분(tbody)과 [쪽/전체]만 돌려준다 */
      const filer = String(p.filer || '').replace(/\s+/g, '');
      need_(filer.length >= 2 && filer.length <= 60, '제출인명(회계법인명)이 올바르지 않습니다.');
      need_(/^\d{8}$/.test(p.start || '') && /^\d{8}$/.test(p.end || ''), '접수일 기간(YYYYMMDD)이 올바르지 않습니다.');
      const head = { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' };
      const main = UrlFetchApp.fetch(DART + '/dsab007/main.do?option=corp', { muteHttpExceptions: true, headers: head });
      let sc = main.getAllHeaders()['Set-Cookie'] || []; if (!Array.isArray(sc)) sc = [sc];
      const cookie = sc.map(c => String(c).split(';')[0]).join('; ');
      const pages = [];
      for (let page = 1; page <= 30; page++) {
        const r = UrlFetchApp.fetch(DART + '/dsab007/detailSearch.ax', { method: 'post', muteHttpExceptions: true,
          headers: Object.assign({ Referer: DART + '/dsab007/main.do', Cookie: cookie }, head),
          payload: { currentPage: String(page), maxResults: '100', maxLinks: '10', sort: 'date', series: 'desc',
            textCrpNm: '', textPresenterNm: filer, startDate: p.start, endDate: p.end, finalReport: 'recent' } });
        if (r.getResponseCode() !== 200) throw new Error('전자공시 검색 응답 ' + r.getResponseCode());
        const html = r.getContentText('UTF-8');
        const body = (html.match(/<tbody[\s\S]*?<\/tbody>/i) || [''])[0];
        const m = /\[(\d+)\/(\d+)\]/.exec(html);
        pages.push(body + (m ? ` [${m[1]}/${m[2]}]` : ''));
        if (!m || +m[1] >= +m[2] || !/rcpNo=\d{14}/.test(body)) break;
      }
      return out_({ ok: true, pages });
    }

    // ── 2026-10-15 추가(개별선정) ──
    if (p.op === 'api') {    /* OpenDART 원문 API — 사이트의 파이썬(Pyodide)이 서버와 같은 코드로 부른다. 인증키는 여기서만 붙인다 */
      need_(API_PATHS.indexOf(p.path) >= 0, '허용하지 않는 OpenDART 주소입니다: ' + p.path);
      const q = typeof p.params === 'string' ? JSON.parse(p.params || '{}') : (p.params || {});
      const params = {};
      Object.keys(q).forEach(k => { if (k !== 'crtfc_key' && /^[a-z_]{1,20}$/.test(k)) params[k] = String(q[k]).slice(0, 100); });
      params.crtfc_key = key;
      const r = UrlFetchApp.fetch(OPENDART + p.path + '?' + qs_(params), { muteHttpExceptions: true, followRedirects: true });
      const bytes = r.getContent();
      need_(bytes.length <= MAX_BYTES, '전자공시 응답이 너무 큽니다(' + Math.round(bytes.length / 1048576) + 'MB).');
      const ctype = String(r.getHeaders()['Content-Type'] || '');
      return out_({ ok: true, status: r.getResponseCode(), ctype, b64: Utilities.base64Encode(bytes) });
    }
    if (p.op === 'web') {    /* 공시뷰어 — 정해진 세 주소만, 리다이렉트는 사이트가 따라간다(쿠키를 이어 받으려고) */
      const m = /^https:\/\/dart\.fss\.or\.kr(\/[^?#]*)(\?[^#]*)?$/.exec(String(p.url || ''));
      need_(m && WEB_PATHS.some(re => re.test(m[1])), '허용하지 않는 공시뷰어 주소입니다.');
      const head = { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' };
      if (p.referer && String(p.referer).indexOf(DART + '/') === 0) head.Referer = String(p.referer).slice(0, 500);
      if (p.cookie) head.Cookie = String(p.cookie).replace(/[\r\n]/g, '').slice(0, 4000);
      const r = UrlFetchApp.fetch(String(p.url), { muteHttpExceptions: true, followRedirects: false, headers: head });
      const bytes = r.getContent();
      need_(bytes.length <= MAX_BYTES, '전자공시 응답이 너무 큽니다(' + Math.round(bytes.length / 1048576) + 'MB).');
      const all = r.getAllHeaders();
      let sc = all['Set-Cookie'] || []; if (!Array.isArray(sc)) sc = [sc];
      return out_({ ok: true, status: r.getResponseCode(), b64: Utilities.base64Encode(bytes), headers: {
        'content-type': String(all['Content-Type'] || ''), location: String(all['Location'] || ''),
        'content-disposition': String(all['Content-Disposition'] || ''), 'set-cookie': sc.map(String) } });
    }
    if (p.op === 'fetch') {         // 외부 사이트 주소의 문서·웹페이지 한 건(제출자료 대사(New)의 링크 첨부) — 열람 암호가 있는 사람만, 공개 http(s) 주소만
      need_(role_(props, p.pass, p.email) !== '', '열람 암호가 맞지 않습니다.');
      return out_(Object.assign({ ok: true }, fetchUrl_(String(p.url || ''))));
    }
    // ── 2026-11-27 판(심사·조서 검토) — 기준서 참고·AI 보강. 사이트(github.io)에서 직접 부를 수 없는 곳(CORS)을 대신 부른다 ──
    if (p.op === 'wiki') {          // 회계위키 MCP(https://accountingwiki.co.kr/api/mcp — 인증 없이 무료, 조회 전용). 출처 표기는 화면이 한다
      need_(WIKI_TOOLS.indexOf(String(p.tool || '')) >= 0, '허용하지 않는 회계위키 도구입니다.');
      return out_({ ok: true, data: wikiCall_(String(p.tool), p.args && typeof p.args === 'object' ? p.args : {}) });
    }
    if (p.op === 'kasb') {          // 회계기준원 회계기준열람서비스(db.kasb.or.kr) REST — 공개 조회만(목차·조문 전문)
      need_(KASB_PATH.test(String(p.path || '')), '허용하지 않는 주소입니다(기준서 목차·조문만).');
      return out_({ ok: true, data: kasbGet_(String(p.path)) });
    }
    if (p.op === 'ai') {            // 구글 AI Studio(Gemini) — 열람 암호가 있는 사람만(API 키 사용량 보호). 키는 스크립트 속성 GEMINI_API_KEY
      need_(role_(props, p.pass, p.email) !== '', '열람 암호가 맞지 않습니다.');
      return out_({ ok: true, data: geminiCall_(props, p) });
    }
    if (p.op === 'auth') {
      const who = role_(props, p.pass, p.email);
      return out_({ ok: true, view: who !== '', admin: who === 'admin' });
    }
    if (p.op === 'store_list' || p.op === 'store_get') {   // 품감 일정·명부는 열람 암호, 서식(tpl_)은 누구나(2026-10-16 사용자 지정)
      if (!(p.op === 'store_get' && openToAll_(p.name))) need_(role_(props, p.pass, p.email) !== '', '열람 암호가 맞지 않습니다.');
      const folder = folder_(props);
      if (p.op === 'store_list') {
        const out = []; const it = folder.getFiles();
        while (it.hasNext()) { const f = it.next(); if (f.isTrashed() || PART_RE.test(f.getName()) || f.getSize() === 0) continue; out.push({ name: f.getName(), size: f.getSize(), updated: f.getLastUpdated().toISOString() }); }
        return out_({ ok: true, items: out });
      }
      need_(STORE_NAME.test(p.name || ''), '자료 이름이 올바르지 않습니다.');
      const f = find_(folder, p.name);
      const data = readParts_(folder, p.name);
      if (!f || data === '') return out_({ ok: true, exists: false });
      return out_({ ok: true, exists: true, name: p.name, data: data, updated: f.getLastUpdated().toISOString(), size: data.length });
    }
    if (p.op === 'store_put' || p.op === 'store_del') {
      need_(role_(props, p.pass, p.email) === 'admin', '관리자 암호가 맞지 않습니다.');
      need_(STORE_NAME.test(p.name || '') && !PART_RE.test(p.name), '자료 이름이 올바르지 않습니다.');
      const lock = LockService.getScriptLock(); lock.waitLock(20000);
      try {
        const folder = folder_(props);
        // 늘 같은 파일을 덮어쓴다(2026-10-16 사용자 지정) — 새 파일을 계속 만들거나 휴지통에 옛 판을 남기지 않는다.
        // setContent 는 한 번에 10MB 까지라 큰 자료는 고정된 조각 파일(이름.part2 · .part3 …)에 나눠 덮어쓴다. 지우기는 내용을 비운다.
        const data = p.op === 'store_del' ? '' : String(p.data == null ? '' : p.data);
        need_(data.length <= MAX_STORE, '자료가 너무 큽니다(' + Math.round(data.length / 1048576) + 'MB, 20MB 까지).');
        const chunks = []; for (let i = 0; i < data.length; i += PART_CHARS) chunks.push(data.slice(i, i + PART_CHARS));
        if (!chunks.length) chunks.push('');
        for (let i = 0; ; i++) {
          const nm = i === 0 ? p.name : p.name + '.part' + (i + 1);
          const f = find_(folder, nm);
          if (i >= chunks.length) { if (!f) break; if (f.getSize() > 0) f.setContent(''); continue; }   // 남는 조각은 비워 둔다(지우지 않음)
          const g = f || (chunks[i] === '' ? null : folder.createFile(nm, ' ', MimeType.PLAIN_TEXT));   // 없을 때만 한 번 만든다
          if (g) g.setContent(chunks[i]);
        }
        if (p.op === 'store_del') return out_({ ok: true, deleted: true });
        return out_({ ok: true, name: p.name, size: data.length, updated: new Date().toISOString() });
      } finally { lock.releaseLock(); }
    }
    return out_({ ok: false, error: '알 수 없는 요청입니다.' });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

function role_(props, pass, email) {   // 관리자 = ADMIN_PASS (+ ADMIN_EMAIL 을 적었으면 이메일도, 대소문자·앞뒤 빈칸 무시) · VIEW_PASS = 열람 암호 (2026-10-16)
  const norm = (x) => String(x || '').trim().toLowerCase();
  const ae = norm(props.getProperty('ADMIN_EMAIL')), ap = String(props.getProperty('ADMIN_PASS') || '').trim();
  const v = String(props.getProperty('VIEW_PASS') || '').trim(), s = String(pass || '').trim();
  if (!s) return '';
  if (ap && s === ap && (!ae || norm(email) === ae)) return 'admin';
  if (v && s === v) return 'view';
  return '';
}
/* 인뎁스 서식(tpl_…)은 누구나 읽는다 — 품감 일정·설정·명부만 열람 암호(사용자 지정 2026-10-16) */
function openToAll_(name) { return /^tpl_/.test(String(name || '')); }
function folder_(props) {
  const id = props.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* 지워졌으면 새로 만든다 */ } }
  const f = DriveApp.createFolder('QC_개별선정_공유자료');
  props.setProperty('FOLDER_ID', f.getId());
  return f;
}
function readParts_(folder, name) {   // 조각까지 이어 읽기
  let out = ''; for (let i = 0; i < 20; i++) { const f = find_(folder, i === 0 ? name : name + '.part' + (i + 1)); if (!f) break; const t = f.getBlob().getDataAsString('UTF-8'); if (t === '' || t === ' ') { if (i === 0) return ''; break; } out += t; }
  return out;
}
function find_(folder, name) {
  const it = folder.getFilesByName(name); let best = null;
  while (it.hasNext()) { const f = it.next(); if (f.isTrashed()) continue; if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f; }
  return best;
}
/* 편집기에서 한 번 실행하면 드라이브 권한을 미리 승인하고 폴더를 만든다(선택) */
function setupFolder() { Logger.log(folder_(PropertiesService.getScriptProperties()).getUrl()); }

/* ── 회계위키 · 회계기준원 · Gemini 도우미 (2026-11-27) ─────────────────────────────────────────────── */
const WIKI_URL = 'https://accountingwiki.co.kr/api/mcp';
const WIKI_TOOLS = ['search', 'find_evidence', 'fetch', 'get_paragraphs', 'get_standard', 'get_qna', 'list_standards', 'get_related', 'get_topic', 'list_audit_cases', 'verify_quote', 'check_citations'];
const KASB_PATH = /^\/api\/(standard-indexes\/\d{1,5}|paragraphs\/\d{1,5}\/[A-Za-z0-9_-]{1,40})(\?searchWord=[^&#\s]{0,60})?$/;
const AI_FALLBACK = { flash: 'gemini-2.5-flash', lite: 'gemini-2.5-flash-lite' };   // 모델 목록을 못 받을 때만 쓰는 이름
const AI_MAX_FILE = 18 * 1024 * 1024, AI_MAX_FILES = 6;     // PROMPT 스크립트와 같은 상한(파일당 18MB · 6개)
const MAX_PROMPT = 150000;               // 글자 — 한 번에 보내는 상한

function cacheGet_(k) { try { return CacheService.getScriptCache().get(k); } catch (e) { return null; } }
function cachePut_(k, v, sec) { try { if (v.length < 90000) CacheService.getScriptCache().put(k, v, sec); } catch (e) { /* 캐시는 덤 */ } }
function md5_(t) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, t, Utilities.Charset.UTF_8)).replace(/[^A-Za-z0-9]/g, ''); }

/** 회계위키 MCP 도구 호출 → 도구가 돌려준 글(대개 JSON 글). 같은 질문은 6시간 캐시 */
function wikiCall_(tool, args) {
  const ck = 'wiki:' + md5_(tool + JSON.stringify(args));
  const hit = cacheGet_(ck);
  if (hit) return JSON.parse(hit);
  const r = UrlFetchApp.fetch(WIKI_URL, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Accept: 'application/json, text/event-stream', 'User-Agent': UA },
    payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }) });
  need_(r.getResponseCode() === 200, '회계위키 응답 ' + r.getResponseCode());
  const raw = r.getContentText('UTF-8');
  const m = raw.match(/^data:\s*(\{[\s\S]*\})\s*$/m) || raw.match(/(\{[\s\S]*\})/);
  need_(m, '회계위키 응답을 읽지 못했습니다.');
  const msg = JSON.parse(m[1]);
  need_(!msg.error, '회계위키: ' + String((msg.error && msg.error.message) || '오류'));
  const res = msg.result || {};
  const text = (res.content || []).map(function (c) { return c && c.text ? c.text : ''; }).join('\n');
  const out = { text: text, structured: res.structuredContent || null, isError: !!res.isError };
  cachePut_(ck, JSON.stringify(out), 21600);
  return out;
}

/** 회계기준원 열람서비스 REST(공개) — 목차·조문 전문. 1일 캐시 */
function kasbGet_(path) {
  const ck = 'kasb:' + md5_(path);
  const hit = cacheGet_(ck);
  if (hit) return JSON.parse(hit);
  const r = UrlFetchApp.fetch('https://db.kasb.or.kr' + path, { muteHttpExceptions: true, headers: { 'User-Agent': UA, Accept: 'application/json' } });
  need_(r.getResponseCode() === 200, '회계기준원 응답 ' + r.getResponseCode());
  const out = JSON.parse(r.getContentText('UTF-8'));
  cachePut_(ck, JSON.stringify(out), 86400);
  return out;
}

/** 지금 쓸 수 있는 가장 새 flash 모델을 자동으로 고른다 — 모델 목록 API 에서 정식 이름(gemini-N.N-flash / -flash-lite, 미리보기·실험·이미지·음성 제외)의 가장 높은 판. 6시간 캐시, 목록을 못 받으면 기본 이름. */
function flashModel_(key, lite) {
  const ck = 'gm_' + (lite ? 'lite' : 'flash'), hit = cacheGet_(ck);
  if (hit && hit !== '-') return hit;
  let pick = '';
  try {
    const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { muteHttpExceptions: true, headers: { 'x-goog-api-key': key } });
    if (r.getResponseCode() === 200) {
      const ver = function (n) { return parseFloat((/^gemini-(\d+(?:\.\d+)?)-/.exec(n) || [0, 0])[1]); };
      const names = (JSON.parse(r.getContentText('UTF-8')).models || []).filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0; })
        .map(function (m) { return String(m.name || '').replace(/^models\//, ''); })
        .filter(function (n) { return /^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(n) && (lite ? /-lite$/.test(n) : !/-lite$/.test(n)); });
      names.sort(function (a, b) { return ver(b) - ver(a); });
      pick = names[0] || '';
    }
  } catch (e) { /* 아래 기본 이름 */ }
  if (!pick) pick = AI_FALLBACK[lite ? 'lite' : 'flash'];
  cachePut_(ck, pick, 21600);
  return pick;
}

/** Gemini(구글 AI Studio) — PROMPT 스크립트(업종별 감사보고서 분석기)와 같은 방식: 스크립트 속성 GEMINI_API_KEY(+ 선택 GEMINI_MODEL),
 *  첨부는 PDF·이미지는 원본(inlineData), 텍스트·CSV·XLSX 는 글로 풀어 본문에 붙인다.
 *  { prompt, system?, json?, model?, temperature?, files?: [{ name, mimeType, base64 | text }] } → { text, model, usage } */
function geminiCall_(props, p) {
  const key = props.getProperty('GEMINI_API_KEY');
  need_(key, '중계에 AI Studio API 키가 없습니다(스크립트 속성 GEMINI_API_KEY).');
  const prompt = String(p.prompt || '');
  need_(prompt.length >= 5 && prompt.length <= MAX_PROMPT, '질문이 비었거나 너무 깁니다(' + prompt.length + '자, ' + MAX_PROMPT + '자까지).');
  const lite = /lite/i.test(String(p.model || ''));                       // 사이트가 「lite」를 청하면 가장 새 flash-lite, 아니면 가장 새 flash
  const fixed = String(props.getProperty('GEMINI_MODEL') || '').trim();    // 스크립트 속성에 적어 두면 그 모델로 고정(안 적으면 자동)
  const model = fixed || flashModel_(key, lite);
  const parts = [{ text: prompt }];
  const files = Array.isArray(p.files) ? p.files : [];
  need_(files.length <= AI_MAX_FILES, '첨부는 ' + AI_MAX_FILES + '개까지입니다.');
  files.forEach(function (f) {
    need_(f && f.name, '첨부파일 정보가 올바르지 않습니다.');
    const fp = geminiFilePart_(f);
    if (fp.inlineData) parts.push({ inlineData: fp.inlineData });
    if (fp.text) parts.push({ text: fp.text });
  });
  const body = { contents: [{ role: 'user', parts: parts }],
    generationConfig: { temperature: typeof p.temperature === 'number' ? Math.min(Math.max(p.temperature, 0), 1) : 0.2, maxOutputTokens: 16384 } };
  if (p.system) body.systemInstruction = { parts: [{ text: String(p.system).slice(0, 20000) }] };
  if (p.json) body.generationConfig.responseMimeType = 'application/json';
  let r = null, code = 0, used = model;
  [model, AI_FALLBACK[lite ? 'lite' : 'flash']].filter(function (m, i, a) { return a.indexOf(m) === i; }).some(function (m) {   // 고른 모델이 사라졌으면(404) 기본 이름으로 한 번 더
    r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(m) + ':generateContent', { method: 'post', contentType: 'application/json',
      muteHttpExceptions: true, headers: { 'x-goog-api-key': key }, payload: JSON.stringify(body) });
    code = r.getResponseCode(); used = m;
    if (code === 404) cachePut_('gm_' + (lite ? 'lite' : 'flash'), '-', 1);
    return code !== 404;
  });
  let j = {};
  try { j = JSON.parse(r.getContentText('UTF-8') || '{}'); } catch (e) { need_(false, 'AI 응답을 해석하지 못했습니다(HTTP ' + code + ').'); }
  need_(code === 200, 'AI Studio 응답 ' + code + ': ' + String((j.error && (j.error.message || j.error.type)) || '').slice(0, 200));
  const cand = (j.candidates || [])[0] || {};
  const text = ((cand.content || {}).parts || []).map(function (x) { return x.text || ''; }).join('\n').trim();
  need_(text, 'AI 가 답을 만들지 못했습니다(' + String(cand.finishReason || (j.promptFeedback && j.promptFeedback.blockReason) || '') + ').');
  return { text: text, model: used, usage: j.usageMetadata || null };
}

/** 첨부 한 개 → Gemini 요청 조각 (PROMPT 스크립트 prepareGeminiFilePart_ 와 같은 규칙) */
function geminiFilePart_(f) {
  const name = String(f.name || '첨부파일'), mime = String(f.mimeType || '').toLowerCase(), lower = name.toLowerCase();
  if (typeof f.text === 'string' && f.text) return { text: fileText_(name, f.text) };                          // 브라우저가 이미 글로 푼 것(엑셀 표 등)
  need_(f.base64, name + ': 내용이 비었습니다.');
  need_(String(f.base64).length * 0.75 <= AI_MAX_FILE, name + ' 파일이 18MB 를 넘습니다.');
  if (mime === 'application/pdf' || mime.indexOf('image/') === 0) return { inlineData: { mimeType: f.mimeType, data: f.base64 } };
  if (mime.indexOf('text/') === 0 || /\.(txt|csv)$/.test(lower)) return { text: fileText_(name, Utilities.newBlob(Utilities.base64Decode(f.base64)).getDataAsString('UTF-8')) };
  if (/\.xlsx$/.test(lower) || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return { text: fileText_(name, extractXlsxText_(f)) };
  return { text: '[첨부파일 처리 안내]\n' + name + '\n- 이 형식(' + (f.mimeType || '알 수 없음') + ')은 AI 에 직접 붙일 수 없어 본문에서 뺐습니다. PDF·이미지·TXT·CSV·XLSX 로 바꿔 올려 주세요.' };
}
function fileText_(name, text) {
  const limit = 180000, v = String(text || '').trim();
  return '[첨부파일 텍스트: ' + name + ']\n' + (v.length > limit ? v.slice(0, limit) + '\n...[길어서 앞부분 ' + limit + '자만 포함]' : v || '(추출된 텍스트 없음)');
}
/* XLSX → 글 (PROMPT 스크립트의 extractXlsxText_ 와 같은 방법: zip 을 풀어 sharedStrings·sheet XML 을 읽는다) */
function extractXlsxText_(f) {
  try {
    const blobs = Utilities.unzip(Utilities.newBlob(Utilities.base64Decode(f.base64 || ''), f.mimeType, f.name));
    const map = {};
    blobs.forEach(function (b) { map[b.getName()] = b.getDataAsString('UTF-8'); });
    const shared = [];
    (String(map['xl/sharedStrings.xml'] || '').match(/<si[\s\S]*?<\/si>/g) || []).forEach(function (si) {
      shared.push((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(function (t) { return xmlDecode_(t.replace(/<[^>]+>/g, '')); }).join(''));
    });
    const out = [];
    Object.keys(map).filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/i.test(n); }).sort().slice(0, 8).forEach(function (sn, idx) {
      out.push('\n[Sheet ' + (idx + 1) + ': ' + sn + ']');
      const rows = [];
      (String(map[sn] || '').match(/<row[\s\S]*?<\/row>/g) || []).slice(0, 3000).forEach(function (rowXml) {
        const cells = (rowXml.match(/<c[\s\S]*?<\/c>/g) || []).map(function (c) {
          const type = ((c.match(/\st="([^"]+)"/) || [])[1] || '').trim();
          const vm = c.match(/<v[^>]*>([\s\S]*?)<\/v>/), im = c.match(/<t[^>]*>([\s\S]*?)<\/t>/);
          let v = vm ? vm[1] : (im ? im[1] : '');
          if (type === 's') v = shared[Number(v)] || '';
          return xmlDecode_(String(v).replace(/<[^>]+>/g, ''));
        });
        if (cells.some(function (x) { return String(x).trim(); })) rows.push(cells.join('\t'));
      });
      out.push(rows.join('\n'));
    });
    return out.join('\n');
  } catch (e) { return '[XLSX 글 추출 실패] ' + e.message + ' — CSV 또는 PDF 로 바꿔 다시 올려 주세요.'; }
}
function xmlDecode_(t) { return String(t || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }

/** 외부 주소 한 건 받기 — 내부망·메타데이터 주소는 막는다. 결과 { status, ctype, name, b64 } */
function fetchUrl_(url) {
  const m = /^(https?):\/\/([^\/:?#@]+)(:\d{1,5})?(\/[^#]*)?(#.*)?$/i.exec(url.trim());
  need_(m, '주소가 올바르지 않습니다(http:// 또는 https:// 로 시작).');
  const host = m[2].toLowerCase();
  need_(!/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/.test(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host) && host.indexOf('[') < 0 && host.indexOf('.') > 0, '허용하지 않는 주소입니다(공개 사이트의 도메인 주소만).');
  const r = UrlFetchApp.fetch(url.trim(), { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' } });
  const bytes = r.getContent();
  need_(r.getResponseCode() < 400, '그 주소가 응답하지 않습니다(HTTP ' + r.getResponseCode() + ').');
  need_(bytes.length <= MAX_BYTES, '받을 파일이 너무 큽니다(' + Math.round(bytes.length / 1048576) + 'MB).');
  const h = r.getHeaders(), ctype = String(h['Content-Type'] || h['content-type'] || ''), cd = String(h['Content-Disposition'] || h['content-disposition'] || '');
  let name = '';
  const fm = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
  if (fm) { try { name = decodeURIComponent(fm[1]); } catch (e) { name = fm[1]; } }
  if (!name) name = decodeURIComponent((m[4] || '').split('?')[0].split('/').filter(String).pop() || '') || host;
  return { status: r.getResponseCode(), ctype: ctype, name: name.slice(0, 120), b64: Utilities.base64Encode(bytes) };
}

function fetch_(path, params) {
  const r = UrlFetchApp.fetch(OPENDART + path + '?' + qs_(params), { muteHttpExceptions: true, followRedirects: true });
  if (r.getResponseCode() !== 200) throw new Error('전자공시 응답 ' + r.getResponseCode());
  return r;
}
function qs_(params) { return Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&'); }
function need_(ok, msg) { if (!ok) throw new Error(msg); }
function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
