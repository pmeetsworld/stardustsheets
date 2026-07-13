(function(){
  'use strict';

  var BUILD = window.AEGIS_BUILD || '20260712d';
  var SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.102.0/+esm';
  var POLL_MS = 12000;
  var FIELDS = window.AEGIS_FIELDS || {};
  var LIVE_FIELDS = FIELDS.live || {};
  var DEATH_SAVE_FIELDS = FIELDS.deathSaves || {};
  var CONDITION_PREFIX = FIELDS.conditionPrefix || 'p1.cond.';
  var CONDITION_LABELS = FIELDS.conditionLabels || {
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
  var realtimeRetryTimer = null;
  var realtimeRetryCount = 0;
  var REALTIME_RETRY_MAX = 3;
  var pollTimer = null;
  var els = {};

  function $(id){ return document.getElementById(id); }

  function cacheEls(){
    [
      'encounterStatus','encounterLivePill','encounterRound','encounterWaiting',
      'encounterBoard','encounterUpdated','encounterList','encounterReconnectBtn'
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
    var maxHp = asNumber(field(character, LIVE_FIELDS.maxHp || 'p1.maxhp'), 0);
    var currentHp = asNumber(field(character, LIVE_FIELDS.currentHp || 'p1.curhp'), maxHp);
    return {
      slug: character.slug,
      name: field(character, LIVE_FIELDS.name || 'p1.name', character.name || character.slug),
      player: character.player_name || character.player || '',
      currentHp: currentHp,
      maxHp: maxHp,
      speed: field(character, LIVE_FIELDS.speed || 'p1.speed', '-'),
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
      return toggles[CONDITION_PREFIX + key] === 1 || toggles[CONDITION_PREFIX + key] === true;
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
      successes: count(DEATH_SAVE_FIELDS.successPrefix || 'p1.death.ok'),
      failures: count(DEATH_SAVE_FIELDS.failurePrefix || 'p1.death.f')
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
      '<span class="enc-death-label">Death Saves</span>',
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
      return true;
    } catch (err) {
      if (!silent) setStatus('Party load failed', 'error');
      console.warn(err);
      return false;
    }
  }

  async function loadCombatState(silent){
    try {
      var rows = await rest('dm_state?id=eq.main&select=*');
      if (rows && rows.length) combatState = normalizeCombatState(rows[0]);
      render();
      if (!silent) setStatus('Live feed loaded', 'saved');
      return true;
    } catch (err) {
      if (!silent) setStatus('Encounter load failed', 'error');
      console.warn(err);
      return false;
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

  function combatantSide(value){
    return ['ally','neutral','foe'].indexOf(value) >= 0 ? value : 'foe';
  }

  function combatantSideLabel(value){
    value = combatantSide(value);
    return value.charAt(0).toUpperCase() + value.slice(1);
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
      '<article class="enc-card enc-pc is-ally">',
      '<div class="enc-init">' + escapeHtml(row.initiative || '-') + '</div>',
      '<div class="enc-name-cell"><a href="' + s.sheetUrl + '" target="_blank" rel="noopener">' + escapeHtml(s.name) + '</a><span class="enc-side-label is-ally">Ally</span></div>',
      '<div class="enc-status-cell">' + statusBadge(status) + '</div>',
      '<div class="enc-defense-cell"><span>Speed ' + escapeHtml(s.speed) + '</span></div>',
      conditionStrip(activeConditions(character)),
      deathSaveLine(character, s),
      '</article>'
    ].join('');
  }

  function renderCustom(row){
    var current = asNumber(row.currentHp, 0);
    var max = Math.max(0, asNumber(row.maxHp, 0));
    var status = healthStatus(current, max);
    var side = combatantSide(row.side);
    return [
      '<article class="enc-card enc-custom is-' + side + '">',
      '<div class="enc-init">' + escapeHtml(row.initiative || '-') + '</div>',
      '<div class="enc-name-cell"><b>' + escapeHtml(row.name || 'Custom Combatant') + '</b><span class="enc-side-label is-' + side + '">' + combatantSideLabel(side) + '</span></div>',
      '<div class="enc-status-cell">' + statusBadge(status) + '</div>',
      conditionStrip(splitConditions(row.conditions)),
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
    els.encounterUpdated.textContent = (rows.length ? rows.length + ' visible - ' : '') + (
      combatState.updated_at
        ? 'Updated ' + new Date(combatState.updated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : 'Live sync ready'
    );

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
      if (!realtimeClient) {
        var mod = await import(SUPABASE_JS_URL);
        realtimeClient = mod.createClient(config.supabaseUrl, config.supabaseKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
          }
        });
      }
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
          if (status === 'SUBSCRIBED') {
            realtimeRetryCount = 0;
            clearTimeout(realtimeRetryTimer);
            realtimeRetryTimer = null;
            setStatus('Live feed connected', 'saved');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            scheduleRealtimeRetry(err || status);
          }
        });
    } catch (err) {
      scheduleRealtimeRetry(err);
    }
  }

  async function stopRealtime(){
    clearTimeout(realtimeRetryTimer);
    realtimeRetryTimer = null;
    var channel = realtimeChannel;
    realtimeChannel = null;
    if (realtimeClient && channel && typeof realtimeClient.removeChannel === 'function') {
      try { await realtimeClient.removeChannel(channel); } catch (err) { console.warn('Realtime disconnect failed.', err); }
    } else if (channel && typeof channel.unsubscribe === 'function') {
      try { await channel.unsubscribe(); } catch (err) { console.warn('Realtime disconnect failed.', err); }
    }
  }

  function scheduleRealtimeRetry(reason){
    if (realtimeRetryTimer || realtimeRetryCount >= REALTIME_RETRY_MAX) {
      if (realtimeRetryCount >= REALTIME_RETRY_MAX) {
        console.warn('Realtime unavailable after retries; polling remains active.', reason);
        setStatus('Polling fallback active', 'loading');
      }
      return;
    }
    realtimeRetryCount += 1;
    setStatus('Realtime reconnecting...', 'loading');
    realtimeRetryTimer = setTimeout(function(){
      realtimeRetryTimer = null;
      stopRealtime().then(startRealtime).catch(function(err){
        scheduleRealtimeRetry(err);
      });
    }, 1800);
  }

  function setLoadResult(results){
    if (results.every(Boolean)) {
      setStatus('Live feed loaded', 'saved');
    } else if (results.some(Boolean)) {
      setStatus('Partial feed - retrying', 'loading');
    } else {
      setStatus('Cloud unavailable - retrying', 'error');
    }
  }

  async function refreshEncounter(showLoading){
    if (showLoading) setStatus('Reconnecting...', 'loading');
    var results = await Promise.all([loadParty(true), loadCombatState(true)]);
    setLoadResult(results);
    return results;
  }

  async function reconnectEncounter(){
    realtimeRetryCount = 0;
    await stopRealtime();
    await refreshEncounter(true);
    await startRealtime();
  }

  async function boot(){
    cacheEls();
    if (!hasCloudConfig()) {
      setStatus('Missing cloud config', 'error');
      return;
    }
    if (els.encounterReconnectBtn) {
      els.encounterReconnectBtn.addEventListener('click', reconnectEncounter);
    }
    await refreshEncounter(true);
    await startRealtime();
    pollTimer = setInterval(function(){
      refreshEncounter(false);
    }, POLL_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
