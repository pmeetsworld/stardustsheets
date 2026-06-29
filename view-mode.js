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

  function initToolbarMenu(){
    var toolbar = document.querySelector('.sheet-toolbar');
    var btn = document.getElementById('sheetMenuBtn');
    var menu = document.getElementById('sheetToolbarActions');
    if (!toolbar || !btn || !menu || btn.__wiredToolbarMenu) return;
    btn.__wiredToolbarMenu = 1;

    function setOpen(open){
      toolbar.classList.toggle('menu-open', !!open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    btn.addEventListener('click', function(evt){
      evt.stopPropagation();
      setOpen(!toolbar.classList.contains('menu-open'));
    });
    menu.addEventListener('click', function(evt){
      if (evt.target.closest('button')) setTimeout(function(){ setOpen(false); }, 0);
    });
    document.addEventListener('click', function(evt){
      if (!toolbar.classList.contains('menu-open')) return;
      if (toolbar.contains(evt.target)) return;
      setOpen(false);
    });
    document.addEventListener('keydown', function(evt){
      if (evt.key === 'Escape') setOpen(false);
    });
  }

  function isFeatureContinuation(page){
    var label = page.getAttribute('data-screen-label') || '';
    return page.classList.contains('feat-cont') || label.indexOf('cont') >= 0;
  }

  function shortPageLabel(page, index){
    var label = page.getAttribute('data-screen-label') || '';
    if (page.id === 'page-arsenal' || label.indexOf('Spells') >= 0) return 'Spells';
    if (label.indexOf('Operative') >= 0) return 'Combat';
    if (label.indexOf('Features') >= 0) return 'Features';
    if (label.indexOf('Profile') >= 0) return 'Profile';
    return 'Page ' + (index + 1);
  }

  function sectionTarget(key){
    if (key === 'skills') return document.querySelector('.page[data-screen-label^="Page 1"] .mp1-abilities');
    return null;
  }

  function pageNavItems(pages){
    var items = [];
    pages.forEach(function(page, index){
      if (isFeatureContinuation(page)) return;
      var label = shortPageLabel(page, index);
      items.push({ label: label, page: index });
      if (label === 'Combat' && page.querySelector('.mp1-abilities')) {
        items.push({ label: 'Skills', target: 'skills' });
      }
    });
    return items;
  }

  function updatePageNavActive(){
    var nav = document.querySelector('.sheet-page-nav');
    if (!nav) return;
    var pages = Array.prototype.slice.call(document.querySelectorAll('section.page'));
    var current = 0;
    var currentTarget = null;
    pages.forEach(function(page, index){
      var rect = page.getBoundingClientRect();
      if (rect.top <= 130 && rect.bottom > 130) current = index;
    });
    if (pages[current] && isFeatureContinuation(pages[current])) {
      pages.some(function(page, index){
        var label = page.getAttribute('data-screen-label') || '';
        if (!isFeatureContinuation(page) && label.indexOf('Features') >= 0) {
          current = index;
          return true;
        }
        return false;
      });
    }
    nav.querySelectorAll('[data-page-target]').forEach(function(btn){
      var target = sectionTarget(btn.getAttribute('data-page-target'));
      if (!target) return;
      var rect = target.getBoundingClientRect();
      if (rect.top <= 150 && rect.bottom > 150) currentTarget = btn.getAttribute('data-page-target');
    });
    nav.querySelectorAll('button').forEach(function(btn){
      var targetKey = btn.getAttribute('data-page-target');
      var active = targetKey
        ? targetKey === currentTarget
        : !currentTarget && parseInt(btn.getAttribute('data-page-jump'), 10) === current;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-current', active ? 'page' : 'false');
    });
  }

  function buildPageNav(){
    var pages = Array.prototype.slice.call(document.querySelectorAll('section.page'));
    if (!pages.length) return;
    var nav = document.querySelector('.sheet-page-nav');
    if (!nav) {
      nav = document.createElement('nav');
      nav.className = 'sheet-page-nav';
      nav.setAttribute('aria-label', 'Sheet pages');
      nav.addEventListener('click', function(evt){
        var btn = evt.target.closest('[data-page-jump], [data-page-target]');
        if (!btn) return;
        var targetKey = btn.getAttribute('data-page-target');
        if (targetKey) {
          var section = sectionTarget(targetKey);
          if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
        var index = parseInt(btn.getAttribute('data-page-jump'), 10);
        var target = document.querySelectorAll('section.page')[index];
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      document.body.appendChild(nav);
    }
    document.body.classList.add('has-sheet-page-nav');
    nav.innerHTML = pageNavItems(pages).map(function(item){
      if (item.target) return '<button type="button" data-page-target="' + item.target + '">' + item.label + '</button>';
      return '<button type="button" data-page-jump="' + item.page + '">' + item.label + '</button>';
    }).join('');
    updatePageNavActive();
  }

  function watchPageNav(){
    if (!document.querySelector('section.page')) return;
    var pending = 0;
    var observer = new MutationObserver(function(){
      clearTimeout(pending);
      pending = setTimeout(buildPageNav, 40);
    });
    observer.observe(document.body, { childList: true });
    window.addEventListener('scroll', updatePageNavActive, { passive: true });
  }

  function init(){
    buildToggle();
    initToolbarMenu();
    buildPageNav();
    watchPageNav();
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
