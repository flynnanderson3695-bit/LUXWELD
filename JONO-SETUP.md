# LUXWELD — Jono's setup checklist

A short, one-sitting list. Flynn has done all the technical parts already; these
are the few steps that need **you** (your Google account / your decision). Do
them top to bottom. Each step says what to click and how you'll know it worked.

Everything here is a one-time setup. After this, backups run on their own.

**Order matters:** do Step 1 before Step 2.

---

## ✅ Step 1 — Create the Google connection  (~15 minutes, one time)

This is the only technical bit. It sets up the secure link that lets the website
save into your Google Drive.

👉 **Follow the separate guide: `GOOGLE-DRIVE-SETUP.md`.** It's click-by-click.
At the end you'll copy **two codes** and send them to **Flynn** — he plugs them
in safely, so you never touch the website's settings.

*(This is the fiddliest step. If a screen looks different or you're unsure,
screenshot it and send it to Flynn — you can't break anything.)*

**You know it's done when:** Flynn confirms he's added your two codes, and the
**Google Drive** box on the Archive page changes from "Not set up" to a
**Connect Google Drive** button.

---

## ✅ Step 2 — Turn on the automatic backup  (~2 minutes)

This makes a copy of every warranty record (all photos + details) land in **your
Google Drive**, automatically, forever.

1. Go to **warranty.luxweld.com.au** and log in.
   - Email: `jono@luxweld.com.au`
   - Password: the one you set (if unsure, ask Flynn to reset it for you).
2. Click **Archive** in the top menu.
3. Find the **Google Drive backup** box near the top. Click **Connect Google Drive**.
4. A Google sign-in page opens. Sign in with **your** Google account and click
   **Allow / Continue**.
5. You'll come back to the Archive page and it will say the first backup is
   uploading.

**How you know it worked:** open Google Drive (drive.google.com), and within a
few minutes you'll see a folder called **"LUXWELD Warranty Archive"** filling up
with a folder for each flashing.

> From now on: every new registration copies to your Drive within seconds, and
> the whole archive is re-checked daily. You never have to press anything again.

**How to find a record later:** in Google Drive, just type into the search bar at
the top — a serial number (e.g. `SKY-…`), an installer's name, a site, or a date.
The matching folder appears with all its photos and details inside.

---

## ✅ Step 3 — Upgrade Railway so the site can't switch off  (do this WITH Flynn)

The website currently runs on a free trial that can shut it off. Upgrading keeps
it on 24/7. Flynn will sit with you for this — it's a 2-minute payment step.

- Flynn opens the Railway billing page → choose a paid plan → enter payment.
- **You know it worked when:** the plan no longer says "Trial", and Railway stops
  sending "shut down" emails.

*(This is the only step that can't be done ahead of time — it needs your card /
your call on the plan.)*

---

## ✅ Step 4 — Set up the always-on backup computer + big hard drive  (~10 minutes)

This is your **physical** backup: a computer left on that copies everything from
your Google Drive down onto the big external drive, automatically.

On the computer you'll leave running (with the 10 TB drive plugged in):

1. Plug in the external hard drive.
2. Go to **google.com/drive/download** and install **Google Drive for desktop**.
3. Open it and **sign in with the same Google account** your backups go to.
4. Click the **gear (Settings) → Preferences → Google Drive**, and choose
   **Mirror files** (this keeps a real full copy on the drive, not just links).
5. When asked where to keep the files (or under **Advanced settings**), pick the
   **external hard drive** (for example `E:\LUXWELD Backup`).
   - *This same menu is where you'd change the destination drive later.*
6. Leave it to finish the first copy. Then open the drive and check the
   **"LUXWELD Warranty Archive"** folder is really there with photos inside.

**Keep this computer switched on** (turn off "sleep" in the power settings). If
it's ever off for a while it's fine — it catches up as soon as it's back on.

---

## ✅ Step 5 (optional) — A stronger password

Your admin login opens everything, so a longer password is much safer than a
short number. If you'd like to change it:

1. Log in → **Users** (top menu).
2. On your own account, set a new password (something like a short phrase plus a
   number and symbol is ideal).

---

### That's it
Once Steps 1, 2 and 4 are done, your warranty data lives in **three** places at once —
the live site, your Google Drive, and your physical hard drive — all kept up to
date automatically. Full details for Flynn are in `BACKUP-AND-RECOVERY.md`.
