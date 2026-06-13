(function(){
  'use strict';

  var config = window.AEGIS_CLOUD || {};
  var params = new URLSearchParams(window.location.search);
  var slug = params.get('slug') || '';
  var editKey = params.get('edit') || '';
  var isEdit = !!editKey;
  var currentCharacter = null;
  var saveTimer = null;
  var loading = true;
  var dirty = false;
  var saveInFlight = false;
  var pollTimer = null;
  var POLL_MS = 10000;
  var CACHE_PREFIX = 'aegis-cloud-character-v1:';
  var SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
  var realtimeClient = null;
  var realtimeChannel = null;

  function apiUrl(path){
    return config.supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + path;
  }

  function headers(extra){
    var h = {
      apikey: config.supabaseKey,
      Authorization: 'Bearer ' + config.supabaseKey,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    Object.keys(extra || {}).forEach(function(k){ h[k] = extra[k]; });
    return h;
  }

  function setStatus(text, state){
    var el = document.getElementById('cloudStatus');
    if (!el) return;
    el.textContent = text;
    el.dataset.state = state || '';
  }

  function setTitle(character){
    if (!character) return;
    document.title = character.name + ' - AEGIS Personnel Dossier';
    var existing = document.querySelector('[data-k="p1.name"]');
    if (existing && !existing.innerHTML.trim()) existing.innerHTML = character.name;
  }

  function encode(value){
    return encodeURIComponent(value);
  }

  function cacheKey(){
    return CACHE_PREFIX + slug;
  }

  function isSheetDataObject(data){
    return !!(data && typeof data === 'object' && !Array.isArray(data));
  }

  function readCachedCharacter(){
    if (!slug) return null;
    try {
      var cached = JSON.parse(localStorage.getItem(cacheKey()) || 'null');
      return cached && isSheetDataObject(cached.sheet_data) ? cached : null;
    } catch (err) {
      return null;
    }
  }

  function writeCachedCharacter(character){
    if (!slug || !character || !isSheetDataObject(character.sheet_data)) return;
    try {
      localStorage.setItem(cacheKey(), JSON.stringify({
        slug: character.slug || slug,
        name: character.name || slug,
        player_name: character.player_name || '',
        sheet_data: character.sheet_data || {},
        updated_at: character.updated_at || ''
      }));
    } catch (err) {}
  }

  function waitForSheetApi(){
    if (window.AegisSheet) return Promise.resolve(true);
    return new Promise(function(resolve){
      var tries = 0;
      var timer = setInterval(function(){
        tries += 1;
        if (window.AegisSheet) {
          clearInterval(timer);
          resolve(true);
        } else if (tries >= 40) {
          clearInterval(timer);
          resolve(false);
        }
      }, 50);
    });
  }

  async function fetchCharacter(silent){
    if (!slug) {
      setStatus('Local mode - no character selected', 'local');
      if (window.AegisSheet) window.AegisSheet.setReadOnly(false);
      return null;
    }

    if (!silent) setStatus('Loading ' + slug + '...', 'loading');
    var res = await fetch(apiUrl('characters?slug=eq.' + encode(slug) + '&select=slug,name,player_name,sheet_data,updated_at'), {
      headers: headers({ 'Cache-Control': 'no-cache' }),
      cache: 'no-store'
    });
    if (!res.ok) throw new Error('Load failed: ' + res.status + ' ' + await res.text());
    var rows = await res.json();
    if (!rows.length) throw new Error('No character found for slug: ' + slug);
    return rows[0];
  }

  function applyRemoteCharacter(character, options){
    if (!character || !window.AegisSheet) return;
    if (!isSheetDataObject(character.sheet_data)) return;
    currentCharacter = character;
    setTitle(character);
    window.AegisSheet.applyState(character.sheet_data || {}, { skipSave: true });
    window.AegisSheet.setReadOnly(!isEdit);
    if (!options || !options.cached) writeCachedCharacter(character);
  }

  function canApplyIncoming(){
    return !dirty && !saveInFlight && !saveTimer;
  }

  async function saveCharacterNow(){
    if (!slug || !editKey || !window.AegisSheet || loading) return;
    var state = window.AegisSheet.getState();
    setStatus('Saving...', 'saving');
    saveInFlight = true;
    try {
      var res = await fetch(apiUrl('characters?slug=eq.' + encode(slug) + '&select=slug,updated_at'), {
        method: 'PATCH',
        headers: headers({
          Prefer: 'return=representation',
          'x-edit-key': editKey
        }),
        cache: 'no-store',
        body: JSON.stringify({
          sheet_data: state,
          updated_at: new Date().toISOString()
        })
      });
      if (!res.ok) {
        setStatus('Save failed', 'error');
        throw new Error('Save failed: ' + res.status + ' ' + await res.text());
      }
      var rows = await res.json();
      if (!rows.length) {
        setStatus('Save denied - bad edit link', 'error');
        throw new Error('Save denied: edit key did not match this character.');
      }
      if (currentCharacter) {
        currentCharacter.sheet_data = state;
        currentCharacter.updated_at = rows[0].updated_at;
        writeCachedCharacter(currentCharacter);
      }
      dirty = false;
      setStatus('Saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), 'saved');
    } finally {
      saveInFlight = false;
    }
  }

  function queueSave(){
    if (!isEdit || loading) return;
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function(){
      saveTimer = null;
      saveCharacterNow().catch(function(err){ console.error(err); });
    }, 650);
  }

  async function refreshFromCloud(){
    if (!slug || loading || saveInFlight || saveTimer || dirty) return;
    try {
      var fresh = await fetchCharacter(true);
      if (!fresh) return;
      var oldStamp = currentCharacter && currentCharacter.updated_at;
      if (fresh.updated_at && fresh.updated_at !== oldStamp) {
        applyRemoteCharacter(fresh);
        setStatus(isEdit ? 'Updated from cloud' : 'Live updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), isEdit ? 'edit' : 'saved');
      }
    } catch (err) {
      console.warn('Cloud refresh failed:', err);
    }
  }

  function startPolling(){
    if (!slug || pollTimer) return;
    pollTimer = setInterval(refreshFromCloud, POLL_MS);
  }

  async function startRealtime(){
    if (!slug || realtimeChannel || !config.supabaseUrl || !config.supabaseKey) return;
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
        .channel('aegis-character-' + slug)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'characters',
          filter: 'slug=eq.' + slug
        }, function(payload){
          var record = payload && payload.new;
          if (!record || record.slug !== slug || !canApplyIncoming()) return;
          if (currentCharacter && record.updated_at && record.updated_at === currentCharacter.updated_at) return;
          fetchCharacter(true).then(function(fresh){
            if (!fresh || !canApplyIncoming()) return;
            applyRemoteCharacter(fresh);
            setStatus(isEdit ? 'Updated from cloud' : 'Live updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), isEdit ? 'edit' : 'saved');
          }).catch(function(err){
            console.warn('Realtime refresh failed; polling remains active.', err);
          });
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

  function wireResumeRefresh(){
    window.addEventListener('pageshow', function(evt){
      if (evt.persisted) refreshFromCloud();
    });
    document.addEventListener('visibilitychange', function(){
      if (!document.hidden) refreshFromCloud();
    });
  }

  function initExportImport(){
    var exportBtn = document.getElementById('exportBtn');
    var importBtn = document.getElementById('importBtn');
    var importFile = document.getElementById('importFile');

    if (exportBtn) exportBtn.addEventListener('click', function(){
      var state = window.AegisSheet ? window.AegisSheet.getState() : {};
      var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (slug || 'aegis-character') + '-sheet-save.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    if (importBtn && importFile) importBtn.addEventListener('click', function(){
      if (!isEdit) return alert('Open the secret edit link before importing.');
      importFile.click();
    });

    if (importFile) importFile.addEventListener('change', function(){
      var file = importFile.files && importFile.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(){
        try {
          var state = JSON.parse(reader.result);
          window.AegisSheet.applyState(state);
          queueSave();
        } catch (err) {
          alert('Import failed: invalid save file.');
        }
      };
      reader.readAsText(file);
      importFile.value = '';
    });
  }

  async function boot(){
    initExportImport();
    var ready = await waitForSheetApi();
    if (!ready) return setStatus('Sheet API unavailable', 'error');
    if (slug && !isEdit) window.AegisSheet.setReadOnly(true);
    var cachedApplied = false;

    var cached = readCachedCharacter();
    if (cached) {
      cachedApplied = true;
      applyRemoteCharacter(cached, { cached: true });
      setStatus('Refreshing cloud...', 'loading');
    } else if (slug) {
      window.AegisSheet.applyState({}, { skipSave: true });
    }

    try {
      currentCharacter = await fetchCharacter(cachedApplied);
      if (currentCharacter) {
        applyRemoteCharacter(currentCharacter);
        setStatus(isEdit ? 'Edit mode - saved to cloud' : 'View only', isEdit ? 'edit' : 'view');
      }
    } catch (err) {
      console.error(err);
      if (cachedApplied) {
        setStatus('Showing cached copy - cloud refresh failed', 'local');
      } else {
        setStatus(err.message, 'error');
        window.AegisSheet.setReadOnly(true);
      }
    } finally {
      loading = false;
    }

    window.AegisSheet.onChange(queueSave);
    startPolling();
    startRealtime();
    wireResumeRefresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
