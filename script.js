/**
 * Cadencia · script.js (un solo archivo)
 * Orden: 1) configuración  2) cookies y consentimiento  3) menú, animaciones, semana tipo  4) formularios  5) navegación entre vistas.
 * La configuración de integraciones (endpoint de formularios, categorías de cookies) está justo debajo.
 */

/* ================= 1 · CONFIGURACIÓN ================= */
/**
 * Configuración de Cadencia (única fuente para integraciones).
 * Se carga antes que el resto de los scripts.
 */
window.CADENCIA_CONFIG = {
  /* ------------------------------------------------------------------
   * FORMULARIOS
   * endpoint: URL que recibirá el JSON de cada formulario (POST).
   *   - Vacío ("")  → modo demostración: se valida y se muestra el resultado,
   *     pero NO se envía ni se guarda nada.
   *   - Con URL     → se envía el formulario con fetch(). Debe ser un backend propio
   *     o un servicio de formularios (p. ej. Formspree, Getform, un endpoint serverless)
   *     que guarde el registro de consentimientos incluido en "consents".
   * ------------------------------------------------------------------ */
  forms: {
    endpoint: ''
  },

  /* ------------------------------------------------------------------
   * CONSENTIMIENTO DE COOKIES
   * categories: tecnologías OPCIONALES que el sitio realmente usa.
   *   - Array vacío → el sitio no usa nada opcional: no se muestra banner
   *     (mostrarlo sin necesidad sería un "banner de relleno").
   *   - Para activar analítica, añade una categoría. El script NO se carga hasta que la
   *     persona la acepta, y deja de cargarse si la rechaza o la retira.
   *
   * Ejemplo (descomenta y adapta; luego actualiza cookies.html con las cookies reales):
   *
   * categories: [
   *   {
   *     id: 'analytics',
   *     label: 'Analítica',
   *     description: 'Nos ayuda a entender qué páginas se visitan para mejorar el sitio.',
   *     scripts: [
   *       { src: 'https://plausible.io/js/script.js', attrs: { defer: '', 'data-domain': 'tudominio.cl' } }
   *     ]
   *   }
   * ]
   * ------------------------------------------------------------------ */
  consent: {
    storageKey: 'cadencia.consent.v1',
    maxAgeDays: 180,
    categories: []
  }
};

/* ================= 2 · COOKIES Y CONSENTIMIENTO ================= */
/**
 * Gestor de consentimiento de cookies/tecnologías opcionales.
 *
 * Principios:
 *  - Nada opcional se carga antes de que la persona lo acepte.
 *  - Aceptar y rechazar tienen el mismo peso visual; "Configurar" permite elegir por categoría.
 *  - Las casillas de cada categoría parten desmarcadas.
 *  - Retirar el consentimiento es tan fácil como darlo (enlace "Preferencias de cookies" en el pie).
 *  - Si el sitio no declara categorías opcionales (config.js), no se muestra banner y no se guarda nada.
 *
 * API pública: window.CadenciaConsent = { open(), openDemo(), getState() }
 */
