/* [품감] 심사·조서 검토 — GitHub 사이트 전용 탭 (2026-11-27 사용자 지정).
 *
 * 심사업무·조서 작성에서 감사보고서 · 회사 제출자료 · 기존 심사조서를 맞춰 보고, 중요한 차이와 오류 후보를 백만원 단위로 정리한다.
 *   ① 감사보고서 — 전자공시 주소·접수번호를 붙여넣는다(여러 개: 줄바꿈 · , ; 빈 칸). OpenDART(중계) 원문 → 본표(재무상태표·손익계산서·현금흐름표)
 *   ② 회사 제출자료 · 기존 심사조서 — 엑셀·한글(hwpx) 표를 끌어다 놓는다(브라우저 안에서만 읽음)
 *   검토 = services/qc_review2.py(브라우저 파이썬) — 같은 이름 계정끼리 금액 대사 · 감사보고서 본표 안의 산식 · 큰 증감
 *   참고 기준서 = 회계기준원 열람서비스 색인(공개 저장소 Sejin-Koo/kasb-accounting-mcp, 브라우저에서 바로) + 회계위키(accountingwiki.co.kr MCP, 중계 경유)
 *   AI 보강(선택) = 구글 AI Studio(Gemini) — 중계의 GEMINI_API_KEY. 누를 때 한 번 동의를 받는다.
 * 유료이거나 토큰이 필요한 서비스(MyKIFRS·MyDART·MyFSS MCP 등)는 쓰지 않는다. 자료는 서버에 저장하지 않는다. */
import { relayCall, dartDocZip, hasRelay, saveFile } from './api.js';
import { showAlert, showConfirm } from './ui/dialog.js';
import { $, esc, toast } from './lookup_kit.js';
import { mdToHtml, reportHtml } from './qc_md.js';

