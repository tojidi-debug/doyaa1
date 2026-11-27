/* [품감] 제출자료 대사(New)에 합쳐진 감사보고서·심사조서 검토 — GitHub 사이트 전용 (2026-11-27 사용자 지정: 제출자료 대사와 심사·조서 검토를 구분하지 말고 하나로).
 * 올리는 곳·링크 칸·[대사 실행]·[초기화]는 제출자료 대사(qc_sample.js)의 것을 그대로 쓴다. 이 파일은 같은 자료를 가져다
 *   ① [대사 실행]을 누를 때 함께 — 전자공시 링크로 받은 감사보고서 본표 ↔ 엑셀·한글 표(회사 제출자료·심사조서·조치안) 금액 대사
 *   ② [AI 보강]·[AI 종합 검토] — 대사 결과와 첨부 원본을 구글 AI Studio(Gemini)에
 * 를 붙인다(결과 표는 제출자료 대사 결과 바로 아래). 예전 설명:
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
const st = { dart: new Map(), result: null, refs: new Map(), ai: {}, idx: null, qna: null, report: '', busy: false };
const readItems = new Map();                                   // `이름|크기` → 읽은 자료(표·글·원본) — 올린 파일은 제출자료 대사(window.QcRecon)가 쥐고 있다
const fileList = () => (window.QcRecon ? window.QcRecon.files() : []);
const AI_FILE_MAX = 18 * 1024 * 1024, AI_FILES = 6;           // 중계(PROMPT 스크립트와 같은 상한): 파일당 18MB · 6개
const isBin = (n) => /\.(pdf|png|jpe?g|webp|heic)$/i.test(n);
const mimeOf = (n) => { const e = (n.match(/\.([a-z0-9]+)$/i) || [])[1]; return { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', heic: 'image/heic' }[String(e).toLowerCase()] || 'application/octet-stream'; };
const py = (fn, args) => window.QcStatic.sample(fn, args).then((o) => { if (o && o.error) { const d = o.error.detail; throw new Error(typeof d === 'string' ? d : (d && d.message) || '처리하지 못했습니다.'); } return o; });
const b64 = async (f) => { const u = new Uint8Array(await f.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const num = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('ko-KR'));
const bold = (t) => esc(String(t || '')).replace(/\*\*(.+?)\*\*/g, '<strong class="r2-b">$1</strong>').replace(/\n/g, '<br>');   // **바꿀 부분** 굵게


/* ── 화면 뼈대: 결과 자리만(입력은 위쪽 제출자료 대사 카드 하나) ── */
function build() {
  const host = $('tab-r2'); if (!host || host.dataset.ready) return; host.dataset.ready = '1';
  host.innerHTML = '<section id="r2Out" hidden></section><section id="r2Rep" hidden></section>';
  $('r2Rep').addEventListener('click', onRep);
  $('r2Out').addEventListener('click', onOut);
  if ($('revRun')) $('revRun').addEventListener('click', run);
  if ($('r2Ai')) $('r2Ai').addEventListener('click', aiAssist);
  if ($('r2AiAll')) $('r2AiAll').addEventListener('click', aiReport);
  sync();
}
const TBL = /\.(xlsx|xlsm|xls|hwpx)$/i;
const roleOf = (f) => (f._dartNo ? '감사보고서(전자공시)' : /조치안|심의안|양정/.test(f.name) ? '조치안(심의안)' : /조서|심사/.test(f.name) ? '기존 심사조서' : isBin(f.name) && /감사\s*보고/.test(f.name) ? '감사보고서' : '회사 제출자료');
const dartNos = () => [...new Set(fileList().filter((f) => f._dartNo).map((f) => f._dartNo))];
const sync = () => {
  const a = $('r2AiAll'), b = $('r2Ai');
  if (a) a.disabled = st.busy || !(fileList().length || st.result);
  if (b) b.disabled = st.busy || !(st.result && st.result.findings.length);
};

