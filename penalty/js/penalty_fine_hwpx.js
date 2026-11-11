/* [과징금 산정] 결과를 **한글(hwpx) 파일**로 만든다.
 *
 * 화면의 결과(`penalty_fine.js`)가 만든 「글 덩어리 목록」을 받아 hwpx 를 낸다. 이 모듈은 과징금을
 * 모른다 — 제목·문단·표만 안다. 그래서 산정 내용이 바뀌어도 여기는 안 고친다.
 *
 *   덩어리  { t: 'title' | 'h1' | 'h2' | 'p' | 'note' | 'gap' , text }
 *           { t: 'table', widths: [비율…], align: ['l'|'c'|'r'…], head: [[칸…]…], rows: [[칸…]…] }
 *   칸      글자 또는 { text, span: 가로로 합칠 칸 수, rowSpan: 세로로 합칠 줄 수, bold: 굵게, fill: 회색 바탕, align }
 *
 * ## 서식은 어디서 오나
 *
 * 글꼴·글자 모양·문단 모양·테두리 정의는 `penalty_fine_hwpx_base.js` 에 담긴 header.xml 이다.
 * 이 모듈은 **그 번호를 그대로** 부른다(번호 표는 그 파일 머리말).
 *
 * ## ⚠️ 한글이 못 여는 파일을 만들지 않는다
 *
 * 탭·제어문자는 지운다(탭이 글 속에 들어가면 한글이 파일을 열다 멈춘 일이 있다 — 안건 쪽 `hwpx.js`).
 * 줄 배치(`linesegarray`)는 쓰지 않는다 — 한글이 열 때 다시 배치한다.
 *
 * 브라우저·node 양쪽에서 돈다. `download()` 만 브라우저 전용이다.
 */
import { HWPX_BASE } from './penalty_fine_hwpx_base.js';
import { REAL_BASE, REAL_STYLE } from './penalty_fine_hwpx_real.js';

/* ── 서식 번호 ──
 * 기본 틀(`penalty_fine_hwpx_base.js`)은 담당부서 별표8 한글 서식에 글자 모양을 몇 개 더한 것이고,
 * `profile: 'real'` 틀(`penalty_fine_hwpx_real.js`)은 **실사례 한글 서식 정의**를 그대로 쓴다(휴먼명조 · 본문 14pt · 표 12~13pt · 머리 칸 연한 파랑).
 * 역할(제목·표 머리·표 칸…)마다 어느 번호를 쓰는지가 두 틀의 유일한 차이다. */
const DEFAULT_PROFILE = {
  base: HWPX_BASE,
  char: { body: 20, bold: 21, title: 22, h2: 23, note: 24, h1: 2, unit: 24, text: 20, cell: { 12: [20, 21, 21], 13: [20, 21, 21] } },   // [본문, 굵게, 머리]
  para: { left: 16, right: 17, center: 14, loose: 18, title: 14, unit: 17, h: 18 },
  border: { plain: 4, shaded: 5 },
};
const REAL_PROFILE = {
  base: REAL_BASE,
  char: { body: REAL_STYLE.char.body, bold: REAL_STYLE.char.cell13b, title: REAL_STYLE.char.title, h2: REAL_STYLE.char.h2, note: REAL_STYLE.char.note, h1: REAL_STYLE.char.h1,
    unit: REAL_STYLE.char.unit, text: REAL_STYLE.char.text,
    cell: { 12: [REAL_STYLE.char.cell12, REAL_STYLE.char.cell12b, REAL_STYLE.char.head12], 13: [REAL_STYLE.char.cell13, REAL_STYLE.char.cell13b, REAL_STYLE.char.head13] } },
  para: { left: REAL_STYLE.para.left, right: REAL_STYLE.para.right, center: REAL_STYLE.para.center, loose: REAL_STYLE.para.left, title: REAL_STYLE.para.title, unit: REAL_STYLE.para.unit, h: REAL_STYLE.para.left },
  border: { plain: REAL_STYLE.border.plain, shaded: REAL_STYLE.border.head },
  rowH: 2009, fontScale: 1.3, lineH: 1750, cellPadX: 141,
  titleBox: { table: 4, cell: 79, para: 222, char: 258 },
  cellLvl: { 1: [363, 444], 2: [238, 60] },
  /* 글 덩어리 역할 → 실사례(5.hwpx) 문단 모양·글자 모양 번호. 역할 이름은 `penalty_fine_report.js` 가 쓴다. */
  roles: {
    h1: [556, 39], sec: [23, 39], bracket: [351, 430], b1: [353, 56], b2: [354, 56], b3: [355, 56],
    cmp: [239, 435], year: [361, 309], unit: [235, 60], unit11: [240, 74], sub: [148, 29], label: [365, 23],
    note: [807, 267], small: [25, 427], detail: [383, 428], lim: [370, 642], gap: [23, 56],
  },
  /* 표 칸 테두리 — 실사례는 바깥 테두리가 굵다(0.4mm). 줄·칸 위치에 맞는 번호를 고른다. */
  edge: (head, top, bottom, left, right) => {
    if (head) return top ? (left ? 81 : right ? 82 : 85) : (right ? 141 : 87);
    if (bottom) return left ? 72 : right ? 84 : 14;
    return left ? 70 : right ? 86 : 4;
  },
};
let S = DEFAULT_PROFILE;
const CHAR = new Proxy({}, { get: (_, k) => S.char[k] });
const PARA = new Proxy({}, { get: (_, k) => S.para[k] });
const BORDER = new Proxy({}, { get: (_, k) => S.border[k] });

