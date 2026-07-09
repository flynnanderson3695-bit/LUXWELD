# LUXWELD Warranty — Backups & Recovery (plain-English guide)

This is the non-technical guide for **Jono** and **Flynn**. It explains where the
data lives, how the automatic backups work, and what to do if the CEO can't log
in. For developer-level setup, see `README.md`.

---

## The three copies of your data

Your warranty records (every serial, all photos, installer details, warranty
dates) are kept in **three independent places**, and after one-time setup, all
three stay current **without anyone doing anything**:

| Copy | Where | How it updates |
|------|-------|----------------|
| 1. Live server | Railway persistent volume (`/data`) | Automatic. Survives deploys. |
| 2. Cloud | Jono's Google Drive | Automatic — instantly after each registration + daily check |
| 3. Physical | The 24/7 backup PC + big external drive | Automatic — Google Drive for desktop mirrors copy 2 down to the drive |

---

## Cloud backup — Jono's Google Drive (searchable!)

Once connected, **every warranty record appears in Jono's Google Drive** inside
a folder called **"LUXWELD Warranty Archive"**. Each flashing gets its own
folder, named with everything you'd ever search for, e.g.:

> `SKY-ABC12345 · Corrugated · produced 2026-05-01 · installed 2026-06-20 · John Smith (Roofco) · Jones Residence — 12 Site St, Somewhere QLD`

Inside: all 8 photos (clearly named) + a `record.txt` with every detail.

**How Jono finds anything:** open Google Drive → type into the search bar at
the top — a serial number, an installer's name, a site, or a date. The folder
appears; open it and everything linked to that flashing is right there. That's
it. Google even searches *inside* the record files, so any detail works.

**How it stays current:** the site pushes each new registration to Drive within
seconds, and runs a daily full check. The Archive page in the admin shows the
last check time (green box) — plus a **Back up now** button if you ever want to
force one.

**One-time setup:**
1. *(Flynn, ~15 min)* Create the Google OAuth client + set the two keys in
   Railway — click-by-click steps in `README.md` → "Google Drive backup".
   Consent screen must be **Published/In production**, scope `drive.file`,
   redirect URI `https://warranty.luxweld.com.au/admin/drive/callback`.
2. *(Jono, ~1 min)* Log in → **Archive** → **Connect Google Drive** → sign in
   and approve. The first full upload starts by itself.

**Storage note:** Drive's free 15 GB covers roughly the first 400–600 records.
After that, a Google One plan (2 TB ≈ AU$12.50/mo) covers years of photos.

---

## Physical backup — the 24/7 PC + big external drive

The physical copy rides on the cloud copy: Google's own **Drive for desktop**
app runs on the always-on PC and continuously mirrors the "LUXWELD Warranty
Archive" folder onto the external drive. Nothing to remember, nothing custom to
maintain — if the PC is on, the drive is current.

**One-time setup on the backup PC (~10 min):**
1. Plug in the external drive.
2. Install **Google Drive for desktop** (google.com/drive/download).
3. Sign in with **Jono's Google account** (the same one connected on the site).
4. In the Drive app: **Settings (gear) → Preferences → Google Drive** →
   choose **Mirror files** — this keeps a full local copy, not just shortcuts.
5. When it asks (or via **Advanced settings**), set the **local folder
   location** to the external drive (e.g. `E:\LUXWELD Backup`).
   *This is also how you change the destination later — two clicks, same menu.*
6. Wait for the first sync to finish. Open the folder on the drive and check
   the record folders and photos are really there.

**Leave the PC on** (turn off sleep in Windows power settings). If it's ever
off for a while, no harm — it catches up the moment it's back on.

**Extra manual option (before the PC is set up, or any time you want a
snapshot):** Admin → **Archive** → gold **Physical backup** box → **⬇ Download
everything (.zip)** → copy to any drive. Unzip it and open `index.html` to
browse the whole archive offline, no internet or login needed.

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

## Monthly 2-minute health check (nothing to *do* — just look)

- [ ] Admin → **Archive**: the Google Drive box is green with a recent
      "last full check" time.
- [ ] On the backup PC: Drive for desktop icon shows synced (no errors), and
      the external drive's LUXWELD folder has recent record folders in it.
- [ ] Once in a while: open a random record folder on the external drive and
      check the photos open — proves the backup is real, not just a file.
