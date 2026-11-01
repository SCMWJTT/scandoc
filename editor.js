'use strict';
/* ScanDoc editor (Crop, Enhance, Pages, OCR tabs), text recognition screen, share-safe copy screen. */

const SLIDERS = [['exposure', 'Exposure', -100, 100], ['brightness', 'Brightness', -100, 100], ['contrast', 'Contrast', -100, 100],
  ['sharpness', 'Sharpness', 0, 100], ['saturation', 'Color', 0, 200], ['level', 'Threshold', 60, 230]];
let saveTimer, previewQueued = false;
const curPage = () => ed.doc.pages[ed.idx];

function openEditor(doc, idx, tab, o = {}) {
  curDoc = doc;
  ed = { doc, idx: clamp(idx, 0, doc.pages.length - 1), tab: tab || 'pages', from: o.from || '', work: null, cache: {}, view: null, drag: null };
  go('editor', !!o.replace);
}
async function enterEditor() {
  if (!ed || !ed.doc || !ed.doc.pages[ed.idx]) { go('home', true); return; }
  const d = ed.doc; ed.cache = {}; ed.work = null;
  busy('Loading page...');
  try { ed.work = await getWork(d, curPage(), CFG.workSide); }
  catch (e) { busy(false); toast('Could not load that page'); history.back(); return; }
  busy(false);
  if (ed.doc !== d || (curScreen !== 'editor' && !(curScreen === 'export' && ex && ex.under === 'editor'))) return;
  $('#eName').value = d.title;
  $('#eCount').textContent = (ed.idx + 1) + ' / ' + d.pages.length + (d.pages.length === 1 ? ' PAGE' : ' PAGES');
  $('#ePrev').style.visibility = ed.idx > 0 ? 'visible' : 'hidden';
  $('#eNext').style.visibility = ed.idx < d.pages.length - 1 ? 'visible' : 'hidden';
  $('#eBackLbl').textContent = d.vault ? 'Vault' : ed.from === 'library' ? 'Library' : 'Back';
  buildEnhance(); buildPagesPane(); buildOcrPane();
  setTab(ed.tab);
}
function setTab(t) {
  ed.tab = t;
  $$('#eTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $$('.pane').forEach(p => p.classList.toggle('on', p.id === 'p-' + t));
  $('#cv').style.display = t === 'crop' ? 'block' : 'none';
  $('#pv').style.display = t === 'crop' ? 'none' : 'block';
  if (t !== 'crop') $('#loupe').style.display = 'none';
  requestAnimationFrame(() => { if (!ed || !ed.work) return; if (t === 'crop') initCrop(); else drawPreview(); });
}
$('#eTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b && ed && ed.work) setTab(b.dataset.tab); });

function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => persistEditor(false), 500); }
async function persistEditor(withThumb) {
  clearTimeout(saveTimer);
  if (!ed || !ed.work || !ed.doc) return;
  const pg = curPage(); if (!pg) return;
  if (ed.doc.vault && !vault.key) return;
  try {
    if (withThumb) { try { pg.thumb = await makeThumb(ed.doc, pg); } catch (e) {} }
    await Store.save(ed.doc);
  } catch (e) {}
}
function leaveEditor() {
  persistEditor(true).then(() => {
    if (curScreen === 'library') refreshLibrary(); else if (curScreen === 'home') renderHome(); else if (curScreen === 'vitem') renderVitem();
  });
}
async function gotoPage(i) {
  if (!ed || i < 0 || i >= ed.doc.pages.length) return;
  busy('Saving...'); await persistEditor(true); busy(false);
  ed.idx = i; enterEditor();
}
$('#eBack').onclick = () => history.back();
$('#ePrev').onclick = () => gotoPage(ed.idx - 1);
$('#eNext').onclick = () => gotoPage(ed.idx + 1);
$('#eExport').onclick = async () => { if (!ed || !ed.work) return; await persistEditor(false); openExport({ doc: ed.doc }); };
$('#eName').addEventListener('change', async e => {
  const v = e.target.value.trim(); if (!ed) return;
  if (v) ed.doc.title = v.slice(0, 80); else e.target.value = ed.doc.title;
  await Store.save(ed.doc);
});
$('#eMore').onclick = () => {
  if (!ed) return; const d = ed.doc;
  menu([{ label: 'Rename', icon: 'edit', run: () => { const i = $('#eName'); i.focus(); i.select(); } }]
    .concat(d.vault ? [] : [{ label: 'Edit tags', icon: 'tag', run: () => editTags(d) }])
    .concat([{ label: 'Share-safe copy', icon: 'redact', run: () => { persistEditor(false); openSafe(d); } }])
    .concat(d.vault ? [] : [{ label: 'Move to vault', icon: 'lock', run: () => moveToVault(d) }])
    .concat([{ label: 'Delete document', icon: 'trash', danger: true, run: () => deleteDocFlow(d) }]));
};
async function editTags(d) {
  const r = await ask({ title: 'Tags', message: 'Separate tags with commas. Tags help you find and filter documents.', fields: [{ name: 't', label: 'Tags', value: d.tags.join(', '), placeholder: 'contract, insurance' }], ok: 'Save', selectFirst: false });
  if (!r) return;
  d.tags = [...new Set(r.t.split(',').map(x => x.trim().slice(0, 24)).filter(Boolean))].slice(0, 8);
  await Store.save(d); if (curScreen === 'editor') buildPagesPane(); toast('Tags saved');
}
async function deleteDocFlow(d) {
  if (!await ask({ title: 'Delete "' + d.title + '"?', message: 'All pages and extracted text are removed from this phone.', ok: 'Delete', danger: true })) return;
  ed = null;
  await Store.remove(d);
  if (d.vault) vault.items = vault.items.filter(x => x.id !== d.id);
  curDoc = null; toast('Document deleted'); history.back();
}

