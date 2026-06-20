# LUXWELD Warranty — Android & iOS app wrappers

The website is the source of truth. The apps are **thin wrappers** that load the
deployed HTTPS site, so they show the same UI and the same records as the
website. There is **no separate offline/app database**.

| Setting | Value |
|---|---|
| App name | `LUXWELD Warranty` |
| Android package ID | `com.luxweld.warranty` |
| iOS bundle ID | `com.luxweld.warranty` |
| Target URL | `LUXWELD_APP_URL` (your deployed HTTPS domain) |

## How the shell loads (and why it no longer hangs)

`mobile/www/index.html` is a self-driving shell:

1. It reads **`window.LUXWELD_APP_URL`** from `mobile/www/app-config.js`.
2. If a valid HTTPS URL is set, it checks the site is reachable (`/health`) and
   then navigates the webview to it — same UI, same records, cookies + camera
   work normally.
3. If the URL is **not set** (or unreachable), it shows a **setup screen** with
   instructions and a **Retry** button. It never sits on "Connecting…" forever.
4. A **development-only** field lets you open a LAN/tunnel URL for testing.

> The previous version relied on a `server.url` placeholder
> (`https://YOUR_DEPLOYED_DOMAIN`) that couldn't resolve, so the splash hung.
> `server.url` has been removed; the shell drives loading itself.

## Set the target URL (required before building)

Either edit `mobile/www/app-config.js`:

```js
window.LUXWELD_APP_URL = "https://warranty.luxweld.com.au";
```

…or generate it from an env var (run in the **project root**):

```bash
LUXWELD_APP_URL=https://warranty.luxweld.com.au npm run set-app-url
```

## Prerequisites
- Node 18+
- Android: Android Studio + JDK 17
- iOS: macOS + Xcode (iOS builds require a Mac)

## One-time setup

```bash
cd mobile
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
# capacitor.config.json already has the IDs (com.luxweld.warranty) + webDir "www"
npx cap init "LUXWELD Warranty" "com.luxweld.warranty" --web-dir=www
npx cap add android
npx cap add ios
```

## Local testing from a phone

**localhost will NOT work from a phone** — the phone can't reach your PC's
localhost. Use one of:

- **LAN IP:** run the site, find your PC IP (`ipconfig`), e.g.
  `http://192.168.1.50:3000`. Start the server with
  `BASE_URL=http://192.168.1.50:3000` so QR codes match.
- **HTTPS tunnel (recommended):** `ngrok http 3000` or
  `cloudflared tunnel --url http://localhost:3000`; use the https URL and set
  `BASE_URL` to it.

In the app shell's dev field, paste that URL and tap **Open development URL**.
For a LAN **http** URL inside the wrapper you must allow cleartext (Android):
temporarily set `"server": { "cleartext": true, "androidScheme": "http" }` in
`capacitor.config.json` for dev only. A tunnel (https) avoids this entirely.

## Build / run

```bash
# Android
npx cap sync android
npx cap open android      # Run on device, or build a signed AAB/APK

# iOS (macOS only)
npx cap sync ios
npx cap open ios          # Run on device, or Archive
```

## Camera, cookies & login inside the wrapper
- **Camera/photo upload:** works via the standard web `<input capture>` once the
  OS grants the WebView camera permission.
  - Android: add `<uses-permission android:name="android.permission.CAMERA"/>` to
    `android/app/src/main/AndroidManifest.xml`.
  - iOS: add `NSCameraUsageDescription` (and photo-library strings) to
    `ios/App/App/Info.plist`.
- **Cookies/sessions & login:** the wrapper navigates to your real HTTPS origin,
  so the site's session cookie works exactly as in the browser. Admin and
  production login work unchanged. (Keep the server on HTTPS; secure cookies are
  enabled when `NODE_ENV=production`.)
- Installer submissions made from the wrapper are recorded with source
  `android` / `ios`.

## Android internal test build (Play Console)
1. Set `LUXWELD_APP_URL` to your live HTTPS domain; `npx cap sync android`.
2. In Android Studio: **Build → Generate Signed Bundle/APK → Android App Bundle**
   (create/keep a keystore — back it up).
3. Play Console → create the app (`com.luxweld.warranty`) → **Testing → Internal
   testing** → upload the `.aab` → add testers by email → share the opt-in link.

## iOS TestFlight build (Xcode)
1. Set `LUXWELD_APP_URL` to your live HTTPS domain; `npx cap sync ios`.
2. In Xcode: set the team/signing for bundle ID `com.luxweld.warranty`, bump the
   build number.
3. **Product → Archive → Distribute App → App Store Connect → Upload**.
4. App Store Connect → **TestFlight** → add internal/external testers.

## Do not submit to the stores until the live website works
Verify the deployment checklist in the main README (deploy, `/health`, QR scan,
installer form in a phone browser) **before** building or submitting wrappers.
