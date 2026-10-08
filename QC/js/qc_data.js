/* [품감] 심의안(회계법인) — 자료 모양 바꾸기(순수 함수, jsdom 시험 가능) (2026-10-08)
 *   grids(profile)        (붙임1) 두 표를 화면·엑셀 복사용 행렬로(서식과 같은 칸 차례)
 *   tsv(profile)          엑셀에 붙여넣을 탭 구분 글
 *   templateCtx(profile, inputs)  HwpxFill 에 줄 값(자리표시자 이름 = backend/scripts/qc_build_template.py 가 심은 것)
 * 값이 없으면 「-」. 숫자는 천 단위 쉼표. 짐작하지 않는다. */

export const DASH = '-';
/* 심의안 표기: 「회계법인나루」처럼 회계법인이 앞에 오면 「회계법인 나루」(한 칸), 「○○회계법인」은 그대로(사용자 지정 2026-10-08) */
export function firmName(n) { const s = String(n || '').trim(); return /^회계법인\S/.test(s) ? `회계법인 ${s.slice(4)}` : s; }

export function fmtMn(v) {
  if (v === null || v === undefined || v === '') return DASH;
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (n === 0) return DASH;   /* 0 은 「-」(사용자 지정, 2026-10-08) */
  const s = Math.abs(n).toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  return n < 0 ? `△${s}` : s;
}
export function fmtCnt(v) { return (v === null || v === undefined || Number(v) === 0) ? DASH : Number(v).toLocaleString('ko-KR'); }   /* 0 도 「-」 */
export function fmtRatio(v) { return (v === null || v === undefined) ? DASH : Number(v).toFixed(2); }

/* "2026.03" → "2026.3." · asOf → "’26. 3월말 현재" */
export function periodLabel(p) { const m = /^(\d{4})\.(\d{2})$/.exec(String(p || '')); return m ? `${m[1]}.${Number(m[2])}.` : (p || DASH); }
export function asOf(p) { const m = /^(\d{4})\.(\d{2})$/.exec(String(p || '')); return m ? `’${m[1].slice(2)}. ${Number(m[2])}월말 현재` : ''; }
/* 사업연도 글: 「제57기(2025.4.1.～2026.3.31.)」 */
export function fiscalText(profile) {
  const f = profile.fiscal || {}; const term = profile.term ? `제${profile.term}기` : '';
  const span = f.start && f.end ? `(${f.start}～${f.end})` : '';
  return term || span ? `${term}${span}` : DASH;
}

const two = (pair, fmt = fmtCnt) => [fmt((pair || [])[0]), fmt((pair || [])[1])];

/* 감리대상기간 = 그 회계법인의 사업연도(보고서의 「제N기(…～…)」). 없으면 결산월로 셈: 12월말 → 2025.1.1. ～ 2025.12.31., 3월말 → 2025.4.1. ～ 2026.3.31. */
export function fiscalSpan(p) {
  const f = (p && p.fiscal) || {};
  if (f.start && f.end) return `${f.start} ～ ${f.end}`;
  const m = /^(\d{4})\.(\d{2})$/.exec(String((p && p.period) || '')); if (!m) return '';
  const y = Number(m[1]), mo = Number(m[2]); const last = new Date(y, mo, 0).getDate();
  const sy = mo === 12 ? y : y - 1, sm = mo === 12 ? 1 : mo + 1;
  return `${sy}.${sm}.1. ～ ${y}.${mo}.${last}.`;
}

/* (붙임1) 표 — 서식의 칸 차례 그대로. 세로 라벨은 한 칸으로 */
export function grids(p) {
  const g = p.general || {}, ac = p.audit_counts || {}, st = p.staff || {}, fin = p.finance || {}, seg = p.segments || {};
  const cur = periodLabel(p.period), prev = periodLabel(p.prev_period);
  const indi = ac.indi || {}, con = ac.con || {};
  const general = {
    title: '□ 일반현황', unit: `(단위 : 사, 명, ${asOf(p.period)})`,
    rows: [
      ['대표이사', g.ceo || DASH, '자 본 금', g.capital_mn != null ? `${fmtMn(g.capital_mn)}백만원` : DASH],
      ['주사무소 소재지', g.head_office || DASH, '', ''],
      ['분사무소', g.branches || DASH, '설 립 일', g.founded || DASH],
      ['제휴법인명', g.alliance || DASH, 'PCAOB등록일', g.pcaob_date || DASH],
      ['감사실적', '사업연도', cur, prev, '인원현황', '사업연도', cur, prev],
      ['개별', '사업보고서발행법인', ...two(indi.issuer), '', '이 사', ...two(st.director)],
      ['', '기타', ...two(indi.other), '', '등록공인회계사', ...two(st.cpa)],
      ['', '합 계', ...two(indi.total), '', '수습공인회계사', ...two(st.trainee)],
      ['연결', '사업보고서발행법인', ...two(con.issuer), '', '소계', ...two(st.cpa_sub)],
      ['', '기 타', ...two(con.other), '', '기타 직원', ...two(st.staff)],
      ['', '합 계', ...two(con.total), '', '합 계', ...two(st.total)],
    ],
  };
  const sv = (k) => [fmtMn((seg[k] || {}).amount), fmtRatio((seg[k] || {}).ratio)];
  const finance = {
    title: '□ 재무현황', caption: `○ 사업연도 : ${fiscalText(p)}`, unit: '(단위 : 백만원, %)',
    rows: [
      ['주요재무상황', '사업연도', cur, prev, '부문별매출현황', '구 분', '금 액', '비 율'],
      ['', '총 자 산', ...two(fin.assets, fmtMn), '', '감사(외감)', ...sv('audit_ext')],
      ['', '부    채', ...two(fin.liabilities, fmtMn), '', '감사(비외감)', ...sv('audit_nonext')],
      ['', '자기자본', ...two(fin.equity, fmtMn), '', '소계', ...sv('audit_sub')],
      ['', '손해배상준비금', ...two(fin.reserve, fmtMn), '', '세무 업무', ...sv('tax')],
      ['', '매 출 액', ...two(fin.revenue, fmtMn), '', '컨설팅 등', ...sv('consulting')],
      ['', '당기순이익', ...two(fin.net_income, fmtMn), '', '합계', ...sv('total')],
    ],
  };
  /* □ 회계법인 개요 — 서식 표 밖의 별도 항목(사용자 지정 2026-10-08): 등록번호는 기업개황, 대표이사·품질관리 담당 이사는 사업보고서 이사 현황 */
  const overview = {
    title: '□ 회계법인 개요', unit: '(기업개황 · 이사의 경력 현황)',
    rows: [
      ['사업자등록번호', g.biz_no || DASH],
      ['법인등록번호', g.corp_no || DASH],
      ['(현) 대표이사', g.ceo || DASH],
      ['품질관리실장', g.qc_head || DASH, String(g.qc_head_source || '').replace(/\s*—\s*품질관리실장 이름이 보고서에 없음/, '')],   /* 셋째 칸은 화면에만 작게(엑셀 복사에는 안 들어감) */
    ],
  };
  return { overview, general, finance };
}

