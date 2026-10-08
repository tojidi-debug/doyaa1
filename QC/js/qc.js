/* [품감] 심의안(회계법인) — /qc.html (2026-10-08)
 *
 *   왼쪽: 회계법인 찾기(OpenDART corpCode) → 사업보고서 목록(최근 3개 사업연도, 정정 포함 — 2026-10-08 두 화면 공통)
 *   오른쪽: (붙임1) 감사인 개요 두 표 + 외부감사대상회사 수 + [엑셀 복사] + [심의안에 반영] + 서식(관리자: 템플릿 변경)
 *   서버: /api/v1/qc/* (api/v1/qc.py). 한글 채우기는 브라우저(HwpxFill, 안건 화면과 같은 엔진).
 */
import './ui/guard.js';
import * as API from './api.js';
const { api, auth } = API;
import { showAlert, showConfirm } from './ui/dialog.js';
import { $, esc, copyText } from './lookup_kit.js';
import { grids, tsv, templateCtx, fmtCnt, periodLabel, fiscalSpan, firmName } from './qc_data.js';
import { openDraft, closeDraft, isOpen as draftOpen } from './qc_draft_ui.js';

/* 운영 메뉴(qc.html)는 조회·엑셀 복사·외감회사대사까지. 서식 채우기·기본 정보·심의안 초안 작성은 개발서버 메뉴(qc_dev.html, body[data-mode=dev])에서만(사용자 지정 2026-10-08) */
const DEV = document.body.dataset.mode === 'dev';
/* 정적 사이트 모드(GitHub 등, 2026-10-08) — 서버가 없다: 자료는 상대 경로, 평가표 엑셀은 브라우저(Pyodide), 회계법인 정보는 개발서버에서 내보낸 JSON 을 불러온다 */
const STATIC = !!window.QC_STATIC;
const ASSET = STATIC ? '' : '/';
const state = { me: null, admin: false, firm: null, reports: [], report: null, profile: null, templates: { items: [], active_id: null, builtin: '' }, phrases: null };
let toastTimer;
function toast(message) { const el = $('qcToast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200); }
const describe = (e) => (e && (e.message || e.detail)) ? String(e.message || e.detail) : String(e);

/* ── 회계법인 찾기 ── */
async function search(q) {
  const list = $('firmList'); const count = $('resultCount');
  q = String(q || '').trim();
  if (q.length < 1) { toast('회계법인명을 한 글자 이상 넣어 주세요.'); return; }
  list.innerHTML = '<div class="loading">찾는 중…</div>'; count.textContent = '';
  $('reportsBox').hidden = true;
  try {
    const r = await api.get(`/qc/firms?${new URLSearchParams({ q })}`);
    const items = r.items || [];
    count.textContent = items.length ? `회계법인 ${items.length}곳` : '찾은 회계법인이 없습니다';
    list.innerHTML = items.length ? items.map(f => `<button type="button" class="case-item firm-item" data-code="${esc(f.corp_code)}" data-name="${esc(f.corp_name)}"><span class="case-title">${esc(f.corp_name)}</span><span class="code">${esc(f.corp_code)}</span></button>`).join('')
      : '<div class="empty">이름을 다르게 넣어 보세요(예: 「삼일」·「신한」). 감사반은 공시 대상이 아닙니다.</div>';
    list.querySelectorAll('[data-code]').forEach(b => b.addEventListener('click', () => pickFirm(b.dataset.code, b.dataset.name, b)));
    if (items.length === 1) list.querySelector('[data-code]').click();
  } catch (e) { list.innerHTML = `<div class="error">${esc(describe(e))}</div>`; count.textContent = ''; }
}

async function pickFirm(code, name, button) {
  document.querySelectorAll('#firmList .case-item').forEach(b => b.classList.toggle('active', b === button));
  state.firm = { corp_code: code, corp_name: name }; state.report = null; state.profile = null;
  const box = $('reportsBox'), list = $('reportList'); box.hidden = false;
  $('reportsTitle').textContent = `${name} 사업보고서`; list.innerHTML = '<div class="loading">전자공시에서 목록을 받는 중…</div>';
  try {
    const r = await api.get(`/qc/firms/${code}/reports?years=3`);
    /* 최신 3개 사업연도만(정정본 포함) — 2026-10-08 사용자 지정(두 화면 공통) */
    const keep = [...new Set((r.items || []).map(x => x.period))].sort().reverse().slice(0, 3);
    state.reports = (r.items || []).filter(x => keep.includes(x.period));
    renderReports();
  } catch (e) { list.innerHTML = `<div class="error">${esc(describe(e))}</div>`; }
}

function renderReports() {
  const list = $('reportList');
  if (!state.reports.length) { list.innerHTML = '<div class="empty">최근 3개 사업연도의 회계법인사업보고서가 없습니다.</div>'; return; }
  list.innerHTML = state.reports.map(r => `<div class="report-row${state.report && state.report.rcept_no === r.rcept_no ? ' active' : ''}" data-no="${esc(r.rcept_no)}">
      <div class="rn"><a class="rn-link" href="${esc(r.viewer_url)}" target="_blank" rel="noopener" title="전자공시에서 이 사업보고서 열기"><b>${esc(periodLabel(r.period))}</b> ${esc(r.report_nm)}</a>${r.corrected ? '<span class="corr">정정</span>' : ''}</div>
      <div class="acts"><button type="button" data-pdf="${esc(r.rcept_no)}" title="이 사업보고서 본문 PDF 를 전자공시에서 내려받습니다">사업보고서<br>(PDF)</button><button type="button" class="primary" data-apply="${esc(r.rcept_no)}" title="이 사업보고서를 당기로 (붙임1) 감사인 개요를 읽어 오른쪽에 보여 줍니다">내역 보기</button></div>
      <div class="rd">접수 ${esc(r.rcept_dt)} · <a href="${esc(r.viewer_url)}" target="_blank" rel="noopener">전자공시 바로가기 ↗</a></div>
    </div>`).join('');
  list.querySelectorAll('[data-pdf]').forEach(b => b.addEventListener('click', () => downloadPdf(b.dataset.pdf, b)));
  list.querySelectorAll('[data-apply]').forEach(b => b.addEventListener('click', () => loadProfile(b.dataset.apply, b)));
}

async function downloadPdf(no, button) {
  /* 정적 사이트: PDF 는 서버가 공시뷰어에서 받아야 해서, 전자공시 화면을 새 창으로 연다(거기서 [다운로드]) */
  if (STATIC) { window.open(`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${no}`, '_blank', 'noopener'); return; }
  const was = button.textContent; button.disabled = true; button.textContent = '받는 중…';
  try {
    const res = await fetch(`/api/v1/qc/reports/${no}/pdf`, { credentials: 'same-origin' });
    if (!res.ok) { let d = null; try { d = (await res.json()).detail; } catch { /* */ } throw new Error(typeof d === 'string' ? d : `내려받지 못했습니다(${res.status})`); }
    const blob = await res.blob(); const name = decodeURIComponent(res.headers.get('X-Dart-File') || '') || `회계법인사업보고서_${no}.pdf`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    toast(`${name} 내려받았습니다.`);
  } catch (e) { await showAlert(describe(e), { title: '사업보고서(PDF)' }); }
  finally { button.disabled = false; button.textContent = was; }
}

/* ── (붙임1) ── */
async function loadProfile(no, button) {
  const r = state.reports.find(x => x.rcept_no === no); if (!r || !state.firm) return;
  const was = button.textContent; button.disabled = true; button.textContent = '읽는 중…';
  $('welcome').hidden = true; const d = $('detail'); d.hidden = false; d.innerHTML = '<div class="loading">사업보고서 원문을 읽어 (붙임1) 값을 뽑는 중… (전년도 보고서도 함께 읽습니다)</div>';
  try {
    state.profile = await api.get(`/qc/reports/${no}/profile?corp_code=${state.firm.corp_code}`); state.report = r;
    renderReports(); renderDetail();
  } catch (e) { d.innerHTML = `<div class="error">${esc(describe(e))}</div>`; }
  finally { button.disabled = false; button.textContent = was; }
}

function cell(v, cls = '') { const miss = v === '-' ? ' miss' : ''; return `<td class="${cls}${miss}">${esc(v)}</td>`; }
function renderDetail() {
  const p = state.profile; const g = grids(p); const d = $('detail');
  const x = p.external_audit_count || [];
  const G = g.general.rows, F = g.finance.rows;
  const generalHtml = `<table class="qc"><tbody>
    <tr><td class="lab">${esc(G[0][0])}</td>${cell(G[0][1], 'l')}<td class="lab">${esc(G[0][2])}</td>${cell(G[0][3])}</tr>
    <tr><td class="lab">${esc(G[1][0])}</td><td class="l" colspan="3">${esc(G[1][1])}</td></tr>
    <tr><td class="lab">${esc(G[2][0])}</td>${cell(G[2][1], 'l')}<td class="lab">${esc(G[2][2])}</td>${cell(G[2][3])}</tr>
    <tr><td class="lab">${esc(G[3][0])}</td>${cell(G[3][1], 'l')}<td class="lab">${esc(G[3][2])}</td>${cell(G[3][3])}</tr>
  </tbody></table>
  <table class="qc" style="margin-top:-1px"><tbody>
    <tr><td class="vl" rowspan="7">감사실적</td><th colspan="2">사업연도</th><th>${esc(G[4][2])}</th><th>${esc(G[4][3])}</th><td class="vl" rowspan="7">인원현황</td><th>사업연도</th><th>${esc(G[4][6])}</th><th>${esc(G[4][7])}</th></tr>
    ${[5, 6, 7, 8, 9, 10].map(i => { const r = G[i]; const vl = i === 5 ? '<td class="lab" rowspan="3">개별</td>' : i === 8 ? '<td class="lab" rowspan="3">연결</td>' : ''; return `<tr>${vl}<td class="lab">${esc(r[1])}</td>${cell(r[2], 'num')}${cell(r[3], 'num')}<td class="lab">${esc(r[5])}</td>${cell(r[6], 'num')}${cell(r[7], 'num')}</tr>`; }).join('')}
  </tbody></table>`;
  const financeHtml = `<table class="qc"><tbody>
    <tr><td class="vl" rowspan="7">주요재무상황</td><th>${esc(F[0][1])}</th><th>${esc(F[0][2])}</th><th>${esc(F[0][3])}</th><td class="vl" rowspan="7">부문별매출현황</td><th>${esc(F[0][5])}</th><th>${esc(F[0][6])}</th><th>${esc(F[0][7])}</th></tr>
    ${F.slice(1).map(r => `<tr><td class="lab">${esc(r[1])}</td>${cell(r[2], 'num')}${cell(r[3], 'num')}<td class="lab">${esc(r[5])}</td>${cell(r[6], 'num')}${cell(r[7], 'num')}</tr>`).join('')}
  </tbody></table>`;
  const warn = (p.warnings || []).length ? `<div class="qc-warn"><b>읽지 못한 값이 있습니다</b> — 「-」로 두었습니다. 사업보고서 원문(전자공시)에서 직접 확인하세요.<ul>${p.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '';
  const checks = (p.checks || []).length ? `<div class="qc-check"><button type="button" class="qc-x" onclick="this.parentNode.remove()" title="닫기">닫기 ×</button><b>확인 필요</b><ul>${p.checks.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '';
  const prevNote = p.prev ? `전기 인원현황은 ${esc(p.prev.report_nm)}(접수 ${esc(p.prev.rcept_no)})에서 읽었습니다.` : '전년도 사업보고서가 없어 인원현황 전기는 비어 있습니다.';
  d.innerHTML = `
    <div class="qc-head"><div><h2>(붙임1) 감사인 개요 — ${esc(p.corp_name)}</h2><div class="sub">${esc(p.report_nm)} · 접수 ${esc(p.rcept_no)} · 당기 ${esc(periodLabel(p.period))} / 전기 ${esc(periodLabel(p.prev_period))}</div></div>
      <div class="qc-actions"><button type="button" id="btnCopy" title="두 표와 외부감사대상회사 수를 탭 구분 글로 복사합니다 — 엑셀에 그대로 붙여넣기">엑셀 복사</button>${DEV && !STATIC ? '<button type="button" id="btnJson" title="이 회계법인 정보((붙임1) 값)를 파일(.json)로 받습니다 — GitHub 사이트의 [회계법인 정보 불러오기]에서 씁니다">정보 내보내기(JSON)</button>' : ''}${DEV ? '<button type="button" id="tplDraft" class="draft-red" title="조직 부분·개별 부문의 체크리스트에서 지적사항을 골라 표준문안으로 심의안 초안(hwpx)과 품질관리수준 평가표(엑셀)를 만듭니다">심의안 초안 작성</button><button type="button" class="primary" id="btnFill" title="심의안 서식(hwpx)에 이 값을 채워 내려받습니다">심의안에 반영</button>' : ''}</div></div>
    ${warn}${checks}
    ${DEV ? '<div class="qc-tpl" id="tplBar"></div>' : ''}
    <div class="qc-count"><span>전자공시 개별 외부감사보고서 기준 — 당기 <b class="cur" id="dcCur">…</b>사<span id="dcSub" class="dc-sub"></span> · 전기 <b id="dcPrev">…</b>사<span id="dcCmp" class="dc-cmp"></span></span><button type="button" id="btnFold" class="fold-btn" hidden title="대사 내역 접기/펴기" aria-label="대사 내역 접기/펴기">−</button><button type="button" id="btnRecon" class="recon-btn" title="전자공시에 이 회계법인이 제출인으로 올린 감사보고서 목록을 보고 엑셀로 받거나, 피외감대상회사 목록과 맞춰 봅니다">외감회사대사</button></div>
    <div id="reconPanel" class="recon" hidden></div>
    <div class="qc-sec"><span>${esc(g.overview.title)}</span><span class="unit">${esc(g.overview.unit)}</span></div>
    ${(() => { const O = g.overview.rows; const v = (r) => `<td class="l${r[1] === '-' ? ' miss' : ''}">${esc(r[1])}${r[2] ? ` <small class="src">${esc(r[2])}</small>` : ''}</td>`;
      /* 등록번호 두 줄 + 「(현) 대표이사 | 품질관리실장」 한 행(사용자 지정 2026-10-08) */
      return `<table class="qc qc-overview"><tbody><tr><td class="lab">${esc(O[0][0])}</td>${v(O[0])}<td class="lab">${esc(O[1][0])}</td>${v(O[1])}</tr><tr><td class="lab">${esc(O[2][0])}</td>${v(O[2])}<td class="lab">${esc(O[3][0])}</td>${v(O[3])}</tr></tbody></table>`; })()}
    <div class="qc-sec"><span>${esc(g.general.title)}</span><span class="unit">${esc(g.general.unit)}</span></div>${generalHtml}
    <div class="qc-sec"><span>${esc(g.finance.title)}</span><span class="unit">${esc(g.finance.caption)} · ${esc(g.finance.unit)}</span></div>${financeHtml}
    <p class="qc-note">${prevNote} 재무·감사실적의 전기는 같은 보고서의 전기 열입니다. 금액은 원 단위를 백만원으로 반올림했습니다.</p>
    ${DEV ? basicPanelHtml() : ''}`;
  markSums(d);
  wireDetail();
}
/* 소계·합계 칸(라벨과 그 오른쪽 숫자 칸)을 연한 회색으로 — 화면에만, 엑셀 복사는 글만(사용자 지정 2026-10-08) */
function markSums(root) {
  root.querySelectorAll('table.qc td.lab').forEach(td => {
    if (!/^(소\s*계|합\s*계)$/.test(td.textContent.trim())) return;
    td.classList.add('sum');
    for (let n = td.nextElementSibling; n && !n.classList.contains('lab') && !n.classList.contains('vl'); n = n.nextElementSibling) n.classList.add('sum');
  });
}
function wireDetail() {
  const p = state.profile;
  $('btnCopy').addEventListener('click', () => copyText(tsv(p), '(붙임1) 표를 복사했습니다. 엑셀에 붙여넣으세요.'));
  $('btnJson')?.addEventListener('click', () => {   /* GitHub(정적) 사이트로 가져갈 회계법인 정보 */
    const data = { kind: 'qc-profile', saved: new Date().toISOString(), firm: state.firm, report: state.report, reports: state.reports, profile: p };
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `회계법인정보_${String(p.corp_name || '').replace(/[\\/:*?"<>|]/g, '_')}_${p.period}.json`; document.body.append(a); a.click(); a.remove();
    toast('회계법인 정보를 내보냈습니다. GitHub 사이트의 [회계법인 정보 불러오기]에서 쓰세요.');
  });
  /* [+/−] 와 [외감회사대사] 둘 다 대사 내역을 접고 편다(사용자 지정 2026-10-08) — [+/−] 는 한 번 연 뒤부터 보인다 */
  const toggle = () => { const pn = $('reconPanel'); pn.hidden = !pn.hidden; if (!pn.hidden && !pn.dataset.ready) renderRecon(); syncFold(); };
  $('btnRecon').addEventListener('click', toggle);
  $('btnFold').addEventListener('click', toggle);
  syncFold();
  if ($('reconPanel') && $('reconPanel').dataset.ready) wireRecon();   /* [← BACK] 으로 innerHTML 을 되돌리면 단추의 클릭 연결이 사라진다 — 다시 묶는다(①②③ 이 한 번만 되던 원인) */
  if (DEV) { $('btnFill').addEventListener('click', fillDialog); $('tplDraft').addEventListener('click', startDraft); wireBasic(); renderTplBar(); }
  loadDartCounts();
}

function syncFold() {
  const pn = $('reconPanel'), f = $('btnFold'); if (!pn || !f) return;
  f.hidden = !pn.dataset.ready; f.textContent = pn.hidden ? '+' : '−'; f.title = pn.hidden ? '대사 내역 펴기' : '대사 내역 접기';
}

/* ── 외감회사대사(2026-10-08) — 안내창 → 제출 목록 파일 고르기 → 전자공시 제출인명 검색과 대사 → 결과 화면([← BACK] 으로 되돌아옴) ── */
const recon = { result: null, file: null, grouped: null };
function reconFiler() { const el = document.getElementById('rcFiler'); return (el ? el.value.trim() : String(state.profile.corp_name || '')).replace(/\s+/g, ''); }
function renderRecon() {   /* 목록 먼저 보고(제출인명·기간 손볼 수 있게) → [③피외감회사 엑셀과 대사] */
  const pn = $('reconPanel'); pn.dataset.ready = '1'; const { start, end, max_period } = reconPeriod();
  pn.innerHTML = `<div class="recon-row"><label>제출인명 <input id="rcFiler" value="${esc(String(state.profile.corp_name || '').replace(/\s+/g, ''))}" placeholder="회계법인나루 (빈칸 없이)"></label>
      <label>접수일 <input id="rcStart" type="date" value="${start}"> ～ <input id="rcEnd" type="date" value="${end}"></label>
      <label>결산기 <input id="rcMin" value="${esc(minPeriod(max_period))}" placeholder="2025.01" style="width:70px" title="집계·대사 대상 결산기의 하한 — 최근 사업연도 전부(기본: 상한 연도의 전년 1월). 그 앞 결산(과거 연도 정정 등)은 엑셀 연도 시트에만"> ～ <input id="rcMax" value="${esc(max_period)}" placeholder="2026.03" style="width:70px" title="회계법인 사업연도 말까지의 결산기만(그 뒤 결산은 뺌)"></label></div>
    <div class="recon-row recon-btns"><button type="button" id="rcSearch" class="primary">①공시 목록 조회</button><button type="button" id="rcXlsx" disabled>②공시목록 엑셀down</button><button type="button" id="rcRecon" title="회계법인 사전제출자료에서 (당기)외감대상회사리스트만 A열에 있는 엑셀파일과 대사" class="primary" disabled>③피외감회사 엑셀과 대사</button><button type="button" id="rcReset" class="rc-reset" title="새로고침 — 입력칸을 기본값으로 되돌리고 조회 결과를 지웁니다" aria-label="새로고침"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg></button></div>
    <div id="rcSummary" class="recon-sum"></div>`;
  wireRecon();
}
function wireRecon() {
  $('rcSearch').addEventListener('click', reconSearch);
  $('rcReset').addEventListener('click', () => { recon.grouped = null; recon.result = null; recon.file = null; renderRecon(); loadDartCounts(); });
  $('rcXlsx').addEventListener('click', async () => { try { await reconDownload(`/api/v1/qc/audited.xlsx?${reconQuery()}`); } catch (e) { await showAlert(describe(e), { title: '공시목록 엑셀down' }); } });
  $('rcRecon').addEventListener('click', startRecon);
}
function reconQuery() { const { start, end, max_period, min_period } = reconPeriod(); return new URLSearchParams({ filer: reconFiler(), start, end, max_period, min_period }).toString(); }
/* 집계 하한 결산기 = 상한 연도의 전년 1월(2026.03 → 2025.01: 최근 사업연도 + 상한까지 석 달) — 사용자 지정 2026-10-08 */
function minPeriod(maxP) { const y = /^(\d{4})\.\d{2}$/.exec(String(maxP || '')); return `${(y ? Number(y[1]) : new Date().getFullYear()) - 1}.01`; }
async function reconSearch() {
  const b = $('rcSearch'); b.disabled = true; b.textContent = '검색 중…'; $('rcSummary').innerHTML = '<div class="loading">전자공시 공시통합검색을 제출인명으로 훑는 중…</div>';
  try {
    recon.grouped = await api.get(`/qc/audited?${reconQuery()}`); const ys = (recon.grouped.years || []).filter(y => y.indi_count + y.con_count > 0); const tot = ys.reduce((a, y) => a + y.indi_count, 0);   /* 과거 결산 연도(전부 제외)는 화면에서 빼고 엑셀에만(사용자 지정 2026-10-08) */
    $('rcSummary').innerHTML = ys.length ? `<table class="qc"><thead><tr><th>결산 연도</th><th>개별 감사보고서</th><th>연결감사보고서</th></tr></thead><tbody>${ys.map(y => `<tr><td>${y.year}</td><td class="num">${y.indi_count}</td><td class="num">${y.con_count}</td></tr>`).join('')}${ys.length > 1 ? `<tr><td class="lab">합계</td><td class="num"><b>${tot}</b></td><td class="num">${ys.reduce((a, y) => a + y.con_count, 0)}</td></tr>` : ''}</tbody></table><p class="qc-note">보고서 = 회사+결산기(같은 회사를 두 번 감사하면 둘) · 정정본은 최신 것 하나 · 회계법인 자기 사업보고서 제외 · 제출인명 「${esc(recon.grouped.filer)}」 접수 ${esc(recon.grouped.start)}～${esc(recon.grouped.end)}${reconPeriod().max_period ? ` · 결산 ${esc(reconPeriod().min_period)}～${esc($('rcMax').value)}만 집계(그 앞 결산은 엑셀에만)` : ''}</p>` : '<div class="empty">그 기간에 이 제출인명으로 올라온 감사보고서가 없습니다. 제출인명(빈칸 없이)을 확인하세요.</div>';
    $('rcXlsx').disabled = !ys.length; $('rcRecon').disabled = !ys.length;
    setDartCur(recon.grouped);
  } catch (e) { $('rcSummary').innerHTML = `<div class="error">${esc(describe(e))}</div>`; }
  finally { b.disabled = false; b.textContent = '①공시 목록 조회'; }
}
/* 외부감사대상회사 수 = 전자공시 개별 감사보고서(회사 단위) 기준 — 당기 = 접수 최근 1년·결산 ~사업연도 말, 전기 = 한 해 앞 창(사용자 지정 2026-10-08, 두 화면 공통).
 * 사업보고서 감사실적 숫자는 괄호로 옆에. 같은 회계법인·사업연도는 한 번만 센다(메모리). */
const dcCache = new Map();
function dcWindows() {
  const { start, end, max_period, min_period } = reconPeriod();
  const pm = /^(\d{4})\.(\d{2})$/.exec(max_period); const prevMax = pm ? `${Number(pm[1]) - 1}.${pm[2]}` : ''; const prevMin = minPeriod(prevMax);
  /* 전기도 접수일은 결산기 하한 1일부터 오늘까지(늦게 낸 보고서·정정본까지) — 결산기 범위가 묶는다 */
  return { cur: { start, end, max_period, min_period: min_period || minPeriod(max_period) }, prev: { start: `${prevMin.slice(0, 4)}-${prevMin.slice(5, 7)}-01`, end, max_period: prevMax, min_period: prevMin } };
}
const dcVal = { cur: undefined, prev: undefined };
function setDc(id, n, title) {
  const el = document.getElementById(id); if (el) { el.textContent = n == null ? '-' : fmtCnt(n) === '-' ? '0' : fmtCnt(n); if (title) el.title = title; }
  dcVal[id === 'dcCur' ? 'cur' : 'prev'] = n; dcCompare(); dcSubRender();
}
/* 대사한 뒤(개발 화면, 사용자 지정 2026-10-08): 같은 창으로 대사했으면 당기 숫자는 대사 결과의 전자공시 회사 수(상세 조회로 바뀐 것까지),
 * 옆에 「(제출명세 N사 일치/차이)」. 사업보고서 감사실적 견줌(⇔)은 그대로 사업보고서 숫자 */
function reconCur() {
  const r = recon.result, q = recon.params; if (!DEV || !r || !q || q.firm !== state.profile.corp_code) return undefined;
  const w = dcWindows().cur; const mn = (x) => x || minPeriod(w.max_period);
  return q.start === w.start && q.end === w.end && q.max_period === w.max_period && mn(q.min_period) === mn(w.min_period) ? r.counts.dart : undefined;
}
function dcSubRender() {
  const el = document.getElementById('dcSub'); if (!el) return;
  const r = recon.result; const n = reconCur();
  if (n === undefined || !r) { el.innerHTML = ''; return; }
  const sub = r.counts.submitted; const same = Number(sub) === Number(dcVal.cur);
  el.innerHTML = ` <span class="${same ? 'dc-ok' : 'dc-diff'}" title="외감회사대사 「${esc(recon.file ? recon.file.name : '')}」 — 제출 목록을 같은 이름끼리 묶은 회사 수">(제출명세 ${esc(fmtCnt(sub) === '-' ? '0' : fmtCnt(sub))}사 ${same ? '일치' : '차이'})</span>`;
}
/* 사업보고서 감사실적과 견줌(사용자 지정 2026-10-08): 둘 다 같으면 안 보임, 다르면 「 ⇔ (사업보고서 감사실적 당기 XX · 전기 XX)」 에 다른 쪽 숫자를 빨갛게 */
function dcCompare() {
  const el = document.getElementById('dcCmp'); if (!el) return;
  if (dcVal.cur === undefined || dcVal.prev === undefined) { el.innerHTML = ''; return; }
  const x = state.profile.external_audit_count || []; const rep = [Number(x[0] ?? NaN), Number(x[1] ?? NaN)];
  const dc = [dcVal.cur, dcVal.prev].map(v => (v == null ? NaN : Number(v)));
  const diff = [0, 1].map(i => !(Number.isFinite(rep[i]) && Number.isFinite(dc[i]) && rep[i] === dc[i]));
  if (!diff[0] && !diff[1]) { el.innerHTML = ''; return; }
  const n = (i) => `<span class="${diff[i] ? 'dc-diff' : ''}">${esc(Number.isFinite(rep[i]) ? fmtCnt(rep[i]) : '-')}</span>`;
  el.innerHTML = ` &nbsp;⇔&nbsp; <span class="dc-rep" title="회계법인사업보고서 Ⅱ.2.가 감사실적 총괄표의 개별 합계">(사업보고서 감사실적 당기 ${n(0)} · 전기 ${n(1)})</span>`;
}
function setDartCur(grouped) { const w = dcWindows().cur; setDc('dcCur', grouped.indi_companies, `접수 ${grouped.start}～${grouped.end} · 결산 ${grouped.min_period || w.min_period}～${w.max_period} · 회사 단위(보고서 여럿이면 1)`); }
async function loadDartCounts() {
  if (!document.getElementById('dcCur')) return;
  dcVal.cur = dcVal.prev = undefined;
  const w = dcWindows(); const filer = String(state.profile.corp_name || '').replace(/\s+/g, '');
  const key = (x) => `${filer}|${x.start}|${x.end}|${x.max_period}|${x.min_period}`;
  const one = async (x) => {
    if (dcCache.has(key(x))) return dcCache.get(key(x));
    const p = api.get(`/qc/audited?${new URLSearchParams({ filer, ...x })}`).then(g => g.indi_companies);
    dcCache.set(key(x), p); p.catch(() => dcCache.delete(key(x))); return p;
  };
  const tip = (x) => `접수 ${x.start}～${x.end} · 결산 ${x.min_period}～${x.max_period} · 회사 단위(보고서 여럿이면 1)`;
  one(w.cur).then(n => { const rc = reconCur(); setDc('dcCur', rc ?? n, rc !== undefined ? `${tip(w.cur)} · 외감회사대사 결과` : tip(w.cur)); }).catch(() => setDc('dcCur', null, '전자공시 검색에 실패했습니다'));
  one(w.prev).then(n => setDc('dcPrev', n, tip(w.prev))).catch(() => setDc('dcPrev', null, '전자공시 검색에 실패했습니다'));
}
function reconPeriod() {   /* 패널에 입력칸이 있으면 그 값, 없으면 기본(접수 최근 1년 · 결산 ≤ 사업연도 말) */
  const el = (id) => document.getElementById(id);
  if (el('rcStart') && el('rcEnd')) { const mx = el('rcMax') ? el('rcMax').value.trim() : ''; return { start: el('rcStart').value, end: el('rcEnd').value, max_period: mx, min_period: (el('rcMin') ? el('rcMin').value.trim() : '') || minPeriod(mx) }; }
  const f = state.profile.fiscal || {}; const toIso = (t) => { const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})/.exec(String(t || '')); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : ''; };
  const iso = (d) => d.toISOString().slice(0, 10); const today = new Date();
  const s = toIso(f.start), e = toIso(f.end);
  /* 결산기는 하한(상한 연도의 전년 1월)～회계법인 사업연도 말, 접수일은 **결산기 하한의 1일부터 오늘까지** —
   * 「최근 1년」으로 자르면 결산 2025.06 처럼 범위 안 결산인데 2025.09 에 접수된 보고서가 빠졌다(다현 나비스오토모티브시스템즈, 2026-10-08 고침) */
  const mx = e ? e.slice(0, 7).replace('-', '.') : ''; const mn = minPeriod(mx);
  return { start: `${mn.slice(0, 4)}-${mn.slice(5, 7)}-01`, end: iso(today), max_period: mx, min_period: mn };
}
async function startRecon() {
  const ok = await showConfirm('당기 감사인이 제출한 피외감대상회사명만 있는 엑셀파일과 DART에 제출회계법인으로 조회되는 회사의 리스트를 대사합니다.\n당기 피외감대상 회사명이 있는 엑셀파일을 선택해주세요.\n(감사인에 제출한 사전제출엑셀 이외 피외감대상회사명만 있는 별도 엑셀파일 대사를 추천)', { title: '외감회사대사', okText: '확인' });
  if (!ok) return;
  const file = await pickFile('.xlsx,.csv,.txt'); if (!file) return;
  recon.file = file; await runRecon();
}
async function runRecon() {
  const d = $('detail');
  d.querySelectorAll('#reconPanel input').forEach(i => i.setAttribute('value', i.value));   /* BACK 뒤에도 고친 입력값이 남게 */
  if (!d.dataset.saved) d.dataset.saved = d.innerHTML;   /* [← BACK] 으로 되돌릴 화면 — 단추가 「대사 중…」으로 바뀌기 전에 담는다 */
  const b = $('rcRecon') || $('btnRecon'); const was = b.textContent; b.disabled = true; b.textContent = '대사 중…';
  const { start, end, max_period, min_period } = reconPeriod();
  recon.params = { filer: reconFiler(), start, end, max_period, min_period: min_period || '', firm: state.profile.corp_code || '' };   /* 결과 화면에서 다시 셀 때·엑셀 받을 때 같은 조건으로 */
  try { recon.result = await api.upload('/qc/reconcile', reconForm()); showReconView(); }   /* 숫자 줄은 BACK 때 loadDartCounts → reconCur 로 맞춘다 */
  catch (e) { await showAlert(describe(e), { title: '외감회사대사' }); }
  finally { b.disabled = false; b.textContent = was; }
}
/* 「같은 회사로 등록」 짝 — 서버에 두지 않고 이 PC(브라우저)에 회계법인별로(사용자 지정 2026-10-08). 대사할 때마다 실어 보낸다 */
const ALIAS_KEY = () => `qc.alias.${state.profile.corp_code}`;
function aliasPairs() { try { return JSON.parse(localStorage.getItem(ALIAS_KEY()) || '[]') || []; } catch { return []; } }
function addAliasPair(dart, submitted) { const xs = aliasPairs().filter(x => !(x.dart === dart && x.submitted === submitted)); xs.push({ dart, submitted }); try { localStorage.setItem(ALIAS_KEY(), JSON.stringify(xs.slice(-500))); } catch { /* */ } }
function reconForm(asXlsx = false) {
  const p = recon.params; const fd = new FormData(); fd.append('file', recon.file, recon.file.name); fd.append('year', '-1');
  for (const [k, v] of Object.entries(p)) fd.append(k, v);
  fd.append('aliases', JSON.stringify(aliasPairs()));
  if (asXlsx) fd.append('as_xlsx', 'true');
  return fd;
}
/* [같은 회사로 등록] 뒤 같은 조건으로 다시 대사해 그 자리에서 숫자·표를 고친다(BACK 뒤 요약도 새 숫자) — 사용자 지정 2026-10-08 */
async function rerunQuiet() {
  try { const y = window.scrollY; recon.result = await api.upload('/qc/reconcile', reconForm()); showReconView({ keep: true }); window.scrollTo(0, y); }
  catch (e) { toast('다시 대사하지 못했습니다: ' + describe(e)); }
}
/* BACK 으로 돌아온 화면의 대사 패널에 최근 대사 결과(차이 개수) */
function showLastRecon() {
  const r = recon.result; const box = document.getElementById('rcSummary'); if (!r || !box) return;
  const c = r.counts; const diff = c.dart - c.submitted;
  let el = document.getElementById('rcLast'); if (!el) { el = document.createElement('div'); el.id = 'rcLast'; el.className = 'rc-last'; box.after(el); }
  el.innerHTML = `<b>최근 대사</b> 「${esc(recon.file ? recon.file.name : '')}」 — 전자공시 ${c.dart}개 회사 · 제출 목록 ${c.submitted}개 회사${diff ? ` (<span class="bad">차이 ${diff > 0 ? '+' : ''}${diff}</span>)` : ' (<span class="ok">일치</span>)'} · 이름 일치 ${c.matched} · 공시에만 ${c.dart_only} · 목록에만 ${c.submitted_only} · 비슷한 이름 ${c.suggestions} <button type="button" id="rcLastOpen" class="rc-last-open">결과 다시 보기</button>`;
  document.getElementById('rcLastOpen').addEventListener('click', () => { const d = $('detail'); d.querySelectorAll('#reconPanel input').forEach(i => i.setAttribute('value', i.value)); d.dataset.saved = d.innerHTML; showReconView(); });
}
function showReconView(opts = {}) {
  const r = recon.result; const c = r.counts; const p = state.profile;
  const d = $('detail');
  const same = c.dart === c.submitted;
  const link = (e) => `<span class="rep">${e && e.indi ? `<a href="${esc(e.indi)}" target="_blank" rel="noopener">개별</a>` : ''}${e && e.con ? ` <a href="${esc(e.con)}" target="_blank" rel="noopener">연결</a>` : ''}</span>`;   /* 개별·연결 한 줄 */
  /* 표 모양(사용자 지정 2026-10-08): 구분 열은 묶음마다 한 칸으로 합치고, 묶음 머리줄 「[제출 목록에 없음] 누락·…」 를 그 위에 */
  const row = (a, b2, e, extra = '', act = '') => `<tr><td class="l">${esc(a || '')}</td><td class="l">${esc(b2 || '')}</td><td class="l">${link(e)}</td><td class="l">${esc(extra)}${act}</td></tr>`;
  const group = (title, head2, note, rows) => rows.length ? `<tr class="grp"><td colspan="5"><b>[${esc(head2)}]</b> ${esc(note)} — ${rows.length}건</td></tr>${rows.map((x, i) => i === 0 ? x.replace('<tr>', `<tr><td class="cat" rowspan="${rows.length}">${esc(title)}</td>`) : x).join('')}` : '';
  const same_btn = (s2) => ` <button type="button" class="recon-same" data-dart="${esc(s2.company)}" data-sub="${esc(s2.submitted)}" title="두 이름을 같은 회사로 봅니다 — 이 회계법인의 대사에만, 이 PC 에서만(서버 저장 없음)">같은 회사로 등록</button>`;
  const refs = r.matched.filter(m => m.name_differs || m.corrected || m.note);
  const head = '<table class="qc recon-table"><colgroup><col class="c-cat"><col class="c-name"><col class="c-name"><col class="c-rep"><col class="c-note"></colgroup><thead><tr><th>구분</th><th>공시 회사명</th><th>제출 목록 회사명</th><th>보고서</th><th>비고</th></tr></thead><tbody>';
  const suggRows = r.suggestions.map(s2 => row(s2.company, s2.submitted, s2, `${s2.why ? s2.why : `유사도 ${s2.score}`}${s2.note ? ' · ' + s2.note : ''}`, same_btn(s2)));
  const diffTable = same ? '' : `${head}
      ${group('공시에만 있음', '제출 목록에 없음', '누락 여부 확인', r.dart_only.map(e => row(e.company, '', e, e.note || '')))}
      ${group('제출 목록에만 있음', '공시 없음', '감사보고서 제출 여부 확인', r.submitted_only.map(n => row('', n, null)))}
      ${group('비슷한 이름', '같은 회사로 보이는 짝', '확인 필요 · 같으면 [같은 회사로 등록]', suggRows)}
      </tbody></table>`;
  const sugg = same && r.suggestions.length ? `${head}${group('비슷한 이름', '같은 회사로 보이는 짝', '확인 필요 · 같으면 [같은 회사로 등록]', suggRows)}</tbody></table>` : '';
  const refTable = refs.length ? `<div class="qc-sec"><span>참고 정보</span></div>${head.replace('class="qc recon-table"', 'class="qc recon-table ref"')}
      ${group('정정 공시 있음', '정정 공시', '정정본 기준', refs.filter(m => m.corrected && !m.name_differs).map(m => row(m.company, m.submitted, m, m.note || '')))}
      ${group('보고서가 여럿인 회사', '보고서 여럿', '회사 1개로 셈 · 주소는 최신 보고서', refs.filter(m => m.note && !m.name_differs && !m.corrected).map(m => row(m.company, m.submitted, m, m.note)))}
      ${group('회사명 표기 다름', '표기만 다름', '같은 회사로 셈(법인격·빈칸 차이는 제외)', refs.filter(m => m.name_differs).map(m => row(m.company, m.submitted, m, [m.corrected ? '정정 공시' : '', m.note].filter(Boolean).join(' · '))))}
      </tbody></table>` : '';
  const diff = c.dart - c.submitted;
  const verdict = same
    ? `✓ 회사 수 일치 — 전자공시 <b>${c.dart}</b>개 회사 = 제출 목록 <b>${c.submitted}</b>개 회사`
    : `✕ 회사 수 불일치 — 전자공시 <b>${c.dart}</b>개 회사, 제출 목록 <b>${c.submitted}</b>개 회사 (전자공시가 ${Math.abs(diff)}개 ${diff > 0 ? '많음' : '적음'})`;
  const verdictSub = `전자공시: 감사보고서 ${c.dart_reports}건을 회사 단위로 묶어 ${c.dart}개 회사 · 제출 목록: ${c.submitted_rows}줄을 같은 이름끼리 묶어 ${c.submitted}개 회사 · 이름이 맞은 회사 ${c.matched}개`
    + (c.matched === 0 && c.submitted ? `<br>⚠ 이름이 하나도 안 맞았습니다 — 목록 파일에서 읽은 이름: ${(r.submitted_sample || []).map(x => `「${esc(x)}」`).join(', ')}. 회사명이 아니면 회사명 열 머리글을 「회사명」으로 해 주세요.` : '');
  d.innerHTML = `
    <div class="qc-head"><div><button type="button" id="reconBack" class="recon-back">← BACK</button> <h2 style="display:inline">외감회사대사 — ${esc(p.corp_name)}</h2><div class="sub">전자공시 제출인명 「${esc(r.filer)}」 · 접수일 ${esc(r.start)}～${esc(r.end)} · 제출 목록 「${esc(recon.file.name)}」</div></div>
      <div class="qc-actions"><button type="button" id="reconXlsx" title="연도별 공시 회사 목록(개별·연결 감사보고서 주소)과 대사 시트가 든 엑셀">대사 결과 엑셀</button><button type="button" id="reconAgain">다른 파일로 다시 대사</button></div></div>
    <div class="recon-verdict ${same ? 'ok' : 'bad'}">${verdict}<div class="vsub">${verdictSub}</div></div>
    <p class="qc-note">접수일 ${esc(r.start)}～${esc(r.end)} · 결산기 ${esc(r.min_period || '')}～${esc(r.max_period || '제한 없음')}의 공시: ${(r.by_year || []).map(y => `결산 ${y.year}년 개별 ${y.indi_count}·연결 ${y.con_count}`).join(' / ')} — 정정본은 최신 것 하나로 세고, 한 회사의 보고서가 여럿(3개월·반기 결산)이면 회사 하나로 셉니다. ⚠ 제출인명 검색이라 <b>상장회사처럼 회사가 사업보고서에 붙여 제출한 감사보고서는 잡히지 않습니다</b>(제출인이 회사). 그런 회사는 「제출 목록에만 있음」으로 나올 수 있습니다. 회사명은 주식회사·유한회사·농업회사법인 등 표시, 빈칸, 괄호 안 옛 이름, 제이호↔제2호, 앤↔엔, 리츠↔부동산투자회사, 피에브이↔피에프브이↔PFV, 스펙↔SPEC, 케이비↔KB 를 같은 것으로 보고 맞췄고, 이 회계법인에서 [같은 회사로 등록]한 짝도 같은 회사로 봅니다.</p>
    ${same ? (sugg || (refs.length ? '' : '<div class="empty">이름이 다르게 표시되거나 정정된 회사도 없습니다.</div>')) : diffTable}
    ${refTable}`;
  $('reconBack').addEventListener('click', () => { d.innerHTML = d.dataset.saved; delete d.dataset.saved; wireDetail(); showLastRecon(); });
  d.querySelectorAll('.recon-same').forEach(b => b.addEventListener('click', async () => {
    const dart = b.dataset.dart, sub = b.dataset.sub;
    if (!(await showConfirm(`공시 「${dart}」 와 제출 목록 「${sub}」 를 같은 회사로 볼까요?\n${state.profile.corp_name} 의 대사에만, 이 PC 에서만 쓰입니다(서버에는 저장하지 않음).`, { title: '같은 회사로 등록', okText: '등록' }))) return;
    b.disabled = true;
    addAliasPair(dart, sub); b.textContent = '등록됨'; toast('같은 회사로 보고 다시 대사합니다…'); await rerunQuiet();
  }));
  $('reconAgain').addEventListener('click', async () => { const f = await pickFile('.xlsx,.csv,.txt'); if (!f) return; recon.file = f; d.innerHTML = d.dataset.saved; delete d.dataset.saved; wireDetail(); await runRecon(); });
  $('reconXlsx').addEventListener('click', async () => {
    const fd = reconForm(true);
    try { await reconDownload('/api/v1/qc/reconcile', fd); } catch (e) { await showAlert(describe(e), { title: '대사 결과 엑셀' }); }
  });
  if (!opts.keep) d.scrollIntoView({ block: 'start' });
}
async function reconDownload(url, body) {
  const res = await fetch(url, body ? { method: 'POST', body, credentials: 'same-origin' } : { credentials: 'same-origin' });
  if (!res.ok) { let dd = null; try { dd = (await res.json()).detail; } catch { /* */ } throw new Error(typeof dd === 'string' ? dd : `내려받지 못했습니다(${res.status})`); }
  const blob = await res.blob(); const cd = res.headers.get('Content-Disposition') || ''; const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = m ? decodeURIComponent(m[1]) : 'download.xlsx'; document.body.append(a); a.click(); a.remove();
}

/* ── 서식 ── */
async function loadTemplates() { try { state.templates = await api.get('/qc/templates'); } catch { /* 기본 서식으로 */ } }
function renderTplBar() {
  const bar = $('tplBar'); if (!bar) return;
  const t = state.templates; const active = (t.items || []).find(x => x.id === t.active_id);
  bar.innerHTML = `<span>심의안 서식:</span><span class="name">${active ? esc(active.name) + ` (${esc(active.date)}${active.by ? ' · ' + esc(active.by) : ''})` : '기본 서식(저장소)'}</span>
    <button type="button" id="tplGet" title="지금 쓰는 서식에 이 보고서 값과 기본 정보를 채워 내려받습니다(= 심의안에 반영)">서식 내려받기(값 채움)</button>
    ${state.admin ? `<button type="button" id="tplRaw" title="{{ }} 자리표시자가 그대로 든 서식 원본(관리자: 서식 손볼 때)">원본 서식</button><button type="button" id="tplChange" title="새 심의안 서식(hwpx)을 올립니다. {{ }} 가 없는 파일이면 지금 서식의 값 자리를 옮겨 심습니다">템플릿 변경</button>${active ? `<button type="button" id="tplDel" class="danger" title="이 서식을 지우고 이전 서식(없으면 기본 서식)으로 돌아갑니다">지우기</button>` : ''}` : ''}`;
  $('tplGet').addEventListener('click', () => fillTemplate(basicInputs()));

  $('tplRaw')?.addEventListener('click', async () => { const b = await templateBytes(); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([b])); a.download = active ? active.name : '심의안.hwpx'; document.body.append(a); a.click(); a.remove(); });
  $('tplChange')?.addEventListener('click', changeTemplate);
  $('tplDel')?.addEventListener('click', async () => { if (!(await showConfirm(`「${active.name}」 서식을 지울까요?`, { title: '서식 지우기', okText: '지우기', danger: true }))) return; try { await api.del(`/qc/templates/${active.id}`); await loadTemplates(); renderTplBar(); toast('지웠습니다.'); } catch (e) { toast('지우지 못했습니다: ' + describe(e)); } });
}
async function templateBytes() {
  const t = state.templates; const url = t.active_id ? `/api/v1/qc/templates/${t.active_id}` : (t.builtin || `${ASSET}qc/templates/심의안.hwpx`);
  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' }); if (!res.ok) throw new Error(`서식을 받지 못했습니다(${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}
function pickFile(accept) { return new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => res(i.files[0] || null); i.click(); }); }

