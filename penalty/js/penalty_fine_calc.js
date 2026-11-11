/* [과징금 산정]의 **셈** — 화면(DOM)도 법령 숫자도 없다. 숫자는 전부 `penalty_fine_rules.js` 에서 온다.
 *
 * 입력 한 해치(`computeYear`)를 받아 대상자별 과징금을 돌려준다. 화면은 이것을 부르기만 한다.
 * DOM 을 안 쓰므로 `node` 에서 그대로 시험한다(`penalty_fine_calc.test.mjs`).
 *
 * ## 흐름 (별표8)
 *
 *   회사      위반사항마다 중요도 점수 → 부과기준율 → 기본과징금(기준금액 × 율)을 구해 **합산**
 *   관계자    위반사항별 점수를 **회사 기준금액으로 가중평균**한 점수 하나로 율을 정하고 보수에 곱한다
 *   감사인    관계자와 같다. 기준금액이 감사보수일 뿐이다
 *
 *   → (기본과징금 + 가중 − 감경) → 한도와 견주어 작은 쪽 → 기처분액 차감 → 10만원 절사
 *
 * ## 실사례 8건과 맞대어 확인한 규칙 (2026-11-06)
 *
 *   · 「상」(위법행위 내용 3점)은 **고의일 때만**이다. 회사는 위반사항의 `severe`, 관계자·감사인은 자기 칸의 `고의상` —
 *     같은 위반사항이라도 대표이사는 중(2), 횡령에 관여한 재무임원은 상(3)일 수 있다(실사례).
 *   · 관계자·감사인은 같은 `group`(위반사항 가의 세부 항목 가-1·가-2)의 같은 위법행위 내용끼리 합쳐 위반규모를 센다.
 *   · 「중과실」은 **위법행위 내용 항목만** 하(1점)로 본다. 위반규모·회사유형·시장영향은 그대로 센다.
 *     (실사례 감사인이 중과실인데 위반규모 중(2점)으로 점수가 나왔다.)
 *   · 관계자 한도는 **회사 결정금액(10만원 절사 뒤)** 의 10% 이고, 관계자 금액을 한 번 더 절사한다.
 *   · 관계자 기준금액에 **1억원 하한은 없다**(실사례에 3천6백만원 감사가 있다).
 *   · 위반사항별 기본과징금·가중·감경 금액은 원 단위 **반올림**(실사례 한글 표가 그렇다). 관계자·감사인의 기본과징금은 원 미만 절사.
 *   · 회사 한도는 위반금액 원금이 아니라 **환산한 기준금액** 합계의 20% 로 셌다.
 *
 * ⚠️ 위 표의 근거가 되는 사실은 실사례 8건뿐이다. 새 사례가 어긋나면 먼저 이 규칙을 의심한다.
 */
import { OLD_RULES, ROUND_UNIT } from './penalty_fine_rules.js';

/* ⚠️ 셈의 모든 함수는 **기준 묶음 `R`** 을 받는다(기본값 (구)). 같은 입력을 (구)·(신) 두 묶음으로 세서 견주려는 것이다.
 *    묶음의 모양은 `penalty_fine_rules.js` 의 `OLD_RULES` 와 `penalty_new_rules.js` 의 `NEW_RULES` 를 본다. */

const EPS = 1e-9;
const won = (x) => Math.round(x + EPS);
const down = (x) => Math.floor(x + EPS);
const cutUnit = (x) => Math.max(Math.floor((x + EPS) / ROUND_UNIT) * ROUND_UNIT, 0);

export const levelOfType = (id, R = OLD_RULES) => (R.COMPANY_TYPES.find((t) => t.id === id) || { level: 1 }).level;

/** 점수(×10) → 부과기준율. 회사는 비율, 그 밖은 기준금액에 곱하는 배율이다. */
export function rateFor(tenths, isCompany, R = OLD_RULES) {
  for (const row of R.RATE_TABLE) if (tenths + EPS >= row.min) return isCompany ? row.company : row.other;
  return isCompany ? 0.02 : 0.5;
}

