/* 「지금 보는 회사」 — 화면끼리 회사 정보를 물려주는 작은 보관함.
 *
 * 담당부서 요청(2026-08-27): 회생조회·예비심사청구를 오갈 때 회사명과
 * 사업자/법인등록번호를 다시 치지 않게 한다.
 *
 * ── 왜 localStorage 인가 ──
 * 업무 화면들은 iframe 안의 **별개 문서**라 포털의 JS 변수를 같이 못 본다.
 * 다만 전부 같은 출처(10.2.9.109:8000)라 localStorage 는 공유된다.
 * 서버에 두는 방법도 있지만 이건 "지금 이 사람이 보고 있는 회사"라는
 * 한때의 작업 맥락이지 보관할 자료가 아니다. 왕복도 필요 없다.
 *
 * ── 담는 것 ──
 *   name    회사명
 *   biz_no  사업자등록번호 (숫자만)
 *   crno    법인등록번호  (숫자만)
 * 세 칸을 따로 두는 이유: 화면마다 요구하는 번호가 다르다.
 * 회생조회는 법인등록번호로만 찾고, 예비심사청구는 둘 중 아무거나 받는다.
 */

const KEY = 'gumiho_company';

const digits = (v) => String(v ?? '').replace(/[^0-9]/g, '');

export function readCompany() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      name: String(raw.name || '').trim(),
      biz_no: digits(raw.biz_no),
      crno: digits(raw.crno),
    };
  } catch {
    return { name: '', biz_no: '', crno: '' };   // 사생활 보호 모드 등
  }
}

/* 넘긴 칸만 덮어쓴다. 회생조회는 법인등록번호만 알고 예비심사청구는
   사업자등록번호만 알 수 있어서, 통째로 갈아 끼우면 서로 지운다. */
export function writeCompany(patch) {
  const next = { ...readCompany() };
  if (patch.name !== undefined) next.name = String(patch.name || '').trim();
  if (patch.biz_no !== undefined) next.biz_no = digits(patch.biz_no);
  if (patch.crno !== undefined) next.crno = digits(patch.crno);

  // 전부 비면 아예 지운다. 빈 껍데기가 남아 있으면 화면이 "회사 있음"으로 오해한다.
  try {
    if (!next.name && !next.biz_no && !next.crno) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 저장 못 해도 이번 화면은 정상 동작한다 */
  }
  return next;
}

export function clearCompany() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* 무시 */ }
}

export function hasCompany(c = readCompany()) {
  return Boolean(c.name || c.biz_no || c.crno);
}

/* 사람이 읽는 한 줄. 헤더 표시와 복사에 같이 쓴다. */
export function companyLabel(c = readCompany()) {
  const no = c.biz_no ? formatBizNo(c.biz_no) : c.crno ? formatCrno(c.crno) : '';
  return [c.name, no].filter(Boolean).join(' · ');
}

export function formatBizNo(v) {
  const d = digits(v);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : d;
}

export function formatCrno(v) {
  const d = digits(v);
  return d.length === 13 ? `${d.slice(0, 6)}-${d.slice(6)}` : d;
}
