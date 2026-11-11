/* [과징금 산정] 한글 파일의 **내용** — 실제 부과 사례 한글(증선위 보고 붙임 「과징금 산정내역」: 4.hwpx · 5.hwpx)과 같은 짜임·문구·표 모양으로 만든다.
 *
 *   과징금 산정내역
 *     1. 회사 및 회사관계자   부과액 표 · 【외감법상 과징금】 Ⅰ 산정원칙 · Ⅱ 산정결과(위반자표 · 연도별 비교 · 연도별 ①~ 표)
 *                              · Ⅲ 세부 산정내역(1 한도 · 2 (1)기준금액 (2)기본과징금·중요도 점수 (3)가중 (4)감경 (5)기처분)
 *     2. 감사인               같은 짜임(연도를 열로 놓은 표)
 *     3. 구·신 기준 비교      (참고) 한 표로 견준 결과 — 두 기준을 다 센 화면에서 내려받을 때만
 *
 * 이 모듈은 DOM 을 쓰지 않고 셈 결과(`computeYear`)만 읽는다 — 그래서 시험에서 사례 입력을 넣어 한글 본문의 숫자를 바로 견줄 수 있다.
 * 글 덩어리 `{ t: 's', role, text }` 의 role 은 `penalty_fine_hwpx.js` 가 실사례 서식 번호로 바꾼다.
 */
import { OLD_RULES } from './penalty_fine_rules.js';

/* 기준 묶음 — `buildReport(years, { rules })` 가 부를 때마다 갈아 끼운다(기본 (구)). 본문 만드는 동안만 쓴다. */
let R = OLD_RULES;

const n = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('ko-KR') : '-');
const dash = (v) => (v ? n(v) : '-');
const pctText = (x) => `${Math.round(x * 1000) / 10}%`;
const score = (tenths) => (tenths / 10).toFixed(2);
const LEVEL = ['', '하(下)', '중(中)', '상(上)'];
const LETTERS = '가나다라마바사아자차카타파하';

/** 「제13기\n(‘18년)」 — 실사례 한글의 연도 칸 모양. */
function yearCell(fy) {
  const t = String(fy.term || '').trim();
  const y = String(fy.year || '').trim();
  const yy = /^\d{4}$/.test(y) ? `‘${y.slice(2)}년` : y;
  if (t && yy) return `제${t}기\n(${yy})`;
  if (t) return `제${t}기`;
  return yy || fy.label || '';
}
const yearOne = (fy) => yearCell(fy).replace('\n', '');
const circled = (i) => '①②③④⑤⑥⑦⑧⑨⑩'[i] || `${i + 1}`;

/** 연도별 결과에서 대상자 목록을 모은다. 회사 → 관계자(역할 차례) → 감사인. */
function collect(years) {
  const list = [];
  const idx = new Map();
  years.forEach((y, i) => {
    for (const d of Object.values(y.result.parties)) {
      if (!d.applicable) continue;
      const key = d.kind === 'company' ? '회사' : `${d.party}|${d.name || ''}`;
      if (!idx.has(key)) {
        const p = { key, kind: d.kind, party: d.party, name: d.name || '', byYear: years.map(() => null) };
        idx.set(key, p);
        list.push(p);
      }
      idx.get(key).byYear[i] = d;
    }
  });
  const rank = { company: 0, person: 1, auditor: 2 };
  return list.sort((a, b) => rank[a.kind] - rank[b.kind]);
}
const titleOf = (p) => (p.kind === 'company' ? '회사' : `${p.party}${p.name && p.name !== p.party ? `(${p.name})` : ''}`);
const maxFinal = (p) => Math.max(...p.byYear.map((d) => (d ? d.final : 0)));
const chunk = (arr, size) => { const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; };

/* ── 짧은 만들개 ── */
const S = (role, text) => ({ t: 's', role, text });
const GAP = { t: 'gap' };
const unit = (text = '(단위: 원)') => S('unit', text);
const unit11 = (text = '(단위: 원)') => S('unit11', text);
const cell = (text, o = {}) => ({ text, ...o });

const BASIS_TEXT = () => (R.id === 'new'
  ? '｢외부감사 및 회계 등에 관한 규정｣ 개정안(금융위원회고시 제2026-19호 일부개정고시안) 제43조제1항에 따른 부과기준율(별표8)'
  : '‘25.5.20. 개정된 ｢외부감사 및 회계 등에 관한 규정｣ 제43조제1항에 따른 부과기준율(별표8)');

/* ── 위반사항 이름·가나다 ── */
/** 한 묶음(회사+관계자 / 감사인)이 쓰는 위반사항 이름을 처음 나온 차례로 모아 가·나·다 를 붙인다. */
function letterMap(parties, years) {
  const map = new Map();
  const add = (desc) => { const k = String(desc || '').trim(); if (k && !map.has(k)) map.set(k, (k.match(LEAD) || [])[1] || LETTERS[map.size] || `${map.size + 1}`); };
  parties.forEach((p) => p.byYear.forEach((d, i) => {
    if (!d) return;
    if (p.kind === 'company') (years[i].result.rows || []).forEach((r) => add(r.v.desc));
    else (d.per || []).forEach((u) => add(u.desc));
  }));
  return map;
}
/* 위반사항 이름이 이미 「가. …」로 시작하면 그 글자를 그대로 쓰고, 아니면 차례대로 붙인다. */
const LEAD = /^([가-하])\.\s*/;
const nameOf = (lm, desc) => { const k = String(desc || '').trim(); return LEAD.test(k) ? k : `${lm.get(k) || '?'}. ${k || '-'}`; };
const letterOf = (lm, desc) => { const k = String(desc || '').trim(); const m = k.match(LEAD); return m ? m[1] : (lm.get(k) || '?'); };

