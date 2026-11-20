/*
 * SOLACE — app shell, router and page interactions.
 *
 * Structure
 *   Shell (mounted once): veil, nav, search, menu, currency, ScrollSmoother, router.
 *   View  ([data-view]):  the page body. Links to other pages fetch the next HTML,
 *                         swap only the view, and keep the shell alive — like an app.
 *                         Every page is still a real HTML file, so deep links,
 *                         refresh and crawlers work without JavaScript.
 *
 * Motion rule: things arrive in 0.5s (ease), leave in 0.25s, hide by fading.
 */
(function () {
  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var u = function (id, w) { return 'https://images.unsplash.com/photo-' + id + '?w=' + (w || 900) + '&q=75&auto=format&fit=crop'; };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var hasGsap = !!(window.gsap && window.ScrollTrigger);
  if (hasGsap) {
    gsap.registerPlugin(ScrollTrigger);
    if (window.ScrollSmoother) gsap.registerPlugin(ScrollSmoother);
    root.classList.add('has-motion');
  }

  /* =====================================================================
   * SHELL
   * ===================================================================== */

  /* ---------- smooth scrolling ---------- */
  var smoother = null;
  function createSmoother() {
    if (!hasGsap || !window.ScrollSmoother || reduce.matches || smoother) return;
    smoother = ScrollSmoother.create({
      wrapper: '#smooth-wrapper',
      content: '#smooth-content',
      smooth: 1.2,          // seconds the content takes to catch up: slow, calm glide
      effects: true,
      smoothTouch: false,   // phones keep their native momentum scrolling
      normalizeScroll: false
    });
  }
  createSmoother();
  reduce.addEventListener && reduce.addEventListener('change', function () {
    if (reduce.matches && smoother) { smoother.kill(); smoother = null; } else createSmoother();
  });

  function navOffset() { return document.getElementById('nav').offsetHeight; }
  function scrollToTarget(el, smooth) {
    if (!el) return;
    if (smoother) smoother.scrollTo(el, smooth, 'top ' + navOffset() + 'px');
    else el.scrollIntoView({ behavior: smooth && !reduce.matches ? 'smooth' : 'auto' });
  }
  function scrollToTop() { if (smoother) smoother.scrollTop(0); window.scrollTo(0, 0); }

  /* ---------- veil (first load) ---------- */
  var veil = document.querySelector('.veil');
  function lift() { requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.remove('is-entering'); }); }); }
  if (document.readyState === 'complete') lift(); else window.addEventListener('load', lift);
  setTimeout(function () { root.classList.remove('is-entering'); }, 2500);
  window.addEventListener('pageshow', function (e) { if (e.persisted) { veil.classList.remove('is-on'); root.classList.remove('is-entering'); } });

  /* ---------- navigation bar ---------- */
  var nav = document.getElementById('nav');
  var lastY = window.scrollY;
  var ticking = false;
  function currentView() { return document.querySelector('[data-view]'); }
  function navSolidAlways() { var v = currentView(); return !!v && v.getAttribute('data-nav') === 'solid'; }
  function onScroll() {
    var y = window.scrollY;
    nav.classList.toggle('is-solid', navSolidAlways() || y > 2 || nav.classList.contains('search-open'));
    var locked = document.body.classList.contains('menu-open') || nav.classList.contains('search-open');
    if (!locked && Math.abs(y - lastY) > 4) {
      nav.classList.toggle('is-hidden', y > lastY && y > 160);
      lastY = y;
    }
    if (y <= 0) { nav.classList.remove('is-hidden'); lastY = 0; }
    ticking = false;
  }
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });

  var searchBtn = document.getElementById('search-toggle');
  var search = document.getElementById('search');
  function setSearch(open) {
    search.classList.toggle('is-open', open);
    nav.classList.toggle('search-open', open);
    searchBtn.setAttribute('aria-expanded', String(open));
    if (open) setTimeout(function () { document.getElementById('search-input').focus(); }, 50);
    onScroll();
  }
  searchBtn.addEventListener('click', function () { setSearch(!search.classList.contains('is-open')); });

  var menu = document.getElementById('menu');
  var menuOpenBtn = document.getElementById('menu-open');
  function setMenu(open, keepFocus) {
    menu.classList.toggle('is-open', open);
    menu.setAttribute('aria-hidden', String(!open));
    menuOpenBtn.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('menu-open', open);
    if (smoother) smoother.paused(open); else document.body.style.overflow = open ? 'hidden' : '';
    if (open) document.getElementById('menu-close').focus(); else if (!keepFocus) menuOpenBtn.focus();
  }
  menuOpenBtn.addEventListener('click', function () { setMenu(true); });
  document.getElementById('menu-close').addEventListener('click', function () { setMenu(false); });
  menu.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });

  /* ---------- currency (shared across views) ---------- */
  var currency = document.getElementById('currency');
  var rates = { KRW: [1, '₩'], USD: [1 / 1400, '$'], EUR: [1 / 1500, '€'] };
  function price(krw) {
    var c = currency.value, r = rates[c];
    if (c === 'KRW') return r[1] + krw.toLocaleString('en-US');
    return r[1] + (Math.round(krw * r[0] / 10) * 10).toLocaleString('en-US');
  }
  currency.addEventListener('change', function () {
    document.querySelectorAll('[data-krw]').forEach(function (el) { el.textContent = price(Number(el.getAttribute('data-krw'))); });
  });

  /* =====================================================================
   * ROUTER — fetch the next page, swap [data-view], keep the shell.
   * ===================================================================== */
  var cache = {};
  var busy = false;
  var announcer = document.getElementById('route-announcer');

  function pagePath(url) { return url.pathname.replace(/\/$/, '/index.html'); }
  function isSamePage(url) { return pagePath(url) === pagePath(location); }

  function load(href) {
    if (!cache[href]) {
      cache[href] = fetch(href, { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      });
      cache[href].catch(function () { delete cache[href]; });
    }
    return cache[href];
  }

  function syncHead(doc) {
    document.title = doc.title;
    ['meta[name="description"]', 'link[rel="canonical"]'].forEach(function (sel) {
      var next = doc.querySelector(sel), cur = document.querySelector(sel);
      if (next && cur) {
        if (cur.tagName === 'LINK') cur.href = next.href; else cur.content = next.content;
      }
    });
  }

  function navigate(href, push) {
    var url = new URL(href, location.href);
    if (busy) return;
    busy = true;
    setMenu(false, true);
    setSearch(false);
    var key = url.origin + pagePath(url);
    var animate = !reduce.matches;

    if (animate) veil.classList.add('is-on');                 // cover: 0.5s
    Promise.all([load(key), animate ? wait(500) : null]).then(function (res) {
      var doc = new DOMParser().parseFromString(res[0], 'text/html');
      var next = doc.querySelector('[data-view]');
      if (!next) throw new Error('No view in response');

      destroyPage();
      var old = currentView();
      var fresh = document.importNode(next, true);
      old.parentNode.replaceChild(fresh, old);
      syncHead(doc);
      if (push) history.pushState({ spa: true }, '', url.href);

      scrollToTop();
      nav.classList.remove('is-hidden');
      lastY = 0;
      initPage(fresh);
      onScroll();
      if (hasGsap) ScrollTrigger.refresh();

      if (url.hash) scrollToTarget(fresh.querySelector(url.hash), false);

      // Hand focus and an announcement to assistive tech, as a real page load would.
      var heading = fresh.querySelector('h1');
      if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
      announcer.textContent = document.title;

      requestAnimationFrame(function () { veil.classList.remove('is-on'); }); // reveal: 0.5s
      busy = false;
    }).catch(function () {
      location.href = url.href;   // fall back to a normal page load
    });
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank' || a.hasAttribute('download')) return;
    if (a.getAttribute('href') === '#') { e.preventDefault(); return; }
    var url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !/\.html$|\/$/.test(url.pathname)) return;

    e.preventDefault();
    if (isSamePage(url)) {                              // same page: glide to the anchor
      setMenu(false, true);
      if (url.hash) { scrollToTarget(document.querySelector(url.hash), true); history.replaceState(history.state, '', url.hash); }
      else if (smoother) smoother.scrollTo(0, true); else window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    navigate(url.href, true);
  });

  // Back / forward re-render the view for that URL.
  history.replaceState({ spa: true }, '', location.href);
  window.addEventListener('popstate', function () { navigate(location.href, false); });

  // Warm the cache when a link is about to be used.
  function prefetch(e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var url = new URL(a.href, location.href);
    if (url.origin === location.origin && /\.html$|\/$/.test(url.pathname) && !isSamePage(url)) load(url.origin + pagePath(url));
  }
  document.addEventListener('mouseover', prefetch, { passive: true });
  document.addEventListener('touchstart', prefetch, { passive: true });

  /* =====================================================================
   * VIEW — everything below is set up per page and torn down on swap.
   * ===================================================================== */
  var cleanups = [];
  var pageCtx = null;

  function destroyPage() {
    cleanups.splice(0).forEach(function (fn) { try { fn(); } catch (e) { /* keep going */ } });
    if (pageCtx) { pageCtx.revert(); pageCtx = null; }   // kills ScrollTriggers, pins, tweens
  }

  /* ---------- data ---------- */
  var P = {
    poolUmbrella: '1582719508461-905c673771fd', terraceDaybeds: '1445019980597-93fa8acb246c',
    sunsetTerrace: '1561501900-3701fa6a0864', poolDeck: '1584132967334-10e028bd69f7',
    woodDeck: '1566073771259-6a8506099945', resortEvening: '1571896349842-33c89424de2d',
    cliffPool: '1540541338287-41700207dee6', tropicalPool: '1520250497591-112f2f40a3f4',
    beachHut: '1499793983690-e29da59ef1c2', seaRoom: '1602002418082-a4443e081dd1',
    courtyard: '1572331165267-854da2b10ccc'
  };
  var FIN = { sand: '#D9CBB3', stone: '#B2AEA7', natural: '#C9B48F', charcoal: '#3D3B37', white: '#F4F1EA' };
  var categories = [
    { id: 'lounge', label: 'Lounge Chairs', items: [
      { name: 'Alba Lounge Chair', krw: 2450000, a: [P.poolUmbrella, '30% 70%'], b: [P.courtyard, '60% 70%'], fin: ['sand', 'charcoal', 'white'] },
      { name: 'Siesta Rope Chair', krw: 1890000, a: [P.courtyard, '75% 75%'], b: [P.poolDeck, '30% 70%'], fin: ['natural', 'stone'] },
      { name: 'Paros Low Chair', krw: 1650000, a: [P.poolDeck, '15% 75%'], b: [P.cliffPool, '40% 80%'], fin: ['sand', 'stone', 'charcoal'] },
      { name: 'Lido Sling Chair', krw: 1290000, a: [P.cliffPool, '20% 85%'], b: [P.poolUmbrella, '70% 75%'], fin: ['white', 'natural'] } ] },
    { id: 'beanbags', label: 'Bean Bags', items: [
      { name: 'Nido Bean Bag', krw: 690000, a: [P.woodDeck, '60% 85%'], b: [P.resortEvening, '30% 80%'], fin: ['sand', 'stone', 'charcoal'] },
      { name: 'Sola Pouf', krw: 420000, a: [P.resortEvening, '70% 85%'], b: [P.tropicalPool, '50% 85%'], fin: ['natural', 'white'] },
      { name: 'Calma Lounger Bag', krw: 890000, a: [P.tropicalPool, '20% 80%'], b: [P.woodDeck, '30% 80%'], fin: ['stone', 'charcoal'] },
      { name: 'Duna Floor Cushion', krw: 360000, a: [P.seaRoom, '50% 85%'], b: [P.beachHut, '60% 80%'], fin: ['sand', 'natural', 'white'] } ] },
    { id: 'hammocks', label: 'Hammocks', items: [
      { name: 'Brisa Hammock', krw: 980000, a: [P.beachHut, '45% 60%'], b: [P.tropicalPool, '70% 60%'], fin: ['natural', 'white'] },
      { name: 'Vela Hammock Chair', krw: 760000, a: [P.tropicalPool, '85% 55%'], b: [P.beachHut, '20% 65%'], fin: ['sand', 'stone'] },
      { name: 'Lento Hammock Stand', krw: 1420000, a: [P.woodDeck, '15% 55%'], b: [P.beachHut, '80% 60%'], fin: ['natural', 'charcoal'] },
      { name: 'Riva Swing Seat', krw: 1180000, a: [P.seaRoom, '30% 60%'], b: [P.woodDeck, '85% 60%'], fin: ['white', 'sand'] } ] },
    { id: 'daybeds', label: 'Daybeds', items: [
      { name: 'Terra Daybed', krw: 4890000, a: [P.terraceDaybeds, '35% 75%'], b: [P.sunsetTerrace, '60% 80%'], fin: ['sand', 'stone', 'white'] },
      { name: 'Ostra Canopy Daybed', krw: 6250000, a: [P.sunsetTerrace, '80% 80%'], b: [P.terraceDaybeds, '70% 75%'], fin: ['white', 'natural'] },
      { name: 'Sal Daybed', krw: 3980000, a: [P.woodDeck, '45% 80%'], b: [P.terraceDaybeds, '20% 80%'], fin: ['sand', 'charcoal'] },
      { name: 'Mare Double Lounger', krw: 3450000, a: [P.resortEvening, '50% 80%'], b: [P.sunsetTerrace, '40% 85%'], fin: ['stone', 'natural', 'white'] } ] }
  ];
  var benefits = [
    { t: 'All-weather weave', d: 'Solution-dyed fibres hold their colour through long, bright summers and dry within the hour after rain.', img: P.cliffPool, pos: '50% 60%' },
    { t: 'Hand-knotted rope', d: 'Each seat is knotted by hand over two days, tight enough to hold its shape for years of daily use.', img: P.poolDeck, pos: '30% 70%' },
    { t: 'Sustainably sourced teak', d: 'Certified plantation teak, left unsealed to silver slowly into a soft grey patina.', img: P.tropicalPool, pos: '60% 60%' },
    { t: 'Quick-dry cushions', d: 'Open-cell foam wrapped in a breathable linen-look cover that lets water drain straight through.', img: P.courtyard, pos: '50% 70%' },
    { t: 'Made to be repaired', d: 'Bolted, not glued. Every part can be replaced, so a piece can stay on the terrace for decades.', img: P.sunsetTerrace, pos: '60% 70%' }
  ];

  /* ---------- hero: 1s cross-fade, endless ---------- */
  function initHero(view) {
    var slides = view.querySelectorAll('.hero__slide');
    if (slides.length < 2) return;
    var cur = 0, timer = null;
    var pager = view.querySelector('#hero-pager'), idx = view.querySelector('#hero-index');
    function show(n) {
      slides[cur].classList.remove('is-active');
      cur = (n + slides.length) % slides.length;
      slides[cur].classList.add('is-active');
      idx.textContent = cur + 1;
      pager.setAttribute('aria-label', 'Next image, showing ' + (cur + 1) + ' of ' + slides.length);
    }
    function start() { if (!reduce.matches && !timer) timer = setInterval(function () { show(cur + 1); }, 6000); }
    function stop() { clearInterval(timer); timer = null; }
    function onVis() { document.hidden ? stop() : start(); }
    pager.addEventListener('click', function () { stop(); show(cur + 1); start(); });
    document.addEventListener('visibilitychange', onVis);
    start();
    cleanups.push(function () { stop(); document.removeEventListener('visibilitychange', onVis); });
  }

  /* ---------- categories + product cards ---------- */
  function initProducts(view) {
    var tabsEl = view.querySelector('#tabs'), productsEl = view.querySelector('#products');
    if (!tabsEl || !productsEl) return;
    var active = 'lounge', swapTimer = null;

    function renderTabs() {
      tabsEl.innerHTML = categories.map(function (c) {
        return '<button type="button" role="tab" class="tab" id="tab-' + c.id + '" data-cat="' + c.id + '" aria-selected="' + (c.id === active) + '" tabindex="' + (c.id === active ? 0 : -1) + '">' + esc(c.label) + '</button>';
      }).join('');
      productsEl.setAttribute('aria-labelledby', 'tab-' + active);
    }
    function renderProducts() {
      var cat = categories.filter(function (c) { return c.id === active; })[0];
      productsEl.innerHTML = cat.items.map(function (p) {
        return '<article class="card">' +
          '<a href="#range" class="card__media" aria-label="' + esc(p.name) + '">' +
            '<img src="' + u(p.a[0], 800) + '" alt="' + esc(p.name) + ' on a terrace" style="object-position:' + p.a[1] + '" loading="lazy">' +
            '<img class="card__alt" src="' + u(p.b[0], 800) + '" alt="" style="object-position:' + p.b[1] + '" loading="lazy">' +
          '</a>' +
          '<button type="button" class="card__heart" aria-pressed="false" aria-label="Save ' + esc(p.name) + ' to wishlist">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>' +
          '</button>' +
          '<h3 class="h4">' + esc(p.name) + '</h3>' +
          '<div class="card__meta">' +
            '<p class="small" data-krw="' + p.krw + '">' + price(p.krw) + '</p>' +
            '<ul class="chips" aria-label="Finishes: ' + p.fin.join(', ') + '">' + p.fin.map(function (f) { return '<li class="chip" style="background:' + FIN[f] + '"></li>'; }).join('') + '</ul>' +
          '</div>' +
        '</article>';
      }).join('');
    }
    function pick(id) {
      if (id === active) return;
      active = id;
      renderTabs();
      view.querySelector('#tab-' + id).focus();
      if (reduce.matches) { renderProducts(); return; }
      productsEl.classList.add('is-leaving');
      clearTimeout(swapTimer);
      swapTimer = setTimeout(function () {
        renderProducts();
        productsEl.scrollLeft = 0;
        requestAnimationFrame(function () { productsEl.classList.remove('is-leaving'); });
      }, 250);
    }

    renderTabs();
    renderProducts();
    tabsEl.addEventListener('click', function (e) { var b = e.target.closest('[data-cat]'); if (b) pick(b.getAttribute('data-cat')); });
    tabsEl.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var i = categories.findIndex(function (c) { return c.id === active; });
      i = (i + (e.key === 'ArrowRight' ? 1 : -1) + categories.length) % categories.length;
      pick(categories[i].id);
    });
    productsEl.addEventListener('click', function (e) {
      var h = e.target.closest('.card__heart');
      if (h) h.setAttribute('aria-pressed', String(h.getAttribute('aria-pressed') !== 'true'));
    });
    cleanups.push(function () { clearTimeout(swapTimer); });
  }

  /* ---------- benefits slides ---------- */
  function renderBenefits(view) {
    var track = view.querySelector('#benefits-track');
    if (!track) return;
    track.innerHTML = benefits.map(function (b, i) {
      var n = '0' + (i + 1);
      return '<article class="slide">' +
        '<div class="slide__media">' +
          '<img src="' + u(b.img, 1100) + '" alt="" style="object-position:' + b.pos + '" loading="lazy">' +
          '<div class="slide__overlay" aria-hidden="true"><p class="label">' + n + '</p><p class="h4">' + esc(b.t) + '</p><p class="small">' + esc(b.d) + '</p></div>' +
        '</div>' +
        '<div class="slide__caption"><span class="label">' + n + '</span><h3 class="h4">' + esc(b.t) + '</h3></div>' +
        '<p class="small muted slide__desc">' + esc(b.d) + '</p>' +
      '</article>';
    }).join('');
  }

  /* ---------- newsletter ---------- */
  function initNewsletter(view) {
    var form = view.querySelector('#newsletter');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = form.querySelector('#nl-email'), note = form.querySelector('#nl-note');
      note.textContent = input.checkValidity() ? 'Thank you. The first letter arrives with the next full moon.' : 'Please enter a valid email address.';
    });
  }

  /* ---------- scroll motion (GSAP) ---------- */
  function initMotion(view) {
    if (!hasGsap) return;
    var hint = view.querySelector('#benefits-hint');
    var desktop = window.matchMedia('(min-width: 900px)');

    pageCtx = gsap.context(function () {
      var mm = gsap.matchMedia();

      mm.add('(min-width: 900px) and (prefers-reduced-motion: no-preference)', function () {
        var section = view.querySelector('#benefits');
        var track = view.querySelector('#benefits-track');
        if (section && track) {
          section.classList.add('is-pinned');
          if (hint) hint.textContent = 'Scroll to move through';
          var distance = function () {
            var last = track.lastElementChild;
            var gutter = parseFloat(getComputedStyle(track).paddingLeft) || 0;
            return Math.max(0, last.offsetLeft + last.offsetWidth + gutter - window.innerWidth);
          };
          gsap.to(track, {
            x: function () { return -distance(); },
            ease: 'none',
            scrollTrigger: {
              trigger: section, start: 'top top',
              end: function () { return '+=' + distance(); },
              pin: true,
              scrub: 1.2,              // trails the scroll slightly: the "inertia"
              invalidateOnRefresh: true
            }
          });
        }

        // Reveals: quiet fade with a short rise, 0.5s ease.
        gsap.utils.toArray(view.querySelectorAll('[data-reveal]')).forEach(function (el) {
          gsap.fromTo(el, { opacity: 0, y: 16 }, {
            opacity: 1, y: 0, duration: 0.5, ease: 'power1.out',
            scrollTrigger: { trigger: el, start: 'top 88%', toggleActions: 'play none none none' }
          });
        });

        return function () {
          if (section) section.classList.remove('is-pinned');
          if (track) gsap.set(track, { clearProps: 'transform' });
        };
      });

      mm.add('(max-width: 899px), (prefers-reduced-motion: reduce)', function () {
        if (hint) hint.textContent = desktop.matches ? 'Scroll sideways to move through' : 'Swipe to move through';
      });
    }, view);

    // Lazy images change heights; keep pin distances and smoother bounds honest.
    var t = null;
    function onImg() { clearTimeout(t); t = setTimeout(function () { ScrollTrigger.refresh(); }, 120); }
    view.addEventListener('load', onImg, true);
    cleanups.push(function () { clearTimeout(t); view.removeEventListener('load', onImg, true); });
  }

  function initPage(view) {
    initHero(view);
    initProducts(view);
    renderBenefits(view);
    initNewsletter(view);
    initMotion(view);
  }

  initPage(currentView());
  onScroll();
  window.addEventListener('load', function () { if (hasGsap) ScrollTrigger.refresh(); });

  // Arriving on a deep link with a hash (e.g. index.html#journal from another tab).
  if (location.hash) window.addEventListener('load', function () { setTimeout(function () { scrollToTarget(document.querySelector(location.hash), false); }, 80); });
})();