/**
 * 위반규모를 **배수로 직접 적었을 때**의 점수 — 16배 이상 3, 8배 이상 2, 그 아래 1. 배수가 비었으면 0(=자동 셈으로 넘어감).
 * 실사례의 위반규모는 유형별 중요성(규모조정계수 등)으로 따로 구한 「중요도배수」(예: 4.03배)라서 한 중요성 기준금액으로는 재현되지 않는다.
 */
export function scaleByMultiple(multiple, R = OLD_RULES) {
  const m = Number(multiple);
  if (!(m > 0)) return 0;
  if (m >= R.SCALE_MULTIPLE.high) return 3;
  if (m >= R.SCALE_MULTIPLE.mid) return 2;
  return 1;
}

/** 위반규모 점수 — 배수 → 1·2·3. 중요성 기준금액이 없으면 가릴 수 없어 하(1)로 둔다. */
export function scaleLevelOf(baseAmount, materiality, R = OLD_RULES) {
  if (!(materiality > 0)) return 1;
  const multiple = baseAmount / materiality;
  if (multiple >= R.SCALE_MULTIPLE.high) return 3;
  if (multiple >= R.SCALE_MULTIPLE.mid) return 2;
  return 1;
}

/** 관여자 칸의 값: 고의 · 고의상(고의이면서 위법행위 내용 「상」) · 중과실. 빈 칸이면 관여하지 않는다. */
const isOn = (w) => w === '고의' || w === '중과실' || w === '고의상' || w === '고의상신';
const motiveOf = (w) => (w === '고의상' || w === '고의상신' ? '고의' : w);

/**
 * 「상」 표시가 이 기준에서 상(3점)인가. 표시는 둘이다 — `true`(고의상) 는 (구)·(신) 모두 상,
 * `'new'`(고의상신) 는 (신) 기준에서만 상(가공자산·은폐조작·장부 위변조·감사인 자료 위변조 — (구)에서는 중).
 */
export const severeIn = (R, mark) => mark === true || mark === '고의상' || ((mark === 'new' || mark === '고의상신') && !!R.SEVERE_NEW_ITEMS);
/** 관여자 칸 값이 「상」 표시인가(기준과 무관하게) — 화면에서 가중 ⑥ 안내를 띄울 때 쓴다. */
/**
 * 관계자·감사인 칸의 「고의·상」이 이 기준에서 상(3점)인가. 칸 값은 둘이지만 화면에는 「고의·상」 하나로 보인다.
 *   · `고의상`   → 위반사항의 「상」 칸을 따른다: `상(신)`(신 기준에서만 상)이면 (신)에서만 상, 그 밖에는 (구)·(신) 모두 상.
 *   · `고의상신` → (신)에서만 상(예전에 저장된 값).
 */
export const severePerson = (R, w, v) => (w === '고의상신' ? severeIn(R, w)
  : w === '고의상' ? (v && v.severe === 'new' ? !!R.SEVERE_NEW_ITEMS : true) : false);

export const hasSevereMark = (mark) => mark === true || mark === 'new' || mark === '고의상' || mark === '고의상신';

/**
 * 위법행위 내용 점수 — 중과실은 「하」(1), 고의는 「중」(2), 고의이면서 횡령·불공정거래 등 「상」이면 3.
 * ⚠️ 「상」 표시가 있어도 **중과실이면 하**다(실사례: 중과실 감사의 횡령 연관 위반이 1점으로 셈됐다).
 */
export const contentOf = (motive, severe) => (motive === '고의' ? (severe ? 3 : 2) : 1);

