/* [품감] 통합(개발) — 작업 공간(프로젝트) 저장소(2026-11-11, 사용자 지정).
 *
 * 회계법인 하나 = 프로젝트 하나. 서버에는 남기지 않고 **이 컴퓨터(브라우저 IndexedDB)** 에만 둔다 — 사람마다·PC마다 따로.
 * 담는 것: 고른 회계법인·사업보고서·(붙임1) 값(법인 조회 → [심의안에 반영 →]) · 마지막 제출자료 대사 결과.
 * 심의안 초안 체크(qc.draft.*), 기본 정보(qc.firm.*), 개별선정 선택 내역(qcSample)은 원래 자리에 회계법인별로 저장되므로
 * 프로젝트를 다시 열면 그것들도 그대로 이어진다.
 *
 * 두 모듈(qc.js · qc_sample.js)이 같은 인스턴스를 쓴다(ES 모듈은 한 번만 실행). 바뀌면 `qc:project` 이벤트.
 */
const DB = 'qcTotal', STORE = 'projects', CUR = 'qcTotal.current', MAX = 12;
let cache = null;          // key → 기록
let current = '';

function db() {
  return new Promise((res, rej) => {
    if (!('indexedDB' in window)) { rej(new Error('no indexedDB')); return; }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'key' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode); const s = t.objectStore(STORE); let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => { d.close(); res(out); };
    t.onerror = () => { d.close(); rej(t.error); };
  });
}
const all = (s) => new Promise((res) => { const r = s.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); });

export async function load() {
  if (cache) return cache;
  cache = new Map();
  try { for (const p of await tx('readonly', all)) cache.set(p.key, p); } catch { /* 사생활 모드 등 — 화면은 돈다 */ }
  try { current = localStorage.getItem(CUR) || ''; } catch { current = ''; }
  if (!cache.has(current)) current = '';
  return cache;
}

export const keyOf = (firm) => (firm && firm.corp_code) ? `c:${firm.corp_code}` : `n:${String((firm && (firm.corp_name || firm.name)) || '').replace(/회계\s*법인|\s/g, '')}`;
export function get(key = current) { return (cache && cache.get(key)) || null; }
export function list() { return cache ? [...cache.values()].sort((a, b) => String(b.updated).localeCompare(String(a.updated))) : []; }
export function currentKey() { return current; }

function emit() { document.dispatchEvent(new CustomEvent('qc:project', { detail: get() })); }

async function put(p) {
  p.updated = new Date().toISOString();
  cache.set(p.key, p);
  try { await tx('readwrite', (s) => { s.put(p); }); } catch { /* 저장 못 해도 이 화면 안에서는 이어진다 */ }
  const extra = list().slice(MAX);                      // 오래된 프로젝트는 정리
  for (const x of extra) await remove(x.key, false);
}

/* 법인 조회에서 [심의안에 반영 →] — 회계법인·보고서·(붙임1) 값을 프로젝트로(같은 회계법인이면 덮어씀, 대사 결과는 둔다) */
export async function commit({ firm, report, reports, profile }) {
  await load();
  const key = keyOf(firm);
  const p = { ...(get(key) || {}), key, name: (profile && profile.corp_name) || firm.corp_name || '', firm, report, reports, profile };
  await put(p);
  setCurrent(key);
  return p;
}

/* 제출자료 대사 결과 — 지금 프로젝트(없으면 회계법인 이름으로 새로)에 붙인다 */
export async function saveReview(review, firmHint = {}) {
  await load();
  let key = current;
  if (!key || (firmHint.corp_code && get(key) && get(key).firm && get(key).firm.corp_code !== firmHint.corp_code)) key = keyOf(firmHint);
  if (key === 'n:') return null;
  const p = { ...(get(key) || { key, name: firmHint.corp_name || firmHint.name || '', firm: firmHint.corp_code ? firmHint : null }), review: { ...review, saved: new Date().toISOString() } };
  await put(p);
  if (!current) setCurrent(key); else emit();
  return p;
}

export function setCurrent(key) {
  current = key && cache && cache.has(key) ? key : '';
  try { if (current) localStorage.setItem(CUR, current); else localStorage.removeItem(CUR); } catch { /* */ }
  emit();
}

export async function remove(key, notify = true) {
  if (!cache) return;
  cache.delete(key);
  try { await tx('readwrite', (s) => { s.delete(key); }); } catch { /* */ }
  if (key === current) setCurrent(''); else if (notify) emit();
}

export const when = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