/* ---- crop ---- */
function initCrop() {
  if (!ed || !ed.work) return;
  const stage = $('#stage'), cv = $('#cv'), dpr = window.devicePixelRatio || 1, pad = 20, W = ed.work.width, H = ed.work.height;
  const ds = Math.min((stage.clientWidth - pad * 2) / W, (stage.clientHeight - pad * 2) / H), iw = Math.max(40, Math.floor(W * ds)), ih = Math.max(40, Math.floor(H * ds));
  const cw = iw + pad * 2, ch = ih + pad * 2;
  cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
  const bg = mk(Math.round(iw * dpr), Math.round(ih * dpr)), bx = bg.getContext('2d');
  bx.imageSmoothingQuality = 'high'; bx.drawImage(ed.work, 0, 0, bg.width, bg.height);
  ed.view = { dpr, pad, iw, ih, ds, cw, ch, bg };
  drawCrop();
}
const cpts = () => { const v = ed.view; return curPage().corners.map(p => ({ x: v.pad + p.x * v.iw, y: v.pad + p.y * v.ih })); };
function drawCrop() {
  const v = ed && ed.view; if (!v) return;
  const x = $('#cv').getContext('2d'), P = cpts();
  x.setTransform(v.dpr, 0, 0, v.dpr, 0, 0); x.clearRect(0, 0, v.cw, v.ch);
  x.drawImage(v.bg, v.pad, v.pad, v.iw, v.ih);
  x.fillStyle = 'rgba(0,0,0,.5)'; x.beginPath(); x.rect(v.pad, v.pad, v.iw, v.ih);
  x.moveTo(P[0].x, P[0].y); for (let i = 1; i < 4; i++) x.lineTo(P[i].x, P[i].y); x.closePath(); x.fill('evenodd');
  const acc = '#ffb020';
  x.strokeStyle = acc; x.lineWidth = 2; x.beginPath(); x.moveTo(P[0].x, P[0].y); for (let i = 1; i < 4; i++) x.lineTo(P[i].x, P[i].y); x.closePath(); x.stroke();
  P.forEach(p => { x.beginPath(); x.arc(p.x, p.y, 11, 0, 7); x.fillStyle = '#fff'; x.fill(); x.lineWidth = 3; x.strokeStyle = acc; x.stroke(); });
}
function showLoupe(i) {
  const v = ed.view, L = $('#loupe'), d = 110, dpr = v.dpr, p = curPage().corners[i], work = ed.work;
  L.width = d * dpr; L.height = d * dpr; L.style.display = 'block';
  const x = L.getContext('2d'), src = d / (v.ds * 3), cx = p.x * work.width, cy = p.y * work.height;
  x.fillStyle = '#fff'; x.fillRect(0, 0, L.width, L.height);
  x.drawImage(work, cx - src / 2, cy - src / 2, src, src, 0, 0, L.width, L.height);
  x.strokeStyle = '#ff3b30'; x.lineWidth = 1.5 * dpr; x.beginPath();
  x.moveTo(L.width / 2, L.height * .3); x.lineTo(L.width / 2, L.height * .7); x.moveTo(L.width * .3, L.height / 2); x.lineTo(L.width * .7, L.height / 2); x.stroke();
  const P = cpts()[i], stage = $('#stage'), cvr = $('#cv').getBoundingClientRect(), sr = stage.getBoundingClientRect();
  const hx = P.x + cvr.left - sr.left, hy = P.y + cvr.top - sr.top;
  if (hx < stage.clientWidth / 2 && hy < 150) { L.style.left = 'auto'; L.style.right = '8px'; } else { L.style.right = 'auto'; L.style.left = '8px'; }
}
(function cropPointer() {
  const cv = $('#cv');
  cv.addEventListener('pointerdown', e => {
    if (!ed || !ed.view) return;
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, P = cpts();
    let best = -1, bd = 44;
    P.forEach((p, i) => { const d = Math.hypot(p.x - px, p.y - py); if (d < bd) { bd = d; best = i; } });
    if (best < 0) return;
    ed.drag = { i: best, ox: P[best].x - px, oy: P[best].y - py };
    cv.setPointerCapture(e.pointerId); showLoupe(best); e.preventDefault();
  });
  cv.addEventListener('pointermove', e => {
    if (!ed || !ed.drag) return;
    const v = ed.view, r = cv.getBoundingClientRect(), d = ed.drag;
    curPage().corners[d.i] = { x: clamp((e.clientX - r.left + d.ox - v.pad) / v.iw, 0, 1), y: clamp((e.clientY - r.top + d.oy - v.pad) / v.ih, 0, 1) };
    drawCrop(); showLoupe(d.i);
  });
  const end = () => { if (!ed || !ed.drag) return; ed.drag = null; $('#loupe').style.display = 'none'; scheduleSave(); };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
})();
async function rotateEditor(dir) {
  E.rotatePage(curPage(), dir); ed.cache = {};
  busy('Rotating...'); try { ed.work = await getWork(ed.doc, curPage(), CFG.workSide); } finally { busy(false); }
  if (ed.tab === 'crop') initCrop(); else drawPreview();
  scheduleSave();
}
$('#cRotL').onclick = () => rotateEditor(-1);
$('#cRotR').onclick = () => rotateEditor(1);
$('#cFull').onclick = () => { curPage().corners = fullCorners(); drawCrop(); scheduleSave(); };
$('#cReset').onclick = () => { curPage().corners = insetCorners(); drawCrop(); scheduleSave(); };
window.addEventListener('resize', () => { if (curScreen === 'editor' && ed && ed.work && ed.tab === 'crop') initCrop(); });

