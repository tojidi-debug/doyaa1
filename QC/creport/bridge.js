// 조회 화면 ↔ 연결 프로그램(크롬 확장). 일반 웹페이지는 은행연합회 로그인 세션을 쓸 수 없어 확장을 거친다.
const EXT_ID = "hdkphebahcklambmfabgjpnenfmpjaom";

function ask(msg) {
  return new Promise((resolve, reject) => {
    if (!window.chrome || !chrome.runtime || !chrome.runtime.sendMessage) { reject(new Error("noext")); return; }
    chrome.runtime.sendMessage(EXT_ID, msg, (res) => {
      if (chrome.runtime.lastError || !res) { reject(new Error("noext")); return; }
      if (!res.ok) { reject(new Error(res.error || "조회 실패")); return; }
      resolve(res);
    });
  });
}

// 'ok' | 'login' | 'noext'
async function connection() {
  try {
    const r = await ask({ type: "check" });
    return r.status === "login" ? "login" : "ok";
  } catch (e) {
    return e.message === "noext" ? "noext" : "login";
  }
}

// 한 회사 조회 → {회사명, 사업자번호, ..., 원자료} 또는 {비고}
async function lookupCompany(item, inq) {
  const base = { 회사명: item.name || "", 사업자번호: item.biz, 기준일: inq };
  const r = await ask({ type: "query", biz: item.biz, inq });
  if (r.status === "login") return { ...base, login: true };
  if (r.status === "none") return { ...base, 매칭: false, 비고: "회사 없음" };
  if (r.status === "empty") return { ...base, 회사명: r.c.cmpNm, 매칭: true, 비고: "월보 응답 없음" };
  const c = r.c;
  return {
    회사명: c.cmpNm, 사업자번호: c.bizNo, 법인번호: c.corpNo, 대표자: c.ceoNm, 산업명: c.indCdNm, 주소: c.addr,
    기준일: inq, 매칭: true, ...변환(r.dto), 원자료: r.dto,
  };
}
