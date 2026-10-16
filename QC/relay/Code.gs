/**
 * [품감] 심의안 · 개별선정 — 전자공시 중계 + 공유 자료 보관(구글 Apps Script 웹 앱)   2026-10-15
 *
 * 왜 필요한가: GitHub 사이트(브라우저)는 전자공시(opendart.fss.or.kr · dart.fss.or.kr)를 직접 부를 수 없고(CORS),
 *            인증키·직원 명단을 공개 사이트에 둘 수도 없다. 이 스크립트가 키를 숨긴 채 대신 받아 주고,
 *            개별선정의 공유 자료(감리일정·명부·인뎁스 서식·관리자 조정 이력)는 「내 드라이브」 폴더 하나에 둔다
 *            (이름마다 파일 하나를 계속 덮어씀 · 새 파일·시트를 계속 만들거나 휴지통에 옛 판을 남기지 않음 ·
 *             품감 일정·명부 보기는 열람 암호, 서식은 누구나, 올리기는 관리자 이메일 확인).
 *
 * 스크립트 속성(프로젝트 설정 ⚙ → 스크립트 속성) — ※ 키·암호를 이 코드에 적지 마세요.
 *   DART_KEY    OpenDART 인증키(40자)                                   — 필수(기존)
 *   VIEW_PASS   열람 암호(팀원) — 품감 일정·명부를 볼 때만 묻는다. 인뎁스 서식은 암호 없이(2026-10-16)
 *   ADMIN_PASS  관리자 구글 이메일 주소(예: ooo@gmail.com) — 공유 자료 올리기·고치기 때 사이트에서 이 주소를 넣으면 관리자(2026-10-16)
 *   FOLDER_ID   자료 폴더 ID — 비워 두면 처음 저장할 때 「QC_개별선정_공유자료」 폴더를 만들고 스스로 적는다
 *
 * 기능(op)
 *   ping · list · doc · company · dsab   — 2026-10-08 판 그대로(심의안 사이트가 쓴다. 바꾸지 않음)
 *   api      OpenDART 원문 API 중 list.json · company.json · document.xml 만 — 인증키는 이 스크립트가 붙인다
 *   web      공시뷰어(dart.fss.or.kr)의 정해진 주소만 GET — 감사보고서 PDF 받기(뷰어 → PDF 목록 → PDF, 쿠키는 사이트가 넘겨줌)
 *   auth     열람 암호·관리자 이메일 확인 → { view, admin }
 *   store_list · store_get        (열람 암호)   공유 자료 목록 · 하나 읽기 — 인뎁스 서식(tpl_…)만 암호 없이
 *   store_put · store_del         (관리자 이메일) 공유 자료 덮어쓰기(POST) · 비우기
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
    if (p.op === 'ping') return out_({ ok: true, op: 'ping', version: '2026-10-16', store: true });

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
    if (p.op === 'auth') {
      const who = role_(props, p.pass);
      return out_({ ok: true, view: who !== '', admin: who === 'admin' });
    }
    if (p.op === 'store_list' || p.op === 'store_get') {   // 품감 일정·명부는 열람 암호, 서식(tpl_)은 누구나(2026-10-16 사용자 지정)
      if (!(p.op === 'store_get' && openToAll_(p.name))) need_(role_(props, p.pass) !== '', '열람 암호가 맞지 않습니다.');
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
      need_(role_(props, p.pass) === 'admin', '관리자 이메일 주소가 아닙니다.');
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

function role_(props, pass) {   // ADMIN_PASS = 관리자 구글 이메일(대소문자·앞뒤 빈칸 무시) · VIEW_PASS = 열람 암호 (2026-10-16)
  const norm = (x) => String(x || '').trim().toLowerCase();
  const a = norm(props.getProperty('ADMIN_PASS')), v = String(props.getProperty('VIEW_PASS') || '').trim(), s = String(pass || '').trim();
  if (!s) return '';
  if (a && norm(s) === a) return 'admin';
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

function fetch_(path, params) {
  const r = UrlFetchApp.fetch(OPENDART + path + '?' + qs_(params), { muteHttpExceptions: true, followRedirects: true });
  if (r.getResponseCode() !== 200) throw new Error('전자공시 응답 ' + r.getResponseCode());
  return r;
}
function qs_(params) { return Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&'); }
function need_(ok, msg) { if (!ok) throw new Error(msg); }
function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
