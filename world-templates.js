(function(){
  'use strict';

  var root = window.AEGIS_WORLD = window.AEGIS_WORLD || {};
  var api = root.api;
  var host = null;
  var role = 'player';
  var viewport = null;
  var svg = null;
  var toolbar = null;
  var tool = '';
  var draft = null;
  var selectedId = '';
  var editDrag = null;
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

  function escapeAttr(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(char){
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
    });
  }

  function editable(template){
    if (!template || !template.id || template.shape === 'ping') return false;
    if (role === 'dm') return true;
    var player = root.access.playerSession();
    if (!player && template.owner_slug === 'spectator') return true;
    return !!(player && template.owner_slug === player.slug);
  }

  function templateById(id){
    return activeTemplates().find(function(template){ return template.id === id; }) || null;
  }

  function templateWithPreview(template){
    if (!template || !editDrag || editDrag.id !== template.id || !editDrag.preview) return template;
    return Object.assign({}, template, editDrag.preview);
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

  function bounds(template){
    var ox = safeNumber(template.origin_x);
    var oy = safeNumber(template.origin_y);
    var tx = safeNumber(template.target_x);
    var ty = safeNumber(template.target_y);
    if (template.shape === 'circle') {
      var radius = Math.max(1, Math.hypot(tx - ox, ty - oy));
      return { minX: ox - radius, minY: oy - radius, maxX: ox + radius, maxY: oy + radius };
    }
    if (template.shape === 'cone') {
      var points = conePoints(template).split(' ').map(function(pair){
        var parts = pair.split(',');
        return { x: Number(parts[0]) || 0, y: Number(parts[1]) || 0 };
      });
      return points.reduce(function(box, point){
        return {
          minX: Math.min(box.minX, point.x),
          minY: Math.min(box.minY, point.y),
          maxX: Math.max(box.maxX, point.x),
          maxY: Math.max(box.maxY, point.y)
        };
      }, { minX: ox, minY: oy, maxX: ox, maxY: oy });
    }
    return {
      minX: Math.min(ox, tx),
      minY: Math.min(oy, ty),
      maxX: Math.max(ox, tx),
      maxY: Math.max(oy, ty)
    };
  }

  function handleSvg(template){
    if (!template.id || selectedId !== template.id || !editable(template)) return '';
    var ox = safeNumber(template.origin_x);
    var oy = safeNumber(template.origin_y);
    var tx = safeNumber(template.target_x);
    var ty = safeNumber(template.target_y);
    var cx = (ox + tx) / 2;
    var cy = (oy + ty) / 2;
    if (template.shape === 'circle') {
      cx = ox;
      cy = oy;
    }
    return [
      '<circle class="world-template-handle origin" data-template-handle="origin" cx="' + ox + '" cy="' + oy + '" r="7"></circle>',
      '<circle class="world-template-handle target" data-template-handle="target" cx="' + tx + '" cy="' + ty + '" r="7"></circle>',
      '<rect class="world-template-handle move" data-template-handle="move" x="' + (cx - 6) + '" y="' + (cy - 6) + '" width="12" height="12" rx="3"></rect>'
    ].join('');
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
      template.id === selectedId ? 'selected' : '',
      editable(template) ? 'editable' : '',
      isDraft ? 'draft' : ''
    ].filter(Boolean).join(' ');
    var common = ' class="' + classes + '"' +
      (template.id ? ' data-template-id="' + escapeAttr(template.id) + '"' : '') +
      ' style="--template-color:' + color + '"';
    var distance = root.grid.distance({ x: ox, y: oy }, { x: tx, y: ty });
    var labelX = (ox + tx) / 2;
    var labelY = (oy + ty) / 2 - 8;
    if (shape === 'circle') {
      var radius = Math.max(1, Math.hypot(tx - ox, ty - oy));
      return '<g' + common + '><circle class="world-template-hit" cx="' + ox + '" cy="' + oy + '" r="' + radius + '"></circle>' +
        '<circle cx="' + ox + '" cy="' + oy + '" r="' + radius + '"></circle>' +
        '<text x="' + ox + '" y="' + (oy - radius - 8) + '">' + distance + ' ft</text>' +
        handleSvg(template) + '</g>';
    }
    if (shape === 'cone') {
      var cone = conePoints(template);
      return '<g' + common + '><polygon class="world-template-hit" points="' + cone + '"></polygon>' +
        '<polygon points="' + cone + '"></polygon>' +
        '<text x="' + labelX + '" y="' + labelY + '">' + distance + ' ft</text>' +
        handleSvg(template) + '</g>';
    }
    if (shape === 'ping') {
      return '<g' + common + '><circle class="ping-a" cx="' + ox + '" cy="' + oy + '" r="' + (root.grid.cell() * 0.18) + '"></circle>' +
        '<circle class="ping-b" cx="' + ox + '" cy="' + oy + '" r="' + (root.grid.cell() * 0.42) + '"></circle></g>';
    }
    return '<g' + common + '><line class="world-template-hit" x1="' + ox + '" y1="' + oy + '" x2="' + tx + '" y2="' + ty + '"></line>' +
      '<line x1="' + ox + '" y1="' + oy + '" x2="' + tx + '" y2="' + ty + '"></line>' +
      '<circle cx="' + ox + '" cy="' + oy + '" r="4"></circle><circle cx="' + tx + '" cy="' + ty + '" r="4"></circle>' +
      '<text x="' + labelX + '" y="' + labelY + '">' + distance + ' ft</text>' +
      handleSvg(template) + '</g>';
  }

  function positionToolbar(){
    if (!toolbar || !root.board) return;
    var template = templateWithPreview(templateById(selectedId));
    if (!template || !editable(template)) {
      toolbar.hidden = true;
      return;
    }
    var box = bounds(template);
    var screen = root.board.mapToScreen(box.maxX, box.minY);
    var rect = viewport.getBoundingClientRect();
    var width = toolbar.offsetWidth || 104;
    var left = Math.max(8, Math.min(rect.width - width - 8, screen.x - rect.left + 10));
    var top = Math.max(8, Math.min(rect.height - 36, screen.y - rect.top - 36));
    toolbar.style.left = left + 'px';
    toolbar.style.top = top + 'px';
    toolbar.hidden = false;
  }

  function render(){
    if (!svg || root.access.mode() !== 'encounter') {
      if (svg) svg.innerHTML = '';
      return;
    }
    var markup = activeTemplates().map(function(template){
      return templateSvg(templateWithPreview(template), false);
    });
    if (draft) markup.push(templateSvg(draft, true));
    svg.innerHTML = markup.join('');
    positionToolbar();
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

  function templatePayload(template){
    return {
      origin_x: template.origin_x,
      origin_y: template.origin_y,
      target_x: template.target_x,
      target_y: template.target_y,
      radius_ft: root.grid.distance(
        { x: template.origin_x, y: template.origin_y },
        { x: template.target_x, y: template.target_y }
      )
    };
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

  async function updateTemplate(id, patch){
    try {
      await api.updateTemplate(id, patch);
      await api.refresh('template-edit');
    } catch (err) {
      root.access.toast(err.message || String(err), 'error');
      await api.refresh('template-edit-error').catch(function(){});
    }
  }

  async function deleteTemplate(id){
    var template = templateById(id || selectedId);
    if (!template || !editable(template)) return;
    try {
      await api.deleteTemplate(template.id);
      if (selectedId === template.id) selectedId = '';
      await api.refresh('template-delete');
      render();
    } catch (err) {
      root.access.toast(err.message || String(err), 'error');
    }
  }

  async function duplicateTemplate(id){
    var template = templateById(id || selectedId);
    if (!template || !editable(template)) return;
    var offset = Math.max(16, Math.min(40, root.grid.cell() * 0.35));
    var player = root.access.playerSession();
    var payload = Object.assign({
      map_id: template.map_id,
      shape: template.shape,
      origin_x: safeNumber(template.origin_x) + offset,
      origin_y: safeNumber(template.origin_y) + offset,
      target_x: safeNumber(template.target_x) + offset,
      target_y: safeNumber(template.target_y) + offset,
      color: template.color || (role === 'dm' ? '#ff5a3c' : '#7f99bd'),
      owner_slug: role === 'dm' ? 'dm' : (player && player.slug || template.owner_slug || 'spectator'),
      pinned: !!template.pinned
    }, template.pinned ? { expires_at: null, expires_on_token_id: null } : durationPayload());
    payload.radius_ft = root.grid.distance(
      { x: payload.origin_x, y: payload.origin_y },
      { x: payload.target_x, y: payload.target_y }
    );
    try {
      var created = await api.insertTemplate(payload);
      selectedId = created && created.id || selectedId;
      await api.refresh('template-duplicate');
      render();
    } catch (err) {
      root.access.toast(err.message || String(err), 'error');
    }
  }

  function point(evt){
    var value = root.board.screenToMap(evt.clientX, evt.clientY);
    return root.board.clampPoint(value, 0);
  }

  function selectedTemplateFromEvent(evt){
    var group = evt.target.closest && evt.target.closest('.world-template[data-template-id]');
    if (!group) return null;
    return templateById(group.getAttribute('data-template-id'));
  }

  function clampMove(original, dx, dy){
    var box = bounds(original);
    var size = root.board.dimensions();
    if (size.width) dx = Math.max(-box.minX, Math.min(size.width - box.maxX, dx));
    if (size.height) dy = Math.max(-box.minY, Math.min(size.height - box.maxY, dy));
    return { x: dx, y: dy };
  }

  function previewEdit(evt){
    if (!editDrag || evt.pointerId !== editDrag.pointerId) return;
    var target = point(evt);
    var patch;
    if (editDrag.handle === 'move') {
      var delta = clampMove(editDrag.original, target.x - editDrag.start.x, target.y - editDrag.start.y);
      patch = {
        origin_x: editDrag.original.origin_x + delta.x,
        origin_y: editDrag.original.origin_y + delta.y,
        target_x: editDrag.original.target_x + delta.x,
        target_y: editDrag.original.target_y + delta.y
      };
    } else if (editDrag.handle === 'origin') {
      patch = {
        origin_x: target.x,
        origin_y: target.y,
        target_x: editDrag.original.target_x,
        target_y: editDrag.original.target_y
      };
    } else {
      patch = {
        origin_x: editDrag.original.origin_x,
        origin_y: editDrag.original.origin_y,
        target_x: target.x,
        target_y: target.y
      };
    }
    editDrag.preview = Object.assign({}, patch, {
      radius_ft: root.grid.distance(
        { x: patch.origin_x, y: patch.origin_y },
        { x: patch.target_x, y: patch.target_y }
      )
    });
    render();
  }

  function beginEdit(evt, template, handle){
    if (!template || !editable(template)) return false;
    evt.preventDefault();
    evt.stopPropagation();
    selectedId = template.id;
    pointerId = evt.pointerId;
    viewport.setPointerCapture(evt.pointerId);
    editDrag = {
      id: template.id,
      handle: handle || 'move',
      pointerId: evt.pointerId,
      start: point(evt),
      original: {
        shape: template.shape,
        origin_x: safeNumber(template.origin_x),
        origin_y: safeNumber(template.origin_y),
        target_x: safeNumber(template.target_x),
        target_y: safeNumber(template.target_y)
      },
      preview: null
    };
    document.body.dataset.worldTemplateEdit = editDrag.handle;
    render();
    return true;
  }

  function begin(evt){
    if (evt.target.closest('.world-template-toolbar')) return;
    var handle = evt.target.closest('.world-template-handle');
    if (handle) {
      beginEdit(evt, selectedTemplateFromEvent(evt), handle.getAttribute('data-template-handle'));
      return;
    }
    var selected = selectedTemplateFromEvent(evt);
    if (!tool && selected) {
      beginEdit(evt, selected, 'move');
      return;
    }
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
    if (editDrag) {
      evt.preventDefault();
      previewEdit(evt);
      return;
    }
    if (!draft || evt.pointerId !== pointerId) return;
    evt.preventDefault();
    var target = point(evt);
    draft.target_x = target.x;
    draft.target_y = target.y;
    render();
  }

  function end(evt){
    if (editDrag && evt.pointerId === editDrag.pointerId) {
      var complete = editDrag.preview;
      var id = editDrag.id;
      editDrag = null;
      pointerId = null;
      delete document.body.dataset.worldTemplateEdit;
      if (viewport.hasPointerCapture(evt.pointerId)) viewport.releasePointerCapture(evt.pointerId);
      render();
      if (complete) updateTemplate(id, templatePayload(complete));
      return;
    }
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
    if (toolbar) {
      toolbar.addEventListener('click', function(evt){
        var action = evt.target.closest('[data-template-action]');
        if (!action) return;
        if (action.getAttribute('data-template-action') === 'duplicate') duplicateTemplate();
        if (action.getAttribute('data-template-action') === 'delete') deleteTemplate();
      });
    }
    viewport.addEventListener('pointerdown', begin);
    viewport.addEventListener('pointermove', move);
    viewport.addEventListener('pointerup', end);
    viewport.addEventListener('pointercancel', end);
    document.addEventListener('keydown', function(evt){
      var tag = evt.target && evt.target.tagName;
      var typing = evt.target && (evt.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tag || ''));
      if (typing) return;
      if (evt.key === 'Escape') {
        if (tool) setTool('');
        else if (selectedId) {
          selectedId = '';
          render();
        }
      }
      if ((evt.key === 'Delete' || evt.key === 'Backspace') && selectedId) {
        evt.preventDefault();
        deleteTemplate();
      }
      if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'd' && selectedId) {
        evt.preventDefault();
        duplicateTemplate();
      }
    });
    document.addEventListener('aegis:board-camera', positionToolbar);
    api.registerGuard(function(){ return !!draft || !!editDrag; });
  }

  function init(nextHost, nextRole){
    host = nextHost;
    role = nextRole;
    viewport = document.getElementById('worldViewport');
    svg = document.getElementById('worldOverlaySvg');
    if (!viewport || !svg) return;
    toolbar = document.createElement('div');
    toolbar.className = 'world-template-toolbar';
    toolbar.hidden = true;
    toolbar.innerHTML = '<button type="button" data-template-action="duplicate">Dupe</button><button type="button" data-template-action="delete">Delete</button>';
    viewport.appendChild(toolbar);
    wire();
    document.addEventListener('aegis:world-state', render);
    document.addEventListener('aegis:board-ready', render);
    render();
  }

  root.templates = {
    init: init,
    render: render,
    setTool: setTool,
    duplicate: duplicateTemplate,
    delete: deleteTemplate
  };
})();
