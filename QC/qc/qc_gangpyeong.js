/* qc_gangpyeong.js — [품감] 강평(초안) hwpx 만들기(순수 규칙, DOM 없음) (2026-10-08)
 *
 *   QcGang.build(sectionXml, data, model, ctx) → 새 section0.xml 글
 *     data  = frontend/qc/qc_gangpyeong.json(공통 강평자료 sample 에서 뽑은 조직 10항목의 발견사항·개선방향·이행보고 제출문서, 개별 이행내역, 고정 문단)
 *     model = QcDraft.model(…)(심의안 초안 작성의 체크 상태)
 *     ctx   = { firm, year, date }
 *   문단 모양은 서식(sectionXml)의 문단을 본으로 복제한다. ⚠ 지금 서식은 임시로 심의안 서식이다 —
 *   「2026년 감사인감리_강평_OO감사반.hwpx」가 들어오면 그 서식의 문단을 본으로 쓰도록 PROTO 패턴만 바꾸면 된다.
 *   체크한 지적사항만 쓰고(지적 없으면 「지적사항 없음」), 고정 문단(독립성·개선권고 공개·이행 점검·지적사례 등)은 그대로.
 */
(function (root) {
  const D = () => root.QcDraft;
  const esc = (s) => String(s ?? '').replace(/\t/g, '  ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const sq = (s) => String(s || '').replace(/[  　\t]+/g, ' ').trim();

  /* 본으로 쓸 문단 — 서식 글로 찾는다 */
  const PROTO = {
    h1: /^1\. 의결주문$/,
    h2: /^가\. 실시 개요$/,
    box: /^□ 외감법 시행령/,
    cir: /^◦ 감리대상기간/,
    dash: /^- 전반감사전략과 감사계획의 문서화가 미흡함/,
    plain: /에 대한 감사인 감리 실시결과를 별지1과 같이 보고하고/,
    item: /^① 최종 감사파일 취합과 조서관리담당자 지정 일부 미흡$/,
    note: /^※ 회계처리기준 위반 혐의사항이 발견된 ㈜ㅇㅇ에 대해서는 재무제표 감리를 실시하고/,
  };
  function protos(sec) {
    const ps = D().topParas(sec); const out = {};
    for (const [k, re] of Object.entries(PROTO)) {
      const p = ps.find(x => !/<hp:tbl\b/.test(x) && re.test(sq(D().text(x))));
      if (!p) throw new Error(`서식에서 본 문단을 못 찾았습니다: ${k}`);
      out[k] = p.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '');
    }
    out.blank = out.plain.replace(/(<hp:t(?:\s[^>]*)?>)[\s\S]*?(<\/hp:t>)/g, '$1$2');
    const m = /<hp:secPr[\s\S]*?<\/hp:secPr>(\s*<hp:ctrl>\s*<hp:colPr[^>]*\/>\s*<\/hp:ctrl>)?/.exec(sec);
    out.secPr = m ? m[0] : '';
    return out;
  }
  const kindOf = (line) => {
    const t = sq(line);
    if (/^□/.test(t)) return 'box';
    if (/^[ㅇ◦◎○]/.test(t)) return 'cir';
    if (/^[-–‑·>]/.test(t) || /^\d+\)/.test(t)) return 'dash';
    if (/^[※☞⇨]/.test(t)) return 'note';
    if (/^[①-⑳]/.test(t)) return 'item';
    if (/^<.*>$/.test(t) || /^\d+\.\s/.test(t)) return 'h2';
    return 'plain';
  };

  function build(sec, data, model, ctx) {
    const P = protos(sec);
    const out = [];
    const para = (kind, text, opt = {}) => {
      let x = D().setRuns(P[kind] || P.plain, [kind === 'plain' || kind === 'blank' ? ` ${text}` : text]);
      if (opt.pageBreak) x = x.replace(/pageBreak="0"/, 'pageBreak="1"');
      out.push(x);
    };
    const blank = () => out.push(P.blank);
    const lines = (arr) => (arr || []).forEach(l => para(kindOf(l), sq(l)));
    const firm = ctx.firm || '○○회계법인';
    const Y = ctx.year || new Date().getFullYear();

    // 머리
    para('h1', `${Y}년 감사인감리 결과 및 감사품질 유의사항 등`);
    para('plain', `(${firm})`); para('plain', `(${ctx.date || `${Y}. xx. xx.`})`); blank();

    // □ 감사인감리 결과
    para('box', '□ 감사인감리 결과'); blank();
    para('h2', '1. 조직 부문');
    if (!model.org.groups.length) para('cir', 'ㅇ 조직 부문 지적사항 없음');
    for (const g of model.org.groups) {
      para('cir', `ㅇ ${g.title} (${g.typeLabel})`);
      for (const it of g.items) {
        para('item', `${it.no} ${it.title} ${D().CLS_SUFFIX[it.cls] || ''}`.trim());
        const f = sq(it.text) || ((data.org[it.key] || {}).finding || '');
        if (f) para('dash', `- ${f.replace(/^[ㅇ◦]\s*/, '')}`);
      }
    }
    blank();
    para('h2', '2. 개별감사 부문');
    if (!model.indi.items.length) para('cir', 'ㅇ 개별감사 부문 지적사항 없음');
    for (const it of model.indi.items) {
      para('cir', `ㅇ ${it.title}(${it.companies}개사)`);
      for (const f of it.findings) para('dash', `- ${sq(f.text)}`);
    }
    blank();
    if (model.viol && model.viol.any) {
      para('h2', '3. 위반 혐의사항');
      if (model.viol.gaap) para('cir', `ㅇ (회계처리기준 위반 혐의) ${sq(model.viol.gaap.text)}`);
      if (model.viol.gaas) para('cir', `ㅇ (회계감사기준 위반 혐의) ${sq(model.viol.gaas.text)}`);
      for (const l of model.viol.law) para('cir', `ㅇ (${l.title}) ${sq(l.text)}`);
      blank();
    }
    // 고정 문단
    for (const k of ['independence', 'disclosure', 'implement', 'reviolation', 'level']) { lines(data.static[k]); blank(); }

    // □ 이행보고 관련
    para('box', '□ 이행보고 관련', { pageBreak: true }); blank();
    para('h2', '1. 구성원 전체 회의');
    lines((data.static.meeting || []).filter(l => !/^구성원 전체 회의$/.test(sq(l)))); blank();
    para('h2', '2. 조직 부문');
    const flagged = model.org.groups.flatMap(g => g.items.map(it => ({ ...it, group: g.title })));
    if (!flagged.length) para('cir', 'ㅇ 조직 부문 지적사항 없음');
    let lastGroup = '';
    for (const it of flagged) {
      const d = data.org[it.key] || { finding: '', improve: [], submit: [] };
      if (it.group !== lastGroup) { para('h2', `<${it.group}>`); lastGroup = it.group; }
      para('item', `${it.no} ${it.title}`);
      para('plain', '조직운영 부문 발견사항');
      para('cir', `ㅇ ${(sq(it.text) || d.finding).replace(/^[ㅇ◦]\s*/, '')}`);
      para('note', '⇨ 감사인의 현재 운영상황 기재');
      para('plain', '(개선방향)'); lines(d.improve);
      para('plain', '(이행보고 제출문서)'); para('plain', `${Y}회계연도 재무제표에 대한`); lines(d.submit);
      blank();
    }
    para('h2', '3. 개별감사 부문');
    if (!model.indi.items.length) para('cir', 'ㅇ 개별감사 부문 지적사항 없음');
    else {
      para('plain', '(이행보고 제출문서)');
      lines((data.indi_submit.head || []).map(l => l.replace(/^\d{4}회계연도/, `${Y - 1}회계연도`)));
      for (const it of model.indi.items) {
        const keys = it.key === 'i2' ? ['i2'] : [it.key];
        const rows = (data.indi_submit.rows || []).filter(r => keys.includes(r.key));
        para('cir', `ㅇ ${it.title}`);
        if (rows.length) rows.forEach(r => lines(r.lines)); else para('dash', '- 재수행한 감사절차가 적용된 해당부분 조서 사본 제출');
      }
    }
    blank();
    // □ 최근 주요 감리 지적사례 · 추가 검토사항
    const cases = data.static.cases || [];
    if (cases.length) { para('box', sq(cases[0]), { pageBreak: true }); lines(cases.slice(1)); blank(); }
    lines(data.static.future);

    // 첫 문단에 쪽 설정(secPr)을 붙인다
    if (P.secPr && out.length) out[0] = out[0].replace(/(<hp:run\b[^>]*>)/, `$1${P.secPr}`);
    const ps = D().topParas(sec);
    const head = sec.slice(0, sec.indexOf(ps[0])); const tail = sec.slice(sec.lastIndexOf(ps[ps.length - 1]) + ps[ps.length - 1].length);
    return head + out.join('') + tail;
  }

  root.QcGang = { build, kindOf };
})(typeof globalThis !== 'undefined' ? globalThis : this);