/* ── 기본 정보(직접 입력) — 사업보고서로 알 수 없는 칸. 입력값은 이 PC(브라우저)에 남는다(사용자 지정 2026-10-08):
 *   공통(감리담당·실시기간·선정일)은 사람 것이라 한 벌, 등록번호·대상기간은 회계법인마다 한 벌 */
const BASIC_KEY = 'qc.basic', FIRM_KEY = (c) => `qc.firm.${c}`;
/* 감리대상 선정일은 서식(표준)에 있는 대로 두므로 입력칸에서 뺐다(사용자 지정 2026-10-08). 등록번호는 기업개황에서 못 받았을 때만 입력칸 */
const BASIC_FIELDS = [
  ['담당', '감리담당', '감리팀장 ○○○ 외 1명', 'common'], ['실시기간', '감리실시기간', '2026. 10. 00. ～ 2026. 10. 00.', 'common'],
  ['대상기간', '감리대상기간', '(사업연도에서 가져옴)', 'firm'], ['직전년도', '직전 감리년도', '20XX', 'firm'],
  ['사업자등록번호', '사업자등록번호', '000-86-00000', 'firm', 'nobiz'], ['법인등록번호', '법인등록번호', '000000-0000000', 'firm', 'nocorp'],
];
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch { return {}; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 사생활 모드 등 */ } };
function basicPanelHtml() {
  const p = state.profile; const g = p.general || {}; const saved = { ...lsGet(BASIC_KEY), ...lsGet(FIRM_KEY(p.corp_code)) };
  const auto = { 대상기간: fiscalSpan(p) };
  const fields = BASIC_FIELDS.filter(([, , , , cond]) => !cond || (cond === 'nobiz' && !g.biz_no) || (cond === 'nocorp' && !g.corp_no));
  const field = ([k, label, ph, scope]) => { const v = saved[k] ?? ''; const a = auto[k] || '';
    return `<label class="bf"><span class="bl">${label} <i class="tag ${v ? 'd' : a ? 'a' : ''}" title="${v ? '직접 입력한 값(이 PC에 저장)' : a ? '사업보고서에서 가져온 값 — 고치면 직접 입력이 됩니다' : '직접 입력'}">${v ? '직접' : a ? '자동' : '직접'}</i></span><input name="${k}" data-scope="${scope}" value="${esc(v || a)}" placeholder="${esc(ph)}"></label>`; };
  return `<div class="qc-basic"><div class="bh"><b>기본 정보(직접 입력)</b><span>서식에서 사업보고서로 알 수 없는 칸 — 한 번 넣으면 이 PC에 남습니다(감리담당·기간은 공통, 등록번호는 회계법인별). 비우면 서식의 보기값이 남습니다.</span></div>
    <div class="bg">${fields.map(field).join('')}</div>${g.biz_no || g.corp_no ? `<p class="bn">사업자등록번호 <b>${esc(g.biz_no || '-')}</b> · 법인등록번호 <b>${esc(g.corp_no || '-')}</b> — 기업개황(OpenDART)에서 가져와 별지2에 넣습니다.</p>` : ''}</div>`;
}
function basicInputs() {
  const p = state.profile; const g = p.general || {}; const inputs = {}; const common = lsGet(BASIC_KEY), firm = lsGet(FIRM_KEY(p.corp_code));
  const autos = { 대상기간: fiscalSpan(p) };
  document.querySelectorAll('.qc-basic input[name]').forEach(i => {
    const v = i.value.trim(); inputs[i.name] = v;
    const autoV = autos[i.name] || '';
    const store = i.dataset.scope === 'firm' ? firm : common;
    if (v && v !== autoV) store[i.name] = v; else delete store[i.name];
  });
  lsSet(BASIC_KEY, common); lsSet(FIRM_KEY(p.corp_code), firm);
  return inputs;
}
function wireBasic() {
  document.querySelectorAll('.qc-basic input[name]').forEach(i => i.addEventListener('change', () => { basicInputs(); const t = i.parentNode.querySelector('.tag'); if (t) { t.textContent = i.value.trim() ? '직접' : '직접'; t.className = 'tag ' + (i.value.trim() ? 'd' : ''); } }));
}
async function fillDialog() { await fillTemplate(basicInputs()); }
/* 내려받기·미리보기가 같은 바이트를 쓴다 */
async function draftFile(inputs, model) {
  const bytes = await assembled(model, inputs);
  const r = await window.HwpxFill.render(bytes, templateCtx(state.profile, inputs), {});
  const name = `심의안${model ? '_초안' : ''}_${String(state.profile.corp_name || '회계법인').replace(/[\\/:*?"<>|]/g, '_')}_${state.profile.period}.hwpx`;
  return { r, name };
}
/* 심의안(미리보기) — 내려받을 hwpx 를 그대로 서버(rhwp)에서 PDF 로 바꿔 창에 띄운다(사용자 지정 2026-10-08).
 * ⚠ rhwp 는 한글이 아니라 글꼴·줄바꿈이 한두 글자 다를 수 있다 — 최종 확인은 한글에서 */
