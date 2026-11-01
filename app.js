'use strict';
/* ScanDoc app: core, navigation, home, library, camera, import, send, settings.
   editor.js has the editor, text recognition and share-safe copy. vault.js has the vault and backups. */
const CFG = window.CONFIG, E = window.Engine;

/* ============ helpers ============ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const toBlob = (c, t = 'image/jpeg', q = 0.9) => new Promise(r => c.toBlob(r, t, q));
const tick = () => new Promise(r => setTimeout(r, 0));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
const fmtDate = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const ic = (n, st) => '<svg class="ico"' + (st ? ' style="' + st + '"' : '') + '><use href="#i-' + n + '"/></svg>';
function relDate(t) {
  const d = new Date(t), n = new Date(), day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 86400000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : fmtDate(t);
}
const safeName = t => (String(t).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'scan').slice(0, 60);
const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);

let toastTimer;
function toast(msg, ms = 3000) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}
function busy(msg) {
  const b = $('#busy');
  if (!msg) { b.classList.remove('on'); return; }
  $('#busyMsg').textContent = msg; b.classList.add('on');
}

/* ============ settings ============ */
const SKEY = 'scandoc';
let S;
try { S = Object.assign({}, CFG.defaults, JSON.parse(localStorage.getItem(SKEY) || '{}')); }
catch (e) { S = Object.assign({}, CFG.defaults); }
if (!CFG.themes[S.theme]) S.theme = 'linen';
const saveS = () => { try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch (e) {} };
function applyTheme() {
  document.documentElement.dataset.theme = S.theme;
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#f9faf6';
}

/* ============ storage (IndexedDB) ============ */
let db;
const STORES = ['docs', 'images', 'vault', 'vimages', 'meta'];
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('scandoc', 2);
    r.onupgradeneeded = () => { const d = r.result; STORES.forEach(n => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: 'id' }); }); };
    r.onsuccess = () => { db = r.result; res(); };
    r.onerror = () => rej(r.error);
  });
}
function tx(stores, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode), out = fn(t);
    t.oncomplete = () => res(out && out.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
const dbGet = (st, id) => tx(st, 'readonly', t => t.objectStore(st).get(id));
const dbPut = (st, v) => tx(st, 'readwrite', t => t.objectStore(st).put(v));
const dbDel = (st, id) => tx(st, 'readwrite', t => t.objectStore(st).delete(id));
const dbAll = st => tx(st, 'readonly', t => t.objectStore(st).getAll());
const dbClearAll = () => tx(STORES, 'readwrite', t => STORES.forEach(n => t.objectStore(n).clear()));

/* ============ documents ============ */
const newClean = name => Object.assign({}, CFG.cleanBase, CFG.presets[name] || {}, { preset: name });
const insetCorners = () => { const i = CFG.defaultInset; return [{ x: i, y: i }, { x: 1 - i, y: i }, { x: 1 - i, y: 1 - i }, { x: i, y: 1 - i }]; };
const fullCorners = () => [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const newPage = (img, o = {}) => ({ id: uid(), img, rot: 0, corners: o.full ? fullCorners() : insetCorners(), clean: newClean(o.preset || S.preset), thumb: '', ocr: o.text || '' });
function newDoc(isVault) {
  const d = { id: uid(), title: 'Scan ' + new Date().toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    created: Date.now(), modified: Date.now(), pageSize: S.pageSize, fit: S.fit, margin: S.margin, pages: [], tags: [], src: 'image',
    safe: { purpose: '', stamp: false, redact: {} } };
  if (isVault) Object.assign(d, { vault: true, title: 'New document', category: CFG.vaultCategories[0], expiry: '', notes: '' });
  return d;
}
function normDoc(d) {
  d.tags = d.tags || []; d.src = d.src || 'image'; d.safe = d.safe || { purpose: '', stamp: false, redact: {} };
  d.pages.forEach(p => { if (p.ocr === undefined) p.ocr = ''; });
  return d;
}
const docText = d => {
  const parts = d.pages.map(p => (p.ocr || '').trim());
  const have = parts.filter(Boolean).length;
  return have > 1 || (have === 1 && d.pages.length > 1)
    ? parts.map((t, i) => t ? '--- Page ' + (i + 1) + ' ---\n' + t : '').filter(Boolean).join('\n\n') : parts.join('');
};

// plain documents live in 'docs'/'images'. Vault documents are encrypted in 'vault'/'vimages'.
const Store = {
  async getImg(doc, id) {
    if (doc.vault) {
      const r = await dbGet('vimages', id); if (!r) throw new Error('image missing');
      return new Blob([await E.open(vault.key, new Uint8Array(await r.blob.arrayBuffer()))], { type: 'image/jpeg' });
    }
    const r = await dbGet('images', id); if (!r) throw new Error('image missing');
    return r.blob;
  },
  async putImg(doc, id, blob) {
    if (doc.vault) await dbPut('vimages', { id, blob: new Blob([await E.seal(vault.key, new Uint8Array(await blob.arrayBuffer()))]) });
    else await dbPut('images', { id, blob });
  },
  delImg(doc, id) { return dbDel(doc.vault ? 'vimages' : 'images', id); },
  async save(doc) {
    doc.modified = Date.now();
    if (doc.vault) await dbPut('vault', { id: doc.id, blob: new Blob([await E.sealJSON(vault.key, doc)]) });
    else await dbPut('docs', doc);
  },
  async remove(doc, keepImages) {
    if (!keepImages) for (const id of new Set(doc.pages.map(p => p.img))) await Store.delImg(doc, id);
    await dbDel(doc.vault ? 'vault' : 'docs', doc.id);
  }
};

// rotated, shrunk working copies of originals, kept in memory
const workCache = new Map();
async function getWork(doc, page, maxSide) {
  const key = page.img + '|' + page.rot + '|' + maxSide;
  if (workCache.has(key)) return workCache.get(key);
  const bmp = await createImageBitmap(await Store.getImg(doc, page.img));
  const c = E.rotCanvas(bmp, page.rot, maxSide);
  if (bmp.close) bmp.close();
  if (maxSide !== Infinity) {
    workCache.set(key, c);
    while (workCache.size > CFG.cacheImages) workCache.delete(workCache.keys().next().value);
  }
  return c;
}
async function makeThumb(doc, page) {
  const work = await getWork(doc, page, CFG.workSide);
  return E.renderPage(doc, page, work, CFG.thumbSide / E.pageLongIn(doc), null).canvas.toDataURL('image/jpeg', 0.7);
}
// decode, fix orientation, shrink, strip metadata (EXIF/GPS) by re-encoding
async function normalizeImage(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { bmp = await createImageBitmap(file); }
  const s = Math.min(1, CFG.maxSide / Math.max(bmp.width, bmp.height));
  const c = mk(Math.round(bmp.width * s), Math.round(bmp.height * s)), x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return toBlob(c, 'image/jpeg', 0.92);
}

/* ============ dialogs and menus ============ */
let modalDone = null, sheetOpen = null;
const overlayOpen = () => !!modalDone || !!sheetOpen;
// o: { title, message, fields:[{name,label,type,value,placeholder,multiline}], ok, cancel, danger, validate(values)->error }
function ask(o) {
  return new Promise(res => {
    const box = $('#modalBox'), fields = o.fields || [];
    box.innerHTML = '<h3>' + esc(o.title || '') + '</h3>' + (o.message ? '<p>' + esc(o.message) + '</p>' : '') +
      fields.map(f => f.type === 'check'
        ? '<label class="row" style="margin:10px 0;gap:10px;align-items:flex-start"><input type="checkbox" data-n="' + f.name + '" style="width:22px;height:22px;flex:none;margin:0"><span style="font-size:.88rem">' + esc(f.label) + '</span></label>'
        : '<div class="field"><label>' + esc(f.label || '') + '</label>' +
          (f.multiline ? '<textarea data-n="' + f.name + '" placeholder="' + esc(f.placeholder || '') + '">' + esc(f.value || '') + '</textarea>'
            : '<input data-n="' + f.name + '" type="' + (f.type || 'text') + '" value="' + esc(f.value || '') + '" placeholder="' + esc(f.placeholder || '') + '" autocomplete="off">') + '</div>').join('') +
      '<p id="modalErr" style="color:var(--danger);margin:6px 0 0"></p>' +
      '<div class="btns">' + (o.cancel === false ? '' : '<button class="btn" data-a="cancel">' + esc(o.cancel || 'Cancel') + '</button>') +
      '<button class="btn ' + (o.danger ? 'danger' : 'primary') + '" data-a="ok">' + esc(o.ok || 'OK') + '</button></div>';
    $('#modal').classList.add('on');
    const values = () => { const v = {}; box.querySelectorAll('[data-n]').forEach(i => { v[i.dataset.n] = i.type === 'checkbox' ? i.checked : i.value; }); return v; };
    const finish = r => { $('#modal').classList.remove('on'); modalDone = null; res(r); };
    const submit = () => {
      const v = values(), err = o.validate ? o.validate(v) : '';
      if (err) { $('#modalErr').textContent = err; return; }
      finish(fields.length ? v : true);
    };
    modalDone = () => finish(null);
    box.onclick = e => { const a = e.target.closest('[data-a]'); if (!a) return; if (a.dataset.a === 'ok') submit(); else finish(null); };
    box.onkeydown = e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); submit(); } };
    const first = box.querySelector('input:not([type=checkbox]),textarea');
    if (first) { first.focus(); if (first.select && o.selectFirst !== false) try { first.select(); } catch (e) {} }
  });
}
function closeSheets() {
  if (sheetOpen) { const s = sheetOpen; sheetOpen = null; $(s).classList.remove('on'); if (!(curScreen === 'export')) $('#scrim').classList.remove('on'); }
}
function openSheet(id, html, onclick) {
  closeSheets();
  const s = $(id); s.innerHTML = html; s.onclick = onclick || null; s.classList.add('on'); $('#scrim').classList.add('on'); sheetOpen = id;
}
// items: [{label, icon, danger, run}]
function menu(items) {
  openSheet('#menu', items.map((it, i) => '<button class="menuitem' + (it.danger ? ' danger' : '') + '" data-i="' + i + '">' + ic(it.icon || 'chevron') + esc(it.label) + '</button>').join(''), e => {
    const b = e.target.closest('[data-i]'); if (!b) return; closeSheets(); items[+b.dataset.i].run();
  });
}
$('#scrim').addEventListener('click', () => { if (sheetOpen) closeSheets(); else if (curScreen === 'export') history.back(); });

