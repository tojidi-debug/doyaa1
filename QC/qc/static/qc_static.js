/* GitHub(정적) 사이트용 — 서버 대신 브라우저에서 파이썬(Pyodide)으로 평가표 엑셀을 만든다(2026-10-08).
 * 서버와 같은 코드(py/qc_eval.py = backend/src/gumiho/services/qc_eval.py)를 그대로 돌린다. 처음 한 번 엔진(약 10MB)을 받는다. */
(function (root) {
  const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
  let ready = null;
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('파이썬 엔진(Pyodide)을 받지 못했습니다 — 인터넷 연결을 확인하세요.')); document.head.append(s); });
  async function py() {
    if (!ready) ready = (async () => {
      if (!root.loadPyodide) await loadScript(PYODIDE + 'pyodide.js');
      const p = await root.loadPyodide({ indexURL: PYODIDE });
      await p.loadPackage('micropip');
      await p.runPythonAsync('import micropip\nawait micropip.install("openpyxl")');
      const code = await (await fetch('py/qc_eval.py', { cache: 'no-store' })).text();
      p.FS.writeFile('/home/pyodide/qc_eval.py', code);
      await p.runPythonAsync('import sys\nsys.path.insert(0, "/home/pyodide")\nimport qc_eval');
      return p;
    })();
    try { return await ready; } catch (e) { ready = null; throw e; }
  }
  async function evalXlsx(body) {
    const p = await py();
    p.globals.set('QC_BODY', JSON.stringify(body));
    const out = await p.runPythonAsync('import json, qc_eval\nqc_eval.build_xlsx(json.loads(QC_BODY))');
    const bytes = out.toJs(); if (out.destroy) out.destroy();
    return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  root.QcStatic = { evalXlsx, py };
})(typeof globalThis !== 'undefined' ? globalThis : this);