/* ---- preview ---- */
function drawPreview() {
  if (!ed || !ed.work) return;
  const r = E.renderPage(ed.doc, curPage(), ed.work, CFG.previewSide / E.pageLongIn(ed.doc), ed.cache), pv = $('#pv');
  if (pv.width !== r.L.pw || pv.height !== r.L.ph) { pv.width = r.L.pw; pv.height = r.L.ph; }
  pv.getContext('2d').drawImage(r.canvas, 0, 0);
  const info = $('#pgInfo'); if (info) info.textContent = 'Paper: ' + r.L.wIn.toFixed(2) + ' x ' + r.L.hIn.toFixed(2) + ' in';
}
function schedulePreview() {
  if (previewQueued) return; previewQueued = true;
  requestAnimationFrame(() => { previewQueued = false; if (curScreen === 'editor' && ed && ed.tab !== 'crop') drawPreview(); });
}

/* ---- enhance pane ---- */
function buildEnhance() {
  $('#p-enhance').innerHTML =
    '<div class="chips" id="presets">' + CFG.presetOrder.map(k => '<button class="chip" data-p="' + k + '">' + CFG.presetNames[k] + '</button>').join('') + '</div>' +
    '<div class="row two" style="margin-bottom:8px"><button class="btn sm" data-t="paperWhite">' + ic('spark') + 'Make paper white</button><button class="btn sm" id="clReset">Reset</button></div>' +
    '<div class="chips"><button class="chip" data-t="gray">Gray</button><button class="chip" data-t="bw">Black &amp; white</button></div>' +
    SLIDERS.map(s => '<label class="sl" data-row="' + s[0] + '"><span>' + s[1] + '</span><input type="range" data-k="' + s[0] + '" min="' + s[2] + '" max="' + s[3] + '" step="1"><b></b></label>').join('') +
    '<div class="row" style="margin:8px 0"><button class="btn sm" id="clAll">Apply to all pages</button></div>';
  syncEnhance();
}
function syncEnhance() {
  const c = curPage().clean;
  $$('#presets .chip').forEach(b => b.classList.toggle('on', b.dataset.p === c.preset));
  $$('#p-enhance [data-t]').forEach(b => { const on = !!c[b.dataset.t]; b.classList.toggle('on', on); if (b.classList.contains('btn')) b.classList.toggle('primary', on); });
  $$('#p-enhance input[type=range]').forEach(i => { i.value = c[i.dataset.k]; i.nextElementSibling.textContent = c[i.dataset.k]; });
  $('#p-enhance [data-row=level]').style.display = c.bw ? '' : 'none';
}
$('#p-enhance').addEventListener('click', e => {
  const pg = curPage(), t = e.target.closest('button'); if (!t) return;
  if (t.dataset.p) pg.clean = newClean(t.dataset.p);
  else if (t.dataset.t) { pg.clean[t.dataset.t] = !pg.clean[t.dataset.t]; pg.clean.preset = 'custom'; }
  else if (t.id === 'clReset') pg.clean = newClean('original');
  else if (t.id === 'clAll') { ed.doc.pages.forEach(p => { p.clean = JSON.parse(JSON.stringify(pg.clean)); }); toast('Applied to all ' + ed.doc.pages.length + ' pages'); scheduleSave(); return; }
  else return;
  syncEnhance(); schedulePreview(); scheduleSave();
});
$('#p-enhance').addEventListener('input', e => {
  const i = e.target; if (!i.dataset.k) return;
  const c = curPage().clean; c[i.dataset.k] = +i.value; c.preset = 'custom';
  i.nextElementSibling.textContent = i.value; $$('#presets .chip').forEach(b => b.classList.remove('on'));
  schedulePreview(); scheduleSave();
});