/* ── 올린 자료 읽기(필요할 때 한 번만 — 대사 실행·AI 종합 검토를 누를 때) ── */
async function prep(f) {
  const k = `${f.name}|${f.size}`; if (readItems.has(k)) return readItems.get(k);
  const it = { name: f.name, size: f.size, role: roleOf(f), rows: [], text: '', b64: '', err: '', dartNo: f._dartNo || '' };
  readItems.set(k, it);
  try {
    if (isBin(f.name)) { if (f.size > AI_FILE_MAX) it.err = '18MB 를 넘어 AI 에 붙일 수 없음'; else it.b64 = await b64(f); }
    else if (/\.(docx|pptx|html?|json|xml)$/i.test(f.name)) it.text = (await py('md_convert', [f.name, await b64(f)])).text;     // 글 문서 — markitdown
    else if (/\.(txt|md)$/i.test(f.name)) it.text = await f.text();
    else { const o = await py('r2_file', [f.name, await b64(f)]); it.rows = TBL.test(f.name) ? o.rows : []; it.text = o.text || ''; }      // 엑셀·한글 표 → 「이름 + 숫자」 줄, 그 밖에는 글
  } catch (e) { it.err = e.message || String(e); }
  return it;
}
async function loadDart() {                                  // 전자공시 링크로 받은 감사보고서의 본표(OpenDART 원문)
  const bad = [];
  for (const no of dartNos()) {
    if (st.dart.has(no)) continue;
    try { const zip = await dartDocZip(no); const o = await py('r2_dart', [zip, no]); st.dart.set(no, { no, name: `감사보고서 ${no}`, tables: o.tables }); }
    catch (e) { bad.push(`${no}: ${e.message}`); }
  }
  return bad;
}

