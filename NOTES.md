# ScanDoc notes (build 1, test build)

Read PROJECT-NOTES.md first. This file covers ScanDoc only.

## What it is
Phone scanner PWA: photo or screenshot in, flat clean PDF out, one tap to the share sheet. Nothing leaves the phone. No ads, no watermark, no third-party code (PDF writer is our own).

## Files
index.html (whole app), config.js (tune by hand), manifest.json (includes the Android share target), sw.js (network-first + share target), icon-192.png, icon-512.png. Local folder `H:\DEV\_CODEII\Misc\scandoc`. Build label: Settings, About (`CONFIG.build`). Bump with every release, and bump `CACHE` in sw.js when files are added.

## In build 1
- Import: camera, gallery (multi), share from other apps, paste/drag (PC testing). Originals re-encoded to JPEG, max 4096 px, EXIF/GPS stripped.
- Crop: 4 draggable corners with loupe, rotate 90, Full image, Reset. Perspective flatten.
- Clean: presets (Original, Auto, B&W, Gray, Color boost), Paper white (removes shadow and yellowing), exposure, brightness, contrast, sharpness, color, B&W threshold, apply to all pages.
- Page: Letter, Legal, A4, Original aspect; Fit, Fill, Stretch; margin. Per document.
- Documents: library, rename, delete, reorder, rotate, duplicate, delete pages.
- Send: PDF or JPEG images; Best quality or compress to 200 KB / 500 KB / 1 MB / 2 MB / custom; share sheet; Save to phone fallback. The file is prepared first, then Send is one tap (browsers refuse to share after a long wait).
- Auto-saves everything. Settings: theme, defaults, DPI, JPEG quality, storage use, persistent storage, delete all.

## Not in build 1 (by plan)
OCR, vault and encryption, backup/restore, Google Drive, auto edge detection, fine straighten slider (corners cover it), PDF import.

## Test on PC
In the folder: `python -m http.server 8000`, open http://localhost:8000 in Chrome. (Any static server works.)

## Test on phone
Option A, no publishing: phone on USB, PC Chrome `chrome://inspect`, Port forwarding, add `8000` to `localhost:8000`, then open `http://localhost:8000` in the phone's Chrome.
Option B: publish as in PROJECT-NOTES section 4 (repo `scandoc`, subdomain of your choice). The **share target only appears after the app is installed from the https address** (Menu, Add to Home screen / Install app). Then take a screenshot, Share, pick ScanDoc.

## Check on the phone (success criteria from the requirements)
1. Camera to shared PDF in under 30 s and about 6 taps.
2. Photo at a steep angle flattens correctly; dim photo with shadow comes out white with Auto.
3. Send to WhatsApp and Gmail works from the share sheet.
4. Compress to 200 KB hits the limit and is still readable.
5. 5-page document exports without the app crashing, on a fast and a low-end phone.
6. Screenshot shared in from another app lands as a new document.

## Known limits
- Edge detection is manual (v0.2). Default corners are inset 6%.
- Page aspect comes from the corner shape; use Stretch to force the paper shape.
- Cleanup runs on the main thread; very large pages (300 dpi) can take several seconds.
- Browser storage can be cleared by the system. Settings, "Keep my data safe" asks for persistent storage; backup export comes with the vault.
