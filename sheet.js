/* ============================================================
   AEGIS Personnel Dossier — field persistence, toggles,
   dynamic Features pages, and live page renumbering.
   All state saved to localStorage so a refresh keeps your data.
   ============================================================ */
(function(){
  'use strict';
  var KEY = 'stellar-compendium-v1';
  var store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch(e){ store = {}; }
  var changeListeners = [];
  var imageChangeWired = false;
  var pendingImages = null;

  function save(){
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch(e){}
    changeListeners.forEach(function(fn){
      try { fn(store); } catch(e){}
    });
  }
  function pad(n){ return (n < 10 ? '0' : '') + n; }

  function imagesApi(){
    return window.AegisImages || globalThis.AegisImages || null;
  }

  function applyImages(images, silent){
    var api = imagesApi();
    if (api) {
      api.applyState(images || {}, { silent: !!silent });
      pendingImages = null;
    } else {
      pendingImages = images || {};
    }
  }

  function wireImageChanges(){
    var api = imagesApi();
    if (!api) return;
    if (!imageChangeWired) {
      imageChangeWired = true;
      api.onChange(save);
    }
    if (pendingImages) applyImages(pendingImages, true);
  }

  /* ---- editable text fields ([data-k]) -------------------- */
  function wireField(el){
    var k = el.getAttribute('data-k');
    if (store[k] != null && store[k] !== '') el.innerHTML = store[k];
    el.addEventListener('input', function(){
      store[k] = el.innerHTML;
      document.querySelectorAll('[data-k="' + k + '"]').forEach(function(o){
        if (o !== el && o.innerHTML !== el.innerHTML) o.innerHTML = el.innerHTML;
      });
      save();
    });
  }
  /* ---- toggle dots / chips ([data-t]) --------------------- */
  function wireToggle(el){
    var k = el.getAttribute('data-t');
    if (store[k] === 1 || store[k] === true) el.classList.add('on');
    el.addEventListener('click', function(){
      var on = el.classList.toggle('on');
      store[k] = on ? 1 : 0;
      save();
    });
  }
  function initFields(root){
    (root || document).querySelectorAll('[data-k]').forEach(function(el){
      if (!el.__wired){ el.__wired = 1; wireField(el); }
    });
  }
  function initToggles(root){
    (root || document).querySelectorAll('[data-t]').forEach(function(el){
      if (!el.__wired){ el.__wired = 1; wireToggle(el); }
    });
  }

  function currentSpellRows(kind){
    var selector = kind === 'cantrip' ? '.cantrip-list .crow.spell-extra' : '.splist .sprow.spell-extra';
    return Array.prototype.map.call(document.querySelectorAll(selector), function(row){
      return parseInt(row.getAttribute('data-row-id'), 10);
    }).filter(function(id){ return !isNaN(id); });
  }

  function collectState(){
    var fields = {};
    var toggles = {};
    document.querySelectorAll('[data-k]').forEach(function(el){
      var k = el.getAttribute('data-k');
      if (fields[k] == null) fields[k] = el.innerHTML || '';
    });
    document.querySelectorAll('[data-t]').forEach(function(el){
      toggles[el.getAttribute('data-t')] = el.classList.contains('on') ? 1 : 0;
    });
    return {
      fields: fields,
      toggles: toggles,
      images: imagesApi() ? imagesApi().getState() : {},
      featurePages: store['feat.added'] || [],
      cantripRows: currentSpellRows('cantrip'),
      spellRows: currentSpellRows('spell')
    };
  }

  function applyState(state, options){
    options = options || {};
    var fields = state && state.fields ? state.fields : {};
    var toggles = state && state.toggles ? state.toggles : {};
    store = {};

    Object.keys(fields).forEach(function(k){ store[k] = fields[k]; });
    Object.keys(toggles).forEach(function(k){ store[k] = toggles[k] ? 1 : 0; });
    if (state && Array.isArray(state.featurePages)) store['feat.added'] = state.featurePages.slice();
    if (state && Array.isArray(state.cantripRows)) store['spell.cantrips'] = state.cantripRows.slice();
    if (state && Array.isArray(state.spellRows)) store['spell.spells'] = state.spellRows.slice();

    document.querySelectorAll('.feat-cont').forEach(function(sec){ sec.remove(); });
    document.querySelectorAll('.spell-extra').forEach(function(row){ row.remove(); });
    restoreSpellRows();
    restoreFeaturePages();
    initFields();
    initToggles();
    wireSpellRowControls();
    applyImages(state && state.images ? state.images : {}, true);

    document.querySelectorAll('[data-k]').forEach(function(el){
      var k = el.getAttribute('data-k');
      el.innerHTML = store[k] || '';
    });
    document.querySelectorAll('[data-t]').forEach(function(el){
      var k = el.getAttribute('data-t');
      el.classList.toggle('on', store[k] === 1 || store[k] === true);
    });
    renumber();
    requestAnimationFrame(function(){ requestAnimationFrame(snapRuled); });
    if (!options.skipSave) save();
  }

  function setReadOnly(readOnly){
    document.body.classList.toggle('read-only', !!readOnly);
    document.querySelectorAll('[contenteditable]').forEach(function(el){
      el.setAttribute('contenteditable', readOnly ? 'false' : 'true');
    });
    document.querySelectorAll('[data-t], .feat-add, .feat-remove, .spell-add, .row-remove, #resetBtn').forEach(function(el){
      el.disabled = !!readOnly;
    });
    if (imagesApi()) imagesApi().setReadOnly(!!readOnly);
  }

  /* ============================================================
     DYNAMIC SPELL ROWS - extra cantrips and prepared spells.
     Base rows stay in the HTML; added rows are rebuilt from state.
     ============================================================ */
  function cantripRow(id){
    var row = document.createElement('div');
    row.className = 'crow spell-extra';
    row.setAttribute('data-row-id', id);
    row.innerHTML =
      '<div class="cn" contenteditable data-k="p4.ctn' + id + '"></div>' +
      '<div class="rng" contenteditable data-k="p4.ctr' + id + '"></div>' +
      '<div class="hit" contenteditable data-k="p4.cth' + id + '"></div>' +
      '<div class="fx" contenteditable data-k="p4.ctf' + id + '"></div>' +
      '<button class="row-remove" data-row-kind="cantrip" data-row-id="' + id + '" title="Remove row">x</button>';
    return row;
  }

  function spellRow(id){
    var row = document.createElement('div');
    row.className = 'sprow spell-extra';
    row.setAttribute('data-row-id', id);
    row.innerHTML =
      '<span class="conc-mark"><button class="dot" data-t="p4.pc' + id + '"></button></span>' +
      '<span class="prep"><button class="dot" data-t="p4.pr' + id + '"></button></span>' +
      '<div class="nm" contenteditable data-k="p4.pn' + id + '"></div>' +
      '<div class="rng" contenteditable data-k="p4.rg' + id + '"></div>' +
      '<div class="hit" contenteditable data-k="p4.sh' + id + '"></div>' +
      '<div class="fx" contenteditable data-k="p4.fx' + id + '"></div>' +
      '<button class="row-remove" data-row-kind="spell" data-row-id="' + id + '" title="Remove row">x</button>';
    return row;
  }

  function rowList(kind){
    return kind === 'cantrip' ? (store['spell.cantrips'] || []) : (store['spell.spells'] || []);
  }

  function setRowList(kind, rows){
    store[kind === 'cantrip' ? 'spell.cantrips' : 'spell.spells'] = rows.slice();
  }

  function appendSpellRow(kind, id){
    var list = kind === 'cantrip' ? document.querySelector('.cantrip-list') : document.querySelector('.splist');
    if (!list || list.querySelector('.spell-extra[data-row-id="' + id + '"]')) return;
    list.appendChild(kind === 'cantrip' ? cantripRow(id) : spellRow(id));
  }

  function restoreSpellRows(){
    rowList('cantrip').forEach(function(id){ appendSpellRow('cantrip', id); });
    rowList('spell').forEach(function(id){ appendSpellRow('spell', id); });
  }

  function nextSpellRowId(kind){
    var base = kind === 'cantrip' ? 5 : 9;
    var rows = rowList(kind);
    return rows.length ? Math.max.apply(null, rows.concat([base])) + 1 : base + 1;
  }

  function clearSpellRowData(kind, id){
    var prefixes = kind === 'cantrip'
      ? ['p4.ctn', 'p4.ctr', 'p4.cth', 'p4.ctf']
      : ['p4.pc', 'p4.pr', 'p4.pn', 'p4.rg', 'p4.sh', 'p4.fx'];
    prefixes.forEach(function(prefix){ delete store[prefix + id]; });
  }

  function addSpellRow(kind){
    var id = nextSpellRowId(kind);
    var rows = rowList(kind);
    rows.push(id);
    setRowList(kind, rows);
    appendSpellRow(kind, id);
    var row = document.querySelector('.spell-extra[data-row-id="' + id + '"]');
    initFields(row);
    initToggles(row);
    wireSpellRowControls(row);
    save();
  }

  function removeSpellRow(kind, id){
    var row = document.querySelector('.spell-extra[data-row-id="' + id + '"]');
    if (row && row.parentNode) row.parentNode.removeChild(row);
    setRowList(kind, rowList(kind).filter(function(x){ return x !== id; }));
    clearSpellRowData(kind, id);
    save();
  }

  function wireSpellRowControls(root){
    (root || document).querySelectorAll('.spell-add').forEach(function(btn){
      if (btn.__wiredSpellAdd) return;
      btn.__wiredSpellAdd = 1;
      btn.addEventListener('click', function(){ addSpellRow(btn.getAttribute('data-row-kind')); });
    });
    (root || document).querySelectorAll('.row-remove').forEach(function(btn){
      if (btn.__wiredSpellRemove) return;
      btn.__wiredSpellRemove = 1;
      btn.addEventListener('click', function(){
        removeSpellRow(btn.getAttribute('data-row-kind'), parseInt(btn.getAttribute('data-row-id'), 10));
      });
    });
  }

  /* ============================================================
     LIVE PAGE NUMBERING — keeps "Page 0X / 0Y" + form codes
     correct no matter how many Features pages are added/removed.
     ============================================================ */
  function renumber(){
    var pages = document.querySelectorAll('.page');
    var total = pages.length;
    pages.forEach(function(p, i){
      var idx  = i + 1;
      var form = p.querySelector('.aegis-bar .form');
      var pg   = p.querySelector('.aegis-bar .pg');
      if (form && form.dataset.formname)
        form.textContent = 'FORM AS\u00b7' + pad(idx) + ' \u2014 ' + form.dataset.formname;
      if (pg && pg.dataset.suffix)
        pg.textContent = 'Page ' + pad(idx) + ' / ' + pad(total) + ' \u00b7 ' + pg.dataset.suffix;
    });
  }

  /* ============================================================
     DYNAMIC FEATURES PAGES — overflow capability records.
     Each added page is a real printed page; ids persist so a
     refresh rebuilds them in order.
     ============================================================ */
  var EMBLEM = '<svg class="emblem" viewBox="0 0 40 44" fill="none"><path d="M20 2 L37 9 V24 C37 34 29 40 20 43 C11 40 3 34 3 24 V9 Z" stroke="currentColor" stroke-width="2"/><path d="M20 11 L28 31 H23.2 L20 22.5 L16.8 31 H12 Z" fill="currentColor"/></svg>';
  var WATERMARK = '<svg class="watermark" viewBox="0 0 40 44"><path d="M20 2 L37 9 V24 C37 34 29 40 20 43 C11 40 3 34 3 24 V9 Z" fill="currentColor"/></svg>';

  function featTemplate(pid){
    var sec = document.createElement('section');
    sec.className = 'page feat-page feat-cont';
    sec.setAttribute('data-feat-page', pid);
    sec.setAttribute('data-screen-label', 'Features & Traits (cont.)');
    sec.innerHTML =
      WATERMARK +
      '<div class="page-frame">' +
        '<div class="aegis-bar">' + EMBLEM +
          '<div class="wordmark"><span class="name">AEGIS SOLUTIONS</span><span class="sub">Capability Record</span></div>' +
          '<div class="meta"><div class="form" data-formname="FEATURES"></div><div class="pg" data-suffix="Capability Record \u00b7 cont."></div></div>' +
        '</div>' +
        '<div class="feat-top"><span class="sect-title">Features &amp; Traits \u2014 Continued</span>' +
          '<div class="feat-legend"><span class="lg-chip class">Class</span><span class="lg-chip sub">Subclass</span><span class="lg-chip species">Species</span><span class="lg-chip feat">Feat</span></div></div>' +
        '<div class="row grow" style="min-height:0;">' +
          '<div class="panel ref grow"><div class="panel-h"><span class="sect-title">Continued</span></div><div class="panel-body"><div class="ruled" contenteditable data-k="feat.cont.' + pid + '.1" data-ph="Continue feature write-ups\u2026"></div></div></div>' +
          '<div class="panel ref grow"><div class="panel-h"><span class="sect-title">Continued</span></div><div class="panel-body"><div class="ruled" contenteditable data-k="feat.cont.' + pid + '.2" data-ph="Continue feature write-ups\u2026"></div></div></div>' +
        '</div>' +
        '<div class="feat-controls"><button class="feat-add">+ Features page</button><button class="feat-remove">Remove page</button></div>' +
        '<div class="page-foot" style="font-size: 11px"><span class="red">AEGIS SOLUTIONS</span><span class="sep">\u00b7</span><span class="ttl">Capability Record</span></div>' +
      '</div>';
    return sec;
  }

  function addFeaturePage(pid, persist){
    var anchor = document.getElementById('page-arsenal');
    if (!anchor) return;
    var sec = featTemplate(pid);
    anchor.parentNode.insertBefore(sec, anchor);
    initFields(sec); initToggles(sec);
    sec.querySelectorAll('.feat-add').forEach(function(b){ b.addEventListener('click', onAdd); });
    var rm = sec.querySelector('.feat-remove');
    if (rm) rm.addEventListener('click', function(){ removeFeaturePage(pid); });
    if (persist){
      var arr = store['feat.added'] || [];
      arr.push(pid); store['feat.added'] = arr; save();
    }
    renumber();
    requestAnimationFrame(snapRuled);
  }

  function removeFeaturePage(pid){
    var sec = document.querySelector('.feat-cont[data-feat-page="' + pid + '"]');
    if (sec && sec.parentNode) sec.parentNode.removeChild(sec);
    store['feat.added'] = (store['feat.added'] || []).filter(function(x){ return x !== pid; });
    Object.keys(store).forEach(function(k){
      if (k.indexOf('feat.cont.' + pid + '.') === 0) delete store[k];
    });
    save();
    renumber();
  }

  function onAdd(){
    var arr = store['feat.added'] || [];
    var pid = (arr.length ? Math.max.apply(null, arr) : 0) + 1;
    addFeaturePage(pid, true);
  }

  function restoreFeaturePages(){
    (store['feat.added'] || []).slice().forEach(function(pid){ addFeaturePage(pid, false); });
  }

  /* ============================================================
     RULED-LINE SNAP — lock every lined box to a whole number of
     writing lines (24px rhythm) so no box ever shows a half line.
     Idempotent: re-snapping an already-snapped box is a no-op.
     ============================================================ */
  var LINE = 24;
  function snapRuled(){
    var items = [];
    document.querySelectorAll('.ruled').forEach(function(el){
      /* Skip any ruled field whose height is determined by flex layout,
         not a fixed value. Snapping these would override the grow behavior. */
      if (el.closest('.actrow')) return;       // combat action rows fill via flex
      if (el.closest('.profile-main')) return; // page 4 roleplay columns
      if (el.closest('.profile-bottom')) return;
      var panelBody = el.closest('.panel-body');
      if (panelBody) {
        var panel = panelBody.closest('.panel');
        if (panel && panel.classList.contains('grow')) return; // growing panels
      }
      var cs = getComputedStyle(el);
      var pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
      var h = el.getBoundingClientRect().height;
      if (h <= 0) return;
      var lines = Math.max(1, Math.floor((h - pt - pb + 2) / LINE));
      items.push([el, lines * LINE + pt + pb]);
    });
    items.forEach(function(it){
      it[0].style.flex = '0 0 ' + it[1] + 'px';
      it[0].style.height = it[1] + 'px';
    });
  }

  /* ---- reset --------------------------------------------- */
  function initReset(){
    var btn = document.getElementById('resetBtn');
    if (!btn) return;
    btn.addEventListener('click', function(){
      if (!confirm('Clear every field on all pages? This cannot be undone.')) return;
      localStorage.removeItem(KEY);
      location.reload();
    });
  }

  /* ---- print --------------------------------------------- */
  function initPrint(){
    var btn = document.getElementById('printBtn');
    if (btn) btn.addEventListener('click', function(){ window.print(); });
  }

  function boot(){
    restoreSpellRows();
    initFields();
    initToggles();
    wireSpellRowControls();
    wireImageChanges();
    window.addEventListener('aegis-images-ready', wireImageChanges);
    document.querySelectorAll('.feat-add').forEach(function(b){
      if (!b.__wiredAdd){ b.__wiredAdd = 1; b.addEventListener('click', onAdd); }
    });
    restoreFeaturePages();
    renumber();
    initReset();
    initPrint();
    requestAnimationFrame(function(){ requestAnimationFrame(snapRuled); });
  }

  window.AegisSheet = {
    getState: collectState,
    applyState: applyState,
    setReadOnly: setReadOnly,
    onChange: function(fn){
      if (typeof fn === 'function') changeListeners.push(fn);
    },
    saveLocal: save
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