/** 위반사항별로 환산한 기준금액과 중요도 점수(회사 기준). */
export function violationRows(input, R = OLD_RULES) {
  const typeLevel = levelOfType(input.companyType, R);
  // 회사 동기가 과실이어도 관계자·감사인이 고의·중과실로 관여한 줄은 센다(감사인 조치만 있는 사건). 회사 몫은 `computeYear` 가 회사 동기로 다시 거른다.
  const live = (input.violations || []).filter((v) => (v.amount || 0) > 0 && (isOn(v.motive) || Object.values(v.who || {}).some(isOn)));

  // D유형은 합계가 중요성 기준금액의 6배를 넘지 못한다 — 넘으면 비율로 줄인다.
  const dSum = live.filter((v) => v.type === 'D').reduce((s, v) => s + v.amount, 0);
  const dCap = input.materiality > 0 ? input.materiality * R.D_TYPE_CAP_MULTIPLE : Infinity;
  const dRatio = dSum > dCap ? dCap / dSum : 1;

  // 같은 위반사항을 유형(A·B·D)별로 나눠 적은 줄(이름이 같은 줄)은 위반규모(배)를 **줄마다 따로 적고 합쳐서** 점수를 정한다 —
  // 실사례: A 6.77배 + B 3.33배 = 10.10배(중). 합친 배수로 각 줄이 같은 위반규모 점수를 받는다.
  const multByDesc = new Map();
  for (const v of live) if (v.multiple > 0) { const k = String(v.desc || '').trim(); multByDesc.set(k, (multByDesc.get(k) || 0) + Number(v.multiple)); }
  return live.map((v) => {
    const raw = v.type === 'D' ? v.amount * dRatio : v.amount;
    const base = raw / (R.TYPE_DIVISOR[v.type] || 1);
    const scale = v.scaleLevel || (v.multiple > 0 ? scaleByMultiple(multByDesc.get(String(v.desc || '').trim()), R) : 0) || scaleLevelOf(base, input.materiality, R);
    const market = v.market || 1;
    const content = contentOf(v.motive, severeIn(R, v.severe));
    const tenths = content * R.SCORE_WEIGHT.content + scale * R.SCORE_WEIGHT.scale
      + typeLevel * R.SCORE_WEIGHT.type + market * R.SCORE_WEIGHT.market;
    const rate = rateFor(tenths, true, R);
    return { v, base, scale, market, content, typeLevel, tenths, rate, basic: won(base * rate) };
  });
}

/* ── 가중·감경 ──────────────────────────────────────────────────── */

/** 사유의 율(%) — 고정율 사유는 규정값만, 그 밖은 대상자마다 따로 적은 값(없으면 사유 기본값). */
const pctOf = (r, row, party) => (r.fixed ? r.pct : Number(row.pcts && row.pcts[party] !== undefined ? row.pcts[party] : row.pct) || 0);

const cell = (state, id, party) => {
  const row = state && state[id];
  if (!row || !row.on || !row.on[party]) return null;
  return row;
};

/**
 * 위반기간 가중 (신, 별표8 3.가.2)) — 위반동기별로 센다.
 *   고의 : 기본과징금 중 고의분 × 30% × (고의 위반 사업연도 수 − 1)
 *   중과실: 기본과징금 중 중과실분 × 20% × (중과실 위반 사업연도 수 − 2)
 * 두 값을 더하고, 가중된 과징금(기본+이 금액)이 **각 사업연도 기본과징금의 합계**를 넘지 못하게 자른다.
 * 사업연도 수와 합계는 해마다 따로 센 결과가 있어야 알 수 있어 `ctx.period` 로 받는다(`computeAll`).
 */
function periodAmount(R, ctx, party, basic, intentBasic) {
  const pc = R.PERIOD && ctx && ctx.period ? ctx.period[ctx.periodKey || party] : null;
  if (!pc) return { amount: 0, intent: 0, gross: 0, years: { intent: 0, gross: 0 }, cap: 0 };
  const grossBasic = Math.max(basic - intentBasic, 0);
  const n = (key) => Math.max((pc.years[key] || 0) - R.PERIOD[key].over, 0);
  const intent = won(intentBasic * R.PERIOD.intent.pct / 100 * n('intent'));
  const gross = won(grossBasic * R.PERIOD.gross.pct / 100 * n('gross'));
  const cap = Math.max(pc.sumBasic - basic, 0);
  return { amount: Math.min(intent + gross, cap), intent, gross, years: pc.years, cap };
}

