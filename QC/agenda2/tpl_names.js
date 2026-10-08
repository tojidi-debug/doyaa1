/* tpl_names.js — 관리자가 올린 서식(hwpx)의 **이름**으로 어느 서류의 서식인지 가린다 (2026-10-07).
 *
 * [⚙ 관리자설정](admin.html) > 안건 서식(템플릿) 에 올린 파일은 **이름이 서류 이름과 같으면** 그 서류를
 * 만들 때 쓰인다(workspace.js adminTplBuild). 관리 화면(admin.js)은 올린 서식이 어느 단추에 가 닿는지를
 * 같은 규칙으로 보여 주므로, 규칙을 한 곳에 둔다.
 *
 *   조치시행문.hwpx · 질문서.hwpx · 조치사전통지서.hwpx · 대외기관통보용.hwpx
 *   재무제표 심사결과와 조치안 보고.hwpx   ← 「(회장)보고」·「_템플릿」·띄어쓰기 차이는 무시
 *   (심사) 개별_표준중요성_지적1개.hwpx     ← 안건 8종 변형(개별|별도연결 × 표준|감사인 중요성 × 지적 1개|여러개)
 *   조치안.hwpx (= 안건.hwpx · 심사종결 조치안.hwpx · 심사종결 안건.hwpx)   ← 변형 이름이 없을 때 모든 사건에
 *
 * 안건은 사건에 맞는 변형 이름을 먼저 찾고, 없으면 「조치안.hwpx」, 그것도 없으면 null(→ 뼈대로 만든다).
 * 같은 서류의 서식이 여럿이면 올린 날짜(YYYY.MM.DD)가 가장 늦은 것, 같으면 뒤에 올린 것.
 * 브라우저·Node 공용(시험 tpl_names.test.mjs).
 */
