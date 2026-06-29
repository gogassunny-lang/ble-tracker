/* ============================================================
 * BLE Master Upload Module — standalone drop-in
 * Add to ble-report.html with: <script src="./master-upload.js"></script>
 * Place AFTER the supabase-js and xlsx CDN scripts.
 *
 * What it does:
 *   1) On page load, queries the DB for current master version.
 *      If DB has rows → swaps window.MASTER with DB data and re-renders.
 *      If DB empty → keeps the embedded MASTER (no change).
 *   2) For users with `master_upload` permission → injects an "Upload Master"
 *      button in the header. Click → modal → Excel upload → smart-merge
 *      diff preview → confirm → DB write → page refresh of master.
 *   3) Provides a History viewer with rollback to any past version.
 *
 * Developed by Sunny Gupta
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- Wait for the page + supabase client to be ready ---------- */
  function whenReady(cb) {
    if (window.sb && window.MASTER && document.getElementById('userbox')) {
      cb();
    } else {
      setTimeout(() => whenReady(cb), 200);
    }
  }

  /* ---------- Inject CSS once ---------- */
  function injectStyles() {
    if (document.getElementById('master-upload-styles')) return;
    const css = `
      .mu-btn{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1.5px solid #7c3aed;color:#7c3aed;padding:9px 14px;border-radius:10px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;transition:.15s;margin-right:8px}
      .mu-btn:hover{background:#7c3aed;color:#fff}
      .mu-indicator{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#6b7a90;padding:5px 10px;background:#fff;border:1px solid #e6ebf3;border-radius:30px;margin-right:8px}
      .mu-indicator b{color:#10203a;font-weight:700}
      .mu-indicator .dot{width:7px;height:7px;border-radius:50%;background:#16b364}
      .mu-bg{position:fixed;inset:0;background:rgba(16,32,58,.55);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;z-index:1000;padding:20px;font-family:"Plus Jakarta Sans",system-ui,sans-serif}
      .mu-bg.open{display:flex}
      .mu-modal{background:#fff;border-radius:20px;box-shadow:0 12px 40px rgba(16,32,58,.20);width:100%;max-width:680px;max-height:90vh;overflow:auto}
      .mu-modal.wide{max-width:920px}
      .mu-head{padding:20px 24px;border-bottom:1px solid #eef2f8;display:flex;align-items:center;justify-content:space-between;gap:12px}
      .mu-head h3{font-size:17px;font-weight:700;color:#10203a;margin:0}
      .mu-close{background:none;border:none;font-size:22px;cursor:pointer;color:#6b7a90;font-family:inherit;line-height:1}
      .mu-close:hover{color:#f24e6e}
      .mu-body{padding:22px 24px;color:#10203a}
      .mu-foot{padding:14px 24px;border-top:1px solid #eef2f8;display:flex;gap:10px;justify-content:flex-end;background:#fafbfe;flex-wrap:wrap}
      .mu-foot.split{justify-content:space-between}
      .mu-action{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1.5px solid #e6ebf3;color:#10203a;padding:9px 14px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:.15s}
      .mu-action:hover{border-color:#7c3aed;color:#7c3aed}
      .mu-action.primary{background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;border:none;padding:10px 18px;font-weight:700;box-shadow:0 6px 18px rgba(124,58,237,.25)}
      .mu-action.primary:hover{transform:translateY(-1px);color:#fff}
      .mu-action.danger{color:#f24e6e;border-color:rgba(242,78,110,.30)}
      .mu-action.danger:hover{background:#f24e6e;color:#fff;border-color:#f24e6e}
      .mu-action:disabled{opacity:.5;cursor:not-allowed;transform:none}
      .mu-drop{border:2px dashed #d7e0ee;border-radius:14px;padding:30px;text-align:center;background:#fafbfe;transition:.2s;cursor:pointer}
      .mu-drop:hover,.mu-drop.dragging{border-color:#7c3aed;background:rgba(124,58,237,.04)}
      .mu-drop p{color:#6b7a90;font-size:13px;margin:6px 0 0}
      .mu-drop .ic{font-size:32px;margin-bottom:6px}
      .mu-fname{font-size:13px;font-weight:600;color:#16b364;margin-top:10px}
      .mu-msg{padding:11px 14px;border-radius:10px;font-size:13px;margin-bottom:14px}
      .mu-msg.err{background:rgba(242,78,110,.10);color:#f24e6e;border:1px solid rgba(242,78,110,.20)}
      .mu-msg.ok{background:rgba(22,179,100,.10);color:#16b364;border:1px solid rgba(22,179,100,.20)}
      .mu-msg.info{background:rgba(124,58,237,.08);color:#7c3aed;border:1px solid rgba(124,58,237,.20)}
      .mu-msg.warn{background:rgba(245,165,36,.10);color:#c47e0a;border:1px solid rgba(245,165,36,.25)}
      .mu-statsgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin:14px 0 18px}
      .mu-statcard{background:#fafbfe;border:1px solid #eef2f8;border-radius:11px;padding:12px 14px;text-align:center}
      .mu-statcard .n{font-size:22px;font-weight:800;color:#10203a;font-variant-numeric:tabular-nums}
      .mu-statcard .l{font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#6b7a90;font-weight:700;margin-top:3px}
      .mu-statcard.add{border-color:rgba(22,179,100,.25);background:rgba(22,179,100,.05)}
      .mu-statcard.add .n{color:#16b364}
      .mu-statcard.upd{border-color:rgba(47,107,255,.25);background:rgba(47,107,255,.05)}
      .mu-statcard.upd .n{color:#2f6bff}
      .mu-statcard.unc{border-color:#eef2f8}
      .mu-statcard.miss{border-color:rgba(245,165,36,.30);background:rgba(245,165,36,.05)}
      .mu-statcard.miss .n{color:#c47e0a}
      .mu-missbox{margin-top:10px;padding:12px 14px;background:rgba(245,165,36,.07);border:1px solid rgba(245,165,36,.25);border-radius:10px;font-size:12.5px}
      .mu-missbox b{color:#c47e0a;display:block;margin-bottom:6px}
      .mu-misserps{font-family:"Spline Sans Mono",monospace;font-size:11.5px;color:#6b7a90;max-height:80px;overflow:auto;word-break:break-all}
      .mu-histtbl{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:8px}
      .mu-histtbl th{background:#fafbfe;text-align:left;padding:9px 12px;font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:#6b7a90;font-weight:700;border-bottom:1.5px solid #e6ebf3}
      .mu-histtbl td{padding:11px 12px;border-bottom:1px solid #eef2f8;color:#10203a}
      .mu-histtbl tr.current{background:rgba(22,179,100,.05)}
      .mu-histtbl tr.current td{font-weight:600}
      .mu-pill{display:inline-block;padding:2px 9px;border-radius:30px;font-size:10.5px;font-weight:700;background:rgba(22,179,100,.12);color:#16b364}
      .mu-mono{font-family:"Spline Sans Mono",monospace;font-size:11.5px;color:#6b7a90}
      .mu-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(100px);background:#10203a;color:#fff;padding:13px 22px;border-radius:30px;font-size:13px;font-weight:600;box-shadow:0 12px 40px rgba(16,32,58,.30);transition:.3s;z-index:2000;opacity:0;font-family:"Plus Jakarta Sans",system-ui,sans-serif}
      .mu-toast.show{transform:translateX(-50%) translateY(0);opacity:1}
      .mu-toast.err{background:#f24e6e}
      .mu-toast.ok{background:#16b364}
      .mu-spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:muSpin .8s linear infinite;vertical-align:-2px;margin-right:5px}
      @keyframes muSpin{to{transform:rotate(360deg)}}
    `;
    const s = document.createElement('style');
    s.id = 'master-upload-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ---------- Tiny helpers ---------- */
  function toast(msg, type) {
    let t = document.getElementById('mu-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'mu-toast';
      t.className = 'mu-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'mu-toast ' + (type || '') + ' show';
    setTimeout(() => t.classList.remove('show'), 3000);
  }
  function fmtDate(d) {
    if (!d) return '—';
    const x = new Date(d);
    return x.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- Convert DB rows to MASTER object {ERP:{n,s,b,i}} ---------- */
  function rowsToMaster(rows) {
    const out = {};
    rows.forEach(r => {
      const k = String(r.erp || '').trim().toUpperCase();
      if (!k) return;
      out[k] = {
        n: r.station_name || '',
        s: r.state || '',
        b: r.ble_yes ? 'Y' : 'N',
        i: r.iso_yes ? 'Y' : 'N'
      };
    });
    return out;
  }

  /* ---------- Hybrid load: query DB for current master, swap if non-empty ---------- */
  let currentVersionInfo = null;
  async function loadDBMaster() {
    try {
      const { data, error } = await window.sb.rpc('master_get_current');
      if (error) { console.warn('[master-upload] master_get_current error:', error.message); return; }
      if (!data || !data.length) {
        console.log('[master-upload] No DB master yet — using embedded fallback.');
        return;
      }
      const newMaster = rowsToMaster(data);
      const keys = Object.keys(newMaster);
      if (!keys.length) return;
      currentVersionInfo = {
        upload_id: data[0].upload_id,
        uploaded_at: data[0].uploaded_at,
        uploaded_by_name: data[0].uploaded_by_name,
        total_stations: data[0].total_stations
      };
      window.MASTER = newMaster;
      console.log('[master-upload] Swapped MASTER with DB version:', keys.length, 'stations, uploaded', currentVersionInfo.uploaded_at);
      /* If reports were already generated, re-run the pipeline so BLE/Iso flags refresh */
      try {
        if (window.S && window.S.txn && window.S.cust) {
          window.S.final = window.buildFinal(window.S.txn, window.S.cust);
          window.S.state = window.buildState(window.S.final);
          window.renderStats && window.renderStats();
          window.render && window.render();
        }
      } catch (e) { console.warn('[master-upload] re-render after swap failed:', e); }
      updateIndicator();
    } catch (e) {
      console.warn('[master-upload] DB master load failed (network/RLS):', e);
    }
  }

  /* ---------- Indicator (small pill near header) ---------- */
  function updateIndicator() {
    const el = document.getElementById('mu-indicator');
    if (!el) return;
    if (currentVersionInfo) {
      el.innerHTML = '<span class="dot"></span>Master: <b>v' + (currentVersionInfo.total_stations || '?') + '</b> · ' + fmtDate(currentVersionInfo.uploaded_at).split(',')[0];
      el.title = 'DB version live · uploaded by ' + (currentVersionInfo.uploaded_by_name || 'unknown') + ' at ' + fmtDate(currentVersionInfo.uploaded_at);
      el.style.display = 'inline-flex';
    } else {
      el.innerHTML = '<span class="dot" style="background:#9aa7ba"></span>Master: <b>embedded</b>';
      el.title = 'Using built-in master (no DB upload yet)';
      el.style.display = 'inline-flex';
    }
  }

  /* ---------- Permission check ---------- */
  async function hasMasterUploadPerm() {
    try {
      const { data, error } = await window.sb.rpc('has_permission', { p_key: 'master_upload' });
      if (error) { console.warn('[master-upload] has_permission error:', error.message); return false; }
      return !!data;
    } catch (e) { return false; }
  }

  /* ---------- Excel parser ---------- */
  function readXlsx(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = e => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
          resolve(rows);
        } catch (err) { reject(err); }
      };
      r.onerror = reject;
      r.readAsArrayBuffer(file);
    });
  }

  /* ---------- Parse expected columns: ERP, Station, State, BLE Y/N, Isolator Y/N ---------- */
  function findHeader(rows) {
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const r = (rows[i] || []).map(x => String(x || '').trim().toLowerCase());
      const hasErp = r.some(x => x.includes('erp'));
      const hasStation = r.some(x => x.includes('station') || x.includes('name'));
      if (hasErp && hasStation) return i;
    }
    return -1;
  }
  function colIdx(H, predicate) {
    for (let i = 0; i < H.length; i++) {
      if (predicate(String(H[i] || '').trim().toLowerCase())) return i;
    }
    return -1;
  }
  function parseYN(v) {
    if (v === true || v === 1) return true;
    if (v === false || v === 0 || v == null) return false;
    const s = String(v).trim().toUpperCase();
    return s === 'Y' || s === 'YES' || s === 'TRUE' || s === '1';
  }
  function parseRows(rows) {
    const hi = findHeader(rows);
    if (hi < 0) throw new Error('Could not find header row. Expected columns: ERP Code, Station Name, State, BLE Y/N, Isolator Y/N');
    const H = rows[hi];
    const cE = colIdx(H, x => x.includes('erp'));
    const cN = colIdx(H, x => x === 'station name' || x === 'name' || (x.includes('station') && !x.includes('id')));
    const cS = colIdx(H, x => x === 'state');
    const cB = colIdx(H, x => x.includes('ble'));
    const cI = colIdx(H, x => x.includes('iso'));
    if (cE < 0) throw new Error('Missing ERP Code column.');
    if (cN < 0) throw new Error('Missing Station Name column.');
    if (cS < 0) throw new Error('Missing State column.');
    if (cB < 0) throw new Error('Missing BLE Y/N column.');
    if (cI < 0) throw new Error('Missing Isolator Y/N column.');
    const out = [];
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      const erp = String(r[cE] || '').trim().toUpperCase();
      if (!erp) continue;
      out.push({
        erp: erp,
        station_name: String(r[cN] || '').trim(),
        state: String(r[cS] || '').trim(),
        ble_yes: parseYN(r[cB]),
        iso_yes: parseYN(r[cI])
      });
    }
    if (!out.length) throw new Error('No data rows found below header.');
    return out;
  }

  /* ---------- Build upload modal markup ---------- */
  function buildUploadModal() {
    const bg = document.createElement('div');
    bg.className = 'mu-bg';
    bg.id = 'mu-upload-bg';
    bg.innerHTML = `
      <div class="mu-modal">
        <div class="mu-head">
          <h3>📤 Upload Master Data</h3>
          <button class="mu-close" data-close>×</button>
        </div>
        <div class="mu-body" id="mu-upload-body">
          <div class="mu-msg info">
            <b>Expected columns:</b> ERP Code, Station Name, State, BLE Y/N, Isolator Y/N (any order)<br>
            <small>The system will smart-merge: add new ERPs, update changed ones, and warn about ERPs missing from your upload.</small>
          </div>
          <div class="mu-drop" id="mu-drop">
            <div class="ic">📊</div>
            <div style="font-weight:700;color:#10203a;font-size:14px">Choose or drop your Excel file</div>
            <p>.xlsx or .xls</p>
            <div class="mu-fname" id="mu-fname"></div>
          </div>
          <input type="file" id="mu-file" accept=".xlsx,.xls" style="display:none">
          <div id="mu-template" style="margin-top:14px;text-align:center;font-size:12px;color:#6b7a90">
            <a href="#" id="mu-tmpl" style="color:#7c3aed;font-weight:600;text-decoration:none">⬇ Download blank template</a>
          </div>
        </div>
        <div class="mu-foot split">
          <button class="mu-action" id="mu-history-btn" type="button">🕘 View history</button>
          <div style="display:flex;gap:10px">
            <button class="mu-action" data-close>Cancel</button>
            <button class="mu-action primary" id="mu-preview-btn" disabled>Compare &amp; Preview →</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(bg);
    return bg;
  }

  /* ---------- Build preview modal ---------- */
  function showPreview(bg, filename, parsed, diff) {
    const body = bg.querySelector('#mu-upload-body');
    const foot = bg.querySelector('.mu-foot');
    const head = bg.querySelector('.mu-head h3');
    head.textContent = '🔍 Preview changes';
    const missErps = (diff.missing_erps || []).slice(0, 50);
    body.innerHTML = `
      <div class="mu-msg ok">
        Parsed <b>${diff.total_rows}</b> rows from <b>${esc(filename)}</b>. Review the changes below — nothing is committed until you confirm.
      </div>
      <div class="mu-statsgrid">
        <div class="mu-statcard add"><div class="n">${diff.added}</div><div class="l">New ERPs</div></div>
        <div class="mu-statcard upd"><div class="n">${diff.updated}</div><div class="l">Updated</div></div>
        <div class="mu-statcard unc"><div class="n">${diff.unchanged}</div><div class="l">Unchanged</div></div>
        <div class="mu-statcard miss"><div class="n">${diff.missing_in_upload}</div><div class="l">⚠ Missing in upload</div></div>
      </div>
      ${diff.missing_in_upload > 0 ? `
        <div class="mu-missbox">
          <b>⚠ ${diff.missing_in_upload} ERP${diff.missing_in_upload === 1 ? '' : 's'} exist in the current master but are NOT in your upload</b>
          These records will <b>remain unchanged</b> in the current master if you confirm. Add them to your upload if you intended to update them.
          <div class="mu-misserps" style="margin-top:8px">${missErps.map(esc).join(', ')}${diff.missing_in_upload > 50 ? '… and ' + (diff.missing_in_upload - 50) + ' more' : ''}</div>
        </div>` : ''}
      <div style="margin-top:14px;font-size:12.5px;color:#6b7a90;line-height:1.55">
        <b style="color:#10203a">What "confirm" does:</b> creates a new master version in the database, marks it as the current live version, and refreshes this dashboard's BLE/Isolator data instantly. The previous version stays in History for rollback.
      </div>`;
    foot.className = 'mu-foot split';
    foot.innerHTML = `
      <button class="mu-action" id="mu-back-btn">← Back</button>
      <div style="display:flex;gap:10px">
        <button class="mu-action" data-close>Cancel</button>
        <button class="mu-action primary" id="mu-confirm-btn">✓ Confirm &amp; activate this version</button>
      </div>`;
    bg.querySelectorAll('[data-close]').forEach(b => b.onclick = () => bg.classList.remove('open'));
    bg.querySelector('#mu-back-btn').onclick = () => { resetUploadModal(bg); };
    bg.querySelector('#mu-confirm-btn').onclick = () => activateUpload(bg, diff.upload_id);
  }

  /* ---------- Reset upload modal to file-choose state ---------- */
  function resetUploadModal(bg) {
    document.body.removeChild(bg);
    openUploadModal();
  }

  /* ---------- Step 1: parse + diff (creates DB row but inactive) ---------- */
  async function previewUpload(bg, file) {
    const btn = bg.querySelector('#mu-preview-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="mu-spinner"></span>Parsing…';
    try {
      const raw = await readXlsx(file);
      const parsed = parseRows(raw);
      btn.innerHTML = '<span class="mu-spinner"></span>Comparing with current…';
      const { data, error } = await window.sb.rpc('master_upload_version', {
        p_filename: file.name,
        p_rows: parsed
      });
      if (error) throw error;
      showPreview(bg, file.name, parsed, data);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Compare & Preview →';
      const body = bg.querySelector('#mu-upload-body');
      const existing = body.querySelector('.mu-msg.err');
      if (existing) existing.remove();
      const m = document.createElement('div');
      m.className = 'mu-msg err';
      m.textContent = err.message || 'Upload failed';
      body.insertBefore(m, body.firstChild);
    }
  }

  /* ---------- Step 2: activate the staged upload ---------- */
  async function activateUpload(bg, uploadId) {
    const btn = bg.querySelector('#mu-confirm-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="mu-spinner"></span>Activating…';
    try {
      const { error } = await window.sb.rpc('activate_master_upload', { p_upload_id: uploadId });
      if (error) throw error;
      toast('Master activated. Refreshing data…', 'ok');
      bg.classList.remove('open');
      setTimeout(async () => {
        document.body.removeChild(bg);
        await loadDBMaster();
        toast('Done. Master is now live across the dashboard.', 'ok');
      }, 400);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '✓ Confirm & activate this version';
      toast(err.message || 'Activation failed', 'err');
    }
  }

  /* ---------- Open upload modal ---------- */
  function openUploadModal() {
    const bg = buildUploadModal();
    const drop = bg.querySelector('#mu-drop');
    const input = bg.querySelector('#mu-file');
    const fname = bg.querySelector('#mu-fname');
    const prevBtn = bg.querySelector('#mu-preview-btn');
    let chosenFile = null;
    function pick(f) {
      if (!f || !/\.(xlsx|xls)$/i.test(f.name)) {
        toast('Please drop an Excel file (.xlsx or .xls)', 'err');
        return;
      }
      chosenFile = f;
      fname.textContent = '✓ ' + f.name;
      prevBtn.disabled = false;
    }
    drop.onclick = () => input.click();
    input.onchange = e => pick(e.target.files[0]);
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragging'); });
    drop.addEventListener('dragleave', e => { if (!drop.contains(e.relatedTarget)) drop.classList.remove('dragging'); });
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('dragging'); pick(e.dataTransfer.files && e.dataTransfer.files[0]); });
    prevBtn.onclick = () => chosenFile && previewUpload(bg, chosenFile);
    bg.querySelector('#mu-history-btn').onclick = () => { bg.classList.remove('open'); document.body.removeChild(bg); openHistoryModal(); };
    bg.querySelector('#mu-tmpl').onclick = e => { e.preventDefault(); downloadTemplate(); };
    bg.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { bg.classList.remove('open'); document.body.removeChild(bg); });
    bg.onclick = e => { if (e.target === bg) { bg.classList.remove('open'); document.body.removeChild(bg); } };
    setTimeout(() => bg.classList.add('open'), 10);
  }

  /* ---------- Download blank template ---------- */
  function downloadTemplate() {
    const aoa = [['ERP Code', 'Station Name', 'State', 'BLE Y/N', 'Isolator Y/N']];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 14 }, { wch: 32 }, { wch: 18 }, { wch: 12 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Master');
    XLSX.writeFile(wb, 'BLE_Master_Template.xlsx');
  }

  /* ---------- History modal ---------- */
  function openHistoryModal() {
    const bg = document.createElement('div');
    bg.className = 'mu-bg';
    bg.innerHTML = `
      <div class="mu-modal wide">
        <div class="mu-head">
          <h3>🕘 Master version history</h3>
          <button class="mu-close" data-close>×</button>
        </div>
        <div class="mu-body" id="mu-hist-body">
          <div style="text-align:center;padding:30px;color:#6b7a90"><span class="mu-spinner" style="border-color:rgba(124,58,237,.25);border-top-color:#7c3aed"></span>Loading versions…</div>
        </div>
        <div class="mu-foot">
          <button class="mu-action" id="mu-back-upload">← Back to upload</button>
          <button class="mu-action" data-close>Close</button>
        </div>
      </div>`;
    document.body.appendChild(bg);
    bg.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { bg.classList.remove('open'); document.body.removeChild(bg); });
    bg.querySelector('#mu-back-upload').onclick = () => { bg.classList.remove('open'); document.body.removeChild(bg); openUploadModal(); };
    bg.onclick = e => { if (e.target === bg) { bg.classList.remove('open'); document.body.removeChild(bg); } };
    setTimeout(() => bg.classList.add('open'), 10);
    loadHistory(bg);
  }
  async function loadHistory(bg) {
    const body = bg.querySelector('#mu-hist-body');
    const { data, error } = await window.sb.rpc('master_list_versions');
    if (error) { body.innerHTML = '<div class="mu-msg err">' + esc(error.message) + '</div>'; return; }
    if (!data || !data.length) {
      body.innerHTML = '<div class="mu-msg info">No master versions yet. The current dashboard is using the embedded fallback.</div>';
      return;
    }
    let html = '<table class="mu-histtbl"><thead><tr><th>Uploaded</th><th>By</th><th>File</th><th>Rows</th><th>Diff</th><th>Status</th><th></th></tr></thead><tbody>';
    data.forEach(v => {
      const s = v.stats || {};
      const diffStr = v.is_current
        ? '—'
        : ('+' + (s.added || 0) + ' / ~' + (s.updated || 0) + ' / =' + (s.unchanged || 0) + (s.missing_in_upload ? ' / ⚠' + s.missing_in_upload : ''));
      html += '<tr' + (v.is_current ? ' class="current"' : '') + '>';
      html += '<td class="mu-mono">' + fmtDate(v.uploaded_at) + '</td>';
      html += '<td>' + esc(v.uploaded_by_name || '—') + '</td>';
      html += '<td>' + esc(v.source_filename || '—') + '</td>';
      html += '<td class="mu-mono" style="text-align:right">' + (v.total_rows || 0) + '</td>';
      html += '<td class="mu-mono" style="font-size:11px">' + diffStr + '</td>';
      html += '<td>' + (v.is_current ? '<span class="mu-pill">● CURRENT</span>' : '') + '</td>';
      html += '<td style="text-align:right">' + (v.is_current ? '' : '<button class="mu-action" style="padding:5px 11px;font-size:11.5px" data-rollback="' + v.id + '">Restore</button>') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    body.innerHTML = html;
    body.querySelectorAll('[data-rollback]').forEach(b => b.onclick = () => rollback(bg, b.dataset.rollback));
  }
  async function rollback(bg, uploadId) {
    if (!confirm('Restore this version as the active master? The current version stays in history.')) return;
    try {
      const { error } = await window.sb.rpc('activate_master_upload', { p_upload_id: uploadId });
      if (error) throw error;
      toast('Restored. Refreshing master…', 'ok');
      setTimeout(async () => {
        bg.classList.remove('open');
        document.body.removeChild(bg);
        await loadDBMaster();
        toast('Done. Master is now live.', 'ok');
      }, 400);
    } catch (err) { toast(err.message || 'Restore failed', 'err'); }
  }

  /* ---------- Inject button + indicator into the header ---------- */
  function injectHeaderControls(canUpload) {
    const userbox = document.getElementById('userbox');
    if (!userbox || document.getElementById('mu-indicator')) return;
    const ind = document.createElement('div');
    ind.id = 'mu-indicator';
    ind.className = 'mu-indicator';
    ind.style.display = 'none';
    userbox.insertBefore(ind, userbox.firstChild);
    if (canUpload) {
      const btn = document.createElement('button');
      btn.id = 'mu-open-btn';
      btn.className = 'mu-btn';
      btn.innerHTML = '📤 Upload Master';
      btn.title = 'Upload a new master data file (Excel)';
      btn.onclick = openUploadModal;
      userbox.insertBefore(btn, ind);
    }
  }

  /* ---------- Main entry point ---------- */
  whenReady(async () => {
    injectStyles();
    /* hybrid load FIRST — even unprivileged users get the latest DB master if present */
    await loadDBMaster();
    /* then check permission for upload button */
    const canUpload = await hasMasterUploadPerm();
    injectHeaderControls(canUpload);
    updateIndicator();
    console.log('[master-upload] Module ready. Upload permission:', canUpload);
  });
})();
