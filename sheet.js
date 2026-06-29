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
  var FEATURE_UI_KEY = 'aegis-feature-collapse-v1';
  var featureUi = {};
  try { featureUi = JSON.parse(localStorage.getItem(FEATURE_UI_KEY) || '{}'); } catch(e){ featureUi = {}; }
  var SLOT_UI_KEY = 'aegis-slot-collapse-v1';
  var slotUi = {};
  try { slotUi = JSON.parse(localStorage.getItem(SLOT_UI_KEY) || '{}'); } catch(e){ slotUi = {}; }
  var SPELL_UI_KEY = 'aegis-spell-section-collapse-v1';
  var spellUi = {};
  try { spellUi = JSON.parse(localStorage.getItem(SPELL_UI_KEY) || '{}'); } catch(e){ spellUi = {}; }
  var PROFILE_UI_KEY = 'aegis-profile-collapse-v1';
  var profileUi = {};
  try { profileUi = JSON.parse(localStorage.getItem(PROFILE_UI_KEY) || '{}'); } catch(e){ profileUi = {}; }
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
      if (el.closest('.slot')) updateSlotRemaining();
      if (el.closest('.feat-page')) updateFeatureSummary(el);
      if (el.closest('.spell-table-panel')) updateSpellSectionControls();
      save();
    });
  }
  /* ---- toggle dots / chips ([data-t]) --------------------- */
  function isConditionToggle(key){
    return key && key.indexOf('p1.cond.') === 0;
  }

  function requestEditUnlock(){
    var btn = document.getElementById('editModeBtn');
    if (!btn || btn.hidden) return false;
    btn.click();
    return !document.body.classList.contains('read-only');
  }

  function wireToggle(el){
    var k = el.getAttribute('data-t');
    if (!el.getAttribute('type')) el.setAttribute('type', 'button');
    if (store[k] === 1 || store[k] === true) el.classList.add('on');
    el.addEventListener('click', function(){
      if (document.body.classList.contains('read-only')) {
        if (isConditionToggle(k) && requestEditUnlock()) {
          /* continue into the normal toggle path after a successful unlock */
        } else {
          return;
        }
      }
      var on = !el.classList.contains('on');
      store[k] = on ? 1 : 0;
      document.querySelectorAll('[data-t="' + k + '"]').forEach(function(o){
        o.classList.toggle('on', on);
      });
      if (el.closest('.slot')) updateSlotRemaining();
      if (el.closest('.spell-table-panel')) updateSpellSectionControls();
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
    initFeatureCollapse();
    initProfileCollapse();
    applyImages(state && state.images ? state.images : {}, true);

    document.querySelectorAll('[data-k]').forEach(function(el){
      var k = el.getAttribute('data-k');
      el.innerHTML = store[k] || '';
    });
    document.querySelectorAll('[data-t]').forEach(function(el){
      var k = el.getAttribute('data-t');
      el.classList.toggle('on', store[k] === 1 || store[k] === true);
    });
    updateSlotRemaining();
    updateSpellSectionControls();
    refreshFeatureSummaries();
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
      var key = el.getAttribute ? el.getAttribute('data-t') : '';
      var condition = isConditionToggle(key);
      el.disabled = !!readOnly && !condition;
      if (condition && readOnly) el.setAttribute('data-locked', 'true');
      else if (condition) el.removeAttribute('data-locked');
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
    setSpellSectionOpen(kind, true, true);
    updateSpellSectionControls();
    save();
  }

  function removeSpellRow(kind, id){
    var row = document.querySelector('.spell-extra[data-row-id="' + id + '"]');
    if (row && row.parentNode) row.parentNode.removeChild(row);
    setRowList(kind, rowList(kind).filter(function(x){ return x !== id; }));
    clearSpellRowData(kind, id);
    updateSpellSectionControls();
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
     EMPTY SPELL SECTION COLLAPSE - keeps martial sheets compact
     without changing spell field keys or removing rows.
     ============================================================ */
  function spellUiSave(){
    try { localStorage.setItem(SPELL_UI_KEY, JSON.stringify(spellUi)); } catch(e){}
  }

  function spellSectionPanels(root){
    if (root && root.classList && root.classList.contains('spell-table-panel')) return [root];
    return Array.from((root || document).querySelectorAll('.spell-table-panel[data-spell-section]'));
  }

  function spellSectionKind(panel){
    return panel.getAttribute('data-spell-section') || (panel.querySelector('.cantrip-list') ? 'cantrip' : 'spell');
  }

  function spellSectionLabel(kind){
    return kind === 'cantrip' ? 'cantrips' : 'prepared spells';
  }

  function spellSectionRows(panel){
    return Array.from(panel.querySelectorAll('.crow, .sprow'));
  }

  function rowHasSpellContent(row){
    var hasText = Array.from(row.querySelectorAll('[data-k]')).some(function(el){
      return (el.textContent || '').replace(/\s+/g, ' ').trim().length > 0;
    });
    if (hasText) return true;
    return Array.from(row.querySelectorAll('[data-t]')).some(function(el){
      return el.classList.contains('on');
    });
  }

  function spellSectionHasContent(panel){
    return spellSectionRows(panel).some(rowHasSpellContent);
  }

  function ensureSpellEmptyToggle(panel){
    var btn = panel.querySelector('.spell-empty-toggle');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'spell-empty-toggle';
      btn.innerHTML =
        '<span class="spell-empty-title"></span>' +
        '<span class="spell-empty-meta"></span>';
      btn.addEventListener('click', function(){
        var kind = spellSectionKind(panel);
        setSpellSectionOpen(kind, panel.classList.contains('spell-section-collapsed'), true);
        updateSpellSectionControls(panel);
      });
      panel.appendChild(btn);
    }
    return btn;
  }

  function setSpellSectionOpen(kind, open, persist){
    spellUi[kind] = open ? 1 : 0;
    if (persist) spellUiSave();
  }

  function updateSpellSectionControls(root){
    spellSectionPanels(root).forEach(function(panel){
      var kind = spellSectionKind(panel);
      var hasContent = spellSectionHasContent(panel);
      var open = hasContent || spellUi[kind] === 1;
      var btn = ensureSpellEmptyToggle(panel);
      panel.classList.toggle('has-empty-spell-section', !hasContent);
      panel.classList.toggle('spell-section-collapsed', !hasContent && !open);
      panel.classList.toggle('show-empty-spells', !hasContent && open);
      btn.hidden = hasContent;
      var title = btn.querySelector('.spell-empty-title');
      var meta = btn.querySelector('.spell-empty-meta');
      if (title) title.textContent = hasContent ? '' : 'No ' + spellSectionLabel(kind);
      if (meta) meta.textContent = open ? 'Hide rows' : 'Show rows';
    });
  }

  /* ============================================================
     LIVE PAGE NUMBERING — keeps "Page 0X / 0Y" + form codes
     correct no matter how many Features pages are added/removed.
     ============================================================ */
  function slotTotal(slot){
    var totalEl = slot.querySelector('.total');
    if (!totalEl) return null;
    var raw = (totalEl.textContent || '').replace(/\s+/g, '').trim();
    if (!raw) return null;
    var match = raw.match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
  }

  function ensureSlotRemaining(slot){
    var remain = slot.querySelector('.slot-remain');
    if (!remain) {
      remain = document.createElement('div');
      remain.className = 'slot-remain';
      remain.setAttribute('aria-live', 'polite');
      var pips = slot.querySelector('.pips');
      slot.insertBefore(remain, pips || null);
    }
    return remain;
  }

  function updateSlotRemaining(root){
    (root || document).querySelectorAll('.slot').forEach(function(slot){
      var remain = ensureSlotRemaining(slot);
      var total = slotTotal(slot);
      var spent = slot.querySelectorAll('.pips .dot.on').length;
      slot.classList.remove('slot-empty', 'slot-unused', 'slot-full', 'slot-depleted', 'slot-overdrawn');
      if (total == null) {
        remain.textContent = spent ? 'Set total' : 'No slots';
        slot.classList.add('slot-empty');
        if (spent === 0) slot.classList.add('slot-unused');
        else slot.classList.add('slot-overdrawn');
        return;
      }
      var left = Math.max(0, total - spent);
      remain.textContent = 'Remaining ' + left + ' / ' + total;
      if (spent > total) slot.classList.add('slot-overdrawn');
      else if (left === 0 && total > 0) slot.classList.add('slot-depleted');
      else if (spent === 0) slot.classList.add('slot-full');
    });
    updateSlotCollapseControls(root);
  }

  function slotUiSave(){
    try { localStorage.setItem(SLOT_UI_KEY, JSON.stringify(slotUi)); } catch(e){}
  }

  function slotPanelKey(panel){
    return panel.getAttribute('data-slot-panel') || 'spell-slots';
  }

  function slotLevel(slot){
    var lv = slot.querySelector('.lv');
    var raw = lv && lv.firstChild ? lv.firstChild.textContent : '';
    return (raw || '').replace(/\s+/g, '').trim();
  }

  function slotPanels(root){
    if (root && root.classList && root.classList.contains('slot-panel')) return [root];
    return Array.from((root || document).querySelectorAll('.slot-panel'));
  }

  function ensureSlotEmptyToggle(panel){
    var btn = panel.querySelector('.slot-empty-toggle');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-empty-toggle';
      btn.innerHTML =
        '<span class="slot-empty-title">Show empty levels</span>' +
        '<span class="slot-empty-meta"></span>';
      btn.addEventListener('click', function(){
        var key = slotPanelKey(panel);
        slotUi[key] = panel.classList.contains('show-empty-slots') ? 0 : 1;
        slotUiSave();
        updateSlotCollapseControls(panel);
      });
      panel.appendChild(btn);
    }
    return btn;
  }

  function updateSlotCollapseControls(root){
    slotPanels(root).forEach(function(panel){
      var key = slotPanelKey(panel);
      var unused = Array.from(panel.querySelectorAll('.slot.slot-unused'));
      var btn = ensureSlotEmptyToggle(panel);
      var show = slotUi[key] === 1;
      var levels = unused.map(slotLevel).filter(Boolean).join('-');
      panel.classList.toggle('has-unused-slots', unused.length > 0);
      panel.classList.toggle('show-empty-slots', show);
      btn.hidden = unused.length === 0;
      var title = btn.querySelector('.slot-empty-title');
      var meta = btn.querySelector('.slot-empty-meta');
      if (title) title.textContent = show ? 'Hide empty levels' : 'Show empty levels';
      if (meta) meta.textContent = levels ? 'Lv ' + levels : '';
    });
  }

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
        '<div class="feat-top"><span class="sect-title">Features &amp; Traits \u2014 Continued</span></div>' +
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
    initFeatureCollapse(sec);
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
     MOBILE FEATURE COLLAPSE - adds app-style toggles around the
     existing feature fields without changing their data keys.
     ============================================================ */
  function featureUiSave(){
    try { localStorage.setItem(FEATURE_UI_KEY, JSON.stringify(featureUi)); } catch(e){}
  }

  function featureLabel(el){
    var k = el.getAttribute('data-k') || '';
    if (k === 'feat.class') return 'Class Features';
    if (k === 'feat.subclass') return 'Subclass';
    if (k === 'feat.species') return 'Species';
    if (k === 'feat.other') return 'Feats / Other';
    if (k.indexOf('feat.cont.') === 0) {
      var parts = k.split('.');
      return parts[3] === '2' ? 'Continued B' : 'Continued A';
    }
    return 'Feature Notes';
  }

  function setFeatureCollapsed(wrap, collapsed, persist){
    var key = wrap.getAttribute('data-feature-key');
    var btn = wrap.querySelector('.feat-mobile-toggle');
    wrap.classList.toggle('is-collapsed', !!collapsed);
    if (btn) {
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      var state = btn.querySelector('.feat-mobile-state');
      if (state) state.textContent = collapsed ? 'Open' : 'Hide';
    }
    if (persist && key) {
      featureUi[key] = collapsed ? 1 : 0;
      featureUiSave();
    }
  }

  function featureText(el){
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function updateFeatureSummary(el){
    var wrap = el && el.closest ? el.closest('.feat-mobile-field') : null;
    if (!wrap) return;
    var text = featureText(el);
    var summary = wrap.querySelector('.feat-mobile-summary');
    wrap.classList.toggle('has-content', !!text);
    if (summary) summary.textContent = text ? text.slice(0, 62) : 'Empty';
  }

  function refreshFeatureSummaries(root){
    (root || document).querySelectorAll('.feat-mobile-field > .ruled').forEach(updateFeatureSummary);
  }

  function initFeatureCollapse(root){
    (root || document).querySelectorAll('.feat-page .ruled[data-k]').forEach(function(el){
      var existing = el.closest('.feat-mobile-field');
      if (existing) {
        updateFeatureSummary(el);
        return;
      }
      var key = el.getAttribute('data-k');
      var wrap = document.createElement('div');
      wrap.className = 'feat-mobile-field';
      wrap.setAttribute('data-feature-key', key);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'feat-mobile-toggle';
      btn.innerHTML =
        '<span class="feat-mobile-title"></span>' +
        '<span class="feat-mobile-summary"></span>' +
        '<span class="feat-mobile-state">Hide</span>';
      btn.querySelector('.feat-mobile-title').textContent = featureLabel(el);
      btn.addEventListener('click', function(){
        setFeatureCollapsed(wrap, !wrap.classList.contains('is-collapsed'), true);
      });
      el.parentNode.insertBefore(wrap, el);
      wrap.appendChild(btn);
      wrap.appendChild(el);
      var hasPreference = Object.prototype.hasOwnProperty.call(featureUi, key);
      setFeatureCollapsed(wrap, hasPreference ? featureUi[key] === 1 : true, false);
      updateFeatureSummary(el);
    });
  }

  /* ============================================================
     MOBILE PROFILE COLLAPSE - keeps long roleplay sections compact
     on phones while preserving the original editable fields.
     ============================================================ */
  function profileUiSave(){
    try { localStorage.setItem(PROFILE_UI_KEY, JSON.stringify(profileUi)); } catch(e){}
  }

  function profileRowKey(row){
    var field = row.querySelector('.ruled[data-k]');
    return field ? field.getAttribute('data-k') : '';
  }

  function setProfileCollapsed(row, collapsed, persist){
    var key = profileRowKey(row);
    row.classList.toggle('is-profile-collapsed', !!collapsed);
    var label = row.querySelector('.vlabel');
    if (label) {
      label.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      var state = label.querySelector('.profile-collapse-state');
      if (state) state.textContent = collapsed ? 'Open' : 'Hide';
    }
    if (persist && key) {
      profileUi[key] = collapsed ? 1 : 0;
      profileUiSave();
    }
  }

  function initProfileCollapse(root){
    (root || document).querySelectorAll('.profile-main .actrow, .profile-bottom .actrow').forEach(function(row){
      if (row.__profileCollapseWired) return;
      var key = profileRowKey(row);
      var label = row.querySelector('.vlabel');
      if (!key || !label) return;
      row.__profileCollapseWired = 1;
      label.setAttribute('role', 'button');
      label.setAttribute('tabindex', '0');
      var state = document.createElement('span');
      state.className = 'profile-collapse-state';
      label.appendChild(state);
      function toggle(){
        setProfileCollapsed(row, !row.classList.contains('is-profile-collapsed'), true);
      }
      label.addEventListener('click', toggle);
      label.addEventListener('keydown', function(e){
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
      var hasPreference = Object.prototype.hasOwnProperty.call(profileUi, key);
      setProfileCollapsed(row, hasPreference ? profileUi[key] === 1 : true, false);
    });
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
      localStorage.removeItem(FEATURE_UI_KEY);
      localStorage.removeItem(SLOT_UI_KEY);
      localStorage.removeItem(SPELL_UI_KEY);
      localStorage.removeItem(PROFILE_UI_KEY);
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
    updateSlotRemaining();
    wireSpellRowControls();
    updateSpellSectionControls();
    wireImageChanges();
    window.addEventListener('aegis-images-ready', wireImageChanges);
    document.querySelectorAll('.feat-add').forEach(function(b){
      if (!b.__wiredAdd){ b.__wiredAdd = 1; b.addEventListener('click', onAdd); }
    });
    restoreFeaturePages();
    initFeatureCollapse();
    initProfileCollapse();
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
