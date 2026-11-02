// 외부 라이브러리 없는 최소 xlsx 쓰기·읽기. 자료를 브라우저 밖으로 보내지 않기 위해 직접 구현했다.
const enc = new TextEncoder();
const xmlEsc = (s) => String(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (c) => { let s = ""; for (; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + (c - 1) % 26) + s; return s; };

// ── zip (무압축 저장) ─────────────────────────────
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(files) {
  const le = (n, size) => { const a = []; for (let i = 0; i < size; i++) a.push((n >>> (8 * i)) & 255); return a; };
  const chunks = [], central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nm = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const common = [...le(20, 2), ...le(0x0800, 2), ...le(0, 2), ...le(0, 2), ...le(0x5a21, 2), ...le(crc, 4), ...le(data.length, 4), ...le(data.length, 4), ...le(nm.length, 2), ...le(0, 2)];
    const head = Uint8Array.from([...le(0x04034b50, 4), ...common]);
    central.push(Uint8Array.from([...le(0x02014b50, 4), ...le(20, 2), ...common, ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 4), ...le(offset, 4)]), nm);
    chunks.push(head, nm, data);
    offset += head.length + nm.length + data.length;
  }
  const cdSize = central.reduce((a, x) => a + x.length, 0);
  const end = Uint8Array.from([...le(0x06054b50, 4), ...le(0, 2), ...le(0, 2), ...le(files.length, 2), ...le(files.length, 2), ...le(cdSize, 4), ...le(offset, 4), ...le(0, 2)]);
  return new Blob([...chunks, ...central, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// ── 통합문서 ─────────────────────────────────────
class Book {
  constructor() {
    this.sheets = [];
    this.fonts = []; this.fills = ["none", "gray125"]; this.borders = []; this.xfs = [];
    this.style({});
  }
  idx(list, v) { let i = list.indexOf(v); if (i < 0) { list.push(v); i = list.length - 1; } return i; }
  // {bold,color,size,under,fill,align,fmt,box,top}
  style(o) {
    const font = `<font>${o.bold ? "<b/>" : ""}${o.under ? "<u/>" : ""}<sz val="${o.size || 10}"/><color rgb="FF${o.color || "000000"}"/><name val="맑은 고딕"/><family val="2"/></font>`;
    const line = (tag, on) => on ? `<${tag} style="thin"><color rgb="FFBFBFBF"/></${tag}>` : `<${tag}/>`;
    const top = o.top ? `<top style="medium"><color rgb="FF404040"/></top>` : line("top", o.box);
    const border = `<border>${line("left", o.box)}${line("right", o.box)}${top}${line("bottom", o.box)}<diagonal/></border>`;
    const fontId = this.idx(this.fonts, font), borderId = this.idx(this.borders, border);
    const fillId = o.fill ? this.idx(this.fills, o.fill) : 0, numFmtId = o.fmt ? 164 : 0;
    const xf = `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${o.align || "center"}" vertical="center"/></xf>`;
    return this.idx(this.xfs, xf);
  }
  addSheet(name) { const s = new BookSheet(this, name); this.sheets.push(s); return s; }
  stylesXml() {
    const fills = this.fills.map((f) => f === "none" || f === "gray125" ? `<fill><patternFill patternType="${f}"/></fill>`
      : `<fill><patternFill patternType="solid"><fgColor rgb="FF${f}"/><bgColor indexed="64"/></patternFill></fill>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + `<numFmts count="1"><numFmt numFmtId="164" formatCode="${xmlEsc('#,##0;(#,##0);"-"')}"/></numFmts>`
      + `<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts><fills count="${this.fills.length}">${fills}</fills>`
      + `<borders count="${this.borders.length}">${this.borders.join("")}</borders>`
      + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
      + `<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>`
      + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
  toBlob() {
    const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main", rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const head = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
    const n = this.sheets.length;
    const files = [
      ["[Content_Types].xml", `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${this.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
      ["_rels/.rels", `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ["xl/workbook.xml", `${head}<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets>${this.sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`],
      ["xl/_rels/workbook.xml.rels", `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${this.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${n + 1}" Type="${rel}/styles" Target="styles.xml"/></Relationships>`],
      ["xl/styles.xml", this.stylesXml()],
      ...this.sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, s.toXml(ns)]),
    ];
    return zipStore(files);
  }
}

class BookSheet {
  constructor(book, name) { Object.assign(this, { book, name, cells: new Map(), merges: [], widths: {}, links: [], landscape: false, heights: {} }); }
  set(r, c, v, opt = {}) {
    if (!this.cells.has(r)) this.cells.set(r, new Map());
    this.cells.get(r).set(c, [v, this.book.style(opt)]);
  }
  merge(r, c1, c2) { this.merges.push(`${colName(c1)}${r}:${colName(c2)}${r}`); }
  toXml(ns) {
    const rows = [...this.cells.keys()].sort((a, b) => a - b).map((r) => {
      const cs = [...this.cells.get(r).keys()].sort((a, b) => a - b).map((c) => {
        const [v, s] = this.cells.get(r).get(c), ref = `${colName(c)}${r}`;
        if (v === null || v === undefined || v === "") return `<c r="${ref}" s="${s}"/>`;
        if (typeof v === "number") return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
        return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
      }).join("");
      return `<row r="${r}"${this.heights[r] ? ` ht="${this.heights[r]}" customHeight="1"` : ""}>${cs}</row>`;
    }).join("");
    const cols = Object.keys(this.widths).map(Number).sort((a, b) => a - b).map((c) => `<col min="${c}" max="${c}" width="${this.widths[c]}" customWidth="1"/>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`
      + `<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="16.5"/>`
      + (cols ? `<cols>${cols}</cols>` : "") + `<sheetData>${rows}</sheetData>`
      + (this.merges.length ? `<mergeCells count="${this.merges.length}">${this.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "")
      + (this.links.length ? `<hyperlinks>${this.links.map(([ref, loc]) => `<hyperlink ref="${ref}" location="${xmlEsc(loc)}"/>`).join("")}</hyperlinks>` : "")
      + `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>`
      + `<pageSetup paperSize="9" orientation="${this.landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  }
}

// ── 조회결과 → 엑셀 (화면·파이썬 변환본과 같은 모양) ──────
const C = { head: "F2F2F2", tot: "E6F1FA", navy: "1F3864", blue: "0B5394", fmt: true };
const box = (o) => ({ box: true, ...o });

function buildCompanySheet(ws, co, secs, s) {
  ws.widths = { 1: 2, 2: 30 };
  for (let c = 3; c < 3 + Math.max(5, ...secs.map((x) => x.cols.length)); c++) ws.widths[c] = 15;
  const title = (r, t) => { ws.set(r, 2, t, { bold: true, size: 13, align: "left" }); return r + 1; };
  let r = title(1, "기본정보");
  const start = r;
  for (const [a, b, c, d] of [["기업명", co.회사명, "대표자명", co.대표자], ["사업자번호", fmtBiz(co.사업자번호), "법인번호", fmtCorp(co.법인번호)], ["산업명", co.산업명, "데이터 기준일자", fmtDate(co.기준일)]]) {
    const top = r === start;
    ws.set(r, 2, a, box({ fill: C.head, top })); ws.set(r, 3, b, box({ align: "left", top })); ws.set(r, 4, "", box({ top })); ws.merge(r, 3, 4);
    ws.set(r, 5, c, box({ fill: C.head, top })); ws.set(r, 6, d, box({ align: "left", top }));
    r++;
  }
  ws.set(r, 2, "주소", box({ fill: C.head })); ws.set(r, 3, co.주소, box({ align: "left" }));
  for (let c = 4; c <= 6; c++) ws.set(r, c, "", box({}));
  ws.merge(r, 3, 6);
  r = title(r + 2, "요약");
  const items = Object.entries(s).filter(([, v]) => v);
  items.forEach(([k, v], j) => { ws.set(r, 2 + j, k, box({ fill: C.head, top: true })); ws.set(r + 1, 2 + j, v, box({ align: "right", fmt: true })); });
  r += 3;
  ws.set(r, 2, "상세현황 (단위 : 백만원)", { bold: true, size: 13, align: "left" });
  r += 2;
  for (const x of secs) {
    r = title(r, x.name);
    ws.set(r, 2, "구분", box({ fill: C.head, top: true }));
    x.cols.forEach((c, j) => ws.set(r, 3 + j, c, box({ fill: C.head, top: true })));
    r++;
    x.rows.forEach(([g, v], i) => {
      const final = i === x.rows.length - 1;
      ws.set(r, 2, g, box({ bold: final, fill: final ? C.tot : null, color: final ? C.navy : null }));
      v.forEach((n, j) => {
        const hi = final || (j === v.length - 1 && v.length > 1);
        ws.set(r, 3 + j, n, box({ bold: final, align: "right", fmt: true, fill: hi ? C.tot : null, color: hi ? C.blue : null }));
      });
      r++;
    });
    r++;
  }
}

function buildWorkbook(results) {
  const book = new Book(), ws0 = book.addSheet("요약"), used = new Set(["요약"]);
  ws0.landscape = true;
  ws0.set(1, 2, "은행연합회 상세신용공여 요약", { bold: true, size: 14, align: "left" });
  ws0.set(2, 2, "(단위 : 백만원)", { size: 9, color: "595959", align: "left" });
  const heads = ["No", "회사명", "사업자번호", "대표자", "산업명", "기준일", "은행계", "비은행계", "신용공여 총계", "차입금", "지급보증", "한도", "담보", "검산 차이", "비고"];
  heads.forEach((h, j) => ws0.set(4, 2 + j, h, box({ fill: C.head, top: true })));
  [2, 5, 24, 14, 10, 28, 11, 10, 10, 12, 10, 10, 10, 10, 9, 16].forEach((w, i) => { ws0.widths[i + 1] = w; });
  results.forEach((co, i) => {
    const r = 5 + i, ok = isOk(co), name = co.회사명 || co.사업자번호;
    let nums = Array(8).fill(null), link = null;
    if (ok) {
      const secs = sections(co.원자료), s = summary(secs), sheet = book.addSheet(safeName(name, used));
      buildCompanySheet(sheet, co, secs, s);
      nums = [s.은행계, s.비은행계, s.총계, co.합계.차입금, co.합계.지급보증, co.합계.한도, co.합계.담보, co.검산.차이];
      link = sheet.name;
    }
    const vals = [i + 1, name, fmtBiz(co.사업자번호), co.대표자, co.산업명, fmtDate(co.기준일), ...nums, co.비고 || ""];
    vals.forEach((v, j) => {
      const isNum = j >= 6 && j < 14;
      ws0.set(r, 2 + j, v ?? "", box({ align: isNum ? "right" : j === 1 || j === 4 ? "left" : "center", fmt: isNum,
        ...(j === 1 && link ? { color: C.blue, under: true } : {}) }));
    });
    if (link) ws0.links.push([`C${r}`, `'${link}'!A1`]);
  });
  return book.toBlob();
}

function buildTemplate() {
  const book = new Book(), ws = book.addSheet("조회목록");
  ws.widths = { 1: 20, 2: 26, 3: 14 };
  ["사업자등록번호", "회사명", "대표자성명"].forEach((h, j) => ws.set(1, 1 + j, h, box({ fill: C.head, top: true })));
  return book.toBlob();
}

// ── 엑셀 읽기 (조회 목록) ────────────────────────────
async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
  let e = u8.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("엑셀(.xlsx) 파일이 아닙니다. 옛 형식(.xls)은 .xlsx로 저장해 주세요.");
  const files = {};
  let p = dv.getUint32(e + 16, true);
  for (let i = 0, n = dv.getUint16(e + 10, true); i < n; i++) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    files[name] = { method, data: u8.subarray(start, start + size) };
    p += 46 + nl + xl + cl;
  }
  return async (name) => {
    const f = files[name];
    if (!f) return null;
    if (f.method === 0) return dec.decode(f.data);
    const stream = new Blob([f.data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).text();
  };
}

async function readRows(file) {
  if (/\.(csv|txt)$/i.test(file.name)) return (await file.text()).split(/\r?\n/).map((l) => l.split(/[,\t]/).map((x) => x.trim()));
  const read = await unzip(await file.arrayBuffer());
  const parse = (x) => new DOMParser().parseFromString(x, "application/xml");
  const wb = await read("xl/workbook.xml"), rels = await read("xl/_rels/workbook.xml.rels");
  const rid = (/<sheet\b[^>]*r:id="([^"]+)"/.exec(wb) || [])[1];
  const target = (new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*>`).exec(rels) || [""])[0].match(/Target="([^"]+)"/)[1];
  const doc = parse(await read(target.startsWith("/") ? target.slice(1) : "xl/" + target));
  const sstXml = await read("xl/sharedStrings.xml");
  const sst = sstXml ? [...parse(sstXml).getElementsByTagName("si")].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent).join("")) : [];
  return [...doc.getElementsByTagName("row")].map((row) => {
    const out = [];
    for (const c of row.getElementsByTagName("c")) {
      const col = c.getAttribute("r").replace(/\d/g, "").split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
      const t = c.getAttribute("t"), v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      let text = v;
      if (t === "s") text = sst[+v] ?? "";
      else if (t === "inlineStr") text = [...c.getElementsByTagName("t")].map((x) => x.textContent).join("");
      else if (/e/i.test(v) && !Number.isNaN(Number(v))) text = String(Number(v));
      out[col - 1] = text.trim();
    }
    return Array.from(out, (x) => x ?? "");
  });
}

// A열 사업자등록번호(필수)·B열 회사명·C열 대표자성명, 첫 줄은 제목
async function readList(file) {
  const rows = await readRows(file);
  const list = [];
  rows.forEach(([a, b], i) => {
    const biz = String(a || "").replace(/\D/g, "");
    if (i === 0 && biz.length !== 10) return;
    if (!a && !b) return;
    list.push({ biz, name: b || "" });
  });
  return list;
}