/* ============ navigation ============ */
const SCREENS = ['home', 'library', 'scan', 'editor', 'ocr', 'safe', 'vault', 'vitem', 'settings'];
const NAV_ON = ['home', 'library', 'vault', 'settings'];
let curScreen = 'home', curDoc = null, ed = null, ex = null;

function show(name) {
  const base = name === 'export' ? (ex ? ex.under : 'home') : name;
  SCREENS.forEach(s => $('#' + s).classList.toggle('on', s === base));
  $('#sheet').classList.toggle('on', name === 'export');
  $('#scrim').classList.toggle('on', name === 'export' || !!sheetOpen);
  $('#nav').classList.toggle('hide', !NAV_ON.includes(base));
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.go === base));
}
function nav(name) { history.pushState({ s: name }, ''); goTo(name); }
function go(name, replace) { if (replace) { history.replaceState({ s: name }, ''); goTo(name); } else nav(name); }
function navTab(name) {                      // switching between the main tabs does not stack history
  if (NAV_ON.includes(curScreen)) { history.replaceState({ s: name }, ''); goTo(name); } else nav(name);
}
function goTo(name) {
  const prev = curScreen;
  if (prev === 'editor' && name !== 'editor') leaveEditor();
  if (prev === 'scan' && name !== 'scan') stopCamera();
  if (prev === 'ocr' && name !== 'ocr') ocrLeave();
  if (prev === 'safe' && name !== 'safe') safeLeave();
  if (prev === 'export' && name !== 'export' && ex) ex.token++;
  if ((name === 'editor' || name === 'ocr' || name === 'safe') && !curDoc) name = 'home';
  if (name === 'vitem' && !curDoc) name = 'vault';
  if (name === 'export' && !ex) name = 'home';
  if (name === 'scan' && !cam) name = 'home';
  const resume = prev === 'export' && ex && name === ex.under;
  curScreen = name; show(name);
  if (name === 'home') renderHome();
  else if (name === 'library') refreshLibrary();
  else if (name === 'settings') renderSettings();
  else if (name === 'vault') renderVault();
  else if (name === 'vitem') renderVitem();
  else if (resume) { if (name === 'editor') schedulePreview(); }
  else if (name === 'editor') enterEditor();
  else if (name === 'ocr') enterOcr();
  else if (name === 'safe') enterSafe();
  else if (name === 'scan') startCamera();
}
window.addEventListener('popstate', e => {
  if (overlayOpen()) {                       // Back closes a dialog or menu first
    if (modalDone) modalDone(); else closeSheets();
    history.pushState({ s: curScreen }, ''); return;
  }
  goTo((e.state && e.state.s) || 'home');
});
$('#nav').addEventListener('click', e => {
  const b = e.target.closest('[data-go]'); if (!b) return;
  if (b.dataset.go === 'scan') openScan(); else navTab(b.dataset.go);
});

