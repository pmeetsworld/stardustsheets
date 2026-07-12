(function(){
  'use strict';

  var root = window.AEGIS_WORLD = window.AEGIS_WORLD || {};
  var api = root.api;
  var DEFAULT_CELL_PX = 35;
  var svg = null;
  var preview = null;   // uncommitted DM calibration values, local-only

  function map(){
    var row = api.activeMap();
    if (row && preview && preview.id === row.id) {
      return Object.assign({}, row, preview.values);
    }
    return row;
  }

  function effectiveCell(mapRow){
    if (!mapRow) return DEFAULT_CELL_PX;
    return Math.max(4, Number(mapRow.cell_px || DEFAULT_CELL_PX) * Number(mapRow.grid_scale || 1));
  }

  function render(){
    if (!svg || !root.board) return;
    var mapRow = map();
    var size = root.board.dimensions();
    if (!mapRow || !size.width || root.access.mode() !== 'encounter') {
      svg.innerHTML = '';
      return;
    }
    var cell = effectiveCell(mapRow);
    var offsetX = Number(mapRow.offset_x || 0);
    var offsetY = Number(mapRow.offset_y || 0);
    var path = [];
    var x = ((offsetX % cell) + cell) % cell;
    var y = ((offsetY % cell) + cell) % cell;
    for (; x <= size.width; x += cell) path.push('M' + x + ' 0V' + size.height);
    for (; y <= size.height; y += cell) path.push('M0 ' + y + 'H' + size.width);
    svg.innerHTML = '<path d="' + path.join('') + '"></path>';
    svg.style.color = mapRow.grid_color || '#7f99bd';
    svg.style.opacity = mapRow.grid_visible ? String(mapRow.grid_opacity == null ? 0.5 : mapRow.grid_opacity) : '0';
  }

  function snapAxis(value, origin, cell, min, max){
    var index = Math.round((value - origin) / cell);
    var minIndex = isFinite(min) ? Math.ceil((min - origin) / cell) : null;
    var maxIndex = isFinite(max) ? Math.floor((max - origin) / cell) : null;
    if (minIndex != null && maxIndex != null && minIndex > maxIndex) {
      return Math.max(min, Math.min(max, value));
    }
    if (minIndex != null) index = Math.max(minIndex, index);
    if (maxIndex != null) index = Math.min(maxIndex, index);
    return origin + index * cell;
  }

  function snap(point, cellSpan, bounds){
    var mapRow = map();
    if (!mapRow || !mapRow.snap_enabled) return point;
    var cell = effectiveCell(mapRow);
    var ox = Number(mapRow.offset_x || 0);
    var oy = Number(mapRow.offset_y || 0);
    var span = Math.max(1, Math.round(Number(cellSpan) || 1));
    var centerOffset = span % 2 ? cell / 2 : 0;
    bounds = bounds || {};
    return {
      x: snapAxis(point.x, ox + centerOffset, cell, bounds.minX, bounds.maxX),
      y: snapAxis(point.y, oy + centerOffset, cell, bounds.minY, bounds.maxY)
    };
  }

  function distance(a, b){
    var mapRow = map();
    var cell = effectiveCell(mapRow);
    var feet = Number(mapRow && mapRow.feet_per_cell || 5);
    var dx = Math.abs(b.x - a.x) / cell;
    var dy = Math.abs(b.y - a.y) / cell;
    var diagonal = Math.min(dx, dy);
    var straight = Math.max(dx, dy) - diagonal;
    var rule = mapRow && mapRow.diagonal_rule || 'seven_five';
    var value;
    if (rule === 'five') {
      value = Math.max(dx, dy) * feet;
    } else if (rule === 'alternating') {
      var wholeDiagonal = Math.round(diagonal);
      value = straight * feet +
        Math.floor(wholeDiagonal / 2) * feet * 3 +
        (wholeDiagonal % 2) * feet;
    } else {
      value = straight * feet + diagonal * feet * 1.5;
    }
    return Math.round(value * 2) / 2;
  }

  function init(){
    svg = document.getElementById('worldGridSvg');
    document.addEventListener('aegis:world-state', render);
    document.addEventListener('aegis:board-ready', render);
    render();
  }

  root.grid = {
    init: init,
    render: render,
    snap: snap,
    distance: distance,
    setPreview: function(id, values){
      preview = id ? { id: id, values: values || {} } : null;
      render();
    },
    clearPreview: function(){
      if (!preview) return;
      preview = null;
      render();
    },
    cell: function(){ return effectiveCell(map()); }
  };
})();
