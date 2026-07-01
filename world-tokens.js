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

  function tokenDiameter(token){
    return Math.max(28, root.grid.cell() * sizeMultiplier(token.size));
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

  function render(){
    if (!layer || !root.board || root.access.mode() !== 'encounter') {
      if (layer) layer.innerHTML = '';
      renderStaging();
      return;
    }
    var tokens = activeMapTokens(false);
    var grouped = stacks(tokens);
    layer.innerHTML = tokens.map(function(token){
      var diameter = tokenDiameter(token);
      var key = stackKey(token);
      var group = grouped[key] || [];
      var index = group.indexOf(token);
      var fan = '';
      if (fannedKey === key && group.length > 1) {
        var angle = (-70 + (140 / Math.max(1, group.length - 1)) * index) * Math.PI / 180;
        var distance = Math.min(diameter * 0.7, 42);
        fan = 'translate(' + (Math.cos(angle) * distance) + 'px,' + (Math.sin(angle) * distance) + 'px)';
      }
      var art = tokenArt(token);
      var classNames = [
        'world-token',
        'is-' + token.kind,
        token.id === selectedId ? 'selected' : '',
        api.activeToken() && api.activeToken().id === token.id ? 'acting' : '',
        canMove(token) ? 'movable' : '',
        token.defeated ? 'defeated' : '',
        fannedKey === key ? 'fanned' : ''
      ].filter(Boolean).join(' ');
      return [
        '<button type="button" class="' + classNames + '"',
          ' data-token-id="' + utils.escapeHtml(token.id) + '"',
          ' data-stack-key="' + key + '"',
          ' style="left:' + Number(token.x || 0) + 'px;top:' + Number(token.y || 0) + 'px;width:' + diameter + 'px;height:' + diameter + 'px;--fan:' + fan + '"',
          ' aria-label="' + utils.escapeHtml(token.name || 'Token') + '">',
          '<span class="world-token-label">' + utils.escapeHtml(token.name || 'Combatant') + '</span>',
          '<span class="world-token-face"' + (art ? ' style="background-image:url(\'' + String(art).replace(/'/g, '%27') + '\')"' : '') + '>',
            art ? '' : utils.escapeHtml(initials(token.name)),
          '</span>',
          group.length > 1 && index === group.length - 1 ? '<span class="world-stack-count">×' + group.length + '</span>' : '',
        '</button>'
      ].join('');
    }).join('');
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
    clearTimeout(longPressTimer);
    var current = drag;
    drag = null;
    current.element.classList.remove('lifted');
    if (current.element.hasPointerCapture && current.element.hasPointerCapture(evt.pointerId)) {
      current.element.releasePointerCapture(evt.pointerId);
    }
    if (!current.lifted || !current.preview) return;
    var point = root.grid.snap(current.preview);
    point = root.board.clampPoint(point, tokenDiameter(current.token) / 2);
    try {
      await api.moveToken(current.token, point.x, point.y);
      await api.refresh('token-move');
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
        var point = root.grid.snap({ x: size.width / 2, y: size.height / 2 });
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
    layer.addEventListener('pointercancel', endDrag);
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
