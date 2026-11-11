/* [과징금 산정] 처음 열었을 때 보이는 **예제** — 실제 부과 사례 8건 중 조치 연도·대상자가 가장 많은 사례 5
 * (7개 사업연도 · 회사 + 대표이사 + 재무임원 + 감사인 3곳, 구 별표8 2025.5.20. 개정분).
 *
 * 사용자 지정(2026-11-09): 화면을 열면 이 예제 값이 보이고, 입력을 고치면 그 브라우저(개인 PC)에 저장되어
 * 다음에는 저장된 값이 열린다. 「초기화」 단추가 저장값을 지우고 이 예제로 되돌린다.
 *
 * ⚠️ 위반금액·보수는 실제 사건의 값이다(성명은 원문에서 이미 가려진 표시). 개발서버 화면이라 운영에는 가지 않는다.
 *    운영으로 옮길 때는 이 파일을 합성 값으로 바꾸거나 `EXAMPLE_ON = false` 로 끈다.
 *
 * 이 값을 센 결과는 실사례 한글의 결정금액과 모두 같다(회사 313,900,000 · 대표이사 22,200,000 · 재무임원 9,700,000 ·
 * 감사인 2,700,000 / 3,600,000 / 10,200,000). 한글 표에는 2018년 회사 감경 합계가 97,882,661 로 적혀 있으나
 * 기본과징금 − 감경 = 과징금 산식에 맞는 값은 92,882,661 이다(원문의 오기로 보임).
 */
export const EXAMPLE_ON = true;

const TERMS = [18, 19, 20, 21, 22, 23, 24];
// 위반사항 「가. 매출 및 매입 허위계상 등」 — 연도별 유형(A·B·D)별 위반금액과 위반규모(중요도배수)
// 유형별 위반금액과 그 줄의 위반규모(배) — 같은 위반사항의 줄들의 배수를 합쳐 점수를 정한다(실사례 「중요도 산출근거」: 21기 A 6.77 + B 3.33 = 10.10)
const ROWS = {
  18: [['B', 15164516000, 4.03]], 19: [['B', 18543333586, 4.36]],
  20: [['A', 87507162, 0.10], ['B', 18188958628, 4.32]], 21: [['A', 6707676484, 6.77], ['B', 15025337178, 3.33]],
  22: [['A', 6707676484, 8.50], ['D', 10389170747, 0.78]], 23: [['A', 5144227061, 6.21]],
  24: [['A', 4292830213, 5.55], ['D', 3791282120, 0.32]],
};
const CEO = { 22: 213500000, 23: 390617200, 24: 294457680 };
const CFO = { 18: 321442360, 19: 340420960, 20: 304241960 };
const AUD = {
  18: ['감사인1', 9000000], 19: ['감사인1', 9000000], 20: ['감사인2', 12000000],
  21: ['감사인3', 12000000], 22: ['감사인3', 24000000], 23: ['감사인3', 34000000], 24: ['감사인3', 34000000],
};
const W3 = { 회사: [20, 21, 22, 23, 24], 대표이사: [22, 23, 24], 재무임원: [20] };   // 위반기간 3개 사업연도 초과(고의) 30% 가중
const TEXT_M7 = '회사가 감리결과 지적금액을 반영하여 재무제표를 수정함';
const TEXT_M11 = '과징금 부담능력이 현저히 저하된 경우(완전자본잠식·당기순손실·부도발생)에 해당하나 현금및현금성자산 등이 부과예정 과징금보다 커 부담능력 저하 회사 20% 감경에 10% 추가 감경을 적용함';
const TEXT_W3 = '위반기간이 3개 사업연도를 초과한 경우(고의인 경우에 한정)에 해당하여 30% 가중';
const TEXT_M1 = '직전 연도말 자산총액 또는 직전 3개년 평균매출 1천억원 미만에 해당하여 30% 감경';

const row = (on, pct, pcts, text = '', pick = '') => ({ on, pct, pcts, text, pick });
const all = (list, v) => Object.fromEntries(list.map((p) => [p, v]));