/* ---- pages pane ---- */
function buildPagesPane() {
  const d = ed.doc, n = d.pages.length;
  $('#p-pages').innerHTML =
    '<div class="pgrid">' + d.pages.map((p, i) =>
      '<div class="pcard' + (i === ed.idx ? ' cur' : '') + '" data-i="' + i + '"><button class="im" data-a="pick" aria-label="Page ' + (i + 1) + '">' + (p.thumb ? '<img alt="" src="' + p.thumb + '">' : '') + '</button>' +
      '<div class="tl"><span>' + (i + 1) + '</span>' +
      '<button data-a="left" aria-label="Move earlier"' + (i === 0 ? ' disabled' : '') + '>' + ic('back') + '</button>' +
      '<button data-a="right" aria-label="Move later"' + (i === n - 1 ? ' disabled' : '') + '>' + ic('chevron') + '</button>' +
      '<button data-a="rot" aria-label="Rotate">' + ic('rotate') + '</button>' +
      '<button data-a="dup" aria-label="Duplicate">' + ic('copy') + '</button>' +
      '<button data-a="del" aria-label="Delete page">' + ic('trash') + '</button></div></div>').join('') + '</div>' +
    '<div class="row two" style="margin-bottom:6px"><button class="btn sm" id="pgCam">' + ic('camera') + 'Camera</button><button class="btn sm" id="pgGal">' + ic('gallery') + 'Gallery / PDF</button></div>' +
    (d.vault ? '' : '<div class="row between" style="margin:6px 0"><span class="muted" style="font-size:.84rem">' + (d.tags.length ? d.tags.map(t => '#' + esc(t)).join(' ') : 'No tags') + '</span><button class="btn sm" id="pgTags">' + ic('tag') + 'Tags</button></div>') +
    '<span class="hint" style="display:block;margin-top:8px">Page setup for the whole document. <span id="pgInfo"></span></span>' +
    '<div class="row two"><div class="field" style="margin:0"><label for="pgSize">Page</label><select id="pgSize">' + Object.keys(CFG.pageSizes).map(k => '<option value="' + k + '">' + esc(CFG.pageSizes[k].name) + '</option>').join('') + '</select></div>' +
    '<div class="field" style="margin:0"><label for="pgFit">Placement</label><select id="pgFit"><option value="fit">Fit</option><option value="fill">Fill</option><option value="stretch">Stretch</option></select></div></div>' +
    '<label class="sl" style="grid-template-columns:70px 1fr 56px;margin-top:6px"><span>Margin</span><input type="range" id="pgMargin" min="0" max="1" step="0.05"><b id="pgMarginV"></b></label>';
  $('#pgSize').value = d.pageSize; $('#pgFit').value = d.fit; $('#pgMargin').value = d.margin; $('#pgMarginV').textContent = d.margin.toFixed(2) + ' in';
}
$('#p-pages').addEventListener('click', async e => {
  const d = ed.doc, id = e.target.closest('button') && e.target.closest('button').id;
  if (id === 'pgCam') { await persistEditor(false); openScan({ target: d, vault: d.vault }); return; }
  if (id === 'pgGal') { pick($('#inGal'), { target: d, vault: d.vault }); return; }
  if (id === 'pgTags') { editTags(d); return; }
  const b = e.target.closest('button[data-a]'); if (!b || b.disabled) return;
  const i = +b.closest('.pcard').dataset.i, a = b.dataset.a, cur = curPage();
  if (a === 'pick') { if (i !== ed.idx) { ed.idx = i; await persistEditor(true); enterEditor(); } return; }
  if (a === 'left' && i > 0) [d.pages[i - 1], d.pages[i]] = [d.pages[i], d.pages[i - 1]];
  else if (a === 'right' && i < d.pages.length - 1) [d.pages[i + 1], d.pages[i]] = [d.pages[i], d.pages[i + 1]];
  else if (a === 'rot') { E.rotatePage(d.pages[i], 1); try { d.pages[i].thumb = await makeThumb(d, d.pages[i]); } catch (x) {} }
  else if (a === 'dup') { const p = JSON.parse(JSON.stringify(d.pages[i])); p.id = uid(); d.pages.splice(i + 1, 0, p); }
  else if (a === 'del') {
    if (d.pages.length === 1) { toast('A document needs at least one page. Delete the document instead.'); return; }
    if (!await ask({ title: 'Delete page ' + (i + 1) + '?', ok: 'Delete', danger: true })) return;
    const [p] = d.pages.splice(i, 1);
    if (!d.pages.some(x => x.img === p.img)) await Store.delImg(d, p.img);
  }
  ed.idx = Math.max(0, d.pages.indexOf(cur)); if (ed.idx < 0 || d.pages.indexOf(cur) < 0) ed.idx = Math.min(i, d.pages.length - 1);
  await Store.save(d); enterEditor();
});
$('#p-pages').addEventListener('input', e => {
  const d = ed.doc, id = e.target.id;
  if (id === 'pgSize') d.pageSize = e.target.value;
  else if (id === 'pgFit') d.fit = e.target.value;
  else if (id === 'pgMargin') { d.margin = +e.target.value; $('#pgMarginV').textContent = d.margin.toFixed(2) + ' in'; }
  else return;
  schedulePreview(); scheduleSave();
});