/** 회사 위반사항 줄의 위반규모(배) — 같은 이름의 줄은 합산(별표8 위반규모는 위반사항 단위). */
function multipleOf(year, desc) {
  const k = String(desc || '').trim();
  let sum = 0;
  for (const r of year.result.rows || []) if (String(r.v.desc || '').trim() === k && r.v.multiple > 0) sum += Number(r.v.multiple);
  return sum > 0 ? sum : null;
}

/* ───────────────────────────── Ⅱ 산정결과 ───────────────────────────── */

/** 한 해의 1~6 표(대상자를 열로). 대상자가 많으면 4명씩 나눠 이어 붙인다. */
function yearTables(parties, years, i, priorFine, reporter, multi) {
  const out = [];
  const y = years[i];
  const here = parties.filter((p) => p.byYear[i]);
  for (const grp of chunk(here, 4)) {
    const val = (f) => grp.map((p) => cell(f(p.byYear[i]), { align: 'r' }));
    const row = (label, lvl, f, note = '') => [cell(label, { lvl }), ...val(f), cell(note, { align: 'c' })];
    const rows = [
      row('1. 외감법상 과징금 한도', 1, (d) => dash(d.cap)),
      row('2. 과징금부과기준에 따른 과징금', 1, (d) => dash(d.adjusted), '(2)+(3)-(4)'),
      row('(1) 기준금액', 2, (d) => dash(d.baseAmount)),
      row('(2) 기본과징금', 2, (d) => dash(d.basic)),
      row('(3) 가중', 2, (d) => dash(d.weighting.total)),
      row('(4) 감경', 2, (d) => dash(d.mitigation.total)),
      row('3. 과징금부과액[MIN(1,2)]', 1, (d) => dash(d.imposed)),
      row('4. 旣처분 벌금, 과태료 여부', 1, (d) => (d.kind === 'company' && priorFine ? n(priorFine) : '-')),
      row('5. 10만원 단위 미만(절사금액)', 1, (d) => { const c = d.imposed - (d.kind === 'company' ? priorFine : 0) - d.decided; return c > 0 ? n(c) : '-'; }),
      row('6. 과징금부과 결정금액', 1, (d) => n(d.decided)),
    ];
    rows[9] = rows[9].map((c, k) => (k === 0 || (k > 0 && k <= grp.length) ? { ...c, bold: true } : c));
    if (reporter) {
      rows.push(row('7. 신고자 감경', 1, (d) => (d.reporterPct ? (d.reporterPct >= 100 ? '면제' : `${d.reporterPct}%`) : '-')));
      rows.push(row('8. 최종 부과액', 1, (d) => n(d.final)));
      rows[rows.length - 1] = rows[rows.length - 1].map((c, k) => (k <= grp.length ? { ...c, bold: true } : c));
    }
    out.push(unit());
    out.push({
      t: 'table', font: 12, scale: 0.96, widths: [3.8, ...grp.map(() => 2.3), 1.3], align: ['l', ...grp.map(() => 'r'), 'c'],
      head: [[cell('구   분', { rowSpan: 2 }), cell(`산정금액(${yearOne(y)})`, { span: grp.length }), cell('비   고', { rowSpan: 2 })], grp.map(titleOf)],
      rows,
    });
    out.push(GAP);
  }
  return out;
}

/** 감사인 — 연도를 열로 놓은 1~6 표. */
function auditorYearTable(p, years, priorFine, reporter) {
  const cols = years.map((_, i) => i).filter((i) => p.byYear[i]);
  const val = (f) => cols.map((i) => cell(f(p.byYear[i]), { align: 'r' }));
  const row = (label, lvl, f, note = '') => [cell(label, { lvl }), ...val(f), cell(note, { align: 'c' })];
  const rows = [
    row('1. 외감법상 과징금 한도', 1, (d) => dash(d.cap)),
    row('2. 과징금부과기준에 따른 과징금', 1, (d) => dash(d.adjusted), '(2)+(3)-(4)'),
    row('(1) 기준금액', 2, (d) => dash(d.baseAmount)),
    row('(2) 기본과징금', 2, (d) => dash(d.basic)),
    row('(3) 가중', 2, (d) => dash(d.weighting.total)),
    row('(4) 감경', 2, (d) => dash(d.mitigation.total)),
    row('3. 과징금부과액[MIN(1,2)]', 1, (d) => dash(d.imposed)),
    row('4. 旣처분 벌금, 과태료 여부', 1, () => '-'),
    row('5. 10만원 단위 미만(절사금액)', 1, (d) => { const c = d.imposed - d.decided; return c > 0 ? n(c) : '-'; }),
    row('6. 과징금부과 결정금액', 1, (d) => n(d.decided)),
  ];
  rows[9] = rows[9].map((c, k) => (k <= cols.length ? { ...c, bold: true } : c));
  if (reporter) {
    rows.push(row('7. 신고자 감경', 1, (d) => (d.reporterPct ? (d.reporterPct >= 100 ? '면제' : `${d.reporterPct}%`) : '-')));
    rows.push(row('8. 최종 부과액', 1, (d) => n(d.final)));
  }
  return {
    t: 'table', font: 12, scale: 0.96, widths: [3.8, ...cols.map(() => 2.3), 1.3], align: ['l', ...cols.map(() => 'r'), 'c'],
    head: [[cell('구   분', { rowSpan: 2 }), cell('산정금액', { span: cols.length }), cell('비   고', { rowSpan: 2 })], cols.map((i) => yearOne(years[i]))],
    rows,
  };
}

/* ───────────────────────────── Ⅲ 세부 산정내역 ───────────────────────────── */

