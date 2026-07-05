(function(){
  'use strict';

  var BUILD = window.AEGIS_BUILD || '20260704a';
  var PLAYER_KEY = 'aegis-world-player-v1';
  var DM_KEY = 'aegis-world-dm-secret-v1';
  var ACCESS_MS = 12 * 60 * 60 * 1000;
  var root = window.AEGIS_WORLD = window.AEGIS_WORLD || {};
  var api = root.api;
  var role = document.body.getAttribute('data-world-role') === 'dm' ? 'dm' : 'player';
  var host = null;
  var localMode = null;
  var lastServerModeRev = -1;
  var toastTimer = null;
  var pendingDmResolve = null;
  var pendingConfirmResolve = null;

  function escapeHtml(value){
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function htmlToText(value){
    var div = document.createElement('div');
    div.innerHTML = value == null ? '' : String(value);
    return div.textContent.replace(/\u00a0/g, ' ').trim();
  }

  function field(character, key, fallback){
    var data = character && character.sheet_data;
    var fields = data && data.fields ? data.fields : {};
    return htmlToText(fields[key] || '') || fallback || '';
  }

  function number(value, fallback){
    var parsed = parseInt(htmlToText(value).replace(/[^\d-]/g, ''), 10);
    return isNaN(parsed) ? (fallback || 0) : parsed;
  }

  function characterStats(character){
    var fields = window.AEGIS_FIELDS || {};
    var live = fields.live || {};
    var max = number(field(character, live.maxHp || 'p1.maxhp'), 0);
    var current = number(field(character, live.currentHp || 'p1.curhp'), max);
    return {
      slug: character && character.slug || '',
      name: field(character, live.name || 'p1.name', character && character.name || ''),
      player: character && (character.player_name || character.player) || '',
      currentHp: current,
      maxHp: max,
      speed: field(character, live.speed || 'p1.speed', '-')
    };
  }

  function healthStatus(current, max){
    if (!max || max <= 0) return { label: 'Unknown', className: 'is-unknown' };
    if (current <= 0) return { label: 'Incapacitated', className: 'is-incapacitated' };
    if (current <= max / 2) return { label: 'Bloodied', className: 'is-bloodied' };
    return { label: 'Healthy', className: 'is-healthy' };
  }

  function conditionsFor(character){
    var fields = window.AEGIS_FIELDS || {};
    var labels = fields.conditionLabels || {};
    var prefix = fields.conditionPrefix || 'p1.cond.';
    var toggles = character && character.sheet_data && character.sheet_data.toggles || {};
    return Object.keys(labels).filter(function(key){
      return toggles[prefix + key] === 1 || toggles[prefix + key] === true;
    }).map(function(key){ return labels[key]; });
  }

  function deathSavesFor(character){
    var fields = window.AEGIS_FIELDS || {};
    var death = fields.deathSaves || {};
    var toggles = character && character.sheet_data && character.sheet_data.toggles || {};
    function count(prefix){
      return [1, 2, 3].reduce(function(total, index){
        var value = toggles[prefix + index];
        return total + (value === 1 || value === true ? 1 : 0);
      }, 0);
    }
    return {
      successes: count(death.successPrefix || 'p1.death.ok'),
      failures: count(death.failurePrefix || 'p1.death.f')
    };
  }

  function portraitFor(character){
    var images = character && character.sheet_data && character.sheet_data.images || {};
    var preferred = images.p3portrait;
    if (preferred && preferred.u) return preferred.u;
    var key = Object.keys(images).find(function(name){
      return images[name] && images[name].u;
    });
    return key ? images[key].u : '';
  }

  function splitConditions(value){
    return String(value || '').split(/[,;|]/).map(function(item){
      return item.trim();
    }).filter(Boolean);
  }

  function readStored(key){
    try {
      var value = JSON.parse(localStorage.getItem(key) || 'null');
      if (!value || Number(value.until) <= Date.now()) {
        localStorage.removeItem(key);
        return null;
      }
      return value;
    } catch (err) {
      return null;
    }
  }

  function writeStored(key, value){
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) {}
  }

  function playerSession(){
    return readStored(PLAYER_KEY);
  }

  function dmSession(){
    return readStored(DM_KEY);
  }

  function identifyPlayer(code){
    var normalized = String(code || '').trim().toLowerCase().replace(/\s+/g, ' ');
    var entry = (api.config.characters || []).find(function(character){
      return normalized === String(character.name + ' 712').toLowerCase();
    });
    if (!entry) return null;
    var session = {
      slug: entry.slug,
      name: entry.name,
      code: String(code || '').trim(),
      until: Date.now() + ACCESS_MS
    };
    writeStored(PLAYER_KEY, session);
    return session;
  }

  async function verifyDmSecret(secret){
    var valid = await api.rpc('world_verify_admin_secret', { p_secret: secret });
    if (!valid) return false;
    writeStored(DM_KEY, {
      secret: secret,
      until: Date.now() + ACCESS_MS
    });
    return true;
  }

  function requireDmSecret(){
    var stored = dmSession();
    if (stored && stored.secret) return Promise.resolve(stored.secret);
    var dialog = document.getElementById('worldDmAuthDialog');
    var input = document.getElementById('worldDmSecret');
    var error = document.getElementById('worldDmAuthError');
    if (!dialog || !input) return Promise.reject(new Error('DM authorization dialog is unavailable.'));
    if (pendingDmResolve) return pendingDmResolve.promise;
    var control = {};
    control.promise = new Promise(function(resolve, reject){
      control.resolve = resolve;
      control.reject = reject;
    });
    pendingDmResolve = control;
    error.textContent = '';
    input.value = '';
    dialog.showModal();
    setTimeout(function(){ input.focus(); }, 30);
    return control.promise;
  }

  function confirmAction(title, message, confirmLabel){
    var dialog = document.getElementById('worldConfirmDialog');
    if (!dialog) return Promise.resolve(window.confirm(message));
    document.getElementById('worldConfirmTitle').textContent = title;
    document.getElementById('worldConfirmMessage').textContent = message;
    document.getElementById('worldConfirmYes').textContent = confirmLabel || 'Confirm';
    dialog.showModal();
    return new Promise(function(resolve){
      pendingConfirmResolve = resolve;
    });
  }

  function toast(message, state){
    var el = document.getElementById('worldToast');
    if (!el) return;
    clearTimeout(toastTimer);
    el.textContent = message;
    el.dataset.state = state || '';
    el.hidden = false;
    toastTimer = setTimeout(function(){ el.hidden = true; }, 3200);
  }

  function icon(name){
    var paths = {
      fit: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/><path d="M9 9h6v6H9z"/>',
      zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>',
      zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6"/>',
      ruler: '<path d="m4 17 13-13 3 3L7 20H4v-3Z"/><path d="m14 7 3 3M11 10l2 2M8 13l3 3"/>',
      cone: '<path d="M5 19 19 5M5 19l5-14M5 19l14-5"/><path d="M10 5a14 14 0 0 1 9 9"/>',
      circle: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/>',
      ping: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/>',
      fullscreen: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
      lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
      user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A7 7 0 0 0 15 6l-.3-2.6h-4L10.4 6a7 7 0 0 0-1.5.9l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.5.9l.3 2.6h4L15 18a7 7 0 0 0 1.5-.9l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1.2Z"/>'
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || '') + '</svg>';
  }

  function buildMarkup(){
    return [
      '<section class="world-app" data-role="' + role + '" data-mode="encounter">',
        '<header class="world-command">',
          '<div class="world-mode-toggle" role="tablist" aria-label="World presentation">',
            '<button type="button" data-world-mode="encounter" class="active">Encounter</button>',
            '<button type="button" data-world-mode="scene">Scene</button>',
          '</div>',
          '<div class="world-command-meta">',
            '<span class="world-round">Round <b id="worldRound">1</b></span>',
            '<span class="world-live" id="worldLive"><i></i>Waiting</span>',
            '<span class="world-sync" id="worldConnection"><i></i>Connecting</span>',
          '</div>',
          '<div class="world-command-actions">',
            '<button type="button" class="world-icon-btn" id="worldIdentityBtn" title="Player identity" aria-label="Player identity">' + icon('user') + '</button>',
            (role === 'dm'
              ? '<button type="button" class="world-icon-btn" id="worldMovementLockBtn" title="Lock player movement" aria-label="Lock player movement">' + icon('lock') + '</button>' +
                '<button type="button" class="world-icon-btn" id="worldSettingsBtn" title="World controls" aria-label="World controls">' + icon('settings') + '</button>'
              : ''),
          '</div>',
        '</header>',

        '<div class="world-layout">',
          '<section class="world-board-shell" id="worldBoardShell" aria-label="Shared world board">',
            '<div class="world-viewport" id="worldViewport">',
              '<div class="world-stage" id="worldStage">',
                '<img class="world-map-image" id="worldMapImage" alt="">',
                '<img class="world-scene-image" id="worldSceneImage" alt="">',
                '<svg class="world-grid-layer" id="worldGridSvg" aria-hidden="true"></svg>',
                '<div class="world-token-layer" id="worldTokenLayer"></div>',
                '<svg class="world-overlay-layer" id="worldOverlaySvg" aria-label="Measurements and spell templates"></svg>',
              '</div>',
              '<div class="world-empty" id="worldEmpty">',
                '<span class="world-empty-mark">AS</span>',
                '<strong>No Active Map</strong>',
                '<span>The DM is preparing the field.</span>',
              '</div>',
              '<div class="world-transition" id="worldTransition" hidden>',
                '<span class="world-loader"></span>',
                '<strong>Scene Changing</strong>',
                '<span>Receiving new visual data...</span>',
              '</div>',
            '</div>',
            '<div class="world-tool-dock" role="toolbar" aria-label="Board tools">',
              '<button type="button" data-board-action="fit" title="Fit map">' + icon('fit') + '</button>',
              '<button type="button" data-board-action="zoom-in" title="Zoom in">' + icon('zoomIn') + '</button>',
              '<button type="button" data-board-action="zoom-out" title="Zoom out">' + icon('zoomOut') + '</button>',
              '<button type="button" data-world-tool="ruler" title="Measure distance">' + icon('ruler') + '</button>',
              '<button type="button" data-world-tool="cone" title="Cone template">' + icon('cone') + '</button>',
              '<button type="button" data-world-tool="circle" title="Circle template">' + icon('circle') + '</button>',
              '<button type="button" data-world-tool="ping" title="Ping location">' + icon('ping') + '</button>',
              '<label class="world-duration-select" title="Template duration"><span>Template</span><select id="worldTemplateDuration"><option value="turn">Next turn</option><option value="30">30 sec</option></select></label>',
            '</div>',
            '<button type="button" class="world-fullscreen" data-board-action="fullscreen" title="Fullscreen map" aria-label="Fullscreen map">' + icon('fullscreen') + '</button>',
          '</section>',

          '<aside class="world-rail" id="worldRail">',
            '<div id="worldTurnDock" class="world-turn-dock"></div>',
            '<div class="world-rail-heading"><span>Initiative</span><button type="button" id="worldPartyToggle">Party</button></div>',
            '<div class="world-initiative" id="worldInitiativeList"></div>',
            '<section class="world-party-panel" id="worldPartyPanel" hidden></section>',
            (role === 'dm' ? '<section class="world-staging" id="worldStaging"></section>' : ''),
          '</aside>',
        '</div>',

        '<section class="world-mobile-turn" id="worldMobileTurn"></section>',
        '<aside class="world-party-drawer" id="worldPartyDrawer" aria-label="Public party information">',
          '<button type="button" class="world-drawer-handle" id="worldDrawerHandle"><span></span>Party Information</button>',
          '<div class="world-party-drawer-body" id="worldPartyDrawerBody"></div>',
        '</aside>',
        (role === 'dm' ? '<aside class="world-dm-drawer" id="worldDmDrawer" aria-label="World controls"></aside>' : ''),
      '</section>',

      '<dialog class="world-dialog" id="worldIdentityDialog">',
        '<form method="dialog" id="worldIdentityForm">',
          '<div class="world-dialog-head"><span>Player Access</span><button value="cancel" aria-label="Close">×</button></div>',
          '<p>Enter your character access code to control your token on your turn.</p>',
          '<label><span>Character Code</span><input id="worldIdentityCode" type="password" autocomplete="current-password" placeholder="Character Name 712"></label>',
          '<p class="world-dialog-error" id="worldIdentityError"></p>',
          '<div class="world-dialog-actions"><button value="cancel">View Only</button><button type="submit" class="primary">Connect Character</button></div>',
        '</form>',
      '</dialog>',

      '<dialog class="world-dialog" id="worldDmAuthDialog">',
        '<form method="dialog" id="worldDmAuthForm">',
          '<div class="world-dialog-head"><span>World Command Key</span><button value="cancel" aria-label="Close">×</button></div>',
          '<p>Authorize privileged map, token, and turn controls for this device.</p>',
          '<label><span>Command Key</span><input id="worldDmSecret" type="password" autocomplete="current-password"></label>',
          '<p class="world-dialog-error" id="worldDmAuthError"></p>',
          '<div class="world-dialog-actions"><button value="cancel">Cancel</button><button type="submit" class="primary">Authorize</button></div>',
        '</form>',
      '</dialog>',

      '<dialog class="world-dialog world-confirm" id="worldConfirmDialog">',
        '<form method="dialog">',
          '<div class="world-dialog-head"><span id="worldConfirmTitle">Confirm</span></div>',
          '<p id="worldConfirmMessage"></p>',
          '<div class="world-dialog-actions"><button value="cancel" id="worldConfirmNo">Cancel</button><button value="confirm" class="primary" id="worldConfirmYes">Confirm</button></div>',
        '</form>',
      '</dialog>',
      '<div class="world-toast" id="worldToast" hidden></div>'
    ].join('');
  }

  async function setMode(mode){
    if (mode !== 'encounter' && mode !== 'scene') return;
    localMode = mode;
    renderShell(api.store);
    if (role !== 'dm') return;
    try {
      var secret = await requireDmSecret();
      var response = await api.rpc('world_set_state', {
        p_secret: secret,
        p_expected_rev: api.store.world.rev,
        p_patch: { mode: mode }
      });
      if (!response || !response.ok) throw new Error(response && response.error || 'Mode change failed.');
      api.refresh('mode').catch(function(){});
    } catch (err) {
      if (err && err.message !== 'cancelled') toast(err.message || String(err), 'error');
    }
  }

  function renderShell(state){
    if (!host || !state) return;
    if (state.world.rev !== lastServerModeRev) {
      lastServerModeRev = state.world.rev;
      if (localMode == null || role === 'dm') localMode = state.world.mode;
    }
    localMode = localMode || 'encounter';
    var app = host.querySelector('.world-app');
    if (app) app.dataset.mode = localMode;
    host.querySelectorAll('[data-world-mode]').forEach(function(button){
      var active = button.getAttribute('data-world-mode') === localMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    var round = document.getElementById('worldRound');
    if (round) round.textContent = state.turn.round || 1;
    var live = document.getElementById('worldLive');
    if (live) {
      live.classList.toggle('on', !!state.turn.combat_active);
      live.innerHTML = '<i></i>' + (state.turn.combat_active ? 'Combat Live' : 'Waiting');
    }
    var connection = document.getElementById('worldConnection');
    if (connection) {
      connection.classList.toggle('on', !!state.connected);
      connection.innerHTML = '<i></i>' + (state.connected ? 'Live Sync' : (state.error ? 'Offline' : 'Connecting'));
    }
    var topStatus = document.getElementById('worldCloudStatus');
    if (topStatus) topStatus.textContent = state.connected ? 'Live synced' : (state.error ? 'Polling fallback' : 'Connecting');
    var identity = document.getElementById('worldIdentityBtn');
    if (identity) {
      var player = playerSession();
      identity.classList.toggle('active', !!player);
      identity.title = player ? 'Connected as ' + player.name : 'Connect your character';
    }
    var lock = document.getElementById('worldMovementLockBtn');
    if (lock) {
      lock.classList.toggle('active', !!state.world.movement_locked);
      lock.setAttribute('aria-pressed', state.world.movement_locked ? 'true' : 'false');
    }
    var transition = document.getElementById('worldTransition');
    if (transition) transition.hidden = !state.world.scene_changing;
  }

  function wireDialogs(){
    var identityButton = document.getElementById('worldIdentityBtn');
    var identityDialog = document.getElementById('worldIdentityDialog');
    var identityForm = document.getElementById('worldIdentityForm');
    if (identityButton && identityDialog) {
      identityButton.addEventListener('click', function(){
        identityDialog.showModal();
        setTimeout(function(){ document.getElementById('worldIdentityCode').focus(); }, 20);
      });
    }
    if (identityForm) {
      identityForm.addEventListener('submit', function(evt){
        evt.preventDefault();
        var player = identifyPlayer(document.getElementById('worldIdentityCode').value);
        if (!player) {
          document.getElementById('worldIdentityError').textContent = 'Code not recognized.';
          return;
        }
        document.getElementById('worldIdentityError').textContent = '';
        identityDialog.close();
        toast('Connected as ' + player.name, 'saved');
        renderShell(api.store);
        document.dispatchEvent(new CustomEvent('aegis:world-identity'));
      });
    }

    var dmForm = document.getElementById('worldDmAuthForm');
    var dmDialog = document.getElementById('worldDmAuthDialog');
    if (dmForm) {
      dmForm.addEventListener('submit', async function(evt){
        evt.preventDefault();
        var secret = document.getElementById('worldDmSecret').value;
        var error = document.getElementById('worldDmAuthError');
        error.textContent = '';
        try {
          var valid = await verifyDmSecret(secret);
          if (!valid) {
            error.textContent = 'Command key not recognized.';
            return;
          }
          dmDialog.close();
          if (pendingDmResolve) pendingDmResolve.resolve(secret);
          pendingDmResolve = null;
          toast('World controls authorized', 'saved');
        } catch (err) {
          error.textContent = err.message || String(err);
        }
      });
      dmDialog.addEventListener('close', function(){
        if (pendingDmResolve) {
          pendingDmResolve.reject(new Error('cancelled'));
          pendingDmResolve = null;
        }
      });
    }

    var confirmDialog = document.getElementById('worldConfirmDialog');
    if (confirmDialog) {
      confirmDialog.addEventListener('close', function(){
        if (!pendingConfirmResolve) return;
        pendingConfirmResolve(confirmDialog.returnValue === 'confirm');
        pendingConfirmResolve = null;
      });
    }
  }

  function wireShell(){
    host.addEventListener('click', function(evt){
      var modeButton = evt.target.closest('[data-world-mode]');
      if (modeButton) {
        setMode(modeButton.getAttribute('data-world-mode'));
        return;
      }
      if (evt.target.closest('#worldSettingsBtn')) {
        document.getElementById('worldDmDrawer').classList.toggle('open');
        return;
      }
      if (evt.target.closest('#worldMovementLockBtn')) {
        requireDmSecret().then(function(secret){
          return api.rpc('world_set_state', {
            p_secret: secret,
            p_expected_rev: api.store.world.rev,
            p_patch: { movement_locked: !api.store.world.movement_locked }
          });
        }).then(function(response){
          if (!response || !response.ok) throw new Error(response && response.error || 'Lock change failed.');
          api.refresh('movement-lock');
        }).catch(function(err){
          if (err.message !== 'cancelled') toast(err.message, 'error');
        });
      }
    });
  }

  function initModules(){
    [
      root.board,
      root.grid,
      root.tokens,
      root.templates,
      root.turns,
      root.assets
    ].forEach(function(module){
      if (module && typeof module.init === 'function') module.init(host, role);
    });
  }

  function init(){
    api = root.api;
    host = document.getElementById('worldRoot') || document.getElementById('worldDmRoot');
    if (!host || !api) return;
    role = host.getAttribute('data-world-role') || document.body.getAttribute('data-world-role') || role;
    host.innerHTML = buildMarkup();
    wireShell();
    wireDialogs();
    initModules();
    document.addEventListener('aegis:world-state', function(evt){
      renderShell(evt.detail && evt.detail.state || api.store);
    });
    renderShell(api.store);
  }

  root.utils = {
    BUILD: BUILD,
    escapeHtml: escapeHtml,
    htmlToText: htmlToText,
    field: field,
    number: number,
    characterStats: characterStats,
    healthStatus: healthStatus,
    conditionsFor: conditionsFor,
    deathSavesFor: deathSavesFor,
    portraitFor: portraitFor,
    splitConditions: splitConditions,
    icon: icon
  };

  root.access = {
    playerSession: playerSession,
    identifyPlayer: identifyPlayer,
    dmSession: dmSession,
    requireDmSecret: requireDmSecret,
    verifyDmSecret: verifyDmSecret,
    confirm: confirmAction,
    toast: toast,
    role: function(){ return role; },
    mode: function(){ return localMode || api.store.world.mode || 'encounter'; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
