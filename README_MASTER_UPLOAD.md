# BLE Master Upload — Install Guide

Adds an admin-controlled Excel upload flow to the BLE Report Dashboard for keeping the station master (BLE / Isolator status) up to date.

---

## What's in this drop

| File | Where it goes | Purpose |
|------|---------------|---------|
| `master_setup.sql` | Run in Supabase SQL Editor | Creates `master_uploads` + `station_data` tables, RPCs, RLS policies |
| `master-upload.js` | New file in your GitHub repo root (same folder as `ble-report.html`) | Self-injecting upload module for the BLE page |
| `admin-master-perm.js` | New file in your GitHub repo root (same folder as `admin.html`) | Self-injecting permission toggle for Admin → Edit User |

Two existing files need **one tiny line added** each — see steps 3 and 4 below.

---

## Step 1 — Run the SQL (one time)

1. Open https://supabase.com/dashboard/project/sdjijffksnlitwagzlnk/sql/new
2. Paste the entire contents of `master_setup.sql`
3. Click **Run**
4. You should see `Success. No rows returned.`

This creates two new tables and 5 RPCs. **Does NOT touch existing data.**

---

## Step 2 — Upload both JS files to GitHub

1. Open https://github.com/gogassunny-lang/ble-tracker
2. Click **Add file → Upload files**
3. Drag both `master-upload.js` and `admin-master-perm.js` onto the page
4. Scroll down → commit message: `Add master upload module` → **Commit changes**

---

## Step 3 — One line in `ble-report.html`

1. In the GitHub repo, click `ble-report.html`
2. Click the pencil ✏️ (Edit this file)
3. Find this line (it's right after the supabase-js CDN, near the top of `<head>`):

   ```html
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   ```

4. **Right before `</body>`** at the bottom of the file, add this single line:

   ```html
   <script src="./master-upload.js"></script>
   ```

5. Scroll down → commit message: `Hook up master upload` → **Commit changes**

That's it. The module auto-injects the button (only for users with permission), queries the DB for the current master on every page load, and falls back to the embedded master if the DB is empty.

---

## Step 4 — One line in `admin.html`

1. In the GitHub repo, click `admin.html`
2. Click the pencil ✏️
3. **Right before `</body>`** at the bottom, add:

   ```html
   <script src="./admin-master-perm.js"></script>
   ```

4. Commit: `Add master upload permission toggle` → **Commit changes**

---

## Step 5 — Grant yourself permission, then test

1. Wait 30 seconds for GitHub Pages to redeploy
2. Hard refresh: **Ctrl+F5** on https://gogassunny-lang.github.io/ble-tracker/admin.html
3. You're already an admin → the upload button should already appear on the BLE dashboard for you (admins auto-have all permissions)
4. Open `admin.html` → click **Edit** on any non-admin user → toggle **📤 Master Upload Access** → Save

For your own admin account, you don't need to grant anything — admins bypass all permission checks.

---

## How the flow works

### When any user opens the BLE dashboard:
1. Embedded master loads instantly (no change to existing behavior)
2. Module queries `master_get_current()` in the background
3. If the DB has rows → swaps `window.MASTER`, re-renders if reports already generated, shows a pill: `Master: v312 · 29 Jun`
4. If DB empty → keeps embedded, shows pill: `Master: embedded`

### When you click "📤 Upload Master":
1. Modal opens with dropzone + "Download blank template" link
2. Drop your Excel → click **Compare & Preview**
3. System parses and creates a *staged* row in `master_uploads` (NOT yet current)
4. You see the diff: **New ERPs, Updated, Unchanged, ⚠ Missing in upload** with the actual ERP codes listed
5. Click **Confirm & activate this version** → flips the `is_current` flag → dashboard refreshes
6. Or click **Back** → cancels (the staged version stays in History, never marked current — you can delete it later from History if you want)

### Smart merge — what "missing in upload" means
You don't need to re-upload every station every time. If your Excel only contains 50 stations and the current master has 312, the other 262 are flagged as **⚠ Missing in upload** and their existing values are **carried forward unchanged** into the new version. This means:
- Every version is a **complete snapshot** (so rollback always restores a full, consistent master)
- You can do small partial updates without losing anything
- The warning is a sanity check — admin can confirm "yes I meant to only update these 50" or **Back** out and add the rest

### Excel template:
| ERP Code | Station Name | State | BLE Y/N | Isolator Y/N |
|----------|--------------|-------|---------|--------------|
| AY045    | Gadag        | Karnataka | Y   | N |

Accepts `Y/N`, `Yes/No`, `TRUE/FALSE`, `1/0` in the Y/N columns. ERP codes are auto-uppercased.

### History & rollback:
- Every upload is preserved as an immutable snapshot
- Click **🕘 View history** in the upload modal → see every version with diff stats
- Click **Restore** on any past version → makes it live again (one click)

---

## Troubleshooting

**The upload button doesn't appear for me on the BLE page**
- Did you hard-refresh after the GitHub commit? Try Ctrl+F5
- Open browser console → look for `[master-upload] Module ready. Upload permission: true`
- If you see `false`, the SQL might not have run completely. Check that `has_permission('master_upload')` returns `true` for your user in Supabase SQL Editor:
  ```sql
  select public.has_permission('master_upload');
  ```

**Upload fails with "Missing X column"**
- Make sure the header row contains the words `ERP`, `Station` (or `Name`), `State`, `BLE`, `Iso` — any order, any extra spaces are fine
- Use the **Download blank template** link to get the exact format

**I uploaded but the dashboard still shows old BLE/Iso values**
- The module re-renders automatically after activation. If it didn't, refresh the page once
- Check the pill in the header — it should say `Master: vNNN · DD Mon`

---

## Files in this drop

```
master_setup.sql            ← run in Supabase
master-upload.js            ← upload to repo, then add 1 line to ble-report.html
admin-master-perm.js        ← upload to repo, then add 1 line to admin.html
README_MASTER_UPLOAD.md     ← this file
```