async function previewDraft(model) {
  const t0 = Date.now(); toast(STATIC ? '심의안 미리보기를 만드는 중… (처음은 엔진을 받느라 20초 안팎)' : '심의안 미리보기를 만드는 중… (보통 5~10초)');
  try {
    const { r, name } = await draftFile(basicInputs(), model);
    const url = URL.createObjectURL(await api.postBlob('/agenda/hwp/pdf', r.bytes));
    const hurl = URL.createObjectURL(new Blob([r.bytes]));
    document.querySelectorAll('.qc-pdfview').forEach(x => x.remove());
    const ov = document.createElement('div'); ov.className = 'qc-pdfview';
    ov.innerHTML = `<div class="box"><div class="bar"><b>심의안(미리보기)</b><span class="help">${esc(name)} · ${((Date.now() - t0) / 1000).toFixed(1)}초 · ${STATIC ? '브라우저에서 그린 미리보기라' : '서버가 만든 PDF라'} 글꼴·줄바꿈이 한글과 조금 다를 수 있습니다</span>
      ${STATIC ? '<a href="#" data-print>인쇄(PDF 저장)</a>' : `<a href="${url}" download="${esc(name.replace(/\.hwpx$/, '.pdf'))}">PDF 저장</a>`}<a href="${hurl}" download="${esc(name)}" class="hw">hwpx 내려받기</a><button type="button" data-close>닫기</button></div>
      <iframe src="${url}#toolbar=1&view=FitH" title="심의안 미리보기"></iframe></div>`;
    document.body.append(ov);
    const close = () => { ov.remove(); URL.revokeObjectURL(url); URL.revokeObjectURL(hurl); };
    ov.querySelector('[data-print]')?.addEventListener('click', (e) => { e.preventDefault(); ov.querySelector('iframe').contentWindow.print(); });
    ov.querySelector('[data-close]').onclick = close; ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    if ((r.missing || []).length) toast(`값을 찾지 못해 그대로 둔 자리 ${r.missing.length}종: ${r.missing.slice(0, 8).join(', ')}`);
  } catch (e) { await showAlert(describe(e), { title: '심의안(미리보기)' }); }
}
async function fillTemplate(inputs, model = null) {
  const btn = $('btnFill'); const was = btn.textContent; btn.disabled = true; btn.textContent = '채우는 중…';
  try {
    const { r, name } = await draftFile(inputs, model);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.bytes])); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    const miss = (r.missing || []).length ? ` · 값을 찾지 못해 그대로 둔 자리 ${r.missing.length}종: ${r.missing.slice(0, 8).join(', ')}` : '';
    toast(`${name} · 자리표시자 ${(r.used || []).length}종 채움${miss}`);
  } catch (e) { await showAlert(describe(e), { title: '심의안에 반영' }); }
  finally { btn.disabled = false; btn.textContent = was; }
}