const KASB_RAW = 'https://raw.githubusercontent.com/Sejin-Koo/kasb-accounting-mcp/main/data/';
const st = { dart: new Map(), files: [], result: null, refs: new Map(), ai: {}, idx: null, qna: null, report: '' };
const AI_FILE_MAX = 18 * 1024 * 1024, AI_FILES = 6;           // 중계(PROMPT 스크립트와 같은 상한): 파일당 18MB · 6개
const isBin = (n) => /\.(pdf|png|jpe?g|webp|heic)$/i.test(n);
const mimeOf = (n) => { const e = (n.match(/\.([a-z0-9]+)$/i) || [])[1]; return { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', heic: 'image/heic' }[String(e).toLowerCase()] || 'application/octet-stream'; };
const py = (fn, args) => window.QcStatic.sample(fn, args).then((o) => { if (o && o.error) { const d = o.error.detail; throw new Error(typeof d === 'string' ? d : (d && d.message) || '처리하지 못했습니다.'); } return o; });
const b64 = async (f) => { const u = new Uint8Array(await f.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const num = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('ko-KR'));
const bold = (t) => esc(String(t || '')).replace(/\*\*(.+?)\*\*/g, '<strong class="r2-b">$1</strong>').replace(/\n/g, '<br>');   // **바꿀 부분** 굵게

/* ── 화면 뼈대 ── */
function build() {
  const host = $('tab-r2'); if (!host || host.dataset.ready) return; host.dataset.ready = '1';
  host.innerHTML = `
    <section class="qs-card r2-in">
      <div class="qs-card-head"><h2>심사·조서 검토</h2><span class="qs-muted">(감사보고서 ↔ 회사 제출자료 ↔ 기존 심사조서 — 금액 단위 백만원)</span></div>
      <div class="r2-grid">
        <div class="r2-col">
          <label class="r2-lab" for="r2Links">① 감사보고서 — 전자공시 주소 또는 접수번호</label>
          <textarea id="r2Links" class="qs-input r2-links" rows="3" placeholder="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=…  (여러 개는 줄바꿈 · 쉼표 · 세미콜론 · 빈 칸으로 구분)"></textarea>
          <div class="r2-row"><button id="r2Load" class="qs-btn" type="button">공시 불러오기</button><span id="r2LinkState" class="qs-muted"></span></div>
          <ul id="r2Dart" class="qs-files rv-files"></ul>
        </div>
        <div class="r2-col">
          <label class="r2-lab">② 회사 제출자료 · 기존 심사조서 · 감사보고서 파일 (엑셀·한글·PDF·이미지 · 20개까지)</label>
          <div id="r2Drop" class="qs-drop rv-drop" tabindex="0" role="button" aria-label="자료를 끌어다 놓거나 눌러서 고르기">
            <input id="r2Files" type="file" multiple accept=".xlsx,.xlsm,.xls,.hwpx,.docx,.pptx,.html,.pdf,.png,.jpg,.jpeg,.webp" hidden>
            <svg class="rv-folder" viewBox="0 0 48 40" aria-hidden="true"><path d="M3 8a4 4 0 0 1 4-4h11l5 5h18a4 4 0 0 1 4 4v21a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" fill="#2e9e6b"/><path d="M3 15h42v18a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" fill="#58c08c"/></svg>
            <span class="rv-drop-t"><span><b>끌어다 놓거나</b> 눌러서 고르기</span><small>엑셀·한글 표는 금액 대사에, PDF·이미지(감사보고서 첨부 등)는 AI 검토에만 쓰입니다. 이름에 「조서」·「심사」면 심사조서, 「조치안」·「심의안」·「양정」이면 조치안으로 봅니다</small></span>
          </div>
          <ul id="r2Files2" class="qs-files rv-files"></ul>
        </div>
      </div>
      <div class="rv-bar r2-bar">
        <label>중요성 금액 <input id="r2Mat" class="qs-input qs-num" type="number" min="0" step="1" placeholder="자동" title="백만원 — 비우면 자산총계의 0.5%"></label>
        <label>최소 차이 <input id="r2Min" class="qs-input qs-num" type="number" min="0" step="1" value="1" title="백만원 — 제출자료에 적용. 심사조서는 5(4~5백만원 단수 제외), 조치안(심의안)은 오차 없이(0.5) 자동"></label>
        <button id="r2Run" class="qs-btn qs-primary" type="button" disabled>검토 실행</button>
        <button id="r2Ai" class="qs-btn" type="button" disabled title="상·중 항목에 대해 구글 AI Studio(Gemini)가 검토 의견과 제안 문장을 만듭니다(누를 때 동의 확인)">AI 보강</button>
        <button id="r2AiAll" class="qs-btn" type="button" disabled title="감사보고서·제출자료·심사조서(PDF·이미지 포함)를 함께 보고 구글 AI Studio(Gemini)가 종합 검토 보고서를 씁니다(누를 때 동의 확인)">AI 종합 검토</button>
        <span id="r2State" class="qs-muted"></span>
      </div>
    </section>
    <section id="r2Out" hidden></section>
    <section id="r2Rep" hidden></section>`;
  $('r2Load').addEventListener('click', loadLinks);
  const d = $('r2Drop'), inp = $('r2Files');
  d.addEventListener('click', () => inp.click());
  d.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
  d.addEventListener('dragover', (e) => { e.preventDefault(); d.classList.add('is-over'); });
  d.addEventListener('dragleave', () => d.classList.remove('is-over'));
  d.addEventListener('drop', (e) => { e.preventDefault(); d.classList.remove('is-over'); addFiles([...e.dataTransfer.files]); });
  inp.addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
  $('r2Files2').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { st.files.splice(Number(b.dataset.rm), 1); drawFiles(); } });
  $('r2Files2').addEventListener('change', (e) => { const s = e.target.closest('[data-role]'); if (s) { st.files[Number(s.dataset.role)].role = s.value; } });
  $('r2Run').addEventListener('click', run);
  $('r2Ai').addEventListener('click', aiAssist);
  $('r2AiAll').addEventListener('click', aiReport);
  $('r2Rep').addEventListener('click', onRep);
  $('r2Out').addEventListener('click', onOut);
}

function drawDart() {
  $('r2Dart').innerHTML = [...st.dart.values()].map((d) => `<li title="${esc(d.name)}"><span class="nm">감사보고서 ${esc(d.no)} · 본표 ${d.tables.length}개(${esc([...new Set(d.tables.map((t) => t.basis))].join('·'))}) · ${esc(d.tables[0] ? d.tables[0].years.join('·') + '년' : '')}</span><button type="button" data-rmd="${esc(d.no)}" title="빼기">⨯</button></li>`).join('');
  $('r2Dart').onclick = (e) => { const b = e.target.closest('[data-rmd]'); if (b) { st.dart.delete(b.dataset.rmd); drawDart(); sync(); } };
}
function drawFiles() {
  $('r2Files2').innerHTML = st.files.map((f, i) => `<li title="${esc(f.name)}"><span class="nm">${esc(f.name)}${f.err ? ` <em class="bad">${esc(f.err)}</em>` : f.rows ? ` <em class="qs-muted">${f.rows.length}줄</em>` : ''}</span>
    <select data-role="${i}" class="r2-role">${['회사 제출자료', '기존 심사조서', '조치안(심의안)', '감사보고서'].filter((r) => r !== '감사보고서' || f.bin || f.role === r).map((r) => `<option${f.role === r ? ' selected' : ''}>${r}</option>`).join('')}</select><button type="button" data-rm="${i}" title="빼기">⨯</button></li>`).join('');
  sync();
}
const sync = () => { $('r2Run').disabled = !(st.dart.size && st.files.some((f) => f.rows && f.rows.length)); $('r2AiAll').disabled = !(st.result || st.dart.size || st.files.length); };

/* ── 입력 ── */
async function loadLinks() {
  const text = $('r2Links').value.trim(); if (!text) return;
  if (!hasRelay()) { await showAlert('전자공시 중계 주소가 없습니다.', { title: '감사보고서' }); return; }
  const nos = (await py('r2_links', [text])) || [];
  if (!nos.length) { $('r2LinkState').textContent = '접수번호(14자리)나 전자공시 주소를 찾지 못했습니다.'; return; }
  $('r2LinkState').textContent = `${nos.length}건 받는 중…`; $('r2Load').disabled = true;
  const bad = [];
  for (const no of nos) {
    if (st.dart.has(no)) continue;
    try { const zip = await dartDocZip(no); const o = await py('r2_dart', [zip, no]); st.dart.set(no, { no, name: `감사보고서 ${no}`, tables: o.tables }); drawDart(); }
    catch (e) { bad.push(`${no}: ${e.message}`); }
  }
  $('r2Load').disabled = false; $('r2LinkState').textContent = bad.length ? '' : `${st.dart.size}건 읽음`; sync();
  if (bad.length) await showAlert(bad.join('\n'), { title: '감사보고서 불러오기' });
}
async function addFiles(files) {
  for (const f of files) {
    if (st.files.length >= 20) break; if (st.files.some((x) => x.name === f.name && x.size === f.size)) continue;
    const bin = isBin(f.name);
    const item = { name: f.name, size: f.size, bin, role: bin && /감사보고서|감사\s*보고/.test(f.name) ? '감사보고서' : /조치안|심의안|양정/.test(f.name) ? '조치안(심의안)' : /조서|심사/.test(f.name) ? '기존 심사조서' : bin ? '감사보고서' : '회사 제출자료', rows: null, err: '' };
    st.files.push(item); drawFiles();
    try {
      if (bin) {                                    // PDF·이미지 — AI 에만 쓰임(원본 그대로 Gemini 에 붙임)
        if (f.size > AI_FILE_MAX) throw new Error('18MB 를 넘어 AI 에 붙일 수 없습니다');
        item.b64 = await b64(f); item.rows = []; item.err = 'AI 검토에만 쓰임(금액 대사 제외)';
      } else if (/\.(docx|pptx|html?|json|xml|md)$/i.test(f.name)) {   // 글 문서 — markitdown 으로 마크다운화(AI 검토용, 표는 대사에 안 씀)
        item.err = '마크다운으로 바꾸는 중(처음에는 변환기를 내려받아 몇십 초)…'; drawFiles();
        const o = await py('md_convert', [f.name, await b64(f)]);
        item.rows = []; item.text = o.text; item.err = `마크다운 ${num(o.text.length)}자 — AI 검토에만 쓰임(금액 대사 제외)`;
      } else {
        const o = await py('r2_file', [f.name, await b64(f)]);
        item.rows = o.rows; item.text = o.text;
        if (!o.rows.length) item.err = o.text ? '표가 없어 글만 읽음(AI 검토에만 쓰임)' : '「계정 이름 + 숫자」 줄을 찾지 못함';
      }
    } catch (e) { item.err = e.message; }
    drawFiles();
  }
}

/* ── 검토 ── */
async function run() {
  $('r2State').textContent = '맞춰 보는 중…'; $('r2Run').disabled = true;
  try {
    const dart = [...st.dart.values()].flatMap((d) => d.tables.map((t) => ({ ...t, rcept_no: d.no })));
    const others = st.files.filter((f) => f.rows && f.rows.length).map((f) => ({ name: f.name, role: f.role, rows: f.rows }));
    const mat = $('r2Mat').value.trim(), min = $('r2Min').value.trim();
    st.result = await py('r2_run', [dart, others, mat === '' ? null : Number(mat), min === '' ? 1 : Number(min)]);
    st.refs = new Map(); st.ai = {};
    render(); $('r2Ai').disabled = !st.result.findings.length; $('r2AiAll').disabled = false;
  } catch (e) { await showAlert(e.message, { title: '심사·조서 검토' }); }
  $('r2State').textContent = ''; sync();
}

const ICON_COPY = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>';
const ICON_XLSX = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/></svg>';
function render() {
  const r = st.result, fs = r.findings, cnt = (g) => fs.filter((f) => f.level === g).length;
  const stats = r.stats.map((s) => `<li><b>${esc(s.name)}</b> <span class="qs-muted">${esc(s.role)} · ${s.rows}줄 중 감사보고서(${esc(s.basis)})와 이름이 같은 계정 ${s.matched}개 · 금액 일치 ${s.same}개 · 단위 ${esc(s.unit)} 자동</span></li>`).join('');
  const rowHtml = (f) => `<tr class="rs-row" data-id="${f.id}"><td class="no">${f.id}</td><td><span class="gr gr-${esc(f.level)}">${esc(f.level)}</span></td>
    <td class="ti"><b>${esc(f.account)}</b><div class="rs-basis">${esc(f.loc)}</div></td>
    <td class="r2-a">${esc(f.a_name)}<div class="num">${num(f.a_amt)}</div></td><td class="r2-a">${esc(f.b_name)}<div class="num">${num(f.b_amt)}</div></td>
    <td class="num cmp-diff">${f.diff > 0 ? '+' : ''}${num(f.diff)}</td>
    <td class="tg">${esc(f.note)} <a href="#" class="rs-more" data-r2="refs" data-id="${f.id}">참고 기준서 ▾</a><div class="r2-refs" id="r2refs${f.id}" hidden></div><div class="r2-ai" id="r2ai${f.id}" hidden></div></td></tr>`;
  const pairs = new Map();                                   // 대사하는 파일의 제목(「1. 감사보고서 ↔ 심사조서 대사」)별로, 그 안에서 주요 항목(자산·부채·자본·손익계산서·현금흐름표)별로
  for (const f of fs) { if (!pairs.has(f.pair_no)) pairs.set(f.pair_no, { no: f.pair_no, title: f.pair, files: f.pair_files || '', secs: new Map() }); const g = pairs.get(f.pair_no); if (!g.secs.has(f.sect)) g.secs.set(f.sect, []); g.secs.get(f.sect).push(f); }
  const head = '<thead><tr><th class="no">#</th><th>등급</th><th>계정</th><th>기준(A)</th><th>대사 자료(B)</th><th class="num">차이(B−A)</th><th>내용</th></tr></thead>';
  const cols = '<colgroup><col style="width:4%"><col style="width:5%"><col style="width:20%"><col style="width:15%"><col style="width:15%"><col style="width:9%"><col></colgroup>';
  const tables = [...pairs.values()].map((g) => {
    const n = [...g.secs.values()].reduce((a, l) => a + l.length, 0);
    const body = [...g.secs.entries()].map(([sec, l]) => `<tr class="r2-sec"><td colspan="7"><b>${esc(sec)}</b> <span class="qs-muted">${l.length}건</span></td></tr>${l.map(rowHtml).join('')}`).join('');
    return `<h3 class="r2-pair">${g.no}. ${esc(g.title)} <span class="qs-muted">${n}건${g.files ? ` · ${esc(g.files)}` : ''}</span></h3><table class="rs-table r2-table">${cols}${head}<tbody>${body}</tbody></table>`;
  }).join('');
  $('r2Out').hidden = false;
  $('r2Out').innerHTML = `<section class="qs-card rv-sec rs-card"><div class="qs-card-head"><h2>검토 결과 <span class="qs-muted">— 중요성 금액 ${num(r.materiality)}백만원 · 최소 차이 ${num(r.min_diff)}백만원</span></h2><span class="qs-grow"></span>
      <button type="button" class="rs-ic" data-r2="copy" title="결과를 한꺼번에 복사 — 엑셀·워드·한글에 붙여넣기">${ICON_COPY}</button>
      <button type="button" class="rs-ic" data-r2="xlsx" title="엑셀 다운로드(차이·오류 후보 · 참고 기준서 · AI 제안 문장)">${ICON_XLSX}</button></div>
    <div class="qs-sum"><span class="gr gr-상">상 ${cnt('상')}</span><span class="gr gr-중">중 ${cnt('중')}</span><span class="gr gr-하">하 ${cnt('하')}</span><span class="qs-muted">감사보고서 본표 ${r.dart.length}개 · 단위 백만원</span></div>
    <ul class="qs-sumlist">${stats}</ul>${r.notes.map((n) => `<p class="qs-warn">${esc(n)}</p>`).join('')}
    ${fs.length ? tables
      : '<p class="qs-muted">중요성 금액·최소 차이를 넘는 차이나 산식 불일치를 찾지 못했습니다.</p>'}
    <p class="rs-note">※ 제목의 「↔」 양쪽이 서로 맞춰 본 자료입니다. 심사조서는 천만원 단위로 보아 4~5백만원 안팎의 단수 차이는 내놓지 않고, 조치안(심의안)은 금액이 오차 없이 맞아야 하므로 작은 차이도 내놓습니다. 「감사보고서 본표 자체 점검」은 본표 안의 산식이 맞지 않는 것(오류 후보)입니다. 규칙으로 찾은 후보이므로 원자료·기준서 확인이 필요합니다.</p></section>`;
}

/* ── 참고 기준서(회계기준원 색인 + 회계위키) ── */
async function kasbIndex() {
  if (!st.idx) st.idx = fetch(KASB_RAW + 'standards_search_index.json').then((r) => r.json()).catch(() => []);
  return st.idx;
}
async function kasbQna() {
  if (!st.qna) st.qna = fetch(KASB_RAW + 'qna_search_index.json').then((r) => r.json()).catch(() => []);
  return st.qna;
}
const toks = (q) => [...new Set((q.match(/[가-힣A-Za-z0-9]{2,}/g) || []))];
function top(list, tk, field, n) {
  const sc = list.map((x) => { const t = (x.stdTitle || x.title || '') + ' ' + (x.docTitle || ''), s = x.snippet || ''; let k = 0; for (const w of tk) { if (t.includes(w)) k += 3; if (s.includes(w)) k += 1; } return [k, x]; });
  return sc.filter((a) => a[0] >= Math.min(4, tk.length * 2)).sort((a, b) => b[0] - a[0]).slice(0, n).map((a) => a[1]);
}
const clip = (t, n = 160) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
async function refsFor(f) {
  if (st.refs.has(f.id)) return st.refs.get(f.id);
  const out = [], tk = toks(f.search);
  const [idx, qna] = await Promise.all([kasbIndex(), kasbQna()]);
  for (const x of top(idx, tk, 'stdTitle', 3)) out.push({ source: '회계기준원', title: `${x.categoryLabel.split('(')[0]} 제${x.stdNum}호 ${x.stdTitle}${x.ref ? ` 문단 ${x.ref}` : ''}`, snippet: clip(x.snippet), url: x.url });
  for (const x of top(qna, tk, 'title', 2)) out.push({ source: '회계기준원 질의회신', title: `${x.docNumber} ${x.title}`, snippet: clip(String(x.snippet || '').replace(/^.*?본문/s, '')), url: x.url });
  try {
    const d = await relayCall({ op: 'wiki', tool: 'search', args: { query: f.search, limit: 4 } });
    const text = (d.data && d.data.text) || '';
    for (const m of text.matchAll(/\d+\.\s+\*\*(.+?)\*\*\s+—\s+(.+?)\n\s+id:\s+`(.+?)`\n\s+([\s\S]*?)\n\s+출처:\s+(\S+)/g)) out.push({ source: '회계위키', title: `${m[1]} — ${m[2]}`, snippet: clip(m[4]), url: m[5] });
  } catch (e) { out.push({ source: '회계위키', title: '(회계위키를 부르지 못했습니다 — 중계 새 판 배포·네트워크 확인)', snippet: String(e.message || e), url: '' }); }
  st.refs.set(f.id, out); return out;
}
function drawRefs(id) {
  const list = st.refs.get(id) || [], box = $(`r2refs${id}`);
  box.innerHTML = list.length ? `<ul>${list.map((x) => `<li><span class="r2-src">${esc(x.source)}</span> ${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title)}<div class="qs-muted">${esc(x.snippet)}</div></li>`).join('')}</ul>
    <p class="qs-muted qs-small">출처: 회계기준원 회계기준열람서비스(공개 색인: Sejin-Koo/kasb-accounting-mcp) · 회계위키(accountingwiki.co.kr). 원문 저작권은 각 제정·발행기관에 있습니다.</p>` : '<p class="qs-muted">관련 문단을 찾지 못했습니다.</p>';
}

