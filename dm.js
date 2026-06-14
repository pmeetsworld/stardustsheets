(function(){
  'use strict';

  var BUILD = window.AEGIS_BUILD || '20260613n';
  var PASSWORD = 'AEGIS DM 712';
  var UNLOCK_KEY = 'aegis-dm-unlocked-until-v1';
  var COMBAT_LOCAL_KEY = 'aegis-dm-combat-local-v1';
  var SESSIONS_LOCAL_KEY = 'aegis-dm-sessions-local-v1';
  var SESSION_DRAFT_KEY = 'aegis-dm-session-draft-v1';
  var PC_HP_VIS_KEY = 'aegis-dm-pc-hp-visible-v1';
  var UNLOCK_MS = 12 * 60 * 60 * 1000;
  var PARTY_POLL_MS = 7000;
  var COMBAT_SAVE_MS = 10000;
  var SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

  var config = window.AEGIS_CLOUD || {};
  var characters = [];
  var characterMap = {};
  var combatState = {
    id: 'main',
    combat_active: false,
    round: 1,
    combatants: [],
    encounter_notes: '',
    backup_state: null,
    updated_at: ''
  };
  var sessions = [];
  var currentSession = null;
  var pcHpVisible = localStorage.getItem(PC_HP_VIS_KEY) !== '0';
  var combatSaveTimer = null;
  var partyPollTimer = null;
  var combatCloudReady = true;
  var sessionsCloudReady = true;
  var realtimeClient = null;
  var realtimeChannel = null;

  var els = {};

  function $(id){ return document.getElementById(id); }

  function cacheEls(){
    [
      'dmLock','dmApp','dmUnlockForm','dmPassword','dmLockError','dmCloudStatus',
      'partyGrid','refreshPartyBtn','togglePcHpBtn','newSessionBtn','saveSessionBtn','sessionDate',
      'sessionTitle','sessionStatus','sessionNotesA','sessionNotesB','sessionList',
      'reloadSessionsBtn','addPartyBtn','addCustomBtn','restoreCombatBtn',
      'clearCombatBtn','roundInput','roundMinusBtn','roundPlusBtn','combatStatus',
      'combatLiveBtn','combatantsList','encounterNotes','encounterStatus'
    ].forEach(function(id){ els[id] = $(id); });
  }

  function apiUrl(path){
    return (config.supabaseUrl || '').replace(/\/$/, '') + '/rest/v1/' + path;
  }

  function headers(extra){
    var h = {
      apikey: config.supabaseKey || '',
      Authorization: 'Bearer ' + (config.supabaseKey || ''),
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    Object.keys(extra || {}).forEach(function(k){ h[k] = extra[k]; });
    return h;
  }

  function encode(value){
    return encodeURIComponent(value == null ? '' : String(value));
  }

  function setTopStatus(text, state){
    if (!els.dmCloudStatus) return;
    els.dmCloudStatus.textContent = text;
    els.dmCloudStatus.dataset.state = state || '';
  }

  function setSessionStatus(text, state){
    if (!els.sessionStatus) return;
    els.sessionStatus.textContent = text;
    els.sessionStatus.dataset.state = state || '';
  }

  function setCombatStatus(text, state){
    if (!els.combatStatus) return;
    els.combatStatus.textContent = text;
    els.combatStatus.dataset.state = state || '';
    if (els.encounterStatus) {
      els.encounterStatus.textContent = text;
      els.encounterStatus.dataset.state = state || '';
    }
  }

  function htmlToText(value){
    var div = document.createElement('div');
    div.innerHTML = value == null ? '' : String(value);
    return div.textContent.replace(/\u00a0/g, ' ').trim();
  }

  function field(character, key, fallback){
    var data = character && character.sheet_data;
    var fields = data && data.fields ? data.fields : {};
    var text = htmlToText(fields[key] || '');
    return text || fallback || '';
  }

  function asNumber(value, fallback){
    var text = htmlToText(value);
    var num = parseInt(text.replace(/[^\d-]/g, ''), 10);
    return isNaN(num) ? (fallback || 0) : num;
  }

  function signedNumber(value){
    var text = htmlToText(value);
    var num = parseInt(text.replace(/[^\d-]/g, ''), 10);
    return isNaN(num) ? null : num;
  }

  function passiveFromSenses(character, name){
    var senses = field(character, 'p1.senses', '');
    var match = senses.match(new RegExp('Passive\\s+' + name + '\\s*(\\d+)', 'i'));
    return match ? match[1] : '';
  }

  function passiveScore(character, skillKey, explicitKey, sensesName){
    var explicit = explicitKey ? field(character, explicitKey, '') : '';
    if (explicit) return explicit;
    var fromSenses = sensesName ? passiveFromSenses(character, sensesName) : '';
    if (fromSenses) return fromSenses;
    var mod = signedNumber(field(character, skillKey, ''));
    return mod == null ? '-' : String(10 + mod);
  }

  function characterStats(character){
    var maxHp = asNumber(field(character, 'p1.maxhp'), 0);
    var curHp = asNumber(field(character, 'p1.curhp'), maxHp);
    return {
      slug: character.slug,
      player: character.player_name || character.player || '',
      name: field(character, 'p1.name', character.name || character.slug),
      ac: field(character, 'p1.ac', '-'),
      currentHp: curHp,
      maxHp: maxHp,
      tempHp: field(character, 'p1.temphp', '0'),
      passive: passiveScore(character, 'p1.sk.perc.m', 'p1.passive', 'Perception'),
      passiveInsight: passiveScore(character, 'p1.sk.insi.m', '', 'Insight'),
      passiveInvestigation: passiveScore(character, 'p1.sk.inve.m', '', 'Investigation'),
      speed: field(character, 'p1.speed', '-'),
      sheetUrl: 'sheet.html?app=' + BUILD + '&slug=' + encode(character.slug)
    };
  }

  function hpPercent(current, max){
    if (!max || max <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
  }

  function healthStatus(current, max){
    if (!max || max <= 0) {
      return { label: 'Unknown', className: 'is-unknown' };
    }
    if (current <= 0) {
      return { label: 'Incapacitated', className: 'is-incapacitated' };
    }
    if (current <= max / 2) {
      return { label: 'Bloodied', className: 'is-bloodied' };
    }
    return { label: 'Healthy', className: 'is-healthy' };
  }

  var CONDITION_LABELS = {
    blinded: 'Blinded',
    charmed: 'Charmed',
    deafened: 'Deafened',
    frightened: 'Frightened',
    grappled: 'Grappled',
    incapacitated: 'Incapacitated',
    invisible: 'Invisible',
    paralyzed: 'Paralyzed',
    petrified: 'Petrified',
    poisoned: 'Poisoned',
    prone: 'Prone',
    restrained: 'Restrained',
    stunned: 'Stunned',
    unconscious: 'Unconscious'
  };

  function activeConditions(character){
    var toggles = character && character.sheet_data && character.sheet_data.toggles ? character.sheet_data.toggles : {};
    return Object.keys(CONDITION_LABELS).filter(function(key){
      return toggles['p1.cond.' + key] === 1 || toggles['p1.cond.' + key] === true;
    }).map(function(key){ return CONDITION_LABELS[key]; });
  }

  function splitConditions(value){
    return String(value || '')
      .split(/[,;|]/)
      .map(function(part){ return part.trim(); })
      .filter(Boolean);
  }

  function conditionStrip(items){
    if (!items || !items.length) return '<div class="dm-condition-strip muted">No conditions</div>';
    return '<div class="dm-condition-strip">' + items.map(function(item){
      return '<span>' + escapeHtml(item) + '</span>';
    }).join('') + '</div>';
  }

  function hpBar(current, max, tempHp){
    var pct = hpPercent(current, max);
    var gradientWidth = pct > 0 ? (10000 / pct) : 100;
    return [
      '<div class="dm-hp-line">',
      '<div class="dm-hp-meter" aria-hidden="true">',
      '<div class="dm-hp-fill" style="width:' + pct + '%"><div class="dm-hp-gradient" style="width:' + gradientWidth + '%"></div></div>',
      '</div>',
      '<span class="dm-hp-text">' + current + ' / ' + max + '</span>',
      tempHp ? '<span class="dm-temp">+' + htmlToText(tempHp).replace(/^\+/, '') + '</span>' : '',
      '</div>'
    ].join('');
  }

  function hiddenPcHp(current, max){
    var status = healthStatus(current, max);
    return '<div class="dm-hp-hidden ' + status.className + '" aria-label="Player health status: ' + status.label + '"><span>' + status.label + '</span></div>';
  }

  function pcHpBar(current, max, tempHp){
    return pcHpVisible ? hpBar(current, max, tempHp) : hiddenPcHp(current, max);
  }

  function syncPcHpToggle(){
    document.body.classList.toggle('pc-hp-hidden', !pcHpVisible);
    if (!els.togglePcHpBtn) return;
    els.togglePcHpBtn.setAttribute('aria-pressed', pcHpVisible ? 'false' : 'true');
    els.togglePcHpBtn.title = pcHpVisible ? 'Show player health status' : 'Show exact player HP';
    var label = els.togglePcHpBtn.querySelector('span');
    if (label) label.textContent = pcHpVisible ? 'PC HP' : 'PC Status';
  }

  function syncCombatLiveToggle(){
    if (!els.combatLiveBtn) return;
    var live = !!combatState.combat_active;
    els.combatLiveBtn.classList.toggle('on', live);
    els.combatLiveBtn.setAttribute('aria-pressed', live ? 'true' : 'false');
    els.combatLiveBtn.title = live ? 'Encounter Viewer is live' : 'Encounter Viewer is waiting';
  }

  function hasCloudConfig(){
    return !!(config.supabaseUrl && config.supabaseKey);
  }

  async function rest(path, options){
    if (!hasCloudConfig()) throw new Error('Missing Supabase config.');
    options = options || {};
    var res = await fetch(apiUrl(path), {
      method: options.method || 'GET',
      headers: headers(options.headers),
      cache: 'no-store',
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (!res.ok) {
      var text = await res.text();
      throw new Error(res.status + ' ' + text);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function isSetupError(err){
    return /dm_state|dm_sessions|relation|schema cache|PGRST/i.test(String(err && err.message || err));
  }

  function isUnlocked(){
    var until = parseInt(localStorage.getItem(UNLOCK_KEY) || '0', 10);
    return until && Date.now() < until;
  }

  function unlock(){
    localStorage.setItem(UNLOCK_KEY, String(Date.now() + UNLOCK_MS));
    els.dmLock.hidden = true;
    els.dmApp.hidden = false;
    setTopStatus('Unlocked', 'edit');
    initData();
  }

  function lock(){
    els.dmLock.hidden = false;
    els.dmApp.hidden = true;
    setTopStatus('Locked', 'view');
  }

  function normalizePassword(value){
    return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
  }

  function todayString(){
    return new Date().toISOString().slice(0, 10);
  }

  function defaultTitle(dateValue){
    var d = dateValue ? new Date(dateValue + 'T12:00:00') : new Date();
    return 'Session - ' + d.toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }

  function nowIso(){
    return new Date().toISOString();
  }

  async function loadParty(silent){
    if (!hasCloudConfig()) {
      if (!silent) setTopStatus('Missing cloud config', 'error');
      return;
    }
    try {
      if (!silent) setTopStatus('Loading party...', 'loading');
      var rows = await rest('characters?select=slug,name,player_name,sheet_data,updated_at');
      var order = (config.characters || []).map(function(c){ return c.slug; });
      var bySlug = {};
      rows.forEach(function(row){ bySlug[row.slug] = row; });
      characters = order.map(function(slug){
        var cfg = (config.characters || []).find(function(c){ return c.slug === slug; }) || {};
        return bySlug[slug] || {
          slug: slug,
          name: cfg.name || slug,
          player_name: cfg.player || '',
          sheet_data: { fields: {} }
        };
      });
      characterMap = {};
      characters.forEach(function(c){ characterMap[c.slug] = c; });
      renderParty();
      renderCombatants();
      if (!silent) setTopStatus('Live party loaded', 'saved');
    } catch (err) {
      console.warn(err);
      setTopStatus('Party load failed', 'error');
    }
  }

  function renderParty(){
    if (!els.partyGrid) return;
    if (!characters.length) {
      els.partyGrid.innerHTML = '<p class="dm-empty">No characters loaded.</p>';
      return;
    }
    els.partyGrid.innerHTML = characters.map(function(character){
      var s = characterStats(character);
      return [
        '<a class="dm-party-card" href="' + s.sheetUrl + '" target="_blank" rel="noopener">',
        '<div class="dm-card-top"><div><span class="dm-card-name">' + escapeHtml(s.name) + '</span><span class="dm-card-player">' + escapeHtml(s.player) + '</span></div><span class="dm-chip">AC ' + escapeHtml(s.ac) + '</span></div>',
        pcHpBar(s.currentHp, s.maxHp, s.tempHp),
        '<div class="dm-passive-block"><span class="dm-passive-title">Passive Scores</span><div class="dm-passive-grid" aria-label="Passive scores"><span><em>Perception</em><b>' + escapeHtml(s.passive) + '</b></span><span><em>Insight</em><b>' + escapeHtml(s.passiveInsight) + '</b></span><span><em>Investigation</em><b>' + escapeHtml(s.passiveInvestigation) + '</b></span></div></div>',
        '<div class="dm-stat-row"><span>Speed <b>' + escapeHtml(s.speed) + '</b></span></div>',
        '</a>'
      ].join('');
    }).join('');
  }

  function escapeHtml(value){
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function readLocalCombat(){
    try {
      return JSON.parse(localStorage.getItem(COMBAT_LOCAL_KEY) || 'null');
    } catch (err) {
      return null;
    }
  }

  function writeLocalCombat(){
    try { localStorage.setItem(COMBAT_LOCAL_KEY, JSON.stringify(combatState)); } catch (err) {}
  }

  function readLocalSessions(){
    try { return JSON.parse(localStorage.getItem(SESSIONS_LOCAL_KEY) || '[]') || []; } catch (err) { return []; }
  }

  function writeLocalSessions(){
    try { localStorage.setItem(SESSIONS_LOCAL_KEY, JSON.stringify(sessions)); } catch (err) {}
  }

  async function loadCombatState(){
    var local = readLocalCombat();
    if (local) combatState = Object.assign(combatState, local);

    try {
      var rows = await rest('dm_state?id=eq.main&select=*');
      combatCloudReady = true;
      if (rows && rows.length) {
        combatState = normalizeCombatState(rows[0]);
      } else {
        await saveCombatState(true);
      }
      setCombatStatus('Combat autosaves', 'saved');
    } catch (err) {
      combatCloudReady = false;
      if (isSetupError(err)) {
        setCombatStatus('Run dm-screen-setup.sql', 'error');
      } else {
        setCombatStatus('Combat cloud offline', 'error');
      }
      console.warn(err);
    }
    renderCombatState();
  }

  function normalizeCombatState(row){
    return {
      id: row.id || 'main',
      combat_active: !!row.combat_active,
      round: Math.max(1, parseInt(row.round, 10) || 1),
      combatants: Array.isArray(row.combatants) ? row.combatants : [],
      encounter_notes: row.encounter_notes || '',
      backup_state: row.backup_state || null,
      updated_at: row.updated_at || ''
    };
  }

  function combatPayload(){
    return {
      id: 'main',
      combat_active: !!combatState.combat_active,
      round: Math.max(1, parseInt(combatState.round, 10) || 1),
      combatants: combatState.combatants || [],
      encounter_notes: combatState.encounter_notes || '',
      backup_state: combatState.backup_state || null,
      updated_at: nowIso()
    };
  }

  async function saveCombatState(initial){
    writeLocalCombat();
    if (!combatCloudReady && !initial) {
      setCombatStatus('Saved locally', 'saved');
      return;
    }
    if (!hasCloudConfig()) return;

    try {
      var payload = combatPayload();
      var rows = await rest('dm_state?id=eq.main&select=id,updated_at', {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: payload
      });
      if (!rows || !rows.length) {
        rows = await rest('dm_state?select=id,updated_at', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: payload
        });
      }
      combatCloudReady = true;
      combatState.updated_at = rows && rows[0] ? rows[0].updated_at : payload.updated_at;
      writeLocalCombat();
      setCombatStatus('Saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), 'saved');
    } catch (err) {
      combatCloudReady = false;
      writeLocalCombat();
      setCombatStatus(isSetupError(err) ? 'Run dm-screen-setup.sql' : 'Saved locally', isSetupError(err) ? 'error' : 'saved');
      console.warn(err);
    }
  }

  function queueCombatSave(){
    writeLocalCombat();
    setCombatStatus('Autosave pending...', 'saving');
    clearTimeout(combatSaveTimer);
    combatSaveTimer = setTimeout(function(){
      combatSaveTimer = null;
      saveCombatState(false);
    }, COMBAT_SAVE_MS);
  }

  function renderCombatState(){
    if (els.roundInput) els.roundInput.value = combatState.round || 1;
    syncCombatLiveToggle();
    if (els.encounterNotes && els.encounterNotes.textContent !== (combatState.encounter_notes || '')) {
      els.encounterNotes.textContent = combatState.encounter_notes || '';
    }
    renderCombatants();
  }

  function nextOrder(){
    return combatState.combatants.reduce(function(max, c){
      return Math.max(max, parseInt(c.order, 10) || 0);
    }, 0) + 1;
  }

  function uid(prefix){
    return prefix + '-' + Math.random().toString(36).slice(2, 8) + '-' + Date.now().toString(36);
  }

  function snapshotCombat(){
    combatState.backup_state = {
      combat_active: !!combatState.combat_active,
      round: combatState.round,
      combatants: JSON.parse(JSON.stringify(combatState.combatants || [])),
      encounter_notes: combatState.encounter_notes || '',
      updated_at: combatState.updated_at || nowIso()
    };
  }

  function addParty(){
    snapshotCombat();
    (config.characters || []).forEach(function(c){
      var exists = combatState.combatants.some(function(row){
        return row.kind === 'pc' && row.slug === c.slug;
      });
      if (!exists) {
        combatState.combatants.push({
          id: 'pc-' + c.slug,
          kind: 'pc',
          slug: c.slug,
          initiative: '',
          order: nextOrder(),
          expanded: false,
          notes: ''
        });
      }
    });
    renderCombatants();
    queueCombatSave();
  }

  function addCustom(base){
    snapshotCombat();
    var c = Object.assign({
      id: uid('custom'),
      kind: 'custom',
      name: 'Custom Combatant',
      initiative: '',
      ac: '',
      currentHp: 1,
      maxHp: 1,
      tempHp: '',
      conditions: '',
      defeated: false,
      notes: '',
      expanded: false,
      order: nextOrder()
    }, base || {});
    c.id = uid('custom');
    c.order = nextOrder();
    combatState.combatants.push(c);
    renderCombatants();
    queueCombatSave();
  }

  function sortedCombatants(){
    return (combatState.combatants || []).slice().sort(function(a, b){
      var ai = parseFloat(a.initiative);
      var bi = parseFloat(b.initiative);
      if (isNaN(ai)) ai = -9999;
      if (isNaN(bi)) bi = -9999;
      if (bi !== ai) return bi - ai;
      return (parseInt(a.order, 10) || 0) - (parseInt(b.order, 10) || 0);
    });
  }

  function renderCombatants(){
    if (!els.combatantsList) return;
    var rows = sortedCombatants();
    if (!rows.length) {
      els.combatantsList.innerHTML = '<p class="dm-empty">No combatants yet. Add the party or create a custom combatant.</p>';
      return;
    }
    els.combatantsList.innerHTML = rows.map(renderCombatant).join('');
  }

  function renderCombatant(row){
    if (row.kind === 'pc') return renderPcCombatant(row);
    return renderCustomCombatant(row);
  }

  function renderPcCombatant(row){
    var character = characterMap[row.slug] || { slug: row.slug, name: row.slug, sheet_data: { fields: {} } };
    var s = characterStats(character);
    var expanded = !!row.expanded;
    var conditions = activeConditions(character);
    return [
      '<article class="dm-combat-card dm-pc" data-id="' + escapeHtml(row.id) + '">',
      '<div class="dm-combat-main">',
      '<input class="dm-init" type="number" step="1" value="' + escapeHtml(row.initiative || '') + '" data-combat-field="initiative" data-id="' + escapeHtml(row.id) + '" aria-label="Initiative">',
      '<div class="dm-combat-identity"><a href="' + s.sheetUrl + '" target="_blank" rel="noopener">' + escapeHtml(s.name) + '</a><span>PC - live sheet</span></div>',
      '<span class="dm-chip">AC ' + escapeHtml(s.ac) + '</span>',
      '<div class="dm-combat-hp">' + pcHpBar(s.currentHp, s.maxHp, s.tempHp) + '</div>',
      '</div>',
      conditionStrip(conditions),
      '<div class="dm-combat-actions">',
      '<button type="button" class="dm-icon-btn" data-action="move-up" data-id="' + escapeHtml(row.id) + '" title="Move up">Up</button>',
      '<button type="button" class="dm-icon-btn" data-action="move-down" data-id="' + escapeHtml(row.id) + '" title="Move down">Down</button>',
      '<button type="button" class="dm-small" data-action="toggle-notes" data-id="' + escapeHtml(row.id) + '">' + (expanded ? 'Hide' : 'Notes') + '</button>',
      '<button type="button" class="dm-icon-btn" data-action="delete" data-id="' + escapeHtml(row.id) + '" title="Remove">X</button>',
      '</div>',
      expanded ? '<div class="dm-combat-notes"><div class="dm-ruled compact" contenteditable="true" data-plain="true" data-combat-field="notes" data-id="' + escapeHtml(row.id) + '">' + escapeHtml(row.notes || '') + '</div></div>' : '',
      '</article>'
    ].join('');
  }

  function renderCustomCombatant(row){
    var current = asNumber(row.currentHp, 0);
    var max = Math.max(0, asNumber(row.maxHp, 0));
    var defeated = !!row.defeated || (max > 0 && current <= 0);
    var expanded = !!row.expanded;
    var conditions = splitConditions(row.conditions);
    return [
      '<article class="dm-combat-card dm-custom ' + (defeated ? 'defeated' : '') + '" data-id="' + escapeHtml(row.id) + '">',
      '<div class="dm-combat-main">',
      '<input class="dm-init" type="number" step="1" value="' + escapeHtml(row.initiative || '') + '" data-combat-field="initiative" data-id="' + escapeHtml(row.id) + '" aria-label="Initiative">',
      '<input class="dm-name-input" type="text" value="' + escapeHtml(row.name || '') + '" data-combat-field="name" data-id="' + escapeHtml(row.id) + '" aria-label="Combatant name">',
      '<label class="dm-mini-field"><span>AC</span><input type="text" value="' + escapeHtml(row.ac || '') + '" data-combat-field="ac" data-id="' + escapeHtml(row.id) + '"></label>',
      '<label class="dm-mini-field"><span>HP</span><input type="number" step="1" value="' + escapeHtml(current) + '" data-combat-field="currentHp" data-id="' + escapeHtml(row.id) + '"></label>',
      '<label class="dm-mini-field"><span>Max</span><input type="number" step="1" value="' + escapeHtml(max) + '" data-combat-field="maxHp" data-id="' + escapeHtml(row.id) + '"></label>',
      '<label class="dm-mini-field"><span>Temp</span><input type="text" value="' + escapeHtml(row.tempHp || '') + '" data-combat-field="tempHp" data-id="' + escapeHtml(row.id) + '"></label>',
      '<div class="dm-combat-hp">' + hpBar(current, max, row.tempHp) + '</div>',
      '<div class="dm-damage-tools"><input type="number" step="1" min="0" placeholder="0" data-damage-id="' + escapeHtml(row.id) + '"><button type="button" data-action="damage" data-id="' + escapeHtml(row.id) + '">Damage</button><button type="button" data-action="heal" data-id="' + escapeHtml(row.id) + '">Heal</button></div>',
      '<label class="dm-wide-field"><span>Conditions</span><input type="text" value="' + escapeHtml(row.conditions || '') + '" data-combat-field="conditions" data-id="' + escapeHtml(row.id) + '" placeholder="Prone, poisoned..."></label>',
      '</div>',
      conditionStrip(conditions),
      '<div class="dm-combat-actions">',
      '<button type="button" class="dm-icon-btn" data-action="move-up" data-id="' + escapeHtml(row.id) + '" title="Move up">Up</button>',
      '<button type="button" class="dm-icon-btn" data-action="move-down" data-id="' + escapeHtml(row.id) + '" title="Move down">Down</button>',
      '<button type="button" class="dm-small" data-action="toggle-notes" data-id="' + escapeHtml(row.id) + '">' + (expanded ? 'Hide' : 'Notes') + '</button>',
      '<button type="button" class="dm-small ' + (defeated ? 'active' : '') + '" data-action="toggle-defeated" data-id="' + escapeHtml(row.id) + '">' + (defeated ? 'Restore' : 'Defeated') + '</button>',
      '<button type="button" class="dm-small" data-action="duplicate" data-id="' + escapeHtml(row.id) + '">Duplicate</button>',
      '<button type="button" class="dm-icon-btn" data-action="delete" data-id="' + escapeHtml(row.id) + '" title="Remove">X</button>',
      '</div>',
      defeated && !expanded ? '<div class="dm-defeated-line">Defeated - notes hidden</div>' : '',
      expanded ? '<div class="dm-combat-notes"><div class="dm-ruled compact" contenteditable="true" data-plain="true" data-combat-field="notes" data-id="' + escapeHtml(row.id) + '">' + escapeHtml(row.notes || '') + '</div></div>' : '',
      '</article>'
    ].join('');
  }

  function findCombatant(id){
    return combatState.combatants.find(function(row){ return row.id === id; });
  }

  function updateCombatField(id, fieldName, value){
    var row = findCombatant(id);
    if (!row) return;
    if (['currentHp','maxHp'].indexOf(fieldName) >= 0) value = asNumber(value, 0);
    row[fieldName] = value;
    if (fieldName === 'currentHp' && row.kind === 'custom' && value > 0) row.defeated = false;
    if (fieldName === 'initiative') row.initiative = value;
    queueCombatSave();
  }

  function moveCombatant(id, dir){
    var sorted = sortedCombatants();
    var index = sorted.findIndex(function(row){ return row.id === id; });
    var other = sorted[index + dir];
    var row = sorted[index];
    if (!row || !other) return;
    var tmp = row.order;
    row.order = other.order;
    other.order = tmp;
    renderCombatants();
    queueCombatSave();
  }

  function handleCombatAction(action, id, source){
    var row = findCombatant(id);
    if (!row && action !== 'add') return;
    if (['delete','duplicate','damage','heal','toggle-defeated'].indexOf(action) >= 0) snapshotCombat();

    if (action === 'toggle-notes') {
      row.expanded = !row.expanded;
    } else if (action === 'delete') {
      combatState.combatants = combatState.combatants.filter(function(c){ return c.id !== id; });
    } else if (action === 'duplicate' && row.kind === 'custom') {
      addCustom(Object.assign({}, row, {
        name: (row.name || 'Custom Combatant') + ' Copy',
        expanded: false
      }));
      return;
    } else if (action === 'damage' || action === 'heal') {
      var input = document.querySelector('[data-damage-id="' + cssEscape(id) + '"]');
      var amount = asNumber(input && input.value, 0);
      if (!amount || row.kind !== 'custom') return;
      var current = asNumber(row.currentHp, 0);
      row.currentHp = action === 'damage' ? Math.max(0, current - amount) : current + amount;
      if (row.currentHp > 0) row.defeated = false;
    } else if (action === 'toggle-defeated' && row.kind === 'custom') {
      row.defeated = !row.defeated;
    } else if (action === 'move-up') {
      moveCombatant(id, -1);
      return;
    } else if (action === 'move-down') {
      moveCombatant(id, 1);
      return;
    }
    renderCombatants();
    queueCombatSave();
  }

  function cssEscape(value){
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
  }

  async function loadSessions(){
    var localSessions = readLocalSessions();
    if (localSessions.length) sessions = localSessions;
    renderSessionList();

    try {
      var rows = await rest('dm_sessions?select=*&order=session_date.desc,updated_at.desc');
      sessionsCloudReady = true;
      sessions = rows || [];
      writeLocalSessions();
      renderSessionList();
      if (!currentSession) loadLatestSession();
      setSessionStatus('Sessions loaded', 'saved');
    } catch (err) {
      sessionsCloudReady = false;
      if (isSetupError(err)) {
        setSessionStatus('Run dm-screen-setup.sql', 'error');
      } else {
        setSessionStatus('Session cloud offline', 'error');
      }
      console.warn(err);
      if (!currentSession) loadLatestSession();
    }
  }

  function loadLatestSession(){
    if (sessions.length) {
      loadSession(sessions[0].id);
    } else {
      newSession();
    }
  }

  function newSession(){
    var date = todayString();
    currentSession = {
      id: null,
      session_date: date,
      title: defaultTitle(date),
      notes_a: '',
      notes_b: '',
      updated_at: ''
    };
    applySessionToForm();
    setSessionStatus('New unsaved session', 'edit');
    saveDraft();
  }

  function loadSession(id){
    var session = sessions.find(function(s){ return s.id === id; });
    if (!session) return;
    currentSession = Object.assign({}, session);
    applySessionToForm();
    var draft = readDraft();
    if (draft && draft.id === currentSession.id && draft.updated_at === currentSession.updated_at) {
      els.sessionNotesA.textContent = draft.notes_a || '';
      els.sessionNotesB.textContent = draft.notes_b || '';
      els.sessionTitle.value = draft.title || currentSession.title || '';
      setSessionStatus('Local draft restored', 'edit');
    } else {
      setSessionStatus('Session loaded', 'saved');
    }
    renderSessionList();
  }

  function applySessionToForm(){
    if (!currentSession) return;
    els.sessionDate.value = currentSession.session_date || todayString();
    els.sessionTitle.value = currentSession.title || defaultTitle(currentSession.session_date);
    els.sessionNotesA.textContent = currentSession.notes_a || '';
    els.sessionNotesB.textContent = currentSession.notes_b || '';
  }

  function readSessionFromForm(){
    var date = els.sessionDate.value || todayString();
    return {
      id: currentSession && currentSession.id,
      session_date: date,
      title: els.sessionTitle.value.trim() || defaultTitle(date),
      notes_a: els.sessionNotesA.textContent || '',
      notes_b: els.sessionNotesB.textContent || '',
      updated_at: nowIso()
    };
  }

  function readDraft(){
    try { return JSON.parse(localStorage.getItem(SESSION_DRAFT_KEY) || 'null'); } catch (err) { return null; }
  }

  function saveDraft(){
    if (!currentSession) return;
    var draft = readSessionFromForm();
    draft.updated_at = currentSession.updated_at || '';
    try { localStorage.setItem(SESSION_DRAFT_KEY, JSON.stringify(draft)); } catch (err) {}
  }

  async function saveSession(){
    if (!currentSession) newSession();
    var payload = readSessionFromForm();
    setSessionStatus('Saving session...', 'saving');

    if (!sessionsCloudReady) {
      saveSessionLocally(payload);
      renderSessionList();
      setSessionStatus('Session saved locally', 'saved');
      return;
    }

    try {
      var rows;
      if (payload.id) {
        rows = await rest('dm_sessions?id=eq.' + encode(payload.id) + '&select=*', {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: payload
        });
      } else {
        delete payload.id;
        rows = await rest('dm_sessions?select=*', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: payload
        });
      }
      sessionsCloudReady = true;
      currentSession = rows && rows[0] ? rows[0] : payload;
      upsertLocalSession(currentSession);
      localStorage.removeItem(SESSION_DRAFT_KEY);
      renderSessionList();
      setSessionStatus('Saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), 'saved');
    } catch (err) {
      sessionsCloudReady = false;
      saveSessionLocally(payload);
      renderSessionList();
      setSessionStatus(isSetupError(err) ? 'Run dm-screen-setup.sql' : 'Session saved locally', isSetupError(err) ? 'error' : 'saved');
      console.warn(err);
    }
  }

  function saveSessionLocally(payload){
    if (!payload.id) payload.id = 'local-' + Date.now().toString(36);
    currentSession = payload;
    upsertLocalSession(payload);
    saveDraft();
  }

  function upsertLocalSession(session){
    var found = false;
    sessions = sessions.map(function(s){
      if (s.id === session.id) {
        found = true;
        return session;
      }
      return s;
    });
    if (!found) sessions.unshift(session);
    sessions.sort(function(a, b){
      return String(b.session_date || '').localeCompare(String(a.session_date || '')) ||
        String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    });
    writeLocalSessions();
  }

  function renderSessionList(){
    if (!els.sessionList) return;
    if (!sessions.length) {
      els.sessionList.innerHTML = '<p class="dm-empty">No saved sessions yet.</p>';
      return;
    }
    els.sessionList.innerHTML = sessions.map(function(s){
      var active = currentSession && currentSession.id === s.id;
      var updated = s.updated_at ? new Date(s.updated_at).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      }) : 'Not saved';
      return [
        '<button type="button" class="dm-session-item ' + (active ? 'active' : '') + '" data-session-id="' + escapeHtml(s.id) + '">',
        '<span>' + escapeHtml(s.session_date || '') + '</span>',
        '<b>' + escapeHtml(s.title || 'Untitled Session') + '</b>',
        '<small>Edited ' + escapeHtml(updated) + '</small>',
        '</button>'
      ].join('');
    }).join('');
  }

  function clearCombat(){
    if (!confirm('Are you sure you want to clear combatants? Encounter notes will stay.')) return;
    snapshotCombat();
    combatState.combat_active = false;
    combatState.combatants = [];
    renderCombatants();
    queueCombatSave();
  }

  function restoreCombat(){
    if (!combatState.backup_state) return;
    var current = snapshotForRestore();
    var backup = combatState.backup_state;
    combatState.combat_active = !!backup.combat_active;
    combatState.round = backup.round || 1;
    combatState.combatants = Array.isArray(backup.combatants) ? backup.combatants : [];
    combatState.encounter_notes = typeof backup.encounter_notes === 'string' ? backup.encounter_notes : (combatState.encounter_notes || '');
    combatState.backup_state = current;
    renderCombatState();
    queueCombatSave();
  }

  function snapshotForRestore(){
    return {
      combat_active: !!combatState.combat_active,
      round: combatState.round,
      combatants: JSON.parse(JSON.stringify(combatState.combatants || [])),
      encounter_notes: combatState.encounter_notes || '',
      updated_at: combatState.updated_at || nowIso()
    };
  }

  function wireEvents(){
    els.dmUnlockForm.addEventListener('submit', function(evt){
      evt.preventDefault();
      if (normalizePassword(els.dmPassword.value) === normalizePassword(PASSWORD)) {
        els.dmLockError.textContent = '';
        unlock();
      } else {
        els.dmLockError.textContent = 'Access denied.';
      }
    });

    els.refreshPartyBtn.addEventListener('click', function(){ loadParty(false); });
    els.togglePcHpBtn.addEventListener('click', function(){
      pcHpVisible = !pcHpVisible;
      try { localStorage.setItem(PC_HP_VIS_KEY, pcHpVisible ? '1' : '0'); } catch (err) {}
      syncPcHpToggle();
      renderParty();
      renderCombatants();
    });
    els.newSessionBtn.addEventListener('click', newSession);
    els.saveSessionBtn.addEventListener('click', saveSession);
    els.reloadSessionsBtn.addEventListener('click', loadSessions);
    els.addPartyBtn.addEventListener('click', addParty);
    els.addCustomBtn.addEventListener('click', function(){ addCustom(); });
    els.clearCombatBtn.addEventListener('click', clearCombat);
    els.restoreCombatBtn.addEventListener('click', restoreCombat);
    els.combatLiveBtn.addEventListener('click', function(){
      combatState.combat_active = !combatState.combat_active;
      syncCombatLiveToggle();
      queueCombatSave();
    });
    els.roundMinusBtn.addEventListener('click', function(){
      combatState.round = Math.max(1, (parseInt(combatState.round, 10) || 1) - 1);
      renderCombatState();
      queueCombatSave();
    });
    els.roundPlusBtn.addEventListener('click', function(){
      combatState.round = Math.max(1, (parseInt(combatState.round, 10) || 1) + 1);
      renderCombatState();
      queueCombatSave();
    });
    els.roundInput.addEventListener('input', function(){
      combatState.round = Math.max(1, parseInt(els.roundInput.value, 10) || 1);
      queueCombatSave();
    });
    els.encounterNotes.addEventListener('input', function(){
      combatState.encounter_notes = els.encounterNotes.textContent || '';
      queueCombatSave();
    });

    [els.sessionDate, els.sessionTitle, els.sessionNotesA, els.sessionNotesB].forEach(function(el){
      el.addEventListener('input', function(){
        saveDraft();
        setSessionStatus('Draft saved locally', 'edit');
      });
    });

    els.sessionList.addEventListener('click', function(evt){
      var btn = evt.target.closest('[data-session-id]');
      if (btn) loadSession(btn.getAttribute('data-session-id'));
    });

    els.combatantsList.addEventListener('input', function(evt){
      var target = evt.target;
      var id = target.getAttribute('data-id');
      var fieldName = target.getAttribute('data-combat-field');
      if (!id || !fieldName) return;
      updateCombatField(id, fieldName, target.matches('[contenteditable]') ? target.textContent : target.value);
    });

    els.combatantsList.addEventListener('change', function(evt){
      var target = evt.target;
      if (target.getAttribute('data-id') && target.getAttribute('data-combat-field')) {
        renderCombatants();
      }
    });

    els.combatantsList.addEventListener('click', function(evt){
      var btn = evt.target.closest('[data-action]');
      if (!btn) return;
      handleCombatAction(btn.getAttribute('data-action'), btn.getAttribute('data-id'), btn);
    });

    document.addEventListener('paste', function(evt){
      var target = evt.target;
      if (!target || !target.matches('[data-plain]')) return;
      evt.preventDefault();
      var text = (evt.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });
  }

  async function startRealtime(){
    if (realtimeChannel || !hasCloudConfig()) return;
    try {
      var mod = await import(SUPABASE_JS_URL);
      realtimeClient = mod.createClient(config.supabaseUrl, config.supabaseKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      });
      realtimeChannel = realtimeClient
        .channel('aegis-dm-screen')
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'dm_state',
          filter: 'id=eq.main'
        }, function(payload){
          if (combatSaveTimer) return;
          combatState = normalizeCombatState(payload.new || {});
          writeLocalCombat();
          renderCombatState();
          setCombatStatus('Live synced', 'saved');
        })
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'characters'
        }, function(payload){
          var record = payload && payload.new;
          if (!record || !record.slug) return;
          characterMap[record.slug] = record;
          characters = characters.map(function(character){
            return character.slug === record.slug ? record : character;
          });
          renderParty();
          renderCombatants();
        })
        .subscribe(function(status, err){
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('Realtime unavailable; polling remains active.', err || status);
          }
        });
    } catch (err) {
      console.warn('Realtime unavailable; polling remains active.', err);
    }
  }

  async function initData(){
    await Promise.all([
      loadParty(false),
      loadCombatState(),
      loadSessions()
    ]);
    startRealtime();
    if (!partyPollTimer) {
      partyPollTimer = setInterval(function(){ loadParty(true); }, PARTY_POLL_MS);
    }
  }

  function init(){
    cacheEls();
    wireEvents();
    syncPcHpToggle();
    if (isUnlocked()) {
      unlock();
    } else {
      lock();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