/** 1. 외감법상 과징금 한도 */
function capBlocks(parties, years, lm, isAuditor) {
  const out = [S('sub', ' 1. 주식회사 등의 외부감사에 관한 법률상 과징금 한도')];
  const company = parties.find((p) => p.kind === 'company');
  if (company) {
    out.push(S('label', '  □ 회 사'), unit11());
    const rows = [];
    years.forEach((y, i) => {
      const d = company.byYear[i];
      if (!d) return;
      const rs = y.result.rows || [];
      rs.forEach((r, k) => {
        rows.push([
          ...(k === 0 ? [cell(yearCell(y), { rowSpan: rs.length + 1, align: 'c' })] : []),
          cell(nameOf(lm, r.v.desc)), cell(n(r.base), { align: 'r' }),
          ...(k === 0 ? [cell('20/100', { rowSpan: rs.length + 1, align: 'c' }), cell(n(d.cap), { rowSpan: rs.length + 1, align: 'r' })] : []),
        ]);
      });
      rows.push([cell('소계', { bold: true, align: 'c' }), cell(n(d.baseAmount), { align: 'r', bold: true })]);
    });
    out.push({
      t: 'table', font: 12, scale: 0.96, widths: [2.6, 4.6, 3.6, 2.4, 3.6],
      head: [['회계연도', '위반사항', '위반금액(a)', '최대\n부과비율(b)', '과징금 부과 한도액\n(c=a×b)']], rows,
    });
    out.push(GAP);
    parties.filter((p) => p.kind === 'person').forEach((p) => out.push(S('label', `  □ ${titleOf(p)}`)));
    if (parties.some((p) => p.kind === 'person')) out.push(S('lim', '   - 회사관계자에 대한 법률상 부과 한도액은 회사에 부과하는 과징금의 100분의 10에 해당(외부감사법 제35조(과징금) 제1항)'));
  } else {
    for (const p of parties) {
      if (parties.length > 1) out.push(S('label', `  □ ${titleOf(p)}`));
      out.push(unit11());
      out.push({
        t: 'table', font: 12, scale: 0.96, widths: [3, 2.6, 2.2, 3],
        head: [['감사보고서', '감사보수(a)', '최대 부과비율(b)', '과징금 부과 한도액*\n(c=a×b)']],
        rows: years.map((y, i) => (p.byYear[i] ? [yearOne(y), cell(n(p.byYear[i].baseAmount), { align: 'r' }), cell(`${R.CAP.auditorFee * 100}%`, { align: 'c' }), cell(n(p.byYear[i].cap), { align: 'r' })] : null)).filter(Boolean),
      });
    }
    out.push(S('small', '     * 감사인에 대한 법률상 부과 한도액은 해당 감사로 받은 보수의 5배에 해당'));
  }
  out.push(GAP);
  return out;
}

/** 2.(1) 기준금액 */
function baseBlocks(parties, years, lm, isAuditor) {
  const out = [S('sub', ' 2. 과징금부과기준에 따른 과징금'), S('sub', '  (1) 기준금액')];
  const company = parties.find((p) => p.kind === 'company');
  if (company) {
    out.push(S('label', '   □ 회 사'), unit11());
    const rows = [];
    years.forEach((y, i) => {
      const d = company.byYear[i];
      if (!d) return;
      const rs = y.result.rows || [];
      const sums = { A: 0, B: 0, C: 0, D: 0 };
      rs.forEach((r, k) => {
        sums[r.v.type] = (sums[r.v.type] || 0) + r.v.amount;
        const c = (t) => cell(r.v.type === t ? n(r.v.amount) : '-', { align: 'r' });
        rows.push([...(k === 0 ? [cell(yearCell(y), { rowSpan: rs.length + 1, align: 'c' })] : []), cell(nameOf(lm, r.v.desc)), c('A'), c('B'), c('C'), c('D'), cell(n(r.base), { align: 'r' })]);
      });
      const s = (t) => cell(sums[t] ? n(sums[t]) : '-', { align: 'r', bold: true });
      rows.push([cell('소계', { bold: true, align: 'c' }), s('A'), s('B'), s('C'), s('D'), cell(n(d.baseAmount), { align: 'r', bold: true })]);
    });
    out.push({
      t: 'table', font: 12, scale: 0.96, widths: [2.6, 3.8, 3.7, 1.9, 1.9, 1.9, 3.7],
      head: [[cell('위반\n회계연도', { rowSpan: 2 }), cell('위반사항', { rowSpan: 2 }), cell('위반금액*', { span: 4 }), cell('기준금액**\n(e)', { rowSpan: 2 })], ['A유형(a)', 'B유형(b)', 'C유형(c)', 'D유형(d)']],
      rows,
    });
    out.push(S('small', '    *1 위반금액 : 조치양정기준 금액(중복 적용 배제)'));
    out.push(S('small', '    *2 기준금액(e) = a×1 + b×(1/4) + c×(1/5) + d×(1/15)'));
    out.push(S('small', '        (단, D유형의 경우 중요성 기준금액의 6배까지로 제한)'));
    out.push(S('small', '    ※ 시행령 [별표1] 2. 외감규정 [별표8] 1.에 의거하여 계정과목의 특성 및 중요성 등을 고려하여 외감규정 시행세칙 [별표1]에서 정하는 중요도 산출방법을 준용'));
    out.push(GAP);
  }
  const persons = parties.filter((p) => p.kind !== 'company');
  if (persons.length && !isAuditor) {
    persons.forEach((p) => out.push(S('label', `   □ ${titleOf(p)}`)));
    out.push(unit11());
    const yi = years.map((_, i) => i).filter((i) => persons.some((p) => p.byYear[i]));
    if (persons.length === 1) {
      const p = persons[0];
      out.push({
        t: 'table', font: 12, scale: 0.7, widths: [3, 3.4], align: ['c', 'r'],
        head: [['회계연도', '기준금액*']],
        rows: yi.filter((i) => p.byYear[i]).map((i) => [yearOne(years[i]), cell(n(p.byYear[i].baseAmount), { align: 'r' })]),
      });
    } else {
      for (const part of chunk(yi, 4)) {
        out.push({
          t: 'table', font: 12, scale: 0.96, widths: [3.4, ...part.map(() => 2.4)], align: ['l', ...part.map(() => 'r')],
          head: [[cell('구분', { rowSpan: 2 }), cell('기준금액*', { span: part.length })], part.map((i) => yearCell(years[i]))],
          rows: persons.map((p) => [titleOf(p), ...part.map((i) => cell(p.byYear[i] ? n(p.byYear[i].baseAmount) : '-', { align: 'r' }))]),
        });
      }
    }
    out.push(S('small', '    * 회계처리기준 위반이 발견된 사업연도에 회사로부터 받은 보수, 배당, 이익이 실현되지 않은 증권·현물 등 일체의 금전적 보상(규정 별표8 1.나)'));
    out.push(GAP);
  } else if (persons.length && isAuditor) {
    for (const p of persons) {
      if (persons.length > 1) out.push(S('label', `   □ ${titleOf(p)}`));
      out.push(unit11());
      out.push({
        t: 'table', font: 12, scale: 0.7, widths: [3, 3.4], align: ['c', 'r'],
        head: [['감사보고서', '감사보수']],
        rows: years.map((y, i) => (p.byYear[i] ? [yearOne(y), cell(n(p.byYear[i].baseAmount), { align: 'r' })] : null)).filter(Boolean),
      });
    }
    out.push(S('small', '    ※ 회계감사기준을 위반하여 작성된 감사보고서에 대하여 해당 회사로부터 받았거나 받기로 한 감사보수(규정 별표8 1.다)'));
    out.push(GAP);
  }
  return out;
}

