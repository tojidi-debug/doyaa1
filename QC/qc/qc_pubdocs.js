/* [품감] 심의안(개발) — 외부공개서식·개선권고사항 공개 의견조회서(hwpx) (사용자 지정 2026-10-15)
 *
 * 담당부서의 「서류생성 시스템」(qc/gen_public.py · gen_opinion.py · hx.py)을 브라우저로 옮긴 것이다.
 * 서식(qc/templates/외부공개서식.hwpx · 의견조회서.hwpx)의 header·꾸밈은 그대로 두고 Contents/section0.xml 의 글만 다시 조립한다.
 * 입력은 심의안 초안 작성의 모형(QcDraft.model) — 조직 묶음(분류 type)·항목(분류·문안·「□ 따라서」)·기준 문단·관련규정.
 * GitHub(정적) 사이트에서도 그대로 돈다(서버 없음).
 */
(function (root) {
  'use strict';
  const LINESEG = /<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

  /* ── hx: 깊이를 세어 맨 바깥 요소 자르기 ── */
  function findElems(xml, tag, start = 0, end = xml.length) {
    const out = []; let pos = start;
    const op = new RegExp(`<hp:${tag}\\b[^>]*?(/?)>`, 'g'); const cl = `</hp:${tag}>`;
    for (;;) {
      op.lastIndex = pos; const m = op.exec(xml);
      if (!m || m.index >= end) break;
      if (m[1] === '/') { out.push([m.index, m.index + m[0].length]); pos = m.index + m[0].length; continue; }
      let depth = 1, p = m.index + m[0].length;
      while (depth) {
        op.lastIndex = p; const n = op.exec(xml); const c = xml.indexOf(cl, p);
        if (c < 0 || c >= end) throw new Error('닫는 태그 없음: ' + tag);
        if (n && n.index < c) { if (n[1] !== '/') depth += 1; p = n.index + n[0].length; } else { depth -= 1; p = c + cl.length; }
      }
      out.push([m.index, p]); pos = p;
    }
    return out;
  }
  const topParas = (xml, s, e) => findElems(xml, 'p', s, e);
  const hasTable = (p) => p.includes('<hp:tbl');
  const stripLineseg = (p) => (hasTable(p) || p.includes('<hp:secPr') ? p : p.replace(LINESEG, ''));
  const textToT = (t) => esc(t).replace(/　/g, '<hp:fwSpace/>');
  function paraText(pxml, withTables = false) {
    let x = pxml.replace(LINESEG, '');
    if (!withTables) for (const [a, b] of findElems(x, 'tbl').reverse()) x = x.slice(0, a) + x.slice(b);
    x = x.replace(/<hp:ctrl>[\s\S]*?<\/hp:ctrl>/g, '');
    let out = '';
    for (const m of x.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)) out += unesc(m[1].replace(/<hp:fwSpace\/>/g, '　').replace(/<hp:lineBreak\/>/g, '\n').replace(/<[^>]+>/g, ''));
    return out;
  }
  /* 문단 글을 통째로 — 글이 가장 긴 run 의 글자 모양 하나로(표·구역 설정 run 은 그대로) */
  function setParaText(pxml, text) {
    const runs = findElems(pxml, 'run'); if (!runs.length) return pxml;
    const head = pxml.slice(0, runs[0][0]), tail = pxml.slice(runs[runs.length - 1][1]);
    const keep = []; let cp = null, best = -1;
    for (const [a, b] of runs) {
      const r = pxml.slice(a, b);
      if (r.includes('<hp:secPr') || r.includes('<hp:tbl') || r.includes('<hp:pic')) { keep.push(r); continue; }
      const n = paraText('<hp:p>' + r + '</hp:p>').trim().length;
      if (n > best) { best = n; cp = (/charPrIDRef="(\d+)"/.exec(r) || [0, '0'])[1]; }
    }
    if (cp === null) cp = (/charPrIDRef="(\d+)"/.exec(pxml.slice(runs[0][0], runs[0][1])) || [0, '0'])[1];
    const nr = text !== '' ? `<hp:run charPrIDRef="${cp}"><hp:t>${textToT(text)}</hp:t></hp:run>` : `<hp:run charPrIDRef="${cp}"/>`;
    return stripLineseg(head + keep.join('') + nr + tail);
  }
  /* 문단 글 속 old → new(run 을 넘나들어도). 못 찾으면 null */
  function replaceInPara(pxml, old, neu) {
    const spans = [];
    for (const m of pxml.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)) {
      const before = pxml.slice(0, m.index);
      if (before.lastIndexOf('<hp:tbl') > before.lastIndexOf('</hp:tbl>')) continue;   // 표 안 글은 건너뜀
      const raw = m[1]; if (raw.includes('<hp:ctrl') || /<hp:(?!fwSpace)/.test(raw)) continue;
      const s = m.index + 6; spans.push([s, s + raw.length, unesc(raw.replace(/<hp:fwSpace\/>/g, '　'))]);
    }
    const full = spans.map((s) => s[2]).join(''); const i = full.indexOf(old); if (i < 0) return null;
    const j = i + old.length; let pos = 0, first = true;
    const ns = spans.map(([a, b, t]) => {
      const s0 = pos, s1 = pos + t.length; pos = s1;
      if (s1 <= i || s0 >= j) return [a, b, t];
      const left = t.slice(0, Math.max(0, i - s0)), right = j < s1 ? t.slice(Math.max(0, j - s0)) : '';
      if (first) { first = false; return [a, b, left + neu + right]; }
      return [a, b, left + right];
    });
    let out = '', last = 0; for (const [a, b, t] of ns) { out += pxml.slice(last, a) + textToT(t); last = b; }
    return stripLineseg(out + pxml.slice(last));
  }
  function cellParas(c) { let a = c.indexOf('<hp:subList'); a = c.indexOf('>', a) + 1; const b = c.lastIndexOf('</hp:subList>'); return [a, b, topParas(c, a, b)]; }
  function setCellLines(c, lines) {
    const [a, b, ps] = cellParas(c); if (!ps.length) return c;
    const protos = ps.map(([s, e]) => c.slice(s, e));
    const out = lines.map((line, i) => { const p = protos[Math.min(i, protos.length - 1)]; return hasTable(p) ? p : setParaText(p, line); });
    return c.slice(0, a) + out.join('') + c.slice(b);
  }
  function editCells(txml, fn) {
    let out = '', last = 0;
    findElems(txml, 'tr').forEach(([ra, rb], ri) => {
      const r = txml.slice(ra, rb); let rr = '', cl = 0;
      findElems(r, 'tc').forEach(([ca, cb], ci) => { const c = r.slice(ca, cb); const n = fn(ri, ci, c); rr += r.slice(cl, ca) + (n == null ? c : n); cl = cb; });
      out += txml.slice(last, ra) + rr + r.slice(cl); last = rb;
    });
    return out + txml.slice(last);
  }
  /* 모든 깊이(표 안 칸 포함)의 문단에서 old → new */
  function deepReplace(xml, old, neu) {
    const spans = topParas(xml); if (!spans.length) return xml;
    let out = '', last = 0;
    for (const [a, b] of spans) {
      let p = xml.slice(a, b); out += xml.slice(last, a); last = b;
      const tbls = findElems(p, 'tbl');
      if (tbls.length) {
        let q = '', pl = 0;
        for (const [ta, tb] of tbls) {
          const t = p.slice(ta, tb); let tt = '', tl = 0;
          for (const [ca, cb] of findElems(t, 'tc')) { const c = t.slice(ca, cb); const [sa, sb] = cellParas(c); tt += t.slice(tl, ca) + c.slice(0, sa) + deepReplace(c.slice(sa, sb), old, neu) + c.slice(sb); tl = cb; }
          q += p.slice(pl, ta) + tt + t.slice(tl); pl = tb;
        }
        p = q + p.slice(pl);
      } else if (paraText(p).includes(old)) p = replaceInPara(p, old, neu) || p;
      out += p;
    }
    return out + xml.slice(last);
  }

  /* ── 공통: 묶음 차례·이름(담당부서 서식 차례 — 감사시간 · 사전심리 · 조서 · 사후심리) ── */
  const AREA = {
    c: { head: '감사시간 관리절차', pub: '감사시간 관리 절차' },
    b: { head: '업무품질관리검토(사전심리) 절차', pub: '업무품질관리검토(사전심리) 절차' },
    a: { head: '감사조서 작성·관리절차', pub: '감사조서 작성·관리 절차' },
    d: { head: '모니터링(사후심리)절차', pub: '모니터링(사후심리) 절차' },
  };
  const ORDER = ['c', 'b', 'a', 'd'];
  const CLS = ['미설계', '미운영', '일부미흡'];
  const CLS_TITLE = { 미설계: '미설계', 미운영: '미운영', 일부미흡: '일부 미흡' };
  const CLS_TYPE_HEAD = { 미설계: '미설계', 미운영: '미운영', 일부미흡: '설계·운영상 일부 미흡' };
  const CIRCLE = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
  const groupsOf = (model) => ORDER.map((k) => (model.org.groups || []).find((g) => g.key === k)).filter(Boolean);
  const sq = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  /* 외부공개서식 — 「N) ○○회계법인」 → □ 미설계/미운영/일부미흡(없으면 「: 해당사항 없음」) → ◦ 영역 → - 문구(「감사인은 」을 뗀 것) */
  function publicDoc(sec, model, opts = {}) {
    const spans = topParas(sec); const P = spans.map(([a, b]) => sec.slice(a, b));
    if (P.length < 12) throw new Error('외부공개서식 서식의 문단 차례가 다릅니다(12문단 이상이어야 합니다).');
    const runs = (p) => findElems(p, 'run').map(([a, b]) => p.slice(a, b));
    const withRuns = (p, rs) => { const r = findElems(p, 'run'); return stripLineseg(p.slice(0, r[0][0]) + rs.join('') + p.slice(r[r.length - 1][1])); };
    const run = (cp, t) => `<hp:run charPrIDRef="${cp}"><hp:t>${textToT(t)}</hp:t></hp:run>`;
    const cpOf = (r) => (/charPrIDRef="(\d+)"/.exec(r) || [0, '0'])[1];
    const r0 = runs(P[0]), rc = runs(P[2]), ra = runs(P[8]), ri = runs(P[10]);
    const title = withRuns(P[0], [r0[0], run(cpOf(r0[1] || r0[0]), `　　　${opts.no || ''})　　${opts.firm || ''}`)]);
    const clsLine = (cls, none) => withRuns(P[2], [rc[0], run(cpOf(rc[1]), cls), ...(none ? [run(cpOf(rc[2] || rc[1]), ' : 해당사항 없음')] : [])]);
    const areaLine = (name) => withRuns(P[8], [run(cpOf(ra[0]), '　　　　　　◦　　' + name)]);
    const itemLine = (t) => withRuns(P[10], [ri[0], run(cpOf(ri[1] || ri[0]), t)]);
    const gs = groupsOf(model); const body = [title, P[1]];
    const d1 = ((gs.find((g) => g.key === 'd') || { items: [] }).items.find((i) => i.key === 'd1') || {}).cls;
    for (const cls of CLS) {
      const areas = gs.filter((g) => g.type === cls);
      if (!areas.length) { body.push(clsLine(cls, true), P[3]); continue; }
      body.push(clsLine(cls, false), P[7]);
      for (const g of areas) {
        body.push(areaLine(AREA[g.key].pub), P[9]); const seen = [];
        for (const it of g.items) {
          if (it.key === 'd2' && d1 === '미운영') continue;      // 사후심리 정책·절차가 미운영이면 결과 관리는 공개하지 않는 관행(담당부서 예시 2건)
          const t = sq(it.text).replace(/^감사인은\s*/, '');
          if (!t || seen.includes(t)) continue;
          seen.push(t); body.push(itemLine(t), P[11]);
        }
      }
    }
    return sec.slice(0, spans[0][0]) + body.join('') + sec.slice(spans[spans.length - 1][1]);
  }

  const stripMemos = (x) => x.replace(/<hp:ctrl><hp:fieldBegin [^>]*type="MEMO"[\s\S]*?<\/hp:fieldBegin><\/hp:ctrl>/g, '').replace(/<hp:ctrl><hp:fieldEnd [^>]*\/><\/hp:ctrl>/g, '');
  /* 「2024. 4. 1. ～ 2025. 3. 31.」 → ['2024.4.1.', '2025.3.31.'] */
  function periodWords(s) { const parts = String(s || '').trim().split(/\s*[～~∼]\s*|\s+-\s+/); const cl = (v) => String(v || '').replace(/\s+/g, ''); return parts.length === 2 ? [cl(parts[0]), cl(parts[1])] : [cl(s), '']; }

  /* 개선권고사항 공개 의견조회서 — 16×8 표의 칸(제목·당사자·주소·첫 문장·[품질관리제도에 관한 사항]·의견제출 담당·기한) + 위원회 일시 */
  function opinionDoc(sec, model, o = {}) {
    const x = stripMemos(sec); const spans = topParas(x); const P = spans.map(([a, b]) => x.slice(a, b));
    const big = P.findIndex((p) => p.includes('rowCnt="16"')); if (big < 0) throw new Error('의견조회서 서식에서 16줄 표를 찾지 못했습니다.');
    const p = P[big]; const [ta, tb] = findElems(p, 'tbl')[0]; const t = p.slice(ta, tb);
    const [d0, d1] = periodWords(o.span); const firm = o.firm || '';
    const gs = groupsOf(model);
    const main = (c) => {
      const [sa, sb, cps] = cellParas(c); const CP = cps.map(([s, e]) => c.slice(s, e));
      if (CP.length < 46) throw new Error('의견조회서 서식의 [품질관리제도에 관한 사항] 칸 문단이 모자랍니다.');
      const S = (k, text) => setParaText(CP[k], text);
      const body = [CP[0], CP[1]];
      gs.forEach((g, k) => {
        body.push(S(21, ` ${'가나다라'[k]}. ${AREA[g.key].head} 관련 (${CLS_TYPE_HEAD[g.type] || g.type})`), CP[22], S(23, '  □' + sq(g.basis)), CP[24]);
        g.items.forEach((it, j) => {
          body.push(S(25, `  ${CIRCLE[j]} ${sq(it.title)} ${CLS_TITLE[it.cls] || it.cls}`), CP[26], S(27, '  ◦ ' + (sq(it.text) || '감사인은 ⁓')), CP[28]);
          for (const r of (it.therefore || []).filter((v) => sq(v))) body.push(S(29, '  □ ' + sq(r).replace(/^□\s*/, '')), CP[30]);
        });
        body.push(CP[43], ...(g.rules || []).map((r) => S(44, '     ' + r)), CP[45]);
      });
      if (!gs.length) body.push(S(21, ' 해당사항 없음'));
      body.push(CP[CP.length - 1]);
      return c.slice(0, sa) + body.join('') + c.slice(sb);
    };
    const set = (c, v) => (v ? setCellLines(c, [v]) : null);
    const nt = editCells(t, (ri, ci, c) => {
      const k = `${ri},${ci}`;
      if (k === '0,1') return setCellLines(c, [`　${firm}에 대한 감사인 감리결과 개선권고`]);
      if (k === '1,2') return setCellLines(c, [` ${firm}, 대표이사 ${o.ceo || 'ㅇㅇㅇ'}`]);
      if (k === '2,1' && o.addr) return setCellLines(c, [' ' + o.addr]);
      if (k === '3,1') return setCellLines(c, ['', ` ${firm}(이하 ‘감사인’)의 ${d0}부터 ${d1}까지의 품질관리기준 준수 여부에 대한 감사인 감리결과 개선권고 사항은 다음과 같음`]);
      if (k === '7,1') return main(c);
      if (k === '12,1') return set(c, o.contact);
      if (k === '13,1') return set(c, o.tel);
      if (k === '13,3') return set(c, o.fax);
      if (k === '14,1') return set(c, o.email);
      if (k === '15,1') return set(c, o.due);
      return null;
    });
    P[big] = p.slice(0, ta) + nt + p.slice(tb);
    let xml = x.slice(0, spans[0][0]) + P.join('') + x.slice(spans[spans.length - 1][1]);
    if (o.committee) xml = deepReplace(xml, '2026년 3월 13일 14시 00분(예정)', o.committee);
    return xml;
  }

  /* 서식 바이트 → 새 hwpx 바이트(HWPX.unzip/zip — 안건과 같은 zip 도구) */
  async function build(kind, bytes, model, opts) {
    const H = root.HWPX; if (!H) throw new Error('hwpx 도구(agenda/hwpx.js)가 없습니다.');
    const files = await H.unzip(bytes); const name = 'Contents/section0.xml';
    if (!files[name]) throw new Error('서식에 Contents/section0.xml 이 없습니다.');
    const sec = new TextDecoder().decode(files[name]);
    const out = new TextEncoder().encode(kind === 'public' ? publicDoc(sec, model, opts) : opinionDoc(sec, model, opts));
    return H.zip(Object.entries(files).map(([n, d]) => { const b = n === name ? out : d; return { name: n, method: 0, crc: H.crc32(b), csize: b.length, usize: b.length, data: b }; }));
  }

  root.QcPubDocs = { publicDoc, opinionDoc, build, paraText, topParas, findElems, periodWords };
  if (typeof module !== 'undefined') module.exports = root.QcPubDocs;
})(typeof globalThis !== 'undefined' ? globalThis : this);
