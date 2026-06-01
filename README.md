# BLE Transaction Tracker

A team workspace for mapping BLE-enabled fuel-station transactions.
Built with vanilla JS + Supabase. Hostable on GitHub Pages.

**Developed by Sunny Gupta**

---

## What's in this repo

| File | What it does |
|------|--------------|
| `login.html` | Sign-in page (and forgot-password flow) |
| `index.html` | Main dashboard (auth-gated) |
| `admin.html` | Admin panel (coming in Step C) |
| `config.example.js` | Template — copy to `config.js` and fill in |
| `config.js` | Your real Supabase URL + anon key (do NOT commit) |
| `supabase_setup.sql` | Database schema, RLS policies, retention job |
| `.gitignore` | Keeps `config.js` out of git |

---

## First-time setup

### 1. Create the Supabase project

1. Go to https://supabase.com → New project (region: Mumbai)
2. Wait ~2 minutes for provisioning
3. Project Settings → API → copy:
   - **Project URL**
   - **anon public key**

### 2. Create the database schema

1. SQL Editor → New query
2. Paste the contents of `supabase_setup.sql` and click **Run**
3. You should see `Success. No rows returned.`

### 3. Create your admin account

1. Authentication → Users → Add user → Create new user
2. Use your email, set a strong password, tick **Auto Confirm User**
3. SQL Editor → run:
   ```sql
   select public.promote_to_admin('your-email@example.com');
   ```

### 4. Disable public signup

Authentication → Providers → Email →
- Turn **OFF** "Enable Email Signup" (only admin creates users)
- Turn **OFF** "Confirm email" (admin-created users log in immediately)
- **Save**

### 5. Configure the front-end

```bash
cp config.example.js config.js
# edit config.js and paste your URL + anon key
```

### 6. Run locally

Open `login.html` in a browser (or run a tiny local server):
```bash
python3 -m http.server 8000
# then open http://localhost:8000/login.html
```

Sign in with the admin credentials you created in step 3.

---

## Deploying to GitHub Pages

1. Create a new GitHub repo (private is fine)
2. Push all files **except `config.js`** (it's in `.gitignore`)
3. Repo → Settings → Pages → Source: `main` branch, root folder → Save
4. After a minute, your site is live at
   `https://<username>.github.io/<repo>/login.html`

**Important:** GitHub Pages serves static files only. The `config.js` file
must be present on the deployment for the app to work. Two ways to handle it:
- (Easy) Commit `config.js` to a **private** repo. Anon key is meant to be
  public — RLS protects the data.
- (Safer) Build `config.js` from GitHub Actions secrets on deploy.

For a 7-person team in a private repo, committing `config.js` is acceptable.

---

## Build progress

- [x] **Step A** — Supabase setup, login, auth-gated dashboard
- [ ] **Step B** — Activity timer + idle detection
- [ ] **Step C** — Admin panel (create/delete users, view activity)
- [ ] **Step D** — Refresh persistence + midnight reset
- [ ] **Step E** — WhatsApp screenshot share

---

Developed by **Sunny Gupta**
