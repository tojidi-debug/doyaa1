/* 제출자료 대사(New) — 업종별 AI 분석 (PROMPT 페이지 통합, 2026-11-27 사용자 지정).
 *   올린 감사보고서·신용정보(은행연합회) 등의 글과 파일 이름에서 회사의 업종을 알아서 판별 → 그 업종의 프롬프트(+공통 프롬프트)를 적용해 구글 AI Studio(Gemini)로 분석.
 *   프롬프트·판별 단어는 QC/skills/industry_prompts.md(원본: PROMPT 페이지) — 파일만 고치면 바뀐다.
 *   첨부는 PROMPT 스크립트와 같은 규칙: PDF·이미지는 원본, 엑셀·CSV·TXT 는 중계가 글로 풀고, 워드·한글은 브라우저가 글로 풀어 붙인다(파일 18MB · 6개).
 *   규칙 대사(제출자료 대사) 결과의 요약도 함께 보내 AI 가 같이 본다. 자료는 서버에 저장하지 않는다. */
import { relayCall, saveFile } from './api.js';
import { showAlert, showConfirm } from './ui/dialog.js';
import { $, esc, toast } from './lookup_kit.js';
import { mdToHtml, reportHtml } from './qc_md.js';

const MAX_FILE = 18 * 1048576, MAX_FILES = 6;
const st = { skill: null, key: '', auto: true, scored: [], texts: new Map(), md: '', model: '', busy: false };
const py = (fn, args) => window.QcStatic.sample(fn, args).then((o) => { if (o && o.error) { const d = o.error.detail; throw new Error(typeof d === 'string' ? d : (d && d.message) || '처리하지 못했습니다.'); } return o; });
const b64 = async (f) => { const u = new Uint8Array(await f.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', csv: 'text/csv', txt: 'text/plain', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsm: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const ext = (n) => ((n.match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();

/* ── 지침 파일 읽기 ── */
async function loadSkill() {
  if (st.skill) return st.skill;
  let t = ''; try { const r = await fetch(new URL('skills/industry_prompts.md', document.baseURI).href, { cache: 'no-cache' }); t = r.ok ? await r.text() : ''; } catch { /* */ }
  const inds = [], prompts = {}; let common = '';
  const parts = t.split(/^## /m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf('\n'), head = p.slice(0, nl).trim(), body = p.slice(nl + 1).trim();
    if (head === '업종 판별') {
      for (const ln of body.split('\n')) { const m = ln.match(/^-\s*(\w+)\s*\|\s*([^|]+)\|\s*([^|]*)\|\s*(.*)$/); if (m) inds.push({ key: m[1], name: m[2].trim(), icon: m[3].trim(), words: m[4].split(',').map((x) => x.trim()).filter(Boolean) }); }
    } else if (head === '공통') common = body;
    else { const m = head.match(/^업종:\s*(\w+)/); if (m) prompts[m[1]] = body; }
  }
  st.skill = { inds, prompts, common };
  return st.skill;
}

/* ── 업종 판별(규칙) — 파일 이름 + 읽은 글에서 판별 단어가 나온 횟수 ── */
function score(sk, hay) {
  const res = sk.inds.filter((x) => x.key !== 'others' && x.words.length).map((x) => {
    let n = 0; for (const w of x.words) { let i = 0; while ((i = hay.indexOf(w, i)) >= 0 && n < 400) { n += 1; i += w.length; } }
    return { key: x.key, name: x.name, icon: x.icon, n };
  }).sort((a, b) => b.n - a.n);
  return res;
}
const recon = () => window.QcRecon || { files: () => [], digest: () => '' };

async function readTexts(files) {                         // 문서(PDF·워드·한글·웹 글)의 글 — 판별과 AI 첨부에 쓴다(파일마다 한 번만)
  for (const f of files) {
    const k = `${f.name}|${f.size}`; if (st.texts.has(k)) continue;
    const e = ext(f.name); let text = '';
    try {
      if (/^(txt|md|html?)$/.test(e)) text = e === 'txt' || e === 'md' ? await f.text() : (await py('md_convert', [f.name, await b64(f)])).text;
      else if (/^(pdf|hwpx|hwp)$/.test(e)) text = (await py('r2_file', [f.name, await b64(f)])).text || '';
      else if (e === 'docx') text = (await py('md_convert', [f.name, await b64(f)])).text;
    } catch { text = ''; }
    st.texts.set(k, text);
  }
}

async function detect() {
  const sk = await loadSkill(), files = recon().files();
  await readTexts(files.filter((f) => f.size <= MAX_FILE));
  const hay = files.map((f) => f.name + '\n' + (st.texts.get(`${f.name}|${f.size}`) || '').slice(0, 60000)).join('\n');
  st.scored = score(sk, hay);
  const [a, b] = st.scored, sure = a && a.n >= 5 && a.n >= (b ? b.n : 0) * 1.5;
  if (st.auto) st.key = sure ? a.key : 'others';
  st.sure = !!sure;
  draw();
}

/* ── 화면 ── */
function build() {
  const host = $('indPanel'); if (!host || host.dataset.ready) return; host.dataset.ready = '1';
  host.innerHTML = `<section class="qs-card rv-sec ind-card" hidden id="indCard">
    <div class="qs-card-head"><h2>업종별 AI 분석 <span class="qs-muted">(PROMPT 통합 — 올린 감사보고서·신용정보로 업종을 판별해 그 업종 프롬프트로 분석)</span></h2></div>
    <div class="ind-row"><span id="indWhy" class="qs-muted"></span></div>
    <div class="ind-row"><label>업종 <select id="indSel" class="qs-select"></select></label>
      <button id="indRun" class="qs-btn qs-primary" type="button">업종별 AI 분석 실행</button>
      <button id="indPrompt" class="qs-btn" type="button" title="적용될 프롬프트 전체를 복사합니다(다른 AI 웹사이트에 붙여 쓸 수도 있음)">프롬프트 복사</button>
      <span id="indState" class="qs-muted"></span></div>
    <div id="indOut"></div></section>`;
  $('indSel').addEventListener('change', () => { st.auto = false; st.key = $('indSel').value; draw(); });
  $('indRun').addEventListener('click', run);
  $('indPrompt').addEventListener('click', async () => { try { await navigator.clipboard.writeText(await buildPrompt()); toast('적용 프롬프트를 복사했습니다.'); } catch { showAlert('복사하지 못했습니다.', { title: '프롬프트 복사' }); } });
  host.addEventListener('click', onOut);
}
async function draw() {
  const sk = await loadSkill(), card = $('indCard'); if (!card) return;
  const have = recon().files().length || recon().digest();
  card.hidden = !have; if (!have) return;
  $('indSel').innerHTML = sk.inds.map((x) => `<option value="${esc(x.key)}"${x.key === st.key ? ' selected' : ''}>${esc(x.icon)} ${esc(x.name)}</option>`).join('');
  const top = st.scored.filter((x) => x.n).slice(0, 3).map((x) => `${x.name} ${x.n}회`).join(' · ');
  $('indWhy').textContent = st.auto ? (st.sure ? `자동 판별: ${(sk.inds.find((x) => x.key === st.key) || {}).name || ''} — 판별 단어 출현 ${top}` : `자동 판별이 불확실해 공통 프롬프트로 두었습니다${top ? `(${top})` : ' (읽을 수 있는 감사보고서 글이 없음)'} — 업종을 직접 고르거나, 아래 실행 때 AI 가 업종을 먼저 판단합니다.`) : '업종을 직접 골랐습니다.';
}

async function buildPrompt(key = st.key) {
  const sk = await loadSkill(), meta = sk.inds.find((x) => x.key === key) || {}, ind = sk.prompts[key];
  const head = `[${meta.icon || ''} ${meta.name || '공통 기본'} 분석 프롬프트]`;
  return ind ? `${head}\n\n${ind}\n\n--------------------------------------------------\n\n[공통 분석 요청사항]\n${sk.common}` : `${head}\n\n${sk.common}`;
}

/* ── 실행 ── */
function pickFiles(files) {                                // 6개: 감사보고서 → 신용정보(연합회) → 그 밖
  const rank = (f) => (/감사보고서|감사\s*보고/.test(f.name) ? 0 : /신용|연합회|월보|잔액/.test(f.name) ? 1 : 2);
  return files.filter((f) => f.size <= MAX_FILE).sort((a, b) => rank(a) - rank(b)).slice(0, MAX_FILES);
}
async function toPart(f) {
  const e = ext(f.name), t = st.texts.get(`${f.name}|${f.size}`);
  if (MIME[e]) return { name: f.name, mimeType: MIME[e], base64: await b64(f) };
  if (t) return { name: f.name, mimeType: 'text/plain', text: t.slice(0, 120000) };
  return null;
}
async function run() {
  if (st.busy) return;
  const all = recon().files(), sel = pickFiles(all), skipped = all.filter((f) => !sel.includes(f)).map((f) => f.name);
  if (!sel.length && !recon().digest()) { await showAlert('분석할 자료(감사보고서·신용정보 등)를 먼저 올려 주세요.', { title: '업종별 AI 분석' }); return; }
  const meta = (await loadSkill()).inds.find((x) => x.key === st.key) || {};
  if (!(await showConfirm(`다음 자료가 구글 AI Studio(Gemini)로 전송되어 「${meta.name || '공통'}」 프롬프트로 분석됩니다.\n· 첨부: ${sel.map((f) => f.name).join(', ') || '없음'}${skipped.length ? `\n· 한도(6개·18MB)로 제외: ${skipped.join(', ')}` : ''}\n· 제출자료 대사 결과 요약\n중계(열람 암호)를 거치며 서버에는 저장하지 않습니다. 보낼까요?`, { title: '업종별 AI 분석', okText: '보내기' }))) return;
  st.busy = true; $('indRun').disabled = true; $('indState').textContent = 'AI가 분석 중… (1~2분 걸릴 수 있습니다)';
  try {
    let key = st.key;
    if (st.auto && !st.sure) {                              // 규칙으로 못 가린 업종은 AI 가 먼저 판단
      const sk = await loadSkill(), glimpse = [...st.texts.values()].join('\n').slice(0, 6000) + '\n' + all.map((f) => f.name).join(', ');
      try {
        const d = await relayCall({ op: 'ai', json: true, model: 'gemini-2.5-flash-lite', prompt: `다음은 회사 감사보고서·신용정보 자료의 일부와 파일 이름입니다. 회사의 업종을 아래 키 중 하나로 판단해 {"industry":"키"} JSON 으로만 답하세요.\n키: ${sk.inds.map((x) => `${x.key}(${x.name})`).join(', ')}\n\n${glimpse}` });
        const k = (JSON.parse(d.data.text) || {}).industry; if (sk.inds.some((x) => x.key === k)) { key = k; st.key = k; draw(); }
      } catch { /* 판단 못 하면 공통 */ }
    }
    const fileList = sel.map((f, i) => `${i + 1}. ${f.name} / ${f.type || MIME[ext(f.name)] || ''} / 약 ${Math.round(f.size / 1024)}KB`).join('\n');
    const prompt = [await buildPrompt(key), '', '--------------------------------------------------', '[첨부자료 처리 지침]', '- 첨부파일 목록:', fileList || '(없음)',
      '- 감사보고서, 재무제표 주석, 은행연합회 신용정보(월보), 금융기관별 계정과목별 조회(잔액), 기타 자료를 상호 대사하세요.',
      '- 파일 간 수치가 다르면 출처별 금액, 차이, 가능한 원인을 표로 제시하세요.', '- 자료에서 확인되지 않는 항목은 추정하지 말고 "자료상 확인불가"라고 표시하세요.',
      '- 결과 첫머리에 회사명, 결산기, 사용한 첨부자료, 핵심 경고사항 3개 이내를 요약하세요.',
      '- 사용자가 제공한 적용 프롬프트, 역할 정의, 출력 형식 지침, 분석 요청사항 원문은 결과에 다시 쓰지 말고 실제 분석 결과만 작성하세요.',
      '- 표와 표 사이, 큰 문단과 문단 사이에는 빈 줄을 1줄 넣어 가독성을 확보하세요.', '- Markdown 표의 구분선은 |---| 형식만 사용하고, 긴 하이픈/밑줄 반복선은 만들지 마세요.',
      recon().digest() ? `\n[제출자료 대사(규칙) 결과 요약 — 이 결과도 함께 고려해 반영하세요]\n${recon().digest()}` : ''].join('\n');
    const parts = []; for (const f of sel) { const p = await toPart(f); if (p) parts.push(p); }
    const d = await relayCall({ op: 'ai', prompt, files: parts, system: '당신은 한국 공인회계사 감사·심사(감리) 업무를 돕는 보조자입니다. 자료에 없는 사실을 만들지 않습니다.' });
    st.md = String(d.data.text || ''); st.model = d.data.model || 'Gemini'; drawOut(key); toast('업종별 AI 분석을 마쳤습니다.');
  } catch (e) { await showAlert(String(e.message || e), { title: '업종별 AI 분석' }); }
  st.busy = false; $('indRun').disabled = false; $('indState').textContent = '';
}
const ICON_COPY = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>';
const ICON_DOC = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>';
const ICON_XLS = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/></svg>';
async function drawOut(key) {
  const meta = (await loadSkill()).inds.find((x) => x.key === key) || {};
  $('indOut').innerHTML = `<div class="qs-card-head ind-outhead"><h3>${esc(meta.icon || '')} ${esc(meta.name || '공통')} 분석 결과 <span class="qs-muted">(${esc(st.model)} · 참고용 — 원자료 확인 필요)</span></h3><span class="qs-grow"></span>
    <button type="button" class="rs-ic" data-ind="copy" title="결과 글 복사">${ICON_COPY}</button><button type="button" class="rs-ic" data-ind="doc" title="워드(.doc) 내려받기">${ICON_DOC}</button><button type="button" class="rs-ic" data-ind="xls" title="엑셀(.xls) 내려받기 — 표는 칸으로">${ICON_XLS}</button></div>
    <div class="r2-md">${mdToHtml(st.md)}</div>`;
}
function onOut(e) {
  const b = e.target.closest('[data-ind]'); if (!b) return; const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  if (b.dataset.ind === 'copy') navigator.clipboard.writeText(st.md.replace(/\*\*/g, '')).then(() => toast('결과를 복사했습니다.')).catch(() => showAlert('복사하지 못했습니다.', { title: '복사' }));
  if (b.dataset.ind === 'doc') saveFile(`업종별분석_${day}.doc`, '.doc', '워드', 'application/msword', async () => new Blob(['﻿', reportHtml('업종별 AI 분석', st.md)], { type: 'application/msword' }));
  if (b.dataset.ind === 'xls') saveFile(`업종별분석_${day}.xls`, '.xls', '엑셀', 'application/vnd.ms-excel', async () => new Blob(['﻿', reportHtml('업종별 AI 분석', st.md)], { type: 'application/vnd.ms-excel' }));
}

/* ── 연결: 대사 화면이 파일을 올리거나 결과를 내면 판별을 새로 한다 · 초기화하면 비운다 ── */
let t = null;
const later = () => { clearTimeout(t); t = setTimeout(() => { build(); detect().catch(() => {}); }, 600); };
window.addEventListener('qc:files', later);
window.addEventListener('qc:reviewed', later);
window.addEventListener('qc:reset', () => { Object.assign(st, { key: '', auto: true, scored: [], md: '' }); st.texts.clear(); const c = $('indCard'); if (c) { c.hidden = true; $('indOut').innerHTML = ''; $('indState').textContent = ''; } });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