/* 서식에 초안 엔진(QcDraft)을 거친다: 대표이사·주사무소·직전 감리년도(20xx년) 손질, 모형이 있으면 지적사항 표·별지2·건수 문장·위반 혐의까지 */
async function assembled(model, inputs) {
  const bytes = await templateBytes();
  const Q = window.QcDraft, H = window.HWPX; if (!Q || !H) return bytes;
  const files = await H.unzip(bytes); const name = 'Contents/section0.xml'; if (!files[name]) return bytes;
  const sec = new TextDecoder().decode(files[name]);
  const header = files['Contents/header.xml'] ? new TextDecoder().decode(files['Contents/header.xml']) : '';
  const out = Q.assemble(sec, state.phrases || { org: { groups: [] }, indi: { parts: [], items: [] }, viol: {} }, model, { general: state.profile.general || {}, prevYear: (inputs || {}).직전년도 || '', header, audited: (state.profile.external_audit_count || [])[0] });
  const data = new TextEncoder().encode(out);
  const entries = Object.entries(files).map(([n, d]) => { const b = n === name ? data : d; return { name: n, method: 0, crc: H.crc32(b), csize: b.length, usize: b.length, data: b }; });
  return H.zip(entries);
}
/* 강평(초안) — 공통 강평자료 사전(qc_gangpyeong.json) + 체크 상태 → hwpx. 서식은 임시로 심의안 서식(감사반 강평 서식이 들어오면 바꿈) */
async function downloadGangpyeong(model) {
  try {
    if (!window.QcGang) throw new Error('강평 엔진(qc_gangpyeong.js)이 없습니다.');
    const res = await fetch(`${ASSET}qc/qc_gangpyeong.json`, { cache: 'no-store' }); if (!res.ok) throw new Error('강평 사전(qc_gangpyeong.json)을 받지 못했습니다.');
    const data = await res.json();
    const bytes = await templateBytes(); const H = window.HWPX; const files = await H.unzip(bytes); const name = 'Contents/section0.xml';
    const today = new Date(); const firm = firmName(state.profile.corp_name);
    const sec = window.QcGang.build(new TextDecoder().decode(files[name]), data, model, { firm, year: today.getFullYear(), date: `${today.getFullYear()}. ${today.getMonth() + 1}. ${today.getDate()}.` });
    const enc = new TextEncoder().encode(sec);
    const out = H.zip(Object.entries(files).map(([n, d]) => { const b = n === name ? enc : d; return { name: n, method: 0, crc: H.crc32(b), csize: b.length, usize: b.length, data: b }; }));
    const fn = `강평(초안)_${firm.replace(/[\\/:*?"<>|]/g, '_')}_${today.toISOString().slice(2, 10).replace(/-/g, '')}.hwpx`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out])); a.download = fn; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    toast(`${fn} — 서식은 임시(심의안 서식), 감사반 강평 서식이 들어오면 그 모양으로 바꿉니다.`);
  } catch (e) { await showAlert(describe(e), { title: '강평(초안)down' }); }
}
async function loadPhrases() { if (state.phrases) return state.phrases; const res = await fetch(`${ASSET}qc/qc_phrases.json`, { cache: 'no-store' }); if (!res.ok) throw new Error('표준문안 사전(qc_phrases.json)을 받지 못했습니다.'); state.phrases = await res.json(); return state.phrases; }
async function startDraft() {
  if (draftOpen()) { closeDraft(); return; }
  try { await loadPhrases(); } catch (e) { await showAlert(describe(e), { title: '심의안 초안 작성' }); return; }
  openDraft({ state, phrases: state.phrases, toast, showConfirm, showAlert, api, describe,
    downloadDraft: (model) => fillTemplate(basicInputs(), model),
    previewDraft: (model) => previewDraft(model),
    downloadGangpyeong: (model) => downloadGangpyeong(model),
    downloadEval: async (model, sel) => {
      const p = state.profile; const st = p.staff || {}, ac = (p.audit_counts || {}).indi || {}, seg = p.segments || {};
      const org = {}; for (const [k, v] of Object.entries((sel.org || {}).items || {})) if (v && v.cls && v.cls !== '미지적') org[k] = v.cls;
      const indi = {}; for (const it of model.indi.items) indi[it.key] = it.perCo;
      const its = (sel.indi || {}).items || {}; const indi_subs = { i11: (its.i11 || {}).subs || {}, i16: (its.i16 || {}).subs || {}, i17: (its.i17 || {}).subs || {} };   /* ⑩·⑮ 하위 줄 */
      const viol = {}; for (const r of model.score.violRows) viol[r.row] = { n: r.n, pts: r.pts };
      const body = { firm: firmName(p.corp_name), period: periodLabel(p.period), prev_period: periodLabel(p.prev_period), cpa: st.cpa_sub || [], audited: ac.total || [], fee: [(seg.audit_ext || {}).amount ?? null, null],
        companies: (sel.indi.companies || []).map((c, i) => c || `회사${i + 1}`), org, indi, indi_subs, viol, level: model.score.level, level_reason: (sel.org || {}).reason || '' };
      try {
        let blob, fname = `품질관리수준평가표_${String(body.firm || '회계법인').replace(/[\\/:*?"<>|]/g, '_')}_${new Date().toISOString().slice(2, 10).replace(/-/g, '')}.xlsx`;
        if (STATIC) { toast('평가표를 만드는 중… (처음은 엑셀 엔진을 받느라 20초 안팎)'); blob = await window.QcStatic.evalXlsx(body); }
        else {
          const res = await fetch('/api/v1/qc/eval.xlsx', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          if (!res.ok) { let dd = null; try { dd = (await res.json()).detail; } catch { /* */ } throw new Error(typeof dd === 'string' ? dd : `평가표를 만들지 못했습니다(${res.status})`); }
          blob = await res.blob(); const cd = res.headers.get('Content-Disposition') || ''; const m = /filename\*=UTF-8''([^;]+)/.exec(cd); if (m) fname = decodeURIComponent(m[1]);
        }
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; document.body.append(a); a.click(); a.remove();
        toast(`평가표 ${a.download} · 점수 ${model.score.total.toFixed(1)} ${model.score.level}`);
      } catch (e) { await showAlert(describe(e), { title: '평가표(엑셀)' }); }
    } });
}

/* 관리자: 템플릿 변경 — {{ }} 없는 파일이면 지금 서식의 값 자리를 옮겨 심는다(TplTransfer, 안건 관리자 화면과 같은 엔진) */
async function changeTemplate() {
  const file = await pickFile('.hwpx'); if (!file) return;
  if (!/\.hwpx$/i.test(file.name)) { toast('hwpx 파일만 됩니다.'); return; }
  let bytes = new Uint8Array(await file.arrayBuffer()); let orig = null; let report = '';
  try {
    const tags = await window.HwpxFill.scan(bytes);
    if (!tags.length) {
      if (!window.TplTransfer) throw new Error('값 자리 옮겨 심기 엔진(tpl_transfer.js)이 없습니다.');
      const base = await templateBytes();
      const t = await window.TplTransfer.transferPlaceholders(base, bytes);
      orig = bytes; bytes = t.bytes; const r = t.report;
      report = `{{ }} 가 없는 파일이라 지금 서식의 값 자리 ${r.planted}개를 새 문단에 심었습니다 · 새 문단 ${r.added}개 · 빠진 문단 ${r.dropped}개`
        + (r.keptOld.length ? ` · ⚠️ 값 자리를 못 찾아 지금 서식 문단을 둔 것 ${r.keptOld.length}개` : '');
    } else report = `{{ }} 자리표시자 ${tags.length}종이 든 서식입니다.`;
    if (!(await showConfirm(`${report}\n\n이 파일을 심의안 서식으로 저장할까요? 모든 사용자의 [심의안에 반영]이 이 서식을 씁니다.`, { title: '템플릿 변경', okText: '저장' }))) return;
    const fd = new FormData(); fd.append('file', new Blob([bytes]), file.name); fd.append('note', report.slice(0, 280)); if (orig) fd.append('orig', new Blob([orig]), file.name);
    await api.upload('/qc/templates', fd);
    await loadTemplates(); renderTplBar(); toast('서식을 바꿨습니다.');
  } catch (e) { await showAlert(describe(e), { title: '템플릿 변경' }); }
}

/* ── 글·숫자를 드래그하면 바로 [복사] 말풍선(사용자 지정 2026-10-08) — 오른쪽 내용 영역 안에서만 ── */
function wireSelectCopy() {
  /* 드래그·선택한 부분 **위에** 한 번만 뜨고, 선택이 풀리거나 스크롤·다른 곳 클릭·복사·4초가 지나면 사라진다(사용자 지정 2026-10-08) */
  const bub = document.createElement('button'); bub.type = 'button'; bub.id = 'selCopy'; bub.textContent = '복사'; bub.title = '선택한 글을 복사합니다'; bub.hidden = true; document.body.append(bub);
  let timer = null, shownFor = '';
  const hide = () => { bub.hidden = true; clearTimeout(timer); };
  const show = () => {
    const s = window.getSelection(); const text = s && s.toString().trim();
    if (!text || s.rangeCount === 0) { hide(); shownFor = ''; return; }
    if (text === shownFor && !bub.hidden) return;
    const range = s.getRangeAt(0); const root = $('document'); if (!root || !root.contains(range.commonAncestorContainer)) { hide(); return; }
    const rects = range.getClientRects(); const r = rects.length ? rects[0] : range.getBoundingClientRect();
    bub.hidden = false;
    const w = bub.offsetWidth || 48, h = bub.offsetHeight || 26;
    bub.style.left = `${Math.max(4, Math.min(window.innerWidth - w - 4, r.left + window.scrollX))}px`;
    bub.style.top = `${Math.max(window.scrollY + 4, r.top + window.scrollY - h - 6)}px`;
    shownFor = text; clearTimeout(timer); timer = setTimeout(hide, 4000);
  };
  document.addEventListener('mouseup', (e) => { if (e.target === bub) return; setTimeout(show, 0); });
  document.addEventListener('keyup', (e) => { if (e.shiftKey || e.key === 'Shift') setTimeout(show, 0); });
  document.addEventListener('mousedown', (e) => { if (e.target !== bub) hide(); });
  document.addEventListener('selectionchange', () => { const s = window.getSelection(); if (!s || !s.toString().trim()) { hide(); shownFor = ''; } });
  window.addEventListener('scroll', hide, true);
  bub.addEventListener('mousedown', (e) => e.preventDefault());   /* 누를 때 선택이 풀리지 않게 */
  bub.addEventListener('click', () => {
    const s = window.getSelection(); const text = s ? s.toString().replace(/\n{3,}/g, '\n\n').trim() : '';
    hide(); if (!text) return;
    copyText(text, `복사했습니다 (${text.length}자)`);
  });
}

/* 정적 사이트: 개발서버에서 내보낸 회계법인 정보(JSON) 불러오기 */
function wireStaticImport() {
  const box = document.createElement('div'); box.className = 'qc-static';
  const live = API.hasRelay && API.hasRelay();
  box.innerHTML = '<button type="button" id="btnImport" class="primary">회계법인 정보 불러오기(JSON)</button>' + (live
    ? '<p>회계법인을 찾아 사업보고서 [내역 보기]를 누르면 전자공시(중계)에서 바로 읽습니다(처음 한 번은 해석 엔진을 받느라 20초 안팎). 개발서버에서 내보낸 파일도 그대로 불러올 수 있습니다.</p>'
    : '<p>이 사이트는 서버가 없어 전자공시를 바로 조회하지 못합니다. 개발서버 화면의 [정보 내보내기(JSON)]로 받은 파일을 불러오면 (붙임1)·심의안 초안 작성·평가표·강평을 그대로 쓸 수 있습니다.</p>');
  $('searchForm').after(box);
  $('btnImport').addEventListener('click', async () => {
    const f = await pickFile('.json'); if (!f) return;
    try {
      const d = JSON.parse(await f.text()); if (!d || d.kind !== 'qc-profile' || !d.profile) throw new Error('회계법인 정보 파일(qc-profile)이 아닙니다.');
      state.firm = d.firm || { corp_code: d.profile.corp_code, corp_name: d.profile.corp_name }; state.reports = d.reports || []; state.report = d.report || null; state.profile = d.profile;
      $('welcome').hidden = true; $('detail').hidden = false; renderDetail(); toast(`${d.profile.corp_name} 정보를 불러왔습니다(${periodLabel(d.profile.period)}).`);
    } catch (e) { await showAlert(describe(e), { title: '회계법인 정보 불러오기' }); }
  });
}

/* ── 기동 ── */
async function boot() {
  /* 개발 화면(qc_dev.html)은 개발서버(.env SERVER_BADGE 있음)에서만 연다 — 운영 이미지에 파일이 들어가도 열리지 않게(사용자 지정 2026-10-08: 지시 전 운영 반영 금지) */
  if (DEV && !STATIC) {
    let badge = ''; try { badge = ((await (await fetch('/api/health', { cache: 'no-store' })).json()) || {}).badge || ''; } catch { /* */ }
    if (!badge) { $('firmList').innerHTML = '<div class="error">개발서버 전용 화면입니다.</div>'; $('searchForm').hidden = true; return; }
  }
  try { state.me = await auth.me(); } catch { $('firmList').innerHTML = '<div class="error">로그인이 필요합니다. 포털에서 다시 열어 주세요.</div>'; return; }
  state.admin = (state.me.roles || []).includes('admin');
  await loadTemplates();
  wireSelectCopy();
  if (STATIC && !(API.hasRelay && API.hasRelay())) wireStaticImport();   /* 전자공시 중계가 있으면 JSON 불러오기는 뺀다(사용자 지정 2026-10-08) */
  $('searchForm').addEventListener('submit', (e) => { e.preventDefault(); search($('query').value); });
  document.addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement !== $('query')) { e.preventDefault(); $('query').focus(); } });
  $('query').focus();
}
boot();