/** 위법행위 중요도 점수 산정내역 설명(*2) — 연도별 ① 내용 ② 위반규모 ③ 회사유형 ④ 시장영향. */
function explainLines(p, years, lm, typeLabel, isAuditor) {
  const lines = [];
  years.forEach((y, i) => {
    const d = p.byYear[i];
    if (!d) return;
    const units = p.kind === 'company'
      ? (y.result.rows || []).map((r) => ({ desc: r.v.desc, content: r.content, scale: r.scale, typeLevel: r.typeLevel, market: r.market, base: r.base }))
      : (d.per || []);
    lines.push(`       ${yearOne(y).replace('(', '(').replace('‘', '’')}`);
    lines.push('       ① 위법행위 내용 :');
    units.forEach((u) => lines.push(`            ${nameOf(lm, u.desc)} – ${LEVEL[u.content]}`));
    lines.push('       ② 위반규모 :');
    units.forEach((u) => {
      const m = multipleOf(y, u.desc);
      let txt;
      const mat = y.materiality > 0 ? y.materiality : (m ? u.base / m : 0);   // 중요성 금액을 안 적었으면 위반규모(배)에서 거꾸로 구한다
      if (isAuditor && mat > 0) {
        const mm = u.base / mat;
        txt = `${Math.round(u.base / 1e6).toLocaleString('ko-KR')}백만원/${Math.round(mat / 1e6).toLocaleString('ko-KR')}백만원=${mm.toFixed(2)}배(${LEVEL[u.scale]})`;
      } else if (m) txt = `${m.toFixed(2)}(${LEVEL[u.scale]})`;
      else txt = LEVEL[u.scale];
      lines.push(`            ${nameOf(lm, u.desc)} – ${txt}`);
    });
    const tl = units[0] ? units[0].typeLevel : 1;
    lines.push(`       ③ 회사유형 : ${typeLabel}(${LEVEL[tl]})`);
    const mk = [...new Set(units.map((u) => u.market))].sort((a, b) => b - a);
    lines.push(`       ④ 시장에 미치는 영향 : ${mk.map((m) => LEVEL[m]).join(' / ')}`);
  });
  return lines;
}

