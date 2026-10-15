/* qc_gangpyeong.js — [품감] 강평(초안) hwpx 만들기(순수 규칙, DOM 없음) — 개발 화면 전용(2026-10-08)
 *
 *   QcGang.build(sectionXml, data, model, ctx) → 새 section0.xml 글
 *     sectionXml = frontend/qc/templates/강평_sample.hwpx 의 section0.xml
 *                  (「(공동) 2026년 회계법인 감사인감리 결과 강평자료(sample).hwp」를 rhwp export-hwpx 로 바꾼 것 — --verify 로 원본과 IR·쪽수 같음 확인)
 *     data  = frontend/qc/qc_gangpyeong.json(샘플에서 뽑은 조직 10항목 발견사항 등 — 문안이 빈 항목의 기본값)
 *     model = QcDraft.model(…)(심의안 초안 작성의 체크 상태)
 *     ctx   = { firm, year, date }
 *
 * 방식(사용자 지정 2026-10-08 「감사반 샘플 양식과 최대한 비슷하게」): 샘플 문서를 **그대로 두고** 바뀌는 자리만 채운다.
 *   · 제목 연도 · (회계법인 이름) · (날짜)
 *   · 「1. 조직 부문」 표: 체크한 조직 항목의 줄만 남기고(점검항목 칸 병합 다시 계산) 발견사항 칸에 지적 문안
 *   · 「2. 개별감사 부문」 표: 「ㅇ 제목(N개사)」·「- 지적」 줄을 체크한 것으로 다시 씀
 *   · 「□ 이행보고 관련 > 2. 조직 부문」: 체크한 항목의 묶음(발견사항·개선방향·이행보고 제출문서 표)만 남기고 번호 다시 매김
 *   · 「□ 이행보고 관련 > 2. 개별감사 부문」 이행내역 표: 체크한 항목의 줄만(표에 없는 항목은 줄을 만들어 넣음)
 *   · 나머지(독립성·개선권고 공개·이행 점검·재위반·품질관리수준 평가·지적사례·추가 검토사항)는 샘플 그대로
 */
