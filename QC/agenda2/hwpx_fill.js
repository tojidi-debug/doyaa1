/* hwpx_fill.js — {{ }} 자리표시자 템플릿(hwpx) 채우기 엔진
 *
 * hwp_alpha(엑셀 → Fill_hwpx → 한글) 의 규칙을 그대로 따른다:
 *   {{그룹.필드}}                       값 하나 치환 (예: {{기본정보.회사명}})
 *   {{% for x in 목록 %}} … {% endfor %} 반복 — 표 안이면 행 반복, 본문이면 문단 묶음 반복
 * 여기에 안건·후속서류에 필요한 것을 더했다:
 *   {{% lines l in 줄목록 %}} … {{% endlines %}}  줄 유형별 문단 서식(◦ {{l.circle}} / - {{l.dash}} / {{l.plain}} / {{l.star}} / {{l.num}} / {{l.arrow}})
 *   {{@표 경로}}          그 자리의 표(머리행 1 + 본문행 1 이 서식 견본)를 탭 구분 표 데이터로 다시 그림
 *   {{@회사개요표}}        그 표를 서식 견본으로 회사 개요 표(별도/연결·기수 수에 맞게)를 다시 그림
 * 규칙: 값이 없는 자리표시자는 그대로 남기고(미매칭 목록으로 보고), 값이 빈 문자열이고 그 문단이 자리표시자만으로 되어 있으면 문단을 뺀다.
 *       값에 줄바꿈이 있고 문단이 자리표시자만으로 되어 있으면 줄마다 같은 서식의 문단으로 늘린다.
 *       한글에서 자리표시자가 여러 run 으로 쪼개져 있어도(글자모양이 중간에 바뀜) 붙여서 인식한다.
 * 브라우저(DecompressionStream)·Node(zlib) 공용. AI 를 쓰지 않는 순수 규칙 엔진.
 */
