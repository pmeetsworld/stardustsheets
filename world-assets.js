(function(){
  'use strict';

  var SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.102.0/+esm';
  var root = window.AEGIS_WORLD = window.AEGIS_WORLD || {};
  var api = root.api;
  var utils = null;
  var host = null;
  var role = 'player';
  var drawer = null;
  var uploadClient = null;
  var updateTimer = null;

  function option(value, label, selected){
    return '<option value="' + utils.escapeHtml(value || '') + '"' + (selected ? ' selected' : '') + '>' + utils.escapeHtml(label) + '</option>';
  }

  function assetName(asset){
    return asset.name || asset.storage_path || 'Untitled Asset';
  }

  function formatBytes(bytes){
    bytes = Number(bytes) || 0;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function activeMap(){
    return api.activeMap();
  }

  function activeMapId(){
    var select = drawer && drawer.querySelector('#worldActiveMap');
    return api.store.world.active_map_id || (select && select.value) || '';
  }

  function render(){
    if (!drawer || role !== 'dm') return;
    var mapRow = activeMap();
    var mapAssets = api.store.maps.map(function(map){
      var asset = api.store.assets.find(function(item){ return item.id === map.asset_id; });
      return option(map.id, map.title || (asset && assetName(asset)) || 'Map', map.id === api.store.world.active_map_id);
    }).join('');
    var sceneAssets = api.store.assets.filter(function(asset){ return asset.kind === 'scene'; }).map(function(asset){
      return option(asset.id, assetName(asset), asset.id === api.store.world.active_scene_asset_id);
    }).join('');
    var tokenAssets = api.store.assets.filter(function(asset){ return asset.kind === 'token'; });
    var activeTokens = api.store.tokens.filter(function(token){ return token.map_id === api.store.world.active_map_id; });
    var templates = api.store.templates.filter(function(template){
      return template.map_id === api.store.world.active_map_id;
    });

    drawer.innerHTML = [
      '<div class="world-dm-drawer-head"><span>World Controls</span><button type="button" data-world-drawer-close aria-label="Close">×</button></div>',
      '<section class="world-control-section">',
        '<h3>Presentation</h3>',
        '<label><span>Active Map</span><select id="worldActiveMap"><option value="">No map</option>' + mapAssets + '</select></label>',
        '<label><span>Active Scene</span><select id="worldActiveScene"><option value="">No scene</option>' + sceneAssets + '</select></label>',
        '<div class="world-control-actions"><button type="button" data-activate="map">Show Map</button><button type="button" data-activate="scene">Show Scene</button></div>',
      '</section>',

      '<section class="world-control-section">',
        '<h3>Combatants</h3>',
        '<div class="world-control-actions"><button type="button" data-world-admin="add-party">Add Party</button><button type="button" data-world-admin="clear-board">Clear Board</button></div>',
        '<form id="worldCustomTokenForm" class="world-custom-form">',
          '<input name="name" type="text" placeholder="Combatant name" required>',
          '<select name="kind"><option value="foe">Foe</option><option value="ally">Ally</option><option value="neutral">Neutral</option></select>',
          '<select name="size"><option value="medium">Medium</option><option value="large">Large</option><option value="huge">Huge</option><option value="gargantuan">Gargantuan</option></select>',
          '<input name="armor_class" type="text" placeholder="AC">',
          '<input name="max_hp" type="number" min="0" placeholder="Max HP">',
          '<button type="submit">Stage Combatant</button>',
        '</form>',
        '<div class="world-token-editor-list">',
          activeTokens.map(function(token){
            return [
              '<details class="world-token-editor" data-edit-token="' + utils.escapeHtml(token.id) + '">',
                '<summary><span>' + utils.escapeHtml(token.name) + '</span><small>' + utils.escapeHtml(token.kind) + ' · ' + utils.escapeHtml(token.size) + (token.staged ? ' · staged' : '') + '</small></summary>',
                '<div class="world-token-editor-grid">',
                  '<label><span>Name</span><input data-token-property="name" value="' + utils.escapeHtml(token.name) + '"></label>',
                  '<label><span>Side</span><select data-token-property="kind">' +
                    ['pc','ally','neutral','foe'].map(function(kind){ return option(kind, kind, token.kind === kind); }).join('') +
                  '</select></label>',
                  '<label><span>Size</span><select data-token-property="size">' +
                    ['medium','large','huge','gargantuan'].map(function(size){ return option(size, size, token.size === size); }).join('') +
                  '</select></label>',
                  '<label><span>Init Mod</span><input type="number" data-token-property="init_mod" value="' + Number(token.init_mod || 0) + '"></label>',
                  token.kind !== 'pc' ? [
                    '<label><span>AC</span><input data-token-property="armor_class" value="' + utils.escapeHtml(token.armor_class || '') + '"></label>',
                    '<label><span>Current HP</span><input type="number" data-token-property="current_hp" value="' + Number(token.current_hp || 0) + '"></label>',
                    '<label><span>Max HP</span><input type="number" data-token-property="max_hp" value="' + Number(token.max_hp || 0) + '"></label>',
                    '<label class="wide"><span>Conditions</span><input data-token-property="conditions" value="' + utils.escapeHtml(token.conditions || '') + '"></label>',
                    '<label class="wide"><span>Notes</span><textarea data-token-property="notes">' + utils.escapeHtml(token.notes || '') + '</textarea></label>'
                  ].join('') : '',
                '</div>',
                '<div class="world-control-actions"><button type="button" data-save-token>Save</button><button type="button" data-delete-token>Delete</button></div>',
              '</details>'
            ].join('');
          }).join('') || '<p class="world-empty-copy">No tokens on the active map.</p>',
        '</div>',
      '</section>',

      '<section class="world-control-section">',
        '<h3>Grid Calibration</h3>',
        mapRow ? [
          '<form id="worldGridForm" class="world-grid-form">',
            '<input type="hidden" name="id" value="' + utils.escapeHtml(mapRow.id) + '">',
            '<label><span>Cell px</span><input name="cell_px" type="number" step="0.1" min="4" value="' + Number(mapRow.cell_px || 70) + '"></label>',
            '<label><span>X offset</span><input name="offset_x" type="number" step="0.5" value="' + Number(mapRow.offset_x || 0) + '"></label>',
            '<label><span>Y offset</span><input name="offset_y" type="number" step="0.5" value="' + Number(mapRow.offset_y || 0) + '"></label>',
            '<label><span>Fine scale</span><input name="grid_scale" type="number" step="0.001" min="0.1" value="' + Number(mapRow.grid_scale || 1) + '"></label>',
            '<label><span>Opacity</span><input name="grid_opacity" type="range" min="0" max="1" step="0.05" value="' + Number(mapRow.grid_opacity == null ? 0.5 : mapRow.grid_opacity) + '"></label>',
            '<label><span>Color</span><input name="grid_color" type="color" value="' + utils.escapeHtml(mapRow.grid_color || '#7f99bd') + '"></label>',
            '<label><span>Diagonal</span><select name="diagonal_rule">' +
              option('five', '5 ft', mapRow.diagonal_rule === 'five') +
              option('seven_five', '7.5 ft', mapRow.diagonal_rule === 'seven_five') +
              option('alternating', '5 / 10 ft', mapRow.diagonal_rule === 'alternating') +
            '</select></label>',
            '<label><span>Feet / cell</span><input name="feet_per_cell" type="number" min="1" value="' + Number(mapRow.feet_per_cell || 5) + '"></label>',
            '<label class="world-check"><input name="grid_visible" type="checkbox"' + (mapRow.grid_visible ? ' checked' : '') + '><span>Grid visible</span></label>',
            '<label class="world-check"><input name="snap_enabled" type="checkbox"' + (mapRow.snap_enabled ? ' checked' : '') + '><span>Snap enabled</span></label>',
            '<button type="submit">Save Grid</button>',
          '</form>'
        ].join('') : '<p class="world-empty-copy">Activate a map to calibrate its square grid.</p>',
      '</section>',

      '<section class="world-control-section">',
        '<h3>Asset Library</h3>',
        '<form id="worldUploadForm" class="world-upload-form">',
          '<select name="kind"><option value="map">Map</option><option value="scene">Scene</option><option value="token">Token</option></select>',
          '<input name="file" type="file" accept="image/*" required>',
          '<button type="submit">Upload Original</button>',
        '</form>',
        '<p class="world-upload-status" id="worldUploadStatus">Files are stored byte-for-byte at full quality.</p>',
        '<div class="world-asset-list">',
          api.store.assets.map(function(asset){
            return [
              '<article class="world-asset-row" data-asset-id="' + utils.escapeHtml(asset.id) + '">',
                '<span class="world-asset-preview" style="background-image:url(\'' + api.assetUrl(asset.storage_path).replace(/'/g, '%27') + '\')"></span>',
                '<span><b>' + utils.escapeHtml(assetName(asset)) + '</b><small>' + utils.escapeHtml(asset.kind) + ' · ' + Number(asset.natural_w || 0) + '×' + Number(asset.natural_h || 0) + ' · ' + formatBytes(asset.bytes) + '</small></span>',
                asset.kind === 'token' ? '<select data-default-character><option value="">Assign token...</option>' +
                  (api.config.characters || []).map(function(character){ return option(character.slug, character.name, false); }).join('') + '</select>' : '',
                '<button type="button" data-delete-asset title="Delete asset">×</button>',
              '</article>'
            ].join('');
          }).join('') || '<p class="world-empty-copy">No shared assets uploaded.</p>',
        '</div>',
      '</section>',

      '<section class="world-control-section">',
        '<h3>Templates</h3>',
        '<div class="world-template-admin-list">',
          templates.map(function(template){
            return '<div data-template-id="' + utils.escapeHtml(template.id) + '"><span>' + utils.escapeHtml(template.shape) + (template.owner_slug ? ' · ' + utils.escapeHtml(template.owner_slug) : '') + '</span>' +
              '<button type="button" data-pin-template>' + (template.pinned ? 'Unpin' : 'Pin') + '</button><button type="button" data-delete-template>×</button></div>';
          }).join('') || '<p class="world-empty-copy">No templates on this map.</p>',
        '</div>',
      '</section>'
    ].join('');
  }

  async function privileged(name, payload){
    var secret = await root.access.requireDmSecret();
    var result = await api.rpc(name, Object.assign({ p_secret: secret }, payload || {}));
    if (!result || !result.ok) throw new Error(result && result.error || name + ' failed.');
    return { secret: secret, result: result };
  }

  function preload(url){
    if (!url) return Promise.resolve();
    return new Promise(function(resolve){
      var image = new Image();
      image.onload = image.onerror = function(){ resolve(); };
      image.src = url;
    });
  }

  async function activate(kind){
    var select = document.getElementById(kind === 'map' ? 'worldActiveMap' : 'worldActiveScene');
    var id = select && select.value || '';
    try {
      var secret = await root.access.requireDmSecret();
      var start = await api.rpc('world_set_state', {
        p_secret: secret,
        p_expected_rev: api.store.world.rev,
        p_patch: { scene_changing: true }
      });
      if (!start || !start.ok) throw new Error(start && start.error || 'Transition failed.');
      await api.refresh('transition-start');
      var asset;
      if (kind === 'map') {
        var map = api.store.maps.find(function(item){ return item.id === id; });
        asset = map && api.store.assets.find(function(item){ return item.id === map.asset_id; });
      } else {
        asset = api.store.assets.find(function(item){ return item.id === id; });
      }
      await preload(asset && api.assetUrl(asset.storage_path));
      var patch = { scene_changing: false, mode: kind === 'map' ? 'encounter' : 'scene' };
      patch[kind === 'map' ? 'active_map_id' : 'active_scene_asset_id'] = id || null;
      var finish = await api.rpc('world_set_state', {
        p_secret: secret,
        p_expected_rev: api.store.world.rev,
        p_patch: patch
      });
      if (!finish || !finish.ok) throw new Error(finish && finish.error || 'Activation failed.');
      await api.refresh('activate-' + kind);
      document.getElementById('worldDmDrawer').classList.remove('open');
    } catch (err) {
      root.access.toast(err.message || String(err), 'error');
    }
  }

  function imageDimensions(file){
    return new Promise(function(resolve, reject){
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function(){
        var dimensions = { width: image.naturalWidth, height: image.naturalHeight };
        URL.revokeObjectURL(url);
        resolve(dimensions);
      };
      image.onerror = function(){
        URL.revokeObjectURL(url);
        reject(new Error('Image dimensions could not be read.'));
      };
      image.src = url;
    });
  }

  function safeFileName(name){
    var extension = String(name || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'img';
    var base = String(name || 'asset').replace(/\.[^.]+$/, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'asset';
    return base + '-' + Date.now() + '.' + extension;
  }

  async function edgeRequest(secret, payload){
    var response = await fetch(String(api.config.supabaseUrl).replace(/\/$/, '') + '/functions/v1/world-assets', {
      method: 'POST',
      headers: {
        apikey: api.config.supabaseKey,
        'Content-Type': 'application/json',
        'x-world-secret': secret
      },
      body: JSON.stringify(payload)
    });
    var data = await response.json().catch(function(){ return {}; });
    if (!response.ok || !data.ok) throw new Error(data.error || 'Asset service failed.');
    return data;
  }

  async function ensureUploadClient(){
    if (api.getClient()) return api.getClient();
    if (uploadClient) return uploadClient;
    var mod = await import(SUPABASE_JS_URL);
    uploadClient = mod.createClient(api.config.supabaseUrl, api.config.supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'aegis-world-upload-auth-v1'
      }
    });
    return uploadClient;
  }

  async function upload(form){
    var status = document.getElementById('worldUploadStatus');
    var file = form.elements.file.files[0];
    var kind = form.elements.kind.value;
    if (!file) return;
    status.textContent = 'Reading original image...';
    try {
      var dimensions = await imageDimensions(file);
      var secret = await root.access.requireDmSecret();
      var path = kind + 's/' + safeFileName(file.name);
      status.textContent = 'Requesting secure upload...';
      var signed = await edgeRequest(secret, { action: 'sign-upload', path: path });
      var client = await ensureUploadClient();
      status.textContent = 'Uploading ' + dimensions.width + '×' + dimensions.height + ' · ' + formatBytes(file.size) + '...';
      var result = await client.storage.from('world').uploadToSignedUrl(path, signed.token, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false
      });
      if (result.error) throw result.error;
      var registered = await api.rpc('world_register_asset', {
        p_secret: secret,
        p_payload: {
          kind: kind,
          name: file.name.replace(/\.[^.]+$/, ''),
          storage_path: path,
          mime_type: file.type,
          natural_w: dimensions.width,
          natural_h: dimensions.height,
          bytes: file.size
        }
      });
      if (!registered || !registered.ok) throw new Error(registered && registered.error || 'Asset registration failed.');
      if (kind === 'map') {
        var created = await api.rpc('world_upsert_map', {
          p_secret: secret,
          p_payload: {
            asset_id: registered.asset.id,
            title: registered.asset.name,
            grid_type: 'square',
            diagonal_rule: 'seven_five'
          }
        });
        if (!created || !created.ok) throw new Error(created && created.error || 'Map registration failed.');
      }
      status.textContent = 'Original uploaded unchanged: ' + dimensions.width + '×' + dimensions.height + ' · ' + formatBytes(file.size);
      form.reset();
      await api.refresh('asset-upload');
    } catch (err) {
      status.textContent = err.message || String(err);
      root.access.toast(status.textContent, 'error');
    }
  }

  async function saveGrid(form){
    var data = new FormData(form);
    var payload = {
      id: data.get('id'),
      grid_type: 'square',
      cell_px: data.get('cell_px'),
      offset_x: data.get('offset_x'),
      offset_y: data.get('offset_y'),
      grid_scale: data.get('grid_scale'),
      grid_opacity: data.get('grid_opacity'),
      grid_color: data.get('grid_color'),
      diagonal_rule: data.get('diagonal_rule'),
      feet_per_cell: data.get('feet_per_cell'),
      grid_visible: form.elements.grid_visible.checked,
      snap_enabled: form.elements.snap_enabled.checked
    };
    try {
      await privileged('world_upsert_map', { p_payload: payload });
      await api.refresh('grid-save');
      root.access.toast('Grid calibration saved', 'saved');
    } catch (err) {
      root.access.toast(err.message || String(err), 'error');
    }
  }

  async function addParty(){
    var mapId = activeMapId();
    if (!mapId) return root.access.toast('Activate a map first.', 'error');
    try {
      await privileged('world_add_party', { p_map_id: mapId });
      await api.refresh('add-party');
    } catch (err) {
      root.access.toast(err.message || String(err), 'error');
    }
  }

  async function addCustom(form){
    var mapId = activeMapId();
    if (!mapId) return root.access.toast('Activate a map first.', 'error');
    var data = new FormData(form);
    var max = Number(data.get('max_hp') || 0);
    try {
      await privileged('world_create_token', {
        p_payload: {
          map_id: mapId,
          kind: data.get('kind'),
          name: data.get('name'),
          size: data.get('size'),
          armor_class: data.get('armor_class'),
          current_hp: max,
          max_hp: max,
          staged: true,
          locked: true
        }
      });
      form.reset();
      await api.refresh('add-custom');
    } catch (err) {
      root.access.toast(err.message || String(err), 'error');
    }
  }

  async function saveToken(details){
    var payload = {};
    details.querySelectorAll('[data-token-property]').forEach(function(input){
      payload[input.getAttribute('data-token-property')] = input.value;
    });
    try {
      await privileged('world_update_token', {
        p_token_id: details.getAttribute('data-edit-token'),
        p_payload: payload
      });
      await api.refresh('token-edit');
    } catch (err) {
      root.access.toast(err.message || String(err), 'error');
    }
  }

  async function deleteToken(details){
    var token = api.token(details.getAttribute('data-edit-token'));
    if (!token) return;
    var confirmed = await root.access.confirm('Delete Token', 'Remove ' + token.name + ' from this map?', 'Delete');
    if (!confirmed) return;
    try {
      await privileged('world_delete_token', { p_token_id: token.id });
      await api.refresh('token-delete');
    } catch (err) {
      root.access.toast(err.message || String(err), 'error');
    }
  }

  async function clearBoard(){
    var tokens = api.store.tokens.filter(function(token){ return token.map_id === api.store.world.active_map_id; });
    if (!tokens.length) return;
    var confirmed = await root.access.confirm('Clear Board', 'Delete all tokens from the active map?', 'Clear Board');
    if (!confirmed) return;
    try {
      var secret = await root.access.requireDmSecret();
      for (var i = 0; i < tokens.length; i += 1) {
        await api.rpc('world_delete_token', { p_secret: secret, p_token_id: tokens[i].id });
      }
      await api.refresh('clear-board');
    } catch (err) {
      root.access.toast(err.message || String(err), 'error');
    }
  }

  async function templateAction(button){
    var row = button.closest('[data-template-id]');
    var template = api.store.templates.find(function(item){ return item.id === row.getAttribute('data-template-id'); });
    if (!template) return;
    try {
      if (button.matches('[data-delete-template]')) {
        await api.deleteTemplate(template.id);
      } else {
        await api.updateTemplate(template.id, { pinned: !template.pinned, expires_at: null });
      }
      await api.refresh('template-admin');
    } catch (err) {
      root.access.toast(err.message || String(err), 'error');
    }
  }

  async function deleteAsset(button){
    var row = button.closest('[data-asset-id]');
    var asset = api.store.assets.find(function(item){ return item.id === row.getAttribute('data-asset-id'); });
    if (!asset) return;
    var confirmed = await root.access.confirm('Delete Asset', 'Permanently delete ' + assetName(asset) + '?', 'Delete');
    if (!confirmed) return;
    try {
      var secret = await root.access.requireDmSecret();
      await edgeRequest(secret, { action: 'delete', path: asset.storage_path });
      var result = await api.rpc('world_delete_asset', { p_secret: secret, p_asset_id: asset.id });
      if (!result || !result.ok) throw new Error(result && result.error || 'Metadata deletion failed.');
      await api.refresh('asset-delete');
    } catch (err) {
      root.access.toast(err.message || String(err), 'error');
    }
  }

  async function assignDefault(select){
    if (!select.value) return;
    var row = select.closest('[data-asset-id]');
    try {
      await privileged('world_set_character_token', {
        p_slug: select.value,
        p_art_asset_id: row.getAttribute('data-asset-id'),
        p_size: 'medium'
      });
      await api.refresh('token-default');
      root.access.toast('Default token assigned', 'saved');
    } catch (err) {
      root.access.toast(err.message || String(err), 'error');
    }
  }

  function wire(){
    drawer.addEventListener('click', function(evt){
      if (evt.target.closest('[data-world-drawer-close]')) {
        drawer.classList.remove('open');
        return;
      }
      var activateButton = evt.target.closest('[data-activate]');
      if (activateButton) return activate(activateButton.getAttribute('data-activate'));
      if (evt.target.closest('[data-world-admin="add-party"]')) return addParty();
      if (evt.target.closest('[data-world-admin="clear-board"]')) return clearBoard();
      var save = evt.target.closest('[data-save-token]');
      if (save) return saveToken(save.closest('[data-edit-token]'));
      var removeToken = evt.target.closest('[data-delete-token]');
      if (removeToken) return deleteToken(removeToken.closest('[data-edit-token]'));
      var templateButton = evt.target.closest('[data-pin-template],[data-delete-template]');
      if (templateButton) return templateAction(templateButton);
      var assetButton = evt.target.closest('[data-delete-asset]');
      if (assetButton) return deleteAsset(assetButton);
    });
    drawer.addEventListener('submit', function(evt){
      evt.preventDefault();
      if (evt.target.id === 'worldUploadForm') upload(evt.target);
      if (evt.target.id === 'worldGridForm') saveGrid(evt.target);
      if (evt.target.id === 'worldCustomTokenForm') addCustom(evt.target);
    });
    drawer.addEventListener('change', function(evt){
      if (evt.target.matches('[data-default-character]')) assignDefault(evt.target);
    });
  }

  function preloadCurrent(){
    [api.activeMapAsset(), api.activeSceneAsset()].filter(Boolean).forEach(function(asset){
      var image = new Image();
      image.src = api.assetUrl(asset.storage_path);
    });
  }

  function init(nextHost, nextRole){
    host = nextHost;
    role = nextRole;
    utils = root.utils;
    drawer = document.getElementById('worldDmDrawer');
    if (role !== 'dm' || !drawer) return;
    wire();
    document.addEventListener('aegis:world-state', function(){
      clearTimeout(updateTimer);
      updateTimer = setTimeout(function(){
        render();
        preloadCurrent();
      }, 30);
    });
    render();
    preloadCurrent();
  }

  root.assets = {
    init: init,
    render: render
  };
})();
