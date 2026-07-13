(function(){
  'use strict';

  var root = window.AEGIS_WORLD = window.AEGIS_WORLD || {};
  var api = root.api;
  var utils = null;
  var host = null;
  var role = 'player';
  var layer = null;
  var staging = null;
  var selectedId = '';
  var fannedKey = '';
  var drag = null;
  var longPressTimer = null;
  var dragFailsafe = null;

  function activeMapTokens(includeStaged){
    var mapId = api.store.world.active_map_id;
    return api.store.tokens.filter(function(token){
      if (token.map_id !== mapId) return false;
      if (!includeStaged && token.staged) return false;
      if (role !== 'dm' && token.kind !== 'pc' && token.defeated) return false;
      return true;
    });
  }

  function characterFor(token){
    return token.slug ? api.character(token.slug) : null;
  }

  function tokenArt(token){
    var asset = token.art_asset_id && api.store.assets.find(function(item){
      return item.id === token.art_asset_id;
    });
    if (!asset && token.slug) {
      var preference = api.store.defaults.find(function(item){ return item.slug === token.slug; });
      if (preference && preference.art_asset_id) {
        asset = api.store.assets.find(function(item){ return item.id === preference.art_asset_id; });
      }
    }
    if (asset) return api.assetUrl(asset.storage_path);
    var character = characterFor(token);
    return character ? utils.portraitFor(character) : '';
  }

  function initials(name){
    return String(name || '?').replace(/["']/g, '').split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function(part){ return part.charAt(0).toUpperCase(); }).join('') || '?';
  }

  function sizeMultiplier(size){
    return { medium: 1, large: 2, huge: 3, gargantuan: 4 }[size] || 1;
  }

  function tokenInset(){
    return Math.min(14, Math.max(6, root.grid.cell() * 0.14));
  }

  function tokenDiameter(token){
    return Math.max(28, root.grid.cell() * sizeMultiplier(token.size) - tokenInset());
  }

  function snapTokenPoint(point, token){
    var radius = tokenDiameter(token) / 2;
    var size = root.board.dimensions();
    var clamped = root.board.clampPoint(point, radius);
    return root.grid.snap(clamped, sizeMultiplier(token.size), {
      minX: radius,
      maxX: size.width - radius,
      minY: radius,
      maxY: size.height - radius
    });
  }

  function stackKey(token){
    return Math.round(Number(token.x || 0) / 4) + ':' + Math.round(Number(token.y || 0) / 4);
  }

  function stacks(tokens){
    var groups = {};
    tokens.forEach(function(token){
      var key = stackKey(token);
      groups[key] = groups[key] || [];
      groups[key].push(token);
    });
    return groups;
  }

  function canMove(token){
    if (!api.store.turn.combat_active || api.store.world.movement_locked) {
      return role === 'dm';
    }
    if (role === 'dm') return true;
    var player = root.access.playerSession();
    var active = api.activeToken();
    return !!(
      player &&
      active &&
      active.id === token.id &&
      token.kind === 'pc' &&
      token.owner_slug === player.slug &&
      !token.locked
    );
  }

  function buildToken(token){
    var element = document.createElement('button');
    element.type = 'button';
    element.className = 'world-token';
    element.setAttribute('data-token-id', token.id);
    var label = document.createElement('span');
    label.className = 'world-token-label';
    var face = document.createElement('span');
    face.className = 'world-token-face';
    var count = document.createElement('span');
    count.className = 'world-stack-count';
    count.hidden = true;
    element.appendChild(label);
    element.appendChild(face);
    element.appendChild(count);
    return element;
  }

  function updateToken(element, token, grouped, actingId){
    var diameter = tokenDiameter(token);
    var key = stackKey(token);
    var group = grouped[key] || [];
    var index = group.indexOf(token);
    var dragging = !!(drag && drag.id === token.id);
    var fan = '';
    if (fannedKey === key && group.length > 1) {
      var angle = (-70 + (140 / Math.max(1, group.length - 1)) * index) * Math.PI / 180;
      var distance = Math.min(diameter * 0.7, 42);
      fan = 'translate(' + (Math.cos(angle) * distance) + 'px,' + (Math.sin(angle) * distance) + 'px)';
    }
    element.setAttribute('data-stack-key', key);
    element.setAttribute('aria-label', token.name || 'Token');
    element.style.width = diameter + 'px';
    element.style.height = diameter + 'px';
    element.style.setProperty('--fan', fan || 'translate(0px,0px)');
    // Never touch position or lift state of the token being dragged: the
    // drag preview owns left/top until the move commits on release.
    if (!dragging) {
      element.style.left = Number(token.x || 0) + 'px';
      element.style.top = Number(token.y || 0) + 'px';
      var classNames = ['world-token', 'is-' + token.kind];
      if (token.id === selectedId) classNames.push('selected');
      if (actingId && actingId === token.id) classNames.push('acting');
      if (canMove(token)) classNames.push('movable');
      if (token.defeated) classNames.push('defeated');
      if (fannedKey === key) classNames.push('fanned');
      element.className = classNames.join(' ');
    }
    element.querySelector('.world-token-label').textContent = token.name || 'Combatant';
    var face = element.querySelector('.world-token-face');
    var art = tokenArt(token);
    if (art) {
      var imageValue = 'url("' + String(art).replace(/"/g, '%22') + '")';
      if (face.style.backgroundImage !== imageValue) face.style.backgroundImage = imageValue;
      if (face.textContent) face.textContent = '';
    } else {
      if (face.style.backgroundImage) face.style.backgroundImage = '';
      face.textContent = initials(token.name);
    }
    var count = element.querySelector('.world-stack-count');
    var showCount = group.length > 1 && index === group.length - 1;
    count.hidden = !showCount;
    count.textContent = showCount ? '×' + group.length : '';
  }

  function render(){
    if (!layer || !root.board || root.access.mode() !== 'encounter') {
      if (layer) layer.textContent = '';
      renderStaging();
      return;
    }
    var tokens = activeMapTokens(false);
    var grouped = stacks(tokens);
    var acting = api.activeToken();
    var actingId = acting ? acting.id : '';
    // Patch in place instead of innerHTML teardown so live syncs cannot
    // destroy a token mid-drag or snap a just-moved token backwards.
    var existing = {};
    Array.prototype.slice.call(layer.children).forEach(function(child){
      var id = child.getAttribute && child.getAttribute('data-token-id');
      if (id) existing[id] = child;
    });
    var seen = {};
    tokens.forEach(function(token){
      seen[token.id] = true;
      var element = existing[token.id];
      if (!element) {
        element = buildToken(token);
        layer.appendChild(element);
      }
      updateToken(element, token, grouped, actingId);
    });
    Object.keys(existing).forEach(function(id){
      if (!seen[id]) existing[id].remove();
    });
    renderStaging();
  }

  function renderStaging(){
    if (!staging || role !== 'dm') return;
    var items = activeMapTokens(true).filter(function(token){ return token.staged; });
    staging.innerHTML = [
      '<div class="world-staging-head"><span>DM Staging</span><b>' + items.length + '</b></div>',
      items.length ? items.map(function(token){
        return [
          '<div class="world-staging-row" data-token-id="' + utils.escapeHtml(token.id) + '">',
            '<span class="world-staging-avatar">' + utils.escapeHtml(initials(token.name)) + '</span>',
            '<span><b>' + utils.escapeHtml(token.name) + '</b><small>' + utils.escapeHtml(token.size) + ' · ' + utils.escapeHtml(token.kind) + '</small></span>',
            '<button type="button" data-staging-action="deploy" title="Deploy to map">Deploy</button>',
            '<button type="button" data-staging-action="delete" title="Delete token">×</button>',
          '</div>'
        ].join('');
      }).join('') : '<p class="world-empty-copy">New tokens wait here until deployed.</p>'
    ].join('');
  }

  function tokenRow(id){
    return api.store.tokens.find(function(token){ return token.id === id; }) || null;
  }

  function beginDrag(evt, element, token){
    if (!canMove(token) || selectedId !== token.id) return;
    evt.preventDefault();
    var point = root.board.screenToMap(evt.clientX, evt.clientY);
    drag = {
      id: token.id,
      token: token,
      element: element,
      pointerId: evt.pointerId,
      startClientX: evt.clientX,
      startClientY: evt.clientY,
      offsetX: point.x - Number(token.x || 0),
      offsetY: point.y - Number(token.y || 0),
      lifted: evt.pointerType !== 'touch'
    };
    clearTimeout(dragFailsafe);
    dragFailsafe = setTimeout(cancelDrag, 30000);
    if (evt.pointerType === 'touch') {
      longPressTimer = setTimeout(function(){
        if (!drag) return;
        drag.lifted = true;
        drag.element.classList.add('lifted');
        if (navigator.vibrate) navigator.vibrate(20);
      }, 180);
    } else {
      element.classList.add('lifted');
    }
    element.setPointerCapture(evt.pointerId);
  }

  function clearDragState(current, pointerId){
    clearTimeout(longPressTimer);
    clearTimeout(dragFailsafe);
    dragFailsafe = null;
    if (!current || !current.element) return;
    current.element.classList.remove('lifted');
    if (current.element.hasPointerCapture && current.element.hasPointerCapture(pointerId)) {
      current.element.releasePointerCapture(pointerId);
    }
  }

  function cancelDrag(){
    if (!drag) return;
    var current = drag;
    drag = null;
    clearDragState(current, current.pointerId);
    render();
  }

  function moveDrag(evt){
    if (!drag || drag.pointerId !== evt.pointerId) return;
    var distance = Math.hypot(evt.clientX - drag.startClientX, evt.clientY - drag.startClientY);
    if (!drag.lifted && evt.pointerType !== 'touch' && distance >= 8) drag.lifted = true;
    if (!drag.lifted) return;
    evt.preventDefault();
    var point = root.board.screenToMap(evt.clientX, evt.clientY);
    var diameter = tokenDiameter(drag.token);
    point = root.board.clampPoint({
      x: point.x - drag.offsetX,
      y: point.y - drag.offsetY
    }, diameter / 2);
    drag.preview = point;
    drag.element.style.left = point.x + 'px';
    drag.element.style.top = point.y + 'px';
  }

  async function endDrag(evt){
    if (!drag || drag.pointerId !== evt.pointerId) return;
    var current = drag;
    drag = null;
    clearDragState(current, evt.pointerId);
    if (!current.lifted || !current.preview) return;
    var point = snapTokenPoint(current.preview, current.token);
    // Use the freshest row from the store for the rev compare-and-swap; the
    // captured drag row may be stale if a sync arrived during the drag.
    var latest = tokenRow(current.id) || current.token;
    try {
      await api.moveToken(latest, point.x, point.y);
      // moveToken applies the confirmed row locally; no full refetch needed.
    } catch (err) {
      root.access.toast(err.message || String(err), 'error');
      render();
    }
  }

  async function stagingAction(button){
    var row = button.closest('[data-token-id]');
    var token = tokenRow(row && row.getAttribute('data-token-id'));
    if (!token) return;
    try {
      var secret = await root.access.requireDmSecret();
      var action = button.getAttribute('data-staging-action');
      if (action === 'delete') {
        var confirmed = await root.access.confirm('Delete Token', 'Remove ' + token.name + ' from this map?', 'Delete');
        if (!confirmed) return;
        await api.rpc('world_delete_token', { p_secret: secret, p_token_id: token.id });
      } else {
        var size = root.board.dimensions();
        var point = snapTokenPoint({ x: size.width / 2, y: size.height / 2 }, token);
        await api.rpc('world_update_token', {
          p_secret: secret,
          p_token_id: token.id,
          p_payload: { staged: false, x: point.x, y: point.y }
        });
      }
      await api.refresh('staging');
    } catch (err) {
      if (err.message !== 'cancelled') root.access.toast(err.message || String(err), 'error');
    }
  }

  function wire(){
    layer.addEventListener('click', function(evt){
      var element = evt.target.closest('.world-token');
      if (!element) return;
      var id = element.getAttribute('data-token-id');
      var key = element.getAttribute('data-stack-key');
      var groupSize = activeMapTokens(false).filter(function(token){ return stackKey(token) === key; }).length;
      selectedId = id;
      if (groupSize > 1) fannedKey = fannedKey === key ? '' : key;
      render();
    });
    layer.addEventListener('pointerdown', function(evt){
      var element = evt.target.closest('.world-token');
      if (!element) return;
      var token = tokenRow(element.getAttribute('data-token-id'));
      if (token) beginDrag(evt, element, token);
    });
    layer.addEventListener('pointermove', moveDrag);
    layer.addEventListener('pointerup', endDrag);
    layer.addEventListener('pointercancel', cancelDrag);
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', cancelDrag);
    window.addEventListener('blur', cancelDrag);
    if (staging) {
      staging.addEventListener('click', function(evt){
        var button = evt.target.closest('[data-staging-action]');
        if (button) stagingAction(button);
      });
    }
  }

  function init(nextHost, nextRole){
    host = nextHost;
    role = nextRole;
    utils = root.utils;
    layer = document.getElementById('worldTokenLayer');
    staging = document.getElementById('worldStaging');
    if (!layer) return;
    wire();
    // Defer store refreshes while a drag is in progress.
    if (api.registerGuard) api.registerGuard(function(){ return !!drag; });
    document.addEventListener('aegis:world-state', render);
    document.addEventListener('aegis:board-ready', render);
    document.addEventListener('aegis:world-identity', render);
    render();
  }

  root.tokens = {
    init: init,
    render: render,
    canMove: canMove,
    tokenDiameter: tokenDiameter,
    selected: function(){ return selectedId; }
  };
})();
