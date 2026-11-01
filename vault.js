'use strict';
/* ScanDoc vault (encrypted documents), backups and restore. Crypto itself is in engine.js. */

const vault = { meta: null, key: null, items: [], cat: 'All' };
let suspendUntil = 0, idleTimer = null, viIdx = 0, viSave;

async function loadVaultMeta() { vault.meta = (await dbGet('meta', 'vault')) || null; }

/* ---- locking ---- */
const suspendLock = ms => { suspendUntil = Date.now() + ms; };   // a picker or share sheet is open, so do not lock on "background"
function bumpIdle() { clearTimeout(idleTimer); if (vault.key) idleTimer = setTimeout(() => lockVault('idle'), S.lockMinutes * 60000); }
['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { if (vault.key) bumpIdle(); }, { passive: true }));
document.addEventListener('visibilitychange', () => { if (document.hidden && vault.key && S.lockOnHide && Date.now() > suspendUntil) lockVault('background'); });

function lockVault(why) {
  if (!vault.key) return;
  const inUi = ['vault', 'vitem'].includes(curScreen) || (curDoc && curDoc.vault) || (cam && cam.vault && curScreen === 'scan') || (ex && ex.doc.vault && curScreen === 'export');
  vault.key = null; vault.items = []; clearTimeout(idleTimer); workCache.clear();
  if (ed && ed.doc.vault) ed = null;
  if (sf && sf.doc.vault) sf = null;
  if (oc && oc.doc.vault) { oc.cancel = true; oc = null; }
  if (ex && ex.doc.vault) ex = null;
  if (curDoc && curDoc.vault) curDoc = null;
  if (cam && cam.vault) { stopCamera(); cam = null; }
  busy(false); if (sheetOpen) closeSheets(); if (modalDone) modalDone();
  if (inUi) { history.replaceState({ s: 'vault' }, ''); goTo('vault'); }
  toast(why === 'idle' ? 'Vault locked after being idle' : why === 'background' ? 'Vault locked' : 'Vault locked');
}

/* ---- vault screen ---- */
function renderVault() {
  const b = $('#vBody');
  if (!vault.meta) renderSetup(b); else if (!vault.key) renderLocked(b); else renderList(b);
}
const vHead = (sub, right) => '<div class="hdr"><div><div class="eyebrow">' + sub + '</div><div class="h1">My vault</div></div>' + (right || '') + '</div>';
function renderSetup(b) {
  b.innerHTML = vHead('Separate private space') +
    '<div class="vhero"><div class="lk">' + ic('lock') + '</div><h2>Create your vault</h2><p>Protect IDs, passports, permits and essential records with encryption.</p></div>' +
    '<div class="field"><label for="vpA">Passphrase</label><input id="vpA" type="password" autocomplete="new-password" placeholder="At least ' + CFG.minPassphrase + ' characters"></div>' +
    '<div class="field"><label for="vpB">Repeat passphrase</label><input id="vpB" type="password" autocomplete="new-password"></div>' +
    '<div class="notice warn">' + ic('info') + '<span><b>There is no reset.</b> If you forget this passphrase, the vault cannot be opened by anyone, including us. Make an encrypted backup and keep the passphrase somewhere safe.</span></div>' +
    '<label class="row" style="gap:10px;align-items:flex-start;margin:10px 0"><input type="checkbox" id="vpOk" style="width:22px;height:22px;margin:0;flex:none"><span style="font-size:.88rem">I understand a forgotten passphrase means lost vault data.</span></label>' +
    '<button class="btn primary full" id="vCreate">' + ic('lock') + 'Create vault</button>' +
    '<p class="foot-note"><button class="linkbtn" id="vRestore">Restore a vault from a backup file</button></p>';
}
function renderLocked(b) {
  b.innerHTML = vHead('Separate private space') +
    '<div class="vhero"><div class="lk">' + ic('lock') + '</div><h2>Only for your eyes</h2><p>Your documents are encrypted on this phone. Enter your passphrase to open them.</p></div>' +
    '<div class="field"><label for="vpU">Passphrase</label><input id="vpU" type="password" autocomplete="current-password" placeholder="Enter your passphrase"></div>' +
    '<button class="btn primary full" id="vUnlock">' + ic('unlock') + 'Unlock vault</button>' +
    '<div class="notice" style="margin-top:16px">' + ic('shield') + '<span>A forgotten passphrase means unrecoverable data. Keep an encrypted backup (Settings, Storage and backup).</span></div>' +
    '<p class="foot-note"><button class="linkbtn" id="vRestore">Restore a vault from a backup file</button></p>';
}
function expInfo(d) {
  if (!d.expiry) return null;
  const t = new Date(d.expiry + 'T00:00:00'), days = Math.round((t - new Date(new Date().toDateString())) / 86400000), when = fmtDate(t);
  return days < 0 ? { cls: 'over', text: 'Expired ' + when } : days <= CFG.expirySoonDays ? { cls: 'soon', text: 'Expires ' + when + ' (' + days + (days === 1 ? ' day)' : ' days)') } : { cls: '', text: 'Expires ' + when };
}
function renderList(b) {
  const cats = ['All'].concat(CFG.vaultCategories), items = vault.items.filter(d => vault.cat === 'All' || d.category === vault.cat);
  b.innerHTML = vHead('Private space &middot; unlocked', '<button class="iconbtn" id="vLock" aria-label="Lock vault">' + ic('lock') + '</button>') +
    '<div class="pillrow">' + cats.map(c => '<button class="fpill' + (vault.cat === c ? ' on' : '') + '" data-c="' + c + '">' + c + '</button>').join('') + '</div>' +
    (items.length ? items.map(d => {
      const e = expInfo(d), t = d.pages[0] && d.pages[0].thumb;
      return '<button class="vitem" data-id="' + d.id + '"><span class="vv">' + (t ? '<img alt="" src="' + t + '">' : ic('shield')) + '</span><span style="flex:1;min-width:0"><div class="vt">' + esc(d.title) + '</div><div class="vs">' +
        esc(d.category) + ' &middot; ' + plural(d.pages.length, 'page', 'pages') + '</div>' + (e ? '<span class="exp ' + e.cls + '">' + esc(e.text) + '</span>' : '') + '</span>' + ic('chevron') + '</button>';
    }).join('') : '<div class="empty">' + (vault.items.length ? 'Nothing in this category.' : 'Your vault is empty.<br>Add an ID, passport or permit.') + '</div>') +
    '<button class="btn full" id="vAdd" style="margin-top:6px">' + ic('plus') + 'Add secure document</button>' +
    '<button class="btn full" id="vBackup" style="margin-top:10px">' + ic('download') + 'Back up encrypted vault</button>' +
    '<p class="foot-note">Locks after ' + S.lockMinutes + (S.lockMinutes === 1 ? ' minute' : ' minutes') + ' idle' + (S.lockOnHide ? ' or when you leave the app' : '') + '.</p>';
}
$('#vBody').addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.id === 'vCreate') {
    const a = $('#vpA').value, b2 = $('#vpB').value;
    if (a.length < CFG.minPassphrase) { toast('Use at least ' + CFG.minPassphrase + ' characters'); return; }
    if (a !== b2) { toast('The two passphrases are different'); return; }
    if (!$('#vpOk').checked) { toast('Tick the box to confirm you understand'); return; }
    busy('Creating vault...'); await tick();
    try {
      const r = await E.createVault(a, CFG.kdfIterations);
      vault.meta = Object.assign({ id: 'vault' }, r.meta); await dbPut('meta', vault.meta);
      vault.key = r.key; vault.items = []; vault.cat = 'All'; bumpIdle();
    } finally { busy(false); }
    toast('Vault created. Make a backup soon.'); renderVault();
  } else if (t.id === 'vUnlock') unlockNow();
  else if (t.id === 'vLock') lockVault('manual');
  else if (t.id === 'vRestore') restoreBackup();
  else if (t.id === 'vBackup') backupVault();
  else if (t.id === 'vAdd') menu([{ label: 'Camera', icon: 'camera', run: () => openScan({ vault: true }) }, { label: 'Gallery or PDF', icon: 'gallery', run: () => pick($('#inGal'), { vault: true }) }]);
  else if (t.dataset.c) { vault.cat = t.dataset.c; renderVault(); }
  else if (t.dataset.id) { curDoc = vault.items.find(d => d.id === t.dataset.id); viIdx = 0; if (curDoc) nav('vitem'); }
});
$('#vBody').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'vpU') unlockNow(); });
async function unlockNow() {
  const pass = $('#vpU').value; if (!pass) { toast('Enter your passphrase'); return; }
  busy('Unlocking...'); await tick();
  let key = null;
  try {
    key = await E.unlockVault(vault.meta, pass);
    if (key) {
      const items = [];
      for (const r of await dbAll('vault')) { try { items.push(normDoc(await E.openJSON(key, new Uint8Array(await r.blob.arrayBuffer())))); } catch (e) {} }
      vault.items = items.sort((a, b) => b.modified - a.modified);
    }
  } finally { busy(false); }
  if (!key) { $('#vpU').value = ''; toast('That passphrase is not right'); return; }
  vault.key = key; vault.cat = 'All'; bumpIdle(); renderVault();
}

