(function(){
  'use strict';

  var SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.102.0/+esm';
  var POLL_MS = 10000;
  var RETRY_LIMIT = 4;
  var config = window.AEGIS_CLOUD || {};
  var root = window.AEGIS_WORLD = window.AEGIS_WORLD || {};
  var client = null;
  var channel = null;
  var pollTimer = null;
  var retryTimer = null;
  var retryCount = 0;
  var refreshTimer = null;
  var refreshPromise = null;

  var store = {
    ready: false,
    loading: false,
    connected: false,
    error: '',
    lastSynced: '',
    world: {
      id: 'main',
      mode: 'encounter',
      active_map_id: null,
      active_scene_asset_id: null,
      movement_locked: false,
      scene_changing: false,
      rev: 0
    },
    turn: {
      id: 'main',
      combat_active: false,
      round: 1,
      order_ids: [],
      active_index: 0,
      delayed_ids: [],
      rev: 0
    },
    assets: [],
    maps: [],
    tokens: [],
    templates: [],
    defaults: [],
    characters: []
  };

  // --- Interaction guard (mirrors cloud-save.js canApplyIncoming pattern) ---
  // Modules register short-lived guards (e.g. an in-progress token drag).
  // While any guard is active, store refreshes are deferred so incoming
  // state cannot tear down DOM the user is interacting with.
  var interactionGuards = [];
  var lastTokenRevs = {};

  function registerGuard(fn){
    if (typeof fn === 'function') interactionGuards.push(fn);
  }

  function isInteracting(){
    for (var i = 0; i < interactionGuards.length; i += 1) {
      try { if (interactionGuards[i]()) return true; } catch (err) {}
    }
    return false;
  }

  function hasConfig(){
    return !!(config.supabaseUrl && config.supabaseKey);
  }

  function apiUrl(path){
    return String(config.supabaseUrl || '').replace(/\/$/, '') + '/rest/v1/' + path;
  }

  function headers(extra){
    var values = {
      apikey: config.supabaseKey || '',
      Authorization: 'Bearer ' + (config.supabaseKey || ''),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    };
    Object.keys(extra || {}).forEach(function(key){ values[key] = extra[key]; });
    return values;
  }

  async function request(path, options){
    if (!hasConfig()) throw new Error('Missing Supabase configuration.');
    var opts = Object.assign({
      method: 'GET',
      cache: 'no-store',
      headers: headers()
    }, options || {});
    opts.headers = headers((options && options.headers) || {});
    if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    var response = await fetch(apiUrl(path), opts);
    var text = await response.text();
    var data = text ? safeJson(text) : null;
    if (!response.ok) {
      var message = data && (data.message || data.error_description || data.error);
      throw new Error(message || response.status + ' ' + text);
    }
    return data;
  }

  function safeJson(value){
    try { return JSON.parse(value); } catch (err) { return value; }
  }

  async function rpc(name, payload){
    return request('rpc/' + encodeURIComponent(name), {
      method: 'POST',
      body: payload || {},
      headers: { Prefer: 'return=representation' }
    });
  }

  function normalizeArray(value){
    return Array.isArray(value) ? value : [];
  }

  function normalizeWorld(row){
    row = row || {};
    return {
      id: row.id || 'main',
      mode: row.mode === 'scene' ? 'scene' : 'encounter',
      active_map_id: row.active_map_id || null,
      active_scene_asset_id: row.active_scene_asset_id || null,
      movement_locked: !!row.movement_locked,
      scene_changing: !!row.scene_changing,
      rev: parseInt(row.rev, 10) || 0,
      updated_at: row.updated_at || ''
    };
  }

  function normalizeTurn(row){
    row = row || {};
    return {
      id: row.id || 'main',
      combat_active: !!row.combat_active,
      round: Math.max(1, parseInt(row.round, 10) || 1),
      order_ids: normalizeArray(row.order_ids).map(String),
      active_index: Math.max(0, parseInt(row.active_index, 10) || 0),
      delayed_ids: normalizeArray(row.delayed_ids).map(String),
      rev: parseInt(row.rev, 10) || 0,
      updated_at: row.updated_at || ''
    };
  }

  function emit(reason){
    document.dispatchEvent(new CustomEvent('aegis:world-state', {
      detail: { reason: reason || 'update', state: store }
    }));
  }

  // --- Stale/self-echo protection via per-row rev tracking ---

  function mergeTokens(fetched){
    var previous = {};
    store.tokens.forEach(function(token){ previous[token.id] = token; });
    var keep = {};
    var merged = fetched.map(function(token){
      var rev = parseInt(token.rev, 10) || 0;
      var known = lastTokenRevs[token.id] || 0;
      keep[token.id] = true;
      // A refetch that raced our own PATCH can return an older row; keep the
      // newer local copy instead of snapping the token back.
      if (rev < known && previous[token.id]) return previous[token.id];
      lastTokenRevs[token.id] = Math.max(known, rev);
      return token;
    });
    Object.keys(lastTokenRevs).forEach(function(id){
      if (!keep[id]) delete lastTokenRevs[id];
    });
    return merged;
  }

  // Applies a single authoritative token row (e.g. the PATCH response of a
  // move) without a full eight-table refetch.
  function applyTokenRow(row){
    if (!row || !row.id) return;
    var rev = parseInt(row.rev, 10) || 0;
    if (rev < (lastTokenRevs[row.id] || 0)) return;
    lastTokenRevs[row.id] = rev;
    var found = false;
    for (var i = 0; i < store.tokens.length; i += 1) {
      if (store.tokens[i].id === row.id) {
        store.tokens[i] = row;
        found = true;
        break;
      }
    }
    if (!found) store.tokens.push(row);
    emit('token-row');
  }

  function setConnection(connected, error){
    store.connected = !!connected;
    store.error = error ? String(error.message || error) : '';
    emit('connection');
  }

  async function refresh(reason){
    if (refreshPromise) return refreshPromise;
    // Defer (never drop) refreshes while the user is mid-interaction.
    if (store.ready && isInteracting()) {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(function(){
        refreshTimer = null;
        refresh(reason).catch(function(){});
      }, 600);
      return Promise.resolve(store);
    }
    store.loading = !store.ready;
    emit('loading');
    refreshPromise = Promise.all([
      request('world_state?id=eq.main&select=*'),
      request('world_turn_state?id=eq.main&select=*'),
      request('world_assets?select=*&order=created_at.desc'),
      request('world_maps?select=*&order=created_at.desc'),
      request('world_tokens?select=*&order=created_at.asc'),
      request('world_templates?select=*&order=created_at.asc'),
      request('character_token_defaults?select=*'),
      request('characters?select=slug,name,player_name,sheet_data,updated_at&is_public=eq.true')
    ]).then(function(results){
      // Never regress a singleton row to an older rev (stale echo/race).
      var world = normalizeWorld(results[0] && results[0][0]);
      if (!store.ready || world.rev >= store.world.rev) store.world = world;
      var turn = normalizeTurn(results[1] && results[1][0]);
      if (!store.ready || turn.rev >= store.turn.rev) store.turn = turn;
      store.assets = normalizeArray(results[2]);
      store.maps = normalizeArray(results[3]);
      store.tokens = mergeTokens(normalizeArray(results[4]));
      store.templates = normalizeArray(results[5]);
      store.defaults = normalizeArray(results[6]);
      store.characters = normalizeArray(results[7]);
      store.ready = true;
      store.loading = false;
      store.error = '';
      store.lastSynced = new Date().toISOString();
      emit(reason || 'refresh');
      return store;
    }).catch(function(err){
      store.loading = false;
      store.error = String(err && err.message || err);
      emit('error');
      throw err;
    }).finally(function(){
      refreshPromise = null;
    });
    return refreshPromise;
  }

  function scheduleRefresh(reason){
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function(){
      refreshTimer = null;
      refresh(reason || 'realtime').catch(function(err){
        console.warn('World refresh failed.', err);
      });
    }, 90);
  }

  // Character sheet autosaves fire a realtime event per keystroke batch.
  // Refetch only the characters feed for those instead of all eight tables.
  var characterTimer = null;

  function scheduleCharacterRefresh(){
    clearTimeout(characterTimer);
    characterTimer = setTimeout(function(){
      characterTimer = null;
      request('characters?select=slug,name,player_name,sheet_data,updated_at&is_public=eq.true')
        .then(function(rows){
          store.characters = normalizeArray(rows);
          emit('characters');
        })
        .catch(function(err){
          console.warn('Character refresh failed.', err);
        });
    }, 200);
  }

  async function stopRealtime(){
    clearTimeout(retryTimer);
    retryTimer = null;
    var current = channel;
    channel = null;
    if (client && current && typeof client.removeChannel === 'function') {
      try { await client.removeChannel(current); } catch (err) {}
    } else if (current && typeof current.unsubscribe === 'function') {
      try { await current.unsubscribe(); } catch (err) {}
    }
  }

  function retryRealtime(reason){
    setConnection(false, reason);
    if (retryTimer || retryCount >= RETRY_LIMIT) return;
    retryCount += 1;
    retryTimer = setTimeout(function(){
      retryTimer = null;
      stopRealtime().then(startRealtime).catch(function(err){
        retryRealtime(err);
      });
    }, Math.min(8000, 1200 * retryCount));
  }

  async function startRealtime(){
    if (!hasConfig() || channel) return;
    try {
      if (!client) {
        var mod = await import(SUPABASE_JS_URL);
        client = mod.createClient(config.supabaseUrl, config.supabaseKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storageKey: 'aegis-world-auth-v1'
          }
        });
      }

      channel = client.channel('aegis-world-' + Math.random().toString(36).slice(2));
      [
        'world_state',
        'world_turn_state',
        'world_assets',
        'world_maps',
        'world_tokens',
        'world_templates',
        'characters'
      ].forEach(function(table){
        channel.on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: table
        }, function(){
          if (table === 'characters') scheduleCharacterRefresh();
          else scheduleRefresh('realtime:' + table);
        });
      });

      channel.subscribe(function(status, err){
        if (status === 'SUBSCRIBED') {
          retryCount = 0;
          setConnection(true);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          retryRealtime(err || status);
        }
      });
    } catch (err) {
      retryRealtime(err);
    }
  }

  function assetUrl(path){
    if (!path) return '';
    return String(config.supabaseUrl || '').replace(/\/$/, '') +
      '/storage/v1/object/public/world/' +
      String(path).split('/').map(encodeURIComponent).join('/');
  }

  function activeMap(){
    return store.maps.find(function(map){ return map.id === store.world.active_map_id; }) || null;
  }

  function activeMapAsset(){
    var map = activeMap();
    return map ? store.assets.find(function(asset){ return asset.id === map.asset_id; }) || null : null;
  }

  function activeSceneAsset(){
    return store.assets.find(function(asset){
      return asset.id === store.world.active_scene_asset_id;
    }) || null;
  }

  function character(slug){
    return store.characters.find(function(item){ return item.slug === slug; }) || null;
  }

  function token(id){
    return store.tokens.find(function(item){ return item.id === id; }) || null;
  }

  function activeToken(){
    var id = store.turn.order_ids[store.turn.active_index] || '';
    return token(id);
  }

  async function moveToken(tokenRow, x, y){
    if (!tokenRow || !tokenRow.id) throw new Error('Missing token.');
    var expected = parseInt(tokenRow.rev, 10) || 0;
    var rows = await request(
      'world_tokens?id=eq.' + encodeURIComponent(tokenRow.id) +
      '&rev=eq.' + expected +
      '&select=*',
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: {
          x: x,
          y: y,
          rev: expected + 1,
          updated_at: new Date().toISOString()
        }
      }
    );
    if (!rows || !rows.length) {
      await refresh('move-conflict');
      throw new Error('Token moved elsewhere. The board has been refreshed.');
    }
    // Apply the confirmed row locally so the mover sees the final position
    // immediately and later echoes of older revs are ignored.
    applyTokenRow(rows[0]);
    return rows[0];
  }

  async function insertTemplate(payload){
    var rows = await request('world_templates?select=*', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: payload
    });
    return rows && rows[0];
  }

  async function updateTemplate(id, patch){
    var rows = await request(
      'world_templates?id=eq.' + encodeURIComponent(id) + '&select=*',
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: Object.assign({}, patch, { updated_at: new Date().toISOString() })
      }
    );
    return rows && rows[0];
  }

  async function deleteTemplate(id){
    return request('world_templates?id=eq.' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' }
    });
  }

  function init(){
    if (!hasConfig()) {
      store.error = 'Cloud configuration is missing.';
      emit('error');
      return;
    }
    refresh('initial').catch(function(err){
      console.warn('World initial load failed.', err);
    });
    startRealtime();
    if (!pollTimer) {
      pollTimer = setInterval(function(){
        refresh('poll').catch(function(err){
          console.warn('World polling refresh failed.', err);
        });
      }, POLL_MS);
    }
  }

  window.addEventListener('visibilitychange', function(){
    if (document.visibilityState === 'visible') {
      refresh('visible').catch(function(){});
      if (!channel) startRealtime();
    }
  });

  window.addEventListener('pageshow', function(evt){
    if (evt.persisted) refresh('pageshow').catch(function(){});
  });

  root.api = {
    store: store,
    request: request,
    rpc: rpc,
    refresh: refresh,
    startRealtime: startRealtime,
    stopRealtime: stopRealtime,
    assetUrl: assetUrl,
    activeMap: activeMap,
    activeMapAsset: activeMapAsset,
    activeSceneAsset: activeSceneAsset,
    character: character,
    token: token,
    activeToken: activeToken,
    moveToken: moveToken,
    applyTokenRow: applyTokenRow,
    registerGuard: registerGuard,
    isInteracting: isInteracting,
    insertTemplate: insertTemplate,
    updateTemplate: updateTemplate,
    deleteTemplate: deleteTemplate,
    getClient: function(){ return client; },
    config: config
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