/* ── AI 보강(구글 AI Studio / Gemini) ── */
async function aiAssist() {
  const fs = st.result.findings.filter((f) => f.level !== '하').slice(0, 8);
  if (!fs.length) { toast('상·중 항목이 없어 AI 보강할 것이 없습니다.'); return; }
  if (!(await showConfirm(`상·중 항목 ${fs.length}건의 계정 이름·금액·참고 기준서 문구가 구글 AI Studio(Gemini)로 전송되어 검토 의견과 제안 문장을 만듭니다.\n파일 전체는 보내지 않습니다. 중계(열람 암호)를 거칩니다. 보낼까요?`, { title: 'AI 보강', okText: '보내기' }))) return;
  $('r2State').textContent = 'AI가 검토 중…'; $('r2Ai').disabled = true;
  try {
    for (const f of fs) await refsFor(f);
    const items = fs.map((f) => ({ id: f.id, 구분: f.kind, 계정: f.account, 기준: `${f.a_name} ${f.a_amt}백만원`, 대사자료: `${f.b_name} ${f.b_amt}백만원`, 차이: `${f.diff}백만원`, 내용: f.note,
      참고: (st.refs.get(f.id) || []).filter((x) => x.url).slice(0, 4).map((x) => `${x.title}: ${x.snippet}`) }));
    const system = '당신은 한국 회계감사 심사·감리를 돕는 보조자입니다. 한국채택국제회계기준(K-IFRS)·일반기업회계기준·회계감사기준을 근거로, 감사보고서와 회사 제출자료·심사조서의 금액 차이나 오류 후보를 검토합니다. '
      + '금액은 모두 백만원 단위로 씁니다. 근거 문단은 입력의 「참고」에 있는 것만 인용하고, 없는 문단 번호를 만들지 않습니다. 확실하지 않으면 「확인 필요」라고 씁니다.';
    const prompt = `아래 항목마다 JSON 배열로만 답하세요. 각 원소: {"id": 번호, "issue": "문제점 한 문장", "analysis": "검토 의견 2~4문장(관련 기준서 문단은 참고에 있는 것만)", "recommended": "조서·감사보고서에 이렇게 고쳐 쓰면 좋겠다는 문장. 바꾸거나 새로 넣는 단어·금액은 **굵게**(마크다운 **) 표시"}\n\n${JSON.stringify(items, null, 1)}`;
    const d = await relayCall({ op: 'ai', prompt, system, json: true });
    let arr = []; try { arr = JSON.parse(d.data.text); } catch { const m = String(d.data.text).match(/\[[\s\S]*\]/); arr = m ? JSON.parse(m[0]) : []; }
    st.ai = {}; for (const a of arr) { if (a && a.id != null) st.ai[a.id] = a; }
    for (const f of fs) { const a = st.ai[f.id]; const box = $(`r2ai${f.id}`); if (!a || !box) continue; box.hidden = false;
      box.innerHTML = `<div class="r2-aihead">AI 검토 <span class="qs-muted">(${esc(d.data.model || 'Gemini')} · 참고용 — 기준서 원문 확인)</span></div><div><b>문제점</b> ${bold(a.issue)}</div><div><b>검토 의견</b> ${bold(a.analysis)}</div><div class="r2-rec"><b>제안 문장</b> ${bold(a.recommended)}</div>`; drawRefs(f.id); $(`r2refs${f.id}`).hidden = false; }
    toast(`AI 검토 ${Object.keys(st.ai).length}건을 붙였습니다.`);
  } catch (e) { await showAlert(String(e.message || e), { title: 'AI 보강' }); }
  $('r2State').textContent = ''; $('r2Ai').disabled = false;
}