/* ============ home ============ */
async function renderHome() {
  const h = new Date().getHours();
  $('#hGreet').textContent = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  allDocs = (await dbAll('docs')).map(normDoc).sort((a, b) => b.modified - a.modified);
  $('#hRecent').innerHTML = allDocs.length
    ? allDocs.slice(0, 4).map(d => docRow(d)).join('')
    : '<div class="empty">No documents yet.<br>Tap Start scanning, or import photos and screenshots.</div>';
}
$('#hStart').onclick = () => openScan();
$('#hSet').onclick = () => nav('settings');
$('#hAll').onclick = () => navTab('library');
$('#hVault').onclick = () => navTab('vault');
$('#hImport').onclick = () => pick($('#inGal'), {});
$('#hOcr').onclick = () => pick($('#inGal'), { ocr: true });
$('#hSearch').addEventListener('focus', () => { $('#hSearch').blur(); navTab('library'); setTimeout(() => $('#lSearch').focus(), 60); });
$('#hRecent').addEventListener('click', docRowClick);

/* ============ library ============ */
let allDocs = [];
const lib = { q: '', sort: 'new', filter: 'all', selecting: false, sel: [] };
const SORTS = { new: 'Newest', old: 'Oldest', name: 'A to Z', pages: 'Most pages' };

function docRow(d, o = {}) {
  const t = d.pages[0] && d.pages[0].thumb;
  return '<div class="docrow' + (o.sel ? ' sel' : '') + '" data-id="' + d.id + '" role="button" tabindex="0"><span class="chk"></span>' +
    '<span class="th">' + (t ? '<img alt="" src="' + t + '">' : ic('file')) + '</span>' +
    '<span class="mid"><div class="t">' + esc(d.title) + '</div><div class="m">' + (d.src === 'pdf' ? 'PDF' : 'Images') + ' &middot; ' + plural(d.pages.length, 'page', 'pages') + ' &middot; ' + relDate(d.modified) + '</div>' +
    (d.tags.length ? '<div class="tg">' + d.tags.map(x => '<span class="tag">' + esc(x) + '</span>').join('') + '</div>' : '') + '</span>' +
    '<button class="sendbtn" data-send="' + d.id + '" aria-label="Send ' + esc(d.title) + '">' + ic('send') + '</button></div>';
}
function docRowClick(e) {
  const row = e.target.closest('.docrow'); if (!row) return;
  const d = allDocs.find(x => x.id === row.dataset.id); if (!d) return;
  if (e.target.closest('[data-send]')) { curDoc = d; openExport({ doc: d }); return; }
  if (lib.selecting) {
    const i = lib.sel.indexOf(d.id); if (i >= 0) lib.sel.splice(i, 1); else lib.sel.push(d.id);
    drawLibrary(); return;
  }
  openEditor(d, 0, 'pages', { from: 'library' });
}
async function refreshLibrary() {
  allDocs = (await dbAll('docs')).map(normDoc);
  drawLibrary();
  try { const e = await navigator.storage.estimate(); $('#lStore').textContent = fmtSize(e.usage || 0) + ' on this phone'; } catch (x) {}
}
function drawLibrary() {
  const q = lib.q.trim().toLowerCase();
  const tags = [...new Set(allDocs.flatMap(d => d.tags))].sort();
  const filters = [['all', 'All'], ['pdf', 'PDF'], ['img', 'Images']].concat(tags.map(t => ['tag:' + t, t]));
  if (!filters.some(f => f[0] === lib.filter)) lib.filter = 'all';
  $('#lFilters').innerHTML = filters.map(f => '<button class="fpill' + (lib.filter === f[0] ? ' on' : '') + '" data-f="' + esc(f[0]) + '">' + esc(f[1]) + '</button>').join('');
  let list = allDocs.filter(d => {
    if (lib.filter === 'pdf' && d.src !== 'pdf') return false;
    if (lib.filter === 'img' && d.src === 'pdf') return false;
    if (lib.filter.startsWith('tag:') && !d.tags.includes(lib.filter.slice(4))) return false;
    if (!q) return true;
    return (d.title + ' ' + d.tags.join(' ') + ' ' + d.pages.map(p => p.ocr).join(' ')).toLowerCase().includes(q);
  });
  list.sort(lib.sort === 'old' ? (a, b) => a.modified - b.modified : lib.sort === 'name' ? (a, b) => a.title.localeCompare(b.title)
    : lib.sort === 'pages' ? (a, b) => b.pages.length - a.pages.length : (a, b) => b.modified - a.modified);
  $('#lSub').textContent = plural(allDocs.length, 'document', 'documents') + (q || lib.filter !== 'all' ? ' (' + list.length + ' shown)' : '');
  $('#lSort').textContent = 'Sort: ' + SORTS[lib.sort];
  $('#lList').innerHTML = list.length ? list.map(d => docRow(d, { sel: lib.sel.includes(d.id) })).join('')
    : '<div class="empty">' + (allDocs.length ? 'No documents match.' : 'Your library is empty.<br>Scan something with the + button.') + '</div>';
  $('#lBody').classList.toggle('selmode', lib.selecting);
  $('#lSelBar').classList.toggle('on', lib.selecting);
  $('#lSelCount').textContent = lib.sel.length + ' selected';
  $('#lMerge').disabled = lib.sel.length < 2; $('#lDel').disabled = !lib.sel.length;
  $('#lSelect').textContent = lib.selecting ? 'Done' : 'Select';
}
$('#lSearch').addEventListener('input', e => { lib.q = e.target.value; drawLibrary(); });
$('#lFilters').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { lib.filter = b.dataset.f; drawLibrary(); } });
$('#lSort').onclick = () => { const k = Object.keys(SORTS); lib.sort = k[(k.indexOf(lib.sort) + 1) % k.length]; drawLibrary(); };
$('#lList').addEventListener('click', docRowClick);
$('#lSelect').onclick = () => { lib.selecting = !lib.selecting; lib.sel = []; drawLibrary(); };
$('#lCancel').onclick = () => { lib.selecting = false; lib.sel = []; drawLibrary(); };
$('#lDel').onclick = async () => {
  const docs = lib.sel.map(id => allDocs.find(d => d.id === id)).filter(Boolean);
  if (!await ask({ title: 'Delete ' + plural(docs.length, 'document', 'documents') + '?', message: 'The pages and any extracted text are removed from this phone.', ok: 'Delete', danger: true })) return;
  for (const d of docs) await Store.remove(d);
  lib.selecting = false; lib.sel = []; toast('Deleted ' + plural(docs.length, 'document', 'documents')); refreshLibrary();
};
$('#lMerge').onclick = async () => {
  const docs = lib.sel.map(id => allDocs.find(d => d.id === id)).filter(Boolean);
  if (docs.length < 2) return;
  const first = docs[0];
  for (const d of docs.slice(1)) { first.pages.push(...d.pages); d.tags.forEach(t => { if (!first.tags.includes(t)) first.tags.push(t); }); }
  await Store.save(first);
  for (const d of docs.slice(1)) await Store.remove(d, true);
  lib.selecting = false; lib.sel = [];
  toast('Merged into "' + first.title + '" (' + plural(first.pages.length, 'page', 'pages') + ')'); refreshLibrary();
};