/** 대상자 한 명(또는 감사인)의 (2) 기본과징금 표 · 중요도 점수 산정내역 표 · 설명. */
function basicBlocks(p, years, lm, typeLabel, isAuditor) {
  const out = [S('label', `   □ ${titleOf(p)}`), unit11()];
  const isCompany = p.kind === 'company';
  const rows = [];
  const scoreRows = [];
  years.forEach((y, i) => {
    const d = p.byYear[i];
    if (!d) return;
    if (isCompany) {
      const rs = y.result.rows || [];
      rs.forEach((r, k) => {
        rows.push([...(k === 0 ? [cell(yearCell(y), { rowSpan: rs.length + 1, align: 'c' })] : []), cell(nameOf(lm, r.v.desc)),
          cell(n(r.base), { align: 'r' }), cell(pctText(r.rate), { align: 'r' }), cell(score(r.tenths), { align: 'r' }), cell(n(r.basic), { align: 'r' })]);
        scoreRows.push([...(k === 0 ? [cell(yearCell(y), { rowSpan: rs.length, align: 'c' })] : []), cell(letterOf(lm, r.v.desc), { align: 'c' }),
          cell(String(r.content), { align: 'c' }), cell(String(r.scale), { align: 'c' }), cell(String(r.typeLevel), { align: 'c' }), cell(String(r.market), { align: 'c' }),
          cell(score(r.tenths), { align: 'c' }), cell(pctText(r.rate), { align: 'c' })]);
      });
      rows.push([cell('소 계', { bold: true, align: 'c', span: 4 }), cell(n(d.basic), { align: 'r', bold: true })]);
    } else {
      const per = d.per || [];
      per.forEach((u, k) => {
        rows.push([...(k === 0 ? [cell(yearCell(y), { rowSpan: per.length, align: 'c' })] : []), cell(nameOf(lm, u.desc)),
          ...(k === 0 ? [cell(n(d.baseAmount), { rowSpan: per.length, align: 'r' }), cell(pctText(d.rate), { rowSpan: per.length, align: 'r' }), cell(score(d.tenths), { rowSpan: per.length, align: 'r' }), cell(n(d.basic), { rowSpan: per.length, align: 'r' })] : [])]);
        scoreRows.push([...(k === 0 ? [cell(yearCell(y), { rowSpan: per.length + (per.length > 1 ? 1 : 0), align: 'c' })] : []), cell(letterOf(lm, u.desc), { align: 'c' }),
          ...(isAuditor ? [cell(String(Math.round(u.base / 1e6).toLocaleString('ko-KR')), { align: 'r' })] : []),
          cell(String(u.content), { align: 'c' }), cell(String(u.scale), { align: 'c' }), cell(String(u.typeLevel), { align: 'c' }), cell(String(u.market), { align: 'c' }),
          cell(score(u.tenths), { align: 'c' }), ...(k === 0 ? [cell(pctText(d.rate), { rowSpan: per.length + (per.length > 1 ? 1 : 0), align: 'c' })] : [])]);
      });
      if (per.length > 1) scoreRows.push([cell('가중평균', { bold: true, align: 'c', span: isAuditor ? 6 : 5 }), cell(score(d.tenths), { align: 'c', bold: true })]);
    }
  });
  out.push({
    t: 'table', font: 12, scale: 0.96, widths: [2.6, 4.4, 3.4, 1.8, 2.3, 3.4], align: ['c', 'l', 'r', 'r', 'r', 'r'],
    head: [['회계연도', '위반사항', '기준금액\n(e)', '부과\n기준율\n(f)', '위법행위\n중요도 점수', '기본과징금\n(g=e*f)']], rows,
  });
  out.push(GAP);
  out.push(S('small', '  ※ 위법행위 중요도 점수 산정내역'));
  const a = isAuditor ? 3 : 2;   // 설명 번호
  out.push({
    t: 'table', font: 12, scale: 0.96,
    widths: isAuditor ? [2.5, 1.7, 2.6, 2.3, 2.2, 2.2, 2.4, 1.9, 1.7] : [2.5, 1.9, 2.4, 2.3, 2.3, 2.6, 2.1, 1.8],
    head: [[cell('회계\n연도', { rowSpan: 2 }), cell('위반\n사항*1', { rowSpan: 2 }), ...(isAuditor ? [cell('회사\n기준금액\n(백만원)*2', { rowSpan: 2 })] : []),
      cell(`점검항목(가중치)*${a}`, { span: 4 }), cell(`중요도\n점수*${a + 1}`, { rowSpan: 2 }), cell('부과\n기준율', { rowSpan: 2 })],
    ['a.위법행위\n내용(0.4)', 'b.위반\n규모(0.2)', 'c.회사\n유형(0.2)', 'd.시장에\n미치는\n영향(0.2)']],
    rows: scoreRows,
  });
  out.push(GAP);
  out.push(S('small', `    *1 위반사항 : ${[...lm.keys()].map((d) => nameOf(lm, d)).join('\n                  ')}`));
  out.push(S('small', `    *${isAuditor ? 2 : 2} 위법행위 중요도 점수 산정내역 설명`));
  explainLines(p, years, lm, typeLabel, isAuditor).forEach((l) => out.push(S('small', l)));
  out.push(S('small', `    *${a + 1} 중요도 점수 : a×0.4 + b×0.2 + c×0.2 + d×0.2`));
  out.push(GAP);
  return out;
}

