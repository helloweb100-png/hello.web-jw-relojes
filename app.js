/* ==========================================================================
   DW WACH | app.js
   Capas: GSAP + ScrollTrigger (scroll), Lenis (inercia), Three.js r128 (reloj 3D).
   Todo degrada con gracia: sin WebGL se muestra una imagen, sin librerías el
   contenido queda visible, con "reducir movimiento" no hay pines ni inercia.

   ► CONFIGURACIÓN: cambia SOLO el bloque CONFIG de abajo.
   ========================================================================== */
(() => {
  'use strict';

  const CONFIG = {
    // Número de WhatsApp del negocio con lada de país, solo dígitos. Ej: México 55 1234 5678 -> '5215512345678'
    whatsapp: '52XXXXXXXXXX',
    defaultMessage: 'Hola DW Wach, quiero información sobre sus relojes.',
    // Redes sociales: déjalas vacías para ocultarlas
    social: { instagram: '', facebook: '', tiktok: '' },
  };

  /* ───────────── Utilidades ───────────── */
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const sub = (v, a, b) => clamp((v - a) / (b - a), 0, 1);
  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const hasGSAP = !!(window.gsap && window.ScrollTrigger);
  const hasThree = !!window.THREE;
  const isMobile = () => window.innerWidth < 768;
  const fmtMXN = (n) => '$' + Math.round(n).toLocaleString('es-MX');
  const safe = (name, fn) => { try { return fn(); } catch (err) { console.error('[DW Wach] ' + name, err); } };

  let lenis = null;
  let menuOpen = false;
  let resolveHero;
  const heroReady = new Promise((r) => { resolveHero = r; });
  // Cede el hilo principal para que el navegador pinte y responda entre tareas pesadas (no se congela nada)
  const yieldFrame = () => new Promise((resolve) => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(() => setTimeout(go, 0));
    setTimeout(go, 80); // si la pestaña está en segundo plano rAF no corre
  });

  /* ───────────── WhatsApp ───────────── */
  const waReady = () => /^\d{10,15}$/.test(CONFIG.whatsapp);
  const waUrl = (msg) => 'https://wa.me/' + CONFIG.whatsapp + '?text=' + encodeURIComponent(msg || CONFIG.defaultMessage);

  function initWhatsApp() {
    if (!waReady()) {
      console.warn('[DW Wach] Falta el número de WhatsApp. Edita CONFIG.whatsapp en app.js (ej. 5215512345678). Mientras tanto los botones llevan al formulario.');
    }
    $$('[data-wa]').forEach((a) => {
      if (waReady()) {
        a.href = waUrl(a.dataset.waMsg);
        a.target = '_blank';
        a.rel = 'noopener';
      }
    });
    $$('[data-social]').forEach((a) => {
      const url = CONFIG.social[a.dataset.social];
      if (url) { a.href = url; a.hidden = false; }
    });
  }

  /* ───────────── División de texto en palabras ───────────── */
  function splitWords(el) {
    if (el.dataset.splitDone) return $$('.wi', el);
    const original = el.textContent.replace(/\s+/g, ' ').trim();
    const walk = (node) => {
      Array.from(node.childNodes).forEach((ch) => {
        if (ch.nodeType === 3) {
          const frag = document.createDocumentFragment();
          ch.textContent.split(/(\s+)/).forEach((p) => {
            if (!p) return;
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(' ')); return; }
            const w = document.createElement('span');
            const i = document.createElement('span');
            w.className = 'w'; i.className = 'wi'; i.textContent = p;
            w.setAttribute('aria-hidden', 'true');
            w.appendChild(i); frag.appendChild(w);
          });
          node.replaceChild(frag, ch);
        } else if (ch.nodeType === 1 && ch.tagName !== 'BR') {
          walk(ch);
        }
      });
    };
    walk(el);
    el.setAttribute('aria-label', original);
    el.dataset.splitDone = '1';
    return $$('.wi', el);
  }

  /* ───────────── Preloader ─────────────
     La animación es CSS puro (ver styles.css): arranca en el primer cuadro y no se detiene aunque el hilo
     principal esté ocupado. Aquí solo se decide CUÁNDO termina: espera tipografías, recursos y el armado del
     reloj 3D (que se hace en pasos pequeños) y respeta un mínimo de 2.3 s desde que se abrió la página. */
  function initLoader(waitFor) {
    const loader = $('#loader');
    if (!loader) { finishLoad(); return; }
    const MIN = reduceMotion ? 500 : 2300;
    const giveUp = new Promise((r) => setTimeout(r, 12000)); // seguro anti-bloqueo
    Promise.race([Promise.all(waitFor).catch(() => {}), giveUp]).then(() => {
      setTimeout(() => {
        loader.classList.add('is-ready');
        setTimeout(finishLoad, reduceMotion ? 40 : 520);
      }, Math.max(0, MIN - performance.now()));
    });
  }

  function finishLoad() {
    const loader = $('#loader');
    if (loader) {
      loader.classList.add('is-done');
      setTimeout(() => { loader.classList.add('is-gone'); loader.setAttribute('aria-hidden', 'true'); }, 1700);
    }
    document.body.classList.remove('is-loading');
    if (lenis) lenis.start();
    setTimeout(() => {
      document.dispatchEvent(new CustomEvent('loader:done'));
      if (hasGSAP) ScrollTrigger.refresh();
    }, 420);
  }

  /* ───────────── Scroll suave + anclas ───────────── */
  function initScroll() {
    if (hasGSAP) {
      gsap.registerPlugin(ScrollTrigger);
      // La barra de direcciones del móvil cambia la altura de la ventana al hacer scroll: no recalcular los pines por eso
      ScrollTrigger.config({ ignoreMobileResize: true });
      if (window.Lenis && !reduceMotion) {
        lenis = new Lenis({
          duration: 1.25,
          easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
          smoothWheel: true,
          wheelMultiplier: 0.95,
          touchMultiplier: 1.2,
        });
        lenis.on('scroll', ScrollTrigger.update);
        gsap.ticker.add((time) => lenis.raf(time * 1000));
        gsap.ticker.lagSmoothing(0);
        lenis.stop(); // se libera al terminar el preloader
      }
    }
    $$('a[href^="#"]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const id = a.getAttribute('href');
        if (!id || id.length < 2) return;
        const target = $(id);
        if (!target) return;
        e.preventDefault();
        if (menuOpen) setMenu(false);
        scrollToEl(target);
      });
    });
  }

  function scrollToEl(el) {
    const y = el.id === 'inicio' ? 0 : el.getBoundingClientRect().top + window.scrollY - 70;
    if (lenis) lenis.scrollTo(y, { duration: 1.8, easing: (t) => 1 - Math.pow(1 - t, 4) });
    else window.scrollTo({ top: y, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  /* ───────────── Navegación ───────────── */
  let setMenu = () => {};
  function initNav() {
    const nav = $('#nav'), burger = $('#burger'), menu = $('#menu'), ring = $('#navRing'), closeBtn = $('#menuClose');
    if (!nav) return;
    menu.inert = true;
    setMenu = (open) => {
      menuOpen = open;
      menu.classList.toggle('is-open', open);
      menu.setAttribute('aria-hidden', String(!open));
      menu.inert = !open;
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
      if (open) nav.classList.remove('is-hidden');
      if (lenis) (open ? lenis.stop() : lenis.start());
      else document.body.style.overflow = open ? 'hidden' : '';
      if (open) setTimeout(() => (closeBtn || $('.menu-link', menu))?.focus(), 380);
    };
    burger.addEventListener('click', () => setMenu(!menuOpen));
    if (closeBtn) closeBtn.addEventListener('click', () => { setMenu(false); burger.focus({ preventScroll: true }); });
    document.addEventListener('keydown', (e) => {
      if (!menuOpen) return;
      if (e.key === 'Escape') { setMenu(false); burger.focus({ preventScroll: true }); return; }
      if (e.key !== 'Tab') return; // el foco se queda dentro del menú mientras está abierto
      const f = $$('a[href], button', menu).filter((el) => el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    window.matchMedia('(min-width: 1024px)').addEventListener('change', (m) => { if (m.matches && menuOpen) setMenu(false); });

    if (hasGSAP) {
      ScrollTrigger.create({
        start: 0, end: 'max',
        onUpdate: (self) => {
          const y = self.scroll();
          if (ring) ring.style.strokeDashoffset = (138.23 * (1 - self.progress)).toFixed(1);
          nav.classList.toggle('is-solid', y > 40);
          if (menuOpen) return;
          nav.classList.toggle('is-hidden', y > 260 && self.direction === 1);
        },
      });
    } else {
      const s = document.createElement('div');
      s.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:40px;pointer-events:none';
      document.body.prepend(s);
      new IntersectionObserver(([e]) => nav.classList.toggle('is-solid', !e.isIntersecting)).observe(s);
    }
  }

  /* ───────────── Reveals genéricos ───────────── */
  function initReveals() {
    $$('[data-split]').forEach((el) => splitWords(el));
    $$('[data-scrub-words]').forEach((el) => { el.classList.add('no-mask'); splitWords(el); });
    if (!hasGSAP || reduceMotion) return;

    $$('[data-split]').forEach((el) => {
      if (el.dataset.split === 'hero') return; // lo anima la intro del hero
      const words = $$('.wi', el);
      gsap.set(words, { yPercent: 118 });
      ScrollTrigger.create({
        trigger: el, start: 'top 88%', once: true,
        onEnter: () => gsap.to(words, { yPercent: 0, duration: 1.15, ease: 'expo.out', stagger: 0.045 }),
      });
    });

    const items = $$('[data-reveal], .cat-card');
    gsap.set(items, { autoAlpha: 0, y: 38 });
    ScrollTrigger.batch(items, {
      start: 'top 92%', once: true,
      onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 1.05, ease: 'power3.out', stagger: 0.09, overwrite: true }),
    });
  }

  /* ───────────── Contadores ───────────── */
  function initCounters() {
    $$('[data-count]').forEach((el) => {
      const end = Number(el.dataset.count);
      const pre = el.dataset.prefix || '', suf = el.dataset.suffix || '';
      const fmt = (n) => pre + Math.round(n).toLocaleString('es-MX') + suf;
      el.textContent = fmt(end);
      if (!hasGSAP || reduceMotion) return;
      const o = { v: 0 };
      el.textContent = fmt(0);
      ScrollTrigger.create({
        trigger: el, start: 'top 92%', once: true,
        onEnter: () => gsap.to(o, { v: end, duration: 2.2, ease: 'power3.out', onUpdate: () => { el.textContent = fmt(o.v); } }),
      });
    });
  }

  /* ───────────── Hero: intro de texto ───────────── */
  function initHeroIntro() {
    const title = $('.hero-title');
    if (!title) return;
    const words = $$('.wi', title);
    const els = $$('[data-hero-in]');
    if (!hasGSAP || reduceMotion) return;
    gsap.set(words, { yPercent: 125 });
    gsap.set(els, { autoAlpha: 0, y: 28 });
    document.addEventListener('loader:done', () => {
      gsap.timeline({ defaults: { ease: 'expo.out' } })
        .to(words, { yPercent: 0, duration: 1.4, stagger: 0.08 }, 0.1)
        .to(els, { autoAlpha: 1, y: 0, duration: 1.15, stagger: 0.12 }, 0.3);
    }, { once: true });
  }

  /* ───────────── Ticker: cambia de sentido con el scroll ───────────── */
  function initTicker() {
    const track = $('#tickerTrack');
    if (!track || !hasGSAP || reduceMotion || !track.getAnimations) return;
    const anim = track.getAnimations()[0];
    if (!anim) return;
    let rate = 1, goal = 1, dir = 1;
    ScrollTrigger.create({
      start: 0, end: 'max',
      onUpdate: (self) => {
        dir = self.direction || dir;
        goal = dir * (1 + Math.min(Math.abs(self.getVelocity()) / 450, 5));
      },
    });
    gsap.ticker.add(() => {
      goal += (dir - goal) * 0.03;
      rate += (goal - rate) * 0.07;
      anim.playbackRate = rate;
    });
  }

  /* ───────────── Manifiesto: las palabras se encienden con el scroll ───────────── */
  function initManifest() {
    const el = $('.manifest-text');
    if (!el || !hasGSAP || reduceMotion) return;
    const words = $$('.wi', el);
    gsap.set(words, { opacity: 0.14 });
    gsap.to(words, {
      opacity: 1, ease: 'none', stagger: 0.1, duration: 0.3,
      scrollTrigger: { trigger: el, start: 'top 80%', end: 'bottom 48%', scrub: 0.6 },
    });
  }

  /* ───────────── Portal: la imagen se abre en grande ───────────── */
  function initPortal() {
    const sec = $('#portal');
    if (!sec || !hasGSAP || reduceMotion) return;
    const media = $('.portal-media', sec), img = $('.portal-media img', sec);
    const words = $$('.pw', sec), copy = $$('.portal-copy > *', sec);
    const mm = gsap.matchMedia();
    mm.add({ desk: '(min-width: 900px), (min-width: 640px) and (max-height: 560px)', mob: '(max-width: 899px) and (min-height: 561px), (max-width: 639px)' }, (ctx) => {
      // Empieza como el arco del logotipo (semicírculo perfecto arriba) y se abre hasta pantalla completa
      const desk = ctx.conditions.desk, W = window.innerWidth;
      const box = desk ? { top: '15%', bottom: '15%', left: '33%', right: '33%' } : { top: '20%', bottom: '26%', left: '12%', right: '12%' };
      const arc = (desk ? W * 0.34 : W * 0.76) / 2;
      gsap.set(media, Object.assign({ borderTopLeftRadius: arc, borderTopRightRadius: arc, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, borderWidth: 1, outlineWidth: 1, outlineOffset: 12 }, box));
      gsap.set(img, { scale: 1.4 });
      gsap.set(copy, { autoAlpha: 0, y: 40 });
      gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: sec, start: 'top top', end: '+=180%', scrub: 0.7, pin: true, anticipatePin: 1 },
      })
        .to(media, { top: 0, bottom: 0, left: 0, right: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderWidth: 0, outlineOffset: 0, outlineWidth: 0, ease: 'power2.inOut', duration: 1.15 }, 0)
        .to(img, { scale: desk ? 1 : 1.12, xPercent: desk ? 21 : 0, yPercent: desk ? 0 : -9, ease: 'power2.out', duration: 1.15 }, 0)
        .to(words[0], { xPercent: -135, autoAlpha: 0, duration: 0.75 }, 0.05)
        .to(words[1], { xPercent: 135, autoAlpha: 0, duration: 0.75 }, 0.05)
        .to(words[2], { xPercent: -135, autoAlpha: 0, duration: 0.75 }, 0.05)
        .to(copy, { autoAlpha: 1, y: 0, stagger: 0.08, duration: 0.35, ease: 'power2.out' }, 0.9)
        .to({}, { duration: 0.3 });
    });
  }

  /* ───────────── Momentos: arcos con parallax ───────────── */
  function initMoments() {
    const sec = $('#momentos');
    if (!sec || !hasGSAP || reduceMotion) return;
    $$('.moment-arch img', sec).forEach((img) => {
      gsap.fromTo(img, { yPercent: -7 }, { yPercent: 7, ease: 'none', scrollTrigger: { trigger: img.closest('.moment'), start: 'top bottom', end: 'bottom top', scrub: true } });
    });
    gsap.matchMedia().add('(min-width: 900px)', () => {
      const mid = $('.moment:nth-child(2)', sec);
      if (mid) gsap.fromTo(mid, { y: 60 }, { y: -40, ease: 'none', scrollTrigger: { trigger: sec, start: 'top bottom', end: 'bottom top', scrub: 0.8 } });
    });
  }

  /* ───────────── Colecciones: scroll horizontal anclado ───────────── */
  function initCollections() {
    const sec = $('#colecciones');
    if (!sec) return;
    const track = $('#colsTrack', sec), bar = $('.cols-progress span', sec);
    // Carrusel táctil (sin anclaje): la barra sigue el desplazamiento del propio carril
    const syncBar = () => {
      const max = track.scrollWidth - track.clientWidth;
      if (max > 2 && !sec.classList.contains('is-pinned')) {
        bar.style.transform = 'scaleX(' + clamp(track.scrollLeft / max, 0, 1).toFixed(4) + ')';
      }
    };
    track.addEventListener('scroll', syncBar, { passive: true });
    syncBar();
    if (!hasGSAP || reduceMotion) return;
    const pin = $('.cols-pin', sec), rail = $('.cols-rail', sec);
    const mm = gsap.matchMedia();
    mm.add('(min-width: 1024px)', () => {
      sec.classList.add('is-pinned');
      const dist = () => Math.max(0, rail.scrollWidth - window.innerWidth);
      gsap.to(rail, {
        x: () => -dist(), ease: 'none',
        scrollTrigger: {
          trigger: pin, start: 'top top', end: () => '+=' + dist(), scrub: 1, pin: true,
          anticipatePin: 1, invalidateOnRefresh: true,
          onUpdate: (s) => { bar.style.transform = 'scaleX(' + s.progress.toFixed(4) + ')'; },
        },
      });
      return () => { sec.classList.remove('is-pinned'); bar.style.transform = ''; };
    });
  }

  /* ───────────── Menú: resalta la sección visible ───────────── */
  function initSpy() {
    if (!hasGSAP) return;
    $$('.nav-links a').forEach((a) => {
      const sec = $(a.getAttribute('href'));
      if (!sec) return;
      ScrollTrigger.create({
        trigger: sec, start: 'top 55%', end: 'bottom 55%',
        onToggle: (self) => a.classList.toggle('is-active', self.isActive),
      });
    });
  }

  /* ───────────── Simulador de plan ───────────── */
  function initPlan() {
    const range = $('#planRange');
    if (!range) return;
    const PLANS = [
      { total: 3200, initial: 1200, n: 4, abono: 500, img: 'img/relojes/speedway.webp', name: 'Invicta Speedway' },
      { total: 3400, initial: 1400, n: 4, abono: 500, img: 'img/relojes/aviator.webp', name: 'Invicta Aviator' },
      { total: 3500, initial: 1500, n: 4, abono: 500, img: 'img/relojes/prodiver.webp', name: 'Invicta Pro Diver' },
      { total: 3600, initial: 1600, n: 4, abono: 500, img: 'img/relojes/racing.webp', name: 'Invicta Racing' },
      { total: 4500, initial: 1500, n: 6, abono: 500, img: 'img/relojes/prodiver-negro.webp', name: 'Invicta Pro Diver' },
      { total: 5500, initial: 1500, n: 8, abono: 500, img: 'img/relojes/bolt-oro.webp', name: 'Invicta Bolt' },
      { total: 6000, initial: 2000, n: 4, abono: 1000, img: 'img/relojes/bolt-azul.webp', name: 'Invicta Bolt' },
    ];
    const els = {
      price: $('#planPrice'), initial: $('#planInitial'), count: $('#planCount'), abono: $('#planAbono'),
      total: $('#planTotal'), months: $('#planMonths'), timeline: $('#planTimeline'), img: $('#planImg'),
      cta: $('#planCta'), ringInit: $('#planRingInitial'), ringAb: $('#planRingAbonos'), ticks: $('#planTicks'),
    };
    const C = 2 * Math.PI * 96;
    PLANS.forEach((p) => {
      const li = document.createElement('li');
      li.textContent = '$' + (p.total / 1000).toFixed(1).replace('.0', '') + 'k';
      els.ticks.appendChild(li);
    });
    const nums = { price: { v: 0 }, initial: { v: 0 } }; // un objeto por contador: overwrite no debe cancelar al otro
    let swapTimer, lineTimers = [], current = -1;

    const countTo = (key, el, to, first) => {
      const o = nums[key];
      if (!hasGSAP || reduceMotion || first) { o.v = to; el.textContent = fmtMXN(to); return; }
      gsap.to(o, { v: to, duration: 0.8, ease: 'power3.out', overwrite: true, onUpdate: () => { el.textContent = fmtMXN(o.v); } });
    };

    const render = (i) => {
      const first = current === -1;
      if (i === current) return;
      current = i;
      const p = PLANS[i];
      countTo('price', els.price, p.total, first);
      countTo('initial', els.initial, p.initial, first);
      els.count.textContent = p.n + ' abonos quincenales de';
      els.abono.textContent = fmtMXN(p.abono);
      els.total.textContent = fmtMXN(p.total);
      const months = (p.n * 15) / 30;
      els.months.textContent = months + (months === 1 ? ' mes' : ' meses');
      els.ringInit.style.strokeDasharray = ((p.initial / p.total) * C).toFixed(1) + ' ' + C.toFixed(1);
      els.ringAb.style.strokeDasharray = C.toFixed(1) + ' ' + C.toFixed(1);
      range.style.setProperty('--fill', ((i / (PLANS.length - 1)) * 100).toFixed(1) + '%');
      range.setAttribute('aria-valuetext', fmtMXN(p.total) + ', pago inicial de ' + fmtMXN(p.initial) + ' y ' + p.n + ' abonos de ' + fmtMXN(p.abono));
      $$('li', els.ticks).forEach((li, k) => li.classList.toggle('is-on', k === i));

      // Línea de tiempo: hoy + un marcador por abono
      lineTimers.forEach(clearTimeout); lineTimers = [];
      els.timeline.innerHTML = '';
      for (let k = 0; k <= p.n; k++) {
        const li = document.createElement('li');
        li.innerHTML = '<i></i><span>' + (k === 0 ? 'Hoy' : '+' + k * 15 + 'd') + '</span>';
        if (k === 0) li.classList.add('is-today');
        els.timeline.appendChild(li);
        lineTimers.push(setTimeout(() => li.classList.add('is-on'), first ? 0 : 140 + k * 90));
      }

      // Imagen del reloj con fundido
      if (first) { els.img.src = p.img; els.img.alt = 'Reloj ' + p.name; }
      else {
        clearTimeout(swapTimer);
        els.img.style.opacity = '0';
        els.img.style.transform = 'translateY(10px) scale(.96)';
        swapTimer = setTimeout(() => {
          els.img.onload = () => { els.img.style.opacity = '1'; els.img.style.transform = ''; };
          els.img.src = p.img; els.img.alt = 'Reloj ' + p.name;
          if (els.img.complete) els.img.onload();
        }, 260);
      }

      const msg = 'Hola DW Wach, quiero el plan de ' + fmtMXN(p.total) + ' (' + p.name + '): pago inicial de ' +
        fmtMXN(p.initial) + ' y ' + p.n + ' abonos quincenales de ' + fmtMXN(p.abono) + '. ¿Qué modelos tienen disponibles?';
      els.cta.dataset.waMsg = msg;
      if (waReady()) els.cta.href = waUrl(msg);
    };

    range.addEventListener('input', () => render(Number(range.value)));
    render(Number(range.value));
  }

  /* ───────────── Resplandor de tarjetas + botones magnéticos ───────────── */
  function initPointerFx() {
    if (!finePointer) return;
    $$('[data-spot]').forEach((el) => {
      const tilt = el.classList.contains('col-card');
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--my', (e.clientY - r.top) + 'px');
        if (tilt && !reduceMotion) {
          el.style.setProperty('--tx', (((e.clientX - r.left) / r.width - 0.5) * 2).toFixed(3));
          el.style.setProperty('--ty', (((e.clientY - r.top) / r.height - 0.5) * 2).toFixed(3));
        }
      }, { passive: true });
      if (tilt) el.addEventListener('pointerleave', () => { el.style.setProperty('--tx', 0); el.style.setProperty('--ty', 0); });
    });
    if (!hasGSAP || reduceMotion) return;
    $$('[data-magnetic]').forEach((el) => {
      const xTo = gsap.quickTo(el, 'x', { duration: 0.55, ease: 'power3' });
      const yTo = gsap.quickTo(el, 'y', { duration: 0.55, ease: 'power3' });
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        xTo((e.clientX - (r.left + r.width / 2)) * 0.22);
        yTo((e.clientY - (r.top + r.height / 2)) * 0.3);
      });
      el.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
    });
  }

  /* ───────────── Proceso: reloj que marca cada paso ───────────── */
  function initFlow() {
    const list = $('#flowSteps');
    if (!list) return;
    const steps = $$('li', list);
    const hand = $('#clockHand'), g = $('#clockTicks');
    const NS = 'http://www.w3.org/2000/svg';
    for (let i = 0; i < 60; i++) {
      const a = (i * 6 * Math.PI) / 180, hr = i % 5 === 0;
      const r1 = hr ? 118 : 123, r2 = 134;
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', (150 + Math.sin(a) * r1).toFixed(2));
      l.setAttribute('y1', (150 - Math.cos(a) * r1).toFixed(2));
      l.setAttribute('x2', (150 + Math.sin(a) * r2).toFixed(2));
      l.setAttribute('y2', (150 - Math.cos(a) * r2).toFixed(2));
      if (hr) l.setAttribute('class', 'hr');
      g.appendChild(l);
    }
    if (!hasGSAP || reduceMotion) { steps.forEach((li) => li.classList.add('is-active')); return; }
    gsap.set(hand, { rotation: 0, svgOrigin: '150 150' });
    let cur = -1;
    const setStep = (i) => {
      if (i === cur) return;
      cur = i;
      steps.forEach((li, k) => li.classList.toggle('is-active', k === i));
      gsap.to(hand, { rotation: Number(steps[i].dataset.angle), svgOrigin: '150 150', duration: 1.1, ease: 'back.out(2.6)' });
    };
    steps.forEach((li, i) => {
      ScrollTrigger.create({ trigger: li, start: 'top 62%', end: 'bottom 62%', onEnter: () => setStep(i), onEnterBack: () => setStep(i) });
    });
    ScrollTrigger.create({
      trigger: list, start: 'top 65%', end: 'bottom 60%', scrub: true,
      onUpdate: (s) => list.style.setProperty('--p', s.progress.toFixed(3)),
    });
  }

  /* ───────────── Catálogo: filtros ───────────── */
  function initCatalog() {
    const tabs = $$('.tab'), cards = $$('.cat-card'), grid = $('#catGrid');
    if (!tabs.length) return;
    const select = (tab, focus) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
      });
      const f = tab.dataset.filter;
      const shown = [];
      cards.forEach((c) => { const show = f === 'all' || c.dataset.cat === f; c.hidden = !show; if (show) shown.push(c); });
      grid.setAttribute('aria-labelledby', tab.id);
      if (focus) tab.focus();
      if (hasGSAP && !reduceMotion) {
        gsap.fromTo(shown, { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.8, stagger: 0.06, ease: 'power3.out', overwrite: true });
        ScrollTrigger.refresh();
      }
    };
    tabs.forEach((t, i) => {
      t.tabIndex = t.classList.contains('is-active') ? 0 : -1;
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        select(tabs[n], true);
      });
    });
  }

  /* ───────────── Acordeones (valores y FAQ) ───────────── */
  function initAccordions() {
    let refreshTimer;
    const refresh = () => { clearTimeout(refreshTimer); if (hasGSAP) refreshTimer = setTimeout(() => ScrollTrigger.refresh(), 700); };

    $$('#values .value').forEach((item, _, all) => {
      const btn = $('.value-btn', item);
      btn.addEventListener('click', () => {
        const open = !item.classList.contains('is-open');
        all.forEach((o) => { o.classList.remove('is-open'); $('.value-btn', o).setAttribute('aria-expanded', 'false'); });
        if (open) { item.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true'); }
        refresh();
      });
    });

    const faq = $$('#faqList .faq-item');
    faq.forEach((item) => {
      const q = $('.faq-q', item);
      q.addEventListener('click', () => {
        const open = q.getAttribute('aria-expanded') !== 'true';
        faq.forEach((o) => { o.classList.remove('is-open'); $('.faq-q', o).setAttribute('aria-expanded', 'false'); });
        q.setAttribute('aria-expanded', String(open));
        item.classList.toggle('is-open', open);
        refresh();
      });
    });
  }

  /* ───────────── Formulario -> WhatsApp ───────────── */
  function initForm() {
    const form = $('#waForm');
    if (!form) return;
    const f = { name: $('#fName'), phone: $('#fPhone'), interest: $('#fInterest'), pay: $('#fPay'), msg: $('#fMsg') };
    const btn = $('#formBtn'), note = $('#formNote');
    const setErr = (input, text) => {
      const err = $('#' + input.getAttribute('aria-describedby'));
      input.closest('.field').classList.toggle('has-error', !!text);
      input.setAttribute('aria-invalid', text ? 'true' : 'false');
      if (err) err.textContent = text;
      return !!text;
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      note.textContent = ''; note.classList.remove('is-error');
      const name = f.name.value.trim(), phone = f.phone.value.trim();
      const bad = [
        setErr(f.name, name.length < 2 ? 'Escribe tu nombre para poder atenderte.' : ''),
        setErr(f.phone, phone && !/^[\d\s+()\-]{8,18}$/.test(phone) ? 'Revisa tu teléfono, parece incompleto.' : ''),
        setErr(f.interest, !f.interest.value ? 'Elige qué te interesa.' : ''),
      ];
      if (bad.some(Boolean)) { [f.name, f.phone, f.interest][bad.indexOf(true)].focus(); return; }
      if (!waReady()) {
        note.textContent = 'Falta configurar el número de WhatsApp en app.js (CONFIG.whatsapp).';
        note.classList.add('is-error');
        return;
      }
      const text = [
        'Hola DW Wach, soy *' + name + '*.',
        'Me interesa: *' + f.interest.value + '*',
        'Forma de pago: ' + f.pay.value,
        phone ? 'Mi teléfono: ' + phone : '',
        f.msg.value.trim() ? '\n' + f.msg.value.trim() : '',
        '\n¿Me ayudan con opciones disponibles y el plan que mejor me convenga?',
      ].filter(Boolean).join('\n');
      const label = $('span', btn);
      const prev = label.textContent;
      label.textContent = 'Abriendo WhatsApp…';
      btn.disabled = true;
      note.textContent = 'Te llevamos a WhatsApp con tu mensaje listo.';
      window.open(waUrl(text), '_blank', 'noopener');
      setTimeout(() => { label.textContent = prev; btn.disabled = false; form.reset(); note.textContent = ''; }, 2200);
    });
    [f.name, f.phone, f.interest].forEach((i) => i.addEventListener('input', () => setErr(i, '')));
  }

  /* ───────────── Footer, flotante y detalles ───────────── */
  function initChrome() {
    const year = $('#year');
    if (year) year.textContent = String(new Date().getFullYear());

    const wa = $('#waFloat');
    document.addEventListener('loader:done', () => {
      setTimeout(() => {
        wa.classList.add('is-visible');
        if (finePointer) {
          const tip = $('.wa-tip', wa);
          setTimeout(() => { tip.classList.add('is-shown'); setTimeout(() => tip.classList.remove('is-shown'), 4200); }, 2500);
        }
      }, 1200);
    }, { once: true });

    const mark = $('.foot-mark');
    if (mark && hasGSAP && !reduceMotion) {
      gsap.fromTo(mark, { yPercent: 45, autoAlpha: 0 }, {
        yPercent: 0, autoAlpha: 1, ease: 'none',
        scrollTrigger: { trigger: '#footer', start: 'top 85%', end: 'bottom bottom', scrub: 0.8 },
      });
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     RELOJ 3D (Three.js r128)
     - Modelo procedural con piezas separables (vista explosionada).
     - Texturas dibujadas UNA vez y compartidas entre escenas.
     - Resolución dinámica: si el equipo no sostiene ~40 fps baja la densidad de píxeles
       y la recupera cuando hay margen.
     ═══════════════════════════════════════════════════════════════════ */
  const tickers = [];
  let rafStarted = false;
  function addTicker(fn) {
    if (hasGSAP) { gsap.ticker.add((time, dt) => fn(time, dt / 1000)); return; }
    tickers.push(fn);
    if (rafStarted) return;
    rafStarted = true;
    let last = performance.now();
    const loop = (now) => { const dt = (now - last) / 1000; last = now; tickers.forEach((f) => f(now / 1000, dt)); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  /* ── Texturas procedurales (un canvas por tipo y tamaño, compartido) ── */
  const texSrc = {};
  function srcCanvas(key, size, draw) {
    const k = key + size;
    if (!texSrc[k]) {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      draw(c.getContext('2d'), size);
      texSrc[k] = c;
    }
    return texSrc[k];
  }
  let texInit = null; // sube la textura a la GPU en cuanto se crea (en vez de todo junto en el primer cuadro)
  function canvasTex(THREE, key, size, aniso, draw, o) {
    const t = new THREE.CanvasTexture(srcCanvas(key, size, draw));
    if (!o || o.srgb !== false) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = aniso;
    if (o && o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(o.repeat[0], o.repeat[1]); }
    if (texInit) texInit(t);
    return t;
  }

  // Índices de la esfera: misma geometría para la textura de color y para la de luminiscencia
  function eachIndex(R, fn) {
    const u = R / 512;
    for (let h = 0; h < 12; h++) {
      const w = (h % 3 === 0 ? 28 : 22) * u, hh = R * 0.13;
      (h === 0 ? [-22 * u, 22 * u] : [0]).forEach((x) => fn(h, x, w, hh, u));
    }
  }

  function drawDial(g, S) {
    const C = S / 2, R = C, u = R / 512;
    const bg = g.createRadialGradient(C * 0.9, C * 0.78, 20 * u, C, C, R);
    bg.addColorStop(0, '#2458b3'); bg.addColorStop(0.5, '#133879'); bg.addColorStop(1, '#071a42');
    g.fillStyle = bg; g.fillRect(0, 0, S, S);
    if (g.createConicGradient) {
      const cg = g.createConicGradient(0, C, C);
      for (let i = 0; i <= 48; i++) cg.addColorStop(i / 48, i % 2 ? 'rgba(255,255,255,.075)' : 'rgba(0,0,24,.17)');
      g.fillStyle = cg; g.fillRect(0, 0, S, S);
    }
    g.lineWidth = 1;
    for (let r = 30 * u; r < R; r += 7 * u) { g.strokeStyle = 'rgba(255,255,255,.028)'; g.beginPath(); g.arc(C, C, r, 0, Math.PI * 2); g.stroke(); }
    for (let i = 0; i < 60; i++) {
      const a = (i * Math.PI) / 30, big = i % 5 === 0;
      g.strokeStyle = big ? '#e3c25c' : 'rgba(255,255,255,.7)';
      g.lineWidth = (big ? 4 : 1.6) * u;
      const r1 = R * (big ? 0.9 : 0.925), r2 = R * 0.955;
      g.beginPath(); g.moveTo(C + Math.sin(a) * r1, C - Math.cos(a) * r1); g.lineTo(C + Math.sin(a) * r2, C - Math.cos(a) * r2); g.stroke();
    }
    eachIndex(R, (h, x, w, hh, uu) => {
      g.save(); g.translate(C, C); g.rotate((h * Math.PI) / 6); g.translate(0, -R * 0.77);
      g.fillStyle = '#d8b248'; g.fillRect(x - w / 2, -hh / 2, w, hh);
      g.fillStyle = '#eef0d6'; g.fillRect(x - w / 2 + 5 * uu, -hh / 2 + 5 * uu, w - 10 * uu, hh - 10 * uu);
      g.restore();
    });
    // subesferas (las manecillas son mallas independientes que giran)
    [[C - R * 0.41, C], [C + R * 0.41, C], [C, C + R * 0.45]].forEach(([x, y]) => {
      const rr = R * 0.2;
      const sg = g.createRadialGradient(x, y, 4 * u, x, y, rr);
      sg.addColorStop(0, '#12306d'); sg.addColorStop(1, '#091b45');
      g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fillStyle = sg; g.fill();
      g.lineWidth = 6 * u; g.strokeStyle = '#cfa63a'; g.stroke();
      for (let t = 0; t < 24; t++) {
        const a = (t * Math.PI) / 12, big = t % 2 === 0;
        g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = (big ? 2.4 : 1.2) * u;
        g.beginPath(); g.moveTo(x + Math.sin(a) * rr * (big ? 0.72 : 0.8), y - Math.cos(a) * rr * (big ? 0.72 : 0.8));
        g.lineTo(x + Math.sin(a) * rr * 0.9, y - Math.cos(a) * rr * 0.9); g.stroke();
      }
    });
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ecca62'; g.font = '600 ' + Math.round(R * 0.2) + 'px "Bodoni Moda", Didot, serif';
    g.fillText('DW', C, C - R * 0.5);
    g.fillStyle = 'rgba(236,202,98,.85)'; g.font = '500 ' + Math.round(R * 0.052) + 'px "Geist", Arial, sans-serif';
    if ('letterSpacing' in g) g.letterSpacing = Math.round(R * 0.03) + 'px';
    g.fillText('WACH', C, C - R * 0.34);
  }

  function drawLume(g, S) {
    const C = S / 2, R = C;
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    eachIndex(R, (h, x, w, hh, uu) => {
      g.save(); g.translate(C, C); g.rotate((h * Math.PI) / 6); g.translate(0, -R * 0.77);
      g.fillStyle = '#fff'; g.fillRect(x - w / 2 + 5 * uu, -hh / 2 + 5 * uu, w - 10 * uu, hh - 10 * uu);
      g.restore();
    });
  }

  function drawBezel(g, S) {
    const C = S / 2, R = C, u = R / 512;
    const bg = g.createRadialGradient(C, C, R * 0.78, C, C, R);
    bg.addColorStop(0, '#0e2c68'); bg.addColorStop(1, '#061431');
    g.fillStyle = bg; g.fillRect(0, 0, S, S);
    if (g.createConicGradient) {
      const cg = g.createConicGradient(0, C, C);
      for (let i = 0; i <= 90; i++) cg.addColorStop(i / 90, i % 2 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.1)');
      g.fillStyle = cg; g.fillRect(0, 0, S, S);
    }
    for (let i = 0; i < 60; i++) {
      if (i % 10 === 0) continue;
      const a = (i * Math.PI) / 30, big = i % 5 === 0;
      g.strokeStyle = 'rgba(255,255,255,.88)'; g.lineWidth = (big ? 5 : 2.4) * u;
      const r1 = R * (big ? 0.85 : 0.89), r2 = R * 0.965;
      g.beginPath(); g.moveTo(C + Math.sin(a) * r1, C - Math.cos(a) * r1); g.lineTo(C + Math.sin(a) * r2, C - Math.cos(a) * r2); g.stroke();
    }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    [10, 20, 30, 40, 50].forEach((n) => {
      g.save(); g.translate(C, C); g.rotate((n * Math.PI) / 30); g.translate(0, -R * 0.895);
      g.fillStyle = '#f1d67a'; g.font = '700 ' + Math.round(R * 0.1) + 'px "Geist", Arial, sans-serif';
      g.fillText(String(n), 0, 0); g.restore();
    });
    g.save(); g.translate(C, C - R * 0.9);
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(-R * 0.055, -R * 0.045); g.lineTo(R * 0.055, -R * 0.045); g.lineTo(0, R * 0.055); g.closePath(); g.fill();
    g.fillStyle = '#eef0d6'; g.beginPath(); g.arc(0, -R * 0.005, R * 0.018, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function drawMovement(g, S) {
    const C = S / 2;
    g.fillStyle = '#6a5020'; g.fillRect(0, 0, S, S);
    g.save(); g.translate(C, C); g.rotate(-0.38);
    for (let x = -S; x < S; x += 14) {
      const gr = g.createLinearGradient(x, 0, x + 14, 0);
      gr.addColorStop(0, 'rgba(255,230,160,0)'); gr.addColorStop(0.5, 'rgba(255,230,160,.3)'); gr.addColorStop(1, 'rgba(0,0,0,.28)');
      g.fillStyle = gr; g.fillRect(x, -S, 14, S * 2);
    }
    g.restore();
  }

  function drawBack(g, S) {
    const C = S / 2;
    g.fillStyle = '#9ea5ae'; g.fillRect(0, 0, S, S);
    for (let r = 6; r < C; r += 5) {
      g.strokeStyle = r % 10 === 1 ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)';
      g.lineWidth = 1.5; g.beginPath(); g.arc(C, C, r, 0, Math.PI * 2); g.stroke();
    }
  }

  // Cepillado para relieve (bumpMap): vetas finas; sobre la caja (lathe) corren alrededor del contorno
  function drawBrushed(g, S) {
    g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < S * 1.6; i++) {
      const y = Math.random() * S, len = 30 + Math.random() * S * 0.8, x = Math.random() * S, v = (90 + Math.random() * 120) | 0;
      g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.05 + Math.random() * 0.16).toFixed(3) + ')';
      g.fillRect(x, y, len, 1 + Math.random() * 1.4);
      if (x + len > S) g.fillRect(x - S, y, len, 1.4);
    }
  }

  // Destello diagonal para el cristal
  function drawGlint(g, S) {
    g.clearRect(0, 0, S, S);
    g.save(); g.translate(S / 2, S / 2); g.rotate(-0.55);
    [[0.0, 0.16, 0.5], [0.62, 0.05, 0.28]].forEach(([off, wd, a]) => {
      const x = (off - 0.5) * S * 1.2;
      const gr = g.createLinearGradient(x - wd * S, 0, x + wd * S, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,' + a + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x - wd * S, -S, wd * S * 2, S * 2);
    });
    g.restore();
  }

  function drawGlow(g, S) {
    const C = S / 2, gr = g.createRadialGradient(C, C, 0, C, C, C);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }

  function gearGeo(THREE, rIn, rOut, teeth, holeR, depth) {
    const s = new THREE.Shape(), step = (Math.PI * 2) / teeth;
    for (let i = 0; i < teeth; i++) {
      const a = i * step;
      [[rIn, a], [rOut, a + step * 0.14], [rOut, a + step * 0.42], [rIn, a + step * 0.56]].forEach(([r, ang], j) => {
        const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
        if (i === 0 && j === 0) s.moveTo(x, y); else s.lineTo(x, y);
      });
    }
    s.closePath();
    const h = new THREE.Path(); h.absarc(0, 0, holeR, 0, Math.PI * 2, true); s.holes.push(h);
    return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 6 });
  }

  function buildEnv(THREE, renderer) {
    const s = new THREE.Scene();
    // Cielo con colores por vértice (un ShaderMaterial aquí genera un PMREM inválido en algunos drivers)
    const skyGeo = new THREE.SphereGeometry(30, 32, 16);
    const pos = skyGeo.attributes.position, cols = [];
    const lo = [0.012, 0.016, 0.022], mid = [0.05, 0.085, 0.115], hi = [0.02, 0.03, 0.04];
    for (let i = 0; i < pos.count; i++) {
      const h = (pos.getY(i) / 30) * 0.5 + 0.5, k1 = smooth(sub(h, 0, 0.55)), k2 = smooth(sub(h, 0.55, 1));
      for (let j = 0; j < 3; j++) cols.push(lerp(lerp(lo[j], mid[j], k1), hi[j], k2));
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    s.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const box = (w, h, p, rgb, k) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      m.material.color.setRGB(rgb[0] * k, rgb[1] * k, rgb[2] * k);
      m.position.set(p[0], p[1], p[2]); m.lookAt(0, 0, 0); s.add(m);
    };
    // luz base frontal muy suave + tiras verticales: al girar el reloj, los reflejos barren el metal
    box(34, 22, [0, 0, 22], [1, 0.95, 0.88], 0.14);
    [[-58, 3.4, [1, 0.85, 0.6]], [-34, 7, [1, 0.93, 0.8]], [-12, 1.4, [0.7, 0.82, 1]], [10, 8, [1, 0.9, 0.7]], [32, 3.2, [0.75, 0.86, 1]], [56, 6, [1, 0.86, 0.6]]].forEach(([deg, k, rgb], i) => {
      const a = (deg * Math.PI) / 180;
      box(i % 2 ? 1.4 : 2.4, 20, [Math.sin(a) * 15, 1, Math.cos(a) * 15], rgb, k);
    });
    box(18, 3, [0, 16, -4], [1, 1, 1], 3);
    box(14, 4, [-4, -9, 10], [1, 0.8, 0.5], 2.4);
    box(8, 8, [0, 2, -16], [0.5, 0.7, 1], 2);
    const pm = new THREE.PMREMGenerator(renderer);
    const tex = pm.fromScene(s, 0.03).texture;
    pm.dispose();
    return tex;
  }

  function makeParticles(THREE, count) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3), seed = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 16;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 11;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 8 - 1;
      seed[i * 2] = Math.random() * 6.28; seed[i * 2 + 1] = 0.25 + Math.random() * 0.75;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const spr = document.createElement('canvas'); spr.width = spr.height = 64;
    const sg = spr.getContext('2d'), gr = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,244,200,1)'); gr.addColorStop(0.3, 'rgba(241,214,122,.55)'); gr.addColorStop(1, 'rgba(241,214,122,0)');
    sg.fillStyle = gr; sg.fillRect(0, 0, 64, 64);
    const mat = new THREE.PointsMaterial({
      size: 0.1, map: new THREE.CanvasTexture(spr), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, color: 0xf1d67a, opacity: 0.8, sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.userData.base = 0.62;
    pts.userData.update = (t, dt) => {
      const a = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        a[i * 3 + 1] += dt * seed[i * 2 + 1] * 0.28;
        a[i * 3] += Math.sin(t * 0.4 + seed[i * 2]) * dt * 0.14;
        if (a[i * 3 + 1] > 5.8) a[i * 3 + 1] = -5.8;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = pts.userData.base + 0.2 * Math.sin(t * 0.7);
    };
    return pts;
  }

  // Caja con aristas biseladas (geometrías en caché: el brazalete reutiliza las mismas medidas)
  const bevelCache = {};
  function bevelBox(THREE, w, h, d, b) {
    b = b || 0.025;
    const key = [w, h, d, b].map((n) => n.toFixed(3)).join('|');
    if (bevelCache[key]) return bevelCache[key];
    const iw = w - 2 * b, ih = h - 2 * b, x = -iw / 2, y = -ih / 2, r = b * 1.4;
    const s = new THREE.Shape();
    s.moveTo(x + r, y); s.lineTo(x + iw - r, y); s.quadraticCurveTo(x + iw, y, x + iw, y + r);
    s.lineTo(x + iw, y + ih - r); s.quadraticCurveTo(x + iw, y + ih, x + iw - r, y + ih);
    s.lineTo(x + r, y + ih); s.quadraticCurveTo(x, y + ih, x, y + ih - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(d - 2 * b, 0.001), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 4 });
    g.center();
    bevelCache[key] = g;
    return g;
  }

  async function buildWatch(THREE, env, aniso, mobile, rootG, step) {
    const seg = mobile ? 48 : 80;
    const texN = mobile ? 768 : 1024;
    const tz = -new Date().getTimezoneOffset() * 60000;
    const gears = [], subs = [];
    const parts = {};
    const std = (o) => { const m = new THREE.MeshStandardMaterial(o); m.envMap = env; return m; };

    await step();
    const bumpCase = canvasTex(THREE, 'brushed', 512, aniso, drawBrushed, { srgb: false, repeat: [3, 1] });
    const bumpLinks = canvasTex(THREE, 'brushed', 512, aniso, drawBrushed, { srgb: false, repeat: [10, 10] });

    const mGold = std({ color: 0xdcae33, metalness: 1, roughness: 0.2, envMapIntensity: 1.5 });
    const mGoldDS = std({ color: 0xdcae33, metalness: 1, roughness: 0.24, envMapIntensity: 1.5, side: THREE.DoubleSide, bumpMap: bumpCase, bumpScale: 0.04 });
    const mGoldSoft = std({ color: 0xc79a2a, metalness: 1, roughness: 0.3, envMapIntensity: 1.35, bumpMap: bumpLinks, bumpScale: 0.1 });
    const mSteel = std({ color: 0xd7dbe0, metalness: 1, roughness: 0.26, envMapIntensity: 1.3 });
    const mDark = std({ color: 0x0b0e14, metalness: 0.7, roughness: 0.4, envMapIntensity: 0.9 });
    const mRuby = std({ color: 0xb3122b, metalness: 0.1, roughness: 0.15, envMapIntensity: 1.5 });
    const mLume = new THREE.MeshStandardMaterial({ color: 0xeef0d6, emissive: 0xb6e8c2, emissiveIntensity: 0.6, roughness: 0.6 });
    const mGlass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.09, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.8, depthWrite: false });
    mGlass.envMap = env;
    await step();
    const dialMap = canvasTex(THREE, 'dial', texN, aniso, drawDial);
    await step();
    const lumeMap = canvasTex(THREE, 'lume', texN, aniso, drawLume);
    const mDial = std({ map: dialMap, metalness: 0.5, roughness: 0.45, envMapIntensity: 0.7, emissive: 0xb6e8c2, emissiveMap: lumeMap, emissiveIntensity: 0.6 });

    const group = (name, cfg) => { const g = new THREE.Group(); parts[name] = Object.assign({ obj: g, base: g.position.clone(), pulse: 0, target: 0 }, cfg); rootG.add(g); return g; };
    const cylZ = (r1, r2, h, s, mat) => { const geo = new THREE.CylinderGeometry(r1, r2, h, s || seg); geo.rotateX(Math.PI / 2); return new THREE.Mesh(geo, mat); };

    await step();
    /* Caja (aro hueco para ver el movimiento al separar) + orejas */
    const gCase = group('case', { dz: 0, range: [0, 1], anchor: [0.9, -0.55, 0.1] });
    const prof = [[0.73, -0.18], [0.98, -0.18], [1.0, -0.14], [1.0, 0.12], [0.965, 0.18], [0.73, 0.18]].map(([x, y]) => new THREE.Vector2(x, y));
    const caseGeo = new THREE.LatheGeometry(prof, seg); caseGeo.rotateX(Math.PI / 2);
    gCase.add(new THREE.Mesh(caseGeo, mGoldDS));
    [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sy]) => {
      const lug = new THREE.Mesh(bevelBox(THREE, 0.36, 0.62, 0.26, 0.03), mGold);
      lug.position.set(sx * 0.62, sy * 0.98, 0); lug.rotation.z = -sx * sy * 0.12; gCase.add(lug);
    });
    const guard = new THREE.Mesh(bevelBox(THREE, 0.22, 0.5, 0.22, 0.03), mGoldSoft);
    guard.position.set(1.0, 0, 0); gCase.add(guard);

    await step();
    /* Bisel con borde estriado + inserto graduado */
    const gBezel = group('bezel', { dz: 1.8, range: [0.04, 0.78], anchor: [-0.72, 0.72, 0.13] });
    {
      const s = new THREE.Shape(), teeth = mobile ? 60 : 90, step = (Math.PI * 2) / teeth;
      for (let i = 0; i < teeth; i++) {
        const a = i * step;
        [[1.0, a], [1.045, a + step * 0.12], [1.045, a + step * 0.5], [1.0, a + step * 0.62]].forEach(([r, ang], j) => {
          const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
          if (i === 0 && j === 0) s.moveTo(x, y); else s.lineTo(x, y);
        });
      }
      s.closePath();
      const h = new THREE.Path(); h.absarc(0, 0, 0.74, 0, Math.PI * 2, true); s.holes.push(h);
      const geo = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.012, bevelSegments: 2, curveSegments: mobile ? 40 : 72 });
      gBezel.add(new THREE.Mesh(geo, mGold));
      const ins = new THREE.Mesh(
        new THREE.RingGeometry(0.745, 0.935, seg),
        std({ map: canvasTex(THREE, 'bezel', texN, aniso, drawBezel), metalness: 0.35, roughness: 0.4, envMapIntensity: 0.8 })
      );
      ins.position.z = 0.136; gBezel.add(ins);
    }
    gBezel.position.z = 0.17; parts.bezel.base.copy(gBezel.position);

    await step();
    /* Cristal + destello */
    const gCrystal = group('crystal', { dz: 2.7, range: [0, 0.7], anchor: [-0.5, 0.52, 0.03] });
    gCrystal.add(cylZ(0.75, 0.75, 0.03, seg, mGlass));
    gCrystal.add(new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.007, 8, seg), mSteel));
    const glintTex = canvasTex(THREE, 'glint', 256, 1, drawGlint);
    glintTex.wrapS = THREE.RepeatWrapping;
    const glint = new THREE.Mesh(new THREE.CircleGeometry(0.74, 40), new THREE.MeshBasicMaterial({ map: glintTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    glint.position.z = 0.02; gCrystal.add(glint);
    gCrystal.position.z = 0.26; parts.crystal.base.copy(gCrystal.position);

    await step();
    /* Esfera (+ manecillas de las subesferas) */
    const gDial = group('dial', { dz: 0.62, range: [0.16, 0.86], anchor: [-0.5, -0.42, 0.02] });
    gDial.add(new THREE.Mesh(new THREE.CircleGeometry(0.735, seg), mDial));
    [[-0.301, 0, 0.32], [0.301, 0, 0.14], [0, -0.331, 0.07]].forEach(([cx, cy, speed]) => {
      const s = new THREE.Shape();
      s.moveTo(-0.007, -0.025); s.lineTo(0.007, -0.025); s.lineTo(0.004, 0.1); s.lineTo(0, 0.118); s.lineTo(-0.004, 0.1); s.closePath();
      const piv = new THREE.Group(); piv.add(new THREE.Mesh(new THREE.ShapeGeometry(s), mGoldDS));
      const cap = cylZ(0.014, 0.014, 0.012, 14, mGold); piv.add(cap);
      piv.position.set(cx, cy, 0.012); gDial.add(piv); subs.push({ piv, speed });
    });
    gDial.position.z = 0.07; parts.dial.base.copy(gDial.position);

    await step();
    /* Manecillas (hora real) */
    const hand = (len, wid, tail, mat, z) => {
      const s = new THREE.Shape();
      s.moveTo(-wid / 2, -tail); s.lineTo(wid / 2, -tail); s.lineTo(wid * 0.55, len * 0.72); s.lineTo(0, len); s.lineTo(-wid * 0.55, len * 0.72); s.closePath();
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false }), mat);
      const pivot = new THREE.Group(); pivot.add(m);
      if (len < 0.7) {
        const l = new THREE.Shape();
        l.moveTo(-wid * 0.2, len * 0.1); l.lineTo(wid * 0.2, len * 0.1); l.lineTo(wid * 0.2, len * 0.66); l.lineTo(-wid * 0.2, len * 0.66); l.closePath();
        const lm = new THREE.Mesh(new THREE.ExtrudeGeometry(l, { depth: 0.006, bevelEnabled: false }), mLume);
        lm.position.z = 0.012; pivot.add(lm);
      }
      pivot.position.z = z; return pivot;
    };
    const gHands = group('hands', { dz: 1.25, range: [0.1, 0.8], anchor: [0.02, 0.3, 0.2] });
    const hHour = hand(0.42, 0.1, 0.08, mGold, 0.115);
    const hMin = hand(0.64, 0.075, 0.1, mGold, 0.145);
    const hSec = hand(0.7, 0.022, 0.2, std({ color: 0xe8e2d0, metalness: 1, roughness: 0.3, envMapIntensity: 1.3 }), 0.175);
    const cap = cylZ(0.05, 0.05, 0.05, 24, mGold); cap.position.z = 0.205;
    gHands.add(hHour, hMin, hSec, cap);

    await step();
    /* Movimiento: placa, engranes, rubíes y volante */
    const gMove = group('movement', { dz: -0.8, range: [0.22, 0.9], anchor: [0.3, -0.24, 0.07] });
    gMove.add(cylZ(0.7, 0.7, 0.05, seg, mDark));
    const top = new THREE.Mesh(new THREE.CircleGeometry(0.69, seg), std({ map: canvasTex(THREE, 'move', 512, aniso, drawMovement), metalness: 0.85, roughness: 0.4, envMapIntensity: 1.1 }));
    top.position.z = 0.027; gMove.add(top);
    const rubyGeo = new THREE.SphereGeometry(0.03, 12, 10);
    [[-0.28, 0.2, 0.22, 0.14, 22, mGold, 0.7], [0.24, 0.28, 0.17, 0.1, 18, mSteel, -1.0], [0.3, -0.22, 0.25, 0.16, 24, mGoldSoft, 0.55], [-0.26, -0.28, 0.16, 0.09, 16, mSteel, -1.2], [0.0, 0.0, 0.2, 0.12, 20, mGold, 0.9]].forEach(([x, y, ro, ri, t, mat, sp]) => {
      const m = new THREE.Mesh(gearGeo(THREE, ri, ro, t, ri * 0.4, 0.03), mat);
      m.position.set(x, y, 0.03); gMove.add(m); gears.push({ mesh: m, speed: sp });
      const rb = new THREE.Mesh(rubyGeo, mRuby); rb.position.set(x, y, 0.07); gMove.add(rb);
    });
    const balance = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 8, 36), mGold);
    balance.position.set(-0.32, 0.38, 0.05); gMove.add(balance);
    gMove.position.z = -0.04; parts.movement.base.copy(gMove.position);

    await step();
    /* Fondo de caja */
    const gBack = group('caseback', { dz: -1.7, range: [0.3, 1], anchor: [0.5, 0.55, 0.03] });
    gBack.add(cylZ(0.93, 0.93, 0.05, seg, std({ map: canvasTex(THREE, 'back', 512, aniso, drawBack), metalness: 1, roughness: 0.3, envMapIntensity: 1.2 })));
    const screwGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.06, 12); screwGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3, sc = new THREE.Mesh(screwGeo, mDark);
      sc.position.set(Math.cos(a) * 0.82, Math.sin(a) * 0.82, 0.01); gBack.add(sc);
    }
    gBack.position.z = -0.21; parts.caseback.base.copy(gBack.position);

    await step();
    /* Corona y pulsadores */
    const gCrown = group('crown', { dx: 1.15, range: [0, 0.6], anchor: [0.4, 0.05, 0] });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 12), mGoldSoft); stem.rotation.z = Math.PI / 2; stem.position.x = 0.1;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.2, 18), std({ color: 0xd9ad3a, metalness: 1, roughness: 0.28, flatShading: true, envMapIntensity: 1.3 }));
    head.rotation.z = Math.PI / 2; head.position.x = 0.3;
    gCrown.add(stem, head); gCrown.position.x = 1.0; parts.crown.base.copy(gCrown.position);
    [0.62, -0.62].forEach((ang, i) => {
      const g = group('pusher' + i, { dx: Math.cos(ang) * 0.8, dy: Math.sin(ang) * 0.8, range: [0, 0.6], anchor: [0, 0.22, 0] });
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.18, 12), mGoldSoft); st.position.y = 0.09;
      const hd = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.1, 14), mGold); hd.position.y = 0.2;
      g.add(st, hd); g.rotation.z = ang - Math.PI / 2; g.position.set(Math.cos(ang) * 0.98, Math.sin(ang) * 0.98, 0); parts['pusher' + i].base.copy(g.position);
    });

    await step();
    /* Brazalete */
    const arm = (dir, name) => {
      const g = group(name, { dy: dir * 1.2, range: [0.1, 0.82], anchor: [0, dir * 2.05, 0] });
      for (let i = 0; i < 5; i++) {
        const w = 0.62 - i * 0.022, link = new THREE.Group();
        const c = new THREE.Mesh(bevelBox(THREE, w * 0.46, 0.3, 0.15, 0.022), mGold);
        const l = new THREE.Mesh(bevelBox(THREE, w * 0.22, 0.3, 0.12, 0.02), mGoldSoft); l.position.x = -w * 0.34;
        const r = l.clone(); r.position.x = w * 0.34;
        link.add(c, l, r);
        link.position.set(0, dir * (1.58 + i * 0.335), -i * i * 0.026 - 0.02);
        link.rotation.x = -dir * i * 0.075; g.add(link);
      }
    };
    arm(1, 'braceUp'); arm(-1, 'braceDown');

    const names = Object.keys(parts);
    let lastE = -1, lastSp = -1, pulsing = false;
    const api = {
      root: rootG, parts, hands: { hHour, hMin, hSec },
      setExplode(e, spread) {
        const sp = spread || 1;
        if (Math.abs(e - lastE) < 1e-4 && sp === lastSp) return;
        lastE = e; lastSp = sp;
        for (let i = 0; i < names.length; i++) {
          const p = parts[names[i]];
          const r = p.range || [0, 1];
          const t = smooth(sub(e, r[0], r[1])) * sp;
          p.obj.position.set(p.base.x + (p.dx || 0) * t, p.base.y + (p.dy || 0) * t, p.base.z + (p.dz || 0) * t);
        }
      },
      highlight(active, t) {
        let busy = false;
        for (let i = 0; i < names.length; i++) {
          const p = parts[names[i]];
          p.target = active.indexOf(names[i]) > -1 ? 1 : 0;
          if (Math.abs(p.target - p.pulse) > 0.002 || p.target > 0) {
            p.pulse += (p.target - p.pulse) * 0.1;
            p.obj.scale.setScalar(1 + 0.035 * p.pulse * (0.55 + 0.45 * Math.sin(t * 4.2)));
            busy = true;
          } else if (p.pulse !== 0) { p.pulse = 0; p.obj.scale.setScalar(1); }
        }
        pulsing = busy;
      },
      update(t, rotY) {
        const now = Date.now() + tz;
        const s = (now % 60000) / 1000, m = (now % 3600000) / 60000, h = (now % 43200000) / 3600000;
        hHour.rotation.z = -(h / 12) * Math.PI * 2;
        hMin.rotation.z = -(m / 60) * Math.PI * 2;
        hSec.rotation.z = -(s / 60) * Math.PI * 2;
        for (let i = 0; i < gears.length; i++) gears[i].mesh.rotation.z = t * gears[i].speed;
        for (let i = 0; i < subs.length; i++) subs[i].piv.rotation.z = -t * subs[i].speed;
        balance.rotation.z = Math.sin(t * 6) * 0.9;
        const pulse = 0.55 + 0.15 * Math.sin(t * 1.1);
        mDial.emissiveIntensity = pulse; mLume.emissiveIntensity = pulse;
        glintTex.offset.x = ((rotY || 0) * 0.5 + t * 0.025) % 1;
        glint.material.opacity = Math.max(0, 0.3 + 0.28 * Math.sin((rotY || 0) * 2.3 + t * 0.35));
      },
    };
    return api;
  }

  class WatchStage {
    constructor(canvas, opts) {
      const THREE = window.THREE;
      this.canvas = canvas; this.opts = opts; this.size = { w: 0, h: 0 }; this.active = false; this.ok = false; this.failed = false;
      const dpr = window.devicePixelRatio || 1;
      try {
        // Pantallas de alta densidad ya no necesitan suavizado de bordes por hardware (MSAA): es lo más caro del cuadro
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !opts.mobile && dpr < 1.5, alpha: true, stencil: false, powerPreference: 'high-performance' });
      } catch (err) { this.failed = true; return; }
      const r = this.renderer;
      // Resolución dinámica: tope por dispositivo y piso 0.75
      this.prMax = Math.min(dpr, opts.maxPR || 2);
      this.prMin = Math.min(0.75, this.prMax);
      this.pr = this.prMax;
      this.ema = 0; this.perfN = 0; this.perfUp = 0; this.perfCool = 0;
      r.setPixelRatio(this.pr);
      r.outputEncoding = THREE.sRGBEncoding;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.12;
      r.setClearColor(0x000000, 0);
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); root.classList.add('no-webgl'); });

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
      this.camera.position.set(0, 0, 10.5);
      this.scene.add(new THREE.AmbientLight(0xffffff, 0.25));
      const key = new THREE.DirectionalLight(0xfff0d0, 2.0); key.position.set(-4, 5, 7); this.scene.add(key);
      const rim = new THREE.DirectionalLight(0x6fb6ff, 1.3); rim.position.set(6, 2, -4); this.scene.add(rim);
      const fill = new THREE.PointLight(0xe0bb4d, 0.9, 30); fill.position.set(3, -3, 6); this.scene.add(fill);
      this.key = key;

      this.rig = new THREE.Group();
      this.rigRoot = new THREE.Group(); // el reloj se arma aquí, pieza por pieza, en init()
      this.rig.add(this.rigRoot);
      // Halo dorado detrás del reloj (sprite aditivo, escala con el reloj)
      this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(THREE, 'glow', 128, 1, drawGlow), color: 0xe0bb4d, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, toneMapped: false }));
      this.glow.scale.set(7, 7, 1); this.glow.position.z = -1.8; this.rig.add(this.glow);
      this.scene.add(this.rig);
      if (opts.particles) { this.particles = makeParticles(THREE, opts.particles); this.scene.add(this.particles); }

      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(canvas);
      this.io = new IntersectionObserver(([e]) => { this.active = e.isIntersecting; }, { rootMargin: '10% 0px' });
      this.io.observe(canvas);
      this.resize();
    }
    // Armado en pasos pequeños (entorno, texturas, geometrías) cediendo el hilo entre cada uno
    async init() {
      const THREE = window.THREE, r = this.renderer;
      texInit = (t) => { try { r.initTexture(t); } catch (err) { /* opcional */ } };
      const step = async () => { this.compile(); await yieldFrame(); };
      await yieldFrame();
      const env = buildEnv(THREE, r);
      this.scene.environment = env;
      await yieldFrame();
      this.watch = await buildWatch(THREE, env, Math.min(r.capabilities.getMaxAnisotropy(), 8), this.opts.mobile, this.rigRoot, step);
      this.ok = true;
    }
    resize() {
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      if (!w || !h) return;
      this.size = { w, h };
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      if (this.onResize) this.onResize(w, h);
    }
    // Compilar shaders y subir texturas por adelantado: se llama en pasos separados para no bloquear el hilo principal
    compile() { try { this.renderer.compile(this.scene, this.camera); } catch (err) { /* solo es una optimización */ } }
    warm() { const a = this.active; this.active = true; this.render(0, 0); this.active = a; }
    setPR(pr) {
      this.pr = pr;
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(this.size.w, this.size.h, false);
    }
    // Resolución dinámica: baja rápido cuando va lento, sube despacio cuando hay margen
    perf(dt) {
      if (!dt || dt > 0.2) return;
      this.ema = this.ema ? this.ema * 0.93 + dt * 0.07 : dt;
      if (this.perfCool > 0) { this.perfCool--; return; }
      if (++this.perfN < 24) return;
      if (this.ema > 1 / 36 && this.pr > this.prMin + 0.01) {
        this.setPR(Math.max(this.prMin, this.pr - 0.25)); this.perfN = 0; this.perfUp = 0; this.perfCool = 480;
      } else if (this.ema < 1 / 57 && this.pr < this.prMax - 0.01) {
        if (++this.perfUp > 300) { this.setPR(Math.min(this.prMax, this.pr + 0.25)); this.perfUp = 0; this.perfCool = 480; }
      } else this.perfUp = 0;
    }
    // unidades de mundo por píxel en el plano del reloj
    unitsPerPx() {
      return (2 * Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.position.z) / this.size.h;
    }
    render(t, dt) {
      if (!this.ok || !this.active) return;
      if (this.onFrame) this.onFrame(t, dt);
      this.watch.update(t, this.rig.rotation.y);
      if (this.particles) this.particles.userData.update(t, dt);
      this.perf(dt);
      this.renderer.render(this.scene, this.camera);
    }
  }

  /* ───────────── Geometría del hero ─────────────
     Lee dónde quedó el "escenario" (.hero-stage) y coloca ahí el arco, los anillos y la imagen de respaldo
     mediante variables CSS. Es independiente del 3D: funciona igual si WebGL o las librerías no cargan. */
  function heroGeometry() {
    const hero = $('#inicio'), zone = $('#heroStage');
    if (!hero || !zone) return null;
    const hr = hero.getBoundingClientRect(), zr = zone.getBoundingClientRect();
    const zh = zr.height, zw = zr.width;
    if (!zh || !zw) return null;
    const face = Math.min(zh * 0.82, zw * 0.74, 640);
    const cx = zr.left - hr.left + zw / 2, cy = zr.top - hr.top + zh * 0.52;
    const st = hero.style;
    st.setProperty('--zx', cx.toFixed(1) + 'px');
    st.setProperty('--zy', cy.toFixed(1) + 'px');
    st.setProperty('--rw', Math.round(Math.min(hr.width * 1.3, zh * 2.5)) + 'px');
    st.setProperty('--tw', Math.round(face * 1.42) + 'px');
    st.setProperty('--fw', Math.round(face * 0.62) + 'px');
    st.setProperty('--ah', Math.round(hr.bottom - zr.top + zh * 0.02) + 'px');
    return { hr, zr, zh, zw, face, cx, cy, top: zr.top - hr.top };
  }
  function initHeroLayout() {
    heroGeometry();
    const zone = $('#heroStage');
    if (zone && 'ResizeObserver' in window) new ResizeObserver(() => heroGeometry()).observe(zone);
    window.addEventListener('resize', heroGeometry, { passive: true });
  }

  /* ───────────────────────────────────────────────────────────────────
     Hero: reloj centrado en el escenario bajo el texto. Al hacer scroll el hero se ANCLA y el reloj:
     sube al centro de la pantalla, da una vuelta completa (muestra el lateral y el fondo), se acerca
     a la esfera y empieza a separarse; el texto se desvanece y la luz dorada crece.
     ─────────────────────────────────────────────────────────────────── */
  async function initHero3D() {
    const canvas = $('#heroCanvas'), hero = $('#inicio'), zone = $('#heroStage');
    if (!canvas || !hero || !zone || !hasThree) { root.classList.add('no-webgl'); resolveHero(); return; }
    const mobile = isMobile();
    const stage = new WatchStage(canvas, { mobile, particles: mobile ? 90 : 220, maxPR: 1.5 });
    if (stage.failed) { root.classList.add('no-webgl'); resolveHero(); return; }

    const S = { ex: reduceMotion ? 0 : 1, spin: reduceMotion ? 0 : -1.3, mx: 0, my: 0, cx: 0, cy: 0, turn: 0, rise: 0, zoom: 0, lift: 0, aura: 0, mk: 0 };
    let baseX = 0, baseY = 0, midY = 0, scale = 1, zoomK = 0.4, maskA = 0, maskB = 0, lastMk = -1;

    // Coloca el reloj 3D (y su máscara) según la posición real del escenario (.hero-stage)
    const layout = () => {
      if (!stage.size.h) return;
      const g = heroGeometry();
      if (!g) return;
      const u = stage.unitsPerPx();
      scale = (g.face * u) / 2;
      baseX = (g.cx - g.hr.width / 2) * u;
      baseY = -(g.cy - g.hr.height / 2) * u;
      const viewH = Math.min(g.hr.height, window.innerHeight);
      midY = -(viewH / 2 - g.hr.height / 2) * u;
      // el acercamiento final nunca debe pasar del ancho ni del alto de la pantalla
      zoomK = clamp(Math.min((viewH * 0.66) / g.face, (g.hr.width * 0.8) / g.face) - 1, 0.1, 0.4);
      maskA = Math.round(g.top - 14); maskB = Math.round(g.top + g.zh * 0.2);
      lastMk = -1; // fuerza reaplicar la máscara
    };
    stage.onResize = layout;
    new ResizeObserver(layout).observe(zone);

    stage.onFrame = (t) => {
      S.cx += (S.mx - S.cx) * 0.06; S.cy += (S.my - S.cy) * 0.06;
      const rig = stage.rig, still = reduceMotion, k = 1 - S.turn;
      rig.rotation.y = S.spin + (still ? 0 : Math.sin(t * 0.6) * 0.34 * k) + S.cx * 0.38 * (1 - S.turn * 0.8) + S.turn * Math.PI * 2;
      rig.rotation.x = 0.14 + (still ? 0 : Math.sin(t * 0.45) * 0.05 * k) - S.cy * 0.2 * k + S.turn * 0.1;
      rig.rotation.z = -0.2 * (1 - S.turn * 0.7);
      rig.position.x = baseX * (1 - S.rise);
      rig.position.y = lerp(baseY, midY, S.rise) + (still ? 0 : Math.sin(t * 0.9) * 0.07 * scale * k);
      rig.scale.setScalar(scale * (1 + zoomK * S.zoom));
      stage.watch.setExplode(Math.max(S.ex, S.lift));
      stage.glow.material.opacity = 0.15 + 0.2 * S.ex + 0.5 * S.aura + (still ? 0 : 0.04 * Math.sin(t * 0.8));
      // La máscara oculta el brazalete superior mientras hay texto encima y se abre cuando el reloj sube al centro
      if (Math.abs(S.mk - lastMk) > 0.002 || lastMk < 0) {
        lastMk = S.mk;
        canvas.style.setProperty('--mk-a', (maskA * (1 - S.mk)).toFixed(1) + 'px');
        canvas.style.setProperty('--mk-b', (maskB * (1 - S.mk)).toFixed(1) + 'px');
      }
    };
    if (finePointer) {
      window.addEventListener('pointermove', (e) => { S.mx = (e.clientX / window.innerWidth - 0.5) * 2; S.my = (e.clientY / window.innerHeight - 0.5) * 2; }, { passive: true });
    }

    await stage.init();
    stage.resize();
    layout();
    addTicker((t, dt) => stage.render(t, dt));

    if (hasGSAP && !reduceMotion) {
      // El hero se ancla solo si cabe en la pantalla. En teléfonos muy bajos (o apaisados) el hero es más alto que la
      // ventana: anclarlo dejaría partes sin poder verse, así que ahí el mismo efecto corre sin anclar.
      let tl = null, pinned = null;
      const build = () => {
        const wantPin = hero.offsetHeight <= window.innerHeight + 8;
        if (wantPin === pinned) return;
        pinned = wantPin;
        if (tl) { tl.scrollTrigger.kill(true); tl.kill(); }
        Object.assign(S, { turn: 0, rise: 0, zoom: 0, lift: 0, aura: 0, mk: 0 });
        const dist = () => Math.round(window.innerHeight * (isMobile() ? 1.0 : 1.25));
        tl = gsap.timeline({
          defaults: { ease: 'none' },
          scrollTrigger: wantPin
            ? { trigger: hero, start: 'top top', end: () => '+=' + dist(), scrub: 0.6, pin: true, anticipatePin: 1, invalidateOnRefresh: true }
            : { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.6, invalidateOnRefresh: true },
        });
        tl.to('.hero-inner', { y: wantPin ? -90 : -40, autoAlpha: 0, ease: 'power2.in', duration: 0.26 }, 0)
          .to(S, { turn: 1, ease: 'power2.inOut', duration: 0.78 }, 0.04)
          .to(S, { zoom: 1, ease: 'power2.inOut', duration: 0.6 }, 0.16)
          .to(S, { aura: 1, ease: 'power1.inOut', duration: 0.7 }, 0.1)
          .to(S, { lift: isMobile() ? 0.42 : 0.56, ease: 'power2.inOut', duration: 0.38 }, 0.62)
          .to('.hero-arch', { scale: 1.3, autoAlpha: 0, transformOrigin: '50% 100%', duration: 0.7 }, 0.1)
          .to('.hero-rings, .hero-ringtext', { autoAlpha: 0, duration: 0.5 }, 0.15)
          .to(S, { mk: 1, ease: 'none', duration: 0.3 }, 0.12);
        if (wantPin) tl.to(S, { rise: 1, ease: 'power2.inOut', duration: 0.55 }, 0.04);
      };
      build();
      ScrollTrigger.sort();
      requestAnimationFrame(() => ScrollTrigger.refresh());
      let rt, lastW = window.innerWidth, lastH = window.innerHeight;
      window.addEventListener('resize', () => {
        clearTimeout(rt);
        rt = setTimeout(() => {
          // la barra de direcciones del móvil cambia la altura unos píxeles: eso no cuenta
          if (window.innerWidth === lastW && Math.abs(window.innerHeight - lastH) < 120) return;
          lastW = window.innerWidth; lastH = window.innerHeight;
          build(); ScrollTrigger.sort(); ScrollTrigger.refresh();
        }, 280);
      }, { passive: true });
      document.addEventListener('loader:done', () => {
        gsap.to(S, { ex: 0, duration: 2.8, ease: 'expo.out', delay: 0.15 });
        gsap.to(S, { spin: 0, duration: 3.4, ease: 'power4.out', delay: 0.15 });
      }, { once: true });
    }
    stage.compile();
    await yieldFrame();
    stage.warm();
    requestAnimationFrame(() => resolveHero());
  }

  /* ───────────────────────────────────────────────────────────────────
     Anatomía: pantalla anclada. El reloj se separa pieza por pieza con el scroll;
     la cámara cambia de ángulo en cada pieza, una llamada señala la pieza activa
     y una palabra gigante cambia detrás del reloj.
     ─────────────────────────────────────────────────────────────────── */
  function initAnatomy() {
    const sec = $('#anatomia');
    if (!sec) return;
    const canvas = $('#anatCanvas'), cta = $('#anatCta'), pin = $('#anatPin');
    const steps = $$('#anatSteps li'), words = $$('.anat-word span', sec), segs = $$('.anat-ring .seg', sec), dots = $$('.anat-dots i', sec);
    const pinLabel = $('b', pin);
    const ticksG = $('#anatTicks');
    if (ticksG) {
      const NS = 'http://www.w3.org/2000/svg';
      for (let i = 0; i < 120; i++) {
        const a = (i * 3 * Math.PI) / 180, big = i % 10 === 0, r1 = big ? 136 : 140, r2 = 146;
        const l = document.createElementNS(NS, 'line');
        l.setAttribute('x1', (150 + Math.sin(a) * r1).toFixed(2)); l.setAttribute('y1', (150 - Math.cos(a) * r1).toFixed(2));
        l.setAttribute('x2', (150 + Math.sin(a) * r2).toFixed(2)); l.setAttribute('y2', (150 - Math.cos(a) * r2).toFixed(2));
        if (big) l.setAttribute('class', 'big');
        ticksG.appendChild(l);
      }
    }
    // Una entrada por paso: piezas que se resaltan, punto de anclaje de la llamada y ángulo de cámara
    const GROUPS = [
      { parts: ['crystal', 'bezel'], anchor: 'bezel', cam: { ry: -0.62, rx: 0.3, rz: -0.1, z: 11.6 } },
      { parts: ['hands'], anchor: 'hands', cam: { ry: -0.32, rx: 0.46, rz: -0.18, z: 11.8 } },
      { parts: ['dial'], anchor: 'dial', cam: { ry: -0.74, rx: 0.2, rz: -0.08, z: 12.3 } },
      { parts: ['movement'], anchor: 'movement', cam: { ry: -1.02, rx: 0.28, rz: -0.05, z: 12.8 } },
      { parts: ['crown', 'pusher0', 'pusher1'], anchor: 'crown', cam: { ry: -1.22, rx: 0.16, rz: -0.12, z: 11.6 } },
      { parts: ['braceUp', 'braceDown'], anchor: 'braceDown', cam: { ry: -0.28, rx: 0.1, rz: -0.06, z: 17.2 } },
    ];
    const CAM_FINAL = { ry: -0.14, rx: 0.1, rz: -0.12, z: 10.6 };
    const marks = [0, 0.13, 0.25, 0.37, 0.5, 0.63];
    const S = { target: reduceMotion ? 0.56 : 0, p: reduceMotion ? 0.56 : 0, mx: 0, my: 0, step: -1, final: false };
    const cam = Object.assign({}, GROUPS[0].cam, { ry: -0.2, rx: 0.1, rz: -0.12, z: 10.5 });
    let stage = null, building = false, pinSide = '', pinOn = false;

    const setStep = (i, final) => {
      if (i !== S.step) {
        S.step = i;
        steps.forEach((li, k) => li.classList.toggle('is-active', k === i));
        words.forEach((w, k) => { w.classList.toggle('is-on', k === i); w.classList.toggle('is-past', k < i); });
        segs.forEach((s, k) => s.classList.toggle('on', k === i));
        dots.forEach((d, k) => d.classList.toggle('on', k <= i));
        const h3 = $('h3', steps[i]);
        if (h3 && pinLabel) pinLabel.textContent = h3.textContent;
      }
      if (final !== S.final) {
        S.final = final;
        sec.classList.toggle('is-final', final);
        cta.classList.toggle('is-on', final);
        segs.forEach((s) => s.classList.toggle('all', final));
      }
    };
    setStep(0, false);
    if (reduceMotion) { steps.forEach((li) => li.classList.add('is-active')); cta.classList.add('is-on'); }

    const build = async () => {
      if (stage || building || !hasThree) return;
      building = true;
      const mobile = isMobile();
      const st = new WatchStage(canvas, { mobile, particles: mobile ? 0 : 90, maxPR: 1.75 });
      if (st.failed) { root.classList.add('no-webgl'); stage = null; building = true; return; }
      stage = st;
      const THREE = window.THREE, v = new THREE.Vector3();
      let scale = 1;
      stage.onResize = (w, h) => {
        const desk = w >= 1024, land = !desk && w >= 640 && h <= 560, u = stage.unitsPerPx();
        const facePx = desk ? Math.min(w * 0.3, h * 0.44) : land ? Math.min(w * 0.26, h * 0.5) : Math.min(w * 0.54, h * 0.28);
        scale = (facePx * u) / 2;
        stage.rig.scale.setScalar(scale);
        stage.rig.position.x = (desk ? 0.2 : land ? 0.22 : 0) * w * u;
        stage.rig.position.y = -(desk ? 0.01 * h : land ? 0 : -0.02 * h) * u;
      };
      stage.resize();

      const updatePin = (ex, show) => {
        const g = GROUPS[S.step], part = stage.watch.parts[g.anchor];
        const vis = show && part && ex > 0.14 && !S.final && !reduceMotion;
        if (vis !== pinOn) { pinOn = vis; pin.classList.toggle('is-on', vis); }
        if (!vis) return;
        stage.rig.updateMatrixWorld(true);
        v.set(part.anchor[0], part.anchor[1], part.anchor[2]);
        part.obj.updateWorldMatrix(true, false);
        part.obj.localToWorld(v); v.project(stage.camera);
        const w = stage.size.w, h = stage.size.h;
        const x = (v.x * 0.5 + 0.5) * w;
        // la llamada siempre queda dentro de la pantalla visible (no bajo el titular ni bajo el panel inferior)
        const short = h <= 560;
        const y = clamp((-v.y * 0.5 + 0.5) * h, short ? 64 : mobile ? h * 0.3 : 84, short ? h - 64 : mobile ? h * 0.6 : h - 84);
        v.set(0, 0, 0); stage.rig.localToWorld(v); v.project(stage.camera);
        const cx = (v.x * 0.5 + 0.5) * w;
        let side = x >= cx ? 'r' : 'l';
        const room = mobile ? 150 : 230;
        if (side === 'r' && x + room > w - 8) side = 'l';
        else if (side === 'l' && x - room < 8) side = 'r';
        if (side !== pinSide) { pinSide = side; pin.classList.toggle('is-left', side === 'l'); }
        pin.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
      };

      stage.onFrame = (t, dt) => {
        dt = dt || 0.016;
        S.p += (S.target - S.p) * (1 - Math.exp(-dt * 6.5));
        const p = S.p;
        const ex = p < 0.05 ? 0 : p < 0.48 ? smooth(sub(p, 0.05, 0.48)) : p < 0.76 ? 1 : 1 - smooth(sub(p, 0.76, 0.93));
        stage.watch.setExplode(ex, mobile ? 0.78 : 1);
        const tgt = p > 0.9 ? CAM_FINAL : GROUPS[Math.max(S.step, 0)].cam;
        const kc = 1 - Math.exp(-dt * 2.8);
        cam.ry += (tgt.ry - cam.ry) * kc; cam.rx += (tgt.rx - cam.rx) * kc; cam.rz += (tgt.rz - cam.rz) * kc; cam.z += (tgt.z - cam.z) * kc;
        const rig = stage.rig;
        rig.rotation.set(cam.rx - S.my * 0.08, cam.ry + (reduceMotion ? 0 : Math.sin(t * 0.5) * 0.05) + S.mx * 0.14, cam.rz);
        stage.camera.position.z = cam.z + (mobile ? 1.3 : 0);
        stage.camera.updateMatrixWorld(true);
        stage.watch.highlight(p < 0.9 ? GROUPS[Math.max(S.step, 0)].parts : [], t);
        stage.glow.material.opacity = 0.12 + 0.26 * ex;
        if (stage.particles) stage.particles.userData.base = 0.45 + 0.35 * ex;
        updatePin(ex, true);
      };
      await stage.init();   // armado por pasos: no bloquea el scroll ni las animaciones
      stage.resize();
      addTicker((t, dt) => stage.render(t, dt));
      await yieldFrame();
      stage.warm();         // primer cuadro por adelantado (sube lo que falte a la GPU) antes de que el usuario llegue
    };

    // Se arma en un momento ocioso poco después de terminar la intro (sin tirones al llegar a la sección)
    document.addEventListener('loader:done', () => {
      setTimeout(() => { if ('requestIdleCallback' in window) requestIdleCallback(() => build(), { timeout: 2500 }); else build(); }, 3200);
    }, { once: true });
    const lazy = new IntersectionObserver(([e]) => { if (e.isIntersecting) { build(); lazy.disconnect(); } }, { rootMargin: '150% 0px' });
    lazy.observe(sec);

    if (finePointer) {
      sec.addEventListener('pointermove', (e) => {
        const r = sec.getBoundingClientRect();
        S.mx = ((e.clientX - r.left) / r.width - 0.5) * 2; S.my = ((e.clientY - r.top) / r.height - 0.5) * 2;
      }, { passive: true });
    }
    if (!hasGSAP || reduceMotion) return;
    ScrollTrigger.create({
      trigger: sec, start: 'top top', end: () => '+=' + Math.round(window.innerHeight * (isMobile() ? 4.6 : 5.4)),
      pin: true, anticipatePin: 1, invalidateOnRefresh: true,
      onUpdate: (self) => {
        const p = self.progress;
        S.target = p;
        let idx = 0;
        for (let i = 0; i < marks.length; i++) if (p >= marks[i]) idx = i;
        setStep(idx, p > 0.9);
      },
    });
  }

  /* ───────────── Arranque ───────────── */
  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const loads = Promise.all([
      document.fonts.load('600 80px "Bodoni Moda"'),
      document.fonts.load('italic 500 40px "Bodoni Moda"'),
      document.fonts.load('700 40px "Geist"'),
      document.fonts.load('500 20px "Geist Mono"'),
    ]);
    return Promise.race([loads, new Promise((r) => setTimeout(r, 3500))]);
  }
  const pageLoad = () => new Promise((r) => { if (document.readyState === 'complete') r(); else window.addEventListener('load', r, { once: true }); });

  function main() {
    root.classList.remove('no-js');
    const fonts = fontsReady();
    initLoader([fonts, pageLoad(), heroReady]);

    safe('whatsapp', initWhatsApp);
    safe('scroll', initScroll);
    safe('nav', initNav);
    safe('reveals', initReveals);
    safe('counters', initCounters);
    safe('hero-layout', initHeroLayout);
    safe('hero-intro', initHeroIntro);
    safe('ticker', initTicker);
    safe('manifest', initManifest);
    safe('portal', initPortal);
    safe('moments', initMoments);
    safe('anatomy', initAnatomy);
    safe('collections', initCollections);
    safe('spy', initSpy);
    safe('plan', initPlan);
    safe('flow', initFlow);
    safe('catalog', initCatalog);
    safe('accordions', initAccordions);
    safe('form', initForm);
    safe('pointer', initPointerFx);
    safe('chrome', initChrome);

    // El reloj del hero se construye cuando ya están las tipografías (las usa en la esfera)
    fonts.then(() => setTimeout(() => safe('hero3d', () => initHero3D().catch((err) => { console.error('[DW Wach] hero3d', err); root.classList.add('no-webgl'); resolveHero(); })) , 60));
    setTimeout(resolveHero, 8000); // seguro anti-bloqueo del preloader

    if (hasGSAP) {
      window.addEventListener('load', () => { if (ScrollTrigger.sort) ScrollTrigger.sort(); ScrollTrigger.refresh(); });
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();
})();