/* ============ camera ============ */
let cam = null, pickOpts = {};
function openScan(o = {}) {
  cam = { stream: null, track: null, ic: null, shots: [], torch: false, target: o.target || null, vault: !!o.vault, ocr: !!o.ocr };
  $('#cMode').textContent = cam.vault ? 'VAULT SCAN' : cam.target ? 'ADD PAGES' : 'NEW SCAN';
  renderShots();
  nav('scan');
}
function renderShots() {
  const n = cam ? cam.shots.length : 0;
  $('#cShots').innerHTML = cam ? cam.shots.map(b => '<img alt="" src="' + (b._u || (b._u = URL.createObjectURL(b))) + '">').join('') : '';
  $('#cDone').disabled = !n; $('#cDone').textContent = n ? 'Done (' + n + ')' : 'Done';
  $('#cSendNow').hidden = !n || (cam && cam.vault);
}
function camFail(msg) { $('#cFailMsg').textContent = msg; $('#cFail').hidden = false; $('#cTorch').hidden = true; }
async function startCamera() {
  stopCamera(); $('#cFail').hidden = true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { camFail('A live camera is not available here. Use the phone camera app instead.'); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 4032 }, height: { ideal: 3024 } }, audio: false }); }
  catch (e) { camFail(e && e.name === 'NotAllowedError' ? 'Camera permission was refused. Allow it in the browser site settings, or use the phone camera app.' : 'No camera could be opened.'); return; }
  if (curScreen !== 'scan') { stream.getTracks().forEach(t => t.stop()); return; }
  cam.stream = stream; cam.track = stream.getVideoTracks()[0];
  const v = $('#cVideo'); v.srcObject = stream; try { await v.play(); } catch (e) {}
  try { if (window.ImageCapture) cam.ic = new ImageCapture(cam.track); } catch (e) {}
  const caps = cam.track.getCapabilities ? cam.track.getCapabilities() : {};
  $('#cTorch').hidden = !('torch' in caps); $('#cTorch').classList.remove('on');
}
function stopCamera() {
  if (cam && cam.stream) cam.stream.getTracks().forEach(t => t.stop());
  if (cam) { cam.stream = null; cam.ic = null; }
  const v = $('#cVideo'); if (v) v.srcObject = null;
}
async function shoot() {
  if (!cam || !cam.stream) return;
  let blob = null;
  try { if (cam.ic) blob = await cam.ic.takePhoto(); } catch (e) { blob = null; }
  if (!blob) {
    const v = $('#cVideo'); if (!v.videoWidth) return;
    const c = mk(v.videoWidth, v.videoHeight); c.getContext('2d').drawImage(v, 0, 0);
    blob = await toBlob(c, 'image/jpeg', 0.92);
  }
  cam.shots.push(blob); renderShots();
  const f = $('.viewfinder'); f.style.opacity = '.4'; setTimeout(() => { f.style.opacity = ''; }, 90);
}
async function finishScan(send) {
  if (!cam || !cam.shots.length) return;
  const files = cam.shots.map((b, i) => new File([b], 'scan-' + (i + 1) + '.jpg', { type: b.type || 'image/jpeg' }));
  const o = { target: cam.target, vault: cam.vault, ocr: cam.ocr, send: !!send, from: 'scan' };
  stopCamera(); cam.shots.forEach(b => b._u && URL.revokeObjectURL(b._u));
  await importFiles(files, o);
}
$('#cShutter').onclick = shoot;
$('#cDone').onclick = () => finishScan(false);
$('#cSendNow').onclick = () => finishScan(true);
$('#cTorch').onclick = async () => {
  if (!cam || !cam.track) return; cam.torch = !cam.torch;
  try { await cam.track.applyConstraints({ advanced: [{ torch: cam.torch }] }); $('#cTorch').classList.toggle('on', cam.torch); } catch (e) { toast('Flash is not available'); }
};
$('#cClose').onclick = async () => {
  if (cam && cam.shots.length && !await ask({ title: 'Discard ' + plural(cam.shots.length, 'photo', 'photos') + '?', ok: 'Discard', danger: true })) return;
  history.back();
};
$('#cGal').onclick = () => pick($('#inGal'), camOpts());
$('#cNative').onclick = () => pick($('#inCam'), camOpts());
$('#cFailNative').onclick = () => pick($('#inCam'), camOpts());
const camOpts = () => ({ target: cam && cam.target, vault: cam && cam.vault, ocr: cam && cam.ocr, from: 'scan' });
document.addEventListener('visibilitychange', () => { if (document.hidden && curScreen === 'scan') stopCamera(); else if (!document.hidden && curScreen === 'scan' && cam && !cam.stream) startCamera(); });

