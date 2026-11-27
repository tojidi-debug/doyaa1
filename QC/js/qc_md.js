/* 마크다운 → 화면 글(제목·글머리·번호·표·굵게만). 스크립트·HTML 은 모두 글로 막는다 — 심사·조서 검토 · 업종별 AI 분석이 같이 쓴다. */
import { esc } from './lookup_kit.js';

export const mdInline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong class="r2-b">$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
export function mdToHtml(md) {                               // 제목·글머리·번호·표·굵게만 쓰는 작은 변환기(스크립트·HTML 은 모두 글로 막음)
  const L = String(md || '').replace(/\r/g, '').split('\n'), out = []; let i = 0, ul = null;
  const close = () => { if (ul) { out.push(`</${ul}>`); ul = null; } };
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  while (i < L.length) {
    const l = L[i];
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < L.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(L[i + 1])) {
      close(); const head = cells(l); i += 2; const rows = [];
      while (i < L.length && /^\s*\|.*\|\s*$/.test(L[i])) rows.push(cells(L[i++]));
      out.push(`<table class="r2-md-t"><thead><tr>${head.map((c) => `<th>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${mdInline(c).replace(/&lt;br&gt;/g, '<br>')}</td>`).join('')}</tr>`).join('')}</tbody></table>`); continue;
    }
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)$/))) { close(); out.push(`<h${m[1].length + 2}>${mdInline(m[2])}</h${m[1].length + 2}>`); }
    else if ((m = l.match(/^\s*[-*]\s+(.*)$/))) { if (ul !== 'ul') { close(); out.push('<ul>'); ul = 'ul'; } out.push(`<li>${mdInline(m[1])}</li>`); }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { if (ul !== 'ol') { close(); out.push('<ol>'); ul = 'ol'; } out.push(`<li>${mdInline(m[1])}</li>`); }
    else if (!l.trim()) close();
    else { close(); out.push(`<p>${mdInline(l)}</p>`); }
    i++;
  }
  close(); return out.join('');
}

/* 워드(.doc)·엑셀(.xls)로 내려받을 HTML — 표는 칸으로 들어간다 */
export const reportHtml = (title, md) => `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:'Malgun Gothic',sans-serif;font-size:10.5pt;line-height:1.55}table{border-collapse:collapse}th,td{border:1px solid #888;padding:3px 6px;font-size:10pt;vertical-align:top}th{background:#e8eef7}.r2-b,strong{color:#c00000}</style></head><body><h2>${esc(title)}</h2>${mdToHtml(md)}</body></html>`;
