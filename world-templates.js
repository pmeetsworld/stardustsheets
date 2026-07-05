(function(){
  'use strict';

  var root = window.AEGIS_WORLD = window.AEGIS_WORLD || {};
  var api = root.api;
  var host = null;
  var role = 'player';
  var viewport = null;
  var svg = null;
  var tool = '';
  var draft = null;
  var pointerId = null;

  function safeNumber(value){
    value = Number(value);
    return isFinite(value) ? value : 0;
  }

  function activeTemplates(){
    var now = Date.now();
    var mapId = api.store.world.active_map_id;
    return api.store.templates.filter(function(template){
      if (template.map_id !== mapId) return false;
      if (!template.pinned && template.expires_at && new Date(template.expires_at).getTime() <= now) return false;
      return true;
    });
  }

  function conePoints(template){
    var ox = safeNumber(template.origin_x);
    var oy = safeNumber(template.origin_y);
    var tx = safeNumber(template.target_x);
    var ty = safeNumber(template.target_y);
    var dx = tx - ox;
    var dy = ty - oy;
    var length = Math.max(1, Math.hypot(dx, dy));
    var nx = -dy / length;
    var ny = dx / length;
    var halfWidth = length / 2;
    return [
      ox + ',' + oy,
      (tx + nx * halfWidth) + ',' + (ty + ny * halfWidth),
      (tx - nx * halfWidth) + ',' + (ty - ny * halfWidth)
    ].join(' ');
  }

  function templateSvg(template, isDraft){
    var shape = template.shape;
    var ox = safeNumber(template.origin_x);
    var oy = safeNumber(template.origin_y);
    var tx = safeNumber(template.target_x);
    var ty = safeNumber(template.target_y);
    var color = /^#[0-9a-f]{6}$/i.test(template.color || '') ? template.color : '#ff5a3c';
    var classes = [
      'world-template',
      'shape-' + shape,
      template.pinned ? 'pinned' : 'temporary',
      isDraft ? 'draft' : ''
    ].filter(Boolean).join(' ');
    var common = ' class="' + classes + '" style="--template-color:' + color + '"';
    var distance = root.grid.distance({ x: ox, y: oy }, { x: tx, y: ty });
    var labelX = (ox + tx) / 2;
    var labelY = (oy + ty) / 2 - 8;
    if (shape === 'circle') {
      var radius = Math.max(1, Math.hypot(tx - ox, ty - oy));
      return '<g' + common + '><circle cx="' + ox + '" cy="' + oy + '" r="' + radius + '"></circle>' +
        '<text x="' + ox + '" y="' + (oy - radius - 8) + '">' + distance + ' ft</text></g>';
    }
    if (shape === 'cone') {
      return '<g' + common + '><polygon points="' + conePoints(template) + '"></polygon>' +
        '<text x="' + labelX + '" y="' + labelY + '">' + distance + ' ft</text></g>';
    }
    if (shape === 'ping') {
      return '<g' + common + '><circle class="ping-a" cx="' + ox + '" cy="' + oy + '" r="' + (root.grid.cell() * 0.18) + '"></circle>' +
        '<circle class="ping-b" cx="' + ox + '" cy="' + oy + '" r="' + (root.grid.cell() * 0.42) + '"></circle></g>';
    }
    return '<g' + common + '><line x1="' + ox + '" y1="' + oy + '" x2="' + tx + '" y2="' + ty + '"></line>' +
      '<circle cx="' + ox + '" cy="' + oy + '" r="4"></circle><circle cx="' + tx + '" cy="' + ty + '" r="4"></circle>' +
      '<text x="' + labelX + '" y="' + labelY + '">' + distance + ' ft</text></g>';
  }

  function render(){
    if (!svg || root.access.mode() !== 'encounter') {
      if (svg) svg.innerHTML = '';
      return;
    }
    var markup = activeTemplates().map(function(template){
      return templateSvg(template, false);
    });
    if (draft) markup.push(templateSvg(draft, true));
    svg.innerHTML = markup.join('');
  }

  function setTool(nextTool){
    tool = tool === nextTool ? '' : nextTool;
    document.body.dataset.worldTool = tool;
    host.querySelectorAll('[data-world-tool]').forEach(function(button){
      var active = button.getAttribute('data-world-tool') === tool;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (tool) root.access.toast(tool.charAt(0).toUpperCase() + tool.slice(1) + ' tool active', 'saved');
  }

  function durationPayload(){
    var duration = document.getElementById('worldTemplateDuration');
    var value = duration ? duration.value : 'turn';
    if (value === '30') {
      return { expires_at: new Date(Date.now() + 30000).toISOString() };
    }
    var active = api.activeToken();
    return {
      expires_on_token_id: active ? active.id : null,
      created_turn_rev: api.store.turn.rev,
      expires_at: active ? null : new Date(Date.now() + 30000).toISOString()
    };
  }

  // Housekeeping: expired unpinned templates are filtered client-side but
  // the rows would otherwise accumulate all campaign. Sweep them (60 s grace
  // so other clients finish their fade) whenever a new template is created.
  function cleanupExpired(){
    var cutoff = new Date(Date.now() - 60000).toISOString();
    api.request(
      'world_templates?pinned=eq.false&expires_at=lt.' + encodeURIComponent(cutoff),
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
    ).catch(function(){});
  }

  async function commit(template){
    var player = root.access.playerSession();
    var payload = Object.assign({
      map_id: api.store.world.active_map_id,
      shape: template.shape,
      origin_x: template.origin_x,
      origin_y: template.origin_y,
      target_x: template.target_x,
      target_y: template.target_y,
      radius_ft: root.grid.distance(
        { x: template.origin_x, y: template.origin_y },
        { x: template.target_x, y: template.target_y }
      ),
      color: role === 'dm' ? '#ff5a3c' : '#7f99bd',
      owner_slug: player && player.slug || (role === 'dm' ? 'dm' : 'spectator'),
      pinned: false
    }, durationPayload());
    if (template.shape === 'ping') {
      payload.expires_at = new Date(Date.now() + 4000).toISOString();
      payload.expires_on_token_id = null;
    }
    try {
      await api.insertTemplate(payload);
      cleanupExpired();
      await api.refresh('template-create');
    } catch (err) {
      root.access.toast(err.message || String(err), 'error');
    }
  }

  function point(evt){
    var value = root.board.screenToMap(evt.clientX, evt.clientY);
    return root.board.clampPoint(value, 0);
  }

  function begin(evt){
    if (!tool || evt.target.closest('.world-token,.world-tool-dock,.world-fullscreen')) return;
    if (!api.store.world.active_map_id || root.access.mode() !== 'encounter') return;
    evt.preventDefault();
    var start = point(evt);
    if (tool === 'ping') {
      commit({
        shape: 'ping',
        origin_x: start.x,
        origin_y: start.y,
        target_x: start.x,
        target_y: start.y
      });
      return;
    }
    pointerId = evt.pointerId;
    viewport.setPointerCapture(evt.pointerId);
    draft = {
      shape: tool,
      origin_x: start.x,
      origin_y: start.y,
      target_x: start.x,
      target_y: start.y,
      color: role === 'dm' ? '#ff5a3c' : '#7f99bd'
    };
    render();
  }

  function move(evt){
    if (!draft || evt.pointerId !== pointerId) return;
    evt.preventDefault();
    var target = point(evt);
    draft.target_x = target.x;
    draft.target_y = target.y;
    render();
  }

  function end(evt){
    if (!draft || evt.pointerId !== pointerId) return;
    var complete = draft;
    draft = null;
    pointerId = null;
    if (viewport.hasPointerCapture(evt.pointerId)) viewport.releasePointerCapture(evt.pointerId);
    if (Math.hypot(complete.target_x - complete.origin_x, complete.target_y - complete.origin_y) < 3) {
      render();
      return;
    }
    commit(complete);
  }

  function wire(){
    host.addEventListener('click', function(evt){
      var button = evt.target.closest('[data-world-tool]');
      if (button) setTool(button.getAttribute('data-world-tool'));
    });
    viewport.addEventListener('pointerdown', begin);
    viewport.addEventListener('pointermove', move);
    viewport.addEventListener('pointerup', end);
    viewport.addEventListener('pointercancel', end);
    document.addEventListener('keydown', function(evt){
      if (evt.key === 'Escape' && tool) setTool('');
    });
  }

  function init(nextHost, nextRole){
    host = nextHost;
    role = nextRole;
    viewport = document.getElementById('worldViewport');
    svg = document.getElementById('worldOverlaySvg');
    if (!viewport || !svg) return;
    wire();
    document.addEventListener('aegis:world-state', render);
    document.addEventListener('aegis:board-ready', render);
    render();
  }

  root.templates = {
    init: init,
    render: render,
    setTool: setTool
  };
})();