/* ============ import ============ */
function pick(input, o) { pickOpts = o || {}; input.value = ''; if (typeof suspendLock === 'function') suspendLock(120000); input.click(); }
$('#inCam').addEventListener('change', e => { if (e.target.files.length) importFiles(e.target.files, pickOpts); });
$('#inGal').addEventListener('change', e => { if (e.target.files.length) importFiles(e.target.files, pickOpts); });
document.addEventListener('paste', e => {
  const fs = [...(e.clipboardData ? e.clipboardData.files : [])];
  if (fs.length && (curScreen === 'home' || curScreen === 'library')) importFiles(fs, {});
});
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  if (e.dataTransfer && e.dataTransfer.files.length && (curScreen === 'home' || curScreen === 'library')) importFiles(e.dataTransfer.files, {});
});

let pdfjs = null;
async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import(new URL('lib/pdfjs/pdf.min.mjs', location.href).href);
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('lib/pdfjs/pdf.worker.min.mjs', location.href).href;
  return pdfjs;
}
const isPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');

// Turn a PDF into one image page per PDF page. Text found in the PDF is kept as the page's text.
async function importPdf(file, doc, progress) {
  const lib2 = await loadPdfjs();
  const pdf = await lib2.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false, standardFontDataUrl: new URL('lib/pdfjs/standard_fonts/', location.href).href }).promise;
  let n = 0;
  for (let i = 1; i <= pdf.numPages; i++) {
    progress('PDF page ' + i + ' of ' + pdf.numPages + '...'); await tick();
    const pg = await pdf.getPage(i), v1 = pg.getViewport({ scale: 1 });
    if (i === 1 && !doc.pages.length) {
      doc.pageSize = E.pickPageSize(v1.width, v1.height); doc.margin = 0; doc.fit = 'fit'; doc.src = 'pdf';
    }
    const sc = Math.min(CFG.pdfImportDpi / 72, CFG.pdfImportMaxSide / Math.max(v1.width, v1.height));
    const vp = pg.getViewport({ scale: sc }), c = mk(Math.round(vp.width), Math.round(vp.height)), x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: x, viewport: vp }).promise;
    let text = '';
    try { text = (await pg.getTextContent()).items.map(t => t.str + (t.hasEOL ? '\n' : '')).join('').trim(); } catch (e) {}
    const id = uid();
    await Store.putImg(doc, id, await toBlob(c, 'image/jpeg', 0.9));
    const page = newPage(id, { full: true, preset: 'original', text: text.length > 15 ? text : '' });
    doc.pages.push(page); n++;
    try { page.thumb = await makeThumb(doc, page); } catch (e) {}
    if (pg.cleanup) pg.cleanup();
  }
  if (pdf.destroy) pdf.destroy();
  return n;
}

// o: { target: existing doc, vault: bool, ocr: bool (go straight to text), send: bool (go straight to Send), from }
async function importFiles(files, o = {}) {
  files = [...files].filter(f => (f.type || '').startsWith('image/') || isPdf(f) || /\.(jpe?g|png|webp|gif|bmp|heic)$/i.test(f.name || ''));
  if (!files.length) { toast('No images or PDFs found'); return; }
  const inVault = !!(o.vault || (o.target && o.target.vault));
  if (inVault && !vault.key) { toast('Unlock the vault first'); return; }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if (curScreen === 'editor') await persistEditor(true);
  const doc = o.target || newDoc(inVault), isNew = !o.target, first = doc.pages.length;
  let ok = 0;
  try {
    for (let i = 0; i < files.length; i++) {
      const label = files.length > 1 ? ' (file ' + (i + 1) + ' of ' + files.length + ')' : '';
      busy('Importing' + label + '...'); await tick();
      try {
        if (isPdf(files[i])) {
          ok += await importPdf(files[i], doc, m => busy(m + label));
          if (isNew && files.length === 1) doc.title = (files[i].name || 'Document').replace(/\.pdf$/i, '').slice(0, 80);
        } else {
          const id = uid();
          await Store.putImg(doc, id, await normalizeImage(files[i]));
          const page = newPage(id); doc.pages.push(page); ok++;
          try { page.thumb = await makeThumb(doc, page); } catch (e) {}
        }
      } catch (e) {
        toast(/password/i.test(e && e.message) ? 'That PDF is password protected' : 'Could not read ' + (files[i].name || 'a file'));
      }
    }
    if (ok) {
      if (isNew && doc.tags && !inVault && o.from === 'share') doc.tags.push('Shared');
      await Store.save(doc);
      if (inVault && isNew) vault.items.unshift(doc);
    }
  } finally { busy(false); }
  if (!ok) return;
  curDoc = doc;
  toast('Imported ' + plural(ok, 'page', 'pages'));
  const rep = curScreen === 'scan' || curScreen === 'editor';
  if (inVault) { go('vitem', rep); return; }
  if (o.ocr) { openOcr(doc, { auto: true, replace: rep }); return; }
  openEditor(doc, first, ok === 1 ? 'crop' : 'pages', { replace: rep, from: 'import' });
  if (o.send) openExport({ doc });
}