/* ── AI 종합 검토(PROMPT 스크립트와 같은 방식: 지시문 + 첨부 원본을 한 번에 Gemini 로) ── */
let skillP = null;                                    // QC/skills/review2_report.md — 검토 지침(코드 수정 없이 파일만 고쳐 쓴다)
const SKILL_FALLBACK = { role: '', body: '' };
function loadSkill() {
  if (!skillP) skillP = fetch(new URL('skills/review2_report.md', document.baseURI).href, { cache: 'no-cache' }).then((r) => (r.ok ? r.text() : '')).then((t) => {
    const sec = (h) => { const m = t.match(new RegExp('^##\\s*' + h + '\\s*\\n([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))', 'm')); return m ? m[1].trim() : ''; };
    return { role: sec('역할'), body: sec('보고서 구성') };
  }).catch(() => SKILL_FALLBACK);
  return skillP;
}
async function aiReport() {
  const fl = st.files.filter((f) => f.b64 || f.text || (f.rows && f.rows.length));
  const bins = fl.filter((f) => f.b64);
  if (bins.length > AI_FILES) { await showAlert(`PDF·이미지 첨부는 ${AI_FILES}개까지입니다(지금 ${bins.length}개).`, { title: 'AI 종합 검토' }); return; }
  const names = fl.map((f) => `${f.name}(${f.role}${f.b64 ? ' · 원본 첨부' : ''})`).join(', ') || '없음';
  if (!(await showConfirm(`다음 자료가 구글 AI Studio(Gemini)로 전송되어 종합 검토 보고서를 만듭니다.\n· 감사보고서 본표 ${st.dart.size}건 · 검토 결과 ${st.result ? st.result.findings.length : 0}건\n· 첨부: ${names}\n중계(열람 암호)를 거치며, 서버에는 저장하지 않습니다. 보낼까요?`, { title: 'AI 종합 검토', okText: '보내기' }))) return;
  $('r2State').textContent = 'AI가 종합 검토 중… (1~2분 걸릴 수 있습니다)'; $('r2AiAll').disabled = true;
  try {
    const r = st.result, top8 = r ? r.findings.filter((f) => f.level !== '하').slice(0, 12) : [];
    for (const f of top8.slice(0, 6)) await refsFor(f);
    const items = top8.map((f) => ({ 번호: f.id, 등급: f.level, 구분: f.kind, 계정: f.account, 기준: `${f.a_name} ${f.a_amt}`, 대사자료: `${f.b_name} ${f.b_amt}`, 차이: f.diff, 내용: f.note, 참고: (st.refs.get(f.id) || []).filter((x) => x.url).slice(0, 3).map((x) => `${x.title}: ${x.snippet}`) }));
    const dartTxt = [...st.dart.values()].flatMap((d) => d.tables.map((t) => `[${d.no} ${t.basis} ${t.title || t.stmt || ''} 단위백만원 ${(t.years || []).join('/')}] ` + (t.rows || []).slice(0, 80).map((x) => `${x.label}=${(x.vals || []).join('/')}`).join('; '))).join('\n').slice(0, 30000);
    const sheets = fl.filter((f) => !f.b64 && f.rows && f.rows.length).map((f) => `[${f.role}: ${f.name}] ` + f.rows.slice(0, 120).map((x) => `${x.label}=${(x.nums || []).map((n) => n[1]).join('/')}`).join('; ')).join('\n').slice(0, 30000);
    const sk = await loadSkill();
    const system = sk.role || '당신은 한국 공인회계사 감사·심사(감리) 업무를 돕는 보조자입니다. 한국채택국제회계기준(K-IFRS)·일반기업회계기준·회계감사기준·외부감사법령을 근거로 감사보고서, 회사 제출자료, 기존 심사조서를 맞춰 보고 중요한 회계처리 오류와 차이를 찾습니다. '
      + '금액은 모두 백만원 단위로 쓰고, 근거 문단은 입력의 「참고」에 있거나 확실히 아는 것만 인용합니다. 없는 문단 번호를 만들지 않으며 불확실하면 「확인 필요」라고 씁니다.';
    const prompt = `${sk.body || '아래 자료를 종합 검토해 마크다운 보고서를 쓰세요(금액 단위 백만원). 핵심 요약 / 주요 차이·오류 표(번호|계정|차이|판단|근거|조치 의견) / 제안 문장(바꾼 말은 **굵게**) / 추가 확인 사항 순서로 쓰세요.'}

### 규칙 검토 결과(중요성 금액 ${r ? r.materiality : '-'}, 상·중 항목)
${JSON.stringify(items, null, 1)}

### 감사보고서 본표(전자공시)
${dartTxt || '(없음)'}

### 회사 제출자료·심사조서 표
${sheets || '(없음)'}`;
    const files = fl.filter((f) => f.b64).map((f) => ({ name: `${f.role}-${f.name}`, mimeType: mimeOf(f.name), base64: f.b64 }));
    const txt = fl.filter((f) => !f.b64 && f.text).map((f) => ({ name: `${f.role}-${f.name}`, mimeType: 'text/plain', text: f.text.slice(0, 120000) }));
    const d = await relayCall({ op: 'ai', prompt, system, files: [...files, ...txt].slice(0, AI_FILES) });
    st.report = String(d.data.text || ''); st.reportModel = d.data.model || 'Gemini';
    drawReport(); toast('AI 종합 검토 보고서를 만들었습니다.');
  } catch (e) { await showAlert(String(e.message || e), { title: 'AI 종합 검토' }); }
  $('r2State').textContent = ''; $('r2AiAll').disabled = false;
}
const ICON_DOC = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>';
function drawReport() {
  const o = $('r2Rep'); o.hidden = false;
  o.innerHTML = `<section class="qs-card rv-sec"><div class="qs-card-head"><h2>AI 종합 검토 <span class="qs-muted">(${esc(st.reportModel)} · 참고용 — 기준서 원문·원자료 확인 필요)</span></h2><span class="qs-grow"></span>
      <button type="button" class="rs-ic" data-rep="copy" title="보고서 글 복사">${ICON_COPY}</button>
      <button type="button" class="rs-ic" data-rep="doc" title="워드(.doc) 내려받기">${ICON_DOC}</button>
      <button type="button" class="rs-ic" data-rep="xls" title="엑셀(.xls) 내려받기 — 표는 칸으로">${ICON_XLSX}</button></div>
    <div class="r2-md">${mdToHtml(st.report)}</div></section>`;
}
const saveBlob = (text, type, name) => saveFile(name, /\.[a-z]+$/.exec(name)[0], name.endsWith('.xls') ? '엑셀' : '워드', type, async () => new Blob(['\ufeff', text], { type }));   // 저장 위치는 매번 같은 곳(api.js saveFile)
function onRep(e) {
  const b = e.target.closest('[data-rep]'); if (!b) return; const k = b.dataset.rep, day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const html = (title) => reportHtml(title, st.report);
  if (k === 'copy') navigator.clipboard.writeText(st.report.replace(/\*\*/g, '')).then(() => toast('보고서를 복사했습니다.')).catch(() => showAlert('복사하지 못했습니다.', { title: '복사' }));
  if (k === 'doc') saveBlob(html('심사·조서 AI 종합 검토'), 'application/msword', `심사조서_AI종합검토_${day}.doc`);
  if (k === 'xls') saveBlob(html('심사·조서 AI 종합 검토'), 'application/vnd.ms-excel', `심사조서_AI종합검토_${day}.xls`);
}

