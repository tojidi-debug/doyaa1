/* [품감] 개별선정(개발) — 화면 없는 계산(슬라이서·거르기·회사 맞추기). qc_sample_data.test.mjs 가 시험한다.
 *
 * 슬라이서의 바탕은 **서버가 읽은 사전제출자료의 열 이름**이다(`columns`). 여기서는 그 위에
 * 사람이 고르기 쉬운 「뜻 열」 몇 개를 덧붙인다 — 초도·소속(본점/지점)·적용 기준서·연결감사보고서 작성.
 */

const S = (v) => (v === undefined || v === null ? '' : String(v).trim());
const digits = (v) => S(v).replace(/\D/g, '');

// 「있음」·「없음」 표시 — 적는 모양이 달라도 같은 뜻(사용자 지정 2026-10-15). 서버 qc_sample_checks._YES·_NO 와 같은 목록.
const YES = /^(y|yes|o|여|예|유|있음|연결|해당|해당함|해당있음|작성|○|◯|●|v|✔|✓|☑|체크|대상|true)$/i;
const NO = /^(n|no|x|×|✗|부|무|없음|아니오|아니요|별도|개별|해당없음|해당사항없음|해당무|비해당|비대상|미작성|미해당|-|--|―|—|n\/a|na|#n\/a|공란|false)$/i;
export function yesNo(v) {
  const s = S(v).replace(/\s/g, '');
  if (!s) return null;
  if (YES.test(s)) return true;
  if (NO.test(s)) return false;
  return null;
}
/** 연결감사보고서를 받을 회사인가(「연결 여부」 뜻 열이 연결·연결(일자없음) — 연결감사보고서일이 비었을 뿐). */
export function isConsolidated(row, roles) {
  return /^연결(\(일자없음\))?$/.test(valueOf(row, '@con_report', roles));
}

export function isDate(v) {
  return /(19|20)\d{2}\s*[-./년]\s*\d{1,2}|^\d{2}[./]\s*\d{1,2}[./]\s*\d{1,2}/.test(S(v));
}

/* 업종 묶음 — 회계법인마다 「부동산업」「임대업」「부동산 개발 및 공급업」처럼 달리 적어 온다. 실질로 묶는다
   (사용자 지정 2026-10-14). 위에서부터 처음 맞는 것. 원래 글자는 「+ 슬라이서 추가」의 「업종」 열로 볼 수 있다. */
export const INDUSTRY_GROUPS = [
  ['금융·보험업', /금융|보험|증권|은행|캐피탈|카드|대부|신탁|펀드|자산운용|투자자문|창업투자|여신|리스|저축/],
  ['건설업', /건설|건축|토목|공사|시공|설비공사|플랜트|인테리어|조경/],
  ['부동산·임대업', /부동산|임대|분양|시행|개발\s*및\s*공급|주택|빌딩|리츠/],
  ['제조업', /제조|생산|가공|제약|화학|섬유|금속|기계|전자부품|반도체|자동차부품|식품|음료|의약/],
  ['도소매업', /도매|소매|유통|판매|무역|상사|수출입|쇼핑|마트|상품중개/],
  ['정보통신업', /정보|통신|소프트웨어|software|it\b|ict|방송|출판|게임|플랫폼|인터넷|데이터|컴퓨터|시스템\s*통합/i],
  ['운수·창고업', /운수|운송|물류|창고|해운|항공|택배|여객|화물/],
  ['전기·가스·에너지', /전기|가스|에너지|발전|수도|증기|태양광|신재생/],
  ['숙박·음식점업', /숙박|음식|호텔|외식|리조트|콘도/],
  ['보건·의료', /의료|병원|보건|요양|헬스케어/],
  ['교육서비스업', /교육|학원/],
  ['농림어업·광업', /농업|임업|어업|축산|수산|광업|채굴/],
  ['서비스업', /서비스|용역|컨설팅|사업지원|연구|전문|과학|기술|광고|디자인|인력|경비|청소|여행|오락|문화|스포츠|예술/],
];
export function industryGroup(v) {
  const s = S(v);
  if (!s) return '';
  for (const [name, re] of INDUSTRY_GROUPS) if (re.test(s)) return name;
  return '기타';
}

/* 정해진 차례가 있는 칩(사용자 지정): 기준서는 일반 먼저, 감사의견은 적정→한정→부적정→의견거절. */
const FIXED_ORDER = {
  '@gaap': ['일반회계기준', '소기업특례', '중소기업회계기준', 'K-IFRS'],
  '@opinion': ['적정', '한정', '부적정', '의견거절'],
  '@first': ['초도', '초도·지정', '계속·지정', '계속'],
  '@con_report': ['연결', '연결(일자없음)', '연결(종속없음)', '별도'],
};

/* 뜻 열(파생). 각 항목: key·label·뽑는 함수(row values, roles) */
export const DERIVED = [
  {
    /* 초도와 지정감사를 한 슬라이서로(사용자 지정 2026-10-14) — 「초도·지정감사」처럼 짝으로 보인다. */
    key: '@first', label: '초도·지정감사', from: ['new_audit', 'firm_years', 'predecessor', 'designated'],
    get: (v, r) => {
      if (!r.new_audit && !r.firm_years && !r.predecessor && !r.designated) return '';
      const isNew = /신규/.test(S(v[r.new_audit]));
      const one = Number(v[r.firm_years]) === 1;
      const first = /최초|없음/.test(S(v[r.predecessor]));
      const kind = (r.new_audit || r.firm_years || r.predecessor) ? (isNew || one || first ? '초도' : '계속') : '';
      const d = S(v[r.designated]);
      // 칩이 한 줄에 들어가게 짧게(사용자 지정 2026-10-15) — 자유수임은 빼고 지정감사만 「·지정」
      const how = r.designated && /지정/.test(d) && !/자유/.test(d) ? '지정' : '';
      return [kind, how].filter(Boolean).join('·');
    },
  },
  {
    /* 소속 + 감사수행사업본부를 한 슬라이서로(사용자 지정 2026-10-15) — 지점은 그 이름, 본점은 「본점·여의도」처럼 사업본부까지 */
    key: '@branch', label: '소속(본점/지점)', from: ['branch'],
    get: (v, r) => {
      const b = S(v[r.branch]);
      if (!b) return '';
      if (/지점|지사|사무소|분사무소/.test(b)) return b;
      const unit = b.replace(/본점/g, '').replace(/^[\s·,/-]+|[\s·,/-]+$/g, '');
      return unit ? `본점·${unit}` : '본점';
    },
  },
  {
    /* 국제기준·국제회계기준·한국채택국제회계기준·kifrs → K-IFRS. 사전제출자료에 소기업특례 적용 대상으로 표시돼
       있으면(「감사기준서 1200 해당여부」 예, 또는 회계기준 칸에 「특례」·「소기업」) 「·소기업특례」를 붙인다(사용자 지정 2026-10-14). */
    key: '@gaap', label: '적용 기준서', from: ['gaap', 'sme1200'],
    get: (v, r) => {
      const g = S(v[r.gaap]);
      if (!g) return '';
      let base = g;
      if (/ifrs|국제/i.test(g)) base = 'K-IFRS';
      else if (/중소/.test(g)) base = '중소기업회계기준';
      else if (/일반/.test(g)) base = '일반회계기준';           // 일반기업회계기준·일반회계·일반회계기준 → 하나로(사용자 지정)
      // 감사기준서 1200(소규모 기업 감사)은 여기 넣지 않고 회사명 옆 「소규모(1200)」로(사용자 지정 2026-10-15).
      // 회계기준 칸 자체에 「특례」(회계처리 특례)라고 적힌 경우만 기준서 칩으로 둔다.
      return /특례|소기업/.test(g.replace(/중소기업/g, '')) ? '소기업특례' : base;
    },
  },
  {
    /* 연결 = 「연결 여부」가 연결로 체크되고 **연결대상 종속회사가 있어야**(종속회사수 ≥ 1) 한다(사용자 지정 2026-10-14).
       연결감사보고서일 칸은 날짜일 때만 인정한다 — 「-」·「해당없음」이나 별도 회사에 개별 보고서일을 적어 둔
       파일이 있어 102개사가 모두 「작성」으로 나왔다(사용자 지적). 어긋나는 것은 제출자료 대사가 불일치로 잡는다. */
    /* 「연결 여부」와 「연결감사보고서 작성」은 같은 뜻이라 한 슬라이서로(사용자 지정 2026-10-14). */
    key: '@con_report', label: '연결 여부', from: ['con_report_date', 'consolidated', 'subsidiaries'],
    get: (v, r) => {
      if (!r.con_report_date && !r.consolidated) return '';
      const cons = yesNo(v[r.consolidated]);
      const dated = isDate(v[r.con_report_date]);
      const subs = r.subsidiaries ? Number(String(v[r.subsidiaries] ?? '').replace(/[^\d.]/g, '') || 0) : null;
      if (cons === false) return '별도';
      if (cons === true) {
        // 칩이 한 줄에 들어가게 짧게(사용자 지정 2026-10-15)
        if (subs !== null && !(subs > 0)) return '연결(종속없음)';
        return dated ? '연결' : '연결(일자없음)';
      }
      return dated && (subs === null || subs > 0) ? '연결' : '별도';
    },
  },
  {
    key: '@industry', label: '업종(묶음)', from: ['industry'],
    get: (v, r) => industryGroup(v[r.industry]),
  },
  {
    key: '@opinion', label: '감사의견', from: ['opinion'],
    get: (v, r) => {
      const o = S(v[r.opinion]).replace(/\s/g, '');
      if (!o) return '';
      if (/거절/.test(o)) return '의견거절';
      if (/부적정/.test(o)) return '부적정';
      if (/한정/.test(o)) return '한정';
      if (/적정/.test(o)) return '적정';
      return o;
    },
  },
];

/* 처음 펼쳐 둘 슬라이서(있는 것만) — **중요한 순서**(사용자가 처음 든 차례: 연결·담당이사·계속감사 연수·기준서·
   초도·업종·연결감사보고서·소속·감사의견). 열은 역할로, 뜻 열은 key 로. */
export const DEFAULT_SLICERS = [
  'role:year', '@con_report', 'role:partner', 'role:partner_years', 'role:firm_years',
  '@gaap', '@first', '@industry', '@branch', '@opinion', 'role:company_type',
];
/* 셋째 줄 — 감사수행 사업본부는 「소속」 슬라이서에 합쳤다(2026-10-15). 대형비상장·감리/조사 진행·감사기준서 1200 은 슬라이서가 아니라
   회사명 옆 참고 표시로(사용자 지정 2026-10-15, `flagBadges`). 필요하면 「+ 슬라이서 추가」로 펼친다. */
export const ROW3_ROLES = ['large_unlisted', 'inspection', 'sme1200'];

/** 회사명 옆 참고 표시 — 해당(예·체크·글)이 있을 때만 */
export function flagBadges(row, roles) {
  const v = row.values || {};
  const on = (role) => {
    const x = S(v[roles[role]]);
    return x && !NA.test(x) && yesNo(x) !== false ? x : '';
  };
  const out = [];
  if (on('large_unlisted')) out.push({ cls: 'big', text: '대형비상장', tip: '대형비상장회사' });
  const ins = on('inspection');
  if (ins) out.push({ cls: 'insp', text: yesNo(ins) === true ? '감리·조사' : `감리·조사(${ins})`, tip: '감리/조사 진행 중으로 표시된 회사' });
  if (on('sme1200')) out.push({ cls: 'sme', text: '소규모(1200)', tip: '소규모 기업 감사기준서 1200 적용' });
  return out;
}

/** 슬라이서로 쓸 수 있는 것 전부 — [{id, label}] (열 이름은 파일 그대로). */
export function slicerChoices(data) {
  const roles = data.roles || {};
  const out = [];
  for (const d of DERIVED) {
    if (d.from.some((role) => roles[role])) out.push({ id: d.key, label: d.label });
  }
  for (const c of data.columns || []) out.push({ id: `col:${c.letter}`, label: c.label, role: c.role || '' });
  return out;
}

/* 「+ 슬라이서 추가」 목록은 쓸 만한 것만, 자주 쓰는 순(사용자 지정 2026-10-15) — 번호·코드·등록번호·날짜·금액·시간처럼
   회사마다 값이 다른 열과 값이 하나뿐인 열은 뺀다. `all` 이면 전부. */
const SLICER_PRIORITY = ['partner', 'industry', 'opinion', 'gaap', 'consolidated', 'company_type', 'large_unlisted', 'fiscal',
  'bookkeeping', 'branch', 'partner_years', 'firm_years', 'sme1200', 'inspection'];
// 회사마다 다른 정보(NO·회사명·등록번호·코드)와 뜻 열로 이미 있는 것(신규감사·지정 → 초도·지정), 전임감사인·심리담당자는 빼다(사용자 지정 2026-10-15)
const SLICER_OUT_ROLES = ['no', 'company', 'corp_no', 'biz_no', 'year', 'new_audit', 'designated', 'predecessor', 'reviewer', 'con_reviewer'];
const SLICER_SKIP = /번호|코드|^NO\.?$|일자|일$|날짜|금액|보수|자산|부채|자본|매출|이익|손익|시간|주소|연락처|전화|비고|심리|검토자|전임|신규감사|지정(감사|사유)|회사명/i;
export function slicerMenu(data, { all = false } = {}) {
  const roles = data.roles || {};
  const rows = data.rows || [];
  const roleOf = Object.fromEntries(Object.entries(roles).map(([k, v]) => [v, k]));
  const out = [];
  for (const c of slicerChoices(data)) {
    if (c.id.startsWith('@')) { out.push({ ...c, rank: -1 }); continue; }
    const letter = c.id.slice(4), role = roleOf[letter];
    const pr = SLICER_PRIORITY.indexOf(role);
    if (!all) {
      if (SLICER_OUT_ROLES.includes(role)) continue;
      if (SLICER_SKIP.test(c.label.replace(/\s/g, ''))) continue;
      const vals = new Set(rows.map((r) => S(r.values[letter])).filter(Boolean));
      if (vals.size < 2 || vals.size > Math.max(25, rows.length * 0.4)) continue;
    }
    out.push({ ...c, rank: pr < 0 ? 100 : pr });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

/** 기본 슬라이서 id 목록 — 역할 → 그 열의 `col:` id. */
export function defaultSlicers(data) {
  const roles = data.roles || {};
  const have = new Set(slicerChoices(data).map((c) => c.id));
  const out = [];
  for (const id of DEFAULT_SLICERS) {
    const real = id.startsWith('role:') ? (roles[id.slice(5)] ? `col:${roles[id.slice(5)]}` : '') : id;
    if (real && have.has(real) && !out.includes(real)) out.push(real);
  }
  // 셋째 줄 열은 체크된 값이 있을 때만
  const row3 = new Set(ROW3_ROLES.map((k) => roles[k] && `col:${roles[k]}`).filter(Boolean));
  const marked = (id) => (data.rows || []).some((r) => {
    const v = S(r.values[id.slice(4)]);
    return v && !NA.test(v) && (id === `col:${roles.branch}` ? true : yesNo(v) !== false);
  });
  // 회사 분류는 사업보고서 발행(제출) 대상 회사가 있을 때만(사용자 지정 2026-10-15)
  const ctype = roles.company_type ? `col:${roles.company_type}` : '';
  const hasReport = (data.rows || []).some((r) => /사업보고서|발행/.test(S(r.values[roles.company_type])) && !/기타$/.test(S(r.values[roles.company_type])));
  const kept = out.filter((id) => (!row3.has(id) || marked(id)) && (id !== ctype || hasReport));
  // 값이 하나뿐인 슬라이서(모두 「본점」 따위)는 거를 힘이 없으니 뒤로 보낸다 — 순서는 그대로.
  const kinds = (id) => new Set((data.rows || []).map((r) => valueOf(r, id, roles))).size;
  return [...kept.filter((id) => kinds(id) > 1 || row3.has(id)), ...kept.filter((id) => kinds(id) <= 1 && !row3.has(id))];
}

/** 행 하나의 슬라이서 값(문자열). 빈 값은 「(빈 칸)」. */
export function valueOf(row, id, roles) {
  const v = row.values || {};
  let out = '';
  if (id.startsWith('col:')) out = S(v[id.slice(4)]);
  else {
    const d = DERIVED.find((x) => x.key === id);
    out = d ? S(d.get(v, roles || {})) : '';
  }
  return out || '(빈 칸)';
}

/* 같은 뜻 다른 표기 맞추기(사용자 지정 2026-10-15) — 작성자마다 「Y」·「○」·「해당」·「체크」, 「-」·「N/A」·「해당없음」,
   띄어쓰기·전각 차이처럼 달리 적어도 같은 사항이면 한 칩·한 값으로 보이게, 열마다 그 열에서 가장 많이 쓴 표기로 맞춘다.
   회사명 열과 숫자는 건드리지 않는다. 바꾼 칸 수를 돌려준다. */
const NA_MARK = /^(#?n\s*\/\s*a|#?na)$/i;
export function unifyMarks(data) {
  const rows = (data && data.rows) || [];
  const skip = new Set([(data.roles || {}).company].filter(Boolean));
  let changed = 0;
  for (const c of data.columns || []) {
    if (skip.has(c.letter)) continue;
    const groups = new Map();
    for (const r of rows) {
      const raw = r.values[c.letter];
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const yn = yesNo(raw);
      const key = yn === true ? '\u0001Y' : yn === false ? '\u0001N' : raw.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
      const g = groups.get(key) || new Map();
      g.set(raw, (g.get(raw) || 0) + 1);
      groups.set(key, g);
    }
    for (const [key, g] of groups) {
      if (g.size < 2) continue;
      const order = [...g.entries()].sort((a, b) => b[1] - a[1]);
      const pick = (key === '\u0001N' && order.find(([v]) => !NA_MARK.test(v.trim()))) || order[0];
      for (const r of rows) {
        const raw = r.values[c.letter];
        if (typeof raw === 'string' && g.has(raw) && raw !== pick[0]) { r.values[c.letter] = pick[0]; changed += 1; }
      }
    }
  }
  return changed;
}

/** 슬라이서 칩 — [{value, count}] (count = 다른 슬라이서를 거친 뒤 남는 수).
 *  차례: 숫자(연수 등)는 큰 수부터, 글자는 **많은 순**(전체 행 기준이라 다른 슬라이서를 눌러도 자리가 흔들리지 않음),
 *  지금 0개인 것과 (빈 칸)은 맨 뒤. */
const NA = /^(#?n\s*\/\s*a|#?na)$/i;   // N/A·n/a·#N/A — 칩으로 보이지 않는다(사용자 지정 2026-10-14)

/* 회사 기준 세기(사용자 지정 2026-10-15) — 분기·반기 결산처럼 한 회사를 사업연도(기)별로 여러 줄 적어도 1개사.
   법인등록번호나 사업자등록번호가 같으면 이름이 조금 달라도 같은 회사. `assignCompanyIds` 가 줄마다 `cid` 를 붙인다. */
export function assignCompanyIds(data) {
  const rows = (data && data.rows) || [];
  const roles = (data && data.roles) || {};
  const parent = rows.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const seen = new Map();
  rows.forEach((r, i) => {
    const v = r.values || {};
    const keys = [];
    const corp = S(v[roles.corp_no]).replace(/\D/g, ''), biz = S(v[roles.biz_no]).replace(/\D/g, ''), nk = nameKey(v[roles.company]);
    if (corp.length >= 10) keys.push(`c:${corp}`);
    if (biz.length === 10) keys.push(`b:${biz}`);
    if (nk) keys.push(`n:${nk}`);
    for (const k of keys) {
      if (seen.has(k)) parent[find(i)] = find(seen.get(k)); else seen.set(k, i);
    }
  });
  rows.forEach((r, i) => { r.cid = `co${find(i)}`; });
  return new Set(rows.map((r) => r.cid)).size;
}
const yearSide = (r, roles) => (S((r.values || {})[roles.year]).startsWith('전기') ? '전기' : '당기');
/** 같은 회사·같은 쪽(당기/전기)은 하나로 — cid 가 없으면 줄 그대로 */
export const companyKey = (r, roles) => (r.cid ? `${yearSide(r, roles || {})}|${r.cid}` : r);
export function countCompanies(rows, roles) { return new Set(rows.map((r) => companyKey(r, roles))).size; }

export function slicerValues(rows, id, roles, picked = {}, { all: showAll = false } = {}) {
  const all = new Map();
  const total = new Map();
  const bump = (m, k, r) => { if (!m.has(k)) m.set(k, new Set()); if (r) m.get(k).add(companyKey(r, roles)); };
  for (const r of rows) bump(total, valueOf(r, id, roles), r);
  const others = Object.fromEntries(Object.entries(picked).filter(([k]) => k !== id));
  const live = filterRows(rows, others, roles);
  for (const r of rows) bump(all, valueOf(r, id, roles));
  for (const r of live) bump(all, valueOf(r, id, roles), r);
  for (const [k, set] of total) total.set(k, set.size);
  const list = [...all.entries()].map(([value, set]) => ({ value, count: set.size })).filter((x) => showAll || !NA.test(x.value.trim()));
  const num = (s) => (/^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN);
  const numeric = list.every((x) => x.value === '(빈 칸)' || !Number.isNaN(num(x.value)));
  list.sort((a, b) => {
    if ((a.value === '(빈 칸)') !== (b.value === '(빈 칸)')) return a.value === '(빈 칸)' ? 1 : -1;
    if (!a.count !== !b.count && !FIXED_ORDER[id]) return a.count ? -1 : 1;
    const fixed = FIXED_ORDER[id];
    if (fixed) {
      const ia = fixed.indexOf(a.value), ib = fixed.indexOf(b.value);
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    }
    if (numeric) return num(b.value) - num(a.value);      // 숫자(연수 등)는 큰 수부터(사용자 지정 2026-10-15)
    return (total.get(b.value) - total.get(a.value)) || a.value.localeCompare(b.value, 'ko');
  });
  return list;
}

/** 거르기 — 슬라이서끼리는 「그리고」, 한 슬라이서 안의 여러 값은 「또는」. */
export function filterRows(rows, picked, roles) {
  const active = Object.entries(picked || {}).filter(([, set]) => set && set.size);
  if (!active.length) return rows.slice();
  return rows.filter((r) => active.every(([id, set]) => set.has(valueOf(r, id, roles))));
}

/* ── 사내 재무 DB 회사 맞추기 ── */

export function searchTerm(name) {
  return S(name).replace(/주식회사|유한책임회사|유한회사|\(주\)|㈜|\(유\)|\(유한\)/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export function nameKey(name) {
  return searchTerm(name).replace(/[\s()（）[\]{}'"`·.,]/g, '').toLowerCase();
}

/** 후보 중 같은 회사 — 사업자등록번호가 같으면 그것, 아니면 이름 열쇠가 같은 것이 하나일 때. */
/* 사내 재무 DB 후보에서 그 회사 고르기 — ① 2-3 사업자등록번호 ② 회사명이 하나 ③ 같은 이름이 여럿이면 이 회계법인이 그해 수임한 회사
   (외감수임내역의 사업자등록번호 `bizHints`) ④ 그래도 여럿이면 대상 결산기 재무자료가 있는 회사가 하나일 때. 남으면 사람이 고른다(사용자 지정 2026-10-15). */
export function pickCompany(items, row, roles, { bizHints = [] } = {}) {
  const v = row.values || {};
  const biz = digits(v[roles.biz_no]);
  if (biz.length === 10) {
    const hit = items.filter((c) => digits(c.biz) === biz);
    if (hit.length === 1) return { pick: hit[0], how: '사업자등록번호' };
  }
  const key = nameKey(v[roles.company]);
  const same = items.filter((c) => nameKey(c.name) === key);
  if (same.length === 1) return { pick: same[0], how: '회사명' };
  const pool = same.length ? same : items;
  const hints = new Set(bizHints.map(digits).filter((b) => b.length === 10));
  if (hints.size) {
    const hit = pool.filter((c) => hints.has(digits(c.biz)));
    if (hit.length === 1) return { pick: hit[0], how: '외감수임내역 사업자번호' };
  }
  if (pool.length > 1) {
    const rd = digits(v[roles.report_date]).slice(0, 8);
    if (rd.length === 8) {
      const has = pool.filter((c) => { const p = pickPeriod(c.periods, row, roles); return p && p < rd && (+rd.slice(0, 4) - +p.slice(0, 4)) <= 1; });
      if (has.length === 1) return { pick: has[0], how: '대상 결산기 자료' };
    }
  }
  return { pick: null, candidates: pool };
}

/** 결산일자 고르기 — 감사보고서일 앞 15개월 안의 가장 늦은 결산일자. 없으면 결산월이 같은 최신, 그것도 없으면 최신. */
export function pickPeriod(periods, row, roles) {
  const list = (periods || []).map(String).filter((p) => /^\d{8}$/.test(p)).sort().reverse();
  if (!list.length) return '';
  const v = row.values || {};
  const rd = digits(v[roles.report_date]).slice(0, 8);
  if (rd.length === 8) {
    const rdDate = new Date(+rd.slice(0, 4), +rd.slice(4, 6) - 1, +rd.slice(6, 8));
    for (const p of list) {
      const d = new Date(+p.slice(0, 4), +p.slice(4, 6) - 1, +p.slice(6, 8));
      const months = (rdDate - d) / (1000 * 60 * 60 * 24 * 30.44);
      if (d < rdDate && months <= 15) return p;
    }
  }
  const m = /(\d{1,2})\s*월/.exec(S(v[roles.fiscal])) || /^(\d{1,2})$/.exec(S(v[roles.fiscal]));
  if (m) {
    const mm = String(+m[1]).padStart(2, '0');
    const hit = list.find((p) => p.slice(4, 6) === mm);
    if (hit) return hit;
  }
  return list[0];
}

/* ── 대사 결과 ── */

export const LEVELS = ['위반의심', '중점확인', '불일치', '참고', '일치'];

export function issuesTsv(items) {
  const head = ['구분', '회사', '사업연도', '항목', '내용', '근거', '자료 위치'];
  const lines = [head, ...items.map((i) => [i.level, i.company, i.year ?? '', sheetText(i.title), sheetText(i.detail), i.basis || '', sheetText((i.refs || []).join(', '))])];
  return lines.map((r) => r.map((c) => S(c).replace(/[\t\n]+/g, ' ')).join('\t')).join('\n');
}

/* ── 완전성(사용자 지정 2026-10-14): 사업연도별 행·회사 수와 슬라이서 합계가 맞는지 ── */
export function completeness(data, slicerIds) {
  const roles = data.roles || {};
  const years = new Map();
  for (const r of data.rows || []) {
    const y = roles.year ? (S(r.values[roles.year]) || '(빈 칸)') : '(전체)';
    if (!years.has(y)) years.set(y, []);
    years.get(y).push(r);
  }
  const out = { years: [], slicers: [], skipped: data.skipped_rows || [], nos: null };
  for (const [y, rows] of years) {
    const keys = rows.map((r) => r.cid || nameKey(r.values[roles.company]));
    const dup = keys.length - new Set(keys).size;
    out.years.push({ year: y, rows: rows.length, companies: new Set(keys).size, dup });
  }
  for (const id of slicerIds) {
    const vals = slicerValues(data.rows || [], id, roles, {}, { all: true });
    const sum = vals.reduce((a, v) => a + v.count, 0);
    const blank = (vals.find((v) => v.value === '(빈 칸)') || {}).count || 0;
    out.slicers.push({ id, sum, blank, ok: sum === (data.rows || []).length });
  }
  if (roles.no) {
    const nos = (data.rows || []).map((r) => Number(r.values[roles.no])).filter((n) => Number.isInteger(n) && n > 0);
    if (nos.length) {
      const max = Math.max(...nos);
      const have = new Set(nos);
      const missing = [];
      for (let i = 1; i <= max && missing.length < 30; i++) if (!have.has(i)) missing.push(i);
      out.nos = { max, missing };
    }
  }
  return out;
}

/* ── 선정현황(업종별 모집단·표본·선정률) — 고른 업종을 먼저, 그다음 표본이 든 업종, 그다음 많은 순, 나머지는 기타 ── */
/* 선정현황은 「업종 2개 + 기타」 세 줄로 보고한다(사용자 지정 2026-10-15). 표본이 든 업종(모집단 5% 이상)을 이름으로 두되, 그런 업종이 3개 이상이면
   전체(모집단) 회사가 많은 2개만 두고 나머지는 기타로 합친다. 표본 업종이 2개보다 적으면 슬라이서로 고른 업종 → 모집단이 큰 업종으로 채운다.
   회사를 넣고 뺄 때마다 다시 센다. */
export function selectionTable(population, chosenRows, roles, preferred = [], named = 2, override = new Map()) {
  // override: 줄 번호 → 업종 묶음 — 2-3 업종이 「기타」인 선정 회사는 사내 재무 DB 업종(표준산업분류)으로 나눈다(사용자 질문 2026-10-15)
  const key = (r) => override.get(r.row) || industryGroup(r.values[roles.industry]) || '기타';
  const pop = new Map(), pick = new Map();
  const tally = (m, rows) => {
    const sets = new Map();
    for (const r of rows) { const k = key(r); if (!sets.has(k)) sets.set(k, new Set()); sets.get(k).add(companyKey(r, roles)); }
    for (const [k, set] of sets) m.set(k, set.size);
  };
  tally(pop, population);
  tally(pick, chosenRows);
  const byPop = (a, b) => (pop.get(b) || 0) - (pop.get(a) || 0) || a.localeCompare(b, 'ko');
  // 모집단이 아주 작은 업종(전체의 5% 미만 — 예: 1개사 중 1개 = 100%)은 표본이 있어도 이름으로 두지 않고 기타로,
  // 빈 자리는 전체 외감회사가 많은 업종(1·2순위)으로 채운다(사용자 지정 2026-10-15)
  const totalPop = [...pop.values()].reduce((a, b) => a + b, 0);
  const big = (k) => (pop.get(k) || 0) >= Math.max(2, totalPop * 0.05);
  let names = [...pick.keys()].filter((k) => k !== '기타' && big(k)).sort(byPop).slice(0, named);
  for (const k of [...preferred, ...[...pop.keys()].sort(byPop)]) {
    if (names.length >= named) break;
    if (k && k !== '기타' && !names.includes(k) && pop.has(k)) names.push(k);
  }
  names = names.sort(byPop);
  const rest = [...new Set([...pop.keys(), ...pick.keys()])].filter((k) => !names.includes(k));
  const sum = (m, ks) => ks.reduce((a, k) => a + (m.get(k) || 0), 0);
  const rows = names.map((k) => ({ name: k, pop: pop.get(k) || 0, pick: pick.get(k) || 0 }));
  rows.push({ name: '기타', pop: sum(pop, rest), pick: sum(pick, rest), merged: rest.filter((k) => k !== '기타') });
  const total = { name: '합계', pop: countCompanies(population, roles), pick: countCompanies(chosenRows, roles) };
  const rate = (x) => (x.pick && x.pop ? (Math.round((x.pick / x.pop) * 1000) / 10).toFixed(1) : '-');
  return { rows: rows.map((x) => ({ ...x, rate: rate(x) })), total: { ...total, rate: rate(total) } };
}

/** 칩이 슬라이서 상자(약 210px) 안에서 몇 줄이 되는가 — 배치용 어림(글자 폭: 한글 13px, 그 밖 7.5px). */
export function chipLines(values, width = 210) {
  let lines = 1, x = 0;
  for (const v of values) {
    const text = [...String(v)].reduce((a, ch) => a + (/[가-힣]/.test(ch) ? 13 : 7.5), 0);
    const w = Math.min(width, text + 16 + 13 + 18 + 5);    // 안쪽 여백 · 세로선 · 개수 · 칩 사이
    if (x && x + w > width) { lines += 1; x = 0; }
    x += w;
  }
  return lines;
}

/* ── 품감 일정(사용자 지정 2026-10-14) ──
 * 기간: 이번 주 월요일부터 이번 달 말까지(지난 주는 안 보임). 오늘이 그 달 마지막 주면 다음 달 말까지. */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monday = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

export function scheduleWindow(today = new Date()) {
  const start = monday(today);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const lastWeek = monday(monthEnd);
  const end = start >= lastWeek ? new Date(today.getFullYear(), today.getMonth() + 2, 0) : monthEnd;
  return { start: iso(start), end: iso(end), extended: start >= lastWeek };
}

/** 기간 안의 평일을 주 단위로 — [[{iso, md, wd}, …], …] */
export function weekdays(startIso, endIso) {
  const [y, m, d] = startIso.split('-').map(Number);
  const cur = new Date(y, m - 1, d);
  const out = [];
  let week = [];
  while (iso(cur) <= endIso) {
    const wd = cur.getDay();
    if (wd >= 1 && wd <= 5) week.push({ iso: iso(cur), md: `${cur.getMonth() + 1}/${cur.getDate()}`, wd: '일월화수목금토'[wd] });
    if (wd === 5 && week.length) { out.push(week); week = []; }
    cur.setDate(cur.getDate() + 1);
  }
  if (week.length) out.push(week);
  return out;
}

/** 한 사람의 한 주 칸 — [{span, ev|null}] (막대는 그 주 안에서 이어진 날만큼 칸을 합친다) */
export function weekCells(week, events) {
  const out = [];
  let i = 0;
  while (i < week.length) {
    const day = week[i].iso;
    const ev = events.find((e) => (e.days || []).includes(day) || (e.start <= day && day <= e.end && !(e.days || []).length));
    if (!ev) { out.push({ span: 1, ev: null }); i += 1; continue; }
    let j = i + 1;
    while (j < week.length && ((ev.days || []).includes(week[j].iso) || (!(ev.days || []).length && week[j].iso <= ev.end))) j += 1;
    out.push({ span: j - i, ev });
    i = j;
  }
  return out;
}

export function firmMatch(firms, q) {
  const k = String(q || '').replace(/회계\s*법인|\s/g, '');
  if (!k) return [];
  return (firms || []).filter((f) => String(f.short || '').includes(k) || String(f.firm || '').replace(/\s/g, '').includes(k));
}

/* ── 명부 대조: 직전개별선정회사 · 차기수임신고내역 ── */
export function inRegister(row, roles, items) {
  const v = row.values || {};
  const key = nameKey(v[roles.company]);
  const biz = String(v[roles.biz_no] || '').replace(/\D/g, '');
  const corp = String(v[roles.corp_no] || '').replace(/\D/g, '');
  return (items || []).some((i) => {
    const ib = String(i.biz_no || '').replace(/\D/g, ''), ic = String(i.corp_no || '').replace(/\D/g, '');
    if (biz.length === 10 && ib.length === 10) return ib === biz;
    if (corp.length === 13 && ic.length === 13) return ic === corp;
    return nameKey(i.company) === key;
  });
}

/** 명부 색인 — 회사가 많은 명부(심사·감리 이력 수천 줄)를 줄마다 훑지 않게. 맞는 명부 줄들을 돌려준다. */
export function registerIndex(items) {
  const biz = new Map(), corp = new Map(), name = new Map();
  const add = (m, k, i) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(i); };
  for (const i of items || []) {
    const b = String(i.biz_no || '').replace(/\D/g, ''), c = String(i.corp_no || '').replace(/\D/g, '');
    if (b.length === 10) add(biz, b, i);
    if (c.length === 13) add(corp, c, i);
    add(name, nameKey(i.company), i);
  }
  return { biz, corp, name, size: (items || []).length };
}

export function registerLookup(row, roles, index) {
  if (!index || !index.size) return [];
  const v = row.values || {};
  const b = String(v[roles.biz_no] || '').replace(/\D/g, '');
  const c = String(v[roles.corp_no] || '').replace(/\D/g, '');
  const hit = (b.length === 10 && index.biz.get(b)) || (c.length === 13 && index.corp.get(c)) || index.name.get(nameKey(v[roles.company]));
  return hit || [];
}

/** 한 달 — {start, end} (그 달 1일~말일) */
export function monthWindow(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, '0')}` };
}

/** 일정이 있는 달들(오름차순) — 월 넘기기에 쓴다 */
export function eventMonths(events) {
  const set = new Set();
  for (const e of events || []) {
    let [y, m] = String(e.start).slice(0, 7).split('-').map(Number);
    const [ey, em] = String(e.end).slice(0, 7).split('-').map(Number);
    while (y < ey || (y === ey && m <= em)) { set.add(`${y}-${String(m).padStart(2, '0')}`); m += 1; if (m > 12) { m = 1; y += 1; } }
  }
  return [...set].sort();
}

/** 화면 표시용 회사명 — 주식회사·(주)·㈜ → ㈜, 유한회사·(유) → (유), 그 옆 빈칸은 없앤다(사용자 지정 2026-10-14). 원본 값은 그대로 둔다. */
export function displayName(v) {
  return S(v)
    .replace(/\s*(주식회사|\(\s*주\s*\)|（\s*주\s*）|㈜)\s*/g, '㈜')
    .replace(/\s*(유한회사|\(\s*유\s*\)|（\s*유\s*）)\s*/g, '(유)')
    .trim();
}

/** 체크포인트 한 줄의 대표 회사 — 자산총계 큰 순, 같으면 당기순이익 큰 순, 줄에 들어가는 만큼(최대 max) — {all(정렬된 원래 이름), shown, more} */
export function topCompanyList(names, data, max = 3, budget = 999) {
  const roles = (data && data.roles) || {};
  const num = (v) => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : -Infinity; };
  const size = new Map();
  for (const r of (data && data.rows) || []) {
    const k = nameKey(r.values[roles.company]);
    const a = num(r.values[roles.assets]), ni = num(r.values[roles.net_income]);
    const prev = size.get(k);
    if (!prev || a > prev[0]) size.set(k, [a, ni]);
  }
  const uniq = [...new Map(names.filter(Boolean).map((n) => [nameKey(n), n])).values()];
  uniq.sort((x, y) => {
    const [ax, nx] = size.get(nameKey(x)) || [-Infinity, -Infinity];
    const [ay, ny] = size.get(nameKey(y)) || [-Infinity, -Infinity];
    return (ay - ax) || (ny - nx) || 0;
  });
  const shown = [];
  let len = 0;
  for (const n of uniq.slice(0, max)) {
    const w = shortName(n).length + 2;
    if (shown.length && len + w > budget) break;
    shown.push(n);
    len += w;
  }
  return { all: uniq, shown, more: uniq.length > shown.length };
}

export function topCompanies(names, data, max = 3, budget = 999) {
  const t = topCompanyList(names, data, max, budget);
  return t.shown.map(shortName).join(', ') + (t.more ? ' 등' : '');
}

/** 알림용 짧은 회사명 — ㈜ 통일 + 피에프브이·프로젝트금융투자→PFV, 특수목적회사·에스피씨→SPC, 에스피브이→SPV(사용자 지정 2026-10-15) */
export function shortName(v) {
  // 부동산투자회사(리츠)도 영문 줄임말로(사용자 지정 2026-10-15) — 기업구조조정은 CR-REITs, 위탁관리·자기관리·그냥 부동산투자회사는 REITs
  return displayName(v).replace(/피에프브이|프로젝트금융투자/g, 'PFV').replace(/특수목적회사|에스피씨/g, 'SPC').replace(/에스피브이/g, 'SPV')
    .replace(/기업구조조정부동산투자회사/g, 'CR-REITs').replace(/(위탁관리|자기관리)?부동산투자회사/g, 'REITs');
}

/* ── 조서 날짜 비교(2-3 ↔ 2-8) — 「2-8 취합완료일과 2-3 입고일의 차이가 큰가」를 화면에서 바로(사용자 질문 2026-10-15) ── */
const toDate = (v) => {
  const m = /(\d{4}|\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/.exec(S(v));
  if (!m) return null;
  const y = +m[1] < 100 ? 2000 + +m[1] : +m[1];
  return new Date(y, +m[2] - 1, +m[3]);
};
const dayDiff = (a, b) => (a && b ? Math.round((a - b) / 86400000) : null);
const ymd = (d) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '');

/* 조서 취합완료일(사용자 지정 2026-10-15) — 전산조서 archive일·서면조서 창고입고일 중 빠른 날.
   개별은 감사보고서일, 연결은 연결감사보고서일부터 따로 60일. 2-8 취합완료일은 맞춰 보기(참고)로만. 당기분만. */
const earliest = (...ds) => ds.filter(Boolean).sort((a, b) => a - b)[0] || null;

export function workpaperDates(result) {
  const s23 = result || {}, s28 = (result && result.others && result.others.s28) || null;
  const r3 = s23.roles || {}, r8 = (s28 && s28.roles) || {};
  if (!r3.archive && !r3.warehouse && !r3.con_archive && !r3.con_warehouse && !s28) return null;
  const yr = (v) => (S(v).startsWith('전기') ? '전기' : '당기');
  const idx = new Map();
  for (const row of (s28 && s28.rows) || []) {
    if (yr(row.values[r8.year]) === '당기') idx.set(nameKey(row.values[r8.company]), row);
  }
  const rows = [];
  for (const row of s23.rows || []) {
    const v3 = row.values;
    if (!S(v3[r3.company]) || yr(v3[r3.year]) === '전기') continue;
    const rd = toDate(v3[r3.report_date]), crd = toDate(v3[r3.con_report_date]) || null;
    const arc = toDate(v3[r3.archive]), wh = toDate(v3[r3.warehouse]);
    const carc = toDate(v3[r3.con_archive]), cwh = toDate(v3[r3.con_warehouse]);
    const cd = earliest(arc, wh), ccd = earliest(carc, cwh);
    const m = idx.get(nameKey(v3[r3.company]));
    const col = m ? toDate(m.values[r8.collect_date]) : null;
    if (!cd && !ccd && !col) continue;
    rows.push({
      company: v3[r3.company], rd: ymd(rd), archive: ymd(arc), warehouse: ymd(wh), collect: ymd(cd), days: dayDiff(cd, rd),
      crd: ymd(crd), con_collect: ymd(ccd), con_days: dayDiff(ccd, crd || rd),
      c28: ymd(col), gap: dayDiff(col, cd),
    });
  }
  const over = (k) => rows.filter((r) => r[k] !== null && r[k] > 60).length;
  const gaps = rows.map((r) => r.gap).filter((g) => g !== null);
  return {
    rows,
    summary: {
      total: rows.length, over: over('days'), con_over: over('con_days'),
      with28: rows.filter((r) => r.c28).length, same: gaps.filter((g) => g === 0).length, diff: gaps.filter((g) => g !== 0).length,
    },
  };
}

/** 알림용 짧은 항목 이름 — 한 줄에 들어가게 */
export function shortTitle(t) {
  return String(t || '')
    .replace(/^조서 취합완료 60일 초과$/, '조서 취합 60일 초과')
    .replace(/^조서 제출 60일 초과 — /, '조서 60일 초과·')
    .replace(/2-8 자체점검 조서 취합완료일/, '2-8 취합완료일')
    .replace(/2-3 (개별|연결) (전산조서 archive일|서면조서 창고입고일)/, (m, a, b) => `2-3 ${a} ${b.includes('archive') ? 'archive' : '창고입고'}`)
    .replace(/^동일 이사 연속감사 한도\((\d)개 사업연도\) 초과$/, '연속감사 한도($1개) 초과')
    .replace(/^연속 \d개 사업연도 감사 뒤 (\d)개 사업연도 안에 같은 이사 재투입$/, '교체 후 $1년 안 재투입')
    .replace(/^담당이사가 자기 회사를 심리$/, '자기심리')
    .replace(/^담당이사 상호 교차심리.*$/, '교차심리')
    .replace(/^감사보고서일이 심리·종결보다 앞섬$/, '보고서일이 심리·종결보다 앞섬')
    .replace(/^비감사용역 성격 확인.*$/, '비감사용역 확인')
    .replace(/^감사대상회사의 지배·종속\(관계\)회사에 비감사용역$/, '관계회사 비감사용역')
    .replace(/^사전 심리자가 사후심리도 함$/, '사전·사후 심리 같은 사람');
}

/* ── 회계법인 감사인감리 한 줄(사용자 지정 2026-10-15) ──
   「회계법인 나루 · 26.10.19(월)~26.10.23(금) · 선정사유 과다수임 · 최근감리 없음 · 개별 4개사(외감 101개) · 팀장 전영조 · 팀원 김정은(비상근) ·
    본사 … · 분사무소 서울(강남), 부산3(서면, 해운대, 금정) · 대표 김주형 · ☎ 02-780-9120」 */
const WD = '일월화수목금토';
function ymdShort(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(S(iso));
  if (!m) return '';
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return `${m[1].slice(2)}.${+m[2]}.${+m[3]}(${WD[d.getDay()]})`;
}

/** 과거 감리이력 글(「본회 감리(2013, 2019)」·「감리미실시」)·최근감리 칸 → 최근 한 해 또는 「없음」 */
export function lastReview(f) {
  const last = S(f.last_review);
  const hist = S(f.history);
  const years = [...`${last} ${hist}`.matchAll(/(?:19|20)\d{2}/g)].map((x) => +x[0]);
  if (years.length) return String(Math.max(...years));
  if (/미실시|없음|^-$/.test(hist) || !hist) return '없음';
  return hist;
}

/** 분사무소 「서울(강남), 부산(서면), 부산(해운대)」 → 「서울(강남), 부산2(서면, 해운대)」 */
export function groupBranches(text) {
  const t = S(text);
  if (!t || t === '없음') return '없음';
  const order = [], by = new Map();
  for (const part of t.split(/\s*,\s*/).filter(Boolean)) {
    const m = /^([^()]+?)\s*(?:\((.*)\))?$/.exec(part);
    const city = m ? m[1].trim() : part, sub = m && m[2] ? m[2].trim() : '';
    if (!by.has(city)) { by.set(city, []); order.push(city); }
    by.get(city).push(sub);
  }
  return order.map((city) => {
    const subs = by.get(city).filter(Boolean);
    const n = by.get(city).length;
    if (n > 1) return `${city}${n}${subs.length ? `(${subs.join(', ')})` : ''}`;
    return subs.length ? `${city}(${subs[0]})` : city;
  }).join(', ');
}

export function firmBrief(f, regular = new Set(), dart = null, firms = []) {
  if (!f) return '';
  const who = (n) => (n ? `${n}${regular.size && !regular.has(String(n).replace(/\s/g, '')) ? '(비상근)' : ''}` : '');
  // 대부분과 다른 것은 파란 굵은 글씨(사용자 지정 2026-10-15) — 시작 요일·감리 일수·개별선정 개수, 외감 100개 초과
  const em = (x) => `<span class="em-blue">${x}</span>`;
  const wd = (iso) => (iso ? '일월화수목금토'[new Date(`${String(iso).slice(0, 10)}T00:00:00`).getDay()] : '');
  const days = (x) => (x.start && x.end ? Math.round((new Date(`${x.end}T00:00:00`) - new Date(`${x.start}T00:00:00`)) / 86400000) + 1 : null);
  const usual = (arr) => { const c = new Map(); arr.filter((v) => v != null && v !== '').forEach((v) => c.set(v, (c.get(v) || 0) + 1)); return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; };
  const others = firms.length ? firms : [f];
  const oddStart = f.start && wd(f.start) !== usual(others.map((x) => wd(x.start)));
  const oddDays = f.start && f.end && days(f) !== usual(others.map(days));
  const oddReviews = f.reviews != null && f.reviews !== '' && Number(f.reviews) !== Number(usual(others.map((x) => (x.reviews == null || x.reviews === '' ? null : Number(x.reviews)))));
  const dateOf = (iso, odd) => { const t = ymdShort(iso); const m = /^(.*)(\(.\))$/.exec(t); return odd && m ? `${m[1]}${em(m[2])}` : t; };
  const parts = [
    `<b>${f.firm}</b>`,
    f.start ? `${dateOf(f.start, oddStart)}~${dateOf(f.end, oddDays)}` : '',
    f.reason ? `선정사유: ${f.reason}` : '',
    `최근감리: ${lastReview(f)}`,
    f.reviews || f.audits ? `개별 ${oddReviews ? em(`${f.reviews}개사`) : `${f.reviews ?? '-'}개사`} 선정(외감회사수 ${Number(f.audits) > 100 ? em(`${f.audits}개`) : `${f.audits ?? '-'}개`})` : '',
    f.lead ? `팀장: ${who(f.lead)}` : '',
    f.member ? `팀원: ${who(f.member)}` : '',
    (dart && dart.head_office) || f.office ? `본사: ${shortAddr((dart && dart.head_office) || f.office)}` : '',
    `분사무소: ${dart ? groupBranches(dart.branches) : (Number(f.branches) > 1 ? `${Number(f.branches) - 1}곳(목록 조회 중)` : '없음')}`,
    f.ceo || (dart && dart.ceo) ? `대표: ${f.ceo || dart.ceo}` : '',
    f.phone ? `전화: ${f.phone}` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}

/** 일정 찾기 검색어 → 낱말들. 「회계법인 나루」·「나루 회계법인」은 한 낱말로 붙이고, 「회계법인」·「회계」·「법인」만 있는 낱말은 버린다. */
export function searchTerms(q) {
  return S(q).replace(/회계\s*법인\s+(?=[^\s,])/g, '회계법인').replace(/([^\s,])\s+회계\s*법인/g, '$1회계법인')
    .split(/[,\s]+/).filter((t) => t && t.replace(/회계|법인/g, ''));
}

/* ── 관리자설정 캘린더(사용자 지정 2026-10-15) ── 그 달이 걸친 주(월~금)마다 회계법인 막대의 칸 위치 */
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function calendarWeeks(ym, firms) {
  const { start, end } = monthWindow(ym);
  const d = new Date(`${start}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));              // 그 주 월요일
  const weeks = [];
  while (isoOf(d) <= end) {
    const days = [0, 1, 2, 3, 4].map((i) => { const x = new Date(d); x.setDate(d.getDate() + i); return isoOf(x); });
    const bars = [];
    for (const f of firms || []) {
      if (!f.start || !f.end || f.end < days[0] || f.start > days[4]) continue;
      const a = days.findIndex((x) => x >= f.start), b = 4 - [...days].reverse().findIndex((x) => x <= f.end);
      if (a < 0 || b < a) continue;
      bars.push({ firm: f, from: a, to: b, cutL: f.start < days[0], cutR: f.end > days[4] });
    }
    bars.sort((x, y) => x.from - y.from || (y.to - y.from) - (x.to - x.from) || String(x.firm.firm).localeCompare(String(y.firm.firm), 'ko'));
    weeks.push({ days, bars });
    d.setDate(d.getDate() + 7);
  }
  return weeks;
}

/* 관리자 조정 이력 한 줄 — 「10/15(목) 회계법인 나루 일정 변경 : 10/19(월)~10/23(금) ⇒ 10/20(화)~10/23(금)」 */
export function historyLine(h) {
  const md = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(S(iso));
    return m ? `${+m[2]}/${+m[3]}(${'일월화수목금토'[new Date(+m[1], +m[2] - 1, +m[3]).getDay()]})` : '';
  };
  const span = (x) => `${md(x.start)}~${md(x.end)}`;
  if (h.kind === 'schedule') return `${md(h.at)} ${h.firm} 일정 변경 : ${span(h.before || {})} ⇒ ${span(h.after || {})}`;
  const ch = (h.changes || []).map((c) => `${c.role} ${c.before || '(없음)'} ⇒ ${c.after || '(없음)'}`).join(', ');
  return `${md(h.at)} ${h.firm} 참여인원 변경 : ${ch} 으로 변경 반영`;
}

/* 회계기간이 12개월이 아닌 회사(사용자 지정 2026-10-15) — 「3개월단위」·「6개월단위」 참고 표시.
   결산기 열(「6월, 12월」·「반기」·「분기」·「3개월」)을 먼저 보고, 없으면 같은 회사의 당기 줄이 여러 개인지로 짐작한다. */
export function periodMonths(row, rows, roles) {
  const fiscal = S((row.values || {})[roles.fiscal]);
  const months = new Set((fiscal.match(/(\d{1,2})\s*월/g) || []).map((m) => parseInt(m, 10)).filter((m) => m >= 1 && m <= 12));
  let per = 0;
  if (months.size >= 2) per = months.size;
  else if (/분기|3\s*개월/.test(fiscal)) per = 4;
  else if (/반기|6\s*개월/.test(fiscal)) per = 2;
  else if (!fiscal || months.size === 1) {
    const k = nameKey((row.values || {})[roles.company]);
    const cur = (r) => !roles.year || !S(r.values[roles.year]).startsWith('전기');
    if (cur(row) && k) {
      const same = rows.filter((r) => cur(r) && nameKey(r.values[roles.company]) === k);
      // 감사보고서일 간격(가운데 값)으로 단위를 본다 — 줄 수로만 보면 전년도분이 섞인 5줄(3개월 결산)을 놓친다
      const ds = [...new Set(same.map((r) => S(r.values[roles.report_date]).slice(0, 10)).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort()
        .map((x) => new Date(`${x}T00:00:00`));
      if (ds.length >= 2) {
        const gaps = ds.slice(1).map((d, i) => (d - ds[i]) / 86400000).sort((a, b) => a - b);
        const m = Math.round(gaps[Math.floor(gaps.length / 2)] / 30.4);
        if ([1, 2, 3, 4, 6].includes(m)) per = 12 / m;
      } else if (same.length >= 2) per = same.length;
    }
  }
  return per >= 2 && 12 % per === 0 ? 12 / per : 0;
}

/* 시트 번호만 쓰지 않고 「번호. 짧은 이름」으로(사용자 지정 2026-10-15) — 「2-3 에 없음」 → 「2-3. 외감회사에 없음」.
   이미 「2-3.」처럼 이름이 붙었거나 날짜(2023-12-31)·숫자 안이면 그대로. */
export const SHEET_NAMES = { '2-3': '외감회사', '2-8': '자체조서점검', '2-10': '이사교체현황', '4-10': '비감사서비스', '8-3': '사후심리' };
export function sheetText(v) {
  return S(v).replace(/(^|[^\d.\-])(2-10|2-3|2-8|4-10|8-3)(?![\d.\-])(\s*(?:에|의)(?=\s|$))?/g, (m, pre, code, josa) => {
    const name = `${code}. ${SHEET_NAMES[code]}`;
    return pre + name + (josa ? josa.trim() : '');
  });
}

/* 주소의 시·도 이름을 짧게(사용자 지정 2026-10-15) — 서울특별시→서울시, 부산광역시→부산, 제주특별자치도→제주, ○○특례시→○○ */
const SIDO = [[/^서울특별시/, '서울시'], [/^(부산|대구|인천|광주|대전|울산)광역시/, '$1'], [/^세종특별자치시/, '세종'], [/^제주특별자치도/, '제주'],
  [/^경기도/, '경기'], [/^강원(특별자치)?도/, '강원'], [/^충청북도/, '충북'], [/^충청남도/, '충남'], [/^(전라북도|전북특별자치도)/, '전북'],
  [/^전라남도/, '전남'], [/^경상북도/, '경북'], [/^경상남도/, '경남'], [/^(\S+?)특례시/, '$1']];
export function shortAddr(v) {
  let t = S(v);
  for (const [re, to] of SIDO) if (re.test(t)) { t = t.replace(re, to); break; }
  return t;
}

/* 무압축 zip(PDF·xlsx 는 이미 압축돼 있어 그대로 묶는다) — 파일 이름은 UTF-8(한글) */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; };
export function makeZip(files) {
  const enc = new TextEncoder();
  const seen = new Map();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    let name = f.name;
    const n = (seen.get(name) || 0) + 1; seen.set(f.name, n);
    if (n > 1) name = name.replace(/(\.[^.]+)?$/, ` (${n})$1`);
    const nb = enc.encode(name), data = f.data, crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, nb.length, 2], [28, 0, 2]]
      .forEach(([o, v, z]) => (z === 4 ? head.setUint32(o, v, true) : head.setUint16(o, v, true)));
    const cen = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4],
      [28, nb.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]]
      .forEach(([o, v, z]) => (z === 4 ? cen.setUint32(o, v, true) : cen.setUint16(o, v, true)));
    parts.push(new Uint8Array(head.buffer), nb, data);
    central.push(new Uint8Array(cen.buffer), nb);
    offset += 30 + nb.length + data.length;
  }
  const size = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, size, 4], [16, offset, 4]]
    .forEach(([o, v, z]) => (z === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true)));
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

