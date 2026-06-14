(function(){
  'use strict';

  var BUILD = window.AEGIS_BUILD || '20260614b';
  var SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
  var POLL_MS = 12000;
  var config = window.AEGIS_CLOUD || {};
  var characters = [];
  var characterMap = {};
  var combatState = {
    id: 'main',
    combat_active: false,
    round: 1,
    combatants: [],
    updated_at: ''
  };
  var realtimeClient = null;
  var realtimeChannel = null;
  var pollTimer = null;
  var els = {};

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

  function $(id){ return document.getElementById(id); }

  function cacheEls(){
    [
      'encounterStatus','encounterLivePill','encounterRound','encounterWaiting',
      'encounterBoard','encounterUpdated','encounterList'
    ].forEach(function(id){ els[id] = $(id); });
  }

  function hasCloudConfig(){
    return !!(config.supabaseUrl && config.supabaseKey);
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

  function setStatus(text, state){
    if (!els.encounterStatus) return;
    els.encounterStatus.textContent = text;
    els.encounterStatus.dataset.state = state || '';
  }

  async function rest(path){
    if (!hasCloudConfig()) throw new Error('Missing Supabase config.');
    var res = await fetch(apiUrl(path), {
      headers: headers({ 'Cache-Control': 'no-cache' }),
      cache: 'no-store'
    });
    if (!res.ok) throw new Error(res.status + ' ' + await res.text());
    return res.json();
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

  function escapeHtml(value){
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function encode(value){
    return encodeURIComponent(value == null ? '' : String(value));
  }

  function characterStats(character){
    var maxHp = asNumber(field(character, 'p1.maxhp'), 0);
    var currentHp = asNumber(field(character, 'p1.curhp'), maxHp);
    return {
      slug: character.slug,
      name: field(character, 'p1.name', character.name || character.slug),
      player: character.player_name || character.player || '',
      ac: field(character, 'p1.ac', '-'),
      currentHp: currentHp,
      maxHp: maxHp,
      speed: field(character, 'p1.speed', '-'),
      sheetUrl: 'sheet.html?app=' + BUILD + '&slug=' + encode(character.slug)
    };
  }

  function healthStatus(current, max){
    if (!max || max <= 0) return { label: 'Unknown', className: 'is-unknown' };
    if (current <= 0) return { label: 'Incapacitated', className: 'is-incapacitated' };
    if (current <= max / 2) return { label: 'Bloodied', className: 'is-bloodied' };
    return { label: 'Healthy', className: 'is-healthy' };
  }

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
    if (!items || !items.length) return '<div class="enc-conditions muted">No conditions</div>';
    return '<div class="enc-conditions">' + items.map(function(item){
      return '<span>' + escapeHtml(item) + '</span>';
    }).join('') + '</div>';
  }

  function deathCounts(character){
    var toggles = character && character.sheet_data && character.sheet_data.toggles ? character.sheet_data.toggles : {};
    function count(prefix){
      var total = 0;
      [1,2,3].forEach(function(i){
        if (toggles[prefix + i] === 1 || toggles[prefix + i] === true) total += 1;
      });
      return total;
    }
    return {
      successes: count('p1.death.ok'),
      failures: count('p1.death.f')
    };
  }

  function deathDots(kind, count){
    var dots = '';
    for (var i = 1; i <= 3; i += 1) {
      dots += '<span class="enc-death-dot ' + kind + (count >= i ? ' on' : '') + '"></span>';
    }
    return dots;
  }

  function deathSaveLine(character, stats){
    var counts = deathCounts(character);
    if (stats.currentHp > 0 && !counts.successes && !counts.failures) return '';
    return [
      '<div class="enc-death-line">',
      '<span>Death Saves</span>',
      '<b>Success</b>' + deathDots('success', counts.successes),
      '<b>Failure</b>' + deathDots('failure', counts.failures),
      '</div>'
    ].join('');
  }

  function statusBadge(status){
    return '<span class="enc-status-badge ' + status.className + '">' + escapeHtml(status.label) + '</span>';
  }

  function normalizeCombatState(row){
    return {
      id: row.id || 'main',
      combat_active: !!row.combat_active,
      round: Math.max(1, parseInt(row.round, 10) || 1),
      combatants: Array.isArray(row.combatants) ? row.combatants : [],
      updated_at: row.updated_at || ''
    };
  }

  async function loadParty(silent){
    try {
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
          sheet_data: { fields: {}, toggles: {} }
        };
      });
      characterMap = {};
      characters.forEach(function(c){ characterMap[c.slug] = c; });
      render();
    } catch (err) {
      if (!silent) setStatus('Party load failed', 'error');
      console.warn(err);
    }
  }

  async function loadCombatState(silent){
    try {
      var rows = await rest('dm_state?id=eq.main&select=*');
      if (rows && rows.length) combatState = normalizeCombatState(rows[0]);
      render();
      if (!silent) setStatus('Live feed loaded', 'saved');
    } catch (err) {
      if (!silent) setStatus('Encounter load failed', 'error');
      console.warn(err);
    }
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

  function isCustomHidden(row){
    var max = Math.max(0, asNumber(row.maxHp, 0));
    var current = asNumber(row.currentHp, 0);
    return !!row.defeated || (max > 0 && current <= 0);
  }

  function renderPc(row){
    var character = characterMap[row.slug] || { slug: row.slug, name: row.slug, sheet_data: { fields: {}, toggles: {} } };
    var s = characterStats(character);
    var status = healthStatus(s.currentHp, s.maxHp);
    return [
      '<article class="enc-card enc-pc">',
      '<div class="enc-init">' + escapeHtml(row.initiative || '-') + '</div>',
      '<div class="enc-main">',
      '<div class="enc-name-row"><a href="' + s.sheetUrl + '" target="_blank" rel="noopener">' + escapeHtml(s.name) + '</a><span>PC</span></div>',
      '<div class="enc-stat-row"><span>AC ' + escapeHtml(s.ac) + '</span><span>Speed ' + escapeHtml(s.speed) + '</span>' + statusBadge(status) + '</div>',
      conditionStrip(activeConditions(character)),
      deathSaveLine(character, s),
      '</div>',
      '</article>'
    ].join('');
  }

  function renderCustom(row){
    var current = asNumber(row.currentHp, 0);
    var max = Math.max(0, asNumber(row.maxHp, 0));
    var status = healthStatus(current, max);
    return [
      '<article class="enc-card enc-custom">',
      '<div class="enc-init">' + escapeHtml(row.initiative || '-') + '</div>',
      '<div class="enc-main">',
      '<div class="enc-name-row"><b>' + escapeHtml(row.name || 'Custom Combatant') + '</b><span>Combatant</span></div>',
      '<div class="enc-stat-row"><span>AC ' + escapeHtml(row.ac || '-') + '</span>' + statusBadge(status) + '</div>',
      conditionStrip(splitConditions(row.conditions)),
      '</div>',
      '</article>'
    ].join('');
  }

  function visibleCombatants(){
    return sortedCombatants().filter(function(row){
      return row.kind !== 'custom' || !isCustomHidden(row);
    });
  }

  function render(){
    if (!els.encounterList) return;
    var live = !!combatState.combat_active;
    var rows = visibleCombatants();
    els.encounterRound.textContent = live ? String(combatState.round || 1) : '-';
    els.encounterLivePill.textContent = live ? 'Combat Live' : 'Waiting';
    els.encounterLivePill.classList.toggle('on', live);
    els.encounterUpdated.textContent = combatState.updated_at
      ? 'Updated ' + new Date(combatState.updated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : 'Live sync ready';

    if (!live || !rows.length) {
      els.encounterWaiting.hidden = false;
      els.encounterBoard.hidden = true;
      return;
    }

    els.encounterWaiting.hidden = true;
    els.encounterBoard.hidden = false;
    els.encounterList.innerHTML = rows.map(function(row){
      return row.kind === 'pc' ? renderPc(row) : renderCustom(row);
    }).join('');
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
        .channel('aegis-encounter-viewer')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'dm_state',
          filter: 'id=eq.main'
        }, function(payload){
          if (payload.new) combatState = normalizeCombatState(payload.new);
          render();
          setStatus('Live synced', 'saved');
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
          render();
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

  async function boot(){
    cacheEls();
    if (!hasCloudConfig()) {
      setStatus('Missing cloud config', 'error');
      return;
    }
    setStatus('Loading encounter...', 'loading');
    await Promise.all([loadParty(true), loadCombatState(true)]);
    setStatus('Live feed loaded', 'saved');
    startRealtime();
    pollTimer = setInterval(function(){
      loadParty(true);
      loadCombatState(true);
    }, POLL_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
