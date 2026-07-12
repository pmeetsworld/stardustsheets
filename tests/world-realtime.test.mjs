import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const staleMap = {
  id: 'map-1',
  cell_px: 70,
  updated_at: '2026-01-01T00:00:00.000Z'
};
const savedMap = {
  id: 'map-1',
  cell_px: 35,
  updated_at: '2026-01-02T00:00:00.000Z'
};

function rowsFor(url) {
  if (url.includes('/world_state?')) return [{ id: 'main', rev: 0 }];
  if (url.includes('/world_turn_state?')) return [{ id: 'main', rev: 0 }];
  if (url.includes('/world_maps?')) return [staleMap];
  return [];
}

const document = {
  readyState: 'loading',
  addEventListener() {},
  dispatchEvent() {}
};
const window = {
  AEGIS_CLOUD: {
    supabaseUrl: 'https://example.supabase.co',
    supabaseKey: 'publishable-test-key'
  },
  addEventListener() {}
};
const fetch = async (url) => ({
  ok: true,
  text: async () => JSON.stringify(rowsFor(String(url)))
});

vm.runInNewContext(
  fs.readFileSync(new URL('../world-realtime.js', import.meta.url), 'utf8'),
  {
    window,
    document,
    fetch,
    CustomEvent: class CustomEvent {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
    Date,
    JSON,
    Math,
    Promise,
    encodeURIComponent
  }
);

const api = window.AEGIS_WORLD.api;
api.store.maps = [staleMap];
api.applyMapRow(savedMap);
await api.refresh('stale-map-test');

assert.equal(
  api.store.maps[0].cell_px,
  35,
  'an older poll response must not overwrite a confirmed grid save'
);

console.log('world-realtime tests passed');
