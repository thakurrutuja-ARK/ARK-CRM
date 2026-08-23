# ARK Internal CRM — Setup Guide

A simple internal tool for ARK People Solutions: one place to keep every
client and the documents (PPT, PDF, JPEG, PNG, Word) that belong to them.
Only people you invite can sign in — there's no public sign-up.

This guide gets you from this folder to a live, password-protected app
your team can use. It uses two free services:

- **Supabase** — hosts the database, file storage, and login system.
- **Vercel or Netlify** — hosts the actual website your team visits.
  Either works well with this app; pick whichever you're more
  comfortable with. Steps for both are in section 6.

Both have generous free tiers that comfortably cover a team under 10
people. Total time: about 20–30 minutes, no coding required.

---

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up / log in.
2. Click **New project**. Pick any name (e.g. `ark-crm`), set a database
   password (save it somewhere safe), choose a region close to the UAE
   (e.g. a Europe or Middle East region), and click **Create project**.
3. Wait ~2 minutes for it to finish provisioning.

## 2. Set up the database and file storage

1. In your new project, open the **SQL Editor** (left sidebar).
2. Click **New query**.
3. Open the file `supabase/schema.sql` from this project folder, copy
   its entire contents, and paste it into the SQL editor.
4. Click **Run**. You should see "Success. No rows returned."

This creates:
- a `clients` table
- a `documents` table (stores file metadata; the files themselves live
  in Storage)
- a private storage bucket called `client-documents`
- security rules so only signed-in team members can see or change
  anything (there is no public access)

## 3. Get your API keys

1. In Supabase, go to **Project Settings → API**.
2. Copy the **Project URL** and the **anon / public** key.
3. In this project folder, copy `.env.local.example` to a new file
   named `.env.local`, and paste the two values in:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
   ```

## 4. Create accounts for your team

There's no public sign-up page on purpose — you control who gets in.
The easiest way is the **Team page inside the app** (see step 4b below),
which emails people an invite directly. That needs one extra key, so
here's the fallback that always works if you'd rather not set that up:

1. In Supabase, go to **Authentication → Users**.
2. Click **Add user → Create new user**.
3. Enter each teammate's email address and a temporary password (or use
   "Send invite email" if you've set up email sending — otherwise just
   share the temporary password with them directly and ask them to change
   it later from Supabase if needed).
4. Repeat for everyone on the team (up to 10 covered by the free tier
   comfortably; more is fine too, it just affects Supabase's pricing
   tier eventually).

## 4b. Invite teammates from the app instead (optional but recommended)

Once this is set up, anyone signed in can go to **Team** in the app's
top nav and click **Invite teammate** — they enter an email, Supabase
sends that person a real invite email, and they set their own password
on first login. No more manually creating accounts in Supabase.

1. In Supabase, go to **Project Settings → API**.
2. Under **Project API keys**, copy the **`service_role`** secret key
   (it's hidden by default — click to reveal it). This key bypasses all
   security rules, so treat it like a password: never share it, never
   commit it, never put it in a `NEXT_PUBLIC_...` variable.
3. Add it to your `.env.local` as `SUPABASE_SERVICE_ROLE_KEY=...` (see
   `.env.local.example`).
4. When you deploy (step 6), add the same `SUPABASE_SERVICE_ROLE_KEY`
   to your host's environment variables too — as a regular (server-only)
   variable, exactly like the other two, just make sure your host marks
   secret values appropriately if it offers that option.

That's it — invite emails work out of the box using Supabase's built-in
email sending (fine for a small team; if you outgrow its default sending
limits, Supabase's docs cover connecting your own SMTP provider).

## 5. Try it locally (optional but recommended)

```bash
npm install
npm run dev
```

Open http://localhost:3000, sign in with one of the accounts you just
created, add a test client, and try uploading a file.

## 6. Deploy so your team can access it from anywhere

First, push this project to GitHub (needed for either host below):

```bash
# from inside this project folder
# create a new empty repo on GitHub first, then:
git remote add origin https://github.com/YOUR-ORG/ark-crm.git
git branch -M main
git push -u origin main
```

Then pick **one** of the two hosts:

### Option A — Vercel (made by the Next.js team)

1. Go to [vercel.com](https://vercel.com), sign up / log in (GitHub
   login is easiest), click **Add New → Project**, and import the
   repository you just pushed.
2. When prompted for environment variables, add the same values
   from your `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (only if you set up step 4b)
3. Click **Deploy**. In about a minute you'll get a live URL like
   `ark-crm.vercel.app`.
4. Custom domain (optional): **Settings → Domains** in your Vercel
   project (e.g. `crm.arkpeoplesolutions.com`).

### Option B — Netlify

1. Go to [netlify.com](https://netlify.com), sign up / log in (GitHub
   login is easiest), click **Add new site → Import an existing
   project**, and pick the repository you just pushed.
2. Netlify auto-detects Next.js and configures the build for you — you
   don't need to change any build settings.
3. Before the first deploy (or right after, then redeploy), go to
   **Site configuration → Environment variables** and add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (only if you set up step 4b)
4. Click **Deploy**. You'll get a live URL like
   `ark-crm.netlify.app`.
5. Custom domain (optional): **Domain management** in your Netlify
   site settings.

Either way, once it's deployed: share the URL with your team. They
sign in with the accounts you created in step 4 above.

---

## Day-to-day admin

- **Add a teammate:** the **Team** page in the app → Invite teammate
  (if you set up step 4b), or Supabase → Authentication → Users → Add
  user otherwise.
- **Remove a teammate:** the **Team** page in the app (hover their row
  → the ✕), or Supabase → Authentication → Users → delete their
  account. Either way, their access is revoked immediately.
- **Reset someone's password:** Supabase → Authentication → Users →
  select the user → Reset password.
- **Back up your data:** Supabase → Database → Backups (automatic daily
  backups are included even on the free tier, retained for 7 days).

## What's included today

- Secure login (no public sign-up)
- Invite teammates by email from the Team page (step 4b) — or manage
  accounts directly in Supabase if you skip that setup
- Add / search / delete clients
- Per-client document library: drag-and-drop upload, download, delete
- Supports PDF, PPT/PPTX, DOC/DOCX, JPEG, PNG (up to 50MB per file)

## Natural next steps (not built yet — ask if you want these added)

- Deal/pipeline stages per client (Lead → Proposal → Active → Closed)
- Notes, tasks, and follow-up reminders per client
- Role-based permissions (e.g. admin vs. staff)
- Activity log (who uploaded/deleted what, and when)
- Full-text search inside documents
