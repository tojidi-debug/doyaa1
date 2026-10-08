/* qc_draft.js — [품감] 심의안 초안 엔진(순수 규칙, DOM 없음, jsdom 시험 가능) (2026-10-08)
 *
 *   QcDraft.model(phrases, sel, K)   체크 상태(sel) → 초안 모형: 조직 묶음(가.나.다.라 재부여·①②③ 재번호·묶음 유형) · 개별 항목(①~ 재번호·회사 수) · 건수·지적률 · 점수
 *   QcDraft.score(phrases, sel, K)   품질관리수준 점수(평가표 엑셀과 같은 셈법)
 *   QcDraft.assemble(sectionXml, phrases, m, ctx)   서식(section0.xml)의 지적사항 표·별지2·건수 문장을 모형대로 다시 쓴다. m 이 null 이면 고정 손질만(대표이사·주사무소·20xx년)
 *
 * 글은 서식의 문단을 **본으로 복제**해서 넣는다(글자모양·문단모양 유지). 짐작하지 않는다: 체크하지 않은 항목은 아예 쓰지 않는다.
 * 묶음 유형(서식 *1 주석): 중요절차(★) 항목에 미운영·미설계가 있으면 그 묶음은 「미운영」(미설계만이면 「미설계」), 그 밖은 「설계․운영상 일부 미흡」.
 * 개별 건수는 회사 수(한 회사에서 지적이 둘이어도 1). 평가표의 「기타 주요 계정과목」·「기타 감사조서의 문서화」만 세부 지적 수를 센다.
 */
