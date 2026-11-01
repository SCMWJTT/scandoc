# ScanDoc notes (build 2)

Read PROJECT-NOTES.md first. This file covers ScanDoc only. Site: https://scandoc.checkmysite.online, repo `scandoc`, local `H:\DEV\_CODEII\Misc\scandoc`.

## What it is
Phone scanner PWA. Photo, screenshot or PDF in; clean, correctly sized PDF out; one tap to the share sheet. Text extraction, tags and search, an encrypted vault for IDs, encrypted backup. Everything stays on the phone. No ads, no watermark, no accounts.

## Files
- index.html: markup and styles (Linen, Carbon, Studio themes). Icons are an inline sprite.
- config.js: settings to tune by hand (page sizes, presets, size targets, vault key rounds, OCR dpi).
- engine.js: pure code, no screen access: perspective flatten, cleanup, layout, PDF writer, redaction and stamp, vault crypto, backup packing. This is what a Capacitor wrapper reuses.
- app.js: navigation, home, library, camera, import (images and PDF), send sheet, settings.
- editor.js: editor (Crop, Enhance, Pages, OCR tabs), text screen, share-safe copy.
- vault.js: vault, backup, restore, change passphrase.
- sw.js: service worker (network-first; lib folder cache-first; Android share target).
- lib/: Tesseract.js + English model, PDF.js. Apache 2.0, copied unchanged (see lib/README.txt). 17 MB, loaded only when used, then cached for offline.
- Build label: Settings, About (`CONFIG.build`). Bump each release. Bump `CACHE` in sw.js when files are added.

## Features in build 2
- Home, Library (search by name, tag, and extracted text; filters PDF/Images/tags; sort; select, merge, delete), Scan, Editor, Text, Send, Vault, Settings.
- Scan: live camera at full resolution with several pages in a row, flash, gallery/PDF, phone camera app fallback, "Send now" shortcut.
- Editor: four-corner crop with loupe, rotate, presets, Make paper white, sliders, apply to all pages, reorder/rotate/duplicate/delete pages, page size and placement, tags, move to vault.
- Text: English OCR on the phone; editable; copy, .txt, send. PDF import keeps the PDF's own text where it has any.
- Send: PDF, JPEG, PNG, TXT; Best quality or 200 KB / 500 KB / 1 MB / 2 MB / custom; quality slider; the real result size is shown; share sheet or save.
- Vault: passphrase (no recovery), AES-GCM, key from PBKDF2. Items encrypted in their own stores, not in search or library. Auto-lock idle and on background. Categories, expiry with warnings, notes, front/back pages.
- Share-safe copy (any document, default on for vault): purpose + date stamp, black redaction boxes, flattened into the pixels. Unredacted vault sends ask for confirmation.
- Backup: everything in one encrypted file (backup passphrase), or vault only (already encrypted). Restore on a fresh install. Change passphrase re-encrypts everything.

## Not done yet
Auto edge detection, searchable-PDF text layer, "Send to myself" shortcut (a browser cannot pick a share target; needs the Capacitor build), Google Drive sign-in (use Send, then Drive), biometric unlock and screenshot blocking (Capacitor), expiry notifications, split PDF, extra OCR languages, Carbon "power user" home.

## Testing
- On PC: serve the folder (for example `python -m http.server 8000`) and open http://localhost:8000, or push and use the site. Paste or drop an image on Home to import.
- On phone: push to GitHub, open the site in Chrome, Add to Home screen. The camera, share sheet, share target and install need the https site.
- Force a fresh copy after a push: `https://scandoc.checkmysite.online/?v=3` (do not clear site data, it deletes documents).
- Tested before release (simulated browser, 61 checks): import, crop, enhance, pages, OCR screen flow, tags, search, merge, PDF import flow, compress-to-size, TXT/PNG/PDF send, safe copy, vault create/lock/unlock/wrong passphrase, vault data unreadable in storage, encrypted backup and restore, change passphrase. Real OCR and real PDF.js verified on sample files in Node.
- NOT tested on a real phone: live camera, flash, share sheet, share target, touch dragging of corners, layout on real screens, speed on a low-end phone, real OCR inside the browser worker.

## Check on the phone
1. Camera: shoot 3 pages in a row, Done, flatten and clean, Send to WhatsApp or Gmail.
2. Steep-angle photo flattens; dim photo with shadow comes out white with Auto.
3. 200 KB target hits the limit and stays readable.
4. Extract text from a printed page; search for a word from it in Library.
5. Import a PDF; reorder pages; export again.
6. Vault: create, add an ID, make a safe copy with a box and stamp, send it; lock by switching apps; unlock.
7. Make an encrypted backup, delete all data, restore.
8. Screenshot shared from another app lands as a new document (after installing the app).

## Limits to know
- Backup is built in memory: very large libraries (hundreds of MB) may fail on a low-end phone.
- Cleanup runs on the main thread; 300 dpi pages can take several seconds.
- Browser storage can be cleared by the system. Settings, "Keep my data safe" asks for persistent storage. A backup is the real safety net.
- Vault iterations (`kdfIterations`) is 400,000. Raise it if unlock feels instant, lower it if it feels slow on an old phone. A backup made earlier keeps its own setting.