/* ---- vault item screen ---- */
function renderVitem() {
  const d = curDoc, b = $('#viBody');
  if (!d || !d.vault || !vault.key) { goTo('vault'); return; }
  viIdx = clamp(viIdx, 0, d.pages.length - 1);
  const p = d.pages[viIdx], e = expInfo(d);
  b.innerHTML = '<div class="hdr slim"><button class="back" id="viBack">' + ic('back') + 'My vault</button><button class="iconbtn" id="viLock" aria-label="Lock vault">' + ic('lock') + '</button></div>' +
    '<div class="secure-label">' + ic('shield') + 'Private document</div>' +
    '<div class="field"><label for="viTitle">Name</label><input id="viTitle" value="' + esc(d.title) + '" maxlength="80"></div>' +
    '<div class="vprev">' + (p.thumb ? '<img alt="Page ' + (viIdx + 1) + '" src="' + p.thumb + '">' : '') +
    '<div class="row between pager2"><button id="viPrev" aria-label="Previous page"' + (viIdx === 0 ? ' disabled' : '') + '>&#8249;</button><span>' + (d.pages.length > 1 ? (viIdx === 0 ? 'Front' : viIdx === 1 ? 'Back' : 'Page ' + (viIdx + 1)) + ' &middot; ' : '') + 'page ' + (viIdx + 1) + ' of ' + d.pages.length + '</span><button id="viNext" aria-label="Next page"' + (viIdx >= d.pages.length - 1 ? ' disabled' : '') + '>&#8250;</button></div></div>' +
    '<div class="row two"><div class="field" style="margin:0"><label for="viCat">Category</label><select id="viCat">' + CFG.vaultCategories.map(c => '<option' + (c === d.category ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></div>' +
    '<div class="field" style="margin:0"><label for="viExp">Expiry date</label><input id="viExp" type="date" value="' + esc(d.expiry || '') + '"></div></div>' +
    (e ? '<span class="exp ' + e.cls + '" style="margin-top:8px">' + esc(e.text) + '</span>' : '') +
    '<div class="field"><label for="viNotes">Notes</label><textarea id="viNotes" placeholder="Document number, where the original is kept...">' + esc(d.notes || '') + '</textarea></div>' +
    '<button class="btn primary full" id="viSafe">' + ic('redact') + 'Share-safe copy</button>' +
    '<div class="row two" style="margin-top:10px"><button class="btn" id="viEdit">' + ic('crop') + 'Edit pages</button><button class="btn" id="viAdd">' + ic('plus') + 'Add page</button></div>' +
    '<div class="row two" style="margin-top:10px"><button class="btn" id="viSend">' + ic('send') + 'Send original</button><button class="btn danger" id="viDel">' + ic('trash') + 'Delete</button></div>' +
    '<p class="foot-note">Pages are encrypted on this phone. Thumbnails are only drawn while the vault is unlocked.</p>';
}
function saveVitemSoon() { clearTimeout(viSave); const d = curDoc; viSave = setTimeout(() => { if (d && vault.key) Store.save(d).catch(() => {}); }, 500); }
$('#viBody').addEventListener('input', e => {
  const d = curDoc; if (!d) return;
  if (e.target.id === 'viTitle') d.title = e.target.value.slice(0, 80) || d.title;
  else if (e.target.id === 'viCat') d.category = e.target.value;
  else if (e.target.id === 'viExp') { d.expiry = e.target.value; }
  else if (e.target.id === 'viNotes') d.notes = e.target.value;
  else return;
  saveVitemSoon();
});
$('#viBody').addEventListener('change', e => { if (e.target.id === 'viExp') renderVitem(); });
$('#viBody').addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t || !curDoc) return;
  const d = curDoc;
  if (t.id === 'viBack') { await Store.save(d); history.back(); }
  else if (t.id === 'viLock') lockVault('manual');
  else if (t.id === 'viPrev') { viIdx--; renderVitem(); }
  else if (t.id === 'viNext') { viIdx++; renderVitem(); }
  else if (t.id === 'viEdit') { await Store.save(d); openEditor(d, viIdx, 'crop', { from: 'vault' }); }
  else if (t.id === 'viSafe') { await Store.save(d); openSafe(d); }
  else if (t.id === 'viSend') { await Store.save(d); openExport({ doc: d }); }
  else if (t.id === 'viAdd') menu([{ label: 'Camera', icon: 'camera', run: () => openScan({ target: d, vault: true }) }, { label: 'Gallery or PDF', icon: 'gallery', run: () => pick($('#inGal'), { target: d, vault: true }) }]);
  else if (t.id === 'viDel') {
    if (!await ask({ title: 'Delete "' + d.title + '"?', message: 'This removes the encrypted document from this phone. A backup is the only way to get it back.', ok: 'Delete', danger: true })) return;
    clearTimeout(viSave); await Store.remove(d); vault.items = vault.items.filter(x => x.id !== d.id); curDoc = null; toast('Deleted'); history.back();
  }
});

