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

  function apiUrl(path){
    return config.supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + path;
  }

  function headers(extra){
    var h = {
      apikey: config.supabaseKey,
      Authorization: 'Bearer ' + config.supabaseKey,
      'Content-Type': 'application/json'
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

  async function fetchCharacter(){
    if (!slug) {
      setStatus('Local mode - no character selected', 'local');
      if (window.AegisSheet) window.AegisSheet.setReadOnly(false);
      return null;
    }

    setStatus('Loading ' + slug + '...', 'loading');
    var res = await fetch(apiUrl('characters?slug=eq.' + encode(slug) + '&select=slug,name,player_name,sheet_data,updated_at'), {
      headers: headers()
    });
    if (!res.ok) throw new Error('Load failed: ' + res.status + ' ' + await res.text());
    var rows = await res.json();
    if (!rows.length) throw new Error('No character found for slug: ' + slug);
    return rows[0];
  }

  async function saveCharacterNow(){
    if (!slug || !editKey || !window.AegisSheet || loading) return;
    var state = window.AegisSheet.getState();
    setStatus('Saving...', 'saving');
    var res = await fetch(apiUrl('characters?slug=eq.' + encode(slug) + '&select=slug,updated_at'), {
      method: 'PATCH',
      headers: headers({
        Prefer: 'return=representation',
        'x-edit-key': editKey
      }),
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
    setStatus('Saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), 'saved');
  }

  function queueSave(){
    if (!isEdit || loading) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function(){
      saveCharacterNow().catch(function(err){ console.error(err); });
    }, 650);
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
    if (!window.AegisSheet) return setStatus('Sheet API unavailable', 'error');

    try {
      currentCharacter = await fetchCharacter();
      if (currentCharacter) {
        setTitle(currentCharacter);
        window.AegisSheet.applyState(currentCharacter.sheet_data || {}, { skipSave: true });
        window.AegisSheet.setReadOnly(!isEdit);
        setStatus(isEdit ? 'Edit mode - saved to cloud' : 'View only', isEdit ? 'edit' : 'view');
      }
    } catch (err) {
      console.error(err);
      setStatus(err.message, 'error');
      window.AegisSheet.setReadOnly(true);
    } finally {
      loading = false;
    }

    window.AegisSheet.onChange(queueSave);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