/** 저장 모양(`kamp_gwajingeum_v2`)과 같은 새 객체를 만든다 — 쓸 때마다 새로 만들어 서로 얽히지 않게 한다. */
export function sampleCase5() {
  let vid = 1;
  const cases = TERMS.map((t) => {
    const violations = ROWS[t].map(([type, amount, multiple]) => ({
      id: vid++, desc: '가. 매출 및 매입 허위계상 등', amount, type, motive: '고의', severe: 'new', group: '가', market: 1, multiple,   // 화면에는 「상」으로 보인다. 가공 매출·매입은 신 기준에서만 상 — 구 기준은 한글(중 2점)대로 센다
      who: { 대표이사: '고의상', 재무임원: '고의상', 담당임원: '', 감사: '', 감사인: '중과실' },
    }));
    const persons = [
      // 재직하지 않은 해에는 성명도 비운다 — (신) 기준은 성명만 있어도 기준금액 1억원의 대상이 된다.
      { role: '대표이사', name: CEO[t] ? '대표이사' : '', comp: CEO[t] || 0 }, { role: '재무임원', name: CFO[t] ? '재무임원' : '', comp: CFO[t] || 0 },
      { role: '담당임원', name: '', comp: 0 }, { role: '감사', name: '', comp: 0 }, { role: '감사인', name: AUD[t][0], comp: AUD[t][1] },
    ];
    const weight = {};
    const w3on = Object.keys(W3).filter((p) => W3[p].includes(t));
    if (w3on.length) weight.w3 = row(all(w3on, true), 30, all(w3on, 30), TEXT_W3);
    const ppl = ['회사', ...(CEO[t] ? ['대표이사'] : []), ...(CFO[t] ? ['재무임원'] : []), '감사인'];
    const mitigate = {
      m1: row(all(ppl, true), 30, all(ppl, 30), TEXT_M1),
      m7: row(all(ppl, true), 10, all(ppl, 10), TEXT_M7, TEXT_M7),
      m11: row({ 회사: true }, 20, { 회사: 30 }, TEXT_M11),
    };
    return { materiality: 0, persons, violations, weight, mitigate };
  });
  return {
    sampleId: 'case5', companyType: 'general', priorFine: 0, reporter: {},
    fiscalYears: TERMS.map((t) => ({ term: String(t), year: String(2000 + t) })),
    cases, activeYear: 0,
  };
}


/* ── 사례 4 — 위반사항 2개 · 조치연도 2개(제3기 2018 · 제4기 2019), 회사 + 前대표이사 + 감사인 ──────────────────────────
 * 기본 예제. 결정금액이 실사례 한글과 같다: 회사 65,300,000(18) · 72,400,000(19), 대표이사 6,500,000 · 7,200,000, 감사인 6,400,000 · 6,300,000.
 * 위반규모(배)는 위반사항별 값(가 6.74·6.95, 나 6.12·7.40)이고 모두 하(1점). 동기는 중과실. 가중 없음.
 * 감경: 회사 30%+30%+20%=80%, 대표이사 30%+30%=60%, 감사인 30%+30%+10%=70%. */
export const EXAMPLE_ID = 'case4v2';
export const EXAMPLE_NAME = '사례 4 — 위반사항 2개 · 조치연도 2개(제3기·제4기) · 회사·대표이사·감사인';
const V4 = [
  ['가. 매출 과대계상 등', { 18: [8562686774, 6.74], 19: [8766824274, 6.95] }, false],
  ['나. 재고자산 감모손실 및 유효기간 경과 재고 평가손실 과소계상', { 18: [7769032201, 6.12], 19: [9335267877, 7.40] }, true],   // 감사인은 나. 관련 감사절차 소홀
];
const CEO4 = { 18: 183060000, 19: 182963339 };
const AUD4 = { 18: 43000000, 19: 42000000 };

export function sampleCase4() {
  let vid = 1;
  const cases = [18, 19].map((t) => {
    const violations = V4.map(([desc, byYear, withAuditor]) => ({
      id: vid++, desc, amount: byYear[t][0], type: 'A', motive: '중과실', severe: false, group: '', market: 1, multiple: byYear[t][1],
      who: { 대표이사: '중과실', 재무임원: '', 담당임원: '', 감사: '', 감사인: withAuditor ? '중과실' : '' },
    }));
    const persons = [
      { role: '대표이사', name: '대표이사', comp: CEO4[t] }, { role: '재무임원', name: '', comp: 0 },
      { role: '담당임원', name: '', comp: 0 }, { role: '감사', name: '', comp: 0 }, { role: '감사인', name: '회계법인A', comp: AUD4[t] },   // 두 해 모두 같은 감사인이면 회계법인A(서로 다른 감사인이면 감사인1·감사인2…)
    ];
    const ppl = ['회사', '대표이사', '감사인'];
    const mitigate = {
      m1: row(all(ppl, true), 30, all(ppl, 30), '직전 연도말 자산총액 또는 직전 3개년 평균매출 1천억원 미만에 해당하여 30% 감경'),
      m5: row(all(ppl, true), 30, all(ppl, 30), '회사 감리·심사 착수통지 이전 수정공시'),
      m7: row({ 감사인: true }, 10, { 감사인: 10 }, '회사의 부정행위 징후를 먼저 발견해 포렌식 조사를 적극 요청하여 부정행위·회계처리 오류를 발견·시정하는 데 기여한 점을 고려', ''),
      m11: row({ 회사: true }, 20, { 회사: 20 }, '과징금 부담능력 저하(완전자본잠식·당기순손실)에 해당하여 20% 감경'),
    };
    return { materiality: 0, priorFine: 0, persons, violations, weight: {}, mitigate };
  });
  return {
    sampleId: 'case4v2', companyType: 'general', priorFine: 0, reporter: {},
    fiscalYears: [{ term: '3', year: '2018' }, { term: '4', year: '2019' }],
    cases, activeYear: 0,
  };
}

/** 지금 기본 예제 */
export const sampleState = sampleCase4;

/** 예전 예제(사례 5)의 값인가 — 예제가 바뀌었을 때 저장돼 있던 예전 예제·시험 값을 새 예제로 바꾸는 데 쓴다. */
export const looksLikeOldExample = (cases) => cases.some((c) => c.violations.some((v) => [15164516000, 18543333586, 6707676484, 5144227061].includes(v.amount)));
