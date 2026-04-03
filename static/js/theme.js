(function () {
  'use strict';

  function apply(saved) {
    var theme = saved || localStorage.getItem('civic-theme') || 'light';
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
      btn.textContent = theme === 'light' ? '◐' : '◑';
      btn.title = theme === 'light' ? 'Switch to dark metallic' : 'Switch to light metallic';
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    apply();
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
        var next = cur === 'light' ? 'dark' : 'light';
        localStorage.setItem('civic-theme', next);
        apply(next);
      });
    });
  });
})();