/** ￭ 부과기준율 표 · ￭ 중요도 점수 표(별표8 2.가·나) — 묶음마다 한 번. */
function referenceBlocks() {
  const { RATE_TABLE } = R;
  const out = [S('small', '  ￭ 부과기준율(별표8 2. 가.)')];
  out.push({
    t: 'table', font: 12, scale: 0.7, widths: [3, 2, 3], align: ['c', 'c', 'c'],
    head: [[cell('위법행위 중요도 점수', { rowSpan: 2 }), cell('부과기준율', { span: 2 })], ['회사', '감사인 및 회사 관계자']],
    rows: RATE_TABLE.map((r, i) => {
      const lo = r.min === -Infinity ? null : r.min / 10;
      const hi = i === 0 ? null : RATE_TABLE[i - 1].min / 10;
      const label = lo === null ? `${hi.toFixed(1)} 미만` : hi === null ? `${lo.toFixed(1)} 이상` : `${lo.toFixed(1)} 이상 ∼ ${hi.toFixed(1)} 미만`;
      return [cell(label, { align: 'c' }), cell(pctText(r.company), { align: 'c' }), cell(`${Math.round(r.other * 100)}%`, { align: 'c' })];
    }),
  });
  out.push(GAP);
  out.push(S('small', '  ￭ 위법행위 중요도 점수는 다음의 표에 따라 항목별 중요도 점수와 가중치를 곱한 결과값을 모두 합하여 산정한다. 이 경우, 해당 항목의 중요도가 “상(上)” 또는 “중(中)”보다 낮은 경우에는 “하(下)”에 해당하는 것으로 보아 1점을 매긴다. (별표8 2. 나.)'));
  const nw = !!R.SEVERE_NEW_ITEMS;
  const cashUp = '‧재무제표에 나타나지 않는 자금의 조성, 임직원의 횡령․배임 및 「특정 금융거래정보의 보고 및 이용 등에 관한 법률」 제2조제4호에 따른 자금세탁행위 등과 관련되는 경우\n‧내부자거래 등 불공정거래행위와 직접 연계된 경우';
  const fake = '‧가공의 자산을 계상하거나 부채를 누락하는 등 회계정보를 의도적으로 은폐․조작․누락시킨 경우';
  const forge = '‧회계장부, 전표 등 회계장부 작성의 기초가 되는 서류, 관련 전산자료 및 증빙자료 등을 위ㆍ변조한 경우';
  const block = '‧감사인이 요구한 자료를 위ㆍ변조하는 등 외부감사를 방해한 경우';
  const other = '‧그 밖에 위법사실 또는 그 가능성을 인식하고 법을 위반한 경우';
  const up1 = nw ? `${cashUp}\n${fake}\n${forge}\n${block}` : cashUp;
  const mid1 = nw ? other : `${fake}\n${forge}\n${block}\n${other}`;
  out.push({
    t: 'table', font: 12, scale: 0.96, widths: [1.4, 1.6, 0.9, 5.6, 5.6], align: ['c', 'c', 'c', 'l', 'l'],
    head: [[cell('항목', { span: 2 }), '가중치', '상(上, 3점)', '중(中, 2점)']],
    rows: [
      [cell('위법행위\n내용', { rowSpan: 2, align: 'c' }), cell('회사 및\n회사관계자', { align: 'c' }), cell('0.4', { align: 'c' }), up1, mid1],
      [cell('감사인', { align: 'c' }), cell('0.4', { align: 'c' }),
        '‧위법행위가 감사인 또는 공인회계사의 이익에 직접적이고 상당한 영향을 미치는 경우',
        `${other}\n‧회사의 회계처리기준 위반을 묵인하거나 공모한 경우\n‧위법행위 관련 내부회계관리규정 위반사실을 알았음에도 의도적으로 지적하지 않고 감사계약을 연장한 경우`],
      [cell('위법행위\n정도', { rowSpan: 3, align: 'c' }), cell('위반규모', { align: 'c' }), cell('0.2', { align: 'c' }), '중요성 금액을 16배 이상 초과', '중요성 금액을 8배 이상 초과'],
      [cell('회사유형', { align: 'c' }), cell('0.2', { align: 'c' }), '주권상장법인\n(단, 코넥스시장 상장법인 제외)', '코넥스시장 상장법인, 「자본시장과 금융투자업에 관한 법률」 제159조제1항에 따른 사업보고서 제출대상법인, 대형비상장회사'],
      [cell('시장에\n미치는 영향', { align: 'c' }), cell('0.2', { align: 'c' }), '위법행위로 인하여 다수 채권자, 투자자 등 이해관계자에게 중대한 피해를 입히거나 사회적 물의를 야기한 경우', '회계처리기준을 위반한 재무제표를 이용한 증권 공모발행으로 다수의 채권자, 투자자 등 이해관계자에게 피해를 끼친 경우'],
    ],
  });
  out.push(S('small', '  ※ 회사ㆍ회사 관계자 또는 감사인의 위법행위 동기가 ‘중과실’에 해당하는 경우에는 해당 행위자에 대한 위법행위의 중요도 산정시 항목별 중요도가 ‘하(下)’에 해당하는 것으로 보아 1점을 매긴다.'));
  out.push(GAP);
  return out;
}

/** (3) 가중 · (4) 감경 — 사유 줄은 사유별로, 열은 연도(3개씩). 아래에 「기본과징금 × 율 = 금액」 계산 줄. */
function adjustBlocks(parties, years, kind) {
  const isW = kind === 'weighting';
  const word = isW ? '가중' : '감경';
  const reasons = isW ? R.WEIGHT_REASONS : R.MITIGATE_REASONS;
  const out = [];
  const anyUsed = parties.some((p) => p.byYear.some((d) => d && d[kind].items.length));
  if (!anyUsed) { out.push(S('label', '   □ 해당사항 없음')); out.push(GAP); return out; }
  for (const p of parties) {
    const used = [];
    for (const r of reasons) {
      const per = years.map((_, i) => { const d = p.byYear[i]; return d ? d[kind].items.find((it) => it.id === r.id) || null : null; });
      if (per.some(Boolean)) used.push({ r, per });
    }
    if (!used.length) { out.push(S('label', `   □ ${titleOf(p)} : 해당사항 없음`)); continue; }
    out.push(S('label', `   □ ${titleOf(p)}`));
    const cols = years.map((_, i) => i).filter((i) => p.byYear[i]);
    for (const part of chunk(cols, 3)) {
      out.push(unit11());
      const rows = used.map(({ r, per }) => {
        const prov = R.REPORT_PROVISION[r.id];
        const pcts = [...new Set(per.filter(Boolean).map((it) => it.pct))];
        const text = (per.find(Boolean) || {}).text;
        return [prov.rule, prov.limit, cell(`${word}\n(${r.auto ? '자동' : pcts.map((x) => `${x}%`).join('·')})`, { align: 'c' }), text || r.label,
          ...part.map((i) => cell(per[i] ? n(per[i].amount) : '-', { align: 'r' }))];
      });
      rows.push([cell('계', { bold: true, align: 'c', span: 4 }), ...part.map((i) => cell(n(p.byYear[i][kind].total), { align: 'r', bold: true }))]);
      out.push({
        t: 'table', font: 12, scale: 0.96, widths: [4.2, 2.4, 1.3, 4.0, ...part.map(() => 2.9)], align: ['l', 'l', 'c', 'l', ...part.map(() => 'r')],
        head: [[cell(`규정상\n${word}사유`, { rowSpan: 2 }), cell(`${word}\n가능금액`, { rowSpan: 2 }), cell(`${word}\n여부`, { rowSpan: 2 }), cell('사유', { rowSpan: 2 }), cell(`${word} 적용금액*`, { span: part.length })], part.map((i) => yearCell(years[i]))],
        rows,
      });
      out.push(S('small', `     * ${word} 적용금액 : 기본과징금 x ${word}율주)`));
      for (const i of part) {
        const d = p.byYear[i];
        used.forEach(({ per }, k) => {
          const it = per[i];
          if (!it) return;
          const body = `${n(d.basic)} × ${it.pct === null ? '(자동)' : it.pct / 100} = ${n(it.amount)}`;
          out.push(S('small', k === 0 ? `         ${yearOne(years[i])} : ${body}` : `                              ${body}`));
        });
      }
      out.push(S('small', '        주) ｢외부감사 및 회계 등에 관한 규정｣ 제43조제1항에 따른 부과기준율(별표8) 및 ｢주식회사 등의 외부감사에 관한 법률｣ 상 과징금 산정 및 부과방식 관련 적용방안 (2020.4.22. 증선위 보고)'));
      out.push(GAP);
    }
  }
  return out;
}