export function tsv(p) {
  const { overview, general, finance } = grids(p);
  const lines = [];
  lines.push(overview.title);
  overview.rows.forEach(r => lines.push(r.slice(0, 2).join('\t')));
  lines.push('');
  lines.push(general.title, general.unit);
  general.rows.forEach(r => lines.push(r.join('\t')));
  lines.push('');
  lines.push(finance.title, finance.caption, finance.unit);
  finance.rows.forEach(r => lines.push(r.join('\t')));
  const x = p.external_audit_count || [];
  lines.push('', `외부감사대상회사 수(개별 합계)\t당기 ${fmtCnt(x[0])}\t전기 ${fmtCnt(x[1])}`);
  return lines.join('\n');
}

/* HwpxFill 값 — 비면 「-」 (서식 칸이 비어 보이지 않게) */
export function templateCtx(p, inputs = {}) {
  const g = p.general || {}, ac = p.audit_counts || {}, st = p.staff || {}, fin = p.finance || {}, seg = p.segments || {};
  const indi = ac.indi || {}, con = ac.con || {};
  const pair = (obj, k, fmt = fmtCnt) => ({ [`${k}_당기`]: fmt((obj || [])[0]), [`${k}_전기`]: fmt((obj || [])[1]) });
  const f = p.fiscal || {};
  return {
    법인: {
      이름: firmName(p.corp_name || inputs.법인명) || DASH, 대표이사: g.ceo || DASH, 자본금: g.capital_mn != null ? fmtMn(g.capital_mn) : DASH,
      주사무소: g.head_office || DASH, 분사무소: g.branches || DASH, 설립일: g.founded || DASH, 제휴법인명: g.alliance || '없음',
      PCAOB등록일: g.pcaob_date || DASH, 사업자등록번호: inputs.사업자등록번호 || g.biz_no || '○○○-○○-○○○○○', 법인등록번호: inputs.법인등록번호 || g.corp_no || '○○○○○○-○○○○○○○',
    },
    기준: { 당기: periodLabel(p.period), 전기: periodLabel(p.prev_period), 현재: asOf(p.period), 사업연도: fiscalText(p) },
    감리: {
      대상기간: inputs.대상기간 || fiscalSpan(p) || DASH, 실시기간: inputs.실시기간 || '20XX. X. X. ～ 20XX. X. X.',
      담당: inputs.담당 || '감리팀장 ○○○ 외 1명', 선정일: inputs.선정일 || '20XX.X.X.',
    },
    감사실적: { ...pair(indi.issuer, '개별_발행'), ...pair(indi.other, '개별_기타'), ...pair(indi.total, '개별_합계'),
      ...pair(con.issuer, '연결_발행'), ...pair(con.other, '연결_기타'), ...pair(con.total, '연결_합계') },
    인원: { ...pair(st.director, '이사'), ...pair(st.cpa, '등록공인회계사'), ...pair(st.trainee, '수습공인회계사'), ...pair(st.cpa_sub, '소계'), ...pair(st.staff, '기타직원'), ...pair(st.total, '합계') },
    재무: { ...pair(fin.assets, '총자산', fmtMn), ...pair(fin.liabilities, '부채', fmtMn), ...pair(fin.equity, '자기자본', fmtMn), ...pair(fin.reserve, '손해배상준비금', fmtMn),
      ...pair(fin.revenue, '매출액', fmtMn), ...pair(fin.net_income, '당기순이익', fmtMn) },
    매출: Object.fromEntries(Object.entries({ 감사외감: 'audit_ext', 감사비외감: 'audit_nonext', 소계: 'audit_sub', 세무업무: 'tax', 컨설팅등: 'consulting', 합계: 'total' })
      .flatMap(([k, s]) => [[`${k}_금액`, fmtMn((seg[s] || {}).amount)], [`${k}_비율`, fmtRatio((seg[s] || {}).ratio)]])),
  };
}
