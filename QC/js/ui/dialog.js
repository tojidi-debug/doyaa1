/* 공용 대화상자 — 브라우저 기본 alert/confirm/prompt 를 대신한다.
 *
 * ## 왜 바꾸나
 *
 * `window.alert()` 이 띄우는 것은 **운영체제 창**이다. 우리 화면과 글꼴·색·모양이
 * 전혀 다르고, 제목에 `10.2.9.109:8000 내용:` 같은 주소가 붙으며, 크롬은
 * 「이 페이지가 추가 대화상자를 표시하지 못하도록 차단」 체크박스까지 붙인다.
 * 사용자가 그것을 한 번 누르면 **그 뒤로 모든 안내가 조용히 사라진다.**
 *
 * 그리고 셋 다 **동기적으로 페이지를 멈춘다.** 뒤에서 돌던 폴링·타이머가 멈추고,
 * iframe 안에서 띄우면 포털 전체가 굳는다.
 *
 * ## 쓰는 법
 *
 *     import { showAlert, showConfirm, showPrompt, showDetail } from './ui/dialog.js';
 *
 *     await showAlert('저장했습니다.');
 *     if (await showConfirm('지울까요?', { danger: true })) { … }
 *     const name = await showPrompt('이름', { value: '기본값' });   // 취소 → null
 *     const v = await showForm({ title, fields: [...] });          // 여러 칸을 한 창에
 *     await showDetail({ title, badge, meta: [...], body });
 *
 * ⚠️ 셋 다 **Promise 를 돌려준다.** 기존 `if (confirm(...))` 자리는
 *    `if (await showConfirm(...))` 로 바꾸고 감싸는 함수를 async 로 만들어야 한다.
 *    `await` 를 빠뜨리면 Promise 객체가 늘 참이라 **묻지도 않고 실행된다.**
 *
 * ## 스타일
 *
 * 페이지마다 CSS 가 달라서(포털·NEWS·관리자가 각자 다른 파일을 쓴다) 이 모듈이
 * 자기 스타일을 직접 넣는다. 디자인 토큰(`--cobalt` 등)이 있으면 그것을 따르고,
 * 없으면 포털 값으로 떨어진다 — 어느 화면에 얹혀도 어색하지 않게.
 */

const STYLE_ID = 'kamp-dialog-style';