/** 한 묶음(회사+관계자, 또는 감사인)의 Ⅰ 산정원칙 · Ⅱ 산정결과 · Ⅲ 세부 산정내역. */
function group(parties, years, opts, isAuditor) {
  const { priorFine, reporter, companyTypeLabel } = opts;
  const out = [];
  const multi = years.length > 1;
  const lm = letterMap(parties, years);
  out.push(S('bracket', '【 외감법상 과징금 】'));
  out.push(S('sec', ' Ⅰ. 산정원칙'));
  if (isAuditor) {
    out.push(S('b1', '  □ 금융위원회는 감사인이 고의 또는 중대한 과실로 회계감사기준을 위반하여 감사보고서를 작성한 경우에는 그 감사인에 대하여 해당 감사로 받은 보수의 5배를 초과하지 아니하는 범위에서 과징금을 부과할 수 있음[법 제35조제2항]'));
  } else {
    out.push(S('b1', '  □ 금융위원회는 회사가 고의 또는 중대한 과실로 회계처리기준을 위반하여 재무제표를 작성한 경우에는 그 회사에 대하여 회계처리기준과 달리 작성된 금액의 100분의 20을 초과하지 아니하는 범위에서 과징금을 부과할 수 있음'));
    out.push(S('b2', '  ◦ 이 경우 회사의 위법행위를 알았거나 현저한 주의의무 위반으로 방지하지 못한 ｢상법｣ 제401조의2 및 제635조제1항에 규정된 자나 그 밖에 회사의 회계업무를 담당하는 자에 대하여도 회사에 부과하는 과징금의 100분의 10을 초과하지 아니하는 범위에서 과징금을 부과할 수 있음[법 제35조제1항]'));
  }
  out.push(S('b3', `  □ 과징금 부과액은 ${BASIS_TEXT()} 및 ｢주식회사 등의 외부감사에 관한 법률｣상 과징금 산정 및 부과방식 관련 적용방안(2020.4.22. 증선위 보고)에 따름`));
  out.push(GAP);
  out.push(S('sec', ' Ⅱ. 산정결과'));

  if (isAuditor) {
    // 감사인: 위반자 × 연도 표 + 연도를 열로 한 1~6 표
    out.push(unit());
    out.push({
      t: 'table', font: 12, scale: 0.96, widths: [3, ...years.map(() => 2.3), 2.5],
      head: [[cell('구분', { rowSpan: 2 }), cell('감사보고서', { span: years.length }), cell(`${years.length + 1}. 결정금액\n[MAX(${years.map((_, i) => i + 1).join(',')})]`, { rowSpan: 2 })], years.map((y, i) => `${i + 1}. ${yearOne(y)}`)],
      rows: parties.map((p) => [cell(titleOf(p), { lvl: 1 }), ...years.map((_, i) => cell(p.byYear[i] ? n(p.byYear[i].final) : '-', { align: 'r' })), cell(n(maxFinal(p)), { align: 'r', bold: true })]),
    });
    if (multi) out.push(S('note', ' ※ 동일한 위법행위가 2회계연도 이상에 걸쳐 발생한 경우에는 각 회계연도별 조치 중 가장 중한 조치를 부과(｢심사·감리결과 조치양정기준｣ Ⅱ. 일반원칙 1. 기본원칙 아.)'));
    for (const p of parties) {
      if (parties.length > 1) out.push(S('label', `  □ ${titleOf(p)}`));
      out.push(unit());
      out.push(auditorYearTable(p, years, priorFine, reporter));
    }
  } else {
    out.push(unit());
    out.push({
      t: 'table', font: 12, scale: 0.96, widths: [2.4, 2.4], align: ['c', 'r'],
      head: [['위반자', '과징금 부과액']],
      rows: parties.map((p) => [cell(titleOf(p), { align: 'c' }), cell(n(maxFinal(p)), { align: 'r' })]),
    });
    out.push(GAP);
    if (multi) {
      out.push(S('cmp', '   < 연도별 과징금 비교 >'));
      out.push(unit());
      out.push({
        t: 'table', font: 12, scale: 0.96, widths: [3.6, ...parties.map(() => 2.4)], align: ['l', ...parties.map(() => 'r')],
        head: [['연도별', ...parties.map(titleOf)]],
        rows: [
          ...years.map((y, i) => [`${circled(i)} ${yearOne(y)}`, ...parties.map((p) => cell(p.byYear[i] ? n(p.byYear[i].final) : '-', { align: 'r' }))]),
          [cell(`최종 과징금 (MAX(${years.length === 2 ? '①, ②' : `①~${circled(years.length - 1)}`}))`, { bold: true }), ...parties.map((p) => cell(n(maxFinal(p)), { align: 'r', bold: true }))],
        ],
      });
      out.push(GAP);
    }
    years.forEach((y, i) => {
      if (!parties.some((p) => p.byYear[i])) return;
      if (multi) out.push(S('year', `   ${circled(i)} ${yearOne(y)}`));
      out.push(...yearTables(parties, years, i, priorFine, reporter, multi));
    });
  }

  out.push(S('sec', ' Ⅲ. 과징금 세부 산정내역'));
  out.push(...capBlocks(parties, years, lm, isAuditor));
  out.push(...baseBlocks(parties, years, lm, isAuditor));
  out.push(S('sub', '  (2) 기본과징금(기준금액 × 부과기준율)'));
  for (const p of parties) out.push(...basicBlocks(p, years, lm, companyTypeLabel, isAuditor));
  out.push(...referenceBlocks());
  out.push(S('sub', '  (3) 가 중'));
  out.push(...adjustBlocks(parties, years, 'weighting'));
  out.push(S('sub', '  (4) 감 경'));
  out.push(...adjustBlocks(parties, years, 'mitigation'));
  out.push(S('sub', '  (5) 旣처분 벌금, 과태료 여부'));
  out.push(S('label', !isAuditor && priorFine > 0 ? `   □ 회사 : ${n(priorFine)}원 차감` : '   □ 해당사항 없음'));
  out.push(GAP);
  return out;
}

