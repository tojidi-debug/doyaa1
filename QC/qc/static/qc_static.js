/* GitHub(정적) 사이트용 — 서버 대신 브라우저에서 파이썬(Pyodide)을 돌린다(2026-10-08).
 *   평가표 엑셀: py/qc_eval.py(= backend/src/gumiho/services/qc_eval.py) + openpyxl
 *   사업보고서 해석: py/qc_firm.py(= dart_firm.py 의 순수 함수) + lxml — 원문은 전자공시 중계(relay/Code.gs)가 받아 온다
 *   외감회사대사: py/qc_audited.py(= services/qc_audited.py) + openpyxl — 공시통합검색 결과는 중계가 받아 온다
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
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const withXlsx = async (p) => { await p.loadPackage('micropip'); await p.runPythonAsync('import micropip\nawait micropip.install("openpyxl")'); };
  async function evalXlsx(body) {
    const p = await mod('qc_eval', withXlsx);
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
  /* 외감회사대사: qc_audited.web_*(인자 목록) — 글(JSON)은 그대로, bytes 는 엑셀 Blob 으로 */
  async function audited(fn, args) {
    const p = await mod('qc_audited', withXlsx);
    p.globals.set('QC_ARGS', JSON.stringify(args));
    try {
      const out = await p.runPythonAsync(`import json, qc_audited\nqc_audited.${fn}(*json.loads(QC_ARGS))`);
      if (typeof out === 'string') return out;
      const bytes = out.toJs(); if (out.destroy) out.destroy(); return new Blob([bytes], { type: XLSX });
    } catch (e) { throw new Error(pyMessage(e)); }
    finally { p.globals.delete('QC_ARGS'); }
  }
  /* [품감] 개별선정·조서(2026-10-15): 서버와 같은 파이썬 패키지(py/gumiho.zip — backend/src/gumiho 의 필요한 것 + 정적판 대역)를 올리고
   * qs_web.call(이름, 인자 JSON) 으로 부른다. 전자공시는 py/httpx.py(대역)가 중계로 보낸다. 처음 한 번 엔진·패키지를 받느라 30초 안팎 */
  let sampleReady = null;
  async function sampleMod() {
    if (!sampleReady) sampleReady = (async () => {
      const p = await py();
      await p.loadPackage(['micropip', 'lxml']);
      await p.runPythonAsync('import micropip\nawait micropip.install(["openpyxl", "xlrd", "holidays", "pypdf"])');
      const zip = await fetch('py/gumiho.zip', { cache: 'no-store' }); if (!zip.ok) throw new Error('파이썬 패키지(py/gumiho.zip)를 받지 못했습니다.');
      p.unpackArchive(await zip.arrayBuffer(), 'zip', { extractDir: '/home/pyodide' });
      const qs = p.pyimport('qs_web'); qs.init(root.QC_RELAY || ((() => { try { return localStorage.getItem('qc.relay') || ''; } catch { return ''; } })()));
      return qs;
    })();
    try { return await sampleReady; } catch (e) { sampleReady = null; throw e; }
  }
  async function sample(fn, args) {
    const qs = await sampleMod();
    const out = await qs.call(fn, JSON.stringify(args || []));   /* async def 를 JS 에서 부르면 Promise — 전역 변수를 쓰지 않아 여러 건이 겹쳐도 섞이지 않는다 */
    return JSON.parse(out);
  }
  root.QcStatic = { evalXlsx, parseFirm, audited, py, sample };
})(typeof globalThis !== 'undefined' ? globalThis : this);
