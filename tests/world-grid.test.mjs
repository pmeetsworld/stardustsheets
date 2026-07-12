import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const map = {
  id: 'map-1',
  cell_px: 35,
  grid_scale: 1,
  offset_x: 0,
  offset_y: 0,
  snap_enabled: true,
  feet_per_cell: 5,
  diagonal_rule: 'seven_five'
};

const document = {
  addEventListener() {},
  dispatchEvent() {},
  getElementById() { return null; }
};
const window = {
  AEGIS_WORLD: {
    api: { activeMap: () => map },
    access: { mode: () => 'encounter' }
  }
};

vm.runInNewContext(
  fs.readFileSync(new URL('../world-grid.js', import.meta.url), 'utf8'),
  { window, document, CustomEvent: class CustomEvent {} }
);

const grid = window.AEGIS_WORLD.grid;

assert.equal(grid.cell(), 35, 'the effective default cell is 35px');
assert.deepEqual(
  { ...grid.snap({ x: 20, y: 20 }, 1) },
  { x: 17.5, y: 17.5 },
  'Medium tokens snap to the center of a grid square'
);
assert.deepEqual(
  { ...grid.snap({ x: 30, y: 30 }, 2) },
  { x: 35, y: 35 },
  'Large tokens snap to the intersection that centers a 2x2 footprint'
);
assert.deepEqual(
  { ...grid.snap({ x: 40, y: 40 }, 3, { minX: 50, maxX: 650, minY: 50, maxY: 650 }) },
  { x: 52.5, y: 52.5 },
  'Huge tokens stay centered across a 3x3 footprint at map edges'
);
assert.deepEqual(
  { ...grid.snap({ x: 60, y: 60 }, 4, { minX: 63, maxX: 637, minY: 63, maxY: 637 }) },
  { x: 70, y: 70 },
  'Gargantuan tokens stay centered across a 4x4 footprint at map edges'
);

console.log('world-grid tests passed');