/* ============ send (export) ============ */
const FORMATS = [['pdf', 'PDF'], ['jpg', 'JPEG'], ['png', 'PNG'], ['txt', 'TXT']];
function overlayFor(doc, page) {
  if (!ex || !ex.safe) return null;
  const s = doc.safe;
  return { redact: (s.redact && s.redact[page.id]) || [], stamp: s.stamp ? E.stampText(s.purpose) : '' };
}
function openExport(o = {}) {
  const doc = o.doc || curDoc; if (!doc) return;
  ex = { under: curScreen, doc, fmt: o.fmt || 'pdf', target: S.target || 0, q: Math.round(S.quality * 100), token: 0, files: null, safe: !!o.safe };
  buildExport();
  nav('export');
  prepare();
}
function buildExport() {
  const d = ex.doc, big = ex.fmt === 'pdf' || ex.fmt === 'jpg', known = CFG.targets.some(t => t.kb === ex.target);
  $('#xTitle').textContent = ex.safe ? 'Share-safe copy' : 'Export document';
  $('#xFmt').innerHTML = FORMATS.map(f => '<button class="chip' + (ex.fmt === f[0] ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + '</button>').join('');
  $('#xSizeWrap').style.display = big ? '' : 'none';
  $('#xSize').innerHTML = CFG.targets.map(t => '<button class="chip' + (ex.target === t.kb ? ' on' : '') + '" data-k="' + t.kb + '">' + t.label + '</button>').join('') +
    '<button class="chip' + (!known ? ' on' : '') + '" data-k="custom">' + (known ? 'Custom...' : ex.target + ' KB') + '</button>';
  $('#xQRow').style.display = big && !ex.target ? '' : 'none';
  $('#xQ').value = ex.q; $('#xQv').textContent = ex.q + '%';
  $('#xPageRow').style.display = ex.fmt === 'txt' ? 'none' : '';
  $('#xSize2').innerHTML = Object.keys(CFG.pageSizes).map(k => '<option value="' + k + '"' + (d.pageSize === k ? ' selected' : '') + '>' + CFG.pageSizes[k].name.split(' (')[0] + '</option>').join('');
  $('#xFit').value = d.fit;
  const ov = ex.safe ? (Object.values(d.safe.redact || {}).reduce((n, a) => n + a.length, 0)) : 0;
  $('#xPrivacy').textContent = ex.safe
    ? 'No watermark. Location and camera details removed. ' + (ov ? plural(ov, 'box', 'boxes') + ' redacted. ' : 'Nothing redacted. ') + (d.safe.stamp ? 'Purpose stamp added.' : 'No stamp.')
    : d.vault ? 'Original copy: not redacted and not stamped. Location and camera details removed.' : 'No watermark. Location and camera details removed.';
}
$('#xFmt').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; ex.fmt = b.dataset.f; buildExport(); prepare(); });
$('#xSize').addEventListener('click', async e => {
  const b = e.target.closest('[data-k]'); if (!b) return;
  if (b.dataset.k === 'custom') {
    const r = await ask({ title: 'Largest file size', message: 'Pages are shrunk until the file fits.', fields: [{ name: 'kb', label: 'Size in KB', type: 'number', value: ex.target || 300 }], ok: 'Use this size',
      validate: v => (parseInt(v.kb, 10) >= 20 ? '' : 'Enter 20 or more.') });
    if (!r) return; ex.target = parseInt(r.kb, 10);
  } else ex.target = +b.dataset.k;
  S.target = ex.target; saveS(); buildExport(); prepare();
});
let qTimer;
$('#xQ').addEventListener('input', e => { ex.q = +e.target.value; $('#xQv').textContent = ex.q + '%'; clearTimeout(qTimer); qTimer = setTimeout(prepare, 500); });
$('#xSize2').addEventListener('change', async e => { ex.doc.pageSize = e.target.value; await Store.save(ex.doc); prepare(); });
$('#xFit').addEventListener('change', async e => { ex.doc.fit = e.target.value; await Store.save(ex.doc); prepare(); });
$('#xClose').onclick = () => history.back();

