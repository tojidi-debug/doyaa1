/* 개별선정 → 신용정보 조회. 선정 회사의 사업자등록번호를 찾아 조회 화면으로 넘긴다.
 * 두 화면은 QC 틀 안의 별개 문서라 같은 출처 localStorage 로 건네고, 조회 화면이 받는 즉시 지운다. */
import { dartCompany } from './api.js';

export const CREPORT_QUEUE = 'qcCreport:queue';

const digits = (v) => String(v ?? '').replace(/\D/g, '');
const valid = (v) => { const d = digits(v); return d.length === 10 ? d : ''; };

/* 번호 찾기: ① 사전제출자료 2-3 ② 사내 재무 DB ③ 외감수임내역(이름 일치) ④ 전자공시 기업개황 */
export async function collectCreport(cards, { company, bizOf, register = [], nameKey }) {
  const out = new Map();
  for (const c of cards) {
    const name = String(company(c) || '').trim();
    const key = nameKey(name);
    let biz = valid(bizOf(c)) || valid(c.company && c.company.biz)
      || valid((register.find((i) => nameKey(i.company) === key && valid(i.biz_no)) || {}).biz_no);
    const corp = c.corp || (c.company && c.company.corp_code);
    if (!biz && corp) {
      try { biz = valid((await dartCompany(corp)).bizr_no); } catch { /* 못 찾으면 아래에서 알린다 */ }
    }
    const item = { biz, name, inq: /^\d{8}$/.test(String(c.baseDt || '')) ? c.baseDt : '' };
    out.set(biz || `name:${key}`, item);
  }
  return [...out.values()];
}

export function sendToCreport(list) {
  localStorage.setItem(CREPORT_QUEUE, JSON.stringify({ at: Date.now(), list }));
  if (window.top !== window) window.top.location.hash = 'creport';
  else location.href = './#creport';
}