(function (root) {
  const CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
  const LETTERS = '가나다라마바사아자차카타파하';
  const esc = (s) => String(s ?? '').replace(/\t/g, '  ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const unesc = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const T_RE = /(<hp:t(?:\s[^>]*)?>)([\s\S]*?)(<\/hp:t>)/g;
  const text = (xml) => { let out = ''; for (const m of String(xml).matchAll(T_RE)) out += m[2]; return unesc(out.replace(/<[^>]+>/g, '')); };
  const sq = (s) => String(s || '').replace(/[ \u00a0\u3000\t]+/g, ' ').trim();   /* 서식에 붙임표 공백(NBSP)이 섞여 있다 */
  const TYPE_LABEL = { '일부미흡': '설계․운영상 일부 미흡', '미운영': '미운영', '미설계': '미설계' };
  const CLS_SUFFIX = { '일부미흡': '일부 미흡', '미운영': '미운영', '미설계': '미설계' };

  /* ── 평가표 배점(품질관리수준평가표.xlsx 의 배점 산정 근거와 같다) ── */
  const ORG_W = { c1: 10 * 5 / 8, c2: 10 * 3 / 8, b1: 20 * 5 / 13, b2: 20 * 5 / 13, b3: 20 * 3 / 13, a1: 20 * 5 / 15, a2: 20 * 5 / 15, a3: 20 * 5 / 15, d1: 10 * 5 / 8, d2: 10 * 3 / 8 };
  const INDI_F = { i1: 5, i23: 5, i4: 1, i5: 5, i6: 5, i7: 1, i8: 1, i9: 5, i10: 1, i11: 15, i12: 3, i13: 3, i14: 3, i15: 1, i16: 10, i17: 1 };
  const INDI_SUM = Object.values(INDI_F).reduce((a, b) => a + b, 0);   // 65
  const indiG = (k) => 40 * INDI_F[k] / INDI_SUM;
  const VIOL_ROWS = ['GAAP', 'GAAS', '품질관리전담자', '연속감사제한', '미등기이사 업무수행', '기타'];
  const VIOL_PTS = 5;   // 위반자별 5점
  /* 법규 위반 혐의 항목 → 평가표 차감 줄 */
  const LAW_ROW = { rotation: '연속감사제한', qc_officer: '품질관리전담자', non_director: '미등기이사 업무수행', branch: '기타', etc: '기타' };

  /* ── 개별 항목: 회사별 탭에서 고른 지적(사용자 지정 2026-10-08) ──
   *   sel.indi.items[key].co[회사번호] = { f: [지적 글…], etc: '기타(자유기재)' } · sel.indi.small[회사번호] = 소규모기업
   *   예전 꼴(picks[{idx, cos[], text}] + variant)도 읽는다.
   * 기준서 문단 판은 자동: 모든 회사에서 고른 지적을 한꺼번에 덮는 판 중 가장 좁은 것(문단 7만 해당하는 지적뿐이면 문단 7,
   * 문단 7 내지 9와 12 까지 걸치면 그 판). 기타(자유기재)는 과거 사례 지적 중 가장 비슷한 것(≥0.45)으로 판을 짐작.
   * 회사 중 하나라도 소규모기업이면 그 판의 「감사기준서 1200」 판. 손으로 고르면(st.vsel) 그대로. */
  const GA_RE = { plan: /감사계획|중요성|전반감사|범위 설정|위험평가/, indep: /독립성/ };
  function indiPool(item) {
    if (item._pool) return item._pool;
    const out = [];
    item.variants.forEach((v, vi) => { if (v.small) return; for (const f of v.findings || []) { let e = out.find(x => x.text === f); if (!e) { e = { text: f, vs: [] }; out.push(e); } e.vs.push(vi); } });
    Object.defineProperty(item, '_pool', { value: out, enumerable: false, configurable: true });
    return out;
  }
  function coSel(item, st, K) {
    const out = Array.from({ length: K }, (_, i) => { const c = (st.co || {})[i] || {}; return { f: (c.f || []).filter(Boolean), etc: sq(c.etc || '') }; });
    if ((st.picks || []).length) {   // 예전 꼴
      const v = item.variants[Math.min(st.variant || 0, item.variants.length - 1)] || { findings: [] };
      for (const p of st.picks) {
        const etc = p.idx === 'etc'; const txt = etc ? sq(p.text) : v.findings[p.idx]; if (!txt) continue;
        (p.cos || []).slice(0, K).forEach((on, i) => { if (!on) return; if (etc) out[i].etc = out[i].etc ? `${out[i].etc} ${txt}` : txt; else if (!out[i].f.includes(txt)) out[i].f.push(txt); });
      }
    }
    return out;
  }
  function smallOf(item, vi) {
    const base = item.variants[vi]; if (!base || base.small) return vi;
    const r = base.rules || [];
    let j = item.variants.findIndex(v => v.small && r.every((x, n) => (v.rules || [])[n] === x));
    if (j < 0) j = item.variants.findIndex(v => v.small);
    return j < 0 ? vi : j;
  }
  /* 판 고르기: 고른 지적마다 그 지적이 든 판(과거 사례에서 그 지적과 함께 쓰인 문단을 덮는 판) → 모두 덮는 판 중 문단이 가장 적은 것(ntok).
   * 한 판이 다 덮지 못하면 여러 판을 합친다(관련규정 이어 쓰기, 「…하여야 함에도」 → 「…하여야 하고,」로 이어 붙임) */
  const ntok = (v) => (Number.isFinite(v.ntok) ? v.ntok : 99);
  const better = (item) => (a, i) => { const A = item.variants[a], B = item.variants[i]; return ntok(B) < ntok(A) || (ntok(B) === ntok(A) && (B.findings || []).length < (A.findings || []).length) ? i : a; };
  function textSets(item, texts) {
    const P = indiPool(item); const out = [];
    for (const t of texts) {
      let e = P.find(x => x.text === t);
      if (!e) { let bv = 0.45; for (const x of P) { const v = dice(t, x.text); if (v > bv) { bv = v; e = x; } } }
      if (e) out.push(e.vs);
    }
    return out;
  }
  function autoVariant(item, texts) {
    const ns = item.variants.map((v, i) => (v.small ? -1 : i)).filter(i => i >= 0); if (!ns.length) return 0;
    const sets = textSets(item, texts); if (!sets.length) return ns[0];
    const cand = ns.filter(i => sets.every(vs => vs.includes(i)));
    return cand.length ? cand.reduce(better(item)) : -1;
  }
  function joinBasis(parts) {
    return parts.map((v, n) => (n < parts.length - 1 ? String(v.basis || '').replace(/함에도\s*$/, '하고,') : String(v.basis || ''))).join('');
  }
  function chooseVariant(item, texts, small) {
    const vi = autoVariant(item, texts);
    if (vi >= 0) { const j = small ? smallOf(item, vi) : vi; return { vi: j, variant: item.variants[j] }; }
    // 덮는 판이 없음 → 적게 합쳐 덮는다(탐욕) — 남은 지적을 가장 많이 덮는 판, 같으면 문단이 적은 판
    const sets = textSets(item, texts); const ns = item.variants.map((v, i) => (v.small ? -1 : i)).filter(i => i >= 0);
    let left = sets.map((_, n) => n); const parts = [];
    while (left.length) {
      const best = ns.reduce((a, i) => { const ca = left.filter(n => sets[n].includes(a)).length, ci = left.filter(n => sets[n].includes(i)).length; return ci > ca || (ci === ca && ntok(item.variants[i]) < ntok(item.variants[a])) ? i : a; }, ns[0]);
      const cov = left.filter(n => sets[n].includes(best)); if (!cov.length) break;
      parts.push(best); left = left.filter(n => !cov.includes(n));
    }
    const vs = parts.map((i, n) => item.variants[small && n === 0 ? smallOf(item, i) : i]);
    const rules = []; for (const v of vs) for (const r of v.rules || []) if (!rules.includes(r)) rules.push(r);
    return { vi: -1, variant: { basis: joinBasis(vs), rules, label: `여러 판 합침 — ${rules.join(' · ')}`, findings: [], small: !!small, title: vs[0] && vs[0].title, composed: parts } };
  }
  /* 개별 항목의 회사별 지적 수: 보통 1/0, i11·i16 은 세부 지적 수 */
  function indiCounts(item, sel, K) {
    const st = (sel.indi && sel.indi.items && sel.indi.items[item.key]) || {};
    const cs = coSel(item, st, K);
    const per = cs.map(c => c.f.length + (c.etc ? 1 : 0));
    const P = indiPool(item); const order = (t) => { const i = P.findIndex(x => x.text === t); return i < 0 ? 1e6 : i; };
    const map = new Map();
    cs.forEach((c, i) => { for (const t of [...c.f, ...(c.etc ? [c.etc] : [])]) { if (!map.has(t)) map.set(t, new Array(K).fill(false)); map.get(t)[i] = true; } });
    const rows = [...map.entries()].sort((x, y) => order(x[0]) - order(y[0])).map(([text, cos]) => ({ text, count: cos.filter(Boolean).length, cos }));
    /* 평가표 체크에서 회사별로 표시한 것(marks)도 센다 — 지적 예시를 안 골라도 평가표·건수에 들어간다(사용자 지정 2026-10-08) */
    const marks = (st.marks || []).slice(0, K);
    marks.forEach((v2, i) => { const n = Number(v2) || 0; if (n > per[i]) per[i] = n; });
    /* ⑮ 기타 감사조서의 문서화는 하위 5항목(공시사항점검표·완결조서·서명·유기적 연결·기타) 체크의 합(평가표 수식 E104=SUM(E105:E109)) */
    if (st.subs) for (let i = 0; i < K; i++) { const n = Object.values(st.subs).reduce((a, arr) => a + (Number((arr || [])[i]) || 0), 0); if (n > per[i]) per[i] = n; }
    const detail = item.key === 'i11' || item.key === 'i16';
    const perCo = per.map(n => detail ? n : (n ? 1 : 0));
    const companies = per.filter(n => n > 0).length;
    const legacy = (st.picks || []).length && Number.isInteger(st.variant) && st.variant < item.variants.length;   /* 예전 꼴은 고른 판 그대로 */
    const manual = (Number.isInteger(st.vsel) && st.vsel >= 0 && st.vsel < item.variants.length) || legacy;
    /* ⑰: 지적 문안 없이 평가표 하위 줄(감사계획·독립성)만 체크했으면 그 줄의 표준 지적으로 판을 고르고 지적 줄도 채운다 */
    if (item.key === 'i17' && !rows.length && st.subs) {
      const P2 = indiPool(item); const pick = (re) => (P2.find(x => re.test(x.text) && !(re === GA_RE.plan ? GA_RE.indep : GA_RE.plan).test(x.text)) || {}).text;
      for (const [sk, re] of [['s1', GA_RE.plan], ['s2', GA_RE.indep]]) {
        const cos = new Array(K).fill(false).map((_, i) => (Number(((st.subs[sk]) || [])[i]) || 0) > 0); const t = pick(re);
        if (t && cos.some(Boolean)) rows.push({ text: t, count: cos.filter(Boolean).length, cos });
      }
    }
    const small = ((sel.indi && sel.indi.small) || []).slice(0, K);
    const anySmall = per.some((n, i) => n > 0 && small[i]);
    let vi, variant;
    if (manual) { vi = Number.isInteger(st.vsel) && st.vsel >= 0 && st.vsel < item.variants.length ? st.vsel : st.variant; variant = item.variants[vi]; }
    else ({ vi, variant } = chooseVariant(item, rows.map(r => r.text), anySmall));
    return { rows, perCo, companies, variant: variant || { findings: [], rules: [], basis: '' }, vi, auto: !manual, total: perCo.reduce((a, b) => a + b, 0), co: cs };
  }

  /* 「□ 따라서 …」는 항목마다 **하나**(사용자 지정 2026-10-08): 고쳐 쓴 글 → 고른 번호 → 없으면 지적 문안과 가장 비슷한 것.
   * 서식 별지2 에는 예시와 따라서의 짝이 적혀 있지 않아, 글자 2-gram 겹침으로 고른다(사용자가 최종 선택) */
  const bigr = (s) => { const t = String(s || '').replace(/[\s.,·()「」'"]/g, ''); const m = new Map(); for (let i = 0; i < t.length - 1; i++) { const k = t.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; };
  function dice(a, b) { const A = bigr(a), B = bigr(b); let inter = 0, na = 0, nb = 0; A.forEach(v => { na += v; }); B.forEach(v => { nb += v; }); A.forEach((v, k) => { inter += Math.min(v, B.get(k) || 0); }); return na + nb ? 2 * inter / (na + nb) : 0; }
  /* 따라서 후보끼리 모두 겹치는 2-gram(「따라서 감사인은」「하여야 함」 같은 것)은 빼고, 지적 문안과 겹치는 것만 센다. 다 0 이면 첫째 */
  function bestTherefore(list, text) {
    if (!list || !list.length) return -1; if (!sq(text) || list.length === 1) return 0;
    const sets = list.map(t => bigr(t)); const T = bigr(text);
    const common = [...sets[0].keys()].filter(k => sets.every(m => m.has(k)));
    let bi = 0, bv = 0;
    sets.forEach((m, i) => { let hit = 0, size = 0; m.forEach((v, k) => { if (common.includes(k)) return; size += 1; if (T.has(k)) hit += 1; }); const v = size ? hit / Math.sqrt(size) : 0; if (v > bv + 1e-9) { bv = v; bi = i; } });
    return bi;
  }
  /* 자동 선택 순서(2026-10-08): ① 고른 예시에 과거 사례의 짝(ex_ther)이 있으면 그 따라서 ② 고쳐 쓴 글이 어느 예시와 비슷하면(≥0.6) 그 예시의 짝
   * ③ 없으면 글자 겹침(bestTherefore). 미설계는 미운영 예시·짝을 쓴다. 돌려주는 값 { i, by: 'pair'|'similar' } */
  function autoTher(it, st) {
    const list = it.therefore || []; if (!list.length) return { i: -1, by: '' };
    const cls = st.cls === '미설계' ? '미운영' : st.cls; const ok = (n) => Number.isInteger(n) && n >= 0 && n < list.length;
    const rows = (it.ex_ther || {})[cls] || [];
    if (Number.isInteger(st.ex) && ok(rows[st.ex])) return { i: rows[st.ex], by: 'pair' };
    const t = sq(st.text);
    if (t) {
      let bi = -1, bv = 0.6;
      for (const c of [cls, ...Object.keys(it.examples || {}).filter(x => x !== cls)]) {
        const exs = (it.examples || {})[c] || [], rs = (it.ex_ther || {})[c] || [];
        exs.forEach((e, n) => { if (!ok(rs[n])) return; const v = dice(t, e); if (v > bv + 1e-9) { bv = v; bi = rs[n]; } });
        if (bi >= 0) break;
      }
      if (bi >= 0) return { i: bi, by: 'pair' };
    }
    return { i: bestTherefore(list, st.text), by: 'similar' };
  }
  function pickTherefore(it, st) {
    const list = it.therefore || []; if (sq(st.therText)) return [sq(st.therText)]; if (!list.length) return [];
    const i = Number.isInteger(st.ther) && st.ther >= 0 && st.ther < list.length ? st.ther : autoTher(it, st).i;
    return [list[i]];
  }
  function orgType(items) {
    const imp = items.filter(i => i.important);
    if (imp.some(i => i.cls === '미운영')) return '미운영';
    if (imp.some(i => i.cls === '미설계')) return '미설계';   /* 미설계는 드물다 — 고른 경우에만(선택 목록 맨 아래) */
    return '일부미흡';
  }

  /* 체크 상태 → 초안 모형 */
  function model(phrases, sel, K) {
    sel = sel || {}; K = Math.max(0, Number(K) || 0);
    const org = { groups: [], count: 0, byType: { '미운영': 0, '미설계': 0, '일부미흡': 0 } };
    let letter = 0;
    for (const g of phrases.org.groups) {
      const items = [];
      for (const it of g.items) {
        const st = (sel.org && sel.org.items && sel.org.items[it.key]) || {};
        if (!st.cls || st.cls === '미지적') continue;
        const clsN = st.cls;
        const txt = sq(st.text || '');
        const therefore = pickTherefore(it, st);
        items.push({ key: it.key, no: CIRC[items.length], title: it.title, important: it.important, cls: clsN, text: txt, repeat: !!st.repeat, therefore,
          label: `${CIRC[items.length]} ${it.title} ${CLS_SUFFIX[clsN]}${st.repeat ? '*2' : ''}` });
      }
      if (!items.length) continue;
      const type = orgType(items);
      org.groups.push({ key: g.key, letter: LETTERS[letter++], title: g.title, basis: g.basis, rules: g.rules, type, typeLabel: TYPE_LABEL[type], items });
      org.count += 1; org.byType[type] += 1;
    }
    const indi = { parts: [], items: [], K, total: 0, checkedItems: 0 };
    let no = 0;
    for (const part of phrases.indi.parts) {
      const rows = [];
      for (const it of phrases.indi.items.filter(i => i.part === part)) {
        const c = indiCounts(it, sel, K);
        if (!c.companies) continue;
        const base = it.title.replace(/\s*미흡\s*$/, '');
        const row = { key: it.key, no: CIRC[no++], base, title: `${base} 미흡`, part, companies: c.companies, perCo: c.perCo, findings: c.rows, basis: c.variant.basis, rules: c.variant.rules, small: !!c.variant.small };
        if (c.variant.title) row.title = c.variant.title;   /* ⑰ 처럼 판마다 제목이 다른 항목(감사계획 / 독립성 / 둘 다) */
        rows.push(row); indi.items.push(row); indi.total += c.companies;
      }
      if (rows.length) indi.parts.push({ part, rows, count: rows.reduce((a, r) => a + r.companies, 0) });
    }
    indi.checkedItems = indi.items.length;
    indi.year = sq((sel.indi && sel.indi.year) || '') || new Date().getFullYear();
    indi.itemsTotal = phrases.indi.items.length;   // 17
    indi.totalItems = K * indi.itemsTotal;
    indi.rate = indi.totalItems ? Math.round(indi.total / indi.totalItems * 100) : 0;
    const prior = (sel.indi && sel.indi.prior) || {};
    const pk = Number(prior.companies) || 0, pf = Number(prior.findings) || 0;
    indi.prior = { year: sq(prior.year || ''), companies: pk, findings: pf, totalItems: pk * indi.itemsTotal, rate: pk ? Math.round(pf / (pk * indi.itemsTotal) * 100) : 0 };
    const vsel = (sel.indi && sel.indi.viol) || {}, lsel = (sel.org && sel.org.law) || {};
    const pv = phrases.viol || {};
    const viol = {
      gaap: vsel.gaap && vsel.gaap.on ? { heading: (pv.gaap || {}).heading, text: sq(vsel.gaap.text) || (pv.gaap || {}).example || '' } : null,
      gaas: vsel.gaas && vsel.gaas.on ? { heading: (pv.gaas || {}).heading, text: sq(vsel.gaas.text) || (pv.gaas || {}).example || '' } : null,
      law: [],
    };
    for (const it of ((pv.law || {}).items || [])) {
      const st = lsel[it.key] || {};
      if (!st.on) continue;
      viol.law.push({ key: it.key, numbered: it.numbered, title: sq(st.title) || it.title, text: sq(st.text) || it.example || '' });
    }
    viol.lawHeading = (pv.law || {}).heading || '';
    viol.any = !!(viol.gaap || viol.gaas || viol.law.length);
    return { org, indi, viol, score: score(phrases, sel, K) };
  }

  /* 점수 — 조직 60 + 개별 40 − 법규위반 차감 */
  function score(phrases, sel, K) {
    sel = sel || {}; K = Math.max(0, Number(K) || 0);
    const orgItems = [];
    let orgTotal = 0;
    for (const g of phrases.org.groups) for (const it of g.items) {
      const cls = ((sel.org && sel.org.items && sel.org.items[it.key]) || {}).cls || '미지적';
      const w = ORG_W[it.key] || 0;
      const pts = cls === '미운영' || cls === '미설계' ? 0 : cls === '일부미흡' ? w / 2 : w;
      orgItems.push({ key: it.key, title: it.title, cls, w, pts }); orgTotal += pts;
    }
    const cnt = {}; for (const it of phrases.indi.items) cnt[it.key] = indiCounts(it, sel, K);
    const avg = (k) => K ? cnt[k].total / K : 0;
    const indiItems = []; let indiTotal = 0;
    const push = (k, title, I, pts) => { indiItems.push({ key: k, title, avg: I, w: indiG(k), pts }); indiTotal += pts; };
    for (const k of Object.keys(INDI_F)) {
      const G = indiG(k);
      if (k === 'i23') { const I = K ? (cnt.i2.total + cnt.i3.total) / K : 0; push(k, '중요한 왜곡표시위험의 식별과 평가절차/평가된 왜곡표시위험 관련 대응절차', I, G - G * (I / 2)); continue; }
      const I = avg(k);
      if (k === 'i11') { push(k, '기타 주요 계정과목에 대한 감사절차', I, I > 4 ? 0 : I > 2 ? G / 3 : I > 1 ? G * 2 / 3 : G - G * I); continue; }
      if (k === 'i16') { push(k, '기타 감사조서의 문서화', I, I > 2 ? 0 : I > 1 ? G / 2 : G); continue; }   // 평가표 J54 와 같다(1 이하면 만점)
      push(k, (phrases.indi.items.find(i => i.key === k) || {}).title || k, I, G - G * I);
    }
    /* 법규위반 차감 — 위반 혐의 체크에서 바로 셈(평가표 「법규위반 점수 산정요령」 준용, 사용자 지정 2026-10-08):
     *   위반자별 5점 차감(예: 미등기이사 감사업무 수행, 위반자 2명·감사보고서 10개 → 2 × 5 = 10점).
     *   품질관리제도의 영향이 없는 사항(손해배상준비금 미적립 등)은 「차감 제외」로 표시하면 빼고 센다. */
    const n = {}; VIOL_ROWS.forEach(r => { n[r] = 0; });
    const people = (st) => Math.max(1, Number(st.n) || 1);
    const iv = (sel.indi && sel.indi.viol) || {}, law = (sel.org && sel.org.law) || {};
    if ((iv.gaap || {}).on && !(iv.gaap || {}).noqc) n.GAAP += people(iv.gaap);
    if ((iv.gaas || {}).on && !(iv.gaas || {}).noqc) n.GAAS += people(iv.gaas);
    for (const [key, st] of Object.entries(law)) {
      if (!st || !st.on || st.noqc) continue;
      n[LAW_ROW[key] || '기타'] += people(st);
    }
    /* 오른쪽 차감 표에서 손으로 고친 값이 있으면 그것을 쓴다(자동값은 auto 로 함께 둔다) — 사용자 지정 2026-10-08 */
    const ovr = (sel.org && sel.org.violOvr) || {};
    let deduct = 0; const violRows = [];
    for (const r of VIOL_ROWS) {
      const o = ovr[r] || {}; const hasN = o.n !== undefined && o.n !== '', hasP = o.pts !== undefined && o.pts !== '';
      const cnt = hasN ? Math.max(0, Number(o.n) || 0) : n[r]; const pts = hasP ? Math.max(0, Number(o.pts) || 0) : VIOL_PTS;
      deduct += cnt * pts; violRows.push({ row: r, n: cnt, pts: cnt ? pts : (hasP ? pts : 0), sum: cnt * pts, auto: n[r], manual: hasN || hasP });
    }
    const total = orgTotal + indiTotal - deduct;
    const level = total >= 90 ? '양호' : total >= 50 ? '보통' : '미흡';
    return { org: orgTotal, orgItems, indi: indiTotal, indiItems, deduct, violRows, total, level, K };
  }

  /* ── hwpx 조립 ── */
  function topParas(sec) {
    const out = []; let depth = 0, start = -1;
    for (const m of sec.matchAll(/<hp:p\b|<\/hp:p>/g)) {
      if (m[0] === '<hp:p') { if (depth === 0) start = m.index; depth++; }
      else { depth--; if (depth === 0) out.push(sec.slice(start, m.index + 7)); }
    }
    return out;
  }
  /* 문단의 <hp:t> 를 차례로 texts 로 채우고 나머지는 비운다(형광펜 표식도 함께 사라진다) */
  /* 글을 바꾸면 서식의 줄 배치 정보(linesegarray)를 지운다 — 남겨 두면 한글이 예전 한 줄 배치대로 그려 글자가 겹친다(2026-10-08) */
  const noLineseg = (x) => String(x).replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '');
  function setRuns(pxml, texts) {
    let i = 0;
    return noLineseg(pxml.replace(T_RE, (m, a, b, c) => { const t = texts[i++]; return a + (t == null ? '' : esc(t)) + c; }));
  }
  /* 같은 글꼴·크기·색·굵기에 장평 100%·자간 0 인 글자모양(header.xml) — 없으면 null */
  function normalCharPr(header, id) {
    if (!header || id == null) return null;
    const cps = {}; for (const m of String(header).matchAll(/<hh:charPr id="(\d+)"[\s\S]*?<\/hh:charPr>/g)) cps[m[1]] = m[0];
    const key = (x) => [(/height="(\d+)"/.exec(x) || [])[1], (/<hh:fontRef [^>]*>/.exec(x) || [])[0], (/textColor="([^"]+)"/.exec(x) || [])[1], /<hh:bold/.test(x)].join('|');
    const base = cps[id]; if (!base) return null;
    const ok = (x) => /<hh:ratio [^>]*hangul="100"/.test(x) && /<hh:spacing [^>]*hangul="0"/.test(x) && !/<hh:underline type="(?!NONE)/.test(x) && !/<hh:italic/.test(x);
    if (ok(base)) return id;
    const k = key(base); const hit = Object.keys(cps).find(i => key(cps[i]) === k && ok(cps[i]));
    return hit || null;
  }
  const setText = (pxml, t) => setRuns(pxml, [t]);
  /* 표 칸: 첫 문단만 남기고 그 글을 바꾼다. texts 가 여럿이면 첫 문단을 그 수만큼 복제 */
  function setCell(tc, texts) {
    texts = Array.isArray(texts) ? texts : [texts];
    return tc.replace(/(<hp:subList[^>]*>)([\s\S]*?)(<\/hp:subList>)/, (m, a, inner, c) => {
      const ps = topParas(inner); const proto = ps[0] || '';
      return a + texts.map(t => setText(proto, t)).join('') + c;
    });
  }
  const attr = (xml, name, value) => xml.replace(new RegExp(`${name}="[^"]*"`), `${name}="${value}"`);
  const cellsOf = (tr) => tr.match(/<hp:tc\b[\s\S]*?<\/hp:tc>/g) || [];
  const rowsOf = (tbl) => tbl.match(/<hp:tr>[\s\S]*?<\/hp:tr>/g) || [];
  const withRows = (tbl, rows) => { const head = tbl.slice(0, tbl.indexOf('<hp:tr>')); const tail = tbl.slice(tbl.lastIndexOf('</hp:tr>') + 8); return attr(head, 'rowCnt', rows.length) + rows.join('') + tail; };
  const setRowAddr = (tr, r) => tr.replace(/rowAddr="\d+"/g, `rowAddr="${r}"`);
  const setSpan = (tc, n) => tc.replace(/rowSpan="\d+"/, `rowSpan="${n}"`);
  const tblOf = (pxml) => { const m = /<hp:tbl\b[\s\S]*<\/hp:tbl>/.exec(pxml); return m ? m[0] : null; };

  /* 품질관리절차 관련 지적사항 표(중점점검항목|지적사항|유형|공개여부) */
  function orgTable(pxml, org, header) {
    const tbl = tblOf(pxml); const rows = rowsOf(tbl);
    const head = rows[0], pFirst = rows[1], pNext = rows[2];
    const out = [head]; let r = 1;
    const groups = org.groups.length ? org.groups : [{ title: '-', items: [{ label: '지적사항 없음' }], typeLabel: '-', none: true }];
    for (const g of groups) {
      const n = g.items.length; const c = cellsOf(pFirst);
      const first = pFirst.replace(c[0], setSpan(setCell(c[0], g.title), n)).replace(c[1], setCell(c[1], g.items[0].label))
        .replace(c[2], setSpan(typeCell(c[2], g.typeLabel, header), n)).replace(c[3], setSpan(setCell(c[3], g.none ? '-' : '공개'), n));
      out.push(setRowAddr(first, r++));
      for (const it of g.items.slice(1)) { const cc = cellsOf(pNext); out.push(setRowAddr(pNext.replace(cc[0], setCell(cc[0], it.label)), r++)); }
    }
    /* 유형 칸(3열)을 넓히고 지적사항 칸(2열)을 그만큼 줄인다 — 「설계․운영상」 6자를 장평 100%로 한 줄에(사용자 지정 2026-10-08) */
    const D = 2400;
    const widen = (tr) => tr.replace(/<hp:tc\b[\s\S]*?<\/hp:tc>/g, (tc) => {
      const col = (/colAddr="(\d+)"/.exec(tc) || [])[1]; const span = Number((/colSpan="(\d+)"/.exec(tc) || [])[1] || 1);
      if (span !== 1 || (col !== '1' && col !== '2')) return tc;
      return tc.replace(/(<hp:cellSz width=")(\d+)(")/, (m, a, w, c) => a + (Number(w) + (col === '2' ? D : -D)) + c);
    });
    return pxml.replace(tbl, withRows(tbl, out.map(widen)));
  }
  /* 유형 칸 — 장평 100%·자간 0 글자모양으로(서식은 95%·−9 라 「설계․운영상 일부 미흡」이 눌려 보였다, 사용자 지정 2026-10-08) */
  /* 같은 정렬·줄간격에 내어쓰기·들여쓰기 없는 문단모양(header.xml) — 칸 안 글이 둘째 줄부터 좁아지지 않게 */
  function plainParaPr(header, id) {
    if (!header || id == null) return null;
    const pps = {}; for (const m of String(header).matchAll(/<hh:paraPr id="(\d+)"[\s\S]*?<\/hh:paraPr>/g)) pps[m[1]] = m[0];
    const base = pps[id]; if (!base) return null;
    const al = (x) => (/<hh:align horizontal="(\w+)"/.exec(x) || [])[1];
    const flat = (x) => { const c = (/<hp:case[\s\S]*?<\/hp:case>/.exec(x) || [x])[0]; return /<hc:intent value="0"/.test(c) && /<hc:left value="0"/.test(c) && /<hc:right value="0"/.test(c); };
    if (flat(base)) return id;
    const hit = Object.keys(pps).find(i => al(pps[i]) === al(base) && flat(pps[i]) && !/<hh:heading type="(?!NONE)/.test(pps[i]));
    return hit || null;
  }
  function typeCell(tc, label, header) {
    const lines = /^설계[․·]운영상\s*일부\s*미흡$/.test(label) ? [label.replace(/\s*일부\s*미흡$/, ''), '일부 미흡'] : [label];   /* 서식처럼 두 줄 */
    let x = setCell(tc, lines);
    const id = (/charPrIDRef="(\d+)"/.exec(x) || [])[1]; const n = normalCharPr(header, id);
    if (n && n !== id) x = x.replace(/charPrIDRef="\d+"/g, `charPrIDRef="${n}"`);
    const pid = (/paraPrIDRef="(\d+)"/.exec(x) || [])[1]; const pp = plainParaPr(header, pid);   /* 서식 문단은 내어쓰기 54pt 라 둘째 줄부터 한 글자씩 내려갔다 */
    if (pp && pp !== pid) x = x.replace(/paraPrIDRef="\d+"/g, `paraPrIDRef="${pp}"`);
    return x;
  }
  /* 선정현황 표(구분|모집단구성수|표본선정수|선정률) — 합계 모집단 = 사업보고서 당기 외감대상회사 수, 업종 구분 없이 「기타」에 일괄, 표본 = 점검회사 수(사용자 지정 2026-10-08) */
  function selectionTable(pxml, total, K) {
    const tbl = tblOf(pxml); const rows = rowsOf(tbl);
    const fmt = (v) => (v == null || v === '' || Number.isNaN(v) ? '-' : Number(v).toLocaleString('en-US'));
    const T = Number(total); const rate = T > 0 && K ? (K / T * 100).toFixed(1) : '-';
    const vals = { '제조업': ['-', '-', '-'], '건설업': ['-', '-', '-'], '기타': [fmt(T || null), K ? String(K) : '-', rate], '합계': [fmt(T || null), K ? String(K) : '-', rate] };
    const out = rows.map(tr => {
      const cs = cellsOf(tr); const lab = text(cs[0] || '').replace(/\s+/g, ''); const v = vals[lab]; if (!v) return tr;
      let t = tr; [1, 2, 3].forEach((ci, n) => { if (cs[ci]) t = t.replace(cs[ci], setCell(cs[ci], v[n])); }); return t;
    });
    return pxml.replace(tbl, withRows(tbl, out));
  }
  /* 개별감사업무 관련 지적사항 표(부문|제목|건수 + 합계) */
  function indiTable(pxml, indi) {
    const tbl = tblOf(pxml); const rows = rowsOf(tbl);
    const head = rows[0], pPart = rows[1], pTotal = rows[rows.length - 1];
    const out = [head]; let r = 1;
    const parts = indi.parts.length ? indi.parts : [{ part: '-', rows: [{ title: '지적사항 없음', companies: '-' }], count: '-' }];
    for (const p of parts) {
      const c = cellsOf(pPart);
      out.push(setRowAddr(pPart.replace(c[0], setCell(c[0], p.part)).replace(c[1], setCell(c[1], p.rows.map(x => `◦ ${x.title}`))).replace(c[2], setCell(c[2], p.rows.map(x => String(x.companies)))), r++));
    }
    const tc = cellsOf(pTotal);
    out.push(setRowAddr(pTotal.replace(tc[2], setCell(tc[2], String(indi.total))), r++));
    /* 행 높이는 최소로, 모든 칸의 위·아래 안 여백 3mm(850 HWPUNIT) — 사용자 지정 2026-10-08 */
    const tight = out.map(tr => tr.replace(/<hp:cellSz width="(\d+)" height="\d+"\/>/g, '<hp:cellSz width="$1" height="1000"/>').replace(/<hp:cellMargin left="(\d+)" right="(\d+)" top="\d+" bottom="\d+"\/>/g, '<hp:cellMargin left="$1" right="$2" top="850" bottom="850"/>'));
    return pxml.replace(tbl, withRows(tbl, tight));
  }
  /* 점검결과 비교표(구분|점검회사수|점검항목|총항목수|지적수|지적률) */
  function compareTable(pxml, indi) {
    const tbl = tblOf(pxml); const rows = rowsOf(tbl); if (rows.length < 3) return pxml;
    const fill = (tr, vals) => { let t = tr; cellsOf(tr).forEach((c, i) => { if (vals[i] != null) t = t.replace(c, setCell(c, vals[i])); }); return t; };
    const pr = indi.prior; const cur = new Date().getFullYear();
    const r1 = fill(rows[1], [pr.year ? `${pr.year}년` : null, pr.companies ? `${pr.companies}개사` : null, `${indi.itemsTotal}개`, pr.companies ? String(pr.totalItems) : null, pr.companies ? String(pr.findings) : null, pr.companies ? `${pr.rate}%` : null]);
    const r2 = fill(rows[2], [`${indi.year || cur}년`, `${indi.K}개사`, `${indi.itemsTotal}개`, String(indi.totalItems), String(indi.total), `${indi.rate}%`]);
    return pxml.replace(tbl, withRows(tbl, [rows[0], r1, r2]));
  }

  /* 별지2 【품질관리절차에 관한 사항】 ~ (첨부) 를 모형대로 다시 쓴다 */
  function appendix2(paras, a, b, end, m, ctx) {
    const P = paras; const find = (from, to, re) => { for (let i = from; i < to; i++) if (re.test(sq(text(P[i])))) return P[i]; throw new Error(`서식 문단을 못 찾음: ${re}`); };
    const blank = P[a + 1] && !sq(text(P[a + 1])) ? P[a + 1] : '<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t></hp:t></hp:run></hp:p>';
    // 조직 본
    const pHead = find(a, b, /^(가|나)\.\s/), pBasis = find(a, b, /^□「품질관리기준서/), pItem = find(a, b, /^①/), pEx = find(a, b, /^◦ 감사인은/),
      pTherefore = find(a, b, /^□ 따라서/), pRuleHead = find(a, b, /^<관련규정>/), pRule = find(a, b, /^1\.「품질관리기준서/);
    const out = [];
    const orgLead = text(pHead).match(/^\s*/)[0];
    if (!m.org.groups.length) out.push(blank, setText(pBasis, ' □ 품질관리절차 관련 지적사항 없음'), blank);
    for (const g of m.org.groups) {
      out.push(setRuns(pHead, [`${orgLead}${g.letter}. ${g.title} 관련`, ' ', `(${g.typeLabel})`]), blank, setRuns(pBasis, [' □', g.basis]), blank);
      for (const it of g.items) {
        out.push(blank, setRuns(pItem, [` ${it.no} `, ` ${it.title} ${CLS_SUFFIX[it.cls]}${it.repeat ? '*2' : ''}`]), blank);
        if (it.text) out.push(setRuns(pEx, [' ', '◦ ', it.text]), blank);
        for (const t of it.therefore) out.push(setRuns(pTherefore, [' □ ', t]), blank);
      }
      out.push(pRuleHead, ...g.rules.map(r => setText(pRule, ` ${r}`)), blank, blank);
    }
    // 개별 본
    const pIHead = P[b]; const pIIntro = find(b, end, /^□ .*개별감사업무 중/), pINote = find(b, end, /^◦ 이러한 미비점은/), pIItem = find(b, end, /^① /),
      pIBasis = find(b, end, /^◦「감사기준서/), pIFind = find(b, end, /^- /), pIRuleHead = find(b, end, /^<관련규정>/), pIRule = find(b, end, /^1\.「감사기준서/);
    const K = m.indi.K;
    out.push(pIHead, blank, setRuns(pIIntro, [` □ {{법인.이름}}`, '', `이 실시한 개별감사업무 중 ${K}개사를 선정`, '하여 개별', `감사절차의 적정성을 점검한 바, 다음과 같이 ${m.indi.items.length ? `${Math.max(...m.indi.items.map(i => i.companies))}개사에서 일부 미비점이 발견됨` : '미비점은 발견되지 않음'}`]), blank, pINote, blank, blank);
    for (const it of m.indi.items) {
      out.push(setText(pIItem, ` ${it.no} ${it.title}`), blank, setText(pIBasis, ` ◦${it.basis}`), blank);
      for (const f of it.findings) out.push(setText(pIFind, ` - ${f.text}(${f.count}개사)`));
      out.push(blank, pIRuleHead, ...it.rules.map((r, i) => setText(pIRule, ` ${i + 1}.${r}`)), blank, blank);
    }
    return out;
  }

  /* 위반 혐의(GAAP·GAAS·법규) 구역 — 본문과 별지1 두 곳. 체크한 것만 쓰고 없으면 구역을 비운다. 처리안의 ※ 줄도 맞춘다 */
  function violations(paras, m) {
    const v = m.viol; const P = paras;
    const idx = (re, from = 0) => P.findIndex((p, i) => i >= from && re.test(sq(text(p))));
    const h1 = idx(/^□ 개별감사업무 점검과정에서 회계처리기준 위반/); if (h1 < 0) return P;
    const e1 = idx(/^4\. 처리안/, h1); const h2 = idx(/^□ 개별감사업무 점검과정에서 회계처리기준 위반/, e1); const e2 = h2 < 0 ? -1 : idx(/^\(별지2\)/, h2);
    if (e1 < 0) return P;
    const pH = P[h1], pC = P[idx(/^◦ /, h1)], pNumT = P[idx(/^.\s*품질관리전담자 미지정/, h1)], pNumB = P[idx(/^감사인은 직전연도/, h1)];
    const blank = P[h1 + 1] && !sq(text(P[h1 + 1])) ? P[h1 + 1] : '';
    const block = [];
    if (v.gaap) block.push(setText(pH, ` ${v.gaap.heading}`), blank, setText(pC, ` ◦ ${v.gaap.text}`), blank);
    if (v.gaas) block.push(setText(pH, ` ${v.gaas.heading}`), blank, setText(pC, ` ◦ ${v.gaas.text}`), blank);
    if (v.law.length) {
      block.push(setText(pH, `   ${v.lawHeading}`), blank);
      let n = 0;
      for (const it of v.law) {
        if (!it.numbered) { block.push(setText(pC, ` ◦ ${it.text}`), blank); continue; }
        block.push(setText(pNumT || pH, `  ${String.fromCodePoint(0xF02B1 + n++)} ${it.title}`), blank, setText(pNumB || pC, `     ${it.text}`), blank);
      }
    }
    let out = [...P.slice(0, h1), ...block, ...P.slice(e1)];
    if (h2 >= 0 && e2 >= 0) { const d = h2 - h1 + (block.length - (e1 - h1)); out = [...out.slice(0, h2 + block.length - (e1 - h1)), ...block, ...out.slice(e2 + block.length - (e1 - h1))]; }
    const keep = (t) => {
      if (/^※ 회계처리기준 위반 혐의사항이 발견된/.test(t)) return !!v.gaap;
      if (/^※ 회계감사기준 위반 혐의사항이 발견된/.test(t)) return !!v.gaas;
      if (/^※ 법규 위반 혐의사항/.test(t)) return v.law.length > 0;
      if (/^[-–‑−] \(외감법 위반 혐의사항\) .*재무제표 대리작성/.test(t)) return v.law.some(x => x.key === 'etc');
      if (/^[-–‑−] \(외감법 위반 혐의사항\) 동일이사 연속감사제한/.test(t)) return v.law.some(x => x.key === 'rotation');
      if (/^[-–‑−] \(공인회계사법/.test(t)) return v.law.some(x => x.key !== 'rotation');
      return true;
    };
    return out.filter(p => keep(sq(text(p))));
  }

  /* 문장 손질: 건수·회사 수·지적률·직전 감리년도·대표이사·주사무소 */
  function sentences(paras, m, ctx) {
    const g = (ctx && ctx.general) || {};
    const prev = ctx && ctx.prevYear ? String(ctx.prevYear).replace(/년$/, '') : '';
    return paras.map(p => {
      const t = sq(text(p)); if (!t) return p;
      let x = p;
      if (prev && /20xx년|202x년/i.test(t)) x = setText(x, text(p).replace(/20xx년|202x년/gi, `${prev}년`));
      if (/^◦ 대표이사 : ○○○/.test(t) && g.ceo) x = setText(x, `   ◦ 대표이사 : ${g.ceo}`);
      else if (/^◦ 주사무소 소재지 : /.test(t) && g.head_office) x = setText(x, `   ◦ 주사무소 소재지 : ${g.head_office}`);
      if (!m) return x;
      const o = m.org, d = m.indi;
      const types = [['미운영', o.byType['미운영']], ['미설계', o.byType['미설계']], ['품질관리절차 설계․운영상 일부 미흡', o.byType['일부미흡']]].filter(([, n]) => n > 0);
      if (/^◦ 개선권고 대상 지적사항은 \d+건 모두 외부공개 대상이며/.test(t)) {
        const tail = !o.count ? '해당 없음' : types.length === 1 ? `${o.count}건 모두 ${types[0][0]}에 해당` : types.map(([k, n]) => `${n}건은 ${k}`).join(', ') + '에 해당';
        x = setText(x, `   ◦ 개선권고 대상 지적사항은 ${o.count}건${o.count ? ' 모두 외부공개 대상이며' : ''}, ${tail}`);
      } else if (/^\* 품질관리제도 관련 \d+건과 개별감사업무 관련 \d+건/.test(t)) {
        x = setText(x, `                * 품질관리제도 관련 ${o.count}건과 개별감사업무 관련 ${d.total}건`);
      } else if (/^◦ \d+개사의 개별감사업무에 대하여/.test(t)) {
        x = setText(x, `   ◦ ${d.K}개사의 개별감사업무에 대하여 ${d.itemsTotal}개 항목을 점검한 결과, ${d.items.length ? Math.max(...d.items.map(i => i.companies)) : 0}개사에서 ${d.total}건(지적률 ${d.rate}%)의 감사절차 미비사항이 발견됨`);
      } else if (/^\* 202[xX]년과 \d{4}년 개별감사업무 점검결과 비교표/.test(t) || /^\* \d{4}년과 \d{4}년 개별감사업무 점검결과 비교표/.test(t)) {
        x = setText(x, `     * ${prev || '직전'}년과 ${d.year || new Date().getFullYear()}년 개별감사업무 점검결과 비교표`);
      }
      return x;
    });
  }

  /* 평가결과 문장과 「*1」 주석(사용자 지정 2026-10-08)
   *  · 「(품질관리수준 평가결과가 ‘양호’인 경우)」 문장: 양호면 바로 위 □ 문장을 이 글로 바꾸고, 그 밖이면 지운다
   *  · 「(…‘미흡’인 경우)」 문장: 미흡이면 바로 위 ◦ 문장을 이 글로 바꾸고, 그 밖이면 지운다(보통이면 둘 다 표시 안 함)
   *  · 「*1」 주석은 하나만: 중요절차에 미운영·미설계 묶음이 있으면 첫째(미운영으로 분류), 없고 지적이 있으면 둘째(일부 미흡) + 「주) (a)~(d)」, 지적이 없으면 둘 다 지운다 */
  function levelAndNotes(paras, m) {
    const level = m.score.level; const out = []; const isBlank = (p) => !sq(text(p)) && !tblOf(p);
    const hasMiun = m.org.groups.some(g => g.type === '미운영' || g.type === '미설계'); const anyOrg = m.org.groups.length > 0;
    const prevText = (i) => { for (let j = out.length - 1; j >= 0; j--) if (!isBlank(out[j])) return j; return -1; };
    let skipNoteBlock = false;
    for (let i = 0; i < paras.length; i++) {
      const p = paras[i]; const t = sq(text(p));
      const lv = /^\(품질관리수준 평가결과가 ‘(양호|미흡)’인 경우\)\s*/.exec(t);
      if (lv) {
        if (lv[1] === level) {
          const j = prevText(); const body = t.slice(lv[0].length);
          if (j >= 0) { const pt = sq(text(out[j])); const lead = (/^(□\s*\(품질관리절차\)\s*|◦\s*)/.exec(pt) || ['', ''])[0]; out[j] = setText(out[j], ` ${lead}${body}`); }
        }
        continue;   // 조건 문장 자체는 늘 뺀다
      }
      if (/^\*1 지적사항 중 중요절차/.test(t)) { if (hasMiun) out.push(p); else if (out.length && isBlank(out[out.length - 1]) && paras[i + 1] && isBlank(paras[i + 1])) i++; continue; }
      if (/^\*1 \(중요절차에 대한 지적이 없을 경우\)/.test(t)) {
        if (!hasMiun && anyOrg) { out.push(setText(p, text(p).replace(/^([\s\u00a0\u3000]*\*1)[\s\u00a0\u3000]*\(중요절차에 대한 지적이 없을 경우\)[\s\u00a0\u3000]*/, '$1 '))); skipNoteBlock = false; }
        else { skipNoteBlock = true; if (paras[i + 1] && isBlank(paras[i + 1])) i++; }
        continue;
      }
      if (skipNoteBlock) {   // 「주) (a) …」 ~ 「(d) …」
        if (/^주\) \(a\)|^\((b|c|d)\)|^사전심리 수행과 해결사항의 문서화/.test(t)) continue;
        skipNoteBlock = false;
      }
      out.push(p);
    }
    return out;
  }

  /* 전체 조립. m = model(...) 또는 null */
  function assemble(sec, phrases, m, ctx) {
    const paras = topParas(sec);
    const head = sec.slice(0, sec.indexOf(paras[0]));
    const tail = sec.slice(sec.lastIndexOf(paras[paras.length - 1]) + paras[paras.length - 1].length);
    let out = paras;
    if (m) {
      const idx = (re, from = 0) => out.findIndex((p, i) => i >= from && re.test(sq(text(p))));
      const a = idx(/^【품질관리절차에 관한 사항】/), b = idx(/^【개별감사업무에 관한 사항】/), end = idx(/^\(첨부\)/);
      if (a < 0 || b < 0 || end < 0) throw new Error('서식에서 별지2 머리글(【품질관리절차에 관한 사항】·【개별감사업무에 관한 사항】·(첨부))을 찾지 못했습니다.');
      const body = appendix2(out, a, b, end, m, ctx);
      out = [...out.slice(0, a + 1), ...body, ...out.slice(end)];
      out = out.map(p => {
        const tbl = tblOf(p); if (!tbl) return p;
        const t = text(p).replace(/\s+/g, '');
        if (/^중점점검항목지적사항/.test(t)) return orgTable(p, m.org, ctx && ctx.header);
        if (/^구분모집단구성수표본선정수/.test(t)) return selectionTable(p, ctx && ctx.audited, m.indi.K);
        if (/^부문제목건수/.test(t)) return indiTable(p, m.indi);
        if (/^구분점검회사수점검항목/.test(t)) return compareTable(p, m.indi);
        return p;
      });
    }
    if (m) out = violations(out, m);
    if (m) out = levelAndNotes(out, m);
    out = sentences(out, m, ctx);
    return head + out.join('') + tail;
  }

  /* ⑯ 그룹재무제표 감사절차: 「감사계획 수립」·「독립성 확인」 두 하위 항목 — 점수는 둘 중 하나라도 있으면 1건(회사별),
   *   문구·문단은 고른 쪽만(둘 다면 묶은 문구) — 사용자 지정 2026-10-08. 문장은 서식 별지2 ⑰ 을 두 갈래로 나눈 것 */
  const GA = {
    head: '「감사기준서 600」(그룹재무제표 감사-부문감사인이 수행한 업무 등 특별 고려사항)',
    plan: { title: '그룹감사업무 수행시 감사계획 수립절차 미흡', para: '문단 15', body: '그룹업무팀은 전반그룹감사전략을 수립하고 감사계획을 개발하여야 함에도', finding: '그룹감사업무 수행시 감사계획에 대한 문서화가 미흡함' },
    indep: { title: '그룹감사업무 수행시 독립성 확인절차 미흡', para: '문단 19 및 41', body: '그룹업무팀은 부문감사인에게 부문재무정보에 대한 업무의 수행을 요청하기로 한 경우, 부문감사인이 독립적인지 여부를 이해하여야 하고, 그룹감사와 관련된 윤리적 요구사항(독립성 및 전문가적 적격성 포함)을 준수했는지 여부 등 그룹감사에 대한 그룹업무팀의 결론과 관련성이 있는 사항을 커뮤니케이션하도록 부문감사인에게 요청하여야 함에도', finding: '그룹감사업무 수행시 부문감사인의 독립성 확인절차에 대한 문서화가 미흡함' },
  };
  function groupAuditText(subs, K, row) {
    if (!subs) return {};
    const cnt = (sk) => (subs[sk] || []).slice(0, K).filter(v => Number(v) > 0).length;
    const p = cnt('s1'), d = cnt('s2');
    if (!p && !d) return {};
    const auto = [];
    if (p) auto.push({ text: GA.plan.finding, count: p });
    if (d) auto.push({ text: GA.indep.finding, count: d });
    const findings = row.findings && row.findings.length ? row.findings : auto;
    if (p && d) return { title: '그룹감사업무 수행시 감사계획 수립과 독립성 확인절차 미흡', findings };   /* 둘 다 — 서식 그대로(문단 15, 19 및 41) */
    const g = p ? GA.plan : GA.indep;
    return { title: g.title, basis: `${GA.head} ${g.para}에 의하면 ${g.body}`, rules: [`「감사기준서 600」${g.para}`], findings };
  }
  /* 평가표의 하위 항목(엑셀 「개별감사업무 관련 지적사항」 표와 같은 이름) */
  const I16_SUBS = [['s1', '공시사항점검표 작성 미흡'], ['s2', '완결조서/감사종료 점검서식 작성 미흡'], ['s3', '수행자/검토자 업무수행일자/서명미흡'], ['s4', '조서간 유기적 연결 미흡'], ['s5', '기타']];
  /* ⑩ 기타 주요 항목도 세부 항목으로(사용자 지정 2026-10-08) — 이름은 서식 별지2 ⑪ 의 지적 예시에서 */
  const I11_SUBS = [['s1', '대손충당금 적정성(매출채권 연령분석 등) 검토 미흡'], ['s2', '재고자산 평가(저가법·진부화 등) 검토 미흡'], ['s3', '수익인식(매출) 감사절차 미흡'], ['s4', '지분법 회계처리 검토 미흡'], ['s5', '기타']];
  const I17_SUBS = [['s1', '그룹감사업무 수행시 감사계획 수립절차'], ['s2', '그룹감사업무 수행시 독립성 확인절차']];
  const SUBS = { i11: I11_SUBS, i16: I16_SUBS, i17: I17_SUBS };
  root.QcDraft = { indiPool, autoVariant, chooseVariant, smallOf, bestTherefore, autoTher, pickTherefore, LAW_ROW, VIOL_PTS, I16_SUBS, I11_SUBS, SUBS, model, score, assemble, topParas, text, setRuns, setCell, CIRC, ORG_W, INDI_F, VIOL_ROWS, TYPE_LABEL, CLS_SUFFIX, indiCounts };
})(typeof globalThis !== 'undefined' ? globalThis : this);
