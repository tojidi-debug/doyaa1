/* GitHub(정적) 사이트용 — 서버 대신 브라우저에서 파이썬(Pyodide)을 돌린다(2026-10-08).
 *   평가표 엑셀: py/qc_eval.py(= backend/src/gumiho/services/qc_eval.py) + openpyxl
 *   사업보고서 해석: py/qc_firm.py(= dart_firm.py 의 순수 함수) + lxml — 원문은 전자공시 중계(relay/Code.gs)가 받아 온다
 * 처음 한 번 엔진(약 10MB)을 받는다. */
(function (root) {
  const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
  let base = null; const mods = {};
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('파이썬 엔진(Pyodide)을 받지 못했습니다 — 인터넷 연결을 확인하세요.')); document.head.append(s); });
  async function py() {
    if (!base) base = (async () => { if (!root.loadPyodide) await loadScript(PYODIDE + 'pyodide.js'); const p = await root.loadPyodide({ indexURL: PYODIDE }); await p.runPythonAsync('import sys\nsys.path.insert(0, "/home/pyodide")'); return p; })();
    try { return await base; } catch (e) { base = null; throw e; }
  }
  /* 모듈 하나(name.py)와 그 의존 패키지를 한 번만 올린다 */
  async function mod(name, prep) {
    if (!mods[name]) mods[name] = (async () => {
      const p = await py(); await prep(p);
      const code = await (await fetch(`py/${name}.py`, { cache: 'no-store' })).text();
      p.FS.writeFile(`/home/pyodide/${name}.py`, code); await p.runPythonAsync(`import ${name}`); return p;
    })();
    try { return await mods[name]; } catch (e) { delete mods[name]; throw e; }
  }
  const pyMessage = (e) => { const m = String((e && e.message) || e); const last = m.trim().split('\n').pop(); return last.replace(/^\w*(Error|Exception):\s*/, '') || m; };
  async function evalXlsx(body) {
    const p = await mod('qc_eval', async (p) => { await p.loadPackage('micropip'); await p.runPythonAsync('import micropip\nawait micropip.install("openpyxl")'); });
    p.globals.set('QC_BODY', JSON.stringify(body));
    const out = await p.runPythonAsync('import json, qc_eval\nqc_eval.build_xlsx(json.loads(QC_BODY))');
    const bytes = out.toJs(); if (out.destroy) out.destroy();
    return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  async function parseFirm(zipB64, rceptNo) {
    const p = await mod('qc_firm', (p) => p.loadPackage('lxml'));
    p.globals.set('QC_ZIP', zipB64); p.globals.set('QC_NO', rceptNo);
    try { return await p.runPythonAsync('import qc_firm\nqc_firm.parse_zip(QC_ZIP, QC_NO)'); }
    catch (e) { throw new Error(pyMessage(e)); }
    finally { p.globals.delete('QC_ZIP'); }
  }
  root.QcStatic = { evalXlsx, parseFirm, py };
})(typeof globalThis !== 'undefined' ? globalThis : this);