/** 가중 — 사유별 금액을 그룹 한도·사유 한도·전체 한도 50% 로 자른다. */
function weighting(R, ctx, party, adjust) {
  const { basic, intentBasic, kind, baseAmount } = ctx;
  const items = [];
  const groupSum = {};
  let outside = 0;   // 합계 한도 밖에 두는 사유(위반기간 가중)의 합
  for (const r of R.WEIGHT_REASONS) {
    let row = cell(adjust, r.id, party);
    // 위반기간 가중(신)은 사업연도 수에 따라 율이 저절로 정해지므로 **기본으로 적용**한다 — 대상자 칸을 직접 해제했을 때만 뺀다(사용자 지정 2026-11-09).
    if (!row && r.auto === 'period' && R.PERIOD) {
      const st = adjust && adjust[r.id];
      if (!(st && st.on && st.on[party] === false)) row = { on: {}, text: '' };
    }
    if (!row) continue;
    let amount;
    let pct = null;
    let extra = null;
    if (r.auto === 'severity') {
      const floor = kind === 'company' ? baseAmount * R.SEVERITY_CUT_RATE.company : baseAmount * R.SEVERITY_CUT_RATE.other;
      amount = Math.max(floor - basic, 0);   // 기준금액 10%(관계자·감사인 250%) 선까지 끌어올린다
      amount = Math.min(amount, basic * (r.cap / 100));
    } else if (r.auto === 'period') {
      extra = periodAmount(R, ctx, party, basic, intentBasic);
      amount = extra.amount;
      pct = basic ? Math.round(amount / basic * 1000) / 10 : 0;
    } else {
      pct = pctOf(r, row, party);
      const target = r.partial === 'intent' ? intentBasic : basic;
      amount = won(target * pct / 100);
      if (r.cap) amount = Math.min(amount, won(basic * r.cap / 100));
    }
    amount = won(amount);
    items.push({ id: r.id, reason: r.label, pct, amount, group: r.group || null, text: row.text || '', period: extra });
    if (r.auto === 'period' && R.PERIOD_OUTSIDE_TOTAL_CAP) outside += amount;
    else if (r.group) groupSum[r.group] = (groupSum[r.group] || 0) + amount;
  }
  // 그룹은 먼저 서로 더한 뒤 한도로 한 번만 자른다.
  let total = 0;
  const cappedGroups = {};
  for (const it of items) if (!it.group && !(it.period && R.PERIOD_OUTSIDE_TOTAL_CAP)) total += it.amount;
  for (const g of Object.keys(groupSum)) {
    const cap = won(basic * R.WEIGHT_GROUPS[g].cap / 100);
    cappedGroups[g] = { sum: groupSum[g], cap, hit: groupSum[g] > cap };
    total += Math.min(groupSum[g], cap);
  }
  const totalCap = won(basic * R.WEIGHT_TOTAL_CAP_PCT / 100);
  return {
    items, total: Math.min(total, totalCap) + outside, rawTotal: total + outside, totalHit: total > totalCap, totalCap,
    outside, groups: cappedGroups,
  };
}

/** 감경 — 사유별 금액을 그룹 한도(A 50%·B 30%)로 자르고 기본과징금을 넘지 못하게 한다. */
function mitigating(R, ctx, party, adjust) {
  const { basic } = ctx;
  const items = [];
  const groupSum = {};
  const groupPct = {};
  for (const r of R.MITIGATE_REASONS) {
    if (r.parties && !r.parties.includes(party)) continue;
    const row = cell(adjust, r.id, party);
    if (!row) continue;
    const pct = pctOf(r, row, party);
    const amount = won(basic * pct / 100);
    items.push({ id: r.id, reason: r.label, pct, amount, group: r.group, text: row.text || '' });
    groupPct[r.group] = (groupPct[r.group] || 0) + pct;
  }
  // 그룹 합계는 사유별 금액을 따로 반올림해 더하지 않고 **율을 합쳐 한 번** 센다 — 실사례 한글이 30%+10%+30% 를 「70%」 한 줄로 곱한다(원 단위 일치).
  for (const g of Object.keys(groupPct)) groupSum[g] = won(basic * groupPct[g] / 100);
  let total = 0;
  let totalPct = 0;
  const groups = {};
  for (const g of Object.keys(groupSum)) {
    const cap = won(basic * R.MITIGATE_GROUPS[g].cap / 100);
    groups[g] = { sum: groupSum[g], cap, hit: groupSum[g] > cap };
    total += Math.min(groupSum[g], cap);
    totalPct += Math.min(groupPct[g], R.MITIGATE_GROUPS[g].cap);
  }
  // 합계도 율을 합쳐 한 번 반올림한다(30%+10%+30% → 70%) — 그룹별로 반올림해 더하면 원 단위가 어긋난다(실사례 한글 기준).
  if (Object.keys(groupPct).length > 1) total = won(basic * totalPct / 100);
  return { items, total: Math.min(total, basic), rawTotal: total, groups };
}

