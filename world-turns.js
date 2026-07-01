(function(){
  'use strict';

  var root = window.AEGIS_WORLD = window.AEGIS_WORLD || {};
  var api = root.api;
  var utils = null;
  var host = null;
  var role = 'player';
  var list = null;
  var dock = null;
  var partyPanel = null;
  var partyDrawer = null;
  var mobileTurn = null;

  function activeMapTokens(){
    var mapId = api.store.world.active_map_id;
    return api.store.tokens.filter(function(token){
      if (token.map_id !== mapId || token.staged) return false;
      if (role !== 'dm' && token.kind !== 'pc' && token.defeated) return false;
      return true;
    });
  }

  function orderedTokens(){
    var byId = {};
    activeMapTokens().forEach(function(token){ byId[token.id] = token; });
    var ordered = api.store.turn.order_ids.map(function(id){ return byId[id]; }).filter(Boolean);
    activeMapTokens().forEach(function(token){
      if (!ordered.some(function(item){ return item.id === token.id; })) ordered.push(token);
    });
    return ordered;
  }

  function publicData(token){
    if (token.kind === 'pc') {
      var character = api.character(token.slug);
      var stats = utils.characterStats(character);
      return {
        name: stats.name || token.name,
        player: stats.player,
        speed: stats.speed,
        status: utils.healthStatus(stats.currentHp, stats.maxHp),
        conditions: utils.conditionsFor(character),
        deaths: utils.deathSavesFor(character),
        currentHp: stats.currentHp,
        maxHp: stats.maxHp
      };
    }
    return {
      name: token.name || 'Combatant',
      player: token.kind.charAt(0).toUpperCase() + token.kind.slice(1),
      speed: '',
      status: utils.healthStatus(Number(token.current_hp || 0), Number(token.max_hp || 0)),
      conditions: utils.splitConditions(token.conditions),
      deaths: { successes: 0, failures: 0 },
      currentHp: Number(token.current_hp || 0),
      maxHp: Number(token.max_hp || 0)
    };
  }

  function conditionHtml(items){
    if (!items || !items.length) return '<span class="world-no-conditions">No conditions</span>';
    return items.map(function(item){
      return '<span class="world-condition">' + utils.escapeHtml(item) + '</span>';
    }).join('');
  }

  function deathHtml(token, data){
    if (token.kind !== 'pc') return '';
    if (data.currentHp > 0 && !data.deaths.successes && !data.deaths.failures) return '';
    function dots(kind, count){
      var value = '';
      for (var i = 1; i <= 3; i += 1) {
        value += '<i class="' + kind + (count >= i ? ' on' : '') + '"></i>';
      }
      return value;
    }
    return '<div class="world-deaths"><span>Death</span>' +
      '<b>S</b>' + dots('success', data.deaths.successes) +
      '<b>F</b>' + dots('failure', data.deaths.failures) + '</div>';
  }

  function tokenAvatar(token, data){
    var art = root.tokens && root.tokens.tokenDiameter ? (function(){
      var character = token.slug ? api.character(token.slug) : null;
      var direct = token.art_asset_id && api.store.assets.find(function(item){ return item.id === token.art_asset_id; });
      if (direct) return api.assetUrl(direct.storage_path);
      var preference = api.store.defaults.find(function(item){ return item.slug === token.slug; });
      var asset = preference && api.store.assets.find(function(item){ return item.id === preference.art_asset_id; });
      return asset ? api.assetUrl(asset.storage_path) : utils.portraitFor(character);
    })() : '';
    var initials = String(data.name || '?').replace(/["']/g, '').split(/\s+/).filter(Boolean)
      .slice(0, 2).map(function(part){ return part.charAt(0); }).join('');
    return '<span class="world-init-avatar"' + (art ? ' style="background-image:url(\'' + String(art).replace(/'/g, '%27') + '\')"' : '') + '>' +
      (art ? '' : utils.escapeHtml(initials)) + '</span>';
  }

  function initiativeRow(token, index){
    var data = publicData(token);
    var activeIndex = Math.min(api.store.turn.active_index, Math.max(0, api.store.turn.order_ids.length - 1));
    var activeId = api.store.turn.order_ids[activeIndex] || '';
    var nextId = api.store.turn.order_ids.length
      ? api.store.turn.order_ids[(activeIndex + 1) % api.store.turn.order_ids.length]
      : '';
    var active = token.id === activeId;
    var next = !active && token.id === nextId;
    var delayed = api.store.turn.delayed_ids.indexOf(String(token.id)) >= 0;
    return [
      '<article class="world-init-row is-' + token.kind + (active ? ' active' : '') + (next ? ' on-deck' : '') + '" data-turn-token="' + utils.escapeHtml(token.id) + '">',
        '<div class="world-init-value">',
          role === 'dm'
            ? '<input type="number" step="1" value="' + utils.escapeHtml(token.initiative == null ? '' : token.initiative) + '" data-init-token="' + utils.escapeHtml(token.id) + '" aria-label="Initiative for ' + utils.escapeHtml(data.name) + '">'
            : utils.escapeHtml(token.initiative == null ? '-' : token.initiative),
        '</div>',
        tokenAvatar(token, data),
        '<div class="world-init-copy">',
          '<strong>' + utils.escapeHtml(data.name) + '</strong>',
          '<span class="world-health ' + data.status.className + '">' + utils.escapeHtml(data.status.label) + '</span>',
          '<div class="world-condition-line">' + conditionHtml(data.conditions) + '</div>',
          deathHtml(token, data),
        '</div>',
        '<div class="world-turn-flags">',
          active ? '<span class="acting">Acting</span>' : '',
          next ? '<span class="deck">On Deck</span>' : '',
          delayed ? '<span class="delayed">Delayed</span>' : '',
        '</div>',
      '</article>'
    ].join('');
  }

  function partyCard(token){
    if (token.kind !== 'pc') return '';
    var data = publicData(token);
    return [
      '<article class="world-party-card">',
        tokenAvatar(token, data),
        '<div class="world-party-copy">',
          '<strong>' + utils.escapeHtml(data.name) + '</strong>',
          '<span>' + utils.escapeHtml(data.player) + (data.speed ? ' · Speed ' + utils.escapeHtml(data.speed) : '') + '</span>',
          '<div class="world-condition-line">' + conditionHtml(data.conditions) + '</div>',
        '</div>',
        '<span class="world-health ' + data.status.className + '">' + utils.escapeHtml(data.status.label) + '</span>',
        deathHtml(token, data),
      '</article>'
    ].join('');
  }

  function renderDock(){
    if (!dock) return;
    if (role !== 'dm') {
      dock.innerHTML = '';
      return;
    }
    dock.innerHTML = [
      '<div class="world-dock-title"><span>DM Turn Dock</span><b>REV ' + api.store.turn.rev + '</b></div>',
      '<div class="world-dock-actions">',
        '<button type="button" data-turn-action="undo">Undo</button>',
        '<button type="button" data-turn-action="skip">Skip</button>',
        '<button type="button" data-turn-action="delay">Delay</button>',
        '<button type="button" class="primary" data-turn-action="advance">Advance</button>',
      '</div>',
      '<div class="world-dock-actions secondary">',
        '<button type="button" data-roll-scope="all">Roll All</button>',
        '<button type="button" data-roll-scope="dm">Roll DM</button>',
        '<button type="button" data-roll-scope="manual">Use Entered</button>',
        '<button type="button" data-combat-toggle="' + (!api.store.turn.combat_active) + '">' + (api.store.turn.combat_active ? 'End Combat' : 'Combat Live') + '</button>',
      '</div>'
    ].join('');
  }

  function renderMobileTurn(){
    if (!mobileTurn) return;
    var active = api.activeToken();
    var order = orderedTokens();
    var activeIndex = active ? order.findIndex(function(token){ return token.id === active.id; }) : -1;
    var next = order.length && activeIndex >= 0 ? order[(activeIndex + 1) % order.length] : null;
    if (!active || !api.store.turn.combat_active) {
      mobileTurn.innerHTML = '<span class="world-mobile-waiting">Waiting for combat</span>';
      return;
    }
    var data = publicData(active);
    var nextData = next && publicData(next);
    var player = root.access.playerSession();
    var isOwner = role === 'player' && player && active.owner_slug === player.slug;
    mobileTurn.innerHTML = [
      '<div class="world-mobile-active">',
        tokenAvatar(active, data),
        '<span><small>' + (isOwner ? 'Your Turn' : 'Acting') + '</small><strong>' + utils.escapeHtml(data.name) + '</strong><em class="' + data.status.className + '">' + utils.escapeHtml(data.status.label) + '</em></span>',
      '</div>',
      next ? '<div class="world-mobile-next"><small>On Deck</small><strong>' + utils.escapeHtml(nextData.name) + '</strong></div>' : '',
      isOwner ? '<button type="button" class="world-end-turn" data-turn-action="end_turn">End Turn</button>' : '',
      role === 'dm' ? '<button type="button" class="world-dm-mobile" id="worldDmMobileBtn">DM</button>' : ''
    ].join('');
  }

  function render(){
    if (!list) return;
    var rows = orderedTokens();
    list.innerHTML = rows.length ? rows.map(initiativeRow).join('') :
      '<p class="world-empty-copy">Deploy tokens to establish an initiative order.</p>';
    var party = rows.filter(function(token){ return token.kind === 'pc'; }).map(partyCard).join('');
    if (partyPanel) partyPanel.innerHTML = party || '<p class="world-empty-copy">No party tokens deployed.</p>';
    if (partyDrawer) partyDrawer.innerHTML = party || '<p class="world-empty-copy">No public party data available.</p>';
    renderDock();
    renderMobileTurn();
  }

  async function turnAction(action, targetId){
    try {
      var credential;
      if (action === 'end_turn') {
        var player = root.access.playerSession();
        if (!player) {
          document.getElementById('worldIdentityDialog').showModal();
          return;
        }
        var confirmed = await root.access.confirm('End Turn', 'End your turn and advance initiative?', 'End Turn');
        if (!confirmed) return;
        credential = player.code;
        targetId = api.activeToken() && api.activeToken().id;
      } else {
        credential = await root.access.requireDmSecret();
        if (action === 'undo') {
          var undo = await root.access.confirm('Undo Turn', 'Restore the previous turn and every token position?', 'Undo Turn');
          if (!undo) return;
        }
      }
      var response = await api.rpc('world_advance_turn', {
        p_secret_or_owner: credential,
        p_action: action,
        p_target_id: targetId || null,
        p_expected_rev: api.store.turn.rev
      });
      if (!response || !response.ok) throw new Error(response && response.error || 'Turn action failed.');
      await api.refresh('turn:' + action);
    } catch (err) {
      if (err.message !== 'cancelled') root.access.toast(err.message || String(err), 'error');
    }
  }

  async function roll(scope){
    try {
      var secret = await root.access.requireDmSecret();
      var response = await api.rpc('world_roll_initiative', {
        p_secret: secret,
        p_scope: scope,
        p_expected_rev: api.store.turn.rev
      });
      if (!response || !response.ok) throw new Error(response && response.error || 'Initiative roll failed.');
      await api.refresh('initiative');
    } catch (err) {
      if (err.message !== 'cancelled') root.access.toast(err.message || String(err), 'error');
    }
  }

  async function toggleCombat(value){
    try {
      var secret = await root.access.requireDmSecret();
      var response = await api.rpc('world_patch_turn', {
        p_secret: secret,
        p_expected_rev: api.store.turn.rev,
        p_patch: { combat_active: value }
      });
      if (!response || !response.ok) throw new Error(response && response.error || 'Combat state failed.');
      await api.refresh('combat-toggle');
    } catch (err) {
      if (err.message !== 'cancelled') root.access.toast(err.message || String(err), 'error');
    }
  }

  async function updateInitiative(input){
    var token = api.token(input.getAttribute('data-init-token'));
    if (!token) return;
    try {
      var secret = await root.access.requireDmSecret();
      var response = await api.rpc('world_update_token', {
        p_secret: secret,
        p_token_id: token.id,
        p_payload: { initiative: input.value }
      });
      if (!response || !response.ok) throw new Error(response && response.error || 'Initiative update failed.');
      api.refresh('initiative-value');
    } catch (err) {
      if (err.message !== 'cancelled') root.access.toast(err.message || String(err), 'error');
    }
  }

  function wire(){
    host.addEventListener('click', function(evt){
      var action = evt.target.closest('[data-turn-action]');
      if (action) {
        turnAction(action.getAttribute('data-turn-action'), action.closest('[data-turn-token]') && action.closest('[data-turn-token]').getAttribute('data-turn-token'));
        return;
      }
      var rollButton = evt.target.closest('[data-roll-scope]');
      if (rollButton) {
        roll(rollButton.getAttribute('data-roll-scope'));
        return;
      }
      var combat = evt.target.closest('[data-combat-toggle]');
      if (combat) {
        toggleCombat(combat.getAttribute('data-combat-toggle') === 'true');
        return;
      }
      var row = evt.target.closest('[data-turn-token]');
      if (row && role === 'dm' && !evt.target.closest('input')) {
        turnAction('select', row.getAttribute('data-turn-token'));
        return;
      }
      if (evt.target.closest('#worldPartyToggle')) {
        partyPanel.hidden = !partyPanel.hidden;
      }
      if (evt.target.closest('#worldDrawerHandle')) {
        document.getElementById('worldPartyDrawer').classList.toggle('open');
      }
      if (evt.target.closest('#worldDmMobileBtn')) {
        document.getElementById('worldDmDrawer').classList.add('open');
      }
    });
    host.addEventListener('change', function(evt){
      if (evt.target.matches('[data-init-token]')) updateInitiative(evt.target);
    });
  }

  function init(nextHost, nextRole){
    host = nextHost;
    role = nextRole;
    utils = root.utils;
    list = document.getElementById('worldInitiativeList');
    dock = document.getElementById('worldTurnDock');
    partyPanel = document.getElementById('worldPartyPanel');
    partyDrawer = document.getElementById('worldPartyDrawerBody');
    mobileTurn = document.getElementById('worldMobileTurn');
    if (!list) return;
    wire();
    document.addEventListener('aegis:world-state', render);
    document.addEventListener('aegis:world-identity', render);
    render();
  }

  root.turns = {
    init: init,
    render: render,
    orderedTokens: orderedTokens,
    publicData: publicData,
    action: turnAction
  };
})();
