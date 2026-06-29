/* ============================================================
 * Admin Master-Upload Permission Toggle — drop-in for admin.html
 * Add with: <script src="./admin-master-perm.js"></script>
 * Place AFTER the existing inline <script> block in admin.html
 * (i.e. at the very end of <body>, before </body>).
 *
 * What it does:
 *   - Watches for the user-edit modal to open
 *   - Injects a "Master Upload Access" toggle row alongside the existing
 *     "QR Management System" toggle in the .permsbox section
 *   - Hooks into the existing Save flow: when admin clicks Save Changes,
 *     it also persists the master_upload permission via admin_set_permission RPC
 *   - Adds a Modules column chip "MASTER" for users with the permission
 *
 * Developed by Sunny Gupta
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- Script-scope resolvers (admin.html declares these as const) ---------- */
  function getSb()            { try { return sb; } catch (e) { return undefined; } }
  function getS()             { try { return S;  } catch (e) { return undefined; } }
  function getEditingUserId() { try { return editingUserId; } catch (e) { return undefined; } }
  function getLoadUsers()     { try { return loadUsers; } catch (e) { return undefined; } }
  function getRenderStats()   { try { return renderStats; } catch (e) { return undefined; } }
  function getRender()        { try { return render; } catch (e) { return undefined; } }

  function whenReady(cb) {
    if (getSb() && document.getElementById('edit-modal')) cb();
    else setTimeout(() => whenReady(cb), 250);
  }

  /* ---------- Add the MASTER chip in the user table ---------- */
  function patchUserTableRendering() {
    /* The admin page rebuilds the user table on every render. We patch by
       observing #tblhost mutations and adding the MASTER chip into the
       Modules column for users with the permission. */
    const host = document.getElementById('tblhost');
    if (!host) return;
    const mo = new MutationObserver(() => {
      try {
        const S_ref = getS();
        if (!S_ref || !S_ref.users) return;
        host.querySelectorAll('[data-edit]').forEach(btn => {
          const uid = btn.dataset.edit;
          const u = S_ref.users.find(x => x.id === uid);
          if (!u) return;
          const isAdmin = u.role === 'admin';
          const hasMaster = isAdmin || (u.permissions && u.permissions.master_upload === true);
          if (!hasMaster) return;
          /* Find the modules cell — it's the 4th <td> in this row */
          const tr = btn.closest('tr');
          if (!tr || tr.dataset.muPatched === '1') return;
          const tds = tr.querySelectorAll('td');
          if (tds.length < 4) return;
          const modCell = tds[3];
          /* Only add if not already there */
          if (modCell.innerHTML.indexOf('MASTER') === -1) {
            const chip = document.createElement('span');
            chip.className = 'chip';
            chip.style.cssText = 'background:rgba(124,58,237,.10);color:#7c3aed;margin-left:4px';
            chip.title = 'Master Upload Access';
            chip.textContent = 'MASTER';
            modCell.appendChild(document.createTextNode(' '));
            modCell.appendChild(chip);
          }
          tr.dataset.muPatched = '1';
        });
      } catch (e) { /* silent */ }
    });
    mo.observe(host, { childList: true, subtree: true });
  }

  /* ---------- Inject the toggle row into the edit modal ---------- */
  function injectToggleRow() {
    const modal = document.getElementById('edit-modal');
    if (!modal) return;
    /* Find the permissions box */
    const permsbox = modal.querySelector('.permsbox');
    if (!permsbox || permsbox.querySelector('#perm-master')) return;
    const row = document.createElement('div');
    row.className = 'permrow';
    row.innerHTML = `
      <div>
        <div class="pname">📤 Master Upload Access</div>
        <div class="pdesc">Upload &amp; manage station master data (BLE Report page)</div>
      </div>
      <label class="switch"><input type="checkbox" id="perm-master"><span class="slider"></span></label>`;
    permsbox.appendChild(row);
  }

  /* ---------- When the edit modal opens, sync the toggle from S.users ---------- */
  function watchEditModal() {
    const modal = document.getElementById('edit-modal');
    if (!modal) return;
    const mo = new MutationObserver(() => {
      if (!modal.classList.contains('open')) return;
      injectToggleRow();
      const cb = document.getElementById('perm-master');
      if (!cb) return;
      /* Read the current editingUserId from window scope */
      const uid = getEditingUserId();
      const S_ref = getS();
      if (!uid || !S_ref || !S_ref.users) return;
      const u = S_ref.users.find(x => x.id === uid);
      if (!u) return;
      const isAdmin = u.role === 'admin';
      cb.checked = isAdmin || (u.permissions && u.permissions.master_upload === true);
      cb.disabled = isAdmin;
      cb.dataset.adminLocked = isAdmin ? '1' : '0';
    });
    mo.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---------- Hook into the Save Changes button ---------- */
  function patchSaveButton() {
    const save = document.getElementById('edit-save');
    if (!save || save.dataset.muPatched === '1') return;
    save.dataset.muPatched = '1';
    /* Wrap the original onclick: save it, then add our extra step that
       runs AFTER the original logic (which is async and re-loads users). */
    const original = save.onclick;
    save.onclick = async function (ev) {
      /* Before original runs: stash our intended value */
      const cb = document.getElementById('perm-master');
      const intendedValue = cb ? cb.checked : null;
      const adminLocked = cb ? cb.dataset.adminLocked === '1' : false;
      const uid = getEditingUserId();
      /* Run original (it sets profile + QR perm + maybe password, then re-loads) */
      if (typeof original === 'function') { await original.call(this, ev); }
      /* Then write master_upload separately (skip for admins) */
      if (!adminLocked && uid && cb && intendedValue !== null) {
        try {
          const { error } = await getSb().rpc('admin_set_permission', {
            p_user_id: uid,
            p_key: 'master_upload',
            p_value: intendedValue
          });
          if (error) console.warn('[admin-master-perm] save error:', error.message);
          else {
            const lu = getLoadUsers();
            if (typeof lu === 'function') {
              await lu();
              const rs = getRenderStats(); if (typeof rs === 'function') rs();
              const r  = getRender();      if (typeof r === 'function') r();
            }
          }
        } catch (e) { console.warn('[admin-master-perm] save exception:', e); }
      }
    };
  }

  whenReady(() => {
    /* Inject CSS for the chip (purple) if not present */
    if (!document.getElementById('mu-admin-styles')) {
      const s = document.createElement('style');
      s.id = 'mu-admin-styles';
      s.textContent = `.chip[title="Master Upload Access"]{background:rgba(124,58,237,.10);color:#7c3aed}`;
      document.head.appendChild(s);
    }
    patchUserTableRendering();
    watchEditModal();
    /* The save button exists immediately, but its onclick is set inline.
       Wait one tick so we wrap the page's handler. */
    setTimeout(patchSaveButton, 500);
    console.log('[admin-master-perm] Module ready.');
  });
})();