/** 본문 폭(HWPUNIT). A4 가로 59528 − 좌우 여백 4251×2. */
const TEXT_WIDTH = 51026;
const ROW_H_DEFAULT = 1800;

/* ── ZIP (무압축) ── */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
const crc32 = (bytes) => {
  let c = -1;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const utf8 = (s) => new TextEncoder().encode(s);
const b64 = (s) => {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

function zip(entries) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const u16 = (v) => [v & 255, (v >> 8) & 255];
  const u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  for (const e of entries) {
    const name = enc.encode(e.name);
    const flag = 0x0800;
    const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(flag), ...u16(e.method), ...u16(0), ...u16(0x21),
      ...u32(e.crc), ...u32(e.csize), ...u32(e.usize), ...u16(name.length), ...u16(0)]);
    parts.push(local, name, e.data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(flag), ...u16(e.method), ...u16(0), ...u16(0x21),
      ...u32(e.crc), ...u32(e.csize), ...u32(e.usize), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset)]), name);
    offset += local.length + name.length + e.data.length;
  }
  const cdStart = offset;
  let cdLen = 0;
  for (const c of central) { parts.push(c); cdLen += c.length; }
  parts.push(new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(cdLen), ...u32(cdStart), ...u16(0)]));
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const stored = (name, text) => {
  const data = utf8(text);
  return { name, method: 0, crc: crc32(data), csize: data.length, usize: data.length, data };
};

/* ── XML 조각 ── */
export const esc = (s) => String(s ?? '')
  .replace(/\t/g, '  ')
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const para = (text, { paraPr, charPr }) =>
  `<hp:p id="0" paraPrIDRef="${paraPr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">`
  + `<hp:run charPrIDRef="${charPr}"><hp:t>${esc(text)}</hp:t></hp:run></hp:p>`;

/** 줄바꿈이 든 글은 문단 여럿으로 나눈다. */
const paras = (text, style) => String(text ?? '').split('\n').map((line) => para(line, style)).join('');

const alignOf = (a) => ({ l: PARA.left, c: PARA.center, r: PARA.right }[a] || PARA.left);

/** 글자 하나의 폭(HWPUNIT) — 10pt 기준으로 한글·전각은 1000, 그 밖은 520 쯤이다. 줄 수를 어림하는 데만 쓴다. */
const charW = (ch) => (ch.charCodeAt(0) > 0x2000 ? 1000 : 520) * (S.fontScale || 1);
const LINE_H_DEFAULT = 1450;
const CELL_PAD = 282;

/** 칸 안의 글이 몇 줄이 될지 어림해 칸 높이를 낸다. 한글이 다시 배치하지만, 안 열어 본 뷰어는 이 높이대로 보여 준다. */
function cellHeight(text, width) {
  const inner = Math.max(width - (S.cellPadX || 510) * 2, 400);
  const LINE_H = S.lineH || LINE_H_DEFAULT;
  let lines = 0;
  for (const part of String(text ?? '').split('\n')) {
    let w = 0;
    for (const ch of part) w += charW(ch);
    lines += Math.max(Math.ceil(w / inner), 1);
  }
  return lines * LINE_H + CELL_PAD;
}

let seq = 0;