/* ── 한 해치 ────────────────────────────────────────────────────── */

/** 위반기간 가중의 사업연도 수·합계를 모으는 열쇠 — 역할만이 아니라 **성명까지** 본다(감사인이 해마다 다른 법인이면 각자 센다). */
const periodKeyOf = (party, name) => `${party}|${String(name || '').trim()}`;

const empty = (party, kind) => ({
  party, kind, applicable: false, baseAmount: 0, tenths: null, rate: 0, basic: 0, intentBasic: 0,
  weighting: { items: [], total: 0, groups: {} }, mitigation: { items: [], total: 0, groups: {} },
  adjusted: 0, cap: 0, imposed: 0, decided: 0, reporterPct: 0, final: 0, motive: '',
});

/**
 * 관계자 칸에 사람이 있는가. (구)는 보수(기준금액)를 적은 사람만이다. (신)은 회사 관계자(감사인 제외)는 성명만 적어도 있는 것으로 보고
 * 기준금액은 보수와 1억원 중 큰 쪽이다(별표8 1.나). 감사인은 (구)와 같이 감사보수를 적어야 한다.
 */
const floorOf = (p, R) => (p && p.role === '감사인' ? 0 : R.PERSON_BASE_FLOOR || 0);   // 1억 하한은 회사 관계자만(1.나) — 감사인은 감사보수 그대로
export const personPresent = (p, R = OLD_RULES) => !!p && ((p.comp || 0) > 0 || (floorOf(p, R) > 0 && String(p.name || '').trim() !== ''));
export const personBase = (p, R = OLD_RULES) => (personPresent(p, R) ? Math.max(p.comp || 0, floorOf(p, R)) : 0);

/**
 * 입력 한 해치를 셈한다. 결과는 `{ rows, company, parties }` — `parties` 는 열 이름으로 찾는다.
 * `ctx.period` 는 위반기간 가중에 쓰는 해 전체의 정보다(`computeAll` 이 채운다). 한 해만 부를 때는 비워 둔다.
 */