// editor menu: move a normal document into the vault
async function moveToVault(doc) {
  if (!vault.meta) { toast('Create the vault first'); navTab('vault'); return; }
  if (!vault.key) { toast('Unlock the vault first'); navTab('vault'); return; }
  if (!await ask({ title: 'Move to vault?', message: 'The document is encrypted and removed from your library. It will no longer show in search.', ok: 'Move to vault' })) return;
  busy('Moving to vault...');
  try {
    await persistEditor(true);
    const ids = [...new Set(doc.pages.map(p => p.img))];
    for (const id of ids) { const r = await dbGet('images', id); await dbPut('vimages', { id, blob: new Blob([await E.seal(vault.key, new Uint8Array(await r.blob.arrayBuffer()))]) }); }
    Object.assign(doc, { vault: true, category: 'Other', expiry: '', notes: '', tags: [] });
    await Store.save(doc);
    await dbDel('docs', doc.id); for (const id of ids) await dbDel('images', id);
    vault.items.unshift(doc); workCache.clear(); ed = null;
  } finally { busy(false); }
  toast('Moved to vault'); curDoc = doc; viIdx = 0; go('vitem', true);
}

/* ============ backup and restore ============ */
const stamp = () => new Date().toISOString().slice(0, 10);
function backupResult(file, line) {
  openSheet('#sheet2',
    '<div class="row between"><strong style="font-size:1.1rem">Backup ready</strong><button class="iconbtn" id="bkClose" aria-label="Close">' + ic('close') + '</button></div>' +
    '<div class="status ok">' + esc(line) + ' &middot; ' + fmtSize(file.size) + '</div>' +
    '<p class="sub">Keep the file somewhere other than this phone (Drive, a computer, email to yourself).</p>' +
    '<div class="row"><button class="btn primary grow" id="bkSend">' + ic('send') + 'Send</button><button class="btn grow" id="bkSave">' + ic('download') + 'Save to phone</button></div>',
    e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'bkClose') closeSheets(); else if (b.id === 'bkSave') { download([file]); toast('Saved ' + file.name); } else if (b.id === 'bkSend') deliver([file], file.name);
    });
}
async function backupAll() {
  const r = await ask({ title: 'Encrypted backup', message: 'Your library and your vault go into one file, locked with a backup passphrase. Without that passphrase the file cannot be opened.',
    fields: [{ name: 'p', label: 'Backup passphrase', type: 'password' }, { name: 'p2', label: 'Repeat passphrase', type: 'password' }], ok: 'Create backup', selectFirst: false,
    validate: v => v.p.length < CFG.minPassphrase ? 'Use at least ' + CFG.minPassphrase + ' characters.' : v.p !== v.p2 ? 'The two passphrases are different.' : '' });
  if (!r) return;
  busy('Collecting documents...'); await tick();
  try {
    const docs = await dbAll('docs'), imgs = await dbAll('images'), vrec = await dbAll('vault'), vimg = await dbAll('vimages');
    const meta = { kind: 'all', v: 1, created: Date.now(), build: CFG.build, docs, images: imgs.map(i => i.id),
      vault: vault.meta ? { meta: vault.meta, items: vrec.map(x => x.id), images: vimg.map(x => x.id) } : null };
    const blobs = imgs.map(i => i.blob).concat(vrec.map(x => x.blob), vimg.map(x => x.blob));
    busy('Encrypting ' + fmtSize(blobs.reduce((s, b) => s + b.size, 0)) + '...'); await tick();
    const file = new File([await E.encryptBackup(E.packArchive(meta, blobs), r.p, CFG.kdfIterations)], 'scandoc-backup-' + stamp() + '.scandoc', { type: 'application/octet-stream' });
    busy(false);
    backupResult(file, plural(docs.length, 'document', 'documents') + (vrec.length ? ' + ' + plural(vrec.length, 'vault item', 'vault items') : ''));
  } catch (e) { toast('Backup failed: ' + (e && e.message ? e.message : e), 6000); }
  finally { busy(false); }
}
async function backupVault() {
  if (!vault.meta) { toast('There is no vault to back up yet'); return; }
  busy('Packing vault...'); await tick();
  try {
    const vrec = await dbAll('vault'), vimg = await dbAll('vimages');
    const meta = { kind: 'vault', v: 1, created: Date.now(), build: CFG.build, vault: { meta: vault.meta, items: vrec.map(x => x.id), images: vimg.map(x => x.id) } };
    const file = new File([E.packArchive(meta, vrec.map(x => x.blob).concat(vimg.map(x => x.blob)))], 'scandoc-vault-' + stamp() + '.scandoc', { type: 'application/octet-stream' });
    busy(false); backupResult(file, plural(vrec.length, 'vault item', 'vault items') + ', already encrypted. Opens with your vault passphrase');
  } catch (e) { toast('Backup failed: ' + (e && e.message ? e.message : e), 6000); }
  finally { busy(false); }
}
function restoreBackup() { suspendLock(120000); const i = $('#inRestore'); i.value = ''; i.click(); }
$('#inRestore').addEventListener('change', e => { if (e.target.files[0]) restoreFile(e.target.files[0]); });
async function restoreFile(file) {
  busy('Reading backup...'); await tick();
  try {
    let buf = await file.arrayBuffer();
    const kind = E.sniffBackup(buf);
    if (!kind) { toast('That file is not a ScanDoc backup'); return; }
    if (kind === 'enc') {
      busy(false);
      const r = await ask({ title: 'Backup passphrase', message: 'Enter the passphrase you chose when you made this backup.', fields: [{ name: 'p', label: 'Passphrase', type: 'password' }], ok: 'Restore', selectFirst: false });
      if (!r) return;
      busy('Decrypting...'); await tick();
      buf = await E.decryptBackup(buf, r.p);
      if (!buf) { toast('Wrong passphrase, or the file is damaged', 5000); return; }
    }
    busy('Restoring...'); await tick();
    const { meta, blobs } = await E.unpackArchive(buf);
    let bi = 0, nDocs = 0, nVault = 0;
    const imgIds = meta.kind === 'all' ? meta.images : [];
    const imgBlobs = blobs.slice(bi, bi += imgIds.length);
    const vp = meta.vault || null;
    const vItems = vp ? blobs.slice(bi, bi += vp.items.length) : [], vImgs = vp ? blobs.slice(bi, bi += vp.images.length) : [];
    if (meta.kind === 'all') {
      for (const d of meta.docs) { await dbPut('docs', d); nDocs++; }
      for (let i = 0; i < imgIds.length; i++) await dbPut('images', { id: imgIds[i], blob: imgBlobs[i] });
    }
    if (vp) {
      let doIt = true;
      if (vault.meta && vault.meta.salt !== vp.meta.salt) {
        busy(false);
        doIt = !!await ask({ title: 'Replace the vault on this phone?', message: 'The backup contains a different vault. Restoring it removes the vault that is on this phone now. Cancel to keep the current vault.', ok: 'Replace vault', danger: true });
        busy('Restoring...');
        if (doIt) await tx(['vault', 'vimages', 'meta'], 'readwrite', t => ['vault', 'vimages', 'meta'].forEach(n => t.objectStore(n).clear()));
      }
      if (doIt) {
        await dbPut('meta', Object.assign({ id: 'vault' }, vp.meta));
        for (let i = 0; i < vp.items.length; i++) { await dbPut('vault', { id: vp.items[i], blob: vItems[i] }); nVault++; }
        for (let i = 0; i < vp.images.length; i++) await dbPut('vimages', { id: vp.images[i], blob: vImgs[i] });
        if (vault.key) lockVault('restore');
        vault.key = null; vault.items = []; await loadVaultMeta();
      }
    }
    busy(false);
    await ask({ title: 'Backup restored', message: (nDocs ? plural(nDocs, 'document', 'documents') + ' restored. ' : '') + (nVault ? plural(nVault, 'vault item', 'vault items') + ' restored. Unlock the vault with the passphrase it had when the backup was made.' : (vp ? '' : (nDocs ? '' : 'The backup had nothing to restore.'))), ok: 'OK', cancel: false });
    if (curScreen === 'settings') renderSettings(); else if (curScreen === 'vault') renderVault();
  } catch (e) { toast('Restore failed: ' + (e && e.message ? e.message : e), 6000); }
  finally { busy(false); }
}
async function changePassphrase() {
  if (!vault.meta) { toast('Create the vault first'); navTab('vault'); return; }
  if (!vault.key) { toast('Unlock the vault first'); navTab('vault'); return; }
  const r = await ask({ title: 'Change vault passphrase', message: 'Everything in the vault is re-encrypted with the new passphrase. Make a new backup afterwards: old backups still need the old passphrase.',
    fields: [{ name: 'p', label: 'New passphrase', type: 'password' }, { name: 'p2', label: 'Repeat new passphrase', type: 'password' }], ok: 'Change passphrase', selectFirst: false,
    validate: v => v.p.length < CFG.minPassphrase ? 'Use at least ' + CFG.minPassphrase + ' characters.' : v.p !== v.p2 ? 'The two passphrases are different.' : '' });
  if (!r) return;
  busy('Re-encrypting vault...'); await tick();
  try {
    const nv = await E.createVault(r.p, CFG.kdfIterations);
    const recs = [];
    for (const d of vault.items) recs.push({ id: d.id, blob: new Blob([await E.sealJSON(nv.key, d)]) });
    const imgs = [];
    for (const x of await dbAll('vimages')) {
      const plain = await E.open(vault.key, new Uint8Array(await x.blob.arrayBuffer()));
      imgs.push({ id: x.id, blob: new Blob([await E.seal(nv.key, plain)]) });
    }
    const meta = Object.assign({ id: 'vault' }, nv.meta);
    await tx(['vault', 'vimages', 'meta'], 'readwrite', t => { recs.forEach(x => t.objectStore('vault').put(x)); imgs.forEach(x => t.objectStore('vimages').put(x)); t.objectStore('meta').put(meta); });
    vault.key = nv.key; vault.meta = meta; bumpIdle();
    toast('Passphrase changed. Make a new backup.', 5000);
  } catch (e) { toast('Could not change the passphrase: ' + (e && e.message ? e.message : e), 6000); }
  finally { busy(false); }
}
async function wipeAll() {
  if (!await ask({ title: 'Delete all data?', message: 'Every document, the vault and all extracted text are erased from this phone. This cannot be undone. Make a backup first if you might need anything.', ok: 'Continue', danger: true })) return;
  if (!await ask({ title: 'Really delete everything?', ok: 'Delete everything', danger: true })) return;
  await dbClearAll(); workCache.clear();
  clearTimeout(idleTimer); vault.key = null; vault.meta = null; vault.items = []; curDoc = null; ed = null; sf = null; oc = null; ex = null; allDocs = [];
  toast('All data deleted'); updateStorage();
}