(function (root) {
  const D = () => root.QcDraft;
  const sq = (s) => String(s || '').replace(/[  　\t]+/g, ' ').trim();
  const nk = (s) => String(s || '').replace(/[\s·∙.,()]/g, '');
  const CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
  const ORG_ORDER = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'd1', 'd2'];
  const GROUP_OF = { a1: 'a', a2: 'a', a3: 'a', b1: 'b', b2: 'b', b3: 'b', c1: 'c', c2: 'c', d1: 'd', d2: 'd' };
  /* 이행내역 표의 지적사항 이름 → 개별 항목 키(qc_build_gangpyeong.py 의 INDI_MAP 과 같다) */
  const INDI_ROW = { 감사계획수립절차: 'i1', 지배기구와의커뮤니케이션절차: 'i15', 중요한왜곡표시위험의식별과평가절차: 'i2', 평가된왜곡표시위험관련대응절차: 'i3',
    재고자산실재성과상태관련감사절차: 'i5', 표본감사관련감사절차: 'i7', 특수관계자거래에대한감사절차: 'i9', 기타주요계정과목에대한감사절차: 'i11',
    후속사건감사절차: 'i13', 서면진술관련문서화: 'i14', 기타감사조서의문서화: 'i16' };

  const tblOf = (p) => { const m = /<hp:tbl\b[\s\S]*<\/hp:tbl>/.exec(p); return m ? m[0] : null; };
  const rowsOf = (tbl) => tbl.match(/<hp:tr>[\s\S]*?<\/hp:tr>/g) || [];
  const cellsOf = (tr) => tr.match(/<hp:tc\b[\s\S]*?<\/hp:tc>/g) || [];
  const attr = (xml, name, value) => xml.replace(new RegExp(`${name}="[^"]*"`), `${name}="${value}"`);
  const withRows = (tbl, rows) => { const head = tbl.slice(0, tbl.indexOf('<hp:tr>')); const tail = tbl.slice(tbl.lastIndexOf('</hp:tr>') + 8); return attr(head, 'rowCnt', rows.length) + rows.join('') + tail; };
  const setRowAddr = (tr, r) => tr.replace(/rowAddr="\d+"/g, `rowAddr="${r}"`);
  const setSpan = (tc, n) => tc.replace(/rowSpan="\d+"/, `rowSpan="${n}"`);
  const colOf = (tc) => Number((/colAddr="(\d+)"/.exec(tc) || [])[1] || 0);
  const cellText = (tc) => sq(D().text(tc));
  /* 칸 안 문단을 texts 로 다시 쓴다 — 첫 문단을 본으로(kinds 가 있으면 줄마다 본을 고름) */
  function fillCell(tc, texts, protoOf) {
    return tc.replace(/(<hp:subList[^>]*>)([\s\S]*?)(<\/hp:subList>)/, (m, a, inner, c) => {
      const ps = D().topParas(inner);
      const pick = (t) => (protoOf ? protoOf(ps, t) : ps[0]) || ps[0] || '';
      return a + texts.map(t => D().setRuns(pick(t), [t])).join('') + c;
    });
  }

  function build(sec, data, model, ctx) {
    const P = D().topParas(sec);
    const head = sec.slice(0, sec.indexOf(P[0]));
    const tail = sec.slice(sec.lastIndexOf(P[P.length - 1]) + P[P.length - 1].length);
    const Y = ctx.year || new Date().getFullYear();
    const firm = ctx.firm || '○○회계법인';
    const org = new Map();   // 키 → 모형의 조직 항목(체크한 것만)
    for (const g of model.org.groups) for (const it of g.items) org.set(it.key, it);
    const findingOf = (key) => { const it = org.get(key); const t = sq(it && it.text) || ((data.org || {})[key] || {}).finding || ''; return t.replace(/^[ㅇ◦○]\s*/, ''); };
    const indi = model.indi.items;
    let out = P.slice();
    const find = (re, from = 0) => out.findIndex((p, i) => i >= from && re.test(sq(D().text(p))));

    /* 1) 머리: 제목 연도 · (회계법인) · (날짜) */
    const iTitle = find(/^\d{4}년 감사인감리 결과 및 감사품질 유의사항/);
    if (iTitle >= 0) out[iTitle] = D().setRuns(out[iTitle], [` ${Y}년 감사인감리 결과 및 감사품질 유의사항 등`]);
    const iFirm = find(/^\((ㅇㅇ|○○|OO)회계법인\)$/);
    if (iFirm >= 0) out[iFirm] = D().setRuns(out[iFirm], [`(${firm})`]);
    const iDate = find(/^\(\d{4}\. ?xx\. ?xx\.\)$/i);
    if (iDate >= 0) out[iDate] = D().setRuns(out[iDate], [`(${ctx.date || `${Y}. xx. xx.`})`]);

    /* 2) 「1. 조직 부문」 결과 표 — 줄 1~10 = a1…d2 */
    const iOrgT = out.findIndex(p => tblOf(p) && /^점검항목지적사항발견사항/.test(nk(D().text(p))));
    if (iOrgT >= 0) {
      const p = out[iOrgT]; const tbl = tblOf(p); const rows = rowsOf(tbl); const hdr = rows[0]; const body = rows.slice(1);
      const groupCell = {};   // 묶음 → 점검항목 칸(병합 칸)
      body.forEach((tr, i) => { const c0 = cellsOf(tr).find(tc => colOf(tc) === 0); if (c0) groupCell[GROUP_OF[ORG_ORDER[i]]] = c0; });
      const keep = ORG_ORDER.map((k, i) => ({ k, tr: body[i] })).filter(x => x.tr && org.has(x.k));
      const res = [hdr]; let r = 1;
      if (!keep.length) {
        const tr = body[0]; const cs = cellsOf(tr); let t = tr;
        cs.forEach(tc => { const col = colOf(tc); t = t.replace(tc, setSpan(fillCell(tc, [col === 0 ? '-' : col === 1 ? '지적사항 없음' : '-']), 1)); });
        res.push(setRowAddr(t, r++));
      }
      for (let n = 0; n < keep.length; n++) {
        const { k, tr } = keep[n]; const g = GROUP_OF[k]; const first = n === 0 || GROUP_OF[keep[n - 1].k] !== g;
        const span = keep.filter(x => GROUP_OF[x.k] === g).length;
        let cs = cellsOf(tr).filter(tc => colOf(tc) !== 0); let t = tr;
        cellsOf(tr).filter(tc => colOf(tc) === 0).forEach(tc => { t = t.replace(tc, ''); });   // 점검항목 칸은 묶음 첫 줄에만
        cs = cellsOf(t);
        const c2 = cs.find(tc => colOf(tc) === 2); if (c2) t = t.replace(c2, fillCell(c2, [`ㅇ ${findingOf(k)}`]));
        if (first && groupCell[g]) t = t.replace(/<hp:tr>/, `<hp:tr>${setSpan(groupCell[g], span)}`);
        res.push(setRowAddr(t, r++));
      }
      out[iOrgT] = p.replace(tbl, withRows(tbl, res));
    }

    /* 3) 「2. 개별감사 부문」 결과 표 — 한 칸에 「ㅇ 제목(N개사)」·「- 지적」 */
    const iIndT = out.findIndex(p => tblOf(p) && /^개별감사부문발견사항/.test(nk(D().text(p))));
    if (iIndT >= 0) {
      const p = out[iIndT]; const tbl = tblOf(p); const rows = rowsOf(tbl); const tc = cellsOf(rows[1] || '')[0];
      if (tc) {
        const lines = [];
        if (!indi.length) lines.push('ㅇ 개별감사 부문 지적사항 없음');
        indi.forEach((it, n) => {
          if (n) lines.push('');
          lines.push(`ㅇ ${it.title}(${it.companies}개사)`);
          for (const f of it.findings) lines.push(`- ${sq(f.text)}`);
        });
        const protoOf = (ps, t) => { const want = t === '' ? (x) => !sq(D().text(x)) : /^-/.test(t) ? (x) => /^-/.test(sq(D().text(x))) : (x) => /^ㅇ/.test(sq(D().text(x))); return ps.find(want); };
        const nt = rows[1].replace(tc, fillCell(tc, lines, protoOf));
        out[iIndT] = p.replace(tbl, withRows(tbl, [rows[0], nt]));
      }
    }

    /* 4) 「□ 이행보고 관련 > 2. 조직 부문」 — 체크한 항목의 묶음만, 번호 다시 */
    const iRep = find(/^□ 이행보고 관련/);
    const iOrgS = iRep >= 0 ? find(/^2\. 조직 부문/, iRep) : -1;
    const iIndS = iOrgS >= 0 ? find(/^2\. 개별감사 부문/, iOrgS) : -1;
    if (iOrgS >= 0 && iIndS > iOrgS) {
      const seg = out.slice(iOrgS + 1, iIndS);
      const blocks = []; let cur = null; let groupHead = null;
      for (const p of seg) {
        const t = sq(D().text(p));
        if (!tblOf(p) && /^<.+>$/.test(t)) { groupHead = { p, items: [] }; blocks.push(groupHead); cur = null; continue; }
        if (!tblOf(p) && /^[①-⑳]/.test(t)) { cur = { head: p, body: [] }; if (groupHead) groupHead.items.push(cur); else blocks.push({ p: null, items: [cur] }); continue; }
        if (cur) cur.body.push(p); else if (groupHead) groupHead.items.length ? null : (groupHead.lead = (groupHead.lead || []).concat(p)); else blocks.push({ loose: p });
      }
      const flat = blocks.filter(b => b.items).flatMap(b => b.items);
      flat.forEach((it, i) => { it.key = ORG_ORDER[i]; });
      const rebuilt = [];
      for (const b of blocks) {
        if (b.loose) { rebuilt.push(b.loose); continue; }
        const items = (b.items || []).filter(it => org.has(it.key)); if (!items.length) continue;
        if (b.p) rebuilt.push(b.p, ...(b.lead || []));
        items.forEach((it, n) => {
          const ht = sq(D().text(it.head)).replace(/^[①-⑳]\s*/, '');
          rebuilt.push(D().setRuns(it.head, [`${CIRC[n]} ${ht}`]));
          for (const q of it.body) {
            const tb = tblOf(q);
            if (tb && /^조직운영부문발견사항/.test(nk(D().text(q)))) {   // 발견사항 칸에 지적 문안
              const rs = rowsOf(tb); const last = rs[rs.length - 1]; const c = cellsOf(last)[0];
              rebuilt.push(q.replace(tb, withRows(tb, rs.slice(0, -1).concat([last.replace(c, fillCell(c, [`ㅇ ${findingOf(it.key)}`]))]))));
            } else rebuilt.push(q);
          }
        });
      }
      if (!rebuilt.some(p => /[①-⑳]/.test(sq(D().text(p))))) {
        const proto = flat[0] ? flat[0].head : seg[0];
        rebuilt.length = 0; rebuilt.push(D().setRuns(proto, ['조직 부문 지적사항 없음']));
      }
      out = out.slice(0, iOrgS + 1).concat(rebuilt, out.slice(iIndS));
    }

    /* 5) 「□ 이행보고 관련 > 2. 개별감사 부문」 이행내역 표 — 체크한 항목의 줄만 */
    const iInd2 = iRep >= 0 ? find(/^2\. 개별감사 부문/, iRep) : -1;
    if (iInd2 >= 0) {
      const iT = out.findIndex((p, i) => i > iInd2 && tblOf(p) && /^지적사항이행내역/.test(nk(D().text(p))));
      if (iT >= 0) {
        const p = out[iT]; const tbl = tblOf(p); const rows = rowsOf(tbl); const hdr = rows[0];
        const byKey = new Map(); rows.slice(1).forEach(tr => { const k = INDI_ROW[nk(cellText(cellsOf(tr)[0] || ''))]; if (k && !byKey.has(k)) byKey.set(k, tr); });
        const res = [hdr]; let r = 1;
        const proto = rows[rows.length - 1];
        for (const it of indi) {
          const keys = [it.key];
          const tr = keys.map(k => byKey.get(k)).find(Boolean);
          if (tr) { res.push(setRowAddr(tr, r++)); continue; }
          const cs = cellsOf(proto); let t = proto;
          if (cs[0]) t = t.replace(cs[0], fillCell(cs[0], [it.base || it.title.replace(/\s*미흡$/, '')]));
          if (cs[1]) t = t.replace(cs[1], fillCell(cs[1], ['- 재수행한 감사절차가 적용된 해당부분 조서 사본 제출']));
          res.push(setRowAddr(t, r++));
        }
        if (indi.length) out[iT] = p.replace(tbl, withRows(tbl, res));
        else {
          const iHead = out.findIndex((q, i) => i > iInd2 && i < iT && tblOf(q));
          const drop = new Set([iT, iHead].filter(i => i >= 0));
          const none = D().setRuns(out[iInd2], ['개별감사 부문 지적사항 없음']);
          out = out.flatMap((q, i) => (drop.has(i) ? (i === iT ? [none] : []) : [q]));
        }
      }
    }
    return head + out.join('') + tail;
  }

  root.QcGang = { build };
})(typeof globalThis !== 'undefined' ? globalThis : this);