(function () {
  'use strict';

  var CFG = (window.CADENCIA_CONFIG && window.CADENCIA_CONFIG.consent) || { categories: [], storageKey: 'cadencia.consent.v1', maxAgeDays: 180 };
  var KEY = CFG.storageKey;
  var CATS = Array.isArray(CFG.categories) ? CFG.categories : [];
  var VERSION = (document.querySelector('meta[name="policy-version"]') || {}).content || '1';

  var DEMO_CATS = [
    { id: 'analytics', label: 'Analítica (ejemplo)', description: 'Ejemplo ilustrativo: medir qué páginas se visitan para mejorar el sitio. No existe en este sitio.' },
    { id: 'marketing', label: 'Publicidad y redes (ejemplo)', description: 'Ejemplo ilustrativo: medir campañas y mostrar anuncios relevantes. No existe en este sitio.' }
  ];

  var banner, dialog, list, emptyNote, demoNote, actions, statusEl;
  var demoMode = false;
  var lastFocus = null;
  var loaded = {};

  /* ---------- almacenamiento seguro ---------- */
  function readState() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      var age = (Date.now() - new Date(s.ts).getTime()) / 86400000;
      if (!s || s.v !== VERSION || age > CFG.maxAgeDays || typeof s.choices !== 'object') return null;
      return s;
    } catch (e) { return null; }
  }
  function writeState(choices) {
    var s = { v: VERSION, ts: new Date().toISOString(), choices: choices };
    try { window.localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* sin almacenamiento: se pregunta en cada visita */ }
    return s;
  }

  /* ---------- carga condicionada de scripts ---------- */
  function loadCategory(cat) {
    if (loaded[cat.id] || !cat.scripts) return;
    loaded[cat.id] = true;
    cat.scripts.forEach(function (def) {
      var el = document.createElement('script');
      el.src = def.src;
      Object.keys(def.attrs || {}).forEach(function (k) { el.setAttribute(k, def.attrs[k]); });
      document.head.appendChild(el);
    });
  }
  function applyChoices(choices) {
    CATS.forEach(function (c) { if (choices[c.id]) loadCategory(c); });
  }

  /* ---------- interfaz ---------- */
  function cache() {
    banner = document.getElementById('cc-banner');
    dialog = document.getElementById('cc-dialog');
    list = document.getElementById('cc-list');
    emptyNote = document.getElementById('cc-empty');
    demoNote = document.getElementById('cc-demo-note');
    actions = document.getElementById('cc-actions');
    statusEl = document.getElementById('cc-status');
  }

  function renderList(cats, current) {
    list.innerHTML = '';
    var base = document.createElement('div');
    base.className = 'cc-item';
    base.innerHTML = '<div><h3>Esenciales</h3><p>Necesarias para que el sitio funcione y para recordar tu elección sobre cookies. Siempre activas.</p></div>' +
      '<label class="cc-switch"><span class="sr-only">Cookies esenciales: siempre activas</span><input type="checkbox" checked disabled><span aria-hidden="true"></span></label>';
    list.appendChild(base);
    cats.forEach(function (c) {
      var row = document.createElement('div');
      row.className = 'cc-item';
      var id = 'cc-cat-' + c.id;
      row.innerHTML = '<div><h3></h3><p></p></div><label class="cc-switch" for="' + id + '"><span class="sr-only"></span><input type="checkbox" id="' + id + '" data-cat="' + c.id + '"><span aria-hidden="true"></span></label>';
      row.querySelector('h3').textContent = c.label;
      row.querySelector('p').textContent = c.description;
      row.querySelector('.sr-only').textContent = 'Permitir: ' + c.label;
      var input = row.querySelector('input');
      input.checked = !!(current && current[c.id]);      // por defecto desmarcada
      list.appendChild(row);
    });
  }

  function getDialogChoices(cats) {
    var out = {};
    cats.forEach(function (c) {
      var el = document.getElementById('cc-cat-' + c.id);
      out[c.id] = !!(el && el.checked);
    });
    return out;
  }

  function showBanner(show) { if (banner) banner.hidden = !show; }

  function openDialog(cats, isDemo) {
    cache();
    if (!dialog) return;
    demoMode = !!isDemo;
    lastFocus = document.activeElement;
    var state = readState();
    emptyNote.hidden = cats.length > 0;
    demoNote.hidden = !demoMode;
    actions.hidden = cats.length === 0;
    statusEl.textContent = '';
    renderList(cats, demoMode ? null : state && state.choices);
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
    var first = dialog.querySelector('input:not([disabled])') || dialog.querySelector('[data-cc="close"]');
    if (first) first.focus();
  }

  function closeDialog() {
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function commit(choices, cats) {
    if (demoMode) {
      statusEl.textContent = 'Modo demostración: no se guardó ni se activó nada.';
      showBanner(false);
      return;
    }
    var before = readState();
    var hadOptional = before && cats.some(function (c) { return before.choices[c.id]; });
    writeState(choices);
    showBanner(false);
    var withdrew = hadOptional && cats.some(function (c) { return before.choices[c.id] && !choices[c.id]; });
    applyChoices(choices);
    if (withdrew) {
      statusEl.textContent = 'Preferencias guardadas. Recargamos la página para desactivar lo que retiraste…';
      setTimeout(function () { window.location.reload(); }, 900);
    } else {
      statusEl.textContent = 'Preferencias guardadas.';
      setTimeout(closeDialog, 700);
    }
  }

  function setAll(value, cats) {
    var choices = {};
    cats.forEach(function (c) { choices[c.id] = value; });
    commit(choices, cats);
  }

  function currentCats() { return demoMode ? DEMO_CATS : CATS; }

  function onClick(e) {
    var btn = e.target.closest('[data-cc]');
    if (!btn) return;
    var action = btn.getAttribute('data-cc');
    var cats = currentCats();
    if (action === 'accept' || action === 'accept-dialog') setAll(true, cats);
    else if (action === 'reject' || action === 'reject-dialog') setAll(false, cats);
    else if (action === 'configure') { showBanner(false); openDialog(cats, demoMode); }
    else if (action === 'save') commit(getDialogChoices(cats), cats);
    else if (action === 'close') closeDialog();
  }

  function init() {
    cache();
    if (!banner || !dialog) return;
    document.addEventListener('click', onClick);
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-cookie-settings]');
      if (t) { e.preventDefault(); api.open(); }
      var d = e.target.closest('[data-cookie-demo]');
      if (d) { e.preventDefault(); api.openDemo(); }
    });
    dialog.addEventListener('click', function (e) { if (e.target === dialog) closeDialog(); });
    dialog.addEventListener('close', function () { if (lastFocus && lastFocus.focus) lastFocus.focus(); });

    if (CATS.length === 0) { showBanner(false); updateStatusBlocks(); return; }
    var state = readState();
    if (state) { applyChoices(state.choices); showBanner(false); }
    else showBanner(true);
    updateStatusBlocks();
  }

  /* bloque informativo de cookies.html: muestra el estado real */
  function updateStatusBlocks() {
    var el = document.getElementById('cookie-state-text');
    if (!el) return;
    if (CATS.length === 0) { el.textContent = 'Estado actual: este sitio no utiliza cookies ni almacenamiento opcional, así que no hay nada que aceptar o rechazar.'; return; }
    var s = readState();
    el.textContent = s ? 'Estado actual: ya registraste tus preferencias. Puedes cambiarlas cuando quieras.' : 'Estado actual: aún no has elegido. Las cookies opcionales permanecen desactivadas.';
  }

  var api = {
    open: function () { demoMode = false; showBanner(false); openDialog(CATS, false); },
    openDemo: function () { demoMode = true; showBanner(false); openDialog(DEMO_CATS, true); },
    getState: function () { return readState(); }
  };
  window.CadenciaConsent = api;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

