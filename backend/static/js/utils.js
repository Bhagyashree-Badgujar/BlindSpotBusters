/**
 * CivicAlert — fetch API (no external HTTP libs), UI helpers
 */
(function () {
  'use strict';

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(^|; )' + name.replace(/([$?*|{}\]\\^])/g, '\\$1') + '=([^;]*)'));
    return m ? decodeURIComponent(m[2]) : '';
  }

  const API = {
    async request(url, options) {
      const opts = Object.assign({ credentials: 'include' }, options || {});
      const headers = Object.assign({}, opts.headers || {});
      if (opts.body && !(opts.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
      }
      const token = getCookie('csrftoken');
      if (token) headers['X-CSRFToken'] = token;
      opts.headers = headers;
      const res = await fetch(url, opts);
      const text = await res.text();
      let data = {};
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }
      }
      if (!res.ok) {
        const err = new Error(data.error || data.detail || res.statusText || 'Request failed');
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    },
    get(url) {
      return this.request(url, { method: 'GET' });
    },
    post(url, body) {
      const o = { method: 'POST' };
      if (body instanceof FormData) o.body = body;
      else o.body = body != null ? JSON.stringify(body) : '{}';
      return this.request(url, o);
    },
    patch(url, body) {
      return this.request(url, { method: 'PATCH', body: JSON.stringify(body != null ? body : {}) });
    },
  };

  const Validator = {
    showError(inputEl, msg) {
      const id = inputEl.id;
      const err = document.getElementById('err-' + id) || inputEl.parentElement.querySelector('.form-error');
      if (err) {
        err.textContent = msg;
        err.classList.add('show');
      }
      inputEl.style.borderColor = 'var(--danger)';
    },
    clearErrors(form) {
      form.querySelectorAll('.form-error').forEach(function (el) {
        el.textContent = '';
        el.classList.remove('show');
      });
      form.querySelectorAll('.form-input, .form-textarea').forEach(function (el) {
        el.style.borderColor = '';
      });
    },
    email(inputEl) {
      const v = (inputEl.value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        Validator.showError(inputEl, 'Enter a valid email address.');
        return false;
      }
      return true;
    },
    passwordMatch(passEl, confirmEl) {
      if (passEl.value !== confirmEl.value) {
        Validator.showError(confirmEl, 'Passwords do not match.');
        return false;
      }
      return true;
    },
  };

  const Toast = {
    show(message, type) {
      type = type || 'info';
      let c = document.querySelector('.toast-container');
      if (!c) {
        c = document.createElement('div');
        c.className = 'toast-container';
        document.body.appendChild(c);
      }
      const t = document.createElement('div');
      t.className = 'toast ' + type;
      t.textContent = message;
      c.appendChild(t);
      setTimeout(function () {
        t.classList.add('hide');
        setTimeout(function () {
          t.remove();
        }, 320);
      }, 3200);
    },
  };

  const Modal = {
    open(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.add('open');
      el.querySelectorAll('.modal-close').forEach(function (btn) {
        btn.onclick = function () {
          Modal.close(id);
        };
      });
    },
    close(id) {
      const el = document.getElementById(id);
      if (el) el.classList.remove('open');
    },
  };

  document.addEventListener('click', function (e) {
    if (e.target.classList.contains('modal-close')) {
      const overlay = e.target.closest('.modal-overlay');
      if (overlay) overlay.classList.remove('open');
    }
  });

  function renderPagination(container, total, perPage, page, onPage) {
    if (!container) return;
    const pages = Math.max(1, Math.ceil(total / perPage));
    page = Math.min(page, pages);
    let html = '';
    for (let p = 1; p <= pages; p++) {
      html +=
        '<button type="button" class="page-btn' +
        (p === page ? ' active' : '') +
        '" data-p="' +
        p +
        '">' +
        p +
        '</button>';
    }
    container.innerHTML = html || '';
    container.querySelectorAll('.page-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        onPage(parseInt(btn.getAttribute('data-p'), 10));
      });
    });
  }

  function statusBadge(status) {
    const map = {
      pending: '<span class="badge badge-pending">Pending</span>',
      in_progress: '<span class="badge badge-progress">In Progress</span>',
      resolved: '<span class="badge badge-resolved">Resolved</span>',
    };
    return map[status] || '<span class="badge badge-blue">' + (status || '') + '</span>';
  }

  function calcImpact(votes, recent) {
    const v = votes || 0;
    const r = recent || 0;
    return v * 2 + r * 3;
  }

  function initImgSlider(wrap) {
    if (!wrap) return;
    const track = wrap.querySelector('.img-slider-track');
    const dots = wrap.querySelectorAll('.img-dot');
    if (!track || !dots.length) return;
    let i = 0;
    function go(n) {
      i = n;
      track.style.transform = 'translateX(-' + i * 100 + '%)';
      dots.forEach(function (d, j) {
        d.classList.toggle('active', j === i);
      });
    }
    dots.forEach(function (d, j) {
      d.addEventListener('click', function () {
        go(j);
      });
    });
    go(0);
  }

  function initFileUpload(area) {
    if (!area) return;
    const input = area.querySelector('input[type=file]');
    const preview = area.querySelector('.file-preview');
    const img = preview && preview.querySelector('img');
    area.addEventListener('click', function () {
      input && input.click();
    });
    area.addEventListener('dragover', function (e) {
      e.preventDefault();
      area.classList.add('drag');
    });
    area.addEventListener('dragleave', function () {
      area.classList.remove('drag');
    });
    area.addEventListener('drop', function (e) {
      e.preventDefault();
      area.classList.remove('drag');
      if (e.dataTransfer.files[0]) {
        input.files = e.dataTransfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    input &&
      input.addEventListener('change', function () {
        const f = input.files[0];
        if (f && img) {
          img.src = URL.createObjectURL(f);
          preview.classList.add('show');
        }
      });
  }

  function detectLocation(latEl, lngEl, labelEl) {
    if (!navigator.geolocation) {
      Toast.show('Geolocation is not supported.', 'error');
      return;
    }
    Toast.show('Detecting location…', 'info');
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        const lat = pos.coords.latitude.toFixed(6);
        const lng = pos.coords.longitude.toFixed(6);
        if (latEl) latEl.value = lat;
        if (lngEl) lngEl.value = lng;
        if (labelEl) labelEl.value = 'GPS: ' + lat + ', ' + lng;
        Toast.show('Location captured.', 'success');
      },
      function () {
        Toast.show('Could not get location. Enter coordinates manually.', 'warn');
      }
    );
  }

  window.API = API;
  window.Validator = Validator;
  window.Toast = Toast;
  window.Modal = Modal;
  window.renderPagination = renderPagination;
  window.statusBadge = statusBadge;
  window.calcImpact = calcImpact;
  window.initImgSlider = initImgSlider;
  window.initFileUpload = initFileUpload;
  window.detectLocation = detectLocation;

  /* ---------- Theme (dark mode) ---------- */
  function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.body.classList.toggle('dark', isDark);
    try { localStorage.setItem('civic_theme', theme); } catch {}

    const btn = document.getElementById('theme-toggle');
    if (btn) {
      const label = btn.querySelector('.theme-toggle-label');
      if (label) label.textContent = isDark ? 'Light' : 'Dark';
    }
  }

  function initThemeToggle() {
    // Load saved theme; default to system preference.
    let saved = null;
    try { saved = localStorage.getItem('civic_theme'); } catch {}
    if (!saved) {
      saved = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    applyTheme(saved);

    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const next = document.body.classList.contains('dark') ? 'light' : 'dark';
      applyTheme(next);
    });
  }

  document.addEventListener('DOMContentLoaded', initThemeToggle);

  function initHamburger() {
    const btn = document.getElementById('hamburger');
    const nav = document.getElementById('main-nav');
    if (!btn || !nav) return;
    if (btn.dataset.civicHamburgerInit === '1') return;
    btn.dataset.civicHamburgerInit = '1';

    btn.addEventListener('click', () => {
      nav.style.display = nav.style.display === 'flex' ? 'none' : 'flex';
      nav.style.flexDirection = 'column';
      nav.style.position = 'absolute';
      nav.style.top = '64px';
      nav.style.right = '16px';
      nav.style.background = 'var(--surface)';
      nav.style.border = '1px solid var(--border)';
      nav.style.borderRadius = 'var(--radius)';
      nav.style.padding = '8px';
      nav.style.boxShadow = 'var(--shadow-md)';
      nav.style.zIndex = '600';
    });
  }

  document.addEventListener('DOMContentLoaded', initHamburger);

  /** Full map page (map-view.html): call after Leaflet + MarkerCluster scripts */
  window.initMapViewPage = function () {
    const mapEl = document.getElementById('map');
    if (!mapEl || typeof L === 'undefined') return;

    const map = L.map('map').setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(map);

    const cluster =
      typeof L.markerClusterGroup === 'function'
        ? L.markerClusterGroup({ maxClusterRadius: 55 })
        : L.layerGroup();
    map.addLayer(cluster);

    let allIssues = [];

    function esc(s) {
      const d = document.createElement('div');
      d.appendChild(document.createTextNode(s || ''));
      return d.innerHTML;
    }

    function draw(filterStatus) {
      cluster.clearLayers();

      const colorMap = {
        high: '#ef4444',
        medium: '#f59e0b',
        resolved: '#10b981',
      };
      const bounds = [];
      allIssues.forEach(function (issue) {
        if (filterStatus && issue.status !== filterStatus) return;
        if (issue.lat == null || issue.lng == null) return;
        const color =
          issue.status === 'resolved'
            ? colorMap.resolved
            : issue.priority === 'high'
              ? colorMap.high
              : colorMap.medium;
        const icon = L.divIcon({
          html:
            '<div style="width:14px;height:14px;border-radius:50%;background:' +
            color +
            ';border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);"></div>',
          className: '',
          iconSize: [14, 14],
        });
        const m = L.marker([issue.lat, issue.lng], { icon: icon }).bindPopup(
          '<strong>' +
            esc(issue.title) +
            '</strong><br>' +
            statusBadge(issue.status) +
          '<br>Impact: ' +
          (issue.impact_score ?? calcImpact(issue.votes, issue.recent_reports)) +
          (issue.is_trending ? ' 🔥' : '') +
          '<br>' +
          esc((issue.description || '').slice(0, 120))
        );
        cluster.addLayer(m);
        bounds.push([issue.lat, issue.lng]);
      });

      if (bounds.length) {
        try {
          map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
        } catch (_) {}
      }
    }

    API.get('/api/issues/')
      .then(function (issues) {
        allIssues = Array.isArray(issues) ? issues : [];
        draw('');
      })
      .catch(function () {
        Toast.show('Could not load map data.', 'error');
      });

    document.querySelectorAll('.filter-map-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.filter-map-btn').forEach(function (b) {
          b.classList.remove('active');
        });
        btn.classList.add('active');
        draw(btn.getAttribute('data-status') || '');
      });
    });
  };
})();
