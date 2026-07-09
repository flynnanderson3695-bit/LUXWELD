# LUXWELD Warranty — Backups & Recovery (plain-English guide)

This is the non-technical guide for **Jono** and **Flynn**. It explains where the
data lives, how to keep physical + cloud backups, and what to do if the CEO
can't log in. For the developer-level setup, see `README.md`.

---

## The three copies of your data

Your warranty records (every serial, all photos, installer details, warranty
dates) are kept in **three independent places** so no single failure loses them:

| Copy | Where | Kept safe by |
|------|-------|--------------|
| 1. Live server | Railway persistent volume (`/data`) | Automatic. Survives deploys. |
| 2. **Physical** | An external hard drive you own | **You** — the routine below |
| 3. **Cloud** | Jono's Google Drive | Automatic daily, once connected |

You only ever need to *do* something for copies **2** (physical) and **3**
(the one-time Google Drive connection). Copy 1 looks after itself.

---

## Physical backup — copy everything to a hard drive (5 minutes)

**How often:** once a month is plenty; do it more often in busy periods.

1. Log in at **warranty.luxweld.com.au** as the admin (Jono).
2. Go to **Archive** (top menu).
3. In the gold **"Physical backup"** box at the top, click
   **⬇ Download everything (.zip)**. Save the file.
4. Plug in your external hard drive.
5. Copy the downloaded `.zip` onto the drive. Name it with the date, e.g.
   `luxweld-archive-2026-07.zip`. **Keep the last few months** — don't overwrite
   the previous one.
6. Safely eject the drive and store it somewhere safe (ideally off-site).

**To open a backup later** (even with no internet): copy the `.zip` off the
drive, unzip it, and double-click **`index.html`**. The whole archive —
records, photos, warranties — opens in any web browser. No login, no server.

> Tip: keep **two** hard drives and alternate them, so one is always off-site.

---

## Cloud backup — Google Drive (automatic once connected)

Once set up, the full archive uploads to **Jono's Google Drive** every day into a
folder called **"LUXWELD Warranty Archive"**. Nothing to remember day-to-day.

**One-time setup (Flynn — ~15 min):**
1. Create/enable a Google Cloud OAuth client and turn on the Drive API. Full
   click-by-click steps are in `README.md` → **"Google Drive backup"**. Key
   points that trip people up:
   - OAuth consent screen must be **Published / In production** (not "Testing"),
     otherwise the connection expires after 7 days.
   - Add the scope **`.../auth/drive.file`**.
   - Add the redirect URI exactly:
     `https://warranty.luxweld.com.au/admin/drive/callback`
2. In **Railway → Variables**, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
   (and confirm `BASE_URL=https://warranty.luxweld.com.au`). Save; it redeploys.

**Connect it (Jono, once):**
3. Log in → **Archive**. The Google Drive box now shows **"Connect Google Drive"**.
4. Click it, sign in as Jono, approve access.
5. Click **Back up now**. Within a few seconds the box should say
   *"backed up luxweld-archive-YYYY-MM-DD.zip"* and the file appears in his Drive.

After that it runs **automatically every day**. To check it's healthy, open the
Archive page any time — the green box shows the **last backup** time.

---

## 🔑 Emergency: "I can't log in" (admin recovery)

The admin account (Jono, `jono@luxweld.com.au`) can be reset by Flynn without
touching the database. This is the built-in escape hatch.

**Flynn:**
1. Railway → your service → **Variables**.
2. Confirm `ADMIN_EMAIL` = `jono@luxweld.com.au`.
3. Set `ADMIN_PASSWORD` to a **temporary** strong password.
4. Add `RESET_ADMIN_PASSWORD` = `1`. Save (Railway redeploys, ~1–2 min).
   - In **Deploy Logs** you'll see:
     `RESET_ADMIN_PASSWORD: reset password + admin role for jono@luxweld.com.au`
5. Tell Jono the temporary password.

**Jono:**
6. Log in with `jono@luxweld.com.au` + the temporary password.
7. Go to **Users**, and set your own new private password on your account.

**Flynn (important — close the hatch):**
8. Back in Railway → Variables, **delete `RESET_ADMIN_PASSWORD`** so it can't
   run again. (Leaving it set would re-reset the password on the next deploy.)

> Why this exists: the app only seeds the admin password when the database is
> brand-new. After that, simply changing `ADMIN_PASSWORD` does nothing — so this
> flag is the supported way to force a reset.

---

## Monthly 5-minute checklist

- [ ] Archive → **Download everything** → copy `.zip` to the external drive (dated).
- [ ] Confirm the Google Drive box shows a recent **last backup** time (green).
- [ ] Occasionally: unzip a physical backup and open `index.html` to confirm it
      opens and photos show — proves the backup is real, not just a file.
- [ ] Keep at least the last 3 monthly copies on the drive.
