// 조회 원자료 → 표. 집계 규칙은 검증된 콘솔 코드와 같다.
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
  const 구분 = (rep, g) => rep === "32" ? "한도" : rep === "33" ? "담보" : rep === "34" ? "법인채무보증"
    : 보증어.some((k) => g.includes(k)) ? "지급보증" : "대출채권";
  const jobs = dto.loan_jobId || [], 합계 = { 대출채권: 0, 지급보증: 0, 법인채무보증: 0, 한도: 0, 담보: 0 };
  let 공여명세 = 0, 공여합계 = 0;
  for (let n = 1; n <= 30; n++) {
    const rows = dto["loan_" + pad2(n)];
    if (!Array.isArray(rows)) continue;
    const rep = String((jobs[n - 1] || {}).repCd || "");
    for (const r of rows) {
      const g = (r.gbNm || "").trim();
      if (!g || !r.colInfo) continue;
      const cols = r.colInfo.split("|"), val = (j) => num0(r["val" + pad2(j + 1)]);
      if (g === "신용공여합계" && rep === "31") {
        const 개별합 = cols.reduce((a, c, j) => a + (소계열(c) ? 0 : val(j)), 0);
        공여합계 += Math.max(개별합, ...cols.map((c, j) => val(j)));
      }
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

// 표 합계: 총계 열이 없으면 개별 기관 합을 쓴다.
function secTotal(sec, name) {
  const row = (sec.rows.find(([g]) => g === name) || sec.rows[sec.rows.length - 1])[1];
  const 개별합 = row.reduce((a, x, j) => a + (/계$/.test(sec.cols[j]) ? 0 : x ?? 0), 0);
  return Math.max(개별합, ...row.filter((x) => x !== null));
}

function summary(secs) {
  const s = { 은행계: 0, 보험: 0, 기타: 0, 비은행계: 0, 총계: 0, 한도: 0, 담보: 0, 법인채무보증: 0 };
  for (const x of secs) {
    if (x.rep === "31") s[x.job === "31" ? "은행계" : x.name.includes("보험") ? "보험" : "기타"] += secTotal(x, "신용공여합계");
    else if (x.rep === "32") s.한도 += secTotal(x, "한도계");
    else if (x.rep === "33") s.담보 += secTotal(x, "담보총계");
    else if (x.rep === "34") s.법인채무보증 += secTotal(x);
  }
  s.비은행계 = s.보험 + s.기타;
  s.기타 = s.비은행계;   // 조회 화면과 같이 보험을 포함한 비은행 합계
  s.총계 = s.은행계 + s.비은행계;
  return s;
}

// 회사 시트·화면 맨 위 요약 한 줄
const headline = (s) => ["은행계", "보험", "기타", "한도", "담보", ...(s.법인채무보증 ? ["법인채무보증"] : [])].map((k) => [k, s[k] || null]);

// 보기 좋게 정리한 표. 금액 판단이 달라지지 않도록, 값이 그대로 드러나는 소계만 줄인다.
function compact(sec) {
  const isSum = (c) => /계$/.test(c);
  const last = sec.cols.length - 1, indiv = sec.cols.map((_, j) => j).filter((j) => !isSum(sec.cols[j]));
  // 마지막 총계 열이 개별 기관 합과 맞을 때만 중간 소계 열을 뺀다. 한 기관뿐이면 총계 열도 뺀다.
  const covers = indiv.length > 0 && isSum(sec.cols[last]) && sec.rows.every(([, v]) =>
    Math.abs((v[last] ?? 0) - indiv.reduce((a, j) => a + (v[j] ?? 0), 0)) <= indiv.length);
  const keep = !covers ? sec.cols.map((_, j) => j) : indiv.length > 1 ? [...indiv, last] : indiv;

  const isTotal = (g) => /계$/.test(g) && g !== "신용장개설관계";
  const leaves = sec.rows.filter(([g]) => !isTotal(g));
  const pick = (v) => keep.map((j) => v[j]);
  // 계정이 한 줄뿐이면 소계·합계 행은 모두 같은 값이므로 그 줄만 남긴다.
  if (leaves.length === 1) return { ...sec, cols: keep.map((j) => sec.cols[j]), rows: [[leaves[0][0], pick(leaves[0][1])]] };

  const hasLoan = sec.rows.some(([g]) => g === "대출채권계");
  let rows = [];
  let group = [];
  for (const [g, v] of sec.rows) {
    if (g === "신용공여대출채권계" || g === "신용공여주석계" || (g === "주석계" && !hasLoan)) continue;
    if (/지급보증계$/.test(g) && group.length === 1) {  // 한 줄뿐인 지급보증 소계는 계정명 표시로 대신한다
      const name = rows[group[0]][0];
      if (!/지보|확정/.test(name)) rows[group[0]][0] = `${name}(${g.startsWith("미확정") ? "미확정" : "확정"})`;
      group = [];
      continue;
    }
    rows.push([g, pick(v)]);
    if (isTotal(g)) group = [];
    else group.push(rows.length - 1);
  }
  // 값이 같은 소계는 한 번만 보인다: 원화대출금소계=대출채권계, 대출채권계=신용공여합계
  const same = (x, y) => x && y && JSON.stringify(x[1]) === JSON.stringify(y[1]);
  const loan = rows.find(([g]) => g === "대출채권계");
  const tail = rows[rows.length - 1];
  rows = rows.filter((r) => !((/소계$/.test(r[0]) || r[0] === "신용공여합계") && r !== loan && same(r, loan)) && !(/소계$/.test(r[0]) && r !== tail && same(r, tail)));
  return { ...sec, cols: keep.map((j) => sec.cols[j]), rows };
}

// 행 강조: sub 소계 / total 합계
function rowKind(g, final) {
  if (final || /^(주석계|대출채권계|한도계|담보총계)$|합계$/.test(g)) return "total";
  return /소계$|지급보증계$/.test(g) ? "sub" : "";
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
