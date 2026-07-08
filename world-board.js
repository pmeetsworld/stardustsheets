(function(){
  'use strict';

  var root = window.AEGIS_WORLD = window.AEGIS_WORLD || {};
  var api = root.api;
  var host = null;
  var role = 'player';
  var viewport = null;
  var stage = null;
  var mapImage = null;
  var sceneImage = null;
  var empty = null;
  var currentAssetId = '';
  var naturalWidth = 0;
  var naturalHeight = 0;
  var MIN_SCALE = 0.05;
  var MAX_SCALE = 8;
  var camera = { x: 0, y: 0, scale: 1 };
  var fitted = false;
  var userAdjusted = false;   // true once the user pans/zooms manually
  var cameraAssetId = '';     // asset the camera was last initialized for
  var pointers = {};
  var panStart = null;
  var pinchStart = null;
  var saveTimer = null;
  var resizeObserver = null;

  function cameraKey(){
    return 'aegis-world-view-v1:' + (currentAssetId || 'none');
  }

  function saveCamera(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function(){
      try { localStorage.setItem(cameraKey(), JSON.stringify(camera)); } catch (err) {}
    }, 120);
  }

  function restoreCamera(){
    try {
      var value = JSON.parse(localStorage.getItem(cameraKey()) || 'null');
      if (value && isFinite(value.x) && isFinite(value.y) && isFinite(value.scale)) {
        camera = {
          x: Number(value.x),
          y: Number(value.y),
          scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number(value.scale)))
        };
        return true;
      }
    } catch (err) {}
    return false;
  }

  function applyCamera(){
    if (!stage) return;
    stage.style.transform = 'translate3d(' + camera.x + 'px,' + camera.y + 'px,0) scale(' + camera.scale + ')';
    document.dispatchEvent(new CustomEvent('aegis:board-camera', { detail: camera }));
    saveCamera();
  }

  function fit(){
    if (!viewport || !naturalWidth || !naturalHeight) return;
    var rect = viewport.getBoundingClientRect();
    var pad = 20;
    var scale = Math.min(
      Math.max(0.05, (rect.width - pad * 2) / naturalWidth),
      Math.max(0.05, (rect.height - pad * 2) / naturalHeight)
    );
    // Single scale clamp for the whole board (was max 4 here vs 8 in
    // zoomAt/restoreCamera, which made "fit" fight manual zoom).
    camera.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    camera.x = (rect.width - naturalWidth * camera.scale) / 2;
    camera.y = (rect.height - naturalHeight * camera.scale) / 2;
    fitted = true;
    userAdjusted = false;
    applyCamera();
  }

  function zoomAt(nextScale, clientX, clientY){
    if (!viewport || !naturalWidth) return;
    userAdjusted = true;
    var rect = viewport.getBoundingClientRect();
    var pointX = (clientX == null ? rect.left + rect.width / 2 : clientX) - rect.left;
    var pointY = (clientY == null ? rect.top + rect.height / 2 : clientY) - rect.top;
    var mapX = (pointX - camera.x) / camera.scale;
    var mapY = (pointY - camera.y) / camera.scale;
    nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));
    camera.x = pointX - mapX * nextScale;
    camera.y = pointY - mapY * nextScale;
    camera.scale = nextScale;
    applyCamera();
  }

  function screenToMap(clientX, clientY){
    var rect = viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - camera.x) / camera.scale,
      y: (clientY - rect.top - camera.y) / camera.scale
    };
  }

  function mapToScreen(x, y){
    var rect = viewport.getBoundingClientRect();
    return {
      x: rect.left + camera.x + x * camera.scale,
      y: rect.top + camera.y + y * camera.scale
    };
  }

  function clampPoint(point, radius){
    radius = Number(radius) || 0;
    return {
      x: Math.max(radius, Math.min(naturalWidth - radius, point.x)),
      y: Math.max(radius, Math.min(naturalHeight - radius, point.y))
    };
  }

  function setDimensions(width, height){
    naturalWidth = Math.max(1, Number(width) || 1);
    naturalHeight = Math.max(1, Number(height) || 1);
    stage.style.width = naturalWidth + 'px';
    stage.style.height = naturalHeight + 'px';
    [document.getElementById('worldGridSvg'), document.getElementById('worldOverlaySvg')].forEach(function(svg){
      if (!svg) return;
      svg.setAttribute('viewBox', '0 0 ' + naturalWidth + ' ' + naturalHeight);
      svg.setAttribute('width', naturalWidth);
      svg.setAttribute('height', naturalHeight);
    });
    document.dispatchEvent(new CustomEvent('aegis:board-ready', {
      detail: { width: naturalWidth, height: naturalHeight }
    }));
  }

  function imageLoaded(image, asset){
    if (!asset || currentAssetId !== asset.id) return;
    var width = asset.natural_w || image.naturalWidth;
    var height = asset.natural_h || image.naturalHeight;
    if (width !== naturalWidth || height !== naturalHeight || cameraAssetId !== asset.id) {
      setDimensions(width, height);
    }
    // Initialize the camera once per asset. Realtime/poll syncs re-enter
    // here for the same image; they must never re-apply fit/restore or they
    // fight the user's live pan/zoom.
    if (cameraAssetId !== asset.id) {
      cameraAssetId = asset.id;
      if (restoreCamera()) {
        fitted = true;
        userAdjusted = true;   // a stored view is a user-chosen view
        applyCamera();
      } else {
        fit();
      }
    }
    empty.hidden = true;
    viewport.classList.add('has-image');
  }

  function loadImage(image, asset, label){
    if (!asset) {
      image.removeAttribute('src');
      image.alt = '';
      return;
    }
    var url = api.assetUrl(asset.storage_path);
    if (image.getAttribute('src') !== url) {
      image.alt = label || asset.name || '';
      image.onload = function(){ imageLoaded(image, asset); };
      image.onerror = function(){
        empty.hidden = false;
        empty.querySelector('strong').textContent = 'Visual Unavailable';
        empty.querySelector('span:last-child').textContent = 'The asset could not be loaded.';
      };
      image.src = url;
    } else if (image.complete && image.naturalWidth) {
      imageLoaded(image, asset);
    }
  }

  function render(){
    if (!viewport || !api.store.ready) return;
    var mode = root.access && root.access.mode ? root.access.mode() : api.store.world.mode;
    var asset = mode === 'scene' ? api.activeSceneAsset() : api.activeMapAsset();
    var nextId = asset && asset.id || '';
    viewport.dataset.mode = mode;
    if (nextId !== currentAssetId) {
      currentAssetId = nextId;
      fitted = false;
      viewport.classList.remove('has-image');
      empty.hidden = !!asset;
      if (!asset) {
        empty.querySelector('strong').textContent = mode === 'scene' ? 'No Active Scene' : 'No Active Map';
        empty.querySelector('span:last-child').textContent = 'The DM is preparing the field.';
      }
    }
    loadImage(mapImage, mode === 'encounter' ? asset : null, asset && asset.name);
    loadImage(sceneImage, mode === 'scene' ? asset : null, asset && asset.name);
  }

  function beginPan(evt){
    if (evt.button != null && evt.button !== 0) return;
    if (evt.target.closest('.world-token,.world-tool-dock,.world-fullscreen,.world-template,.world-template-handle,.world-template-toolbar')) return;
    if (document.body.dataset.worldTool) return;
    pointers[evt.pointerId] = { x: evt.clientX, y: evt.clientY };
    viewport.setPointerCapture(evt.pointerId);
    var ids = Object.keys(pointers);
    if (ids.length === 1) {
      panStart = {
        pointerX: evt.clientX,
        pointerY: evt.clientY,
        cameraX: camera.x,
        cameraY: camera.y
      };
    } else if (ids.length === 2) {
      var a = pointers[ids[0]];
      var b = pointers[ids[1]];
      pinchStart = {
        distance: Math.hypot(b.x - a.x, b.y - a.y),
        scale: camera.scale,
        centerX: (a.x + b.x) / 2,
        centerY: (a.y + b.y) / 2
      };
      panStart = null;
    }
  }

  function movePan(evt){
    if (!pointers[evt.pointerId]) return;
    pointers[evt.pointerId] = { x: evt.clientX, y: evt.clientY };
    var ids = Object.keys(pointers);
    if (ids.length === 2 && pinchStart) {
      var a = pointers[ids[0]];
      var b = pointers[ids[1]];
      var distance = Math.hypot(b.x - a.x, b.y - a.y);
      zoomAt(pinchStart.scale * (distance / Math.max(1, pinchStart.distance)), (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (panStart && ids.length === 1) {
      userAdjusted = true;
      camera.x = panStart.cameraX + evt.clientX - panStart.pointerX;
      camera.y = panStart.cameraY + evt.clientY - panStart.pointerY;
      applyCamera();
    }
  }

  function endPan(evt){
    delete pointers[evt.pointerId];
    if (viewport.hasPointerCapture && viewport.hasPointerCapture(evt.pointerId)) {
      viewport.releasePointerCapture(evt.pointerId);
    }
    if (Object.keys(pointers).length < 2) pinchStart = null;
    if (!Object.keys(pointers).length) panStart = null;
  }

  function wire(){
    viewport.addEventListener('pointerdown', beginPan);
    viewport.addEventListener('pointermove', movePan);
    viewport.addEventListener('pointerup', endPan);
    viewport.addEventListener('pointercancel', endPan);
    viewport.addEventListener('wheel', function(evt){
      evt.preventDefault();
      zoomAt(camera.scale * (evt.deltaY < 0 ? 1.12 : 0.89), evt.clientX, evt.clientY);
    }, { passive: false });

    host.addEventListener('click', function(evt){
      var button = evt.target.closest('[data-board-action]');
      if (!button) return;
      var action = button.getAttribute('data-board-action');
      if (action === 'fit') fit();
      if (action === 'zoom-in') zoomAt(camera.scale * 1.2);
      if (action === 'zoom-out') zoomAt(camera.scale / 1.2);
      if (action === 'fullscreen') {
        var shell = document.getElementById('worldBoardShell');
        if (document.fullscreenElement) document.exitFullscreen();
        else if (shell.requestFullscreen) shell.requestFullscreen();
      }
    });

    // Resizes (including the mobile URL bar showing/hiding) only refit when
    // the user has not chosen their own pan/zoom; a manual view is preserved.
    window.addEventListener('resize', function(){
      if (!fitted || userAdjusted) return;
      fit();
    });
    document.addEventListener('fullscreenchange', function(){
      setTimeout(function(){ if (fitted && !userAdjusted) fit(); }, 60);
    });
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(function(){
        if (!naturalWidth || !fitted || userAdjusted) return;
        fit();
      });
      resizeObserver.observe(viewport);
    }
  }

  function init(nextHost, nextRole){
    host = nextHost;
    role = nextRole;
    viewport = document.getElementById('worldViewport');
    stage = document.getElementById('worldStage');
    mapImage = document.getElementById('worldMapImage');
    sceneImage = document.getElementById('worldSceneImage');
    empty = document.getElementById('worldEmpty');
    if (!viewport || !stage) return;
    wire();
    document.addEventListener('aegis:world-state', render);
    host.addEventListener('click', function(evt){
      if (evt.target.closest('[data-world-mode]')) setTimeout(render, 0);
    });
    render();
  }

  root.board = {
    init: init,
    render: render,
    fit: fit,
    zoomAt: zoomAt,
    screenToMap: screenToMap,
    mapToScreen: mapToScreen,
    clampPoint: clampPoint,
    camera: function(){ return Object.assign({}, camera); },
    dimensions: function(){ return { width: naturalWidth, height: naturalHeight }; },
    stage: function(){ return stage; },
    viewport: function(){ return viewport; },
    role: function(){ return role; }
  };
})();