(function (root) {
  const F = {};
  const H = () => root.HWPX;
  const esc = (s) => String(s ?? '').replace(/\t/g, '  ').replace(/[\x00\x03-\x08\x0b\x0c\x0e-\x1f]/g, '')   /* \u0001·\u0002 는 {작게} 표식 — 남긴다 */.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');   /* 탭·제어문자는 한글이 멈추므로 제거 */

  /* ── ZIP 읽기/쓰기 ─────────────────────────────────────────────── */
  async function inflateRaw(bytes) {
    if (typeof require === 'function') { try { return new Uint8Array(require('zlib').inflateRawSync(Buffer.from(bytes))); } catch (e) { /* fallthrough */ } }
    if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 압축 해제(DecompressionStream)를 지원하지 않습니다. Chrome/Edge 최신 버전을 쓰세요.');
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter(); w.write(bytes); w.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(buf);
  }
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  /* → [{name, data(Uint8Array, 압축 풀린 것)}] */
  F.unzip = async (bytes) => {
    const dec = new TextDecoder();
    let eocd = -1; for (let i = bytes.length - 22; i >= 0; i--) { if (u32(bytes, i) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('zip(hwpx) 형식이 아닙니다');
    const n = u16(bytes, eocd + 10); let off = u32(bytes, eocd + 16); const out = [];
    for (let k = 0; k < n; k++) {
      if (u32(bytes, off) !== 0x02014b50) throw new Error('zip 중앙 디렉터리 오류');
      const method = u16(bytes, off + 10), csize = u32(bytes, off + 20), usize = u32(bytes, off + 24), nlen = u16(bytes, off + 28), elen = u16(bytes, off + 30), clen = u16(bytes, off + 32), lho = u32(bytes, off + 42);
      const name = dec.decode(bytes.subarray(off + 46, off + 46 + nlen));
      const lnlen = u16(bytes, lho + 26), lelen = u16(bytes, lho + 28);
      const start = lho + 30 + lnlen + lelen; const raw = bytes.subarray(start, start + csize);
      let data;
      if (method === 0) data = raw.slice(); else if (method === 8) data = await inflateRaw(raw); else throw new Error('지원하지 않는 압축 방식: ' + method);
      if (usize && data.length !== usize) { /* 길이 불일치도 그대로 진행 */ }
      out.push({ name, data });
      off += 46 + nlen + elen + clen;
    }
    return out;
  };
  /* 모든 항목을 저장(무압축)으로 다시 묶는다. mimetype 이 맨 앞 */
  F.zip = (entries) => {
    const list = [...entries].sort((a, b) => (a.name === 'mimetype' ? -1 : b.name === 'mimetype' ? 1 : 0));
    return H().zip(list.map(e => ({ name: e.name, method: 0, crc: H().crc32(e.data), csize: e.data.length, usize: e.data.length, data: e.data })));
  };

  /* ── XML 조각 다루기(문자열 기반, DOM 없음) ───────────────────────── */
  /* 같은 태그의 최상위(depth 0) 요소 범위 [{s,e}] — 안쪽에 같은 태그가 중첩돼 있어도 바깥 것만 */
  function ranges(xml, tag) {
    const re = new RegExp('<' + tag + '(?=[\\s>/])|</' + tag + '>', 'g'); const out = []; let depth = 0, start = -1, m;
    while ((m = re.exec(xml))) {
      if (m[0][1] === '/') { depth--; if (depth === 0) out.push({ s: start, e: m.index + m[0].length }); }
      else {
        const gt = xml.indexOf('>', m.index);
        if (gt > 0 && xml[gt - 1] === '/') { if (depth === 0) out.push({ s: m.index, e: gt + 1 }); re.lastIndex = gt + 1; continue; }
        if (depth === 0) start = m.index; depth++;
      }
    }
    return out;
  }
  /* 구역 설정(secPr)·단 설정(colPr) run 은 문서에 한 번만: 반복 복사본에서는 뺀다 */
  function stripSectionRuns(xml) {
    for (const key of ['<hp:secPr', '<hp:colPr']) {
      for (let guard = 0; guard < 20; guard++) {
        const i = xml.indexOf(key); if (i < 0) break;
        const rs = xml.lastIndexOf('<hp:run', i); const re = xml.indexOf('</hp:run>', i); if (rs < 0 || re < 0) break;
        xml = xml.slice(0, rs) + xml.slice(re + 9);
      }
    }
    return xml;
  }
  /* 문단(또는 셀) 자신의 텍스트: 안쪽 표는 뺀다 */
  function stripTables(xml) { const rs = ranges(xml, 'hp:tbl'); let out = ''; let p = 0; rs.forEach(r => { out += xml.slice(p, r.s); p = r.e; }); return out + xml.slice(p); }
  const T_RE = /<hp:t>([\s\S]*?)<\/hp:t>/g;
  const innerText = (s) => s.replace(/<hp:tab[^>]*\/>/g, '\t').replace(/<[^>]+>/g, '');
  function ownText(xml) { const x = stripTables(xml); let t = ''; let m; T_RE.lastIndex = 0; while ((m = T_RE.exec(x))) t += innerText(m[1]); return t; }
  /* 문단 안 hp:t 조각들(안쪽 표 제외) 위치 목록 [{s,e,inner}] */
  function tSegs(pxml) {
    const tbls = ranges(pxml, 'hp:tbl'); const inTbl = (i) => tbls.some(r => i >= r.s && i < r.e);
    const segs = []; let m; const re = /<hp:t>([\s\S]*?)<\/hp:t>/g;
    while ((m = re.exec(pxml))) { if (inTbl(m.index)) continue; segs.push({ s: m.index + 6, e: m.index + m[0].length - 7, inner: m[1] }); }
    return segs;
  }
  function setSegs(pxml, segs, inners) { let out = ''; let p = 0; segs.forEach((g, i) => { out += pxml.slice(p, g.s) + inners[i]; p = g.e; }); return out + pxml.slice(p); }
  /* 여러 run 에 쪼개진 {{…}} 를 첫 run 으로 모은다 */
  function normalizePara(pxml) {
    for (let guard = 0; guard < 50; guard++) {
      const segs = tSegs(pxml); if (!segs.length) return pxml;
      const inners = segs.map(g => g.inner); const offs = []; let acc = 0; inners.forEach(t => { offs.push(acc); acc += t.length; });
      const joined = inners.join('');
      const re = /\{\{[^{}]*\}\}|\{%[^{}]*%\}/g; let m, changed = false;
      while ((m = re.exec(joined))) {
        const ms = m.index, me = ms + m[0].length;
        const a = offs.findIndex((o, i) => ms >= o && ms < o + inners[i].length);
        const b = offs.findIndex((o, i) => me - 1 >= o && me - 1 < o + inners[i].length);
        if (a < 0 || b < 0 || a === b) continue;
        const tail = inners[b].slice(me - offs[b]);
        inners[a] = inners[a].slice(0, ms - offs[a]) + m[0] + tail;
        for (let i = a + 1; i <= b; i++) inners[i] = '';
        changed = true; break;
      }
      if (!changed) return pxml;
      pxml = setSegs(pxml, segs, inners);
    }
    return pxml;
  }
  const hasTable = (pxml) => /<hp:tbl[\s>]/.test(pxml);
  const hasSecPr = (pxml) => /<hp:secPr[\s>]/.test(pxml);
  /* 글이 바뀐 문단: 표가 없으면 줄배치(linesegarray)를 지워 한글이 다시 배치하게 한다(첫 문단은 유지) */
  function relayout(pxml) {
    if (hasSecPr(pxml)) return pxml;
    if (!hasTable(pxml)) return pxml.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '');
    return pxml.replace(/<hp:linesegarray>([\s\S]*?)<\/hp:linesegarray>/g, (m, inner) => { const first = inner.match(/<hp:lineseg [^>]*\/>/); return '<hp:linesegarray>' + (first ? first[0].replace(/textpos="\d+"/, 'textpos="0"') : '') + '</hp:linesegarray>'; });
  }

  /* ── 자리표시자 문법 ───────────────────────────────────────────── */
  const ROW_IF = /\{\{%\s*row-if\s+([^%]+?)\s*%\}\}/;   /* 표 행 켜고 끄기(값이 비면 그 행을 뺀다) */
  const BEGIN = /\{\{?%\s*(for|lines)\s+([^\s%]+)\s+in\s+([^\s%]+)(?:\s+(pagebreak|쪽나눔))?\s*%\}\}?/;
  const END = /\{\{?%\s*(endfor|endlines)\s*%\}\}?/;
  const BEGIN_G = new RegExp(BEGIN.source, 'g'), END_G = new RegExp(END.source, 'g');
  /* 태그를 지울 때는 종류를 특정한다 — 표 행 반복의 {% endfor %} 를 지우려다 같은 셀의 첫 {{% endlines %}} 를 지우면 줄 블록이 다음 블록까지 삼킨다 */
  const BEGIN_FOR = /\{\{?%\s*for\s+[^\s%]+\s+in\s+[^\s%]+(?:\s+(?:pagebreak|쪽나눔))?\s*%\}\}?/, END_FOR = /\{\{?%\s*endfor\s*%\}\}?/, END_LINES = /\{\{?%\s*endlines\s*%\}\}?/;
  /* {{% if 경로 %}} … {{% endif %}} — 본문 **문단 조건 블록**(2026-10-07). 두 표식은 제 문단에 홀로 있어야 하고 그 문단은 결과에서 빠진다.
     값이 참(row-if 와 같은 규칙)이면 안의 문단이 남고, 거짓이면 안의 문단이 모두 빠진다. {{% if not 경로 %}} 는 반대. 겹쳐 쓸 수 있다.
     표준 조치안 서식 한 벌이 사건 유형(별도연결·감사인적용…)에 따라 구역을 켜고 끄려고 둔 것 — 표 안에서는 row-if 를 쓴다. */
  const BEGIN_IF = /\{\{?%\s*if\s+(not\s+)?([^\s%]+)\s*%\}\}?/, END_IF = /\{\{?%\s*endif\s*%\}\}?/;
  const BEGIN_IF_G = new RegExp(BEGIN_IF.source, 'g'), END_IF_G = new RegExp(END_IF.source, 'g');
  const truthy = (v) => !(v === undefined || v === null || v === false || v === '' || v === 0 || v === '0'
    || (Array.isArray(v) && !v.length) || /^(아니오|없음|no|false)$/i.test(String(v).trim()));
  const escRe = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const SCALAR_G = /\{\{\s*([^{}%@\s][^{}]*?)\s*\}\}/g;
  const SPECIAL = /\{\{@\s*([^\s}]+)(?:\s+([^}]*?))?\s*\}\}/;
  const count = (s, re) => (s.match(re) || []).length;

  const norm = (k) => String(k).replace(/[\s_\-]/g, '');
  /* ctx 에서 경로 찾기: 공백·밑줄·하이픈 차이는 무시(가이드 규칙) */
  function resolve(ctx, path) {
    const ks = String(path).trim().split('.'); let o = ctx;
    for (const k of ks) {
      if (o === null || o === undefined) return undefined;
      if (Object.prototype.hasOwnProperty.call(o, k)) { o = o[k]; continue; }
      if (Array.isArray(o) && /^\d+$/.test(k)) { o = o[Number(k)]; continue; }
      const nk = norm(k); const hit = Object.keys(o).find(x => norm(x) === nk);
      if (hit === undefined) return undefined;
      o = o[hit];
    }
    return o;
  }
  function toText(v) { const t = toText0(v); return t === undefined ? t : smallMark(t); }
  function toText0(v) { if (v === null || v === undefined) return undefined; if (Array.isArray(v)) return v.map(x => typeof x === 'object' ? (x.text ?? '') : String(x)).join('\n'); if (typeof v === 'object') return v.text !== undefined ? String(v.text) : ''; return String(v); }

  /* ── 채우기 본체 ──────────────────────────────────────────────── */
  function removeTagText(pxml, re) { pxml = normalizePara(pxml); const segs = tSegs(pxml); const inners = segs.map(g => g.inner); for (let i = 0; i < inners.length; i++) { if (re.test(inners[i])) { inners[i] = inners[i].replace(re, ''); break; } } return setSegs(pxml, segs, inners); }
  const isEmptyPara = (pxml) => !hasTable(pxml) && ownText(pxml).trim() === '';
  function emptyPara(pxml) { const segs = tSegs(pxml); return relayout(setSegs(pxml, segs, segs.map(() => ''))); }

  /* 문단 열(section 본문 또는 셀 subList 안) 채우기 */
  function fillBlock(xml, ctx, st) {
    const ps = ranges(xml, 'hp:p'); if (!ps.length) return xml;
    let out = xml.slice(0, ps[0].s); let i = 0;
    const seg = (k) => xml.slice(ps[k].s, ps[k].e);
    while (i < ps.length) {
      const pt = ownText(seg(i));
      const bi = BEGIN_IF.exec(pt);
      if (bi) {
        let depth = 0, j = i;
        for (; j < ps.length; j++) { const t = ownText(seg(j)); depth += count(t, BEGIN_IF_G) - count(t, END_IF_G); if (depth <= 0) break; }
        if (j >= ps.length) { st.errors.push(`${bi[0]} 에 맞는 {{% endif %}} 가 없습니다`); j = ps.length - 1; }
        const key = bi[2].trim(); const v = resolve(ctx, key); if (v === undefined) st.missing.add(key); st.used.add('if:' + key);
        const on = bi[1] ? !truthy(v) : truthy(v);
        if (on && j > i + 1) out += fillBlock(xml.slice(ps[i + 1].s, ps[j - 1].e), ctx, st);
        out += xml.slice(ps[j].e, j + 1 < ps.length ? ps[j + 1].s : ps[j].e);
        i = j + 1; continue;
      }
      const b = BEGIN.exec(pt);
      if (b) {
        let depth = 0, j = i;
        for (; j < ps.length; j++) { const t = ownText(seg(j)); depth += count(t, BEGIN_G) - count(t, END_G); if (depth <= 0) break; }
        if (j >= ps.length) { st.errors.push(`${b[0]} 에 맞는 종료 태그가 없습니다`); j = ps.length - 1; }
        const endRe = b[1] === 'for' ? END_FOR : END_LINES; let first = removeTagText(seg(i), new RegExp(escRe(b[0]))); let last = i === j ? removeTagText(first, endRe) : removeTagText(seg(j), endRe);
        const mids = []; for (let k = i + 1; k < j; k++) mids.push(seg(k));
        let inner = (i === j) ? (isEmptyPara(last) ? '' : last) : ((isEmptyPara(first) ? '' : first) + mids.join('') + (isEmptyPara(last) ? '' : last));
        const kind = b[1], v = b[2], listPath = b[3];
        const list = resolve(ctx, listPath);
        if (list === undefined) st.missing.add(listPath);
        const items = Array.isArray(list) ? list : (list && typeof list === 'object' ? Object.values(list) : []);
        if (kind === 'for') items.forEach((it, idx) => { const c = Object.assign({}, ctx); c[v] = (it && typeof it === 'object') ? Object.assign({ _index: idx + 1, _first: idx === 0, _last: idx === items.length - 1 }, it) : it; c._index = idx + 1; let piece = fillBlock(inner, c, st); if (idx > 0) { piece = stripSectionRuns(piece); if (b[4]) piece = piece.replace('pageBreak="0"', 'pageBreak="1"'); } out += piece; });
        else out += fillLines(inner, v, items, ctx, st);
        out += xml.slice(ps[j].e, j + 1 < ps.length ? ps[j + 1].s : ps[j].e);
        i = j + 1; continue;
      }
      let px = seg(i);
      /* {{@안건:지적사항}} 처럼 문단 하나가 특수 구역 자리표시자면 그 자리에 엔진이 만든 구역 XML 을 넣는다 */
      const spm = !hasTable(px) && SPECIAL.exec(ownText(px));
      if (spm && /^안건:/.test(spm[1])) { const name = spm[1].slice(3); const xml2 = st.sections && st.sections[name]; if (xml2 !== undefined) { st.used.add('@' + spm[1]); out += xml2; } else { st.errors.push('구역 값이 없습니다: {{@' + spm[1] + '}}'); out += px; } out += xml.slice(ps[i].e, i + 1 < ps.length ? ps[i + 1].s : ps[i].e); i++; continue; }
      px = fillTablesIn(px, ctx, st);
      px = fillScalars(px, ctx, st);
      out += px + xml.slice(ps[i].e, i + 1 < ps.length ? ps[i + 1].s : ps[i].e);
      i++;
    }
    return out + xml.slice(ps[ps.length - 1].e);
  }
  /* 줄 유형 블록: 안의 문단마다 {{v.kind}} 가 그 유형의 서식 견본 */
  function fillLines(inner, v, items, ctx, st) {
    const ps = ranges(inner, 'hp:p'); const protos = {}; let firstProto = null;
    const re = new RegExp('\\{\\{\\s*' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.(circle|dash|star|num|arrow|plain|title|table)\\s*\\}\\}');
    ps.forEach(r => { const px = normalizePara(inner.slice(r.s, r.e)); const m = re.exec(ownText(px)); if (m) { protos[m[1]] = px; if (!firstProto) firstProto = px; } });
    let out = '';
    items.forEach((it, idx) => {
      const line = (it && typeof it === 'object') ? it : { kind: 'plain', text: String(it) };
      const proto = protos[line.kind] || protos.plain || firstProto; if (!proto) return;
      const usedKind = Object.keys(protos).find(k => protos[k] === proto) || line.kind;
      const c = Object.assign({}, ctx); const obj = Object.assign({ _index: idx + 1 }, line); obj[line.kind] = line.text; obj[usedKind] = line.text; if (!obj.plain && line.kind !== 'plain') obj.plain = line.text; c[v] = obj;
      if (line.kind === 'table' && line.grid) { out += fillTablesIn(fillScalars(proto, c, st), c, st); return; }
      out += fillScalars(proto, c, st);
    });
    return out;
  }
  /* 문단 안 표들 */
  function fillTablesIn(pxml, ctx, st) {
    const rs = ranges(pxml, 'hp:tbl'); if (!rs.length) return pxml;
    let out = ''; let p = 0;
    rs.forEach(r => { out += pxml.slice(p, r.s) + fillTable(pxml.slice(r.s, r.e), ctx, st); p = r.e; });
    return out + pxml.slice(p);
  }
  function cellText(tc) { const sl = tc.match(/<hp:subList[^>]*>([\s\S]*)<\/hp:subList>/); return sl ? ranges(sl[1], 'hp:p').map(r => ownText(sl[1].slice(r.s, r.e))).join('\n') : ''; }
  function rowText(tr) { return ranges(tr, 'hp:tc').map(r => cellText(tr.slice(r.s, r.e))).join('\n'); }
  function tableText(tbl) { return ranges(tbl, 'hp:tr').map(r => rowText(tbl.slice(r.s, r.e))).join('\n'); }
  function fillTable(tbl, ctx, st) {
    const sp = SPECIAL.exec(tableText(tbl));
    if (sp) return specialTable(tbl, sp[1], sp[2] || '', ctx, st);
    const trs = ranges(tbl, 'hp:tr'); if (!trs.length) return tbl;
    const head = tbl.slice(0, trs[0].s), tail = tbl.slice(trs[trs.length - 1].e);
    const rows = trs.map(r => tbl.slice(r.s, r.e));
    const outRows = fillRows(rows, ctx, st);
    return renumber(head + outRows.join('') + tail, outRows.length);
  }
  /* 표 행 채우기 — 행 반복({% for %})은 **겹쳐 쓸 수 있다**(연도 → 그 연도의 지적사항 행, 2026-09-19).
     세로로 합친 칸(rowSpan)은 반복으로 늘어난 행 수에 맞춰 준다:
       · 반복 묶음 첫 행의 칸 중 rowSpan 이 **묶음 행 수와 같은** 칸 → 그 회차에 실제로 나온 행 수로
       · 반복 태그가 든 칸보다 **왼쪽** 칸(바깥 묶음의 칸, 예: 구분 「별도」·연도 「제3기(‘22년)」) → 첫 회차에만
         두고 다음 회차에서는 뺀다(바깥 묶음이 길이를 맞춘다) */
  const colOf = (tc) => { const k = tc.lastIndexOf('<hp:cellAddr'); const m = k >= 0 && /colAddr="(\d+)"/.exec(tc.slice(k)); return m ? Number(m[1]) : 0; };
  const cellSpan = (tc) => { const k = tc.lastIndexOf('<hp:cellSpan'); const m = k >= 0 && /rowSpan="(\d+)"/.exec(tc.slice(k)); return m ? Number(m[1]) : 1; };
  const setCellSpan = (tc, n) => { const k = tc.lastIndexOf('<hp:cellSpan'); return k < 0 ? tc : tc.slice(0, k) + tc.slice(k).replace(/rowSpan="\d+"/, `rowSpan="${n}"`); };
  function removeTagOnce(tr, re, fromEnd) {
    const rs = ranges(tr, 'hp:tc'); const order = rs.map((r, k) => k); if (fromEnd) order.reverse();
    for (const k of order) {
      const tc = tr.slice(rs[k].s, rs[k].e); if (!re.test(cellText(tc))) continue;
      const fixed = tc.replace(/(<hp:subList[^>]*>)([\s\S]*)(<\/hp:subList>)/, (m, a, inner, z) => {
        const ps = ranges(inner, 'hp:p'); const idx = fromEnd ? [...ps.keys()].reverse() : [...ps.keys()];
        for (const q of idx) { const px = inner.slice(ps[q].s, ps[q].e); if (re.test(ownText(normalizePara(px)))) { let np = normalizePara(px); const segs = tSegs(np); const inn = segs.map(g => g.inner); const hits = inn.map((t, x) => re.test(t) ? x : -1).filter(x => x >= 0); const x = fromEnd ? hits[hits.length - 1] : hits[0]; if (x === undefined) break; if (fromEnd) { const all = [...inn[x].matchAll(new RegExp(re.source, 'g'))]; const lm = all[all.length - 1]; inn[x] = inn[x].slice(0, lm.index) + inn[x].slice(lm.index + lm[0].length); } else inn[x] = inn[x].replace(re, ''); np = setSegs(np, segs, inn); return a + inner.slice(0, ps[q].s) + np + inner.slice(ps[q].e) + z; } }
        return m;
      });
      return tr.slice(0, rs[k].s) + fixed + tr.slice(rs[k].e);
    }
    return tr;
  }
  function fillRows(rows, ctx, st) {
    const outRows = []; let i = 0;
    while (i < rows.length) {
      const t = rowText(rows[i]); const b = BEGIN.exec(t);
      if (b && b[1] === 'for') {
        let depth = 0, j = i; for (; j < rows.length; j++) { const tt = rowText(rows[j]); depth += count(tt, BEGIN_G) - count(tt, END_G); if (depth <= 0) break; }
        if (j >= rows.length) { st.errors.push(`표 안 ${b[0]} 에 맞는 {% endfor %} 가 없습니다`); j = rows.length - 1; }
        /* 그 태그 **하나만** 지운다 — 같은 행에 안쪽 반복 태그가 함께 있을 수 있다 */
        const L = j - i + 1;
        const group = rows.slice(i, j + 1).map((r, k) => { let x = r; if (k === 0) x = removeTagOnce(x, new RegExp(escRe(b[0])), false); if (k === L - 1) x = removeTagOnce(x, END_FOR, true); return x; });
        const list = resolve(ctx, b[3]); if (list === undefined) st.missing.add(b[3]);
        const items = Array.isArray(list) ? list : [];
        /* 반복 태그가 든 칸의 열 — 그보다 **왼쪽** 칸은 바깥 묶음의 칸(예: 구분 「별도」, 연도 「제3기(‘22년)」)이라
           첫 회차에만 둔다(표는 왼쪽이 큰 묶음, 오른쪽이 작은 묶음이다) */
        const tagCol = (() => { const rs = ranges(rows[i], 'hp:tc'); for (const r of rs) { const tc = rows[i].slice(r.s, r.e); if (cellText(tc).includes(b[0])) return colOf(tc); } return 0; })();
        items.forEach((it, idx) => {
          const c = Object.assign({}, ctx); c[b[2]] = (it && typeof it === 'object') ? Object.assign({ _index: idx + 1, _first: idx === 0, _last: idx === items.length - 1 }, it) : it;
          const g = group.slice(); if (idx > 0) g[0] = mapCells(g[0], tc => colOf(tc) < tagCol ? ' DROP' : tc).replace(/ DROP/g, '');
          const chunk = fillRows(g, c, st);
          /* 늘리는 칸: 반복 태그가 든 칸(그 묶음의 이름표 칸), 그리고 여러 행 묶음에서 묶음 전체를 덮던 칸(예: 조치안 칸).
             한 행 묶음(L=1)에서는 모든 칸이 rowSpan 1 이라 이름표 칸만 늘린다 — 전부 늘리면 격자가 겹친다 */
          if (chunk.length) chunk[0] = mapCells(chunk[0], tc => cellSpan(tc) === L && (colOf(tc) === tagCol || L > 1) ? setCellSpan(tc, chunk.length) : tc);
          outRows.push(...chunk);
        });
        i = j + 1; continue;
      }
      /* {{% row-if 경로 %}} — 값이 비면(빈 글·0·false·빈 목록·「아니오」) **그 행을 통째로 뺀다**.
         조치안 표의 「합 계」 행(그 해 지적이 한 건뿐)·「Max(…)」 행(조치대상 연도가 한 해뿐)처럼
         실물에서 없기도 한 줄을, 서식은 그대로 두고 값으로만 끄기 위한 것이다(2026-09-20 사용자 지정). */
      const rif = ROW_IF.exec(t);
      if (rif) {
        const key = rif[1].trim(); const v = resolve(ctx, key);
        if (v === undefined) st.missing.add(key);
        const on = !(v === undefined || v === null || v === false || v === '' || v === 0 || v === '0'
          || (Array.isArray(v) && !v.length) || /^(아니오|없음|no|false)$/i.test(String(v).trim()));
        if (!on) { i++; continue; }
        outRows.push(fillRow(removeTagOnce(rows[i], new RegExp(escRe(rif[0])), false), ctx, st)); i++; continue;
      }
      outRows.push(fillRow(rows[i], ctx, st)); i++;
    }
    return outRows;
  }
  function mapCells(tr, fn) { const rs = ranges(tr, 'hp:tc'); let out = ''; let p = 0; rs.forEach(r => { out += tr.slice(p, r.s) + fn(tr.slice(r.s, r.e)); p = r.e; }); return out + tr.slice(p); }
  function fillRow(tr, ctx, st) {
    return mapCells(tr, tc => tc.replace(/(<hp:subList[^>]*>)([\s\S]*)(<\/hp:subList>)/, (m, a, inner, z) => {
      let filled = fillBlock(inner, ctx, st);
      if (!/<hp:p[\s>]/.test(filled)) { const first = ranges(inner, 'hp:p')[0]; filled = first ? emptyPara(inner.slice(first.s, first.e)) : inner; }
      return a + filled + z;
    }));
  }
  /* 행 번호·행 수·표 높이 다시 맞추기 */
  function renumber(tbl, nrows) {
    const trs = ranges(tbl, 'hp:tr'); let out = tbl.slice(0, trs[0] ? trs[0].s : tbl.length); let h = 0;
    /* 셀 자신의 cellAddr/cellSz 는 subList 뒤에 온다(안쪽 표의 것은 subList 안) */
    trs.forEach((r, i) => {
      let tr = tbl.slice(r.s, r.e); let hi = 0;
      tr = mapCells(tr, tc => { const k = tc.lastIndexOf('<hp:cellAddr'); if (k < 0) return tc; const tail = tc.slice(k).replace(/rowAddr="\d+"/, `rowAddr="${i}"`); const m = tail.match(/<hp:cellSz width="\d+" height="(\d+)"/); if (m && !hi) hi = Number(m[1]); return tc.slice(0, k) + tail; });
      h += hi; out += tr;
    });
    out += tbl.slice(trs.length ? trs[trs.length - 1].e : tbl.length);
    out = out.replace(/rowCnt="\d+"/, `rowCnt="${trs.length}"`);
    out = respan(out);
    if (h) out = out.replace(/(<hp:sz width="\d+" widthRelTo="[^"]*" height=")\d+(")/, `$1${h}$2`);
    return out;
  }
  /* 세로 합친 칸(rowSpan)을 **표 모양대로 다시 센다**(2026-09-19). 행 반복으로 행이 늘거나(바깥 칸은 첫 회차에만
     남는다) 줄면, 위에서 내려오던 칸의 길이가 맞지 않게 된다. 각 칸에서 아래로 내려가며 그 칸의 열(합친 열 포함)을
     차지하는 칸이 **없는** 행 수만큼 늘리고, 차지하는 칸이 나오면 멈춘다. 멀쩡한 표는 그대로 나온다. */
  function respan(tbl) {
    const trs = ranges(tbl, 'hp:tr'); if (trs.length < 2) return tbl;
    const colSpanOf = (tc) => { const k = tc.lastIndexOf('<hp:cellSpan'); const m = k >= 0 && /colSpan="(\d+)"/.exec(tc.slice(k)); return m ? Number(m[1]) : 1; };
    const rowsCells = trs.map(r => ranges(tbl.slice(r.s, r.e), 'hp:tc').map(c => { const tc = tbl.slice(r.s + c.s, r.s + c.e); return { c: colOf(tc), cs: colSpanOf(tc) }; }));
    const covers = (ri, a, b) => rowsCells[ri].some(x => x.c < b && a < x.c + x.cs);
    let out = tbl.slice(0, trs[0].s);
    trs.forEach((r, ri) => {
      let k = 0;
      out += mapCells(tbl.slice(r.s, r.e), tc => {
        const me = rowsCells[ri][k++]; let n = 1;
        for (let rj = ri + 1; rj < trs.length && !covers(rj, me.c, me.c + me.cs); rj++) n++;
        return cellSpan(tc) === n ? tc : setCellSpan(tc, n);
      });
      out += tbl.slice(r.e, ri + 1 < trs.length ? trs[ri + 1].s : r.e);
    });
    return out + tbl.slice(trs[trs.length - 1].e);
  }
  /* 값 치환 */
  function fillScalars(pxml, ctx, st) {
    if (!/\{\{/.test(stripTables(pxml))) return pxml;
    pxml = normalizePara(pxml);
    const segs = tSegs(pxml); if (!segs.length) return pxml;
    const own = ownText(pxml).trim(); const single = own.match(/^\{\{\s*([^{}%@\s][^{}]*?)\s*\}\}$/);
    if (single) {
      const v = resolve(ctx, single[1]);
      if (v === undefined) { st.missing.add(single[1]); return pxml; }
      const text = toText(v); st.used.add(single[1]);
      if (text === '' && !hasTable(pxml)) return '';
      const lines = text.split('\n');
      return lines.map(ln => relayout(setSegs(pxml, segs, segs.map(g => g.inner.replace(SCALAR_G, () => esc(ln)))))).join('');
    }
    let changed = false;
    const inners = segs.map(g => g.inner.replace(SCALAR_G, (m, path) => { const v = resolve(ctx, path); if (v === undefined) { st.missing.add(path); return m; } st.used.add(path); changed = true; return esc(toText(v).replace(/\n/g, ' ')); }));
    return changed ? relayout(setSegs(pxml, segs, inners)) : pxml;
  }

  /* ── 특수 표 ────────────────────────────────────────────────── */
  const attr = (xml, name) => { const m = xml.match(new RegExp(name + '="([^"]*)"')); return m ? m[1] : ''; };
  /* 셀 견본 → HWPX.tableXml 이 쓰는 형식 {tc, p, lead} */
  function cellProto(tc) {
    const sl = tc.match(/<hp:subList[^>]*>([\s\S]*)<\/hp:subList>/); const ps = sl ? ranges(sl[1], 'hp:p') : [];
    let p = ps.length ? sl[1].slice(ps[0].s, ps[0].e) : '<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t></hp:t></hp:run></hp:p>';
    p = normalizePara(p);
    /* 첫 run 만 남기고 글을 {{T}} 로 */
    const runs = ranges(p, 'hp:run'); if (runs.length) { const first = p.slice(runs[0].s, runs[0].e); const cp = attr(first, 'charPrIDRef') || '0'; p = p.slice(0, runs[0].s) + `<hp:run charPrIDRef="${cp}"><hp:t>{{T}}</hp:t></hp:run>` + p.slice(runs[runs.length - 1].e); }
    else p = p.replace(/<\/hp:p>$/, '<hp:run charPrIDRef="0"><hp:t>{{T}}</hp:t></hp:run></hp:p>');
    p = p.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '');
    const txt = ownText(tc.slice(0)); const lead = txt.length - txt.replace(/^[ 　]+/, '').length;
    let shell = tc.replace(/<hp:subList([^>]*)>[\s\S]*<\/hp:subList>/, '<hp:subList$1>{{PARAS}}</hp:subList>');
    shell = shell.replace(/colAddr="\d+"/, 'colAddr="{{COL}}"').replace(/rowAddr="\d+"/, 'rowAddr="{{ROW}}"').replace(/colSpan="\d+"/, 'colSpan="{{CS}}"').replace(/rowSpan="\d+"/, 'rowSpan="{{RS}}"').replace(/<hp:cellSz width="\d+" height="\d+"/, '<hp:cellSz width="{{W}}" height="{{H}}"');
    return { tc: shell, p, lead: Math.min(lead, 4) };
  }
  function tableShell(tbl) {
    const trs = ranges(tbl, 'hp:tr'); let shell = tbl.slice(0, trs[0].s) + '{{ROWS}}' + tbl.slice(trs[trs.length - 1].e);
    shell = shell.replace(/rowCnt="\d+"/, 'rowCnt="{{R}}"').replace(/colCnt="\d+"/, 'colCnt="{{C}}"').replace(/(<hp:sz width="\d+" widthRelTo="[^"]*" height=")\d+(")/, '$1{{H}}$2').replace(/<hp:caption[\s\S]*?<\/hp:caption>/, '');
    return { shell, w: Number(attr(tbl, 'width')) || 48000 };
  }
  const cellsOf = (tr) => ranges(tr, 'hp:tc').map(r => tr.slice(r.s, r.e));
  function specialTable(tbl, kind, arg, ctx, st) {
    const DG = root.DocGen; const HW = H();
    const trs = ranges(tbl, 'hp:tr').map(r => tbl.slice(r.s, r.e));
    const sh = tableShell(tbl);
    if (/^(표|table)$/.test(kind)) {
      const v = resolve(ctx, arg); if (v === undefined) { st.missing.add(arg); return tbl; } st.used.add(arg);
      const rows = v && v.rows ? v.rows : DG.parseGrid(toText(v && v.text !== undefined ? v.text : v));
      if (!rows.length) return '';
      const g = DG.gridSpec(rows, Number(v && v.headerRows) || 1);
      const hd = cellsOf(trs[0]); const bd = cellsOf(trs[1] || trs[0]); const sumRow = trs.find(t => /(소\s*계|합\s*계|총\s*계)/.test(rowText(t)) && !/\{\{/.test(rowText(t)));
      const sm = sumRow ? cellsOf(sumRow) : bd;
      const cells = { th: cellProto(hd[0]), tdl: cellProto(bd[0]), td: cellProto(bd[Math.min(1, bd.length - 1)]), tdr: cellProto(bd[bd.length - 1]), sum: cellProto(sm[0]), sumr: cellProto(sm[sm.length - 1]) };
      const rowH = Number(attr(bd[0], 'height').split('"')[0]) || 1300;
      const tpl = { tproto: { t: Object.assign({ cells }, sh) }, proto: {} };
      return HW.tableXml(tpl, 't', { cols: DG.colWeights(g, sh.w), rows: g.rows, rowH: Number((bd[0].match(/<hp:cellSz width="\d+" height="(\d+)"/) || [])[1]) || 1300 });
    }
    if (/^(회사개요표|company)$/.test(kind)) {
      const S = st.S; if (!S) { st.errors.push('{{@회사개요표}} 는 안건 입력 상태(S)가 있어야 그립니다'); return tbl; }
      /* 견본 표에서 역할별 셀 찾기(글 내용으로) */
      const all = trs.flatMap(cellsOf); const find = (re) => all.find(tc => re.test(cellText(tc)));
      const numCell = all.find(tc => /^\s*[\d,]+\s*$/.test(cellText(tc)) && !/\{\{/.test(cellText(tc)));
      const pick = { th: find(/회\s*사\s*명/), name: find(/㈜|\{\{[^}]*회사명/), tdc: find(/\{\{[^}]*대표이사|비상장법인|상장법인/), tdl: find(/\{\{[^}]*소재지|시 |도 /), thY: find(/제\d+기\s*\n?\s*\(‘\d\d년\)|\{\{[^}]*단축/), num: numCell, thL: find(/회계연도/), period: find(/\d{4}\.1\.1\.|\{\{[^}]*사업연도/), unit: find(/\(단위/), side: find(/^\s*주\s*\n?\s*요|주요재무상황|별\s*\n?\s*도|연\s*\n?\s*결/), blank: all.find(tc => cellText(tc).replace(/\{\{@[^}]*\}\}/, '').trim() === '') };
      const cells = {}; Object.entries(pick).forEach(([k, tc]) => { if (tc) cells[k] = cellProto(tc); });
      ['th', 'name', 'tdc', 'tdl', 'thY', 'num', 'thL', 'period', 'unit', 'blank'].forEach(k => { if (!cells[k]) cells[k] = cells.th || cellProto(all[0]); });
      const tpl = { tproto: { company: Object.assign({ cells }, sh) }, proto: {} };
      const ct = DG.companyTable(S, tpl, !!pick.side);
      return HW.tableXml(tpl, 'company', { cols: ct.cols, rows: ct.rows, rowH: 1300 });
    }
    st.errors.push('알 수 없는 특수 표: {{@' + kind + '}}'); return tbl;
  }

  /* ── 공개 API ───────────────────────────────────────────────── */
  /* section xml 채우기 */
  F.fillXml = (xml, ctx, opt = {}) => {
    const st = { missing: new Set(), used: new Set(), errors: [], S: opt.S, sections: opt.sections };
    xml = xml.replace(/<hp:p\b([^>]*?)\/>/g, '<hp:p$1></hp:p>');
    let out = fillBlock(xml, ctx, st);
    /* 첫 문단(구역 설정)은 남아 있어야 한다 */
    return { xml: out, missing: [...st.missing], used: [...st.used], errors: st.errors };
  };
  /* 템플릿 hwpx 바이트 → 채운 hwpx 바이트 */
  /* ── {작게 N}…{/작게} — 값 안의 일부를 그 자리 글자보다 N pt(기본 2) 작게(사용자 지정, 2026-10-07: 「제16기(2021.1.1.~2021.12.31.)」의 괄호 기간) ──
     fillScalars 가 값을 넣을 때 표식을 \u0001N\u0001 … \u0002 로 바꿔 두고, 문단 채움이 끝난 뒤 그 run 을 쪼개 작은 글자 모양(header.xml 의 charPr 을 height−N·100 으로 복제)을 단다.
     머리(header.xml)를 못 찾으면 표식만 지운다. */
  const SMALL_OPEN = /\{작게(?:\s+(\d+(?:\.\d+)?))?\}/g, SMALL_CLOSE = /\{\/작게\}/g;
  const smallMark = (t) => String(t).replace(SMALL_OPEN, (m, n) => '\u0001' + (n || '2') + '\u0001').replace(SMALL_CLOSE, '\u0002');
  F.stripSmall = (t) => String(t).replace(SMALL_OPEN, '').replace(SMALL_CLOSE, '');
  function applySmallRuns(xml, hdr) {   /* → { xml, header } */
    if (!/\u0001/.test(xml)) return { xml, header: hdr };
    let header = hdr; const made = new Map();
    const variant = (cp, n) => {
      const key = cp + '|' + n; if (made.has(key)) return made.get(key); if (!header) return cp;
      const m = new RegExp('<hh:charPr id="' + cp + '"([^>]*)>([\\s\\S]*?)</hh:charPr>').exec(header); if (!m) return cp;
      const hm = /height="(\d+)"/.exec(m[1]); if (!hm) return cp;
      const ids = [...header.matchAll(/<hh:charPr id="(\d+)"/g)].map(x => Number(x[1])); const id = String(Math.max(...ids) + 1);
      const h2 = Math.max(100, Number(hm[1]) - Math.round(Number(n) * 100));
      const clone = '<hh:charPr id="' + id + '"' + m[1].replace(/height="\d+"/, 'height="' + h2 + '"') + '>' + m[2] + '</hh:charPr>';
      header = header.replace('</hh:charProperties>', clone + '</hh:charProperties>').replace(/<hh:charProperties itemCnt="(\d+)"/, (mm, c) => '<hh:charProperties itemCnt="' + (Number(c) + 1) + '"');
      made.set(key, id); return id;
    };
    xml = xml.replace(/<hp:run charPrIDRef="(\d+)"([^>]*)><hp:t>([^<]*)<\/hp:t><\/hp:run>/g, (m, cp, attrs, text) => {
      if (!/\u0001/.test(text)) return m;
      const out = []; let cur = cp; let buf = ''; let i = 0;
      const flush = () => { if (buf) out.push('<hp:run charPrIDRef="' + cur + '"' + attrs + '><hp:t>' + buf + '</hp:t></hp:run>'); buf = ''; };
      while (i < text.length) {
        const ch = text[i];
        if (ch === '\u0001') { const e = text.indexOf('\u0001', i + 1); const n = text.slice(i + 1, e); flush(); cur = variant(cp, n); i = e + 1; continue; }
        if (ch === '\u0002') { flush(); cur = cp; i++; continue; }
        buf += ch; i++;
      }
      flush(); return out.join('');
    }).replace(/[\u0001\u0002]/g, '');
    return { xml, header };
  }
  F.render = async (bytes, ctx, opt = {}) => {
    const entries = await F.unzip(bytes); const report = { missing: new Set(), used: new Set(), errors: [] };
    const dec = new TextDecoder(); const enc = new TextEncoder();
    const hdrEntry = entries.find(e => e.name === 'Contents/header.xml'); let header = hdrEntry ? dec.decode(hdrEntry.data) : null;
    for (const e of entries) {
      if (!/^Contents\/section\d+\.xml$/.test(e.name)) continue;
      const r = F.fillXml(dec.decode(e.data), ctx, opt);
      r.missing.forEach(m => report.missing.add(m)); r.used.forEach(m => report.used.add(m)); report.errors.push(...r.errors);
      const sm = applySmallRuns(r.xml, header); header = sm.header;
      e.data = enc.encode(sm.xml);
    }
    if (hdrEntry && header !== null) hdrEntry.data = enc.encode(header);
    const withImg = opt.images && opt.images.length ? H().addImages(entries, opt.images) : entries;
    return { bytes: F.zip(withImg), missing: [...report.missing], used: [...report.used], errors: report.errors };
  };
  /* 템플릿 안의 자리표시자 목록(값을 바꾸지 않음) */
  F.scan = async (bytes) => {
    const entries = await F.unzip(bytes); const dec = new TextDecoder(); const found = new Map();
    for (const e of entries) {
      if (!/^Contents\/section\d+\.xml$/.test(e.name)) continue;
      const xml = dec.decode(e.data);
      /* 문단마다 run 병합 후 텍스트 수집 */
      const collect = (x) => { ranges(x, 'hp:p').forEach(r => { const px = normalizePara(x.slice(r.s, r.e)); const t = ownText(px); (t.match(/\{\{[^{}]*\}\}|\{%[^{}]*%\}/g) || []).forEach(k => found.set(k, (found.get(k) || 0) + 1)); ranges(px, 'hp:tbl').forEach(tr => { ranges(px.slice(tr.s, tr.e), 'hp:tc').forEach(cr => { const tc = px.slice(tr.s + cr.s, tr.s + cr.e); const sl = tc.match(/<hp:subList[^>]*>([\s\S]*)<\/hp:subList>/); if (sl) collect(sl[1]); }); }); }); };
      collect(xml);
    }
    return [...found.entries()].map(([k, n]) => ({ tag: k, count: n }));
  };
  /* 줄 텍스트 → 줄 유형 목록 ({{% lines %}} 용). 유형: circle(◦) dash(-) star(*) num(①) arrow(⇨) plain */
  F.lines = (text) => String(text || '').replace(/\r/g, '').split('\n').filter(l => l.trim()).map(l => {
    const t = l.trim();
    if (/^◦/.test(t)) return { kind: 'circle', text: t.replace(/^◦\s*/, '') };
    if (/^[-–]/.test(t)) return { kind: 'dash', text: t.replace(/^[-–]\s*/, '') };
    if (/^\*/.test(t)) return { kind: 'star', text: t };
    if (/^[①-⑳]/.test(t)) return { kind: 'num', text: t };
    if (/^⇨/.test(t)) return { kind: 'arrow', text: t };
    return { kind: 'plain', text: t };
  });
  F.resolve = resolve;
  root.HwpxFill = F;
  if (typeof module !== 'undefined') module.exports = F;
})(typeof window !== 'undefined' ? window : globalThis);