/* ---- OCR tab ---- */
function buildOcrPane() {
  const d = ed.doc, have = d.pages.filter(p => (p.ocr || '').trim()).length;
  $('#p-ocr').innerHTML = '<p class="hint">' + (have ? 'Text found on ' + have + ' of ' + plural(d.pages.length, 'page', 'pages') + '.' : 'Pull the text out of this document. It runs on your phone and works offline.') + '</p>' +
    '<div class="row two"><button class="btn primary" id="ocrGo">' + ic('text') + (have ? 'Open text' : 'Extract text') + '</button>' + (have ? '<button class="btn" id="ocrAgain">Run again</button>' : '') + '</div>';
}
$('#p-ocr').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const d = ed.doc, has = d.pages.some(p => (p.ocr || '').trim());
  await persistEditor(false);
  if (b.id === 'ocrGo') openOcr(d, { auto: !has });
  else if (b.id === 'ocrAgain') openOcr(d, { auto: true, force: true });
});

/* ============ text recognition screen ============ */
let oc = null, ocrWorker = null, ocrLogger = null, ocrSave;
function openOcr(doc, o = {}) {
  curDoc = doc; oc = { doc, idx: 0, auto: !!o.auto, force: !!o.force, running: false, cancel: false };
  go('ocr', !!o.replace);
}
function enterOcr() {
  if (!oc || oc.doc !== curDoc) { go('home', true); return; }
  renderOcr();
  if (oc.auto) { oc.auto = false; runOcr(); }
}
function renderOcr() {
  const d = oc.doc, n = d.pages.length, have = d.pages.filter(p => (p.ocr || '').trim()).length;
  $('#oPage').textContent = 'Page ' + (oc.idx + 1) + ' of ' + n;
  $('#oPrev').style.visibility = oc.idx > 0 ? 'visible' : 'hidden'; $('#oNext').style.visibility = oc.idx < n - 1 ? 'visible' : 'hidden';
  $('#oText').value = d.pages[oc.idx].ocr || '';
  if (!oc.running) { $('#oPct').textContent = have === n ? 'Complete' : have ? have + ' of ' + n + ' pages' : 'Not started'; $('#oBar').style.width = (have / n * 100) + '%'; }
  $('#oRun').disabled = oc.running;
  $('#oSub').textContent = d.src === 'pdf' && have ? 'Text taken from the PDF where it had any. Review and correct any errors.' : 'Review and correct any recognition errors.';
}
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.head.appendChild(s); });
}
async function getOcrWorker() {
  if (ocrWorker) return ocrWorker;
  if (!window.Tesseract) await loadScript('lib/tesseract/tesseract.min.js');
  const abs = p => new URL(p, location.href).href;
  ocrWorker = await Tesseract.createWorker('eng', 1, {
    workerPath: abs('lib/tesseract/worker.min.js'), corePath: abs('lib/tesseract/core'), langPath: abs('lib/tesseract/lang'), gzip: true,
    logger: m => { if (ocrLogger) ocrLogger(m); }
  });
  return ocrWorker;
}
async function runOcr() {
  if (!oc || oc.running) return;
  const d = oc.doc, n = d.pages.length;
  let todo = d.pages.map((p, i) => i).filter(i => oc.force || !(d.pages[i].ocr || '').trim());
  if (!todo.length) {
    if (!await ask({ title: 'Run recognition again?', message: 'Every page already has text. Running again replaces it, including any corrections you made.', ok: 'Run again' })) return;
    todo = d.pages.map((p, i) => i);
  }
  oc.running = true; oc.cancel = false; oc.force = false; $('#oRun').disabled = true; $('#oPct').textContent = 'Loading...'; $('#oBar').style.width = '2%';
  let done = 0;
  try {
    ocrLogger = m => {
      if (m.status === 'recognizing text') { const p = (done + m.progress) / todo.length; $('#oBar').style.width = Math.max(3, p * 100) + '%'; }
    };
    const worker = await getOcrWorker();
    for (const k of todo) {
      if (oc.cancel) break;
      $('#oPct').textContent = 'Page ' + (k + 1) + ' of ' + n + '...';
      const src = await getWork(d, d.pages[k], Infinity);
      const r = E.renderPage(d, d.pages[k], src, CFG.ocrDpi, null, null);
      const res = await worker.recognize(r.canvas);
      d.pages[k].ocr = (res.data.text || '').trim(); done++;
      await Store.save(d);
      if (curScreen === 'ocr' && k === oc.idx) $('#oText').value = d.pages[k].ocr;
    }
    if (!oc.cancel) toast(done ? 'Text extracted from ' + plural(done, 'page', 'pages') : 'Nothing to do');
  } catch (e) {
    if (!oc.cancel) toast('Text recognition failed: ' + (e && e.message ? e.message : e), 6000);
  } finally {
    ocrLogger = null; oc.running = false;
    if (ocrWorker) { try { ocrWorker.terminate(); } catch (e) {} ocrWorker = null; }
    if (curScreen === 'ocr') renderOcr();
  }
}
function ocrLeave() {
  if (oc) { oc.cancel = true; clearTimeout(ocrSave); }
  if (ocrWorker && oc && oc.running) { try { ocrWorker.terminate(); } catch (e) {} ocrWorker = null; }
}
$('#oBack').onclick = () => history.back();
$('#oRun').onclick = runOcr;
$('#oPrev').onclick = () => { if (oc.idx > 0) { oc.idx--; renderOcr(); } };
$('#oNext').onclick = () => { if (oc.idx < oc.doc.pages.length - 1) { oc.idx++; renderOcr(); } };
$('#oText').addEventListener('input', e => {
  oc.doc.pages[oc.idx].ocr = e.target.value;
  clearTimeout(ocrSave); const d = oc.doc; ocrSave = setTimeout(() => Store.save(d), 600);
});
$('#oCopy').onclick = async () => {
  const t = docText(oc.doc); if (!t.trim()) { toast('No text to copy yet'); return; }
  try { await navigator.clipboard.writeText(t); toast('Copied ' + plural(t.split(/\s+/).filter(Boolean).length, 'word', 'words')); }
  catch (e) { const a = $('#oText'); a.select(); document.execCommand('copy'); toast('Copied this page'); }
};
$('#oSave').onclick = () => {
  const t = docText(oc.doc); if (!t.trim()) { toast('No text to save yet'); return; }
  download([new File([t], safeName(oc.doc.title) + '.txt', { type: 'text/plain' })]); toast('Saved text file');
};
$('#oSend').onclick = () => { if (!docText(oc.doc).trim()) { toast('No text yet. Tap Recognize text first.'); return; } clearTimeout(ocrSave); Store.save(oc.doc); openExport({ doc: oc.doc, fmt: 'txt' }); };