/* ── 복사·엑셀·참고 열기 ── */
function resultText() {
  const r = st.result, L = ['[심사·조서 검토]\t금액 단위 백만원', ['번호', '등급', '대사 제목', '주요 항목', '계정', '기준(A)', 'A 금액', '대사 자료(B)', 'B 금액', '차이', '내용', '위치'].join('\t')];
  for (const f of r.findings) L.push([f.id, f.level, `${f.pair_no}. ${f.pair}`, f.sect, f.account, f.a_name, f.a_amt, f.b_name, f.b_amt, f.diff, f.note, f.loc].join('\t'));
  for (const [id, a] of Object.entries(st.ai)) L.push('', `AI 제안 ${id}\t${String(a.recommended || '').replace(/\*\*/g, '')}`);
  return L.join('\n');
}
async function onOut(e) {
  const b = e.target.closest('[data-r2]'); if (!b) return; e.preventDefault();
  const k = b.dataset.r2;
  if (k === 'refs') {
    const id = Number(b.dataset.id), box = $(`r2refs${id}`);
    if (!box.hidden) { box.hidden = true; b.textContent = '참고 기준서 ▾'; return; }
    box.hidden = false; b.textContent = '접기 ▴'; box.innerHTML = '<p class="qs-muted">찾는 중…</p>';
    await refsFor(st.result.findings.find((f) => f.id === id)); drawRefs(id); return;
  }
  if (k === 'copy') { navigator.clipboard.writeText(resultText()).then(() => toast('결과를 복사했습니다 — 엑셀·워드·한글에 붙여 넣으세요.')).catch(() => showAlert('복사하지 못했습니다.', { title: '복사' })); return; }
  if (k === 'xlsx') {
    try {
      const refs = Object.fromEntries([...st.refs.entries()].map(([id, l]) => [id, l]));
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      await saveFile(`심사조서_검토_${day}.xlsx`, '.xlsx', '엑셀', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', async () => {
        const o = await py('r2_xlsx', [st.result, refs, st.ai, [...st.dart.keys()].join('_')]);
        const bin = atob(o.b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        return new Blob([u], { type: o.type });
      });
    } catch (e2) { showAlert(e2.message, { title: '엑셀 다운로드' }); }
  }
}

/* 제출자료 대사(New)의 [초기화] — 이 탭의 자료·결과도 함께 비운다 */
window.addEventListener('qc:reset', () => {
  st.dart.clear(); st.files = []; st.result = null; st.refs = new Map(); st.ai = {}; st.report = '';
  const host = $('tab-r2'); if (!host || !host.dataset.ready) return;
  $('r2Links').value = ''; $('r2LinkState').textContent = ''; $('r2Mat').value = ''; $('r2Min').value = '1';
  drawDart(); drawFiles(); $('r2Out').hidden = true; $('r2Out').innerHTML = ''; $('r2Rep').hidden = true; $('r2Rep').innerHTML = ''; $('r2Ai').disabled = true;
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