/* ================= 3 · INTERACCIONES GENERALES ================= */
/**
 * Interacciones generales: menú móvil, animaciones de entrada y semana tipo del inicio.
 * Sin dependencias. Todo el contenido es accesible también sin JavaScript.
 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- menú móvil ---------- */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (toggle && nav) {
    var mq = window.matchMedia('(max-width: 899px)');
    var setOpen = function (open) {
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
    };
    toggle.addEventListener('click', function () { setOpen(toggle.getAttribute('aria-expanded') !== 'true'); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') { setOpen(false); toggle.focus(); }
    });
    var onChange = function () { if (!mq.matches) setOpen(false); };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
    /* En móvil el menú cerrado no debe ser alcanzable con teclado: visibility lo gestiona el CSS. */
  }

  /* ---------- animación de entrada ---------- */
  var items = [].slice.call(document.querySelectorAll('.reveal'));
  if (items.length) {
    if (reduceMotion || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('in'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
      items.forEach(function (el, i) {
        el.style.setProperty('--d', (i % 4) * 70 + 'ms');
        io.observe(el);
      });
    }
  }


  /* ---------- imágenes que no cargan: se conserva el marco, sin icono roto ---------- */
  var failed = function (img) {
    var fig = img.closest('.media');
    if (fig) fig.classList.add('media--empty');
    img.remove();
  };
  [].slice.call(document.querySelectorAll('.media img')).forEach(function (img) {
    if (img.complete && img.naturalWidth === 0) failed(img);
    else img.addEventListener('error', function () { failed(img); }, { once: true });
  });

  /* ---------- semana tipo (inicio) ---------- */
  var week = document.querySelector('[data-week]');
  if (week) {
    var days = [].slice.call(week.querySelectorAll('.day'));
    var out = {
      day: week.querySelector('[data-week-day]'),
      name: week.querySelector('[data-week-name]'),
      text: week.querySelector('[data-week-text]')
    };
    var select = function (btn) {
      days.forEach(function (d) { d.setAttribute('aria-pressed', d === btn ? 'true' : 'false'); });
      out.day.textContent = btn.getAttribute('data-day');
      out.name.textContent = btn.getAttribute('data-title');
      out.text.textContent = btn.getAttribute('data-detail');
    };
    days.forEach(function (d) {
      d.addEventListener('click', function () { select(d); });
      d.addEventListener('mouseenter', function () { if (window.matchMedia('(hover: hover)').matches) select(d); });
      d.addEventListener('focus', function () { select(d); });
    });
    if (days.length) select(days[0]);
  }
})();