/* ============ share-safe copy ============ */
let sf = null, sfSave;
function openSafe(doc) { curDoc = doc; sf = { doc, idx: 0, draw: false, work: null, cache: {} }; nav('safe'); }
async function enterSafe() {
  if (!sf || sf.doc !== curDoc) { go('home', true); return; }
  const d = sf.doc;
  if (d.vault && !d.safe.init) { d.safe.init = true; d.safe.stamp = true; }
  $('#sfTitle').textContent = d.title;
  $('#sfPurpose').value = d.safe.purpose || S.purpose || '';
  d.safe.purpose = $('#sfPurpose').value;
  $('#sfStamp').classList.toggle('on', !!d.safe.stamp);
  sf.draw = false; $('#sfRedact').classList.remove('on'); syncSafeDraw();
  await loadSafePage(0);
}
async function loadSafePage(i) {
  const d = sf.doc; sf.idx = clamp(i, 0, d.pages.length - 1); sf.cache = {};
  busy('Loading page...');
  try { sf.work = await getWork(d, d.pages[sf.idx], CFG.workSide); } catch (e) { busy(false); toast('Could not load that page'); return; }
  busy(false);
  $('#sfPage').textContent = 'Page ' + (sf.idx + 1) + ' of ' + d.pages.length;
  $('#sfPrev').style.visibility = sf.idx > 0 ? 'visible' : 'hidden'; $('#sfNext').style.visibility = sf.idx < d.pages.length - 1 ? 'visible' : 'hidden';
  drawSafe();
}
function safeBoxes() { const d = sf.doc, p = d.pages[sf.idx]; return d.safe.redact[p.id] || (d.safe.redact[p.id] = []); }
function drawSafe() {
  if (!sf || !sf.work) return;
  const d = sf.doc, pg = d.pages[sf.idx];
  const ov = { redact: d.safe.redact[pg.id] || [], stamp: d.safe.stamp ? E.stampText(d.safe.purpose) : '' };
  const r = E.renderPage(d, pg, sf.work, 900 / E.pageLongIn(d), sf.cache, ov), cv = $('#sfCv'), dr = $('#sfDraw');
  if (cv.width !== r.L.pw || cv.height !== r.L.ph) { cv.width = dr.width = r.L.pw; cv.height = dr.height = r.L.ph; }
  cv.getContext('2d').drawImage(r.canvas, 0, 0); dr.getContext('2d').clearRect(0, 0, dr.width, dr.height);
  const n = ov.redact.length; $('#sfUndo').disabled = !n; $('#sfClear').disabled = !n;
  $('#sfRedHint').textContent = sf.draw ? 'Drag on the page to draw boxes (' + plural(n, 'box', 'boxes') + ' here)' : n ? plural(n, 'box', 'boxes') + ' on this page' : 'Turn on, then drag boxes over the page';
}
function syncSafeDraw() { $('#sfDraw').style.pointerEvents = sf && sf.draw ? 'auto' : 'none'; }
function persistSafe() { clearTimeout(sfSave); if (!sf) return; const d = sf.doc; if (d.vault && !vault.key) return; S.purpose = d.safe.purpose; saveS(); Store.save(d).catch(() => {}); }
function safeLeave() { persistSafe(); }
$('#sfBack').onclick = () => history.back();
$('#sfPrev').onclick = () => loadSafePage(sf.idx - 1);
$('#sfNext').onclick = () => loadSafePage(sf.idx + 1);
$('#sfPurpose').addEventListener('input', e => { sf.doc.safe.purpose = e.target.value; drawSafe(); clearTimeout(sfSave); sfSave = setTimeout(persistSafe, 700); });
$('#sfStamp').onclick = e => { const d = sf.doc; d.safe.stamp = !d.safe.stamp; e.currentTarget.classList.toggle('on', d.safe.stamp); drawSafe(); persistSafe(); };
$('#sfRedact').onclick = e => { sf.draw = !sf.draw; e.currentTarget.classList.toggle('on', sf.draw); syncSafeDraw(); drawSafe(); };
$('#sfUndo').onclick = () => { safeBoxes().pop(); drawSafe(); persistSafe(); };
$('#sfClear').onclick = () => { sf.doc.safe.redact[sf.doc.pages[sf.idx].id] = []; drawSafe(); persistSafe(); };
(function safeDrawing() {
  const dr = $('#sfDraw'); let start = null;
  const pos = e => { const r = dr.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) }; };
  dr.addEventListener('pointerdown', e => { if (!sf || !sf.draw) return; start = pos(e); dr.setPointerCapture(e.pointerId); e.preventDefault(); });
  dr.addEventListener('pointermove', e => {
    if (!start) return; const p = pos(e), x = dr.getContext('2d');
    x.clearRect(0, 0, dr.width, dr.height); x.fillStyle = 'rgba(0,0,0,.55)'; x.strokeStyle = '#ffb020'; x.lineWidth = Math.max(2, dr.width / 300);
    const rx = Math.min(start.x, p.x) * dr.width, ry = Math.min(start.y, p.y) * dr.height, rw = Math.abs(p.x - start.x) * dr.width, rh = Math.abs(p.y - start.y) * dr.height;
    x.fillRect(rx, ry, rw, rh); x.strokeRect(rx, ry, rw, rh);
  });
  const end = e => {
    if (!start) return; const p = pos(e), b = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
    start = null; if (b.w > 0.01 && b.h > 0.005) { safeBoxes().push(b); persistSafe(); }
    drawSafe();
  };
  dr.addEventListener('pointerup', end); dr.addEventListener('pointercancel', () => { start = null; drawSafe(); });
})();
$('#sfMake').onclick = () => { persistSafe(); openExport({ doc: sf.doc, safe: true }); };