/** (참고) 구·신 비교 — **한 표**: 산정내역 | (구) 위반행위 발생당시 | (신) 현행. 끝에 유리한 기준 행. */
function compareBlocks(cmp, no) {
  const rowDefs = [
    ['기준금액', (d) => d.baseAmount, n],
    ['점수 → 율', (d) => (d.kind === 'company' ? '위반사항별' : `${score(d.tenths)} → ${pctText(d.rate)}`), (v) => v],
    ['기본과징금', (d) => d.basic, n],
    ['가중', (d) => d.weighting.total, (v) => (v ? `+${n(v)}` : '-')],
    ['감경', (d) => d.mitigation.total, (v) => (v ? `-${n(v)}` : '-')],
    ['한도', (d) => d.cap, n],
    ['결정 금액', (d) => d.final, n, true],
  ];
  const rows = [];
  for (const c of cmp) {
    const tag = c.only ? (c.pick === 'new' ? '(신)만 산정' : '(구)만 산정') : c.newFinal === c.oldFinal ? '동일' : c.pick === 'new' ? '(신) 유리' : '(구) 유리';
    rows.push([cell(`${c.key}  — ${tag}`, { span: 3, bold: true, fill: true })]);
    for (const [label, get, fmt, bold] of rowDefs) {
      const v = (side) => (c[side] ? cell(fmt(get(c[side].data)), { align: 'r', bold: !!bold }) : cell('산정 불가', { align: 'c' }));
      rows.push([cell(label, { lvl: bold ? 1 : 2 }), v('old'), v('new')]);
    }
  }
  const newBetter = cmp.filter((c) => c.pick === 'new' && !c.only);
  const oldDiff = cmp.filter((c) => c.pick === 'old' && !c.only && c.oldFinal !== c.newFinal);
  const names = (arr) => arr.map((c) => c.key.replace(' · ', ' ')).join(', ');
  let verdict;
  if (!newBetter.length) verdict = oldDiff.length ? '(구) 기준이 유리함' : '(구) 기준이 유리함 (구·신 금액 동일)';
  else if (!oldDiff.length) verdict = '(신) 기준이 유리함';
  else verdict = `(구) 기준이 유리함. 다만 ${names(newBetter)}은(는) (신) 기준이 유리함`;
  rows.push([cell('피조치자에게 유리한 기준', { bold: true, lvl: 1 }), cell(verdict, { span: 2, bold: true, align: 'c' })]);
  const total = cmp.reduce((a, c) => a + c.final, 0);
  return [
    S('h1', `${no}. (참고) 구·신 기준 비교`),
    unit(),
    { t: 'table', font: 12, scale: 0.96, widths: [3.4, 3.4, 3.4], head: [['산정내역', '(구) 기준\n위반행위 발생당시', '(신) 기준\n현행']], rows },
    S('note', `※ 같은 입력으로 (구)·(신) 기준을 각각 산정해 피조치자에게 유리한(적은) 금액을 결정액으로 하였음. 결정 금액 합계 ${n(total)}원`),
  ];
}

/**
 * 한글 파일 본문. `years` 는 `[{ term, year, label, materiality, result }]`(computeYear 결과 포함),
 * `opts` 는 `{ priorFine, reporter(신고자 감경이 있는지), companyTypeLabel, rules, compare }`.
 */
export function buildReport(years, opts) {
  R = (opts && opts.rules) || OLD_RULES;
  const parties = collect(years);
  const blocks = [{ t: 'title', text: '과징금 산정내역' }, S('note', `${R.REVISION_DETAIL} 기준 · 이 문서는 산정 화면의 계산 결과이며 최종 부과액은 금융위원회가 정합니다.`)];
  const main = parties.filter((p) => p.kind !== 'auditor');
  const auditors = parties.filter((p) => p.kind === 'auditor');
  let no = 1;
  if (main.length) {
    blocks.push(S('h1', `${no}. 회사 및 회사관계자`), unit());
    blocks.push({
      t: 'table', font: 13, scale: 0.96, widths: [4, 2, 3], align: ['c', 'c', 'c'], head: [['구분', '근거법령', '과징금 부과액']],
      rows: main.map((p) => [cell(titleOf(p), { bold: true }), cell('외감법', { bold: true }), cell(n(maxFinal(p)), { bold: true })]),
    });
    blocks.push(S('note', ' ※ 과징금은 금융위원회 의결사항으로서 부과조치안은 금융위에 별도 상정 예정임'));
    blocks.push(...group(main, years, opts, false));
    no += 1;
  }
  if (auditors.length) {
    blocks.push(S('h1', `${no}. 감사인`), unit());
    blocks.push({
      t: 'table', font: 13, scale: 0.96, widths: [4, 2, 3], align: ['c', 'c', 'c'], head: [['위반자', '근거법령', '과징금 부과액']],
      rows: auditors.map((p) => [cell(titleOf(p), { bold: true }), cell('외감법', { bold: true }), cell(n(maxFinal(p)), { bold: true })]),
    });
    blocks.push(...group(auditors, years, opts, true));
    no += 1;
  }
  if (opts && opts.compare && opts.compare.length) blocks.push(...compareBlocks(opts.compare, no));
  return blocks;
}
