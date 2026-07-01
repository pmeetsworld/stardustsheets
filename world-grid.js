(function(){
  'use strict';

  var root = window.AEGIS_WORLD = window.AEGIS_WORLD || {};
  var api = root.api;
  var svg = null;

  function map(){
    return api.activeMap();
  }

  function effectiveCell(mapRow){
    if (!mapRow) return 70;
    return Math.max(4, Number(mapRow.cell_px || 70) * Number(mapRow.grid_scale || 1));
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

  function snap(point){
    var mapRow = map();
    if (!mapRow || !mapRow.snap_enabled) return point;
    var cell = effectiveCell(mapRow);
    var ox = Number(mapRow.offset_x || 0);
    var oy = Number(mapRow.offset_y || 0);
    return {
      x: ox + (Math.round((point.x - ox - cell / 2) / cell) + 0.5) * cell,
      y: oy + (Math.round((point.y - oy - cell / 2) / cell) + 0.5) * cell
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
    cell: function(){ return effectiveCell(map()); }
  };
})();