async function prepare() {
  const my = ++ex.token, doc = ex.doc, status = $('#xStatus');
  $('#xSend').disabled = true; $('#xSave').disabled = true; ex.files = null;
  status.className = 'status'; status.textContent = 'Preparing...';
  const mine = () => ex && ex.token === my && curScreen === 'export';
  const base = safeName(doc.title) + (ex.safe ? '-safe' : '');
  try {
    if (ex.fmt === 'txt') {
      const t = docText(doc);
      if (!t.trim()) {
        status.className = 'status warn';
        status.innerHTML = 'No text yet. <button class="linkbtn" id="xOcr">Recognize text now</button>';
        $('#xOcr').onclick = () => { history.back(); setTimeout(() => openOcr(doc, { auto: true }), 80); };
        return;
      }
      ex.files = [new File([t], base + '.txt', { type: 'text/plain' })];
      status.className = 'status ok'; status.textContent = 'Text ready: ' + plural(t.split(/\s+/).filter(Boolean).length, 'word', 'words') + ', ' + fmtSize(ex.files[0].size);
      $('#xSend').disabled = false; $('#xSave').disabled = false; return;
    }
    const rendered = [];
    for (let i = 0; i < doc.pages.length; i++) {
      status.textContent = 'Rendering page ' + (i + 1) + ' of ' + doc.pages.length + '...';
      await tick(); if (!mine()) return;
      const src = await getWork(doc, doc.pages[i], Infinity);
      rendered.push(E.renderPage(doc, doc.pages[i], src, S.dpi, null, overlayFor(doc, doc.pages[i])));
    }
    const dims = [];
    const enc = async (scale, q, type) => {
      const blobs = []; dims.length = 0;
      for (const r of rendered) {
        let c = r.canvas;
        if (scale < 1) { c = mk(Math.max(1, Math.round(c.width * scale)), Math.max(1, Math.round(c.height * scale))); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(r.canvas, 0, 0, c.width, c.height); }
        dims.push({ w: c.width, h: c.height });
        blobs.push(await toBlob(c, type || 'image/jpeg', q)); await tick();
        if (!mine()) throw 'stale';
      }
      return blobs;
    };
    const files = []; let reached = true, msgExtra = '';
    if (ex.fmt === 'png') {
      status.textContent = 'Encoding...';
      (await enc(1, 1, 'image/png')).forEach((b, i, a) => files.push(new File([b], base + (a.length > 1 ? '-' + (i + 1) : '') + '.png', { type: 'image/png' })));
      msgExtra = ' (PNG is lossless, so no size limit applies)';
    } else {
      const overhead = ex.fmt === 'pdf' ? CFG.pdfOverhead * rendered.length : 0, limit = ex.target * 1024;
      const total = bl => bl.reduce((s, b) => s + b.size, 0) + overhead;
      let blobs, q = ex.q / 100;
      status.textContent = 'Encoding...';
      blobs = await enc(1, q);
      const setDims = sc => { dims.length = 0; rendered.forEach(r => dims.push({ w: Math.max(1, Math.round(r.canvas.width * sc)), h: Math.max(1, Math.round(r.canvas.height * sc)) })); };
      if (ex.target && total(blobs) > limit) {
        reached = false;
        for (let si = 0; si < CFG.targetScales.length; si++) {
          const sc = CFG.targetScales[si], last = si === CFG.targetScales.length - 1;
          status.textContent = 'Shrinking to ' + fmtSize(limit) + ' (try ' + (si + 1) + ')...';
          let lo = CFG.targetMinQ, b = await enc(sc, lo);
          if (total(b) > limit) { if (!last) continue; blobs = b; setDims(sc); break; }
          let best = b, hi = CFG.targetMaxQ;
          for (let k = 0; k < 5; k++) { const mid = (lo + hi) / 2, t = await enc(sc, mid); if (total(t) <= limit) { best = t; lo = mid; } else hi = mid; }
          blobs = best; reached = true; setDims(sc); break;
        }
      }
      if (ex.fmt === 'pdf') {
        const pages = [];
        for (let i = 0; i < blobs.length; i++) pages.push({ jpeg: new Uint8Array(await blobs[i].arrayBuffer()), w: dims[i].w, h: dims[i].h, wPt: rendered[i].L.pw / S.dpi * 72, hPt: rendered[i].L.ph / S.dpi * 72 });
        files.push(new File([E.buildPdf(pages, doc.title)], base + '.pdf', { type: 'application/pdf' }));
      } else blobs.forEach((b, i) => files.push(new File([b], base + (blobs.length > 1 ? '-' + (i + 1) : '') + '.jpg', { type: 'image/jpeg' })));
      if (ex.target) msgExtra = reached ? ' (limit ' + fmtSize(limit) + ')' : '. Could not get under ' + fmtSize(limit) + ' and stay readable; this is the smallest it goes';
    }
    if (!mine()) return;
    ex.files = files;
    const size = files.reduce((s, f) => s + f.size, 0), what = ex.fmt === 'pdf' ? 'PDF' : plural(files.length, ex.fmt.toUpperCase() + ' file', ex.fmt.toUpperCase() + ' files');
    status.className = 'status ' + (reached ? 'ok' : 'warn');
    status.textContent = what + ' ready: ' + plural(doc.pages.length, 'page', 'pages') + ', ' + fmtSize(size) + msgExtra;
    $('#xSend').disabled = false; $('#xSave').disabled = false;
  } catch (e) {
    if (e === 'stale') return;
    status.className = 'status warn'; status.textContent = 'Could not prepare: ' + (e && e.message ? e.message : e);
  }
}
function download(files) {
  files.forEach((f, i) => setTimeout(() => {
    const a = document.createElement('a'), u = URL.createObjectURL(f);
    a.href = u; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 20000);
  }, i * 400));
}
// try the Android share sheet, else save
async function deliver(files, title) {
  if (typeof suspendLock === 'function') suspendLock(180000);
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, title }); return true; }
    catch (e) { if (e.name !== 'AbortError') toast('Sharing failed: ' + e.message + '. Use Save to phone.'); return false; }
  }
  toast('Sharing files is not supported here. Saved instead.'); download(files); return true;
}
$('#xSend').onclick = async () => {
  if (!ex || !ex.files) return;
  const d = ex.doc, noOverlay = ex.fmt !== 'txt' && d.vault && !(ex.safe && (d.safe.stamp || Object.values(d.safe.redact || {}).some(a => a.length)));
  if (noOverlay && !await ask({ title: 'Send without redaction?', message: 'This copy of a vault document has no redaction and no purpose stamp. Anyone who receives it can use it freely.', ok: 'Send anyway', danger: true })) return;
  deliver(ex.files, d.title);
};
$('#xSave').onclick = () => { if (ex && ex.files) { download(ex.files); toast('Saved ' + plural(ex.files.length, 'file', 'files')); } };