(function (root) {
  const DOCS = { agenda: '조치안', question: '질문서', notice: '조치사전통지서', report: '재무제표 심사결과와 조치안 보고', order: '조치시행문', external: '대외기관통보용', persons: '조치대상 인적사항' };
  const LABEL = { agenda: '조치안(안건)', question: '질문서', notice: '조치사전통지서', report: '재무제표 심사결과와 조치안 (회장)보고', order: '조치시행문', external: '대외기관통보용', persons: '조치대상 인적사항(엑셀)' };
  /* persons = 「조치대상 인적사항_심사종결.xlsx」(후속문서 6종째, 사용자 지정 2026-10-07) — 엑셀 서식이라 {{ }} 가 없다. 이름에 「인적사항」이 들면 이것 */
  const KEYS = ['agenda', 'question', 'notice', 'report', 'order', 'external', 'persons'];
  /* 관리자가 「어느 서류의 서식인가」를 고르면 그 서류의 표준 파일 이름으로 저장한다 */
  const CANON = { agenda: '(심사) 표준_조치안.hwpx', question: '질문서.hwpx', notice: '조치사전통지서.hwpx', report: '재무제표 심사결과와 조치안 보고.hwpx', order: '조치시행문.hwpx', external: '대외기관통보용.hwpx', persons: '조치대상 인적사항_심사종결.xlsx' };
  const EXT = { persons: '.xlsx' };   /* 그 밖은 .hwpx */
  const AGENDA_ALIASES = ['조치안', '안건', '심사종결조치안', '심사종결안건', '심사결과조치안', '재무제표에대한심사결과조치안', '양정위원회조치안', '(심사)표준_조치안', '표준_조치안', '표준조치안'];
  const STANDARD_FILE = '(심사) 표준_조치안.hwpx';   /* 사건 유형(개별/별도연결 · 표준/감사인 · 지적 수)에 맞춰 구역을 켜고 끄는 서식 한 벌(2026-10-07) */
  const SCOPES = ['개별', '별도연결'], MATS = ['표준중요성', '감사인중요성'], COUNTS = ['1개', '여러개'];
  const VARIANT_RE = /^\(심사\)(개별|별도연결)_(표준중요성|감사인중요성)_지적(1개|여러개)$/;

  const norm = (s) => String(s || '').replace(/\.(hwpx|xlsx)$/i, '').replace(/_?템플릿$/, '').replace(/\(회장\)/g, '').replace(/[\s·]+/g, '');
  const variantFile = (scope, mat, count) => `(심사) ${scope}_${mat}_지적${count}.hwpx`;

  /* 이름 → { key, variant|null, file(기본 서식 원본 파일 이름) } · 서류 이름이 아니면 null */
  function parse(name) {
    const n = norm(name);
    const m = n.match(VARIANT_RE);
    if (m) return { key: 'agenda', variant: { scope: m[1], mat: m[2], count: m[3] }, file: variantFile(m[1], m[2], m[3]) };
    if (AGENDA_ALIASES.includes(n)) return { key: 'agenda', variant: null, file: STANDARD_FILE };
    if (/인적사항/.test(n)) return { key: 'persons', variant: null, file: '조치대상 인적사항_심사종결.xlsx' };
    for (const k of KEYS) if (k !== 'agenda' && k !== 'persons' && norm(DOCS[k]) === n) return { key: k, variant: null, file: DOCS[k] + '.hwpx' };
    /* 정확히 같지 않아도 서류 말이 **들어 있으면** 그 서류(「(신양식)1. 조치시행문_작성사례.hwpx」 같은 이름, 2026-10-07). 긴 말부터 본다 */
    const CONTAINS = [['notice', /조치사전통지서/], ['order', /조치시행문/], ['external', /대외기관통보/], ['report', /조치안보고|회장보고|심사결과와조치안/], ['question', /질문서/], ['agenda', /조치안|안건/]];
    for (const [k, re] of CONTAINS) if (re.test(n)) return { key: k, variant: null, file: k === 'agenda' ? STANDARD_FILE : DOCS[k] + '.hwpx', loose: true };
    return null;
  }

  /* 이 사건에 맞는 안건 변형 — 별도+연결 지적이면 「별도연결」, 어느 해든 감사인 중요성으로 양정했으면 「감사인중요성」, 지적 2건부터 「여러개」 */
  function variantOf(S, G) {
    let both = false, aud = false;
    try { both = !!(G && G.isBoth && G.isBoth(S)); } catch (e) {}
    try { const CA = G && G.calcAll ? G.calcAll(S) : null;
      aud = !!CA && (CA.bases || []).some(b => Object.values(((CA.by || {})[b] || {}).yearBasis || {}).includes('auditor')); } catch (e) {}
    const many = (((S || {}).findings) || []).length > 1;
    const scope = both ? SCOPES[1] : SCOPES[0], mat = aud ? MATS[1] : MATS[0], count = many ? COUNTS[1] : COUNTS[0];
    return { scope, mat, count, file: variantFile(scope, mat, count) };
  }

  /* 관리자 서식 목록에서 서류 key 에 쓸 것 하나 — 없으면 null */
  function pick(templates, key, S, G) {
    const xs = (templates || []).filter(x => x && x.data && (parse(x.name) || {}).key === key);
    if (!xs.length) return null;
    const latest = (ys) => ys.reduce((a, b) => (String(b.date || '') >= String(a.date || '') ? b : a));
    if (key !== 'agenda') return latest(xs);
    const v = variantOf(S, G);
    const exact = xs.filter(x => parse(x.name).file === v.file);
    if (exact.length) return latest(exact);
    const generic = xs.filter(x => !parse(x.name).variant);
    return generic.length ? latest(generic) : null;
  }

  /* 관리 화면 설명: 이 이름이면 어디에 쓰이는가 */
  function describe(name) {
    const p = parse(name); if (!p) return null;
    if (p.key !== 'agenda') return `④ 「${LABEL[p.key]}」 단추(6종 일괄 포함)`;
    return p.variant ? `④ 안건 HWPX — ${p.variant.scope} · ${p.variant.mat} · 지적 ${p.variant.count} 사건` : '④ 안건 HWPX — 변형 이름의 서식이 없는 모든 사건';
  }

  /* 기본 서식 원본(함께 배포) 파일 이름 — 안건 8종 + 조치안 + 후속서류 5종 */
  function builtinFiles() {
    const out = [{ file: STANDARD_FILE, key: 'agenda', note: '표준 서식 — 개별/별도+연결 · 표준/감사인 중요성 · 지적 수에 맞춰 구역이 저절로 켜지고 꺼진다({{% if %}}). 이것 하나로 모든 사건' }];
    for (const s of SCOPES) for (const m of MATS) for (const c of COUNTS) out.push({ file: variantFile(s, m, c), key: 'agenda', note: `${s === '개별' ? '개별(별도)재무제표만' : '별도+연결 지적'} · ${m === '표준중요성' ? '표준 중요성' : '감사인 중요성 적용'} · 지적사항 ${c === '1개' ? '1건' : '2건 이상'}` });
    out.push({ file: '조치안.hwpx', key: 'agenda', note: '변형 이름 없이 모든 사건에 쓸 때(뼈대 원본)' });
    for (const k of KEYS) if (k !== 'agenda' && k !== 'persons') out.push({ file: DOCS[k] + '.hwpx', key: k, note: LABEL[k] });
    out.push({ file: '조치대상 인적사항_심사종결.xlsx', key: 'persons', none: true, note: '엑셀 · 함께 배포하는 원본이 없다 — 쓰던 파일을 그대로 올리면 된다(머리행 A~F · 둘째 줄 보기값). 안 올리면 단추가 머리행만 있는 빈 틀을 만든다' });
    return out;
  }

  /* 「라벨 : 값」 꼴의 새 줄에서 라벨만 보고 값 자리를 심을 때 쓰는 사전(사용자 지정, 2026-10-07) — 값 이름은 template_data.js 의 기본정보.* */
  const KNOWN_LABELS = [
    [/^(회\s*사\s*명|회사명|상호)$/, '기본정보.회사명'], [/^대표이사$/, '기본정보.대표이사'], [/^법인등록번호$/, '기본정보.법인등록번호'],
    [/^사업자등록번호$/, '기본정보.사업자등록번호'], [/^(본점\s*)?소재지$/, '기본정보.소재지'], [/^(업\s*종|업종)$/, '기본정보.업종'],
    [/^법인구분$/, '기본정보.법인구분'], [/^(설\s*립\s*일|설립일)$/, '기본정보.설립일'], [/^사업연도$/, '기본정보.사업연도'],
    [/^(증선위\s*)?의결일$/, '기본정보.증선위의결일'], [/^담당$/, '기본정보.담당'], [/^주무관$/, '기본정보.주무'], [/^(회계제도)?팀장$/, '기본정보.팀장이름'],
    [/^부서명$/, '기본정보.부서명'], [/^실무\s*담당(자)?$/, '기본정보.실무담당'], [/^수신자$/, '기본정보.회사명'],
  ];
  const labelTag = (label) => { const l = String(label || '').replace(/\s+/g, ' ').trim(); for (const [re, k] of KNOWN_LABELS) if (re.test(l) || re.test(l.replace(/\s+/g, ''))) return '{{' + k + '}}'; return null; };
  root.TplNames = { DOCS, LABEL, KEYS, EXT, STANDARD_FILE, CANON, KNOWN_LABELS, labelTag, norm, parse, variantOf, pick, describe, builtinFiles };
  if (typeof module !== 'undefined') module.exports = root.TplNames;
})(typeof window !== 'undefined' ? window : globalThis);
