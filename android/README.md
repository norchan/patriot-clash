# PoliticsGo — Android app (Trusted Web Activity)

This wraps the live site `https://politicsgo.app` full-screen as a native
Android app via a **TWA**. The app has no separate codebase — it renders the
real website, so **every Vercel deploy updates the app automatically**. No
resubmission is needed for content changes (only for version bumps of the
wrapper itself).

## What's already prepared in the repo
- `public/manifest.json` — PWA manifest (standalone, icons, scope). TWA-ready.
- `public/.well-known/assetlinks.json` — Digital Asset Links file. **The
  fingerprint is a placeholder** — fill it in after you have a signing key
  (step 3), then deploy so Google can verify domain ownership.
- `android/twa-manifest.json` — Bubblewrap config (package id, colors, icon).

## Build the app (needs a machine with the Android toolchain)
This cannot be built inside the web app repo's CI without the Android SDK/JDK.
On your machine (or a GitHub Action with the Android SDK):

1. Install prerequisites: **Node 18+**, **JDK 17**, and the **Android SDK**
   (Android Studio is the easy way). Then:
   ```bash
   npm install -g @bubblewrap/cli
   ```

2. From an empty folder, initialize using the config in this repo:
   ```bash
   bubblewrap init --manifest https://politicsgo.app/manifest.json
   ```
   Accept the defaults; when prompted, match the values in
   `android/twa-manifest.json` (package id `app.politicsgo.twa`).

3. **Create the signing key** (Bubblewrap offers to make one). Keep the
   keystore + passwords safe — losing them means you can never update the app.
   Get its SHA-256 fingerprint:
   ```bash
   bubblewrap fingerprint
   ```
   Copy the SHA-256 value.

4. **Wire domain verification:** paste that fingerprint into
   `public/.well-known/assetlinks.json` (replace the placeholder), commit,
   and deploy. Verify it's live at
   `https://politicsgo.app/.well-known/assetlinks.json`.
   > If you use **Play App Signing** (recommended — Google holds the key),
   > you'll ALSO add the fingerprint Google shows in the Play Console after
   > your first upload. Both fingerprints can be listed in the array.

5. Build the signed bundle:
   ```bash
   bubblewrap build
   ```
   Output: `app-release-signed.aab` (upload this to Play) and an `.apk` for
   local testing.

## Publish to Google Play
1. Create a **Play Console** account ($25 one-time). New personal accounts
   must run a **closed test with 12+ testers for ~14 days** before they can
   promote to production.
2. Create the app → upload the `.aab`.
3. **Content rating (IARC questionnaire):** answer truthfully —
   - The app contains **mature/NSFW content and profanity** → this will be
     rated **Adults / 18+**.
   - The slots are **simulated gambling with no real-money payout and no cash
     prizes** → say so clearly. FP is an in-game currency that cannot be
     cashed out. Misrepresenting this gets the app pulled.
4. Fill in: privacy policy URL, data-safety form, screenshots (phone),
   512×512 icon, 1024×500 feature graphic.

## Ads in the app
A TWA has **no native layer**, so **AdMob cannot be used** inside it. Inside
the app the site's existing **AdSense** web banner renders as-is. If native
**AdMob** is a hard requirement, the wrapper must be rebuilt with **Capacitor**
instead of a TWA (adds a native shell for AdMob + push + native billing).

## Known good defaults
- `packageId`: `app.politicsgo.twa` (must stay constant forever once published)
- Additional trusted origin: `politicsgo.net` (so links there stay in-app)
