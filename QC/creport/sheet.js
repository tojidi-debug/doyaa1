// 조회 원자료 → 표. 규칙은 scripts/creport_json_to_excel.py 및 검증된 콘솔 코드와 같다.
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
};
const num0 = (v) => num(v) ?? 0;
const fmtBiz = (b) => {
  b = String(b || "").replace(/\D/g, "");
  return b.length === 10 ? `${b.slice(0, 3)}-${b.slice(3, 5)}-${b.slice(5)}` : b;
};
const fmtCorp = (c) => {
  c = String(c || "").replace(/\D/g, "");
  return c.length === 13 ? `${c.slice(0, 6)}-${c.slice(6)}` : c;
};
const fmtDate = (d) => {
  d = String(d || "");
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d;
};
const fmtNum = (v) => (v === null || v === undefined ? "" : v === 0 ? "-" : Math.round(v).toLocaleString("ko-KR"));
const pad2 = (n) => String(n).padStart(2, "0");

// 금융기관별 집계(차입금·지급보증·한도·담보)와 검산
function 변환(dto) {
  const 소계열 = (s) => /(계|합계|총계|소계)$/.test((s || "").trim());
  const 소계행 = (g) => { g = (g || "").trim(); return g.endsWith("계") && g !== "신용장개설관계"; };
  const 보증어 = ["지보", "지급보증", "채무인수", "이행보증", "대지급", "인수", "신용장개설"];
  const 구분 = (rep, g) => rep === "32" ? "한도" : rep === "33" ? "담보" : rep === "34" ? "지급보증"
    : 보증어.some((k) => g.includes(k)) ? "지급보증" : "차입금";
  const jobs = dto.loan_jobId || [], 합계 = { 차입금: 0, 지급보증: 0, 한도: 0, 담보: 0 };
  let 공여명세 = 0, 공여합계 = 0;
  for (let n = 1; n <= 30; n++) {
    const rows = dto["loan_" + pad2(n)];
    if (!Array.isArray(rows)) continue;
    const rep = String((jobs[n - 1] || {}).repCd || "");
    for (const r of rows) {
      const g = (r.gbNm || "").trim();
      if (!g || !r.colInfo) continue;
      const cols = r.colInfo.split("|"), val = (j) => num0(r["val" + pad2(j + 1)]);
      if (g === "신용공여합계" && rep === "31") 공여합계 += Math.max(...cols.map((c, j) => val(j)));
      if (소계행(g)) continue;
      const 개별 = [];
      let 최대소계 = 0;
      cols.forEach((c, j) => {
        const v = val(j);
        if (소계열(c)) 최대소계 = Math.max(최대소계, v);
        else if (v) 개별.push(v);
      });
      const 개별합 = 개별.reduce((a, x) => a + x, 0);
      const 금액 = Math.max(개별합, 최대소계);
      합계[구분(rep, g)] += 금액;
      if (rep === "31") 공여명세 += 금액;
    }
  }
  return { 합계, 검산: { 신용공여명세합: 공여명세, 신용공여합계: 공여합계, 차이: 공여명세 - 공여합계 } };
}

// loan_jobId 순서대로 표를 만든다. 전체 null인 행·열·표는 뺀다.
function sections(dto) {
  const out = [];
  (dto.loan_jobId || []).forEach((job, i) => {
    const rows = (dto["loan_" + pad2(i + 1)] || []).filter((r) => (r.gbNm || "").trim() && r.colInfo);
    if (!rows.length) return;
    const cols = [];
    const data = rows.map((r) => {
      const names = r.colInfo.split("|").map((c) => c.trim()), vals = {};
      names.forEach((c, j) => {
        if (!cols.includes(c)) cols.push(c);
        vals[c] = num(r["val" + pad2(j + 1)]);
      });
      return [(r.gbNm || "").trim(), vals];
    }).map(([g, m]) => [g, cols.map((c) => m[c] ?? null)]).filter(([, v]) => v.some((x) => x !== null));
    if (!data.length) return;
    const keep = cols.map((_, j) => j).filter((j) => data.some(([, v]) => v[j] !== null));
    out.push({
      name: job.jobNm || `표${i + 1}`, rep: String(job.repCd), job: String(job.jobCd),
      cols: keep.map((j) => cols[j]), rows: data.map(([g, v]) => [g, keep.map((j) => v[j])]),
    });
  });
  return out;
}

function secTotal(rows, name) {
  const row = (rows.find(([g]) => g === name) || rows[rows.length - 1])[1];
  return Math.max(0, ...row.filter((x) => x !== null));
}

function summary(secs) {
  const s = { 은행계: 0, 비은행계: 0, 총계: 0, 한도: 0, 담보: 0, 법인채무보증: 0 };
  for (const x of secs) {
    if (x.rep === "31") s[x.job === "31" ? "은행계" : "비은행계"] += secTotal(x.rows, "신용공여합계");
    else if (x.rep === "32") s.한도 += secTotal(x.rows, "한도계");
    else if (x.rep === "33") s.담보 += secTotal(x.rows, "담보총계");
    else if (x.rep === "34") s.법인채무보증 += secTotal(x.rows);
  }
  s.총계 = s.은행계 + s.비은행계;
  return s;
}

// 시트명: (주)·주식회사 표현과 띄어쓰기를 뺀 간단한 명칭
function safeName(name, used) {
  const n = String(name || "회사").replace(/[(（]\s*주\s*[)）]|㈜|주식회사|\s|[\\/*?:[\]']/g, "").slice(0, 28) || "회사";
  let out = n;
  for (let i = 2; used.has(out); i++) out = `${n}_${i}`;
  used.add(out);
  return out;
}

const isOk = (co) => co.매칭 && co.원자료;
