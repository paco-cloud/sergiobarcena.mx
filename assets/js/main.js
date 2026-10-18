// Interacciones derivadas de pacomendez.mx/main.js · SBJ-CODE-02
// Menú móvil (focus trap, Esc), filtros con chips, "… más", acordeón y botones de copiar.
// Sin JS: el índice está en la sidebar, las listas se ven completas y los acordeones abiertos.
document.documentElement.classList.add('js');

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  // ---------- Menú móvil ----------
  var menu = document.getElementById('menu');
  var openBtn = document.querySelector('.menu-open');
  var closeBtn = document.querySelector('.menu-close');
  function focusables() {
    return Array.prototype.slice.call(menu.querySelectorAll('a[href], button:not([disabled])'));
  }
  function openMenu() {
    menu.hidden = false;
    openBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    var active = menu.querySelector('[aria-current="page"]') || menu.querySelector('a');
    if (active) active.focus();
  }
  function closeMenu(restoreFocus) {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    openBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    if (restoreFocus) openBtn.focus();
  }
  if (menu && openBtn && closeBtn) {
    openBtn.addEventListener('click', openMenu);
    closeBtn.addEventListener('click', function () { closeMenu(true); });
    menu.addEventListener('click', function (ev) {
      if (ev.target.closest('a[href^="#"]')) closeMenu(false);
    });
    document.addEventListener('keydown', function (ev) {
      if (menu.hidden) return;
      if (ev.key === 'Escape') closeMenu(true);
      if (ev.key === 'Tab') {
        var f = focusables();
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
      }
    });
    window.matchMedia('(min-width: 1024px)').addEventListener('change', function (mq) {
      if (mq.matches) closeMenu(false);
    });
  }

  // ---------- Filtros: un chip a la vez; con "Todo" se muestran data-limit filas ----------
  document.querySelectorAll('[data-filter-for]').forEach(function (group) {
    var id = group.getAttribute('data-filter-for');
    var target = document.getElementById(id);
    if (!target) return;
    var chips = group.querySelectorAll('.chip');
    var rows = Array.prototype.slice.call(target.querySelectorAll('[data-row]'));
    var groups = target.querySelectorAll('[data-group]');
    var limit = Number(target.getAttribute('data-limit')) || 0;
    var more = document.querySelector('[data-more-for="' + id + '"]');
    var status = document.getElementById(id + '-status');
    var filter = '*';
    var expanded = false;

    function render() {
      var matches = rows.filter(function (r) {
        return filter === '*' || (' ' + r.getAttribute('data-tags') + ' ').indexOf(' ' + filter + ' ') >= 0;
      });
      var cut = limit && filter === '*' && !expanded;
      rows.forEach(function (r) { r.hidden = true; });
      matches.forEach(function (r, i) { r.hidden = cut && i >= limit; });
      groups.forEach(function (g) { g.hidden = !g.querySelector('[data-row]:not([hidden])'); });
      if (more) {
        more.hidden = !cut || matches.length <= limit;
        more.textContent = '… ' + (matches.length - limit) + ' más';
      }
      chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c.getAttribute('data-filter') === filter)); });
      if (status) status.textContent = matches.length + ' resultados';
    }
    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        filter = c.getAttribute('data-filter');
        expanded = false;
        render();
      });
    });
    if (more) {
      more.addEventListener('click', function () {
        var next = rows.filter(function (r) { return !r.hidden; }).length;
        expanded = true;
        render();
        var row = rows[next];
        if (row) { row.setAttribute('tabindex', '-1'); row.focus({ preventScroll: true }); }
      });
    }
    render();
  });

  // ---------- Acordeón (abierto sin JS) ----------
  document.querySelectorAll('.acc-btn').forEach(function (btn) {
    var panel = document.getElementById(btn.getAttribute('aria-controls'));
    var sign = btn.querySelector('.sign');
    function set(open) {
      btn.setAttribute('aria-expanded', String(open));
      panel.classList.toggle('is-open', open);
      if (sign) sign.textContent = open ? '–' : '+';
    }
    set(false);
    btn.addEventListener('click', function () { set(btn.getAttribute('aria-expanded') !== 'true'); });
  });

  // ---------- Copiar (semblanzas, citas APA) ----------
  var live = document.getElementById('copy-status');
  document.querySelectorAll('.copy').forEach(function (btn) {
    var label = btn.textContent;
    btn.addEventListener('click', function () {
      var src = btn.getAttribute('data-copy-target');
      var text = src ? document.getElementById(src).innerText.trim() : btn.getAttribute('data-copy');
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = 'Copiado ✓';
        if (live) live.textContent = 'Texto copiado al portapapeles';
        setTimeout(function () { btn.textContent = label; }, 2000);
      });
    });
  });

  // ---------- Enlaces pendientes (sin URL todavía) ----------
  document.addEventListener('click', function (ev) {
    if (ev.target.closest('a[data-pending]')) ev.preventDefault();
  });
});
