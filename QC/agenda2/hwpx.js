/* hwpx.js — 원본 hwpx 뼈대(HWPX_TPL)에 슬롯을 채워 hwpx 파일을 만든다.
 *
 * 원칙: 원본 section0.xml 의 고정 문단·표는 그대로 두고(parts), 바뀌는 자리(slot)만
 * 원본에서 뽑은 문단/표 프로토타입(paraPrIDRef·charPrIDRef·borderFillIDRef 그대로)으로
 * 채운다. header.xml(글꼴·문단모양 정의)과 나머지 zip 항목은 원본을 압축된 그대로 옮긴다.
 *
 * 브라우저·Node 양쪽에서 돈다(DOM 을 쓰지 않는다. download() 만 브라우저 전용).
 */
(function (root) {
  const HWPX = {};

  /* ── ZIP ───────────────────────────────────────────────────────── */
  const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
    return t;
  })();
  HWPX.crc32 = (bytes) => { let c = -1; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  HWPX.b64 = (s) => {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
    const bin = atob(s); const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  HWPX.utf8 = (s) => new TextEncoder().encode(s);

  /* entries: [{name, method, crc, csize, usize, data:Uint8Array}] — 압축된 바이트를 그대로 싣는다(재압축 없음) */
  HWPX.zip = (entries) => {
    const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
    const u16 = (v) => [v & 255, (v >> 8) & 255];
    const u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
    for (const e of entries) {
      const name = enc.encode(e.name); const flag = 0x0800;
      const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(flag), ...u16(e.method), ...u16(0), ...u16(0x21), ...u32(e.crc), ...u32(e.csize), ...u32(e.usize), ...u16(name.length), ...u16(0)]);
      parts.push(local, name, e.data);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(flag), ...u16(e.method), ...u16(0), ...u16(0x21), ...u32(e.crc), ...u32(e.csize), ...u32(e.usize), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
      offset += local.length + name.length + e.data.length;
    }
    const cdStart = offset; let cdLen = 0;
    for (const c of central) { parts.push(c); cdLen += c.length; }
    parts.push(new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(cdLen), ...u32(cdStart), ...u16(0)]));
    let total = 0; for (const p of parts) total += p.length;
    const out = new Uint8Array(total); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };

  /* ── XML 조각 ───────────────────────────────────────────────────── */
  /* 탭(0x09)이 <hp:t> 안에 그대로 들어가면 한글이 파일을 열다 멈춘다(실제 사고: 기준서 원문에 붙여 넣은 「⑴ 거래 금액」) → 공백 두 칸. 그 밖의 제어문자(줄바꿈 제외)는 지움 */
  HWPX.esc = (s) => String(s ?? '').replace(/\t/g, '  ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const RUN_RE = /<hp:run charPrIDRef="([^"]*)"><hp:t>\{\{T\}\}<\/hp:t><\/hp:run>/;
  /* ── 글 속 서식 표식(③ 탭 편집기 단추가 넣음, 2026-09-15) ──
     글자: {굵게}…{/굵게} {기울임}…{/기울임} {밑줄}…{/밑줄} {색 #RRGGBB}…{/색} {글꼴 이름}…{/글꼴} {크기 12}…{/크기}
     문단(줄 첫머리): {정렬 왼쪽|가운데|오른쪽|양쪽|배분|나눔} {줄간격 160}
     표식이 없는 글은 예전 그대로(안건 기본 글꼴·크기 유지). 원본 글자·문단 모양을 복제(charVariant/paraVariant)해 바꾼다 */
  const INLINE_RE = /\{(굵게|기울임|밑줄|색|글꼴|크기)(?:\s+([^}]*))?\}|\{\/(굵게|기울임|밑줄|색|글꼴|크기)\}/g;
  const INLINE_TEST = /\{\/?(굵게|기울임|밑줄|색|글꼴|크기)[\s}]/;
  const PARA_TOK_RE = /^\s*((?:\{(?:정렬|줄간격)\s+[^}]*\}\s*)+)/;
  const AL_MAP = { '왼쪽': 'LEFT', '가운데': 'CENTER', '오른쪽': 'RIGHT', '양쪽': 'JUSTIFY', '배분': 'DISTRIBUTE', '나눔': 'DISTRIBUTE_SPACE' };
  HWPX.hasMarkup = (t) => INLINE_TEST.test(String(t || '')) || PARA_TOK_RE.test(String(t || ''));
  HWPX.stripMarkup = (t) => String(t || '').split('\n').map(l => l.replace(PARA_TOK_RE, '').replace(INLINE_RE, '')).join('\n');
  HWPX.splitParaTokens = (ln) => { const m = PARA_TOK_RE.exec(ln); if (!m) return { opt: null, rest: ln }; const opt = {}; for (const t of m[1].matchAll(/\{(정렬|줄간격)\s+([^}]*)\}/g)) { const v = t[2].trim(); if (t[1] === '정렬' && AL_MAP[v]) opt.al = AL_MAP[v]; if (t[1] === '줄간격') { const n = parseFloat(v); if (n > 0) opt.ls = Math.round(n); } } return { opt: Object.keys(opt).length ? opt : null, rest: ln.slice(m[0].length) }; };
  const applyParaTokens = (tpl, xml, opt) => { if (!opt || !tpl || !HWPX.paraVariant) return xml; const pp = /paraPrIDRef="(\d+)"/.exec(xml); const v = pp ? HWPX.paraVariant(tpl, pp[1], opt) : null; return v ? xml.replace(/paraPrIDRef="\d+"/, `paraPrIDRef="${v}"`) : xml; };
  /* 글자 표식이 있는 글 → [{t, st}] (st: b·i·u·col·font·sz) */
  const markupRuns = (t) => {
    const runs = []; const st = { b: 0, i: 0, u: 0, col: [], font: [], sz: [] }; let last = 0;
    const push = (s) => { if (s) runs.push({ t: s, st: { b: st.b > 0, i: st.i > 0, u: st.u > 0, col: st.col[st.col.length - 1], font: st.font[st.font.length - 1], sz: st.sz[st.sz.length - 1] } }); };
    for (const m of t.matchAll(INLINE_RE)) {
      push(t.slice(last, m.index)); last = m.index + m[0].length; const open = m[1], arg = (m[2] || '').trim(), close = m[3];
      if (open === '굵게') st.b++; else if (open === '기울임') st.i++; else if (open === '밑줄') st.u++;
      else if (open === '색') st.col.push(/^#?[0-9a-fA-F]{6}$/.test(arg) ? (arg.startsWith('#') ? arg : '#' + arg).toUpperCase() : undefined);
      else if (open === '글꼴') st.font.push(arg || undefined); else if (open === '크기') st.sz.push(parseFloat(arg) > 0 ? parseFloat(arg) : undefined);
      else if (close === '굵게') st.b = Math.max(0, st.b - 1); else if (close === '기울임') st.i = Math.max(0, st.i - 1); else if (close === '밑줄') st.u = Math.max(0, st.u - 1);
      else if (close === '색') st.col.pop(); else if (close === '글꼴') st.font.pop(); else if (close === '크기') st.sz.pop();
    }
    push(t.slice(last)); return runs;
  };
  const runCp = (tpl, base, s) => {
    if (!(s.b || s.i || s.u || s.col || s.font || s.sz) || !HWPX.charVariant) return base;
    const bc = tpl.styles && tpl.styles.cp[base]; const opt = {};
    if (s.b) opt.bold = true; if (s.i) opt.italic = true; if (s.u) opt.ul = true; if (s.col) opt.col = s.col; if (s.font) opt.font = s.font;
    if (s.sz && bc && bc.sz && s.sz !== bc.sz) opt.dsz = s.sz - bc.sz;
    return HWPX.charVariant(tpl, base, opt) || base;
  };
  /* 문단 텍스트를 프로토타입 run 에 넣는다. 문장 중의 '*'(+숫자) 표식은 윗첨자 글자모양(tpl.sup)으로 분리.
     줄 첫머리의 '*'(각주 줄)는 본문 그대로 둔다. */
  /* 글 한 덩어리(cp 글자 모양) → run XML. 문장 중의 '*'(+숫자) 표식은 윗첨자 글자모양(tpl.sup[cp])으로 분리(줄 첫머리 '*' 각주 표식은 그대로) */
    /* 윗첨자 글자 모양: 서식의 짝(tpl.sup[cp])을 쓴다. 굵게·작게 등으로 **복제한 글자 모양**(charVariant)이나 짝이 없는 글자 모양에서는 짝을 못 찾아
       「분류*1하고」의 *1 이 본문 크기 그대로 나왔다(사용자 지적, 2026-09-29) — 복제의 바탕 글자 모양의 짝 → 같은 크기 글자 모양의 짝 차례로 찾는다 */
  const supOfT = (tpl, id) => { if (!tpl || !tpl.sup) return null; let cur = String(id); const seen = new Set();
      while (!seen.has(cur)) { seen.add(cur); if (tpl.sup[cur]) return tpl.sup[cur]; const v = tpl._cvars ? [...tpl._cvars.values()].find(x => String(x.id) === cur) : null; if (!v) break; cur = String(v.base); }
      const st = tpl.styles && tpl.styles.cp; const me = st && (st[String(id)] || st[cur]); if (!st || !me) return null;
      const k = Object.keys(tpl.sup).find(q => st[q] && st[q].sz === me.sz) || Object.keys(tpl.sup).map(q => [q, Math.abs(((st[q] || {}).sz || 0) - (me.sz || 0))]).sort((x, y) => x[1] - y[1]).map(x => x[0])[0];
      return k ? tpl.sup[k] : null; };
  HWPX.supCp = supOfT;
  const supRuns = (t, cp, tpl) => {
    const sup = supOfT(tpl, cp);
    const base = (s) => `<hp:run charPrIDRef="${cp}"><hp:t>${HWPX.esc(s)}</hp:t></hp:run>`;
    if (!sup || !(/\S.*\*/.test(t) || /\S주\d+\)/.test(t))) return base(t);
    const lead = t.match(/^\s*\*+\d*/); const head = lead ? lead[0] : ''; const rest = t.slice(head.length);
    /* *1 · *1,2 처럼 쉼표로 이어진 번호까지 한 덩어리로 윗첨자. 괄호 안 「(*3)」 처럼 바로 앞이 '(' 이면 본문 그대로 */
    const parts = ['']; let last = 0; /* 「(N/A)주1)」·「(아니오)주2)」처럼 글 바로 뒤에 붙은 「주N)」도 윗첨자(사용자 지정, 2026-09-29 — 조치안 Checklist). 줄 첫머리의 「주1) …」(각주 줄)는 본문 그대로 */
    for (const mm of rest.matchAll(/\*+\d*(?:,\d+)*|(?<=\S)주\d+\)/g)) { if (rest[mm.index - 1] === '(') continue; parts[parts.length - 1] += rest.slice(last, mm.index); parts.push(mm[0], ''); last = mm.index + mm[0].length; } parts[parts.length - 1] += rest.slice(last);
    let runs = base(head + parts[0]);
    for (let i = 1; i < parts.length; i += 2) runs += `<hp:run charPrIDRef="${sup}"><hp:t>${HWPX.esc(parts[i])}</hp:t></hp:run>` + (parts[i + 1] ? base(parts[i + 1]) : '');
    return runs;
  };
  const fillT = (xml, text, tpl) => {
    const t = String(text ?? '');
    const m = xml.match(RUN_RE);
    if (!m) return xml.replace('{{T}}', HWPX.esc(t));
    /* 글자 표식({굵게}…)이 있으면 조각마다 글자 모양 복제 */
    if (tpl && INLINE_TEST.test(t)) { const runs = markupRuns(t).map(r => supRuns(r.t, runCp(tpl, m[1], r.st), tpl)).join(''); return xml.replace(m[0], runs || supRuns('', m[1], tpl)); }
    return xml.replace(m[0], supRuns(t, m[1], tpl));
  };
  const lines = (text) => String(text ?? '').replace(/\r/g, '').split('\n');

  /* ── 내어쓰기(한글 Shift+Tab 효과) ──
     줄 첫머리 표식(앞공백 포함)의 너비만큼 내어쓰기를 둔 문단 모양을 복제해 쓴다. 너비 = Σ(반각 0.5·전각 1 × 장평 + 자간%) × 글자크기(pt).
     복제한 문단 모양은 tpl._hangs 에 모아 두고 hwpx 를 만들 때 header.xml 에 넣는다. 미리보기용 styles.pp 에도 같이 등록 */
  const MARK_RE = /^(\s*)(?:[◦○•·\-–—※□◈◇■⇨⇒→▶▷▪]|\*\d*(?:,\d+)*|[①-⑳㉠-㉭㈀-㈜]|[가-힣]\.|\(\d{1,2}\)|\d{1,2}\)|\d{1,2}\.|[ⅠⅡⅢⅣⅤⅥⅦ]\.)\s+/;
  /* 글자 너비(em): 원본 안건들에서 한글이 Shift+Tab 으로 계산해 둔 내어쓰기 값에 맞춘 근사치 */
  const chEm = (ch) => { const c = ch.charCodeAt(0); if (ch === '.' || ch === ',') return 0.3; if (c >= 0x20 && c <= 0x7e) return 0.5; if ('◦○•·'.includes(ch)) return 1.15; if ('□■◇'.includes(ch)) return 1.4; return 1; };   /* ◦ 1.15 · □ 1.4: 원본 ◦ 문단(2.12em = 공백+◦+공백)과 「□ ㈜국보옵틱스」 문단(14pt, 1.89em = □+공백) 실측 */
  HWPX.markWidthPt = (prefix, cp) => { const sz = cp && cp.sz ? cp.sz : 12, sp = cp && cp.sp ? cp.sp : 0, ra = cp && cp.ra ? cp.ra : 100; let w = 0; for (const ch of prefix) w += chEm(ch) * (ra / 100) * (1 + sp / 100); return w * sz; };
  HWPX.hangId = (tpl, basePP, widthPt, tolPt) => {
    const st = tpl.styles || (tpl.styles = { cp: {}, pp: {} }); const bp = st.pp[basePP]; if (!bp) return null;
    if (bp.al && bp.al !== 'JUSTIFY' && bp.al !== 'LEFT') return null;   /* 가운데·오른쪽 정렬 문단은 그대로 */
    /* 한글 문단 모양: left = 첫 줄 시작 위치, intent(음수) = 내어쓰기 → 다음 줄들은 left + |intent| 에서 시작. 첫 줄 위치(left)는 원본 그대로 두고 내어쓰기만 표식 너비로 맞춘다
       (예전엔 left + intent 를 첫 줄로 잘못 보아, 원본 내어쓰기가 표식 너비와 다른 문단(「-」 위반행위 문단 등)의 첫 줄이 그 차이만큼 오른쪽으로 밀렸다) */
    const left = Math.round((bp.left || 0) * 100), intent = -Math.round(widthPt * 100);
    if (Math.abs(-(bp.intent || 0) - widthPt) <= (tolPt || 0.3)) return null;   /* 원래 모양의 내어쓰기가 계산값과 거의 같으면(저자가 맞춰 둔 값) 그대로 */
    if (-(bp.intent || 0) > widthPt * 2.5 || left < 0) return null;   /* 원래 내어쓰기가 표식 너비와 무관하게 큰 문단(회사 개요 「* 최대주주」 줄 등 자리잡기용)은 건드리지 않는다 — 왼쪽 여백이 음수가 되면 글이 칸 밖으로 잘린다 */
    tpl._hangs = tpl._hangs || new Map(); const key = basePP + '|' + left + '|' + intent; if (tpl._hangs.has(key)) return tpl._hangs.get(key).id;
    const maxId = Math.max(tpl.ppMax || 0, ...Object.keys(st.pp).map(Number).filter(Number.isFinite)); const id = String(maxId + 1);   /* ppMax = header.xml 의 실제 최대 문단 모양 번호(styles.pp 요약에 없는 번호와 겹치지 않게) */
    tpl._hangs.set(key, { id, base: String(basePP), left, intent }); st.pp[id] = Object.assign({}, bp, { left: left / 100, intent: intent / 100 });
    return id;
  };
  /* 문단 모양 변형 복제: 정렬(al)·왼쪽 여백·내어쓰기를 바꾼 문단 모양 번호를 돌려준다(내어쓰기 복제와 같은 _hangs 저장소·header 주입). 바꿀 것이 없으면 null */
  HWPX.paraVariant = (tpl, basePP, opt) => {
    const st = tpl.styles || (tpl.styles = { cp: {}, pp: {} }); const bp = st.pp[basePP]; if (!bp) return null;
    const al = opt.al || bp.al || 'JUSTIFY'; const left = Math.round((opt.left !== undefined ? opt.left : (bp.left || 0)) * 100), intent = Math.round((opt.intent !== undefined ? opt.intent : (bp.intent || 0)) * 100);
    const ls = opt.ls !== undefined ? Number(opt.ls) : (bp.ls || 0);   /* 줄간격(%) 변형 */
    const prev = opt.prev !== undefined ? Math.round(Number(opt.prev) * 100) : null, next = opt.next !== undefined ? Math.round(Number(opt.next) * 100) : null;   /* 문단 앞·뒤 간격(pt) */
    if (al === (bp.al || 'JUSTIFY') && left === Math.round((bp.left || 0) * 100) && intent === Math.round((bp.intent || 0) * 100) && ls === (bp.ls || 0) && prev === null && next === null) return null;
    tpl._hangs = tpl._hangs || new Map(); const key = 'v|' + basePP + '|' + al + '|' + left + '|' + intent + '|' + ls + '|' + (prev === null ? '' : prev) + '|' + (next === null ? '' : next); if (tpl._hangs.has(key)) return tpl._hangs.get(key).id;
    const maxId = Math.max(tpl.ppMax || 0, ...Object.keys(st.pp).map(Number).filter(Number.isFinite)); const id = String(maxId + 1);
    tpl._hangs.set(key, { id, base: String(basePP), left, intent, al, ls: opt.ls !== undefined ? ls : null, prev, next }); st.pp[id] = Object.assign({}, bp, { al, left: left / 100, intent: intent / 100 }, opt.ls !== undefined ? { ls } : {}, prev !== null ? { prev: prev / 100 } : {}, next !== null ? { next: next / 100 } : {});
    return id;
  };
  /* 글자 모양 변형 복제: 크기를 dsz(pt)만큼 바꾼 글자 모양 번호(원본 charPr 을 통째로 복제해 height 만 바꿈, header 주입은 applyHangs) */
  HWPX.charVariant = (tpl, baseCP, opt) => {
    const st = tpl.styles || (tpl.styles = { cp: {}, pp: {} }); const bc = st.cp[baseCP]; if (!bc || !opt || (!opt.dsz && !opt.fontFrom && !opt.bold && !opt.italic && !opt.ul && !opt.col && !opt.font && opt.sp === undefined && opt.ra === undefined)) return null;
    if (opt.bold && bc.b && !opt.dsz && !opt.fontFrom) return null;   /* 이미 굵은 글자 모양 */
    tpl._cvars = tpl._cvars || new Map(); const key = baseCP + '|' + (opt.dsz || 0) + '|' + (opt.fontFrom || '') + '|' + (opt.bold ? 'b' : '') + '|' + (opt.italic ? 'i' : '') + '|' + (opt.ul ? 'u' : '') + '|' + (opt.col || '') + '|' + (opt.font || '') + '|' + (opt.sp === undefined ? '' : opt.sp) + '|' + (opt.ra === undefined ? '' : opt.ra); if (tpl._cvars.has(key)) return tpl._cvars.get(key).id;
    const maxId = Math.max(tpl.cpMax || 0, ...Object.keys(st.cp).map(Number).filter(Number.isFinite), ...[...tpl._cvars.values()].map(v => Number(v.id))); const id = String(maxId + 1);
    const from = opt.fontFrom ? st.cp[opt.fontFrom] : null;
    tpl._cvars.set(key, { id, base: String(baseCP), dsz: opt.dsz || 0, fontFrom: opt.fontFrom ? String(opt.fontFrom) : null, bold: !!opt.bold, italic: !!opt.italic, ul: !!opt.ul, col: opt.col || null, font: opt.font || null, sp: opt.sp === undefined ? null : Math.round(opt.sp), ra: opt.ra === undefined ? null : Math.round(opt.ra) }); st.cp[id] = Object.assign({}, bc, { sz: (bc.sz || 12) + (opt.dsz || 0) }, from && from.f ? { f: from.f } : {}, opt.font ? { f: opt.font } : {}, opt.bold ? { b: true } : {}, opt.italic ? { i: true } : {}, opt.ul ? { u: true } : {}, opt.col ? { col: opt.col } : {}, opt.sp !== undefined ? { sp: Math.round(opt.sp) } : {}, opt.ra !== undefined ? { ra: Math.round(opt.ra) } : {});
    return id;
  };
  /* 문단 XML 하나(줄 하나)에 내어쓰기 적용: 글이 표식으로 시작할 때만 */
  /* 원문자로 시작하지만 **이어지는 글**인 문단(사용자 지정, 2026-09-28): 「① 종속기업이 … 대체하였고, ② 해외 종속기업 … 과소계상함」처럼
     한 문단 안에 다음 원문자(②)가 또 나오면 번호 매긴 항목이 아니라 문장이다 — ① 을 표식으로 보지 않는다(내어쓰기·왼쪽 줄맞춤 없음, 보통 문단 그대로).
     문단마다 원문자가 하나씩인 목록(① … / ② …)은 예전처럼 항목으로 본다. */
  /* 같은 날 뒤에 더함(사용자 지정, 2026-09-29 — 질문서): 원문자로 시작하고 **쉼표로 끝나는** 문단(「① … 회계처리하였으며,」·「② … 과대계상하였고,」)도
     문장이 다음 문단으로 이어지는 글이다 — 한 문장을 줄만 바꿔 적은 것이라 ① 을 기준으로 내어 쓰지 않고 앞뒤 문단(「귀사는 …」·「또한, ③ …」)과 같은 모양으로 둔다.
     쉼표 없이 끝나는 「① 회사개요 및 계약현황」 같은 소제목·항목은 예전처럼 표식 문단이다 */
  HWPX.runOn = (text) => { const t = String(text || ''); if (!/^[\s\u3000]*[①-⑳]/.test(t)) return false; return /[①-⑳]/.test(t.replace(/^[\s\u3000]*[①-⑳]/, '')) || /[,，]\s*$/.test(t); };
  const hangXml = (tpl, xml, text) => {
    if (!tpl || !tpl.styles) return xml; const m = MARK_RE.exec(String(text || '')); if (!m || HWPX.runOn(text)) return xml;
    const pp = /paraPrIDRef="(\d+)"/.exec(xml), cp = /charPrIDRef="(\d+)"/.exec(xml); if (!pp || !cp) return xml;
    const cs = tpl.styles.cp[cp[1]]; const id = HWPX.hangId(tpl, pp[1], HWPX.markWidthPt(m[0], cs), 0.25 * ((cs && cs.sz) || 12)); if (!id) return xml;
    return xml.replace(/paraPrIDRef="\d+"/, `paraPrIDRef="${id}"`);
  };
  /* header.xml 에 복제 문단 모양을 넣는다(itemCnt 갱신) */
  HWPX.applyHangs = (tpl, headerText) => {
    if (!tpl._hangs || !tpl._hangs.size) return headerText; let h = headerText;
    const m = /<hh:paraProperties itemCnt="(\d+)"/.exec(h); if (!m) return h; let cnt = Number(m[1]); let add = '';
    for (const c of tpl._hangs.values()) {
      if (h.includes(`<hh:paraPr id="${c.id}"`)) continue;
      const src = new RegExp('<hh:paraPr id="' + c.base + '"[^>]*>[\\s\\S]*?</hh:paraPr>').exec(h + add); if (!src) continue;   /* 복제의 복제(내어쓰기 문단을 다시 줄간격 변형 등)도 방금 추가한 것에서 찾는다 */
      /* margin 은 hp:case(HwpUnitChar)와 hp:default 두 벌 — 원본은 default 가 case 의 2배 값. 둘 다 써야 한글(2024)이 내어쓰기·여백을 그대로 그린다(2026-09-16) */
      const set2 = (xml, tag, v) => { let n = 0; return xml.replace(new RegExp('(<hc:' + tag + ' value=")-?\\d+(")', 'g'), (m, a, b) => { n++; return a + Math.round(Number(v) * (n === 1 ? 1 : 2)) + b; }); };
      let x = src[0].replace(/<hh:paraPr id="\d+"/, `<hh:paraPr id="${c.id}"`); x = set2(x, 'intent', c.intent); x = set2(x, 'left', c.left);
      if (c.al) x = x.replace(/(<hh:align horizontal=")[^"]*(")/, `$1${c.al}$2`);   /* 정렬까지 바꾼 변형(표 단위 줄 오른쪽 정렬 등) */
      if (c.ls) x = x.replace(/(<hh:lineSpacing type="PERCENT" value=")\d+(")/g, `$1${c.ls}$2`);   /* 줄간격 변형(질문서 160%) */
      if (c.prev !== null && c.prev !== undefined) x = set2(x, 'prev', c.prev);   /* 문단 앞 간격 */
      if (c.next !== null && c.next !== undefined) x = set2(x, 'next', c.next);   /* 문단 뒤 간격 */
      add += x; cnt++;
    }
    h = h.replace(m[0], `<hh:paraProperties itemCnt="${cnt}"`); const e = h.lastIndexOf('</hh:paraProperties>'); return h.slice(0, e) + add + h.slice(e);
  };
  /* header.xml 에 복제 글자 모양을 넣는다(itemCnt 갱신) */
  HWPX.applyCharVariants = (tpl, headerText) => {
    if (!tpl._cvars || !tpl._cvars.size) return headerText; let h = headerText;
    const m = /<hh:charProperties itemCnt="(\d+)"/.exec(h); if (!m) return h; let cnt = Number(m[1]); let add = '';
    /* 글꼴 이름 → 언어별 글꼴 번호. header 글꼴 목록에 없으면 첫 글꼴을 복제해 그 이름으로 추가(fontCnt 갱신) */
    const fontIds = (name) => { const out = {}; for (const lang of ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER']) {
        const fm = new RegExp('<hh:fontface lang="' + lang + '" fontCnt="(\\d+)">([\\s\\S]*?)</hh:fontface>').exec(h); if (!fm) return null;
        const hit = new RegExp('<hh:font id="(\\d+)" face="' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"').exec(fm[2]); if (hit) { out[lang] = hit[1]; continue; }
        const first = /<hh:font [^>]*>[\s\S]*?<\/hh:font>|<hh:font [^>]*\/>/.exec(fm[2]); if (!first) return null; const nid = String(Number(fm[1]));
        const nf = first[0].replace(/<hh:font id="\d+" face="[^"]*"/, `<hh:font id="${nid}" face="${name}"`);
        h = h.replace(fm[0], fm[0].replace(/fontCnt="\d+"/, `fontCnt="${Number(fm[1]) + 1}"`).replace('</hh:fontface>', nf + '</hh:fontface>')); out[lang] = nid; }
      return out; };
    for (const c of tpl._cvars.values()) {
      if (h.includes(`<hh:charPr id="${c.id}"`)) continue;
      const src = new RegExp('<hh:charPr id="' + c.base + '"[^>]*>[\\s\\S]*?</hh:charPr>').exec(h + add); if (!src) continue;   /* 복제의 복제(내어쓰기 문단을 다시 줄간격 변형 등)도 방금 추가한 것에서 찾는다 */
      let x = src[0].replace(/<hh:charPr id="\d+"/, `<hh:charPr id="${c.id}"`).replace(/(<hh:charPr [^>]*height=")(\d+)(")/, (mm, a, hgt, b) => a + Math.max(100, Number(hgt) + Math.round(c.dsz * 100)) + b);
      if (c.bold && !/<hh:bold\/>/.test(x)) x = x.replace(/<hh:underline /, '<hh:bold/><hh:underline ');   /* 굵게 변형(기준서 원문 「문단 NN」) */
      if (c.italic && !/<hh:italic\/>/.test(x)) x = x.replace(/<hh:(bold\/>|underline )/, (mm) => '<hh:italic/>' + mm);   /* 기울임 */
      if (c.ul) x = x.replace(/<hh:underline type="[^"]*"/, '<hh:underline type="BOTTOM"');   /* 밑줄 */
      if (c.col) x = x.replace(/(<hh:charPr [^>]*textColor=")[^"]*(")/, `$1${c.col}$2`);   /* 글자색 */
      if (c.sp !== null && c.sp !== undefined) x = x.replace(/<hh:spacing [^>]*\/>/, `<hh:spacing hangul="${c.sp}" latin="${c.sp}" hanja="${c.sp}" japanese="${c.sp}" other="${c.sp}" symbol="${c.sp}" user="${c.sp}"/>`);   /* 자간(%) */
      if (c.ra !== null && c.ra !== undefined) x = x.replace(/<hh:ratio [^>]*\/>/, `<hh:ratio hangul="${c.ra}" latin="${c.ra}" hanja="${c.ra}" japanese="${c.ra}" other="${c.ra}" symbol="${c.ra}" user="${c.ra}"/>`);   /* 장평(%) */
      if (c.font) { const ids = fontIds(c.font); if (ids) x = x.replace(/<hh:fontRef [^>]*\/>/, `<hh:fontRef hangul="${ids.HANGUL}" latin="${ids.LATIN}" hanja="${ids.HANJA}" japanese="${ids.JAPANESE}" other="${ids.OTHER}" symbol="${ids.SYMBOL}" user="${ids.USER}"/>`); }   /* 글꼴 이름 */
      if (c.fontFrom) { const fs = new RegExp('<hh:charPr id="' + c.fontFrom + '"[^>]*>[\\s\\S]*?</hh:charPr>').exec(h); const fr = fs && /<hh:fontRef [^>]*\/>/.exec(fs[0]); if (fr) x = x.replace(/<hh:fontRef [^>]*\/>/, fr[0]); }   /* 글꼴 참조만 다른 글자 모양에서 복사 */
      add += x; cnt++;
    }
    h = h.replace(m[0], `<hh:charProperties itemCnt="${cnt}"`); const e = h.lastIndexOf('</hh:charProperties>'); return h.slice(0, e) + add + h.slice(e);
  };
  /* ── 표 테두리 굵기 통일(tpl.borders = {inner, outer}) ──
     모든 표의 선 굵기를 inner 로, 격자표(2행×2열 이상이고 바깥 변이 모두 실선)의 가장 바깥 변은 outer 로 맞춘다.
     선 종류(없음·점선·이중선 등)·색·배경은 원본 그대로 두고 굵기만 바꾸며, 필요한 테두리 모양은 원본 것을 통째로 복제해 header.xml 에 추가한다(itemCnt 갱신).
     중첩 표(개요 상자 안의 표)는 안쪽 표부터 처리한다 */
  HWPX.unifyBorders = (tpl, headerText, sectionXml) => {
    sectionXml = String(sectionXml); const B = tpl.borders; if (!B) return { header: headerText, section: sectionXml.replace(/(<hp:tbl\b[^>]*?) flat="1"/g, '$1').replace(/ outerThin="1"/g, '').replace(/(<hp:tbl\b[^>]*?) impact="1"/g, '$1') };
    let h = headerText, s = sectionXml;
    const SIDES = ['left', 'right', 'top', 'bottom']; const bfCache = new Map();
    const bfOf = (id) => { if (!bfCache.has(id)) { const m = new RegExp('<hh:borderFill id="' + id + '"[^>]*>[\\s\\S]*?</hh:borderFill>').exec(h); bfCache.set(id, m ? m[0] : ''); } return bfCache.get(id); };
    const typeOf = (bf, sd) => { const m = new RegExp('<hh:' + sd + 'Border type="([^"]*)"').exec(bf); return m ? m[1] : 'NONE'; };
    const adjustable = (t) => t !== 'NONE' && !/THICK/.test(t);   /* 없음·이중선(SLIM_THICK 등: 제목 밑줄)은 안 바꾼다. 그 밖(실선·점선·파선)은 실선으로 통일 */
    let maxId = Math.max(0, ...[...h.matchAll(/<hh:borderFill id="(\d+)"/g)].map(m => Number(m[1])));
    const cntM = /<hh:borderFills itemCnt="(\d+)"/.exec(h); if (!cntM) return { header: h, section: s };
    let cnt = Number(cntM[1]); let add = ''; const made = new Map();
    /* outer[sd]: 그 변이 표의 가장 바깥 선 → B.outer. force[sd]: 「없음」이지만 한글이 표 바깥선으로 그려 주는 변(왼쪽 열의 왼쪽 등) → 실선 B.outer 로 바꿔 두꺼운 틀을 만든다 */
    /* none[sd]: 그 변을 「없음」으로(좌우 열린 표 — Checklist) */
    const bfFor = (base, outer, force, none, ow) => {
      const src = bfOf(base); if (!src) return base; const OW = ow || B.outer;   /* ow: 이 표의 바깥 선 너비(outerThin 표는 안쪽 선과 같게 0.12mm, 2026-09-15) */
      const plan = SIDES.map(sd => { const t = typeOf(src, sd); if (none && none[sd]) return t === 'NONE' ? null : { type: 'NONE', width: B.inner }; if (t === 'NONE') return force && force[sd] ? { type: 'SOLID', width: OW } : null; return adjustable(t) ? { type: 'SOLID', width: outer[sd] ? OW : B.inner } : null; });   /* 점선·파선 등 그려지는 선은 모두 실선으로 */
      let x = src, changed = false;
      SIDES.forEach((sd, i) => { const p = plan[i]; if (!p) return; x = x.replace(new RegExp('(<hh:' + sd + 'Border type=")([^"]*)(" width=")([^"]*)(")'), (m, a, t, c, w, e) => { const nt = p.type || t; if (w !== p.width || nt !== t) changed = true; return a + nt + c + p.width + e; }); });
      if (!changed) return base;
      const key = base + '|' + plan.map(p => p ? (p.type || '') + p.width : '-').join('|'); if (made.has(key)) return made.get(key);
      const id = String(++maxId); add += x.replace(/<hh:borderFill id="\d+"/, `<hh:borderFill id="${id}"`); cnt++; made.set(key, id); return id;
    };
    const hold = [];
    for (;;) {
      const m = /<hp:tbl (?:(?!<hp:tbl )[\s\S])*?<\/hp:tbl>/.exec(s); if (!m) break;   /* 안에 다른 표가 없는 표 하나(안쪽 표부터) */
      const t = m[0]; const rc = /rowCnt="(\d+)" colCnt="(\d+)"/.exec(t); const R = rc ? Number(rc[1]) : 0, C = rc ? Number(rc[2]) : 0;
      /* 과대(과소)계상 영향 표(impact="1", 2026-09-28)는 칸마다 테두리를 이미 정해 두었다(양옆 없음·위아래 0.4mm) — 굵기 통일을 거치지 않고 표식만 뗀다 */
      if (/ impact="1"/.test(t.slice(0, t.indexOf('>') + 1))) { hold.push(t.replace(/ impact="1"/, '').replace(/ outerThin="1"/, '')); s = s.slice(0, m.index) + '\u0001TBL' + (hold.length - 1) + '\u0001' + s.slice(m.index + t.length); continue; }
      const info = [...t.matchAll(/<hp:tc [^>]*borderFillIDRef="(\d+)"[^>]*>[\s\S]*?<\/hp:tc>/g)].map(c => { const a = /<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"\/><hp:cellSpan colSpan="(\d+)" rowSpan="(\d+)"/.exec(c[0]); if (!a) return null; const col = Number(a[1]), row = Number(a[2]), cs = Number(a[3]), rs = Number(a[4]); const bf = bfOf(c[1]); return { xml: c[0], bf: c[1], x0: col, x1: col + cs, y0: row, y1: row + rs, drawn: SIDES.map(sd => typeOf(bf, sd) !== 'NONE') }; }).filter(Boolean);
      /* 눈에 보이는 가장 바깥 선의 자리: 칸의 선이 하나라도 그려지면 그 칸의 위·왼쪽 좌표를, 아래 선만 있으면(「(단위 : 백만원)」 캡션 줄) 아래 좌표를 경계 후보로 본다.
         안쪽 표를 담는 틀(개요 상자)이나 1행·1열 상자(제목·인용 상자)는 바깥 선을 두껍게 하지 않는다 */
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const i of info) { const [l, r, tp, bt] = i.drawn; if (!(l || r || tp || bt)) continue;
        if (l || tp || bt) { minX = Math.min(minX, i.x0); maxX = Math.max(maxX, i.x0); } if (r) { minX = Math.min(minX, i.x1); maxX = Math.max(maxX, i.x1); }
        if (tp || l || r) { minY = Math.min(minY, i.y0); maxY = Math.max(maxY, i.y0); } if (bt) { minY = Math.min(minY, i.y1); maxY = Math.max(maxY, i.y1); } }
      /* 다른 표(회사와 감사 개요 상자) 안에 든 표는 바깥 선도 0.12mm 그대로(상자 안에서 굵은 틀이 겹치지 않게) */
      const before = s.slice(0, m.index); const nested = (before.match(/<hp:tbl /g) || []).length > (before.match(/<\/hp:tbl>/g) || []).length;
      const openSide = Array.isArray(B.openSides) && B.openSides.some(id => t.startsWith('<hp:tbl id="' + id + '"'));   /* 좌우가 열린 표(Checklist): 바깥 선 두껍게 안 하고 좌우 변은 없음 */
      const flat = / flat="1"/.test(t.slice(0, t.indexOf('>') + 1));   /* 박스와 안쪽 표를 한 표로 합친 것(docgen flattenBoxes) — 박스처럼 다룬다(바깥 선을 굵게 하지 않는다) */
      const grid = R >= 2 && C >= 2 && !t.includes('\u0001TBL') && !nested && !openSide && !flat;
      const thin = / outerThin="1"/.test(t.slice(0, t.indexOf('>') + 1));   /* Ⅱ 지적사항 안 표: 바깥 선도 0.12mm */
      if (B.onlyThin && !thin) { hold.push(t); s = s.slice(0, m.index) + '\u0001TBL' + (hold.length - 1) + '\u0001' + s.slice(m.index + t.length); continue; }   /* 후속서류: 생성 표(outerThin)만 손보고 서식 원본 표는 그대로(2026-09-16) */
      let t2 = thin ? t.replace(/ outerThin="1"/, '') : t; for (const i of info) {
        const [l, r, tp, bt] = i.drawn; const outer = grid ? { left: i.x0 === minX, right: i.x1 === maxX, top: i.y0 === minY, bottom: i.y1 === maxY } : {};
        /* 표의 맨 가장자리 칸인데 그 변이 「없음」이고 양옆 변은 그려진 칸(왼쪽 열 자료 칸 등): 한글이 어차피 가는 선을 그리므로 두꺼운 실선으로 통일. 캡션 줄(위·좌우 없음)은 해당 없음 */
        const force = grid ? { left: i.x0 === 0 && tp && bt, right: i.x1 === C && tp && bt, top: i.y0 === 0 && l && r, bottom: i.y1 === R && l && r } : null;
        const none = openSide ? { left: i.x0 === 0, right: i.x1 === C } : null;
        const nid = bfFor(i.bf, outer, force, none, thin ? B.inner : undefined); if (nid !== i.bf) t2 = t2.replace(i.xml, () => i.xml.replace(/borderFillIDRef="\d+"/, `borderFillIDRef="${nid}"`)); }
      hold.push(t2); s = s.slice(0, m.index) + '\u0001TBL' + (hold.length - 1) + '\u0001' + s.slice(m.index + t.length);
    }
    while (/\u0001TBL\d+\u0001/.test(s)) s = s.replace(/\u0001TBL(\d+)\u0001/g, (m, k) => hold[Number(k)]);
    s = s.replace(/(<hp:tbl\b[^>]*?) flat="1"/g, '$1');
    if (add) { h = h.replace(cntM[0], `<hh:borderFills itemCnt="${cnt}"`); const e = h.lastIndexOf('</hh:borderFills>'); h = h.slice(0, e) + add + h.slice(e); }
    return { header: h, section: s };
  };
  /* header.xml 을 손봐야 하는지(내어쓰기 문단 모양 추가 또는 표 테두리 통일) */
  const needHeader = (tpl) => !!((tpl._hangs && tpl._hangs.size) || (tpl._cvars && tpl._cvars.size) || tpl.borders || tpl._bfNeed || tpl._mergeAdd);
  /* ── 다른 hwpx 의 꼬리(marker 문단부터 끝까지)를 이 서식에 붙이기(조치사전통지서 (첨부) 연동, 2026-09-16) ──
     올린 파일의 글꼴·테두리·글자 모양·탭·번호·문단 모양·스타일을 서식 header 뒤에 덧붙이고(번호는 서식 것 뒤로), 꼬리 문단의 참조 번호를 그에 맞게 바꾼다.
     header 에 실제로 넣는 일은 build 때 applyMerge 가 한다(tpl._mergeAdd). 서식 header 가 압축 안 된 항목이어야 한다(우리 서식은 모두 그렇다) */
  HWPX.headerText = (tpl) => { if (tpl._hdrText !== undefined) return tpl._hdrText; const e = (tpl.zip || []).find(x => x.name === 'Contents/header.xml'); tpl._hdrText = e && e.method === 0 ? new TextDecoder().decode(HWPX.b64(e.b64)) : null; return tpl._hdrText; };
  HWPX.mergeTail = (tpl, hdrA, secA, marker) => {
    const H0 = HWPX.headerText(tpl); if (!H0) throw new Error('서식 header.xml 을 읽을 수 없습니다');
    const st = tpl.styles || (tpl.styles = { cp: {}, pp: {} });
    const cntOf = (h, list) => { const m = new RegExp('<hh:' + list + ' itemCnt="(\\d+)"').exec(h); return m ? Number(m[1]) : 0; };
    const listBody = (h, list) => { const m = new RegExp('<hh:' + list + ' itemCnt="\\d+">([\\s\\S]*?)</hh:' + list + '>').exec(h); return m ? m[1] : ''; };
    const maxIdIn = (h, item) => Math.max(-1, ...[...h.matchAll(new RegExp('<hh:' + item + ' id="(\\d+)"', 'g'))].map(m => Number(m[1])));
    const usedMax = (keys, vars, base) => Math.max(base, ...keys.map(Number).filter(Number.isFinite), ...(vars ? [...vars.values()].map(v => Number(v.id)) : []));
    const ppOff = usedMax(Object.keys(st.pp), tpl._hangs, Math.max(maxIdIn(H0, 'paraPr'), tpl.ppMax || 0)) + 1;
    const cpOff = usedMax(Object.keys(st.cp), tpl._cvars, Math.max(maxIdIn(H0, 'charPr'), tpl.cpMax || 0)) + 1;
    const bfOff = Math.max(0, maxIdIn(H0, 'borderFill'));   /* 테두리 번호는 1부터 → 새 번호 = 옛 번호 + 서식 최대번호 */
    const tpOff = cntOf(H0, 'tabProperties'), nbOff = Math.max(0, maxIdIn(H0, 'numbering')), stOff = cntOf(H0, 'styles');
    const LANGS = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER']; const fontOff = {}, fonts = {};
    LANGS.forEach(L => { const m0 = new RegExp('<hh:fontface lang="' + L + '" fontCnt="(\\d+)"').exec(H0); fontOff[L] = m0 ? Number(m0[1]) : 0;
      const mA = new RegExp('<hh:fontface lang="' + L + '" fontCnt="\\d+">([\\s\\S]*?)</hh:fontface>').exec(hdrA); fonts[L] = mA ? mA[1].replace(/<hh:font id="(\d+)"/g, (m, id) => `<hh:font id="${Number(id) + fontOff[L]}"`) : ''; });
    const borderFills = listBody(hdrA, 'borderFills').replace(/<hh:borderFill id="(\d+)"/g, (m, id) => `<hh:borderFill id="${Number(id) + bfOff}"`);
    const charPrs = listBody(hdrA, 'charProperties').replace(/<hh:charPr id="(\d+)"/g, (m, id) => `<hh:charPr id="${Number(id) + cpOff}"`).replace(/borderFillIDRef="(\d+)"/g, (m, id) => `borderFillIDRef="${Number(id) + bfOff}"`)
      .replace(/<hh:fontRef ([^/]*)\/>/g, (m, attrs) => '<hh:fontRef ' + attrs.replace(/(\w+)="(\d+)"/g, (mm, k, v) => `${k}="${Number(v) + (fontOff[k.toUpperCase()] || 0)}"`) + '/>');
    const tabPrs = listBody(hdrA, 'tabProperties').replace(/<hh:tabPr id="(\d+)"/g, (m, id) => `<hh:tabPr id="${Number(id) + tpOff}"`);
    const numberings = listBody(hdrA, 'numberings').replace(/<hh:numbering id="(\d+)"/g, (m, id) => `<hh:numbering id="${Number(id) + nbOff}"`).replace(/charPrIDRef="(\d+)"/g, (m, id) => `charPrIDRef="${Number(id) + cpOff}"`);
    const paraPrs = listBody(hdrA, 'paraProperties').replace(/<hh:paraPr id="(\d+)"/g, (m, id) => `<hh:paraPr id="${Number(id) + ppOff}"`).replace(/tabPrIDRef="(\d+)"/g, (m, id) => `tabPrIDRef="${Number(id) + tpOff}"`).replace(/(<hh:heading type="NUMBER"[^>]*idRef=")(\d+)(")/g, (m, a, id, b) => a + (Number(id) + nbOff) + b);
    const styles = listBody(hdrA, 'styles').replace(/<hh:style id="(\d+)"/g, (m, id) => `<hh:style id="${Number(id) + stOff}"`).replace(/paraPrIDRef="(\d+)"/g, (m, id) => `paraPrIDRef="${Number(id) + ppOff}"`).replace(/charPrIDRef="(\d+)"/g, (m, id) => `charPrIDRef="${Number(id) + cpOff}"`).replace(/nextStyleIDRef="(\d+)"/g, (m, id) => `nextStyleIDRef="${Number(id) + stOff}"`);
    const i = secA.indexOf(marker); if (i < 0) throw new Error('올린 파일에서 「' + marker + '」 문단을 찾지 못했습니다');
    const a = secA.lastIndexOf('<hp:p ', i); const end = secA.lastIndexOf('</hs:sec>'); let tail = secA.slice(a, end > a ? end : undefined);
    tail = tail.replace(/<hp:ctrl>(?:<hp:secPr[\s\S]*?<\/hp:secPr>|<hp:colPr[^>]*\/>|<hp:colPr[\s\S]*?<\/hp:colPr>)+<\/hp:ctrl>/g, '');   /* 쪽 설정은 서식 것을 쓴다 */
    /* 변경 추적 표식: 지운 글(deleteBegin…deleteEnd, 한 run 안)은 빼고, 넣은 글은 표식만 떼어 살린다. run 을 넘나드는 지움 표식은 표식만 뗀다 */
    tail = tail.replace(/<hp:deleteBegin [^>]*\/>((?:(?!<hp:run|<\/hp:p>|<hp:deleteBegin)[\s\S])*?)<hp:deleteEnd [^>]*\/>/g, '').replace(/<hp:(?:insertBegin|insertEnd|deleteBegin|deleteEnd) [^>]*\/>/g, '').replace(/ (?:paraTcId|TcId|charTcId|tcId)="[^"]*"/g, '');
    tail = tail.replace(/charPrIDRef="(\d+)"/g, (m, id) => `charPrIDRef="${Number(id) + cpOff}"`).replace(/paraPrIDRef="(\d+)"/g, (m, id) => `paraPrIDRef="${Number(id) + ppOff}"`).replace(/borderFillIDRef="(\d+)"/g, (m, id) => `borderFillIDRef="${Number(id) + bfOff}"`).replace(/styleIDRef="(\d+)"/g, (m, id) => `styleIDRef="${Number(id) + stOff}"`);
    tpl._mergeAdd = { fonts, borderFills, charPrs, tabPrs, numberings, paraPrs, styles };
    const nPP = (paraPrs.match(/<hh:paraPr id=/g) || []).length, nCP = (charPrs.match(/<hh:charPr id=/g) || []).length;
    tpl.ppMax = Math.max(tpl.ppMax || 0, ppOff + nPP - 1); tpl.cpMax = Math.max(tpl.cpMax || 0, cpOff + nCP - 1);   /* 뒤에 만드는 변형 모양이 겹치지 않게 */
    return tail;
  };
  HWPX.applyMerge = (tpl, headerText) => {
    const A = tpl._mergeAdd; if (!A) return headerText; let h = headerText; const ITEM = { borderFills: 'borderFill', charProperties: 'charPr', tabProperties: 'tabPr', numberings: 'numbering', paraProperties: 'paraPr', styles: 'style' };
    const addList = (list, body) => { if (!body) return; const m = new RegExp('<hh:' + list + ' itemCnt="(\\d+)"').exec(h); if (!m) return; const n = Number(m[1]) + (body.match(new RegExp('<hh:' + ITEM[list] + ' id=', 'g')) || []).length; h = h.replace(m[0], `<hh:${list} itemCnt="${n}"`); const e = h.lastIndexOf('</hh:' + list + '>'); h = h.slice(0, e) + body + h.slice(e); };
    Object.entries(A.fonts || {}).forEach(([L, body]) => { if (!body) return; const m = new RegExp('<hh:fontface lang="' + L + '" fontCnt="(\\d+)">').exec(h); if (!m) return; const n = Number(m[1]) + (body.match(/<hh:font id=/g) || []).length; const start = h.indexOf(m[0]); const e = h.indexOf('</hh:fontface>', start); h = h.slice(0, start) + `<hh:fontface lang="${L}" fontCnt="${n}">` + h.slice(start + m[0].length, e) + body + h.slice(e); });
    ['borderFills', 'charProperties', 'tabProperties', 'numberings', 'paraProperties', 'styles'].forEach(list => addList(list, A[{ borderFills: 'borderFills', charProperties: 'charPrs', tabProperties: 'tabPrs', numberings: 'numberings', paraProperties: 'paraPrs', styles: 'styles' }[list]]));
    return h;
  };
  /* header.xml 글과 section xml 을 함께 마무리: 표 테두리 통일 → 내어쓰기 문단 모양 추가 */
  /* ── 테두리/배경 변형: 칸의 borderFillIDRef 에 "v:기본번호:배경색:s" 자리표시를 두면 build 때 기본 테두리/배경을 복제해 배경색·사방 실선(0.12mm)을 넣고 실제 번호로 바꾼다(참고 박스 제목 칸, 레보메드 원본 bf60) ── */
  /* 테두리 변형 자리표시. `sides`(2026-09-18): 사방(`solid`)이 아니라 **한두 변만** 실선으로 — 't'·'b'·'l'·'r' 를 이어 적는다
     (예: 't' = 윗변만). 한 칸짜리 참고 박스의 윗변을 막는 데 쓴다. 자리표시 형식은 뒤에 칸을 하나 더한 것뿐이라 예전 넷은 그대로다. */
  /* `none`·`thick`(2026-09-28): 지정한 변을 「없음」으로(none) / 검정 실선 0.4mm 로(thick) — 과대(과소)계상 영향 표(양옆이 열리고 위아래가 굵은 표)에 쓴다.
     자리표시 뒤에 칸을 둘 더한 것뿐이라 예전 자리표시는 그대로다. */
  HWPX.bfRef = (base, opt) => `v:${base}:${(opt && opt.fill) || ''}:${opt && opt.solid ? 's' : ''}:${(opt && opt.sides) || ''}` + (opt && (opt.none || opt.thick || opt.norm) ? `:${opt.none || ''}:${opt.thick || ''}:${opt.norm ? 'n' : ''}` : '');   /* norm: 그려지는 나머지 변을 모두 검정 실선 0.12mm 로 */
  HWPX.applyBfVariants = (headerText, sectionXml) => {
    let h = headerText, s = sectionXml; const keys = [...new Set([...s.matchAll(/borderFillIDRef="(v:[^"]*)"/g)].map(m => m[1]))]; if (!keys.length) return { header: h, section: s };
    const m = /<hh:borderFills itemCnt="(\d+)"/.exec(h); if (!m) return { header: h, section: s };
    let cnt = Number(m[1]); let maxId = Math.max(0, ...[...h.matchAll(/<hh:borderFill id="(\d+)"/g)].map(x => Number(x[1]))); let add = '';
    for (const k of keys) {
      const [, base, fill, solid, sides, none, thick, norm] = k.split(':'); const src = new RegExp('<hh:borderFill id="' + base + '"[^>]*>[\\s\\S]*?</hh:borderFill>').exec(h); if (!src) { s = s.split(`borderFillIDRef="${k}"`).join(`borderFillIDRef="${base}"`); continue; }
      const id = String(++maxId); let x = src[0].replace(/<hh:borderFill id="\d+"/, `<hh:borderFill id="${id}"`);
      if (solid) for (const sd of ['left', 'right', 'top', 'bottom']) x = x.replace(new RegExp('<hh:' + sd + 'Border type="[^"]*" width="[^"]*"'), `<hh:${sd}Border type="SOLID" width="0.12 mm"`);
      /* 지정한 변만 검정 실선 0.12mm 로. 색도 함께 박는다 — 서식 원본의 「없음」 변은 색이 흰색이거나 비어 있을 수 있어, 선을 그려도 안 보인다. */
      if (sides) for (const [ch, sd] of [['t', 'top'], ['b', 'bottom'], ['l', 'left'], ['r', 'right']]) if (sides.includes(ch)) {
        x = x.replace(new RegExp('<hh:' + sd + 'Border type="[^"]*" width="[^"]*"'), `<hh:${sd}Border type="SOLID" width="0.12 mm"`);
        x = x.replace(new RegExp('(<hh:' + sd + 'Border [^>]*?)color="[^"]*"'), '$1color="#000000"');
      }
      for (const [ch, sd] of [['t', 'top'], ['b', 'bottom'], ['l', 'left'], ['r', 'right']]) {
        if (norm && !(thick && thick.includes(ch)) && !(none && none.includes(ch))) x = x.replace(new RegExp('<hh:' + sd + 'Border type="[^"]*" width="[^"]*" color="[^"]*"'), `<hh:${sd}Border type="SOLID" width="0.12 mm" color="#000000"`);   /* 서식에서 「없음」이던 변도(제목 칸의 왼쪽 등) 그린다 — 없애는 변은 none 으로만 정한다 */
        if (thick && thick.includes(ch)) { x = x.replace(new RegExp('<hh:' + sd + 'Border type="[^"]*" width="[^"]*"'), `<hh:${sd}Border type="SOLID" width="0.4 mm"`); x = x.replace(new RegExp('(<hh:' + sd + 'Border [^>]*?)color="[^"]*"'), '$1color="#000000"'); }
        if (none && none.includes(ch)) x = x.replace(new RegExp('<hh:' + sd + 'Border type="[^"]*"'), `<hh:${sd}Border type="NONE"`);
      }
      if (fill) { const brush = `<hc:fillBrush><hc:winBrush faceColor="${fill}" hatchColor="#000000" alpha="0"/></hc:fillBrush>`; x = /<hc:fillBrush>/.test(x) ? x.replace(/<hc:fillBrush>[\s\S]*?<\/hc:fillBrush>/, brush) : x.replace('</hh:borderFill>', brush + '</hh:borderFill>'); }
      add += x; cnt++; s = s.split(`borderFillIDRef="${k}"`).join(`borderFillIDRef="${id}"`);
    }
    h = h.replace(m[0], `<hh:borderFills itemCnt="${cnt}"`); const e = h.lastIndexOf('</hh:borderFills>'); h = h.slice(0, e) + add + h.slice(e);
    return { header: h, section: s };
  };
  /* 번호 = 자리(2026-09-16): 한글은 paraPr·charPr·borderFill 을 목록의 순서로 찾으므로 번호에 빈틈이 있으면(변형을 403·445 처럼 붙였을 때) 엉뚱한 모양이 그려진다.
     목록을 0부터 빈틈없이 다시 매기고, header(스타일·글자 모양의 테두리 참조 등)와 section 의 참조를 함께 바꾼다 */
  HWPX.compactIds = (headerText, sectionXml) => {
    let h = headerText, s = sectionXml;
    for (const [list, item, ref, base] of [['paraProperties', 'paraPr', 'paraPrIDRef', 0], ['charProperties', 'charPr', 'charPrIDRef', 0], ['borderFills', 'borderFill', 'borderFillIDRef', 1]]) {   /* 테두리/배경 번호는 1부터(HWPX 규약) */
      const m = new RegExp('<hh:' + list + ' itemCnt="(\\d+)">([\\s\\S]*?)</hh:' + list + '>').exec(h); if (!m) continue;
      const ids = [...m[2].matchAll(new RegExp('<hh:' + item + ' id="(\\d+)"', 'g'))].map(x => x[1]);
      if (ids.every((id, i) => Number(id) === i + base) && Number(m[1]) === ids.length) continue;
      const map = new Map(ids.map((id, i) => [id, String(i + base)]));
      const body = m[2].replace(new RegExp('(<hh:' + item + ' id=")(\\d+)(")', 'g'), (x, a, id, b) => a + (map.has(id) ? map.get(id) : id) + b);
      h = h.replace(m[0], () => `<hh:${list} itemCnt="${ids.length}">` + body + `</hh:${list}>`);
      const re = new RegExp('(' + ref + '=")(\\d+)(")', 'g'); const fix = (t) => t.replace(re, (x, a, id, b) => a + (map.has(id) ? map.get(id) : id) + b);
      h = fix(h); s = fix(s);
    }
    return { header: h, section: s };
  };
  const finishHeader = (tpl, headerText, sectionXml) => { const b = HWPX.applyBfVariants(HWPX.applyMerge(tpl, headerText), sectionXml); const u = HWPX.unifyBorders(tpl, b.header, b.section); return HWPX.compactIds(HWPX.applyCharVariants(tpl, HWPX.applyHangs(tpl, u.header)), u.section); };

  /* 문단: proto[role] 의 서식으로 text 를 넣는다. '\n' 은 문단 나눔. lead 는 원본 앞공백 수 */
  /* 한 문단을 여러 run 으로(segs = [{t, bold}]). bold 는 tpl.bold[기본 charPr] 이 있을 때만 굵게 */
  HWPX.paraSegs = (tpl, role, segs, opt = {}) => {
    const pr = tpl.proto[role]; if (!pr) throw new Error('문단 프로토타입 없음: ' + role);
    const m = pr.xml.match(RUN_RE); if (!m) return HWPX.para(tpl, role, segs.map(s => s.t).join(''), opt);
    const base = m[1]; const bold = tpl.bold && tpl.bold[base]; const plain = tpl.plain && tpl.plain[base];   /* plain: 굵은 기본 글자모양의 굵기 없는 복제 */
    const lead = opt.lead !== undefined ? opt.lead : pr.lead;
    /* 조각마다 각주 표식(*1)을 윗첨자로 뗀다(supRuns) — 굵은 머리말이 있는 문단(「◦ (회사 및 종속회사의 회계처리) … 분류*1하고」)은 이 길로 만들어지는데
       표식을 떼지 않아 *1 이 본문 크기 그대로 나왔다(사용자 지적, 2026-09-29). 첫 조각의 줄 첫머리 「*」(각주 줄)는 그대로 둔다 */
    const runs = segs.map((s, i) => { const cp = s.bold && bold ? bold : s.plain && plain ? plain : base; const t = (i === 0 ? ' '.repeat(lead || 0) : '') + s.t; return i === 0 ? supRuns(t, cp, tpl) : supRuns('\u200b' + t, cp, tpl).replace('\u200b', ''); }).join('');
    return hangXml(tpl, pr.xml.replace(m[0], runs), ' '.repeat(lead || 0) + segs.map(s => s.t).join(''));
  };
  HWPX.para = (tpl, role, text, opt = {}) => {
    const pr = tpl.proto[role];
    if (!pr) throw new Error('문단 프로토타입 없음: ' + role);
    const lead = opt.lead !== undefined ? opt.lead : pr.lead;
    return lines(text).map((ln, i) => {
      let x = pr.xml;
      if (opt.pageBreak && i === 0) x = x.replace('pageBreak="0"', 'pageBreak="1"');
      const pt = HWPX.splitParaTokens(ln); x = applyParaTokens(tpl, x, pt.opt);   /* {정렬 …}·{줄간격 …} → 문단 모양 복제 */
      const full = pt.rest.trim() === '' ? '' : ' '.repeat(lead) + pt.rest; return hangXml(tpl, fillT(x, full, tpl), HWPX.stripMarkup(full));
    }).join('');
  };
  /* 여러 (role,text) 를 이어 붙인다: [['h2','가. …'],['sq','□ 사실관계'],…] */
  HWPX.paras = (tpl, list) => list.map(([role, text, opt]) => HWPX.para(tpl, role, text, opt)).join('');

  /* 표 셀 안 문단 */
  const cellParas = (tpl, cp, cell) => {
    if (cell.xml !== undefined) return /<hp:p[ >]/.test(cell.xml) ? cell.xml : cp.p.replace('{{T}}', '');   /* 문단이 하나도 없는 칸은 한글이 열지 못한다(질문서 인용 칸이 비었을 때 실제 사고) → 빈 문단 하나 */
    const lead = cell.lead !== undefined ? cell.lead : cp.lead;
    return lines(cell.t).map((ln) => fillT(cp.p, ln.trim() === '' ? '' : ' '.repeat(lead) + ln, tpl)).join('');
  };

  /* 표 프로토타입에 textPt 가 있으면 칸 글자 크기를 그 pt 로 맞춘다(원본 글자 모양을 복제해 크기만 바꿈 — charVariant) */
  const sizeCellParas = (tpl, tp, xml) => {
    if (!tp.textPt || !tpl.styles || !HWPX.charVariant) return xml;
    return xml.replace(/charPrIDRef="(\d+)"/g, (m, id) => { const st = tpl.styles.cp[id]; if (!st || !st.sz || st.sz === tp.textPt) return m; const v = HWPX.charVariant(tpl, id, { dsz: tp.textPt - st.sz }); return v ? `charPrIDRef="${v}"` : m; });
  };
  /* 표 프로토타입에 thFontFrom(글자 모양 번호)이 있으면 머리글 칸(role th)의 글꼴만 그 글자 모양의 글꼴로(크기·굵게 등은 그대로) */
  const thFontParas = (tpl, tp, cell, xml) => {
    if (!tp.thFontFrom || (cell.role || 'td') !== 'th' || !HWPX.charVariant) return xml;
    return xml.replace(/charPrIDRef="(\d+)"/g, (m, id) => { if (id === String(tp.thFontFrom)) return m; const v = HWPX.charVariant(tpl, id, { fontFrom: tp.thFontFrom }); return v ? `charPrIDRef="${v}"` : m; });
  };
  /* 표 프로토타입에 cellAlign({역할: 'LEFT'|'CENTER'|'RIGHT'})이 있으면 그 역할 칸 문단의 정렬을 바꾼다(문단 모양 복제) */
  const alignCellParas = (tpl, tp, cell, xml) => {
    const al = tp.cellAlign && tp.cellAlign[cell.role || 'td']; if (!al || !HWPX.paraVariant) return xml;
    return xml.replace(/paraPrIDRef="(\d+)"/g, (m, id) => { const v = HWPX.paraVariant(tpl, id, { al }); return v ? `paraPrIDRef="${v}"` : m; });
  };
  let tblSeq = 1;
  /* 표 본체(<hp:tbl>). spec = {cols:[너비…] | ncols, rowH, rows:[[{t|xml, role, cs, rs, lead}…]…]} */
  HWPX.tableXml = (tpl, tname, spec) => {
    const tp = tpl.tproto[tname];
    if (!tp) throw new Error('표 프로토타입 없음: ' + tname);
    let cols = spec.cols;
    if (!cols) { const n = spec.ncols || Math.max(...spec.rows.map(r => r.reduce((a, c) => a + (c.cs || 1), 0))); cols = Array.from({ length: n }, () => Math.floor(tp.w / n)); }
    /* 행 높이: 숫자(전체 동일) 또는 행별 배열 */
    const rowHOf = (r) => Array.isArray(spec.rowH) ? (spec.rowH[r] || 1400) : (spec.rowH || 1400);
    const occ = []; const rowsXml = [];
    spec.rows.forEach((row, r) => {
      let c = 0; const cells = []; occ[r] = occ[r] || [];
      for (const cell of row) {
        while (occ[r][c]) c++;
        const cs = cell.cs || 1, rs = cell.rs || 1;
        for (let i = 0; i < rs; i++) { occ[r + i] = occ[r + i] || []; for (let j = 0; j < cs; j++) occ[r + i][c + j] = true; }
        const w = cols.slice(c, c + cs).reduce((a, b) => a + b, 0);
        let h = 0; for (let i = 0; i < rs; i++) h += rowHOf(r + i);
        const cp = tp.cells[cell.role || 'td'] || tp.cells.td || Object.values(tp.cells)[0];
        let x = cp.tc.replace('{{PARAS}}', alignCellParas(tpl, tp, cell, thFontParas(tpl, tp, cell, sizeCellParas(tpl, tp, cellParas(tpl, cp, cell))))).replace('{{COL}}', String(c)).replace('{{ROW}}', String(r))
          .replace('{{CS}}', String(cs)).replace('{{RS}}', String(rs)).replace('{{W}}', String(w)).replace('{{H}}', String(h));
        if (cell.bf) x = x.replace(/borderFillIDRef="[^"]*"/, `borderFillIDRef="${cell.bf}"`);   /* 테두리/배경 변형 자리표시(HWPX.bfRef) — build 때 실제 번호로 */
        cells.push(x); c += cs;
      }
      rowsXml.push('<hp:tr>' + cells.join('') + '</hp:tr>');
    });
    const R = spec.rows.length, C = cols.length;
    let totalH = 0; for (let r = 0; r < R; r++) totalH += rowHOf(r);
    let x = tp.shell.replace('{{R}}', String(R)).replace('{{C}}', String(C)).replace('{{H}}', String(totalH)).replace('{{ROWS}}', rowsXml.join(''));
    x = x.replace(/<hp:tbl id="[^"]*"/, `<hp:tbl id="${1700000000 + tblSeq}"`).replace(/zOrder="-?\d+"/, `zOrder="${tblSeq}"`);
    tblSeq++;
    return x;
  };
  /* 표를 담은 문단(원본에서 표를 감싸던 문단 서식) */
  HWPX.table = (tpl, tname, spec) => tpl.tproto[tname].wrap.replace('{{TBL}}', HWPX.tableXml(tpl, tname, spec)).replace(/horzOffset="(\d+)"/g, (m, v) => Number(v) > 2147483647 ? 'horzOffset="0"' : m);   /* 음수가 부호 없는 수로 저장된 가로 위치(4294965737 = -1559)는 0으로 — 칸 밖으로 밀리던 표(2026-09-16) */
  /* 문단 xml 의 linesegarray 앞에 표 run 을 끼워 넣는다(제안이유 문단 안의 박스처럼 글과 표가 한 문단일 때) */
  HWPX.paraWithTable = (tpl, role, text, tname, spec) => {
    const p = HWPX.para(tpl, role, text);
    const tp = tpl.tproto[tname];
    const cp = (tp.wrap.match(/charPrIDRef="([^"]*)"/) || [, '0'])[1];
    return p.replace('<hp:linesegarray>', `<hp:run charPrIDRef="${cp}">${HWPX.tableXml(tpl, tname, spec)}</hp:run><hp:linesegarray>`);
  };
  /* 균등 분할 너비 */
  HWPX.splitCols = (total, weights) => { const s = weights.reduce((a, b) => a + b, 0); return weights.map(w => Math.round(total * w / s)); };

  /* ── 문서 조립 ─────────────────────────────────────────────────── */
  /* fills: {slot명: xml, 'CELL:이름': xml, 치환키: 값} */
  HWPX.section = (tpl, fills) => {
    let body = '';
    for (const part of tpl.parts) {
      if (part.slot !== undefined) { body += fills[part.slot] ?? ''; continue; }
      let x = part.xml;
      x = x.replace(/\{\{CELL:([^}]+)\}\}/g, (m, n) => fills['CELL:' + n] ?? '');
      x = x.replace(/\{\{([^}:]+)\}\}/g, (m, k) => HWPX.esc(fills[k] ?? ''));
      body += x;
    }
    const m = body.match(/<hp:p [^>]*>/);
    if (m) { const i = m.index + m[0].length; body = body.slice(0, i) + tpl.openRuns + body.slice(i); }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + tpl.sec + body + '</hs:sec>';
  };
  HWPX.build = (tpl, sectionXml) => {
    const entries = [];
    let hdr = null;   /* 손본 header.xml 글(내어쓰기·표 테두리) */
    if (needHeader(tpl)) {
      const e = tpl.zip.find(x => x.name === 'Contents/header.xml');
      if (e) { let raw = HWPX.b64(e.b64); if (e.method !== 0) { if (typeof require === 'function') raw = new Uint8Array(require('zlib').inflateRawSync(Buffer.from(raw))); else throw new Error('내어쓰기 문단 모양·표 테두리를 넣으려면 buildAsync 로 만들어야 합니다'); }
        const f = finishHeader(tpl, new TextDecoder().decode(raw), sectionXml); hdr = f.header; sectionXml = f.section; }
    }
    /* 자체 점검(hwpx_check.js): 한글이 못 열거나 멈추는 문제가 있으면 파일을 만들지 않는다 */
    if (HWPX.repairTables) { const rp = HWPX.repairTables(sectionXml); sectionXml = rp.xml; }   /* 표 빈자리 메우기(hwpx_check.js) — 못 여는 파일을 만들지 않되, 고칠 수 있는 것은 고쳐서 만든다 */
    if (HWPX.assertOk) { let ht = hdr; if (ht === null) { const e = tpl.zip.find(x => x.name === 'Contents/header.xml'); if (e && e.method === 0) ht = new TextDecoder().decode(HWPX.b64(e.b64)); } HWPX.assertOk(ht || '', sectionXml); }
    const data = HWPX.utf8(sectionXml);
    const sec = { name: 'Contents/section0.xml', method: 0, data, crc: HWPX.crc32(data), csize: data.length, usize: data.length };
    let inserted = false;
    for (const e of tpl.zip) {
      if (e.name === 'Contents/header.xml' && hdr !== null) {
        const hd = HWPX.utf8(hdr); entries.push({ name: e.name, method: 0, crc: HWPX.crc32(hd), csize: hd.length, usize: hd.length, data: hd });
      } else entries.push({ name: e.name, method: e.method, crc: e.crc, csize: e.csize, usize: e.usize, data: HWPX.b64(e.b64) });
      if (e.name === 'Contents/header.xml' && !inserted) { entries.push(sec); inserted = true; }
    }
    if (!inserted) entries.push(sec);
    return HWPX.zip(entries);
  };
  /* ── 그림 ──
     img: {id, data(dataURL), w, h(px)} → 문단 안 글자처럼 놓이는 그림(treatAsChar=1). 픽셀→HWPUNIT 은 96dpi 기준 75배, 본문 폭(46000)에 맞춰 줄인다 */
  HWPX.picPara = (tpl, role, img, seq) => {
    const maxW = 46000; let w = Math.max(1, Math.round((img.w || 600) * 75)), h = Math.max(1, Math.round((img.h || 300) * 75));
    if (img.dispW > 0 && img.w > 0) { const sc = img.dispW / img.w; w = Math.max(1, Math.round(img.w * sc * 75)); h = Math.max(1, Math.round((img.h || 300) * sc * 75)); }   /* 편집기에서 끌어 정한 너비(px) */
    if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
    const pr = tpl.proto[role]; const cp = (pr.xml.match(/charPrIDRef="([^"]*)"/) || [, '0'])[1]; const id = 1800000000 + seq;
    const pic = `<hp:pic id="${id}" zOrder="${900 + seq}" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${id}" reverse="0"><hp:offset x="0" y="0"/><hp:orgSz width="${w}" height="${h}"/><hp:curSz width="${w}" height="${h}"/><hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="${w >> 1}" centerY="${h >> 1}" rotateimage="1"/><hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo><hc:img binaryItemIDRef="${img.id}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${w}" y="0"/><hc:pt2 x="${w}" y="${h}"/><hc:pt3 x="0" y="${h}"/></hp:imgRect><hp:imgClip left="0" right="${w}" top="0" bottom="${h}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="${w}" dimheight="${h}"/><hp:effects/><hp:sz width="${w}" widthRelTo="ABSOLUTE" height="${h}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:pic>`;
    let x = pr.xml.replace(RUN_RE, `<hp:run charPrIDRef="${cp}">${pic}</hp:run>`);
    /* 줄배치는 지운다 — 한글이 열 때 다시 배치한다(남겨 두면 그림이 앞 문단 위에 겹쳐 그려졌다) */
    x = x.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '');
    return x;
  };
  /* 한글 개체(묶음 그림 <hp:container>) 를 그대로 담은 문단(2026-09-30 — 기타 문서에서 불러온 묶음 그림). xml 은 개체 XML 그대로 */
  HWPX.objPara = (tpl, role, xml) => { const pr = tpl.proto[role]; const cp = (pr.xml.match(/charPrIDRef="([^"]*)"/) || [, '0'])[1]; let x = pr.xml.replace(RUN_RE, `<hp:run charPrIDRef="${cp}">${xml}</hp:run>`); return x.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, ''); };
  const dataUrlBytes = (u) => { const m = String(u).match(/^data:([^;,]+)?(;base64)?,(.*)$/s); if (!m) return { mime: 'application/octet-stream', bytes: new Uint8Array() }; return { mime: m[1] || 'application/octet-stream', bytes: m[2] ? HWPX.b64(m[3]) : HWPX.utf8(decodeURIComponent(m[3])) }; };
  const extOf = (mime) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/webp': 'webp', 'image/x-emf': 'emf', 'image/emf': 'emf', 'image/x-wmf': 'wmf', 'image/wmf': 'wmf', 'image/tiff': 'tif' }[mime] || 'png');
  HWPX.inflateRaw = async (bytes) => {
    if (typeof require === 'function') { try { return new Uint8Array(require('zlib').inflateRawSync(Buffer.from(bytes))); } catch (e) { /* */ } }
    const ds = new DecompressionStream('deflate-raw'); const w = ds.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  };
  /* zip(hwpx) 읽기: 중앙 디렉터리로 항목을 찾아 {name → Uint8Array} 로 푼다(method 0/8) */
  HWPX.unzip = async (bytes) => {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('zip 끝 표식을 찾지 못함');
    const n = dv.getUint16(eocd + 10, true); let off = dv.getUint32(eocd + 16, true); const out = {}; const dec = new TextDecoder();
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true), nlen = dv.getUint16(off + 28, true), xlen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true), lho = dv.getUint32(off + 42, true);
      const name = dec.decode(u8.subarray(off + 46, off + 46 + nlen));
      const lnl = dv.getUint16(lho + 26, true), lxl = dv.getUint16(lho + 28, true); const start = lho + 30 + lnl + lxl;
      const raw = u8.subarray(start, start + csize);
      out[name] = method === 0 ? raw : method === 8 ? await HWPX.inflateRaw(raw) : raw;
      off += 46 + nlen + xlen + clen;
    }
    return out;
  };
  /* content.hpf 목록에 그림 항목을 넣고 BinData 파일을 더한다(entries 는 {name, data(무압축)}) */
  HWPX.addImages = (entries, images) => {
    if (!images || !images.length) return entries;
    const dec = new TextDecoder(); const enc = new TextEncoder(); const out = [];
    for (const e of entries) {
      if (e.name === 'Contents/content.hpf') {
        let hpf = dec.decode(e.data);
        const items = images.map(im => { const { mime } = dataUrlBytes(im.data); return `<opf:item id="${im.id}" href="BinData/${im.id}.${extOf(mime)}" media-type="${mime}" isEmbeded="1"/>`; }).join('');
        hpf = hpf.replace('</opf:manifest>', items + '</opf:manifest>');
        out.push({ name: e.name, data: enc.encode(hpf) });
      } else out.push(e);
    }
    images.forEach(im => { const { mime, bytes } = dataUrlBytes(im.data); out.push({ name: `BinData/${im.id}.${extOf(mime)}`, data: bytes }); });
    return out;
  };
  const storedZip = (entries) => HWPX.zip(entries.map(e => ({ name: e.name, method: 0, crc: HWPX.crc32(e.data), csize: e.data.length, usize: e.data.length, data: e.data })));
  /* 그림이 있을 때: 원본 zip 항목을 모두 풀어 무압축으로 다시 묶는다 */
  HWPX.buildAsync = async (tpl, sectionXml, images) => {
    const needHang = needHeader(tpl) && tpl.zip.some(e => e.name === 'Contents/header.xml' && e.method !== 0);
    if ((!images || !images.length) && !needHang) return HWPX.build(tpl, sectionXml);
    const entries = []; let hdrText = '';
    for (const e of tpl.zip) { const raw = HWPX.b64(e.b64); let data = e.method === 0 ? raw : await HWPX.inflateRaw(raw); if (e.name === 'Contents/header.xml') { const f = finishHeader(tpl, new TextDecoder().decode(data), sectionXml); data = HWPX.utf8(f.header); sectionXml = f.section; hdrText = f.header; } entries.push({ name: e.name, data }); if (e.name === 'Contents/header.xml') entries.push({ name: 'Contents/section0.xml', data: HWPX.utf8(sectionXml) }); }
    if (HWPX.repairTables) { const rp = HWPX.repairTables(sectionXml); sectionXml = rp.xml; }
    if (HWPX.assertOk) HWPX.assertOk(hdrText, sectionXml);   /* 자체 점검(hwpx_check.js) — 문제가 있으면 파일을 만들지 않는다 */
    if (!entries.some(e => e.name === 'Contents/section0.xml')) entries.push({ name: 'Contents/section0.xml', data: HWPX.utf8(sectionXml) });
    return storedZip(HWPX.addImages(entries, images).sort((a, b) => (a.name === 'mimetype' ? -1 : b.name === 'mimetype' ? 1 : 0)));
  };
  /* 감사인이 감사반이면 Checklist 표의 말을 바꾼다(사용자 지정, 2026-10-07): 감사인→감사반 · 담당이사→주책임자 · 회계법인→감사반.
     「확인사항」과 「해당 여부」가 든 표(Checklist) **안의 글 노드만** 건드린다 — 산출근거 머리·주2) 비교표의 「감사인 중요성」은 그대로.
     서식(hwpx)·뼈대 두 길 모두 만든 뒤 이것을 거치므로, 관리자가 서식을 바꿔도 말 바꿈은 저절로 따라간다. */
  const SWAP_TEAM = [[/감사인/g, '감사반'], [/담당이사/g, '주책임자'], [/회계법인/g, '감사반']];
  HWPX.auditorWordSwap = (xml, kind) => {
    if (kind !== 'team' || !xml) return xml;
    return String(xml).replace(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g, (tbl) => {
      const plain = tbl.replace(/<[^>]+>/g, '');
      if (!/확인사항/.test(plain) || !/해당\s*여부/.test(plain)) return tbl;
      return tbl.replace(/(<hp:t\b[^>]*>)([\s\S]*?)(<\/hp:t>)/g, (m, a, t, b) => a + SWAP_TEAM.reduce((s, [re, to]) => s.replace(re, to), t) + b);
    });
  };
  /* ── 서식 덧씌움(overlay) — 뼈대가 만든 문서 위에 관리자 서식의 「표 제목행 색」과 「바뀐 고정 문구」만 얹는다(사용자 지정, 2026-10-07) ──
     지적사항 본문·표·각주는 뼈대(검증된 생성기) 그대로. overlay = { tableHeaderFill: '#FAFABF', textChanges: [{ from, to }, …] }
     · from/to 는 자리표시자가 든 문단 글(관리 화면이 지금 서식과 새 서식을 견줘 뽑는다). from 의 {{값}} 은 묶음( )이 되어 뼈대 문단의 실제 값을 받고, to 의 같은 {{값}} 자리에 그 값이 들어간다.
     · 제목행 색은 **이미 칠이 있는** 제목행 칸에만 바꿔 넣는다(머리글 표처럼 칠 없는 표는 그대로). */
  const TX_TAG = /\{\{[^{}]*\}\}|\{%[^%{}]*%\}/g;
  const txPieces = (xml) => { const out = []; let pos = 0; const re = /<hp:t\b[^>]*>([\s\S]*?)<\/hp:t>/g; let m;
    while ((m = re.exec(xml))) { const inner = m[1]; const base = m.index + m[0].length - 7 - inner.length; const pr = /<[^>]+>|[^<]+/g; let q;
      while ((q = pr.exec(inner))) { if (q[0][0] === '<') continue; out.push({ xs: base + q.index, xe: base + q.index + q[0].length, ts: pos, te: pos + q[0].length, text: q[0] }); pos += q[0].length; } }
    return out; };
  const txRaw = (xml) => txPieces(xml).map(q => q.text).join('');
  const txSplice = (xml, pieces, ts, te, repl) => { const edits = []; let put = false;
    for (const q of pieces) { const hit = q.ts <= ts && ts <= q.te && !put; const a = Math.max(ts, q.ts), b = Math.min(te, q.te); if (!hit && a >= b) continue;
      const xa = q.xs + (Math.max(Math.min(a, q.te), q.ts) - q.ts), xb = q.xs + (Math.max(Math.min(b, q.te), q.ts) - q.ts);
      edits.push({ xa: hit ? q.xs + (ts - q.ts) : xa, xb: Math.max(xb, hit ? q.xs + (ts - q.ts) : xa), text: hit ? repl : '' }); if (hit) put = true; }
    edits.sort((u, v) => v.xa - u.xa); let out = xml; for (const e of edits) out = out.slice(0, e.xa) + e.text + out.slice(e.xb); return out; };
  const txEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const txLit = (t) => t.split(/\s+/).map(txEsc).join('\\s*');
  const txPattern = (from) => { const tags = from.match(TX_TAG) || []; const parts = from.split(TX_TAG); let body = ''; let skip = false;
    for (let k = 0; k < tags.length; k++) { body += skip ? '' : txLit(parts[k] || ''); skip = false; const nl = parts[k + 1] || ''; const adj = k + 1 < tags.length && /^\s*$/.test(nl);
      body += adj ? '(\\S*?)' : '([\\s\\S]*?)'; if (adj) { body += nl ? '\\s+' : ''; skip = true; } }
    body += skip ? '' : txLit(parts[tags.length] || '');
    try { return { tags, re: new RegExp('^\\s*' + body + '\\s*$', 'd') }; } catch (e) { return null; } };
  HWPX.tx = { pieces: txPieces, raw: txRaw, splice: txSplice, pattern: txPattern, TAG: TX_TAG };
  /* 문단 하나에 글 바꿈 적용 — 맞으면 바뀐 XML, 아니면 null */
  const txApply = (pxml, ch) => { const pat = ch._pat || (ch._pat = txPattern(ch.from)); if (!pat) return null;
    const nt = txRaw(pxml); const m = pat.re.exec(nt); if (!m) return null;
    const vals = {}; pat.tags.forEach((t, k) => { vals[t] = m[k + 1] || ''; });
    const toTags = ch.to.match(TX_TAG) || [], toParts = ch.to.split(TX_TAG); let out = '';
    for (let k = 0; k < toParts.length; k++) { out += toParts[k]; if (k < toTags.length) out += (vals[toTags[k]] !== undefined ? vals[toTags[k]] : ''); }
    out = out.replace(/^\s+/, (s) => s).trim() === nt.trim() ? null : out; if (out === null) return null;
    return txSplice(pxml, txPieces(pxml), 0, nt.length, out); };
  /* 서식 파일에서 「칠이 있는 제목행」의 첫 칸 색 — {{@표}} 견본 표가 있으면 그것, 없으면 첫 표. 없으면 '' */
  HWPX.headerFillOf = async (bytes) => {
    const z = await HWPX.unzip(bytes); const dec = new TextDecoder(); const header = z['Contents/header.xml'] ? dec.decode(z['Contents/header.xml']) : '';
    const fillOf = (id) => { const m = new RegExp('<hh:borderFill id="' + id + '"[\\s\\S]*?</hh:borderFill>').exec(header); const c = m && /faceColor="(#[0-9A-Fa-f]{6})"/.exec(m[0]); return c ? c[1].toUpperCase() : ''; };
    const secs = Object.keys(z).filter(n => /^Contents\/section\d+\.xml$/.test(n)).sort().map(n => dec.decode(z[n])).join('');
    const tbls = secs.match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g) || []; const order = tbls.filter(t => /\{\{@\s*표/.test(t)).concat(tbls);
    for (const t of order) { const tr = (t.match(/<hp:tr\b[\s\S]*?<\/hp:tr>/) || [''])[0]; for (const m of tr.matchAll(/<hp:tc\b[^>]*borderFillIDRef="(\d+)"/g)) { const c = fillOf(m[1]); if (c && c !== '#FFFFFF') return c; } }
    return '';
  };
  /* ov.inserts = [{ after: <앞 문단 글(자리표시자 포함)>, xml: <새 문단 XML(서식 파일의 모양 번호)> }] — 조치안 「추가된 문단」(사용자 지정, 2026-10-07).
     opts.srcHeader = 새 문단이 쓰는 서식 파일의 header.xml(모양을 뼈대 header 에 합쳐 번호를 다시 매긴다, hwpx_graft.js). 최상위 문단 뒤에만 끼운다(표 칸 안 X) */
  HWPX.applyOverlay = async (bytes, ov, opts) => {
    if (!ov || (!ov.tableHeaderFill && !(ov.textChanges || []).length && !(ov.inserts || []).length)) return bytes;
    const z = await HWPX.unzip(bytes); const dec = new TextDecoder(), enc = new TextEncoder();
    let header = z['Contents/header.xml'] ? dec.decode(z['Contents/header.xml']) : null; const made = new Map(); const stat = { text: 0, fills: 0, inserts: 0 };
    let M = null; if ((ov.inserts || []).length && header && opts && opts.srcHeader && HWPX.mergeHeaders) { const r = HWPX.mergeHeaders(header, opts.srcHeader); header = r.hdr; M = r.M; }
    const recolor = (id) => { if (!header) return id; if (made.has(id)) return made.get(id);
      const m = new RegExp('<hh:borderFill id="' + id + '"[\\s\\S]*?</hh:borderFill>').exec(header); if (!m) return id;
      if (!/<hc:fillBrush>/.test(m[0])) return id;   /* 칠이 없는 칸은 그대로 */
      const ids = [...header.matchAll(/<hh:borderFill id="(\d+)"/g)].map(x => Number(x[1])); const nid = String(Math.max(...ids) + 1);
      const clone = m[0].replace(/id="\d+"/, 'id="' + nid + '"').replace(/faceColor="[^"]*"/, 'faceColor="' + ov.tableHeaderFill + '"');
      header = header.replace('</hh:borderFills>', clone + '</hh:borderFills>').replace(/<hh:borderFills itemCnt="(\d+)"/, (mm, c) => '<hh:borderFills itemCnt="' + (Number(c) + 1) + '"');
      made.set(id, nid); stat.fills++; return nid; };
    for (const n of Object.keys(z)) {
      if (!/^Contents\/section\d+\.xml$/.test(n)) continue; let xml = dec.decode(z[n]);
      if ((ov.inserts || []).length && M && HWPX.topParas) {   /* 앞 문단(최상위)을 찾아 그 뒤에 — 문구 바꿈보다 먼저(앞 문단 글은 바꾸기 전 글), 같은 자리는 차례대로 */
        const tops = HWPX.topParas(xml); const byAt = new Map();
        for (const ins of ov.inserts) { const pat = txPattern(ins.after || ''); if (!pat || !ins.xml) continue;
          const hit = tops.find(p => pat.re.test(txRaw(p.xml))); if (!hit) continue; byAt.set(hit.end, (byAt.get(hit.end) || '') + HWPX.remapPara(ins.xml, M)); stat.inserts++; }
        [...byAt.keys()].sort((a, b) => b - a).forEach(at => { xml = xml.slice(0, at) + byAt.get(at) + xml.slice(at); });
      }
      if ((ov.textChanges || []).length) {   /* 안쪽에 문단을 품지 않은 문단마다(표 칸 안 문단 포함) */
        xml = xml.replace(/<hp:p\b[^>]*>(?:(?!<hp:p\b)[\s\S])*?<\/hp:p>/g, (p) => { for (const ch of ov.textChanges) { const r = txApply(p, ch); if (r) { stat.text++; return r; } } return p; });
      }
      if (ov.tableHeaderFill) xml = xml.replace(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g, (tbl) => { const trs = tbl.match(/<hp:tr\b[\s\S]*?<\/hp:tr>/g) || []; if (trs.length < 2) return tbl;
        const first = trs[0].replace(/(<hp:tc\b[^>]*borderFillIDRef=")(\d+)(")/g, (m, a, id, b) => a + recolor(id) + b); return tbl.replace(trs[0], first); });
      z[n] = enc.encode(xml);
    }
    if (header !== null) z['Contents/header.xml'] = enc.encode(header);
    const out = HWPX.zip(Object.keys(z).map(nm => ({ name: nm, method: 0, crc: HWPX.crc32(z[nm]), csize: z[nm].length, usize: z[nm].length, data: z[nm] })));
    out.overlayStat = stat; return out;
  };
  HWPX.download = (bytes, filename) => {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    /* 주소는 **넉넉히 뒤에** 거둔다(사용자 지적, 2026-09-29 — 5종을 한꺼번에 받으면 폴더에 「미확인 ….crdownload」가 남았다): 브라우저가 「여러 파일을
       내려받도록 허용할까요?」를 묻거나 파일을 검사하는 동안 4초가 지나 주소가 사라지면, 받던 파일이 끝나지 못하고 임시 파일로 남는다. 2분 뒤에 거둔다 */
    setTimeout(() => URL.revokeObjectURL(a.href), 120000);
  };

  /* 불러오기 전 검사(사용자 지정 2026-10-08) — 「안건에서 불러오기」는 변경 추적이 없는 hwpx 에서만.
   *  · .hwp(옛 형식) → 멈춤 「한글 다른이름저장(hwpx파일)로 저장한 hwpx파일을 이용해주세요」
   *  · 변경 추적(수정 기록)이 남아 있음 → 멈춤 「한글파일에 있는 추적기능을 없앤 최종문서를 이용해주세요」(지운 글까지 함께 읽힌다)
   *  · 메모는 허용 — 읽을 때 HWPX.stripMemos 로 메모 글을 빼므로 본문에 섞이지 않는다
   * 결과 { ok, kinds, message, memos } */
  HWPX.MSG_HWP = '한글 다른이름저장(hwpx파일)로 저장한 hwpx파일을 이용해주세요';
  HWPX.MSG_TRACK = '한글파일에 있는 추적기능을 없앤 최종문서를 이용해주세요';
  HWPX.finalCheck = async function (bytes, name) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const isOle = u8.length > 8 && u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0;
    if (isOle || /\.hwp$/i.test(name || '')) return { ok: false, kinds: ['hwp'], message: HWPX.MSG_HWP };
    if (!(u8[0] === 0x50 && u8[1] === 0x4B)) return { ok: false, kinds: ['bad'], message: `hwpx 문서가 아닙니다. ${HWPX.MSG_HWP}` };
    let z; try { z = await HWPX.unzip(u8); } catch (e) { return { ok: false, kinds: ['bad'], message: `파일을 열지 못했습니다(${e.message || e}). ${HWPX.MSG_HWP}` }; }
    const dec = new TextDecoder(); const read = (n) => (z[n] ? dec.decode(z[n]) : '');
    const secs = Object.keys(z).filter(n => /^Contents\/section\d+\.xml$/.test(n)).map(read).join('');
    const header = read('Contents/header.xml');
    const tracks = (secs.match(/<hp:(?:insertBegin|deleteBegin)\b/g) || []).length;
    const trackItems = Number((/<hh:trackChanges\b[^>]*itemCnt="(\d+)"/.exec(header) || [])[1] || 0) || (header.match(/<hh:trackChange\b/g) || []).length;
    const memos = (secs.match(/<hp:fieldBegin\b[^>]*type="MEMO"/g) || []).length;
    if (tracks || trackItems) return { ok: false, kinds: ['track'], message: HWPX.MSG_TRACK, memos };
    return { ok: true, kinds: memos ? ['memo'] : [], message: '', memos };
  };
  /* 메모 글 빼기 — <hp:fieldBegin type="MEMO"> … </hp:fieldBegin>(메모 본문 subList 포함)를 지운다. 본문 글·표는 그대로 */
  HWPX.stripMemos = function (xml) {
    return String(xml).replace(/<hp:fieldBegin\b[^>]*type="MEMO"[^>]*\/>/g, '').replace(/<hp:fieldBegin\b[^>]*type="MEMO"[\s\S]*?<\/hp:fieldBegin>/g, '');
  };
  /* 간단한 안내창(닫기·ESC) — 안건·후속서류 두 화면 공통 */
  HWPX.notice = function (title, message) {
    if (typeof document === 'undefined') return;
    document.getElementById('hwpxNotice')?.remove();
    const d = document.createElement('dialog'); d.id = 'hwpxNotice';
    d.style.cssText = 'max-width:520px;border:0;border-radius:12px;padding:18px 20px 14px;box-shadow:0 18px 40px rgba(0,0,0,.25);font-size:14px;line-height:1.6;color:#1e293b';
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    d.innerHTML = `<form method="dialog"><b style="display:block;color:#b42318;margin-bottom:8px">${esc(title)}</b><div style="white-space:pre-wrap">${esc(message)}</div><div style="text-align:right;margin-top:12px"><button value="ok" style="font-size:13px;padding:6px 16px;border-radius:8px;border:1px solid #0d5ba8;background:#0d5ba8;color:#fff;cursor:pointer" autofocus>닫기</button></div></form>`;
    document.body.append(d); d.addEventListener('close', () => d.remove(), { once: true });
    if (d.showModal) d.showModal(); else alert(`${title}\n\n${message}`);
  };

  root.HWPX = HWPX;
  if (typeof module !== 'undefined') module.exports = HWPX;
})(typeof window !== 'undefined' ? window : globalThis);