/* ============ settings ============ */
async function renderSettings() {
  const opt = (map, cur) => Object.keys(map).map(k => '<option value="' + k + '"' + (String(k) === String(cur) ? ' selected' : '') + '>' + esc(map[k]) + '</option>').join('');
  const sizes = {}; Object.keys(CFG.pageSizes).forEach(k => sizes[k] = CFG.pageSizes[k].name.split(' (')[0]);
  const dpis = {}; CFG.dpiChoices.forEach(d => dpis[d] = d + ' dpi' + (d === 150 ? ' (standard)' : d >= 300 ? ' (large files)' : ''));
  const locks = {}; CFG.lockChoices.forEach(m => locks[m] = m + (m === 1 ? ' minute' : ' minutes'));
  const sw = { linen: ['#f9faf6', '#0f6157'], carbon: ['#111722', '#93c3ff'], studio: ['#f5f3f9', '#684fbd'] };
  $('#sBody').innerHTML =
    '<div class="hdr"><div><div class="eyebrow">Preferences and safety</div><div class="h1">Settings</div></div><span class="pill">OFFLINE FIRST</span></div>' +
    '<div class="sec-title">Appearance</div><div class="themes">' + Object.keys(CFG.themes).map(k =>
      '<button data-theme="' + k + '" class="' + (S.theme === k ? 'on' : '') + '"><i style="background:linear-gradient(90deg,' + sw[k][0] + ' 50%,' + sw[k][1] + ' 50%);border:1px solid #0002"></i>' + CFG.themes[k] + '</button>').join('') + '</div>' +
    '<div class="sec-title">Scanning defaults</div><div class="card">' +
    '<div class="setrow"><div><strong>Page size</strong><p>Default for new documents</p></div><select data-s="pageSize">' + opt(sizes, S.pageSize) + '</select></div>' +
    '<div class="setrow"><div><strong>Placement</strong><p>How the scan sits on the page</p></div><select data-s="fit">' + opt({ fit: 'Fit', fill: 'Fill', stretch: 'Stretch' }, S.fit) + '</select></div>' +
    '<div class="setrow"><div><strong>Default cleanup</strong><p>Non-destructive image processing</p></div><select data-s="preset">' + opt(CFG.presetNames, S.preset) + '</select></div>' +
    '<div class="setrow"><div><strong>PDF resolution</strong><p>Higher is sharper and larger</p></div><select data-s="dpi">' + opt(dpis, S.dpi) + '</select></div>' +
    '<div class="setrow"><div><strong>JPEG quality</strong><p id="qNow">Current: ' + Math.round(S.quality * 100) + '%</p></div><input type="range" data-s="quality" min="50" max="95" value="' + Math.round(S.quality * 100) + '" style="width:140px" aria-label="JPEG quality"></div></div>' +
    '<div class="sec-title">Private vault</div><div class="card">' +
    '<div class="setrow"><div><strong>Auto-lock</strong><p>Lock after being idle</p></div><select data-s="lockMinutes">' + opt(locks, S.lockMinutes) + '</select></div>' +
    '<div class="setrow"><div><strong>Lock when backgrounded</strong><p>Lock as soon as you leave the app</p></div><button class="switch' + (S.lockOnHide ? ' on' : '') + '" data-sw="lockOnHide" aria-label="Lock when backgrounded"></button></div>' +
    '<div class="setrow"><div><strong>Change passphrase</strong><p>Use a long unique passphrase</p></div><button class="sendbtn" data-act="passphrase" aria-label="Change passphrase">' + ic('chevron') + '</button></div></div>' +
    '<div class="sec-title">Storage and backup</div><div class="card">' +
    '<div class="setrow"><div style="flex:1"><strong>Used storage</strong><p id="stInfo">Checking...</p><div class="bar"><span id="stBar"></span></div></div></div>' +
    '<div class="setrow"><div><strong>Keep my data safe</strong><p id="stPersist">Ask the browser not to clear it</p></div><button class="btn sm" data-act="persist">Request</button></div>' +
    '<div class="setrow"><div><strong>Encrypted backup</strong><p>Library and vault, one file</p></div><button class="btn sm" data-act="backupAll">Back up</button></div>' +
    '<div class="setrow"><div><strong>Vault only</strong><p>Already encrypted, no extra passphrase</p></div><button class="btn sm" data-act="backupVault">Back up</button></div>' +
    '<div class="setrow"><div><strong>Restore from backup</strong><p>Fresh install or a new phone</p></div><button class="btn sm" data-act="restore">Restore</button></div>' +
    '<div class="setrow"><div><strong>Delete all data</strong><p>Documents, vault and backups on this phone</p></div><button class="btn sm danger" data-act="wipe">Delete</button></div></div>' +
    '<div class="sec-title">Google Drive</div><div class="card pad"><p class="sub" style="margin:0">Tap Send, then pick Drive in the phone share sheet. Direct sign-in is planned for later.</p></div>' +
    '<div class="sec-title">About</div><div class="card pad"><div style="font-weight:700">ScanDoc build ' + CFG.build + '</div>' +
    '<p class="sub" style="margin:4px 0 8px">Everything stays on this phone. No accounts, no ads, no tracking, no watermark.</p>' +
    '<details><summary class="linkbtn">Licenses</summary><p class="sub" style="margin-top:8px">Tesseract OCR and Tesseract.js (Apache 2.0), English model from tessdata (Apache 2.0), PDF.js (Apache 2.0). Files are in the lib folder with their licenses. The scanner, PDF writer and vault code are our own.</p></details>' +
    '<details><summary class="linkbtn">Privacy</summary><p class="sub" style="margin-top:8px">Documents are kept only in this browser\'s storage. Vault documents are encrypted with a key made from your passphrase, which is never stored. The website host may keep normal server logs (such as IP addresses) when the app is loaded.</p></details></div>';
  updateStorage();
}
async function updateStorage() {
  const el = $('#stInfo'); if (!el) return;
  const n = (await dbAll('docs')).length, nv = (await dbAll('vault')).length;
  let t = plural(n, 'document', 'documents') + (nv ? ' + ' + plural(nv, 'vault item', 'vault items') : '');
  try {
    const e = await navigator.storage.estimate();
    t += ' \u00b7 ' + fmtSize(e.usage || 0) + (e.quota ? ' of ' + fmtSize(e.quota) : '');
    $('#stBar').style.width = Math.max(1, Math.min(100, (e.usage || 0) / (e.quota || 1) * 100)) + '%';
    if (navigator.storage.persisted) $('#stPersist').textContent = (await navigator.storage.persisted()) ? 'Persistent storage is on' : 'Not persistent yet. Installing the app helps.';
  } catch (e) {}
  el.textContent = t;
}
$('#sBody').addEventListener('input', e => {
  const k = e.target.dataset.s; if (!k) return;
  if (k === 'quality') { S.quality = +e.target.value / 100; $('#qNow').textContent = 'Current: ' + e.target.value + '%'; }
  else S[k] = ['dpi', 'lockMinutes'].includes(k) ? +e.target.value : e.target.value;
  saveS(); if (k === 'lockMinutes' && typeof bumpIdle === 'function') bumpIdle();
});
$('#sBody').addEventListener('click', async e => {
  const t = e.target.closest('[data-theme]'), s = e.target.closest('[data-sw]'), a = e.target.closest('[data-act]');
  if (t) { S.theme = t.dataset.theme; saveS(); applyTheme(); renderSettings(); }
  else if (s) { S[s.dataset.sw] = !S[s.dataset.sw]; saveS(); s.classList.toggle('on', S[s.dataset.sw]); }
  else if (a) {
    const act = a.dataset.act;
    if (act === 'persist') { const ok = navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; toast(ok ? 'Storage is now persistent' : 'The browser did not grant it yet. Installing the app helps.'); updateStorage(); }
    else if (act === 'passphrase') changePassphrase();
    else if (act === 'backupAll') backupAll();
    else if (act === 'backupVault') backupVault();
    else if (act === 'restore') restoreBackup();
    else if (act === 'wipe') wipeAll();
  }
});

/* ============ start ============ */
async function start() {
  applyTheme();
  try { await openDb(); } catch (e) { toast('Storage is not available in this browser', 8000); return; }
  await loadVaultMeta();
  history.replaceState({ s: 'home' }, '');
  goTo('home');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const q = new URLSearchParams(location.search);
  if (q.has('shared')) {
    const files = [];
    try {
      const c = await caches.open('scandoc-share');
      const keys = (await c.keys()).sort((a, b) => a.url.localeCompare(b.url, undefined, { numeric: true }));
      for (const k of keys) { const r = await c.match(k), b = await r.blob(); files.push(new File([b], decodeURIComponent(k.url.split('/').pop()), { type: b.type })); await c.delete(k); }
    } catch (e) {}
    history.replaceState({ s: 'home' }, '', location.pathname);
    if (files.length) importFiles(files, { from: 'share' }); else toast('Nothing was received');
  }
}
