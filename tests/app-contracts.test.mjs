import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');

const sheet = read('sheet.html');
const mirror = read('Character Sheet.html');
assert.equal(sheet, mirror, 'the two character sheet entry points must remain byte-identical');

const serviceWorker = read('sw.js');
const build = serviceWorker.match(/const APP_BUILD = '([^']+)'/)?.[1];
assert.ok(build, 'the service worker must declare an app build');

for (const name of ['index.html', 'campaign.html', 'sheet.html', 'dm.html', 'world.html']) {
  assert.ok(read(name).includes(build), `${name} must reference the current app build`);
}

for (const name of ['index.html', 'campaign.html', 'sheet.html', 'dm.html', 'world.html', 'encounter.html']) {
  const source = read(name);
  const ids = [...source.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, `${name} must not contain duplicate element ids`);

  for (const match of source.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const target = match[1];
    if (/^(?:https?:|#|data:|mailto:)/.test(target)) continue;
    const path = decodeURIComponent(target.split(/[?#]/)[0]);
    assert.ok(fs.existsSync(new URL(path, root)), `${name} references missing file ${path}`);
  }
}

const cloudSave = read('cloud-save.js');
assert.match(
  cloudSave,
  /bubaranatak:\s*'bubranatak'/,
  'corrected Bub links must resolve to the stable database slug'
);

const world = read('world.js');
assert.equal(
  (world.match(/data-dialog-close/g) || []).length,
  5,
  'all four cancel controls and the shared close handler must use the dialog-close contract'
);
for (const formId of ['worldIdentityForm', 'worldDmAuthForm']) {
  const formSource = world.match(new RegExp(`id="${formId}"[\\s\\S]*?</form>`))?.[0] || '';
  assert.ok(formSource, `${formId} must exist`);
  assert.doesNotMatch(
    formSource,
    /<button value="cancel"/,
    `${formId} must not use implicit submit buttons for cancellation`
  );
}

const assets = read('world-assets.js');
assert.match(assets, /data-duplicate-token/, 'custom combatants must expose a duplicate command');
assert.match(
  assets,
  /api\.refresh\('token-duplicate'\)/,
  'duplicate combatants must refresh shared world state'
);

const worldCss = read('world.css');
const tokens = read('world-tokens.js');
assert.match(
  worldCss,
  /transform:translate\(-50%,-50%\) var\(--fan, translate\(0,0\)\)/,
  'token coordinates must position the visual center, not the top-left corner'
);
assert.doesNotMatch(
  tokens,
  /setProperty\('--fan', fan \|\| 'none'\)/,
  'the idle fan transform must remain a valid transform function'
);

console.log('app contract tests passed');