/* ================= 4 · FORMULARIOS ================= */
/**
 * Formularios de Cadencia: validación accesible, consentimientos separados y envío configurable.
 *
 * - Cada formulario es <form data-form="solicitud|contacto" novalidate>.
 * - Los campos obligatorios usan [data-required]; los mensajes de error están en .field__error.
 * - El envío real depende de CADENCIA_CONFIG.forms.endpoint. Sin endpoint = modo demostración
 *   (se valida, pero NO se envía ni se guarda nada, y se le dice claramente a la persona).
 * - Los consentimientos se incluyen en el JSON con fecha, versión de la política y el texto mostrado,
 *   para que el backend los registre. El navegador no guarda nada de lo que se escribe.
 */
(function () {
  'use strict';

  var CFG = (window.CADENCIA_CONFIG && window.CADENCIA_CONFIG.forms) || { endpoint: '' };
  var POLICY_VERSION = (document.querySelector('meta[name="policy-version"]') || {}).content || '';

  var MESSAGES = {
    required: 'Este campo es obligatorio.',
    email: 'Escribe un correo válido, por ejemplo nombre@dominio.cl.',
    phone: 'Escribe un teléfono válido (solo números, espacios, + o guiones).',
    minlength: function (n) { return 'Escribe al menos ' + n + ' caracteres.'; },
    consent: 'Debes marcar esta casilla para poder enviar el formulario.',
    choice: 'Elige una opción.',
    health: 'Escribe la información que quieres compartir o desmarca el consentimiento.'
  };

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var PHONE_RE = /^[+()\-\s\d]{8,18}$/;

  /* Parámetros de la URL: #/solicitar?plan=cadencia */
  function routeQuery() {
    var h = window.location.hash, i = h.indexOf('?');
    try { return new URLSearchParams(i > -1 ? h.slice(i + 1) : ''); } catch (e) { return { get: function () { return null; } }; }
  }

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return [].slice.call((root || document).querySelectorAll(sel)); }

  function fieldWrap(el) { return el.closest('.field') || el.closest('.check-group') || el.parentElement; }
  function errorEl(el) {
    var w = fieldWrap(el);
    return w ? w.querySelector('.field__error') : null;
  }

  function setError(el, msg) {
    var err = errorEl(el);
    var wrap = fieldWrap(el);
    if (msg) {
      el.setAttribute('aria-invalid', 'true');
      if (wrap) wrap.classList.add('has-error');
      if (err) { err.textContent = msg; if (!el.getAttribute('aria-describedby') || el.getAttribute('aria-describedby').indexOf(err.id) === -1) { el.setAttribute('aria-describedby', ((el.getAttribute('aria-describedby') || '') + ' ' + err.id).trim()); } }
    } else {
      el.removeAttribute('aria-invalid');
      if (wrap) wrap.classList.remove('has-error');
      if (err) err.textContent = '';
    }
  }

  function validateField(el) {
    if (el.disabled) { setError(el, ''); return ''; }
    var type = el.type;
    var value = (el.value || '').trim();
    var msg = '';

    if (type === 'checkbox') {
      if (el.hasAttribute('data-required') && !el.checked) msg = MESSAGES.consent;
    } else if (type === 'radio') {
      var group = qsa('input[type="radio"][name="' + el.name + '"]', el.form);
      if (el.hasAttribute('data-required') && !group.some(function (r) { return r.checked; })) msg = MESSAGES.choice;
      el = group[0];
    } else if (el.hasAttribute('data-required') && !value) {
      msg = el.tagName === 'SELECT' ? MESSAGES.choice : MESSAGES.required;
    } else if (value) {
      if (type === 'email' && !EMAIL_RE.test(value)) msg = MESSAGES.email;
      else if (type === 'tel' && !PHONE_RE.test(value)) msg = MESSAGES.phone;
      else if (el.dataset.minlength && value.length < Number(el.dataset.minlength)) msg = MESSAGES.minlength(el.dataset.minlength);
    }
    setError(el, msg);
    return msg;
  }

  function initForm(form) {
    var kind = form.getAttribute('data-form');
    var status = qs('.form-status', form);
    var submit = qs('[type="submit"]', form);
    status.addEventListener('click', function (e) {
      var link = e.target.closest ? e.target.closest('a[data-focus]') : null;
      if (!link) return;
      e.preventDefault();
      var target = document.getElementById(link.getAttribute('data-focus'));
      if (target) target.focus();
    });

    /* bloque de salud: la caja de texto solo se habilita con consentimiento explícito */
    var healthConsent = qs('[name="consentSalud"]', form);
    var healthText = qs('[name="infoSalud"]', form);
    if (healthConsent && healthText) {
      var syncHealth = function () {
        healthText.disabled = !healthConsent.checked;
        if (!healthConsent.checked) { healthText.value = ''; setError(healthText, ''); }
        healthText.setAttribute('aria-disabled', String(!healthConsent.checked));
      };
      healthConsent.addEventListener('change', syncHealth);
      syncHealth();
    }

    /* plan (?plan=inicio|cadencia|hibrido) y motivo (?motivo=...) preseleccionados desde el hash de la URL */
    var applyQuery = function () {
      var params = routeQuery();
      var planSel = qs('[name="plan"]', form);
      var p = params.get('plan');
      if (planSel && p && qsa('option', planSel).some(function (o) { return o.value === p; })) planSel.value = p;
      var motivo = qs('[name="motivo"]', form);
      var m = params.get('motivo');
      if (motivo && m && qsa('option', motivo).some(function (o) { return o.value === m; })) motivo.value = m;
    };
    applyQuery();
    document.addEventListener('cadencia:route', applyQuery);

    qsa('input, select, textarea', form).forEach(function (el) {
      var ev = (el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT') ? 'change' : 'blur';
      el.addEventListener(ev, function () { validateField(el); });
      if (ev === 'blur') el.addEventListener('input', function () { if (el.getAttribute('aria-invalid') === 'true') validateField(el); });
    });

    function showStatus(type, html) {
      status.className = 'form-status form-status--' + type + ' is-visible';
      status.innerHTML = html;
      status.setAttribute('tabindex', '-1');
      status.focus({ preventScroll: false });
    }

    function collect() {
      var fd = new FormData(form);
      var data = {};
      fd.forEach(function (v, k) {
        if (k === 'website' || k.indexOf('consent') === 0) return; // honeypot y casillas se tratan aparte
        data[k] = typeof v === 'string' ? v.trim() : v;
      });
      var now = new Date().toISOString();
      var consents = {};
      qsa('input[type="checkbox"][name^="consent"]', form).forEach(function (c) {
        var label = qs('.check__text', c.closest('.check'));
        consents[c.name] = {
          accepted: c.checked,
          text: label ? label.textContent.replace(/\s+/g, ' ').trim() : '',
          timestamp: now,
          policyVersion: POLICY_VERSION
        };
      });
      return { form: kind, submittedAt: now, page: ((document.querySelector('.view.is-active') || {}).dataset || {}).view || '', data: data, consents: consents };
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      status.className = 'form-status';

      var fields = qsa('input, select, textarea', form).filter(function (el) { return el.type !== 'submit' && el.type !== 'hidden' && !el.closest('.hp'); });
      var seen = {};
      var errors = [];
      fields.forEach(function (el) {
        if (el.type === 'radio') { if (seen[el.name]) return; seen[el.name] = true; }
        var msg = validateField(el);
        if (msg) errors.push({ el: el.type === 'radio' ? qsa('input[type="radio"][name="' + el.name + '"]', form)[0] : el, msg: msg });
      });

      /* si marcó el consentimiento de salud, el texto no puede estar vacío */
      if (healthConsent && healthConsent.checked && healthText && !healthText.value.trim()) {
        setError(healthText, MESSAGES.health);
        errors.push({ el: healthText, msg: MESSAGES.health });
      }

      if (errors.length) {
        var items = errors.map(function (er) {
          var lab = fieldWrap(er.el) && qs('.field__label, legend', fieldWrap(er.el));
          var name = lab ? lab.firstChild.textContent.replace('*', '').trim() : er.el.name;
          if (er.el.type === 'checkbox') name = 'Casilla obligatoria';
          return '<li><a href="#" data-focus="' + er.el.id + '">' + name + '</a>: ' + er.msg + '</li>';
        }).join('');
        showStatus('error', '<strong>Revisa ' + (errors.length === 1 ? 'un campo' : errors.length + ' campos') + ' antes de enviar</strong><ul>' + items + '</ul>');
        errors[0].el.focus();
        return;
      }

      /* trampa antispam: si se rellena, se descarta en silencio */
      if (qs('[name="website"]', form) && qs('[name="website"]', form).value) { showStatus('ok', '<strong>Listo.</strong> Hemos recibido tu mensaje.'); form.reset(); return; }

      var payload = collect();
      submit.disabled = true;
      var original = submit.textContent;
      submit.textContent = 'Enviando…';

      var done = function () { submit.disabled = false; submit.textContent = original; };

      if (!CFG.endpoint) {
        /* MODO DEMOSTRACIÓN: no se envía nada. */
        window.setTimeout(function () {
          done();
          if (window.console && console.info) console.info('[Cadencia · modo demostración] Esto es lo que se enviaría al backend:', payload);
          showStatus('demo', '<strong>Formulario validado correctamente (modo demostración).</strong> Este sitio aún no tiene un servicio de envío conectado, así que <u>no se envió ni se guardó nada</u>. Cuando se configure el servicio, ' +
            (kind === 'solicitud' ? 'te responderemos en un máximo de ' + (document.body.getAttribute('data-answer-days') || '2') + ' días hábiles.' : 'responderemos tu consulta por el medio que indicaste.'));
          form.reset();
          if (healthConsent) healthConsent.dispatchEvent(new Event('change'));
        }, 500);
        return;
      }

      fetch(CFG.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(payload) })
        .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res; })
        .then(function () {
          done();
          showStatus('ok', '<strong>Gracias, recibimos tu ' + (kind === 'solicitud' ? 'solicitud' : 'consulta') + '.</strong> ' +
            (kind === 'solicitud' ? 'Te responderemos por correo en un máximo de ' + (document.body.getAttribute('data-answer-days') || '2') + ' días hábiles.' : 'Te responderemos por correo.'));
          form.reset();
          if (healthConsent) healthConsent.dispatchEvent(new Event('change'));
        })
        .catch(function () {
          done();
          showStatus('error', '<strong>No pudimos enviar el formulario.</strong> Revisa tu conexión e inténtalo de nuevo. Tus datos siguen en el formulario. Si el problema continúa, escríbenos a <a href="mailto:' + (form.getAttribute('data-fallback-email') || '') + '">' + (form.getAttribute('data-fallback-email') || 'nuestro correo') + '</a>.');
        });
    });
  }

  qsa('form[data-form]').forEach(initForm);
})();