function table(block) {
  const widths = block.widths && block.widths.length ? block.widths : [1];
  const sum = widths.reduce((a, b) => a + b, 0);
  const total = Math.round(TEXT_WIDTH * (block.scale || 1));
  const ROW_H = S.rowH || ROW_H_DEFAULT;
  const cols = widths.map((w) => Math.max(Math.round((w / sum) * total), 400));
  cols[cols.length - 1] += total - cols.reduce((a, b) => a + b, 0);
  const aligns = block.align || [];
  const all = [...(block.head || []).map((r) => ({ cells: r, head: true })), ...(block.rows || []).map((r) => ({ cells: r, head: false }))];
  if (!all.length) return '';
  const id = 1852355608 + (seq += 1);
  // 세로로 합친 칸(rowSpan)이 덮은 자리는 아래 줄에서 건너뛴다.
  const covered = new Set();
  const place = all.map((row, r) => {
    let col = 0;
    return row.cells.map((raw) => {
      while (covered.has(`${r},${col}`)) col += 1;
      const c = typeof raw === 'object' && raw !== null ? raw : { text: raw };
      const span = Math.max(Number(c.span) || 1, 1);
      const rowSpan = Math.max(Number(c.rowSpan) || 1, 1);
      for (let dr = 1; dr < rowSpan; dr++) for (let dc = 0; dc < span; dc++) covered.add(`${r + dr},${col + dc}`);
      const cell = { c, col, span, rowSpan, width: cols.slice(col, col + span).reduce((a, b) => a + b, 0) };
      col += span;
      return cell;
    });
  });
  // 줄 수를 어림해 행 높이를 정한다(칸마다 구한 것 가운데 가장 큰 값, 세로로 합친 칸은 줄 수로 나눠 얹는다).
  const heights = all.map(() => ROW_H);
  place.forEach((cells, r) => cells.forEach((p) => {
    heights[r] = Math.max(heights[r], Math.ceil(cellHeight(p.c.text, p.width) / p.rowSpan));
  }));
  let xml = '';
  all.forEach((row, r) => {
    xml += '<hp:tr>';
    for (const p of place[r]) {
      const c = p.c;
      const shaded = row.head || c.fill;
      const bold = row.head || c.bold;
      const align = row.head ? PARA.center : alignOf(c.align || aligns[p.col] || 'l');
      const [fBody, fBold, fHead] = S.char.cell[block.font === 13 ? 13 : 12];
      let cch = row.head ? fHead : bold ? fBold : fBody;
      let cpara = align;
      // 행 이름 칸(lvl 1: 번호 항목 · 2: 하위 항목)은 실사례처럼 왼쪽 들여쓰기 문단 모양을 쓴다.
      if (S.cellLvl && c.lvl && !row.head) { [cpara, cch] = S.cellLvl[c.lvl] || [cpara, cch]; }
      const height = heights.slice(r, r + p.rowSpan).reduce((a, b) => a + b, 0);
      const bfId = S.edge
        ? S.edge(row.head, r === 0, r + p.rowSpan >= all.length, p.col === 0, p.col + p.span >= cols.length)
        : (shaded ? BORDER.shaded : BORDER.plain);
      const fillId = (!row.head && c.fill) ? BORDER.shaded : null;
      xml += `<hp:tc name="" header="${row.head ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${fillId && !S.edge ? fillId : bfId}">`
        + '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">'
        + paras(c.text ?? '', { paraPr: cpara, charPr: cch })
        + '</hp:subList>'
        + `<hp:cellAddr colAddr="${p.col}" rowAddr="${r}"/><hp:cellSpan colSpan="${p.span}" rowSpan="${p.rowSpan}"/>`
        + `<hp:cellSz width="${p.width}" height="${height}"/><hp:cellMargin left="${S.cellPadX || 510}" right="${S.cellPadX || 510}" top="141" bottom="141"/></hp:tc>`;
    }
    xml += '</hp:tr>';
  });
  const holder = block.scale && block.scale < 1 ? PARA.center : PARA.left;
  return `<hp:p id="0" paraPrIDRef="${holder}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${CHAR.body}">`
    + `<hp:tbl id="${id}" zOrder="${seq}" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${all.length}" colCnt="${cols.length}" cellSpacing="0" borderFillIDRef="${BORDER.plain}" noAdjust="0">`
    + `<hp:sz width="${total}" widthRelTo="ABSOLUTE" height="${heights.reduce((a, b) => a + b, 0)}" heightRelTo="ABSOLUTE" protect="0"/>`
    + '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
    + '<hp:outMargin left="141" right="141" top="141" bottom="141"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>'
    + xml + '</hp:tbl><hp:t/></hp:run></hp:p>';
}