export function computeYear(input, R = OLD_RULES, ctx = null) {
  const allRows = violationRows(input, R);                       // 관계자·감사인이 관여한 줄까지
  const rows = allRows.filter((r) => isOn(r.v.motive));          // 회사 몫: 회사 동기가 고의·중과실인 줄만
  const out = { rows, parties: {} };

  // 회사
  const baseTotal = rows.reduce((s, r) => s + r.base, 0);
  const company = empty('회사', 'company');
  if (rows.length) {
    company.applicable = true;
    company.baseAmount = baseTotal;
    company.basic = rows.reduce((s, r) => s + r.basic, 0);
    company.motive = rows.some((r) => r.v.motive === '고의') ? '고의' : '중과실';
    const intentBasic = rows.filter((r) => r.v.motive === '고의').reduce((s, r) => s + r.basic, 0);
    company.intentBasic = intentBasic;
    company.weighting = weighting(R, { basic: company.basic, intentBasic, kind: 'company', baseAmount: baseTotal, period: ctx && ctx.period, periodKey: periodKeyOf('회사', '') }, '회사', input.weight);
    company.mitigation = mitigating(R, { basic: company.basic }, '회사', input.mitigate);
    company.adjusted = Math.max(company.basic + company.weighting.total - company.mitigation.total, 0);
    company.cap = won(baseTotal * R.CAP.company);
    company.imposed = Math.min(company.adjusted, company.cap);
    company.decided = cutUnit(company.imposed - (input.priorFine || 0));
  }
  finish(company, input, '회사', R);
  out.company = company;
  out.parties['회사'] = company;

  // 관계자·감사인
  for (const p of R.PARTIES.filter((x) => x.kind !== 'company')) {
    const comp = (input.persons || []).find((x) => x.role === p.id);
    const res = empty(p.id, p.kind);
    res.name = comp ? comp.name || '' : '';
    res.baseAmount = personBase(comp, R);
    res.compEntered = comp ? comp.comp || 0 : 0;
    const mine = allRows.filter((r) => isOn(r.v.who && r.v.who[p.id]));
    if (comp && res.baseAmount > 0 && mine.length) {
      res.applicable = true;
      const weightSum = mine.reduce((s, r) => s + r.base, 0);
      // 관계자별 점수: 위반사항마다 자기 동기로 위법행위 내용만 달리 보고, 나머지 항목은 회사와 같다.
      let acc = 0;
      let intentBase = 0;
      // 묶음: 같은 위반사항의 세부 항목(가-1·가-2)은 위법행위 내용이 같으면 한 줄로 합쳐 위반규모를 센다.
      const units = [];
      const keyed = new Map();
      for (const r of mine) {
        const w = r.v.who[p.id];
        const motive = motiveOf(w);
        const content = contentOf(motive, severePerson(R, w, r.v));
        const g = String(r.v.group || '').trim();
        const key = g ? `${g}|${content}` : null;
        if (key && keyed.has(key)) { const u = keyed.get(key); u.base += r.base; u.parts.push(r); continue; }
        const u = { desc: g || r.v.desc, id: r.v.id, base: r.base, content, motive, r, parts: [r] };
        units.push(u);
        if (key) keyed.set(key, u);
      }
      const per = units.map((u) => {
        // 묶은 항목의 배수는 입력한 값이 있으면 그것(같은 위반사항을 유형별로 나눈 줄은 같은 배수를 적는다), 없으면 합친 기준금액으로 셈.
        const given = u.parts.map((x) => x.v.scaleLevel).find(Boolean)
          || (u.parts.every((x) => x.v.multiple > 0) ? scaleByMultiple(u.parts.reduce((a, x) => a + Number(x.v.multiple), 0), R) : 0);
        const scale = u.parts.length > 1 ? (given || scaleLevelOf(u.base, input.materiality, R)) : u.r.scale;
        const tenths = u.content * R.SCORE_WEIGHT.content + scale * R.SCORE_WEIGHT.scale
          + u.r.typeLevel * R.SCORE_WEIGHT.type + u.r.market * R.SCORE_WEIGHT.market;
        acc += u.base * tenths;
        if (u.motive === '고의') intentBase += u.base;
        return { id: u.id, desc: u.desc, base: u.base, content: u.content, scale, typeLevel: u.r.typeLevel, market: u.r.market, tenths, motive: u.motive, parts: u.parts.map((x) => x.v.desc) };
      });
      res.per = per;
      res.tenths = acc / weightSum;
      res.motive = per.some((x) => x.motive === '고의') ? '고의' : '중과실';
      res.rate = rateFor(res.tenths, false, R);
      res.basic = down(res.baseAmount * Math.round(res.rate * 100) / 100);
      const intentBasic = weightSum > 0 ? won(res.basic * intentBase / weightSum) : 0;
      res.intentBasic = intentBasic;
      res.weighting = weighting(R, { basic: res.basic, intentBasic, kind: p.kind, baseAmount: res.baseAmount, period: ctx && ctx.period, periodKey: periodKeyOf(p.id, res.name) }, p.id, input.weight);
      res.mitigation = mitigating(R, { basic: res.basic }, p.id, input.mitigate);
      res.adjusted = Math.max(res.basic + res.weighting.total - res.mitigation.total, 0);
      // 한도: 관계자는 회사 결정금액의 10%, 감사인은 감사보수의 5배.
      res.cap = p.kind === 'auditor' ? res.baseAmount * R.CAP.auditorFee : won(company.decided * R.CAP.personOfCompany);
      res.imposed = Math.min(res.adjusted, res.cap);
      res.decided = cutUnit(res.imposed);
    }
    finish(res, input, p.id, R);
    out.parties[p.id] = res;
  }
  return out;
}

