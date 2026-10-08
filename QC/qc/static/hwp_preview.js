/* GitHub(정적) 사이트용 심의안 미리보기 — 서버의 한글→PDF 변환기(rhwp)와 같은 엔진의 브라우저판(@rhwp/core, WebAssembly, MIT)으로
 * hwpx 를 쪽마다 SVG 로 그려 HTML 한 장으로 돌려준다(2026-10-08). 처음 한 번 엔진(약 10MB)을 받는다. */
const RHWP = 'https://cdn.jsdelivr.net/npm/@rhwp/core@0.8.6/';
let ready = null;
async function engine() {
  if (!ready) ready = (async () => {
    let ctx = null, last = '';
    globalThis.measureTextWidth = (font, text) => { if (!ctx) ctx = document.createElement('canvas').getContext('2d'); if (font !== last) { ctx.font = font; last = font; } return ctx.measureText(text).width; };
    const mod = await import(RHWP + 'rhwp.js');
    await mod.default({ module_or_path: RHWP + 'rhwp_bg.wasm' });
    return mod;
  })();
  try { return await ready; } catch (e) { ready = null; throw new Error(`미리보기 엔진(rhwp)을 받지 못했습니다 — 인터넷 연결을 확인하세요. (${e.message || e})`); }
}
/** hwpx 바이트 → 미리보기 HTML(Blob). 쪽마다 SVG, 인쇄하면 쪽 나눔 */
export async function previewHtml(bytes) {
  const { HwpDocument } = await engine();
  const doc = new HwpDocument(new Uint8Array(bytes));
  try {
    const n = doc.pageCount(); const pages = [];
    for (let i = 0; i < n; i++) pages.push(`<div class="pg">${doc.renderPageSvg(i)}</div>`);
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>심의안(미리보기)</title><style>
      html,body{margin:0;background:#e9edf2}.pg{background:#fff;margin:16px auto;box-shadow:0 2px 10px rgba(0,0,0,.18);width:fit-content}.pg svg{display:block;max-width:100%;height:auto}
      @media print{@page{margin:0}html,body{background:#fff}.pg{margin:0;box-shadow:none;page-break-after:always}}</style></head><body>${pages.join('')}</body></html>`;
    return new Blob([html], { type: 'text/html' });
  } finally { if (doc.free) doc.free(); }
}