/** 실사례의 제목 — 가운데 정렬된 1칸 표(아래 이중선)에 큰 굵은 글씨. */
function titleBox(text) {
  const W = 17576; const H = 2724;
  seq += 1;
  return `<hp:p id="0" paraPrIDRef="${PARA.center}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${CHAR.body}">`
    + `<hp:tbl id="${1852355608 + seq}" zOrder="${seq}" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="1" colCnt="1" cellSpacing="0" borderFillIDRef="${S.titleBox.table}" noAdjust="0">`
    + `<hp:sz width="${W}" widthRelTo="ABSOLUTE" height="${H}" heightRelTo="ABSOLUTE" protect="0"/>`
    + '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
    + '<hp:outMargin left="141" right="141" top="141" bottom="141"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>'
    + `<hp:tr><hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${S.titleBox.cell}">`
    + '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">'
    + para(text, { paraPr: S.titleBox.para, charPr: S.titleBox.char })
    + '</hp:subList>'
    + '<hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/>'
    + `<hp:cellSz width="${W}" height="${H}"/><hp:cellMargin left="510" right="510" top="141" bottom="141"/></hp:tc></hp:tr></hp:tbl><hp:t/></hp:run></hp:p>`;
}

function section(blocks) {
  let body = '';
  for (const b of blocks) {
    if (b.t === 'title' && S.titleBox) body += titleBox(b.text);
    else if (b.t === 'title') body += para(b.text, { paraPr: PARA.title, charPr: CHAR.title });
    else if (b.t === 'h1') body += para(b.text, { paraPr: PARA.loose, charPr: CHAR.h1 });
    else if (b.t === 'h2') body += para(b.text, { paraPr: PARA.loose, charPr: CHAR.h2 });
    else if (b.t === 'unit') body += para(b.text, { paraPr: PARA.unit, charPr: CHAR.unit });
    else if (b.t === 'text') body += paras(b.text, { paraPr: PARA.left, charPr: CHAR.text });
    else if (b.t === 'p') body += paras(b.text, { paraPr: PARA.left, charPr: CHAR.body });
    else if (b.t === 'note') body += paras(b.text, { paraPr: PARA.left, charPr: CHAR.note });
    else if (b.t === 'gap') body += para('', { paraPr: PARA.left, charPr: CHAR.body });
    else if (b.t === 's') {
      const [pp, cc] = (S.roles && S.roles[b.role]) || [PARA.left, CHAR.body];
      body += paras(b.text, { paraPr: pp, charPr: cc });
    }
    else if (b.t === 'table') body += table(b);
  }
  // 첫 문단에 구역 정의(쪽 크기·여백)를 얹는다 — 한글은 이것이 없으면 파일을 열지 않는다.
  const first = body.match(/<hp:p [^>]*>/);
  if (!first) throw new Error('내보낼 내용이 없습니다.');
  const at = first.index + first[0].length;
  const head = `<hp:run charPrIDRef="${CHAR.body}">${S.base.secPr}${S.base.colPr}</hp:run>`;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'
    + `<hs:sec ${S.base.ns}>` + body.slice(0, at) + head + body.slice(at) + '</hs:sec>';
}

function contentHpf(title) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'
    + `<opf:package ${S.base.ns} version="" unique-identifier="" id="">`
    + `<opf:metadata><opf:title>${esc(title)}</opf:title><opf:language>ko</opf:language>`
    + `<opf:meta name="creator" content="text">KAMP</opf:meta><opf:meta name="CreatedDate" content="text">${now}</opf:meta>`
    + `<opf:meta name="ModifiedDate" content="text">${now}</opf:meta></opf:metadata>`
    + '<opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>'
    + '<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>'
    + '<opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest>'
    + '<opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>';
}

/** 덩어리 목록 → hwpx 바이트. */
export function buildHwpx(blocks, { title = '과징금 산정 결과', profile = 'real' } = {}) {
  seq = 0;
  S = profile === 'real' ? REAL_PROFILE : DEFAULT_PROFILE;
  const h = S.base.header;
  const sec = section(blocks);
  const preview = blocks.filter((b) => b.text).map((b) => b.text).join('\r\n').slice(0, 1800);
  return zip([
    stored('mimetype', 'application/hwp+zip'),
    stored('version.xml', HWPX_BASE.version),
    { name: 'Contents/header.xml', method: 8, crc: h.crc, csize: h.csize, usize: h.usize, data: b64(h.b64) },
    stored('Contents/section0.xml', sec),
    stored('Preview/PrvText.txt', preview),
    stored('settings.xml', HWPX_BASE.settings),
    stored('META-INF/container.rdf', HWPX_BASE.rdf),
    stored('Contents/content.hpf', contentHpf(title)),
    stored('META-INF/container.xml', HWPX_BASE.container),
    stored('META-INF/manifest.xml', HWPX_BASE.manifest),
  ]);
}

/** 브라우저에서 파일로 내려받는다. */
export function download(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/hwp+zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
