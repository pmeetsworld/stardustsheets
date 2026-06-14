(function(){
  'use strict';

  var KEY = 'aegis-view-mode-v1';
  var MODES = ['auto', 'mobile', 'desktop'];
  var MOBILE_QUERY = '(max-width: 820px)';
  var mq = window.matchMedia ? window.matchMedia(MOBILE_QUERY) : null;

  function validMode(mode){
    return MODES.indexOf(mode) >= 0 ? mode : 'auto';
  }

  function storedMode(){
    try {
      return validMode(localStorage.getItem(KEY) || 'auto');
    } catch (err) {
      return 'auto';
    }
  }

  function saveMode(mode){
    try { localStorage.setItem(KEY, mode); } catch (err) {}
  }

  function requestedMode(){
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get('view');
    if (MODES.indexOf(fromUrl) >= 0) {
      saveMode(fromUrl);
      return fromUrl;
    }
    return storedMode();
  }

  function isAutoMobile(mode){
    return mode === 'auto' && mq && mq.matches;
  }

  function applyMode(mode){
    mode = validMode(mode);
    var effectiveMobile = mode === 'mobile' || isAutoMobile(mode);
    document.documentElement.dataset.viewMode = mode;
    if (!document.body) return;
    document.body.classList.remove(
      'view-auto',
      'view-mobile',
      'view-desktop',
      'view-mobile-effective'
    );
    document.body.classList.add('view-' + mode);
    if (effectiveMobile) document.body.classList.add('view-mobile-effective');
    document.querySelectorAll('[data-view-choice]').forEach(function(btn){
      var active = btn.getAttribute('data-view-choice') === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function setMode(mode){
    mode = validMode(mode);
    saveMode(mode);
    applyMode(mode);
  }

  function buildToggle(){
    if (document.querySelector('.view-toggle')) return;
    var wrap = document.createElement('div');
    wrap.className = 'view-toggle';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Display mode');
    wrap.innerHTML = MODES.map(function(mode){
      return '<button type="button" data-view-choice="' + mode + '">' + mode + '</button>';
    }).join('');
    wrap.addEventListener('click', function(evt){
      var btn = evt.target.closest('[data-view-choice]');
      if (!btn) return;
      setMode(btn.getAttribute('data-view-choice'));
    });

    var toolbar = document.querySelector('.toolbar');
    if (toolbar) {
      var status = toolbar.querySelector('#cloudStatus, #dmCloudStatus, .spacer');
      if (status && status.classList.contains('spacer')) {
        toolbar.insertBefore(wrap, status.nextSibling);
      } else if (status) {
        toolbar.insertBefore(wrap, status);
      } else {
        toolbar.appendChild(wrap);
      }
    } else {
      wrap.classList.add('view-floating');
      document.body.appendChild(wrap);
    }
  }

  function init(){
    buildToggle();
    applyMode(requestedMode());
    if (mq) {
      var refresh = function(){ applyMode(storedMode()); };
      if (mq.addEventListener) mq.addEventListener('change', refresh);
      else if (mq.addListener) mq.addListener(refresh);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