/* ================= 5 · NAVEGACIÓN ENTRE VISTAS ================= */
/**
 * Navegación entre vistas (reemplaza a las páginas separadas).
 * Rutas: #/  ·  #/servicios  ·  #/privacidad/salud (ancla)  ·  #/solicitar?plan=cadencia
 */
(function () {
  'use strict';

  var views = {};
  [].slice.call(document.querySelectorAll('.view')).forEach(function (v) { views[v.getAttribute('data-view')] = v; });
  var metaDesc = document.querySelector('meta[name="description"]');
  var metaRobots = document.querySelector('meta[name="robots"]');
  var main = document.getElementById('contenido');
  var navLinks = [].slice.call(document.querySelectorAll('.nav__list a[href^="#/"]'));
  var current = null;

  function parse() {
    var h = window.location.hash;
    if (h === '' || h === '#') return { name: 'inicio', anchor: '', query: '' };   // sin hash = portada
    if (h.indexOf('#/') !== 0) return null;
    var raw = h.slice(2), query = '', i = raw.indexOf('?');
    if (i > -1) { query = raw.slice(i + 1); raw = raw.slice(0, i); }
    var parts = raw.split('/');
    var dec = function (s) { try { return decodeURIComponent(s); } catch (e) { return s; } };
    return { name: dec(parts[0] || 'inicio'), anchor: parts[1] ? dec(parts[1]) : '', query: query };
  }

  function go() {
    var r = parse();
    if (!r) { if (current) return; r = { name: 'inicio', anchor: '', query: '' }; }   // hash que no es una ruta (p. ej. #contenido)
    var name = views[r.name] ? r.name : '404';
    var view = views[name];
    var changed = name !== current;

    if (changed) {
      Object.keys(views).forEach(function (k) { views[k].classList.toggle('is-active', k === name); });
      document.title = view.getAttribute('data-title');
      if (metaDesc) metaDesc.setAttribute('content', view.getAttribute('data-desc'));
      if (metaRobots) metaRobots.setAttribute('content', view.getAttribute('data-robots'));
      document.body.classList.toggle('page-home', name === 'inicio');
      navLinks.forEach(function (a) {
        if (a.getAttribute('href') === '#/' + name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      });
    }

    var target = r.anchor && (document.getElementById(r.anchor) || document.getElementById(name + '-' + r.anchor));
    if (target) {
      target.scrollIntoView();
    } else if (changed) {
      window.scrollTo(0, 0);
    }
    if (changed && current !== null && main) main.focus({ preventScroll: true });
    current = name;
    document.dispatchEvent(new CustomEvent('cadencia:route', { detail: { name: name, query: r.query } }));
  }

  /* Enlace a la vista en la que ya estás: sube al inicio, como al recargar la página original */
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (href === '#contenido') {
      e.preventDefault();
      if (main) main.focus();
    } else if (href.indexOf('#/') === 0 && (href === window.location.hash || (href === '#/' && !window.location.hash))) {
      e.preventDefault();
      window.scrollTo(0, 0);
    }
  });

  window.addEventListener('hashchange', go);
  go();
})();