/** 신고자 감경(결정금액의 70% 이내, 100 은 면제)을 적용해 최종액을 낸다. */
function finish(res, input, party, R) {
  const pct = Math.min(Math.max(Number(input.reporter && input.reporter[party]) || 0, 0),
    input.reporter && Number(input.reporter[party]) >= 100 ? 100 : R.REPORTER_MAX_PCT);
  res.reporterPct = pct;
  res.final = pct >= 100 ? 0 : cutUnit(res.decided * (1 - pct / 100));
}

/**
 * 여러 해(사업연도)를 한꺼번에 센다 — `inputs` 는 해마다의 입력 배열, 결과는 같은 차례의 `computeYear` 결과 배열이다.
 * (신)의 위반기간 가중은 「위반 사업연도 수」와 「해마다 기본과징금의 합」이 필요해서 두 번 센다:
 * 먼저 위반기간 가중 없이 해마다 센 뒤, 대상자별로 고의·중과실 위반이 있는 해의 수와 기본과징금 합을 모아 다시 센다.
 */
export function computeAll(inputs, R = OLD_RULES) {
  const first = inputs.map((input) => computeYear(input, R, null));
  if (!R.PERIOD) return first;
  const period = {};
  for (const res of first) {
    for (const d of Object.values(res.parties)) {
      if (!d.applicable) continue;
      const key = periodKeyOf(d.party, d.name);
      const pc = period[key] || (period[key] = { years: { intent: 0, gross: 0 }, sumBasic: 0 });
      pc.sumBasic += d.basic;
      if (d.intentBasic > 0) pc.years.intent += 1;
      if (d.basic - d.intentBasic > 0) pc.years.gross += 1;
    }
  }
  return inputs.map((input) => computeYear(input, R, { period }));
}

/**
 * 여러 해에 걸친 위법행위 — **대상자별로 해마다 센 금액 가운데 가장 큰 것**을 부과한다 (별표8 4.가).
 * `perYear` 는 `[{ label, result }]`, 열쇠는 `대상자 이름(역할 · 성명)` 이다.
 */
export function maxAcrossYears(perYear) {
  const best = {};
  for (const { label, result } of perYear) {
    for (const data of Object.values(result.parties)) {
      if (!data.applicable) continue;
      const key = data.kind === 'company' ? '회사' : data.party + (data.name && data.name !== data.party ? ' · ' + data.name : '');
      if (!best[key] || data.final > best[key].data.final) best[key] = { year: label, data };
    }
  }
  return best;
}

/**
 * (구)·(신) 두 기준으로 센 결과를 대상자별로 견주어 **피조치자에게 유리한(작은) 금액**을 고른다.
 * `oldBest`·`newBest` 는 각각 `maxAcrossYears` 의 결과. 한쪽만 산정되면(예: (신)은 성명만으로 기준금액 1억이 서는데
 * (구)는 보수가 없어 산정 불가) 산정된 쪽을 그대로 쓰고 `only` 로 알린다 — 없는 쪽을 0원으로 보지 않는다.
 * 같으면 (구)로 둔다.
 */
export function compareBases(oldBest, newBest) {
  const keys = [...new Set([...Object.keys(oldBest), ...Object.keys(newBest)])];
  return keys.map((key) => {
    const o = oldBest[key]; const n = newBest[key];
    const of = o ? o.data.final : null; const nf = n ? n.data.final : null;
    let pick; let only = null;
    if (of === null) { pick = 'new'; only = 'new'; } else if (nf === null) { pick = 'old'; only = 'old'; } else pick = nf < of ? 'new' : 'old';
    const chosen = pick === 'new' ? n : o;
    return { key, old: o || null, new: n || null, oldFinal: of, newFinal: nf, pick, only, final: chosen.data.final, diff: of !== null && nf !== null ? nf - of : null, data: chosen.data, year: chosen.year };
  });
}
