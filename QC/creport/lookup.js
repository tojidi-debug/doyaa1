const $ = (id) => document.getElementById(id);
const state = { list: [], results: [], current: 0, running: false, inq: "" };
const 조회지연 = 500;

function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inqYmd = () => $("inq").value.replace(/-/g, "");

function setConn(conn) {
  const s = $("login-state");
  s.textContent = { ok: "은행연합회 로그인 확인됨", login: "은행연합회 로그인 필요", noext: "연결 프로그램 설치 필요" }[conn];
  s.className = "hint " + (conn === "ok" ? "ok" : "no");
  $("banner").hidden = conn !== "login";
  $("install").hidden = conn !== "noext";
  state.conn = conn;
}
const refreshConn = async () => { if (!state.running) setConn(await connection()); };

function save(blob, name) {
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function resultFileName() {
  const ok = state.results.filter(isOk), inq = state.inq;
  if (state.results.length === 1 && ok.length) return `${safeName(ok[0].회사명, new Set())}_상세신용_${inq}.xlsx`;
  return `상세신용_${state.results.length}개사_${inq}.xlsx`;
}
const downloadResult = () => save(buildWorkbook(state.results), resultFileName());

// ── 결과 표시 ─────────────────────────────────────
function row(cells, tag = "td") {
  return el("tr", {}, cells.map((c) => (c instanceof Node ? c : el(tag, { textContent: c ?? "" }))));
}

function renderSummary() {
  const t = $("summary");
  t.replaceChildren(row(["No", "회사명", "사업자번호", "대표자", "산업명", "은행계", "비은행계", "총계", "한도", "담보", "비고"], "th"));
  state.results.forEach((co, i) => {
    const ok = isOk(co), s = ok ? summary(sections(co.원자료)) : {};
    const nm = el("td", { textContent: co.회사명 || co.사업자번호, className: ok ? "link" : "" });
    if (ok) nm.onclick = () => selectCompany(i);
    const n = (v) => el("td", { className: "n", textContent: ok ? fmtNum(v) : "" });
    t.append(row([
      el("td", { className: "g", textContent: i + 1 }), nm,
      el("td", { className: "g", textContent: fmtBiz(co.사업자번호) }),
      el("td", { className: "g", textContent: co.대표자 || "" }), co.산업명 || "",
      n(s.은행계), n(s.비은행계), n(s.총계), n(s.한도), n(s.담보),
      el("td", { className: co.비고 ? "bad" : "", textContent: co.비고 || "" }),
    ]));
  });
}

function renderTable(x) {
  const t = el("table");
  t.append(row(["구분", ...x.cols], "th"));
  x.rows.forEach(([g, v], i) => {
    const tr = row([el("td", { className: "g", textContent: g }),
      ...v.map((n, j) => el("td", { className: "n" + (j === v.length - 1 && v.length > 1 ? " hi" : ""), textContent: fmtNum(n) }))]);
    if (i === x.rows.length - 1) tr.className = "total";
    t.append(tr);
  });
  return el("div", { className: "scroll" }, [t]);
}

function selectCompany(i) {
  state.current = i;
  const oks = state.results.map((co, k) => [co, k]).filter(([co]) => isOk(co));
  $("tabs").replaceChildren(...oks.map(([co, k]) => {
    const b = el("button", { type: "button", textContent: safeName(co.회사명, new Set()), className: k === i ? "on" : "" });
    b.onclick = () => selectCompany(k);
    return b;
  }));
  const co = state.results[i], d = $("detail");
  if (!co || !isOk(co)) { d.replaceChildren(); return; }
  const secs = sections(co.원자료), s = summary(secs);
  const info = el("table", { className: "info" });
  const pair = (a, b, c, e) => info.append(el("tr", {}, [el("th", { textContent: a }), el("td", { textContent: b ?? "" }), el("th", { textContent: c }), el("td", { textContent: e ?? "" })]));
  pair("기업명", co.회사명, "대표자명", co.대표자);
  pair("사업자번호", fmtBiz(co.사업자번호), "법인번호", fmtCorp(co.법인번호));
  pair("산업명", co.산업명, "데이터 기준일자", fmtDate(co.기준일));
  info.append(el("tr", {}, [el("th", { textContent: "주소" }), el("td", { textContent: co.주소 || "", colSpan: 3 })]));
  const items = Object.entries(s).filter(([, v]) => v);
  const sum = el("table", {}, [row(items.map(([k]) => k), "th"), row(items.map(([, v]) => el("td", { className: "n", textContent: fmtNum(v) })))]);
  d.replaceChildren(el("h3", { textContent: "기본정보" }), info, el("h3", { textContent: "요약" }), sum,
    ...secs.flatMap((x) => [el("h3", { textContent: x.name }), renderTable(x)]));
}

function renderResult() {
  const has = state.results.length > 0;
  $("empty").hidden = has;
  $("result").hidden = !has;
  if (!has) return;
  $("result-title").textContent = `조회 결과 ${state.results.length}건 (기준일 ${fmtDate(state.inq)}, 단위 : 백만원)`;
  renderSummary();
  const first = state.results.findIndex(isOk);
  selectCompany(first < 0 ? 0 : first);
}

// ── 조회 ──────────────────────────────────────────
async function run(list, auto) {
  if (state.running) return;
  const inq = inqYmd();
  if (!inq) { alert("조회기준일을 넣어 주세요."); return; }
  state.running = true;
  document.querySelectorAll("#run-one,#run-many").forEach((b) => { b.disabled = true; });
  const p = $("progress");
  p.hidden = false;
  state.results = []; state.inq = inq;
  renderResult();
  try {
    for (let i = 0; i < list.length; i++) {
      p.textContent = `${i + 1} / ${list.length} 조회 중 — ${list[i].name || fmtBiz(list[i].biz)}`;
      if (list[i].biz.length !== 10) {
        state.results.push({ 회사명: list[i].name, 사업자번호: list[i].biz, 기준일: inq, 매칭: false, 비고: "사업자번호 오류" });
        continue;
      }
      let co;
      try {
        co = await lookupCompany(list[i], inq);
      } catch (e) {
        if (e.message === "noext") { setConn("noext"); state.results = []; renderResult(); return; }
        co = { 회사명: list[i].name, 사업자번호: list[i].biz, 기준일: inq, 매칭: false, 비고: "조회 오류: " + e.message };
      }
      if (co.login) { setConn("login"); state.results = []; renderResult(); return; }
      setConn("ok");
      state.results.push(co);
      renderResult();
      if (i < list.length - 1) await sleep(조회지연);
    }
    renderResult();
    if (auto && state.results.length) downloadResult();
  } catch (e) {
    alert(e.message);
  } finally {
    state.running = false;
    p.hidden = true;
    $("run-one").disabled = false;
    $("run-many").disabled = !state.list.length;
  }
}

async function pick(file) {
  if (!file) return;
  try {
    state.list = await readList(file);
    $("drop-text").textContent = `${file.name} — ${state.list.length}건`;
    $("run-many").disabled = !state.list.length;
  } catch (e) {
    state.list = [];
    $("drop-text").textContent = "파일을 끌어다 놓거나 눌러서 고르기";
    $("run-many").disabled = true;
    alert(e.message);
  }
}

// ── 시작 ──────────────────────────────────────────
$("inq").value = `${new Date().getFullYear() - 1}-12-31`;
$("run-one").onclick = () => {
  const biz = $("biz").value.replace(/\D/g, "");
  if (biz.length !== 10) { alert("사업자등록번호 10자리를 넣어 주세요."); return; }
  run([{ biz, name: "" }], false);
};
$("biz").addEventListener("keydown", (e) => { if (e.key === "Enter") $("run-one").click(); });
$("run-many").onclick = () => run(state.list, true);
$("template").onclick = () => save(buildTemplate(), "상세신용_조회목록_양식.xlsx");
$("download").onclick = downloadResult;
$("open-login").onclick = () => ask({ type: "openLogin" }).catch((e) => alert(e.message));
$("file").onchange = (e) => pick(e.target.files[0]);
const drop = $("drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); pick(e.dataTransfer.files[0]); });
// 처음 열 때와, 로그인하고 이 화면으로 돌아올 때 연결 상태를 다시 본다.
refreshConn();
window.addEventListener("focus", refreshConn);