const CSS = `
.kd-mask{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;
  justify-content:center;padding:24px;background:#0d243f66;backdrop-filter:blur(2px);
  animation:kd-fade .12s ease}
.kd-card{width:min(540px,100%);max-height:min(76vh,720px);display:flex;flex-direction:column;
  background:#fff;border-radius:14px;overflow:hidden;
  box-shadow:0 24px 60px #0a2b4c40,0 2px 6px #0a2b4c1a;
  font-family:'Noto Sans KR',-apple-system,'Malgun Gothic',sans-serif;
  color:var(--ink,#17243a);animation:kd-rise .16s cubic-bezier(.2,.8,.3,1)}
.kd-card.kd-wide{width:min(680px,100%)}
@keyframes kd-fade{from{opacity:0}}
@keyframes kd-rise{from{opacity:0;transform:translateY(10px) scale(.985)}}
@media(prefers-reduced-motion:reduce){.kd-mask,.kd-card{animation:none}}

.kd-head{display:flex;align-items:flex-start;gap:10px;padding:16px 18px 12px;
  border-bottom:1px solid var(--line,#dce7f2)}
.kd-head h3{margin:0;font-size:15px;font-weight:700;line-height:1.4;letter-spacing:-.01em;flex:1}
.kd-badge{flex:0 0 auto;font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:99px;
  background:var(--ice,#edf8ff);color:var(--cobalt,#1557d5);border:1px solid #cfe6f7;
  white-space:nowrap;margin-top:1px}
.kd-x{flex:0 0 auto;border:0;background:transparent;cursor:pointer;color:#8494a6;
  font-size:15px;line-height:1;padding:3px 4px;border-radius:6px}
.kd-x:hover{background:#eef4f8;color:#41526a}

.kd-body{padding:16px 18px;overflow:auto;flex:0 1 auto;font-size:13px;line-height:1.7;
  color:#31435c;white-space:pre-wrap;word-break:break-word;user-select:text}
.kd-body:empty{display:none}

.kd-meta{display:flex;flex-wrap:wrap;gap:6px 18px;padding:12px 18px;background:#f7fafd;
  border-bottom:1px solid #eef3f8;font-size:12px}
.kd-meta div{display:flex;gap:7px;align-items:baseline}
.kd-meta dt{color:var(--muted,#69778d);font-size:11px;font-weight:600;white-space:nowrap}
.kd-meta dd{margin:0;color:#2b3d55;font-weight:600}

/* ⚠️ .kd-card 는 max-height:min(76vh,720px) + overflow:hidden 이다. 그래서 칸이
   많으면 이 영역이 통째로 잘려 아래 칸에 손이 닿지 않는다 (담은 구역 5개 +
   제목 + 회사명 = 7칸에서 실제로 그랬다). 여기가 늘어나고 줄어드는 자리이므로
   flex:1 1 auto 와 min-height:0 을 함께 준다 — flex 자식은 min-height:0 이
   없으면 내용보다 작아지지 않아 스크롤이 안 생긴다.
   (이 블록은 JS 템플릿 문자열 안이다 — 백틱을 쓰면 문자열이 끊긴다.) */
.kd-fields{padding:4px 18px 16px;display:flex;flex-direction:column;gap:11px;
  flex:1 1 auto;min-height:0;overflow-y:auto}
.kd-fields label{display:block;font-size:11.5px;font-weight:700;color:var(--muted,#69778d);
  margin-bottom:4px}
.kd-fields label em{font-style:normal;color:#c4485c;margin-left:3px}
.kd-fields input,.kd-fields select{width:100%;height:38px;border:1px solid var(--line,#dce7f2);border-radius:9px;
  padding:0 12px;font:inherit;font-size:13px;color:inherit;background:#fff;outline:0}
.kd-fields input:focus,.kd-fields select:focus{border-color:#7cc4ea;box-shadow:0 0 0 3px #1557d51f}
/* 고르는 칸은 화살표 자리를 남기고, 긴 앵커가 칸을 넘치지 않게 자른다. */
.kd-fields select{padding-right:26px;text-overflow:ellipsis;background:#fff;cursor:pointer}
.kd-fields small{display:block;margin-top:4px;font-size:10.5px;color:#8494a6;line-height:1.55}
/* 고르기 목록. 후보가 서넛일 때 단추를 가로로 늘어놓으면 글자가 잘리고,
   무엇이 다른지(대표자·주소) 적을 자리가 없다. 세로로 한 줄씩 준다. */
.kd-choices{display:flex;flex-direction:column;gap:7px;padding:4px 18px 16px}
.kd-choice{display:block;width:100%;text-align:left;padding:11px 13px;cursor:pointer;
  border:1px solid var(--line,#dce7f2);border-radius:10px;background:#fff;font:inherit;
  transition:border-color .12s,background .12s,box-shadow .12s}
.kd-choice:hover{border-color:#7cc4ea;background:#f5fbff}
.kd-choice:focus-visible{border-color:#7cc4ea;box-shadow:0 0 0 3px #1557d51f;outline:0}
.kd-choice b{display:block;font-size:13px;color:#22364f}
.kd-choice small{display:block;margin-top:3px;font-size:11.5px;color:#69778d;line-height:1.6}
.kd-error{color:#c4485c;font-size:11.5px;font-weight:600;padding:0 18px 10px;min-height:0}
.kd-error:empty{display:none}

.kd-foot{display:flex;justify-content:flex-end;gap:7px;padding:12px 18px 16px}
.kd-btn{min-width:78px;height:36px;padding:0 15px;border-radius:9px;cursor:pointer;
  border:1px solid var(--line,#dce7f2);background:#fff;color:#52657b;
  font:700 12.5px 'Noto Sans KR',sans-serif}
.kd-btn:hover{border-color:#81c9ec;color:#0878b7;background:#f3fbff}
.kd-btn.kd-primary{background:var(--cobalt,#1557d5);border-color:var(--cobalt,#1557d5);color:#fff}
.kd-btn.kd-primary:hover{background:#0f47b4;border-color:#0f47b4;color:#fff}
.kd-btn.kd-danger{background:#c4485c;border-color:#c4485c;color:#fff}
.kd-btn.kd-danger:hover{background:#a93a4d;border-color:#a93a4d;color:#fff}
.kd-btn:focus-visible{outline:2px solid #1557d5;outline-offset:2px}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* 한 번에 하나만 띄운다. 브라우저 기본 대화상자는 쌓이면 줄을 서지만, 우리 것이
   겹치면 뒤엣것이 앞엣것을 가린 채 둘 다 열려 있게 된다. */
let current = null;

/* 대화상자의 뼈대. 나머지는 전부 이것을 부른다. */
/* `cancelValue` 는 **닫기·취소·Esc·바깥 클릭이 모두 돌려줄 값**이다.
   종류마다 다르다 — 알림은 그냥 확인이고(true), 확인창은 아니오(false),
   입력창은 값이 없음(null)이다. 한 값으로 뭉뚱그리면 `x === false` 같은
   판정이 조용히 어긋난다. */
function open({ title, badge, body, meta, fields, choices, buttons, wide, cancelValue,
               validate, singleValue = false }) {
  ensureStyle();
  if (current) current.close(null);

  const opener = document.activeElement;
  const mask = document.createElement('div');
  mask.className = 'kd-mask';

  const metaHtml = (meta || []).length
    ? `<div class="kd-meta">${meta
        .map((m) => `<div><dt>${esc(m[0])}</dt><dd>${esc(m[1])}</dd></div>`)
        .join('')}</div>`
    : '';

  mask.innerHTML = `
    <div class="kd-card${wide ? ' kd-wide' : ''}" role="dialog" aria-modal="true"
         aria-labelledby="kd-title">
      <div class="kd-head">
        <h3 id="kd-title">${esc(title)}</h3>
        ${badge ? `<span class="kd-badge">${esc(badge)}</span>` : ''}
        <button type="button" class="kd-x" data-kd="cancel" aria-label="닫기">✕</button>
      </div>
      ${metaHtml}
      <div class="kd-body">${esc(body || '')}</div>
      ${(choices || []).length
        ? `<div class="kd-choices">${choices.map((c, i) => `
             <button type="button" class="kd-choice" data-kd="choice" data-index="${i}">
               <b>${esc(c.label)}</b>${c.hint ? `<small>${esc(c.hint)}</small>` : ''}
             </button>`).join('')}</div>`
        : ''}
      ${(fields || []).length
        ? `<div class="kd-fields">${fields.map((f, i) => `
             <div>
               ${f.label ? `<label for="kd-f${i}">${esc(f.label)}${f.required ? '<em>*</em>' : ''}</label>` : ''}
               ${(f.options || []).length
                 /* `options` 가 있으면 고르는 칸이다. 값은 input 과 똑같이
                    `data-name` 으로 걷으므로 부르는 쪽은 구별하지 않는다. */
                 ? `<select id="kd-f${i}" data-name="${esc(f.name || '')}">${
                      f.options.map((o) => {
                        const value = typeof o === 'string' ? o : o.value;
                        const label = typeof o === 'string' ? o : (o.label ?? o.value);
                        return `<option value="${esc(value)}"${
                          String(value) === String(f.value ?? '') ? ' selected' : ''
                        }>${esc(label)}</option>`;
                      }).join('')}</select>`
                 : `<input type="text" id="kd-f${i}" data-name="${esc(f.name || '')}"
                      value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}">`}
               ${f.hint ? `<small>${esc(f.hint)}</small>` : ''}
             </div>`).join('')}</div>
           <div class="kd-error" id="kd-error"></div>`
        : ''}
      <div class="kd-foot">${buttons
        .map((b) => `<button type="button" class="kd-btn${b.cls ? ' ' + b.cls : ''}"
                       data-kd="${esc(b.value)}">${esc(b.label)}</button>`)
        .join('')}</div>
    </div>`;

  document.body.appendChild(mask);
  /* ⚠️ select 도 같이 걷는다. 순서가 `fields` 와 1:1 이어야 `required`·`focus`
     가 맞는 칸을 가리킨다 — querySelectorAll 은 문서 순서를 주므로 맞다. */
  const inputs = [...mask.querySelectorAll('.kd-fields input, .kd-fields select')];
  const errorBox = mask.querySelector('#kd-error');
  /* ⚠️ 반환 모양을 **칸 개수로 추측하지 않는다.** showPrompt 만 값 하나를,
     showForm 은 칸이 하나여도 늘 객체를 돌려준다. 개수로 갈랐더니 칸 하나짜리
     showForm 이 조용히 문자열을 돌려줘서 `v.code` 가 undefined 가 됐다
     (시험이 잡았다). 부르는 쪽이 기대하는 모양은 함수가 정한다. */
  const collect = () =>
    singleValue ? (inputs[0]?.value ?? '')
                : Object.fromEntries(inputs.map((el) => [el.dataset.name, el.value]));

  /* 확인을 눌렀을 때 값이 말이 되는지 본다. 창을 닫고 나서 「코드를 안 적었습니다」
     라고 알리면 사용자가 방금 친 나머지 칸을 다 잃는다. */
  const tryOk = (finish) => {
    if (!inputs.length) { finish(true); return; }
    const value = collect();
    const missing = fields.filter((f, i) => f.required && !inputs[i].value.trim());
    if (missing.length) {
      errorBox.textContent = `${missing.map((f) => f.label || f.name).join(', ')} 을(를) 적어 주세요.`;
      inputs[fields.indexOf(missing[0])].focus();
      return;
    }
    const problem = validate ? validate(value) : '';
    if (problem) { errorBox.textContent = problem; inputs[0].focus(); return; }
    finish(value);
  };

  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      mask.remove();
      if (current && current.mask === mask) current = null;
      /* 열기 전에 눌렀던 자리로 초점을 돌려준다. 키보드로 쓰는 사람이
         대화상자를 닫은 뒤 화면 맨 위로 튀지 않게 한다. */
      if (opener && document.contains(opener)) opener.focus?.();
      resolve(value);
    };
    current = { mask, close: finish };

    mask.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-kd]');
      if (btn) {
        /* 'ok' 는 값 검사를 거치고, 'cancel'(✕ 포함)은 취소값으로 떨어진다.
           **그 밖의 단추는 자기 값을 그대로 돌려준다** — 「고치기」·「지우기」처럼
           닫기 말고 다른 뜻이 있는 단추를 달기 위해서다(2026-09-02, 일정 편집).
           예전에는 여기서 전부 취소값으로 떨어져 그런 단추를 달 수 없었다. */
        if (btn.dataset.kd === 'ok') tryOk(finish);
        else if (btn.dataset.kd === 'cancel') finish(cancelValue);
        else if (btn.dataset.kd === 'choice') finish(choices[Number(btn.dataset.index)].value);
        else finish(btn.dataset.kd);
        return;
      }
      /* 바깥을 누르면 닫는다 — 취소와 같다. 확인이 필요한 것을 실수로
         「예」로 만들지 않기 위해 늘 취소 쪽으로 떨어뜨린다. */
      if (e.target === mask) finish(cancelValue);
    });

    function onKey(e) {
      if (!document.contains(mask)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(cancelValue);
      } else if (e.key === 'Enter' && (!inputs.length || inputs.includes(e.target))) {
        e.preventDefault();
        e.stopPropagation();
        tryOk(finish);
      } else if (e.key === 'Tab') {
        /* 초점을 대화상자 안에 가둔다. 뒤 화면의 단추로 새어 나가면
           보이지 않는 곳을 누르게 된다. */
        const items = [...mask.querySelectorAll('button,input')].filter((el) => !el.disabled);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    /* capture 로 잡는다. 화면들이 Escape 를 자기 모달 닫기에 쓰고 있어서
       버블 단계에서는 그쪽이 먼저 먹는 일이 있다. */
    document.addEventListener('keydown', onKey, true);

    (inputs[0] || mask.querySelector('.kd-choice')
      || mask.querySelector('.kd-btn.kd-primary') || mask.querySelector('.kd-btn'))?.focus();
    /* ⚠️ `select()` 는 <input> 의 것이다. 첫 칸이 고르는 칸(<select>)이면
       없는 함수라 던진다 — 이어붙이기 대화상자가 그 모양이다(시험이 잡았다). */
    if (typeof inputs[0]?.select === 'function') inputs[0].select();
  });
}

/** 알림. 확인 하나. */
export function showAlert(message, { title = '알림' } = {}) {
  // 알림은 어떻게 닫아도 「확인」이다. 물어본 것이 없다.
  return open({ title, body: message, cancelValue: true,
                buttons: [{ label: '확인', value: 'ok', cls: 'kd-primary' }] });
}

/** 예/아니오. `true`/`false` 를 돌려준다. */
export function showConfirm(message, {
  title = '확인', okText = '확인', cancelText = '취소', danger = false,
} = {}) {
  return open({
    title,
    body: message,
    cancelValue: false,
    buttons: [
      { label: cancelText, value: 'cancel' },
      { label: okText, value: 'ok', cls: danger ? 'kd-danger' : 'kd-primary' },
    ],
  });
}

/** 한 줄 입력. 취소하면 `null`. */
export function showPrompt(message, {
  title = '입력', value = '', placeholder = '', okText = '확인',
} = {}) {
  return open({
    title,
    body: message,
    fields: [{ name: 'value', value, placeholder }],
    singleValue: true,
    cancelValue: null,
    buttons: [
      { label: '취소', value: 'cancel' },
      { label: okText, value: 'ok', cls: 'kd-primary' },
    ],
  });
}

/** 자세히 보기. 제목·구분표·항목표·본문을 갖춘 읽기 전용 팝업. */
/** 자세히 보기. 닫으면 `true`.
 *
 * `actions` 로 단추를 더 달 수 있다. **누른 단추의 `value` 가 그대로 돌아온다** —
 * 「닫기」와 Esc·바깥클릭은 `true` 다.
 *
 *     const what = await showDetail({
 *       title: e.title, meta,
 *       actions: [{ label: '고치기', value: 'edit' },
 *                 { label: '지우기', value: 'delete', cls: 'kd-danger' }],
 *     });
 *     if (what === 'edit') …
 */
export function showDetail({ title, badge = '', meta = [], body = '', wide = false,
                             actions = [] } = {}) {
  return open({
    title, badge, meta, body, wide, cancelValue: true,
    buttons: [
      // 위험한 단추를 「닫기」 왼쪽에 둔다. 초점은 늘 kd-primary(닫기)로 간다.
      ...actions.map((a) => ({ label: a.label, value: a.value, cls: a.cls || '' })),
      { label: '닫기', value: 'ok', cls: 'kd-primary' },
    ],
  });
}

/** 여러 칸을 **한 창에서** 받는다. 취소하면 `null`.
 *
 *     const v = await showForm({
 *       title: '경로 추가',
 *       fields: [
 *         { name: 'code',  label: '코드', required: true, hint: '영문·숫자·_·-' },
 *         { name: 'label', label: '이름' },
 *       ],
 *     });
 *     if (v) create(v.code, v.label);
 *
 * ⚠️ prompt 를 연달아 띄우지 말 것. 세 번째 창에서 취소하면 앞의 둘이 허공에
 *    사라지고, 사용자는 무엇을 적었는지 다시 볼 수도 없다.
 */
export function showForm({ title = '입력', description = '', fields = [], okText = '확인',
                           validate = null, wide = false } = {}) {
  return open({
    title, body: description, fields, validate, wide, cancelValue: null,
    buttons: [
      { label: '취소', value: 'cancel' },
      { label: okText, value: 'ok', cls: 'kd-primary' },
    ],
  });
}

/** 여럿 중 하나를 **고르게** 한다. 취소하면 `null`.
 *
 *     const code = await showChoice({
 *       title: '어느 회사입니까?',
 *       body: '같은 이름이 두 곳입니다.',
 *       options: [
 *         { value: '01147520', label: '(주)프레스코', hint: '대표 김영근 · 충남 아산' },
 *         { value: '01224290', label: '주식회사 프레스코', hint: '대표 김준홍 · 경남 양산' },
 *       ],
 *     });
 *
 * ⚠️ 단추(`showDetail` 의 `actions`)로 늘어놓지 말 것. 후보가 서넛이면 글자가
 *    잘리고, **무엇이 다른지 적을 자리가 없다.** 고르는 데 필요한 것은 이름이
 *    아니라 그 옆의 한 줄이다.
 */
export function showChoice({ title = '고르기', body = '', options = [],
                             cancelText = '취소' } = {}) {
  return open({
    title, body, choices: options, cancelValue: null,
    buttons: [{ label: cancelText, value: 'cancel' }],
  });
}

/** 지금 열려 있는 것을 닫는다. 화면을 갈아엎을 때 쓴다. */
export function closeDialog() {
  if (current) current.close(null);
}
