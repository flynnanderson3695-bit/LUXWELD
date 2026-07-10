# Google connection — one-time setup (for Jono)

This is the **one technical step** in the whole setup. It creates the secure
"handshake" that lets warranty.luxweld.com.au put backups into your Google
Drive. You do it **once**, ever.

- **Time:** about 15 minutes.
- **You'll need:** the Google account you want the backups to live in
  (use the main LUXWELD one).
- **At the very end** you'll copy **two codes** and send them to **Flynn** — he
  plugs them in safely (so you never have to touch the website's settings).
- **If any screen looks different from what's written here** (Google changes
  their layout sometimes): don't guess — take a screenshot and send it to Flynn.

Work top to bottom. Don't skip the **"Publish"** part (Part C, step 5) — if you
skip it, the backup stops working after 7 days.

---

## Part A — Create a project

1. Go to **console.cloud.google.com** and sign in with the LUXWELD Google account.
2. If it asks about terms of service, tick agree and continue.
3. At the very top of the page, click the **project dropdown** (it may say
   "Select a project"). A window opens → click **New Project** (top right).
4. **Name:** type `LUXWELD Warranty`. Leave everything else as-is. Click **Create**.
5. Wait a few seconds, then make sure the top dropdown now shows
   **LUXWELD Warranty** (select it if not).

---

## Part B — Turn on Google Drive

1. In the search bar at the very top, type **Google Drive API** and press Enter.
2. Click the result **Google Drive API**.
3. Click the blue **Enable** button. Wait for it to finish.

---

## Part C — Set up + publish the consent screen

*(This is the part people miss — follow all 5 steps.)*

1. In the top search bar, type **OAuth consent screen** and open it.
   (On newer layouts this lives under **"Google Auth Platform"** → **Branding** /
   **Audience** — same thing.)
2. If asked **"User Type"**, choose **External**, then **Create**.
3. Fill only what's required (marked with a red star):
   - **App name:** `LUXWELD Warranty`
   - **User support email:** pick your email from the dropdown.
   - **Developer contact information:** type your email again.
   - Click **Save and Continue** through the next pages (Scopes, Test users) —
     you don't need to add anything there. If you land back on a summary, good.
4. Now find the **Audience** (or **Publishing status**) page — top search
   "Audience", or it's a left-menu item.
5. Under **Publishing status** it probably says **Testing**. Click
   **Publish app** → **Confirm**. It should now say **In production**.
   ✅ This is the important one.

---

## Part D — Create the connection (OAuth client)

1. In the top search bar, type **Credentials** and open it
   (**APIs & Services → Credentials**).
2. Click **+ Create Credentials** (near the top) → **OAuth client ID**.
3. **Application type:** choose **Web application**.
4. **Name:** `LUXWELD Warranty website` (any name is fine).
5. Scroll to **Authorised redirect URIs** → click **+ Add URI** and paste this
   **exactly** (copy it — no spaces, no typos):

   ```
   https://warranty.luxweld.com.au/admin/drive/callback
   ```

   Click **+ Add URI** once more and paste this second one too (for future
   Google login):

   ```
   https://warranty.luxweld.com.au/auth/google/callback
   ```
6. Click **Create**.

---

## Part E — Copy the two codes and send to Flynn

A window pops up titled **"OAuth client created"** showing:

- **Client ID** — a long code ending in `.apps.googleusercontent.com`
- **Client secret** — a shorter code starting with something like `GOCSPX-`

1. Copy **both** (there are copy buttons). If the window closed, reopen it from
   **Credentials** → click your client name → the codes are on the right, and you
   can **download** them as a file.
2. **Send both codes to Flynn** (message/email). Treat them like passwords —
   don't post them publicly.

That's your part done. ✅ Flynn will plug the two codes into the website's
settings, and then you just do **Step 2** in `JONO-SETUP.md` (click **Connect
Google Drive**) — one click and your automatic backups are live.

---

### If you get stuck
Screenshot whatever's on screen and send it to Flynn. Nothing here can break the
website — the worst case is you pause and pick it back up. The two codes are the
only thing that matters at the end.
