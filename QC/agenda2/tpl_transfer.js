/* 서식 자리표시자 옮겨 심기·견주기·합치기 — 안건 관리자 화면(agenda2/admin.js)과 [품감] 심의안(qc.js)이 함께 쓴다(2026-10-08 추출).
 * DOM 을 만지지 않는다. 바이트가 들어가 { bytes, report } 가 나온다. 의존: window.HWPX(hwpx.js) · window.TplNames(tpl_names.js, 라벨→값 자리) */
(function (root) {
  'use strict';
  const TN = root.TplNames;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const clipDefault = (t, n = 170) => (t.length > n ? t.slice(0, n) + '…' : t) || '(빈 문단)';
  function splitParas(xml) {   /* 최상위 <hp:p> 들 — 표 칸 안의 문단은 바깥 문단에 품는다(깊이 세기) */
    const out = []; const re = /<hp:p\b[^>]*?(\/?)>|<\/hp:p>/g; let m, depth = 0, start = -1;
    while ((m = re.exec(xml))) {
      if (m[0] === '</hp:p>') { depth--; if (depth === 0 && start >= 0) { out.push({ start, end: re.lastIndex, xml: xml.slice(start, re.lastIndex) }); start = -1; } }
      else if (m[1] === '/') { if (depth === 0) out.push({ start: m.index, end: re.lastIndex, xml: m[0] }); }
      else { if (depth === 0) start = m.index; depth++; }
    }
    for (const q of out) q.text = q.xml.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    return out;
  }
  function paraOps(a, b) {   /* 두 문단 글 목록의 차이(LCS) → [{op:'='|'-'|'+', i, j}] · 너무 크면 null */
    const n = a.length, m = b.length; if (n * m > 4e6) return null;
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) { if (a[i] === b[j]) out.push({ op: '=', i: i++, j: j++ }); else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', i: i++ }); else out.push({ op: '+', j: j++ }); }
    while (i < n) out.push({ op: '-', i: i++ }); while (j < m) out.push({ op: '+', j: j++ });
    return out;
  }
  const secNames = (z) => Object.keys(z).filter(n => /^Contents\/section\d+\.xml$/.test(n)).sort();
  const tagsOf = (xml) => new Set((xml.match(/\{\{[^{}]*\}\}/g) || []).map(t => t.replace(/\s+/g, ' ')));
  const bytesB64 = (u8) => { let s2 = ''; for (let i = 0; i < u8.length; i += 0x8000) s2 += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s2); };
  const b64Bytes = (b) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let q = 0; q < bin.length; q++) u[q] = bin.charCodeAt(q); return u; };
  /* 지금 쓰는 서식 — 같은 서류로 올린 것(자기 자신 제외) 중 최신, 없으면 기본 서식 */
  /* 섹션별 문단 비교 → 변경 묶음(체크 하나 = 묶음 하나) */
  async function compareTemplates(baseBytes, newBytes) {
    const zb = await window.HWPX.unzip(baseBytes), zn = await window.HWPX.unzip(newBytes); const dec = new TextDecoder();
    const names = [...new Set([...secNames(zb), ...secNames(zn)])].sort(); const secs = [];
    let gid = 0; const groups = []; const tb = new Set(), tn = new Set();
    for (const n of names) {
      const bx = zb[n] ? dec.decode(zb[n]) : '', nx = zn[n] ? dec.decode(zn[n]) : '';
      tagsOf(bx).forEach(t => tb.add(t)); tagsOf(nx).forEach(t => tn.add(t));
      const pb = splitParas(bx), pn = splitParas(nx); const ops = paraOps(pb.map(q => q.text), pn.map(q => q.text));
      const sec = { name: n, pb, pn, nx, ops, groups: [] }; secs.push(sec); if (!ops) continue;
      let cur = null;
      for (const o of ops) {
        if (o.op === '=') { cur = null; continue; }
        if (!cur) { cur = { id: gid++, sec: n, dels: [], adds: [], on: true }; groups.push(cur); sec.groups.push(cur); }
        if (o.op === '-') cur.dels.push(o.i); else cur.adds.push(o.j);
      }
      /* 띄어쓰기·줄나눔·빈 문단·표식 자리만 다른 묶음은 「서식만 바뀜」 — 묻지 않고 새 양식대로 반영한다(사용자 지정, 2026-10-07) */
      const squash = (t) => String(t || '').replace(/\s+/g, '').replace(/[\u0001\u0002]/g, '');
      for (const g of sec.groups) {
        const d = g.dels.map(i => squash(pb[i].text)).filter(Boolean), a = g.adds.map(j => squash(pn[j].text)).filter(Boolean);
        const sameText = d.join('\n') === a.join('\n');
        /* 표 견본 문단({{@표 …}} 이 든 문단)은 양쪽에서 걷어 내고 본다 — 표끼리 바꿔 끼운 것은 모양만 바뀐 것.
           그러고 남은 것이 단위 줄(「(단위 : …)」)뿐이면 그것도 서식만 바뀐 것({{f.표단위}} ↔ 고정 단위 줄은 같은 뜻, 2026-10-07) */
        const isTbl = (x) => /\{\{@표/.test(x), isUnit = (x) => /^\(단위[:：]/.test(x) || x === '{{f.표단위}}';
        const d2 = d.filter(x => !isTbl(x) && !isUnit(x)), a2 = a.filter(x => !isTbl(x) && !isUnit(x));
        const tableOnly = (d.some(isTbl) || a.some(isTbl)) && d2.join('\n') === a2.join('\n');
        g.trivial = sameText || tableOnly;
      }
    }
    return { zn, secs, groups, missingTags: [...tb].filter(t => !tn.has(t)), addedTags: [...tn].filter(t => !tb.has(t)) };
  }
  /* 끈 묶음은 지금 서식의 문단으로 되돌린 병합본 — 켠 묶음만 새 글 */
  function mergeTemplates(cmp) {
    const enc = new TextEncoder(); const z = cmp.zn; const reverted = cmp.groups.filter(g => !g.on).length;
    for (const sec of cmp.secs) {
      if (!sec.ops || !sec.groups.some(g => !g.on) || !z[sec.name]) continue;
      const keep = []; const off = new Set(sec.groups.filter(g => !g.on).flatMap(g => g.adds.map(j => 'a' + j).concat(g.dels.map(i => 'd' + i))));
      for (const o of sec.ops) {
        if (o.op === '=') keep.push(sec.pn[o.j].xml);
        else if (o.op === '+') { if (!off.has('a' + o.j)) keep.push(sec.pn[o.j].xml); }
        else if (off.has('d' + o.i)) keep.push(sec.pb[o.i].xml);
      }
      const first = sec.pn[0], last = sec.pn[sec.pn.length - 1];
      const head = first ? sec.nx.slice(0, first.start) : sec.nx.replace(/<\/hs:sec>\s*$/, ''), tail = last ? sec.nx.slice(last.end) : '</hs:sec>';
      z[sec.name] = enc.encode(head + keep.join('') + tail);
    }
    const bytes = window.HWPX.zip(Object.keys(z).map(n => ({ name: n, method: 0, crc: window.HWPX.crc32(z[n]), csize: z[n].length, usize: z[n].length, data: z[n] })));
    return { bytes, reverted };
  }
  const clip = (t, n = 170) => (t.length > n ? t.slice(0, n) + '…' : t) || '(빈 문단)';
  function changeSummary(cmp) {   /* 목록·설명에 적어 둘 글 */
    const lines = [];
    for (const sec of cmp.secs) for (const g of sec.groups) { if (!g.on || g.trivial) continue; g.dels.forEach(i => lines.push('− ' + clip(sec.pb[i].text))); g.adds.forEach(j => lines.push('+ ' + clip(sec.pn[j].text))); }
    return { n: cmp.groups.filter(g => g.on && !g.trivial).length, text: lines.slice(0, 80).join('\n') + (lines.length > 80 ? `\n… 그 밖에 ${lines.length - 80}줄` : '') };
  }
  /* ── 생짜 한글 파일에 {{ }} 를 옮겨 심는다 (사용자 지정, 2026-10-07) ──
   * 관리자가 올리는 새 서식은 대개 {{ }} 가 없는 한글 파일이다(개정 공문 그대로). 지금 서식(B, {{ }} 있음)과 문단을 비슷한 글끼리 맞춰
   *  · 자리표시자가 없는 문단 → 새 파일 문단 그대로(글·모양 모두 새 것)
   *  · 자리표시자가 있는 문단 → 새 파일 문단(새 모양)에서 그 값 자리(회사명·날짜…)를 찾아 자리표시자로 바꿔 심는다
   *  · 값 자리를 못 찾은 문단 → 지금 서식 문단을 그대로 둔다(값 누락이 더 큰 사고) + 「확인 필요」
   *  · 새 파일에만 있는 문단 → 들어간다 · 지금 서식에만 있던 문단 → 빠진다(자리표시자가 들어 있었으면 **남기고** 알린다)
   * 결과는 새 파일의 zip 안에서 **글만** 바꾼 것이라 모양 번호는 새 파일 것이다(남긴 지금 서식 문단만 예외 — 그래서 알린다). */
  const TAG_RE = /\{\{[^{}]*\}\}|\{%[^%{}]*%\}/g;   /* {{값}} · {{% for %}} · {% endfor %}(한 겹도 엔진이 받는다) */
  const BLK_BEGIN = /\{\{?%\s*(for|lines)\s/, BLK_END = /\{\{?%\s*(endfor|endlines)\s*%\}\}?/;
  const tokens = (t) => t.replace(TAG_RE, ' ').split(/\s+/).filter(Boolean);
  function simText(a, b) {   /* 0~1 — 자리표시자를 뺀 글의 공통 토큰 비율 */
    const ta = tokens(a), tb = tokens(b);
    if (!ta.length && !tb.length) return 1; if (!ta.length || !tb.length) return 0;
    const m = new Map(); ta.forEach(x => m.set(x, (m.get(x) || 0) + 1)); let c = 0;
    tb.forEach(x => { const k = m.get(x) || 0; if (k) { c++; m.set(x, k - 1); } });
    return 2 * c / (ta.length + tb.length);
  }
  const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const litRe = (t) => t.split(/\s+/).map(reEsc).join('\\s*');   /* 공백 묶음은 \s* — 앞뒤 공백도 \s* 가 되어 값 자리를 딱 맞게 잡는다 */
  /* 지금 서식 문단의 글 → 자리표시자 자리를 묶음( )으로 둔 정규식(둘: 문단 전체 / 어디든). 'd' 로 묶음 위치를 받는다 */
  /* 자리표시자 묶음: 뒤에 오는 글이 공백뿐이고 또 자리표시자가 이어지면(「{{부서명}} {{실무담당}}」) 값에 공백이 없다고 보고 \S*? 로 —
     둘 다 ([\s\S]*?) 면 앞 묶음이 비고 뒤 묶음이 둘을 삼킨다(2026-10-07 실제로 그랬다) */
  function tagBody(parts, tags) {
    let body = '', skipLit = false;
    for (let k = 0; k < tags.length; k++) {
      body += skipLit ? '' : litRe(parts[k] || ''); skipLit = false;
      const nextLit = parts[k + 1] || ''; const adj = k + 1 < tags.length && /^\s*$/.test(nextLit);   /* 다음도 자리표시자, 사이는 공백뿐 */
      body += adj ? '(\\S*?)' : '([\\s\\S]*?)';
      if (adj) { body += nextLit ? '\\s+' : ''; skipLit = true; }
    }
    return body + (skipLit ? '' : litRe(parts[tags.length] || ''));
  }
  function tagPattern(bxml) {
    const bt = rawText(bxml), tags = bt.match(TAG_RE) || []; if (!tags.length) return null;
    const parts = bt.split(TAG_RE); const body = tagBody(parts, tags);
    try { return { tags, parts, whole: new RegExp('^\\s*' + body + '\\s*$', 'd'), any: new RegExp(body, 'd') }; } catch (e) { return null; }
  }
  /* 문단 전체 틀이 안 맞을 때(자리표시자 둘레의 고정 문구가 함께 바뀐 문단) — 자리표시자마다 앞뒤 몇 토큰만으로 자리를 찾아 하나씩 심는다 */
  function plantTagsLocal(pat, nxml) {
    let out = nxml;
    for (let k = 0; k < pat.tags.length; k++) {
      const beforeToks = (pat.parts[k] || '').split(/\s+/).filter(Boolean), afterToks = (pat.parts[k + 1] || '').split(/\s+/).filter(Boolean);
      const nextIsTag = k + 1 < pat.tags.length && /^\s*$/.test(pat.parts[k + 1] || '');
      let done = false;
      const tagOnlyPara = pat.parts.every(x => !String(x || '').trim());
      for (const n of [3, 2, 1, 0]) {
        const bef = beforeToks.slice(-n), aft = afterToks.slice(0, n);
        if (!bef.length && !aft.length && n > 0) continue;
        /* 둘레 글이 하나도 안 맞으면(n=0) 문단 전체를 자리표시자로 바꾸게 된다 — 「- 회사는 {{f.위반문장}}」의 「- 회사는」이 사라졌다(2026-10-07).
           자리표시자만 있는 문단일 때만 허용하고, 아니면 지금 서식 문단을 둔다 */
        if (n === 0 && !tagOnlyPara) return null;
        const grp = nextIsTag ? '(\\S*?)' : '([\\s\\S]*?)';
        const body = (bef.length ? bef.map(reEsc).join('\\s*') + '\\s*' : '^\\s*') + grp + (aft.length ? '\\s*' + aft.map(reEsc).join('\\s*') : (nextIsTag ? '(?=\\s|$)' : '\\s*$'));
        let m; try { m = new RegExp(body, 'd').exec(rawText(out)); } catch (e) { m = null; }
        if (!m || !m.indices) continue;
        const [s0, e0] = m.indices[1]; if (rawText(out).slice(s0, e0) !== pat.tags[k]) out = spliceText(out, textPieces(out), s0, e0, pat.tags[k]); done = true; break;
      }
      if (!done) return null;
    }
    return { xml: out, planted: pat.tags.length, local: true };
  }
  /* 문단 XML 의 글 조각(<hp:t> 안의 글 노드)들 — {xs, xe}(XML 자리) · {ts, te}(이어 붙인 글의 자리) */
  function textPieces(xml) {
    const out = []; let pos = 0; const re = /<hp:t\b[^>]*>([\s\S]*?)<\/hp:t>/g; let m;
    while ((m = re.exec(xml))) { const inner = m[1]; const base = m.index + m[0].length - 7 - inner.length;   /* 「</hp:t>」 7자 앞 — indexOf 는 속성값과 겹칠 수 있다 */ const pr = /<[^>]+>|[^<]+/g; let q;
      while ((q = pr.exec(inner))) { if (q[0][0] === '<') continue; out.push({ xs: base + q.index, xe: base + q.index + q[0].length, ts: pos, te: pos + q[0].length, text: q[0] }); pos += q[0].length; } }
    return out;
  }
  const rawText = (xml) => textPieces(xml).map(q => q.text).join('');
  /* 글 자리 [ts,te) 를 repl 로 바꾼 XML — 여러 글 조각에 걸쳐 있어도 된다(첫 조각에 넣고 나머지는 지운다) */
  function spliceText(xml, pieces, ts, te, repl) {
    const edits = []; let put = false;
    for (const q of pieces) {
      const hit = q.ts <= ts && ts <= q.te && !put;          /* repl 을 넣을 조각 */
      const a = Math.max(ts, q.ts), b = Math.min(te, q.te);
      if (!hit && a >= b) continue;
      const xa = q.xs + (Math.max(Math.min(a, q.te), q.ts) - q.ts), xb = q.xs + (Math.max(Math.min(b, q.te), q.ts) - q.ts);
      edits.push({ xa: hit ? q.xs + (ts - q.ts) : xa, xb: Math.max(xb, hit ? q.xs + (ts - q.ts) : xa), text: hit ? repl : '' }); if (hit) put = true;
    }
    edits.sort((u, v) => v.xa - u.xa); let out = xml; for (const e of edits) out = out.slice(0, e.xa) + e.text + out.slice(e.xb); return out;
  }
  /* 지금 서식 문단(B)의 자리표시자를 새 문단(N) XML 에 심는다 → { xml, planted } · 못 찾으면 null */
  function plantTags(bxml, nxml, pat) {
    pat = pat || tagPattern(bxml); if (!pat) return { xml: nxml, planted: 0 };
    const nt = rawText(nxml); const m = pat.whole.exec(nt) || pat.any.exec(nt); if (!m || !m.indices) return plantTagsLocal(pat, nxml);
    let out = nxml;
    for (let k = pat.tags.length - 1; k >= 0; k--) { const [s0, e0] = m.indices[k + 1]; if (nt.slice(s0, e0) === pat.tags[k]) continue;   /* 이미 그 자리표시자면 손대지 않는다(run 이 쪼개진 모양 그대로) */
      out = spliceText(out, textPieces(out), s0, e0, pat.tags[k]); }
    return { xml: out, planted: pat.tags.length };
  }
  function alignParas(pb, pn, th = 0.55) {   /* 비슷한 문단끼리 차례대로 맞춘다 → [{op:'='|'-'|'+', i, j}] · 자리표시자 문단은 그 틀에 맞는 새 문단이 1점 */
    const n = pb.length, m = pn.length;
    const pats = pb.map(q => tagPattern(q.xml)), nraw = pn.map(q => rawText(q.xml));
    const simCache = new Map();
    const sim = (i, j) => { const key = i * 100000 + j; if (simCache.has(key)) return simCache.get(key);
      let v; if (pats[i]) v = pats[i].whole.test(nraw[j]) ? 1 : simText(pb[i].text, pn[j].text) * 0.9;
      else v = pb[i].text === pn[j].text ? 1 : simText(pb[i].text, pn[j].text);
      simCache.set(key, v); return v; };
    /* ⚠️ Float32 면 점수가 40~60 에 이르렀을 때 반올림 오차가 1e-6 을 넘어 '=' 짝이 '-'/'+' 로 깨졌다(2026-10-07 대표이사 줄) → Float64 */
    const S = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) { const v = sim(i, j); S[i][j] = Math.max(S[i + 1][j], S[i][j + 1], v >= th ? S[i + 1][j + 1] + v : -1); }
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) { const v = sim(i, j); if (v >= th && Math.abs(S[i][j] - (S[i + 1][j + 1] + v)) < 1e-6) { out.push({ op: '=', i: i++, j: j++, sim: v, pat: pats[i - 1] }); } else if (S[i + 1][j] >= S[i][j + 1]) out.push({ op: '-', i: i++ }); else out.push({ op: '+', j: j++ }); }
    while (i < n) out.push({ op: '-', i: i++ }); while (j < m) out.push({ op: '+', j: j++ });
    return out;
  }
  /* 반복 블록({% for %}…{% endfor %} · lines)은 **한 덩어리**로 본다(사용자 지정, 2026-10-07): 새 서식에 든 것은 예시 회사의 지적사항·표라 서식에 박히면 안 된다.
     블록 밖 문단만 맞추고, 블록은 지금 서식 그대로 두며, 새 파일에서 블록 앞·뒤 짝 사이에 낀 문단(예시 구역)은 버린다. */
  function blockSpans(pb) {   /* [{s, e}] — pb 번호 s..e(끝 포함)가 한 블록 */
    const out = []; let depth = 0, start = -1;
    pb.forEach((q, i) => { const t = q.text; const nb = (t.match(/\{\{?%\s*(for|lines)\s/g) || []).length, ne = (t.match(/\{\{?%\s*(endfor|endlines)\s*%/g) || []).length;
      if (depth === 0 && nb > ne) start = i; depth += nb - ne; if (depth <= 0 && start >= 0) { out.push({ s: start, e: i }); start = -1; depth = 0; } });
    if (start >= 0) out.push({ s: start, e: pb.length - 1 });
    return out;
  }
  /* 반복 블록 안 합치기(2026-10-07): 블록 문단(표식 포함)과 새 파일의 예시 구역을 하나씩 맞춘다.
     · 표식만 있는 문단({% endfor %} 등)은 그대로 둔다(맞춤에서 뺀다 — 예시 문단 하나를 삼키며 제목을 지우는 사고를 막는다)
     · 짝이 맞은 문단은 새 문단(새 모양·문구)에 자리표시자를 심는다 · 표가 있는 짝은 **새 표**를 서식 견본으로 쓰고 {{@표 …}} 만 첫 칸에 심는다
     · 짝이 없는 블록 문단은 그대로, 짝이 없는 예시 문단은 버린다(특정 회사 값은 {{ }} 로 채워진다) */
  const markerOnly = (t) => { const r = String(t || '').replace(TAG_RE, '').trim(); return r === '' && /\{\{?%/.test(t); };
  /* 표 바꿔 끼우기 — keepShell 이면 지금 서식 문단(표 밖 글·{{f.표단위}} 포함)은 그대로 두고 <hp:tbl> 만 새 표로; 아니면 새 문단 통째(표 밖 값 자리는 고정 글로 대체) */
  function swapTable(bxml, nxml, keepShell) {
    const bt = rawText(bxml); const sp = (bt.match(/\{\{@\s*표[^}]*\}\}/) || [])[0]; if (!sp) return null;
    const nt = /<hp:tbl\b[\s\S]*?<\/hp:tbl>/.exec(nxml); if (!nt) return null;
    let ntbl = nt[0];
    if (!ntbl.includes(sp)) {   /* 새 표 첫 칸의 첫 글 노드에 {{@표 …}} 를 심는다(이미 있으면 그대로 — 같은 서식을 다시 올린 때) */
      const tcPos = ntbl.search(/<hp:tc\b/); if (tcPos < 0) return null;
      const tm = /<hp:t(?:\s[^>]*)?>/.exec(ntbl.slice(tcPos)); if (!tm) return null;
      const open = tcPos + tm.index + tm[0].length; ntbl = ntbl.slice(0, open) + sp + ntbl.slice(open);
    }
    if (keepShell) { const bt0 = /<hp:tbl\b[\s\S]*?<\/hp:tbl>/.exec(bxml); if (!bt0) return null; return { xml: bxml.slice(0, bt0.index) + ntbl + bxml.slice(bt0.index + bt0[0].length), extra: [] }; }
    const extra = (bt.match(TAG_RE) || []).filter(t => t !== sp && !/^\{\{?%/.test(t));
    return { xml: nxml.slice(0, nt.index) + ntbl + nxml.slice(nt.index + nt[0].length), extra };
  }
  function mergeBlock(block, region) {
    /* {{@표 …}} 표 문단은 글로는 짝을 못 찾는다(「머리행 본문 라벨」 견본 vs 예시 숫자) — 블록의 첫 @표 문단 ↔ 예시 구역의 첫 표 문단을 **표끼리** 짝지어 새 표를 견본으로 쓴다 */
    const tblB = block.find(q => /<hp:tbl\b/.test(q.xml) && /\{\{@\s*표/.test(q.text)), tblN = region.find(q => /<hp:tbl\b/.test(q.xml));
    const unitBefore = (() => { const k = region.indexOf(tblN); return tblB && k > 0 && /\(\s*단위/.test(region[k - 1].text) ? region[k - 1] : null; })();
    const body = block.filter(q => !markerOnly(q.text) && q !== tblB); const region2 = region.filter(q => (q !== tblN || !tblB) && q !== unitBefore);
    const ops = alignParas(body, region2, 0.3);
    const out = []; let planted = 0, dropped = 0, tableSwapped = false; const superseded = [];
    const byIdx = new Map(body.map((q, i) => [q, i]));
    for (const q of block) {
      if (markerOnly(q.text)) { out.push(q.xml); continue; }
      if (q === tblB) { const sw = tblN ? swapTable(q.xml, tblN.xml, !unitBefore) : null;   /* 새 파일에 고정 단위 줄이 없으면 지금 문단 껍데기를 두고 표만 바꾼다 */
        if (sw) {
          /* 「(단위 : 백만원)」은 고정 글이다(사용자 지정, 2026-10-07) — 새 파일의 그 문단을 그대로 두고, 표 문단에 같이 있던 {{f.표단위}} 같은 값 자리는 새 서식의 고정 글로 대체된 것으로 본다 */
          if (unitBefore) out.push(unitBefore.xml);
          out.push(sw.xml); tableSwapped = true; planted++; if (sw.extra.length) superseded.push(...sw.extra);
        } else out.push(q.xml); continue; }
      const i = byIdx.get(q); const o = ops.find(x => x.op === '=' && x.i === i);
      if (!o) { out.push(q.xml); continue; }
      const nq = region2[o.j];
      const r = plantTags(q.xml, nq.xml, o.pat); if (r) { out.push(r.xml); planted += r.planted; } else out.push(q.xml);
    }
    dropped = region2.length - ops.filter(x => x.op === '=').length;
    return { xmls: out, planted, dropped, tableSwapped, superseded };
  }
  /* 새로 더해진 줄이라도 「라벨 : 값」 꼴이고 라벨이 아는 것(TplNames.KNOWN_LABELS)이면 값 자리를 심는다 — 「◦ 대표이사 : XXX」 → 「◦ 대표이사 : {{기본정보.대표이사}}」(사용자 지정, 2026-10-07) */
  function autoPlant(nxml) {
    if (!TN || !TN.labelTag) return null;
    const nt = rawText(nxml); const m = /^(\s*[◦○□▪■・·\-]?\s*)([^:：]{1,20}?)\s*[:：]\s*(\S[\s\S]*?)\s*$/.exec(nt); if (!m) return null;
    const tag = TN.labelTag(m[2]); if (!tag || /\{\{/.test(nt)) return null;
    const s0 = m.index + m[1].length + m[2].length + (nt.slice(m.index + m[1].length + m[2].length).match(/^\s*[:：]\s*/) || [''])[0].length;
    const e0 = s0 + m[3].length;
    return { xml: spliceText(nxml, textPieces(nxml), s0, e0, tag), note: `${m[2].trim()} → ${tag}` };
  }
  async function transferPlaceholders(baseBytes, newBytes) {
    const zb = await window.HWPX.unzip(baseBytes), zn = await window.HWPX.unzip(newBytes); const dec = new TextDecoder(), enc = new TextEncoder();
    const report = { planted: 0, keptOld: [], keptOnlyOld: [], dropped: 0, added: 0, blocks: 0, exampleDropped: 0 };
    for (const n of [...new Set([...secNames(zb), ...secNames(zn)])].sort()) {
      if (!zn[n]) continue; const nx = dec.decode(zn[n]); const bx = zb[n] ? dec.decode(zb[n]) : '';
      const pb = splitParas(bx), pn = splitParas(nx);
      /* 블록을 가짜 문단 하나로 접어서 맞춘다 */
      const spans = blockSpans(pb); const inBlock = new Map(); spans.forEach(sp => { for (let i = sp.s; i <= sp.e; i++) inBlock.set(i, sp); });
      const folded = []; const foldMap = [];   /* folded[k] → pb 번호 또는 블록 */
      for (let i = 0; i < pb.length; i++) { const sp = inBlock.get(i); if (sp) { if (i === sp.s) { folded.push({ text: '\u0001블록\u0001', xml: pb.slice(sp.s, sp.e + 1).map(q => q.xml).join(''), block: sp }); foldMap.push(sp); } continue; } folded.push(pb[i]); foldMap.push(i); }
      const ops = alignParas(folded, pn); const keep = [];
      /* 블록의 예시 구역: 블록 뒤에 이어지는 '+' 문단들(다음 짝 전까지)이 새 파일의 예시(특정 회사 지적·표)다 → 블록 안 문단과 하나씩 맞춰
         새 문구·모양은 받되 값은 자리표시자로 두고(mergeBlock), 남는 예시 문단은 버린다 */
      const isBlockIdx = (k) => !!folded[k].block;
      for (let a = 0; a < ops.length; a++) {
        const o = ops[a];
        if (o.op === '+') { const ap = autoPlant(pn[o.j].xml); keep.push(ap ? ap.xml : pn[o.j].xml); report.added++; if (ap) (report.autoPlanted = report.autoPlanted || []).push(ap.note); continue; }
        if (o.op === '-') {
          if (isBlockIdx(o.i)) {
            const sp = folded[o.i].block; const region = [];
            /* 예시 구역 = 블록 뒤의 '+' 문단들. 빈 문단끼리 맞은 '=' 짝은 경계가 아니다(빈 줄이 구역을 끊어 표가 밖으로 밀렸다, 2026-10-07) — 글이 있는 '=' 짝이 나올 때까지 */
            const blanks = [];   /* 빈 문단끼리 맞은 짝은 구역 경계가 아니다 — 새 쪽은 구역에 넣고, 지금 서식 쪽 빈 문단은 블록 뒤에 그대로 둔다 */
            let b2 = a + 1; while (b2 < ops.length && (ops[b2].op === '+' || (ops[b2].op === '=' && !folded[ops[b2].i].text.trim()))) { region.push(pn[ops[b2].j]); if (ops[b2].op === '=') blanks.push(folded[ops[b2].i].xml); b2++; } a = b2 - 1;
            const mg = mergeBlock(pb.slice(sp.s, sp.e + 1), region); keep.push(...mg.xmls, ...blanks); report.blocks++; report.exampleDropped += mg.dropped - blanks.length; report.planted += mg.planted;
            if (mg.tableSwapped) report.tableSwapped = (report.tableSwapped || 0) + 1; if (mg.superseded.length) (report.superseded = report.superseded || []).push(...mg.superseded); continue;
          }
          if (TAG_RE.test(folded[o.i].text)) { keep.push(folded[o.i].xml); report.keptOnlyOld.push(clip(folded[o.i].text, 90)); } else report.dropped++; TAG_RE.lastIndex = 0; continue;
        }
        if (isBlockIdx(o.i)) { const mg = mergeBlock(pb.slice(folded[o.i].block.s, folded[o.i].block.e + 1), [pn[o.j]]); keep.push(...mg.xmls); report.blocks++; report.exampleDropped += mg.dropped; continue; }
        const r = plantTags(folded[o.i].xml, pn[o.j].xml, o.pat);
        if (r) { keep.push(r.xml); report.planted += r.planted; if (r.local) (report.local = report.local || []).push(clip(pn[o.j].text, 90)); }
        else { keep.push(folded[o.i].xml); report.keptOld.push(clip(folded[o.i].text, 90)); }
      }
      const first = pn[0], last = pn[pn.length - 1];
      const head = first ? nx.slice(0, first.start) : nx.replace(/<\/hs:sec>\s*$/, ''), tail = last ? nx.slice(last.end) : '</hs:sec>';
      zn[n] = enc.encode(head + keep.join('') + tail);
    }
    const bytes = window.HWPX.zip(Object.keys(zn).map(n => ({ name: n, method: 0, crc: window.HWPX.crc32(zn[n]), csize: zn[n].length, usize: zn[n].length, data: zn[n] })));
    return { bytes, report };
  }
  /* 올린 서식에서 뽑는 덧씌움: 표 제목행 색(새 파일의 칠 있는 제목행 첫 칸) · 켜 둔 「글 바뀐」 묶음 중 문단 수가 같은 짝(from→to, 자리표시자 포함 글) */
  /* 조치안(안건)은 서식 업로드로 바꾸는 것을 **최소한**으로(사용자 지정, 2026-10-07): 변경 전과 견줘 「아주 큰 틀로 추가된 문단」과
     「핵심 규정·법률 기준이 바뀐 문단」만 반영하고, 그 밖(문구 손질·모양·표 색·지운 문단)은 건드리지 않는다. */

  root.TplTransfer = { BLK_BEGIN, TAG_RE, alignParas, autoPlant, b64Bytes, blockSpans, bytesB64, changeSummary, clip, compareTemplates, litRe, markerOnly, mergeBlock, mergeTemplates, paraOps, plantTags, plantTagsLocal, rawText, reEsc, secNames, simText, spliceText, splitParas, swapTable, tagBody, tagPattern, tagsOf, textPieces, tokens, transferPlaceholders };
})(typeof window !== 'undefined' ? window : globalThis);