/* ── 검토: [대사 실행]을 누를 때 제출자료 대사와 함께 ── */
async function run() {
  if (st.busy) return;
  const fl = fileList(), tbl = fl.filter((f) => TBL.test(f.name)), nos = dartNos();
  st.result = null; $('r2Out').hidden = true; $('r2Out').innerHTML = '';
  if (!tbl.length) { sync(); return; }                       // 표 자료가 없으면 이 검토는 할 것이 없다
  if (!nos.length) {
    $('r2Out').hidden = false;
    $('r2Out').innerHTML = '<section class="qs-card rv-sec"><p class="qs-muted">감사보고서 ↔ 심사조서·제출자료 금액 대사는 전자공시 링크(DART)로 감사보고서를 추가하면 함께 돌아갑니다. (회계법인 제출자료 대사 결과는 위에 있습니다.)</p></section>';
    sync(); return;
  }
  st.busy = true; sync();
  $('r2State').textContent = '감사보고서 금액 대사 중…';
  try {
    if (!hasRelay()) throw new Error('전자공시 중계 주소가 없습니다.');
    const bad = await loadDart();
    if (bad.length) await showAlert(bad.join('\n'), { title: '감사보고서 불러오기' });
    const dart = [...st.dart.values()].flatMap((d) => d.tables.map((t) => ({ ...t, rcept_no: d.no })));
    if (dart.length) {
      const others = (await Promise.all(tbl.map(prep))).filter((f) => f.rows.length).map((f) => ({ name: f.name, role: f.role, rows: f.rows }));
      if (others.length) {
        const mat = $('r2Mat') ? $('r2Mat').value.trim() : '', min = $('r2Min') ? $('r2Min').value.trim() : '';
        st.result = await py('r2_run', [dart, others, mat === '' ? null : Number(mat), min === '' ? 1 : Number(min)]);
        st.refs = new Map(); st.ai = {};
        render();
      }
    }
  } catch (e) { await showAlert(e.message, { title: '감사보고서 금액 대사' }); }
  st.busy = false; $('r2State').textContent = ''; sync();
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
  st.busy = true; sync(); $('r2State').textContent = 'AI가 검토 중…';
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
  st.busy = false; $('r2State').textContent = ''; sync();
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
  const raw = fileList();
  const names = raw.map((f) => `${f.name}(${roleOf(f)})`).join(', ') || '없음';
  if (!(await showConfirm(`다음 자료가 구글 AI Studio(Gemini)로 전송되어 종합 검토 보고서를 만듭니다.\n· 전자공시 감사보고서 ${dartNos().length}건 · 금액 대사 결과 ${st.result ? st.result.findings.length : 0}건 · 제출자료 대사 요약\n· 첨부: ${names}\n중계(열람 암호)를 거치며, 서버에는 저장하지 않습니다. 보낼까요?`, { title: 'AI 종합 검토', okText: '보내기' }))) return;
  st.busy = true; sync();
  $('r2State').textContent = 'AI가 종합 검토 중… (1~2분 걸릴 수 있습니다)';
  try {
    await loadDart().catch(() => []);
    const fl = (await Promise.all(raw.map(prep))).filter((f) => (f.b64 || f.text || f.rows.length) && !(f.dartNo && st.dart.has(f.dartNo)));      // 본표를 받은 전자공시 PDF 는 본표 글로 갈음
    const bins = fl.filter((f) => f.b64);
    if (bins.length > AI_FILES) toast(`PDF·이미지 첨부는 앞의 ${AI_FILES}개만 붙입니다(지금 ${bins.length}개).`);
    const r = st.result, top8 = r ? r.findings.filter((f) => f.level !== '하').slice(0, 12) : [];
    for (const f of top8.slice(0, 6)) await refsFor(f);
    const topItems = top8.map((f) => ({ 번호: f.id, 등급: f.level, 구분: f.kind, 계정: f.account, 기준: `${f.a_name} ${f.a_amt}`, 대사자료: `${f.b_name} ${f.b_amt}`, 차이: f.diff, 내용: f.note, 참고: (st.refs.get(f.id) || []).filter((x) => x.url).slice(0, 3).map((x) => `${x.title}: ${x.snippet}`) }));
    const dartTxt = [...st.dart.values()].flatMap((d) => d.tables.map((t) => `[${d.no} ${t.basis} ${t.title || t.stmt || ''} 단위백만원 ${(t.years || []).join('/')}] ` + (t.rows || []).slice(0, 80).map((x) => `${x.label}=${(x.vals || []).join('/')}`).join('; '))).join('\n').slice(0, 30000);
    const sheets = fl.filter((f) => !f.b64 && f.rows && f.rows.length).map((f) => `[${f.role}: ${f.name}] ` + f.rows.slice(0, 120).map((x) => `${x.label}=${(x.nums || []).map((n) => n[1]).join('/')}`).join('; ')).join('\n').slice(0, 30000);
    const sk = await loadSkill();
    const system = sk.role || '당신은 한국 공인회계사 감사·심사(감리) 업무를 돕는 보조자입니다. 한국채택국제회계기준(K-IFRS)·일반기업회계기준·회계감사기준·외부감사법령을 근거로 감사보고서, 회사 제출자료, 기존 심사조서를 맞춰 보고 중요한 회계처리 오류와 차이를 찾습니다. '
      + '금액은 모두 백만원 단위로 쓰고, 근거 문단은 입력의 「참고」에 있거나 확실히 아는 것만 인용합니다. 없는 문단 번호를 만들지 않으며 불확실하면 「확인 필요」라고 씁니다.';
    const prompt = `${sk.body || '아래 자료를 종합 검토해 마크다운 보고서를 쓰세요(금액 단위 백만원). 핵심 요약 / 주요 차이·오류 표(번호|계정|차이|판단|근거|조치 의견) / 제안 문장(바꾼 말은 **굵게**) / 추가 확인 사항 순서로 쓰세요.'}

### 규칙 검토 결과(중요성 금액 ${r ? r.materiality : '-'}, 상·중 항목)
${JSON.stringify(topItems, null, 1)}

### 감사보고서 본표(전자공시)
${dartTxt || '(없음)'}

### 회사 제출자료·심사조서 표
${sheets || '(없음)'}

### 제출자료 대사(회계법인·매출장·사전제출자료 등) 결과 요약
${(window.QcRecon && window.QcRecon.digest()) || '(없음)'}`;
    const files = bins.map((f) => ({ name: `${f.role}-${f.name}`, mimeType: mimeOf(f.name), base64: f.b64 }));
    const txt = fl.filter((f) => !f.b64 && f.text).map((f) => ({ name: `${f.role}-${f.name}`, mimeType: 'text/plain', text: f.text.slice(0, 120000) }));
    const d = await relayCall({ op: 'ai', prompt, system, files: [...files, ...txt].slice(0, AI_FILES) });
    st.report = String(d.data.text || ''); st.reportModel = d.data.model || 'Gemini';
    drawReport(); toast('AI 종합 검토 보고서를 만들었습니다.');
  } catch (e) { await showAlert(String(e.message || e), { title: 'AI 종합 검토' }); }
  st.busy = false; $('r2State').textContent = ''; sync();
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

/* 제출자료 대사(New)의 [초기화] — 이 검토의 자료·결과도 함께 비운다 */
window.addEventListener('qc:reset', () => {
  st.dart.clear(); readItems.clear(); st.result = null; st.refs = new Map(); st.ai = {}; st.report = ''; st.busy = false;
  const host = $('tab-r2'); if (!host || !host.dataset.ready) return;
  if ($('r2Mat')) $('r2Mat').value = ''; if ($('r2Min')) $('r2Min').value = '1'; $('r2State').textContent = '';
  $('r2Out').hidden = true; $('r2Out').innerHTML = ''; $('r2Rep').hidden = true; $('r2Rep').innerHTML = ''; sync();
});
window.addEventListener('qc:files', sync);
window.addEventListener('qc:reviewed', sync);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
