/**
 * [품감] 심의안 — OpenDART 중계(구글 Apps Script 웹 앱)  2026-10-08
 *
 * 왜 필요한가: GitHub 사이트(브라우저)는 전자공시(opendart.fss.or.kr)를 직접 부를 수 없고(CORS),
 *            인증키를 공개 사이트에 둘 수도 없다. 이 스크립트가 키를 숨긴 채 대신 받아 준다.
 * 인증키 자리: 프로젝트 설정(⚙) → 스크립트 속성 → 속성 이름 DART_KEY, 값 = OpenDART 인증키(40자).
 *            ※ 키를 이 코드에 적지 마세요. 코드가 아니라 스크립트 속성에만 둡니다.
 * 허용 기능: list(회계법인사업보고서 목록) · doc(사업보고서 원문 zip) · company(기업개황) — OpenDART(키 사용)
 *           dsab(공시통합검색: 제출인명으로 감사보고서 목록, 외감회사대사용) — dart.fss.or.kr(키 없이 열린 검색)
 * 배포: 배포 → 새 배포 → 유형 「웹 앱」 → 실행 사용자 「나」 · 액세스 권한 「모든 사용자」 → 웹 앱 URL 을 사이트에 등록.
 */
const OPENDART = 'https://opendart.fss.or.kr/api/';
const DART = 'https://dart.fss.or.kr';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    const key = PropertiesService.getScriptProperties().getProperty('DART_KEY');
    if (!key) return out_({ ok: false, error: '중계에 OpenDART 인증키가 없습니다(스크립트 속성 DART_KEY).' });
    if (p.op === 'ping') return out_({ ok: true, op: 'ping' });
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
    return out_({ ok: false, error: '알 수 없는 요청입니다.' });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

function fetch_(path, params) {
  const qs = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  const r = UrlFetchApp.fetch(OPENDART + path + '?' + qs, { muteHttpExceptions: true, followRedirects: true });
  if (r.getResponseCode() !== 200) throw new Error('전자공시 응답 ' + r.getResponseCode());
  return r;
}
function need_(ok, msg) { if (!ok) throw new Error(msg); }
function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
