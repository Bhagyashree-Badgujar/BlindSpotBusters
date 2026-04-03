/**
 * CivicLens lightweight real-time sync via polling + custom events.
 */
(function () {
  'use strict';

  var META_MS = 10000;
  var timer = null;
  var lastMaxId = 0;
  var issueStatus = {};

  function rememberMine() {
    if (!window.API) return;
    API.get('/api/issues/?mine=true')
      .then(function (rows) {
        if (!Array.isArray(rows)) return;
        issueStatus = {};
        rows.forEach(function (r) {
          issueStatus[r.id] = r.status;
        });
      })
      .catch(function () {});
  }

  function checkResolvedToast(rows) {
    if (!window.Toast || !Array.isArray(rows)) return;
    rows.forEach(function (r) {
      var prev = issueStatus[r.id];
      if (prev && prev !== 'resolved' && r.status === 'resolved') {
        var msg = 'Resolved: ' + (r.title || 'Issue #' + r.id);
        Toast.show(msg + ' ✓', 'success');
      }
      issueStatus[r.id] = r.status;
    });
  }

  function poll() {
    if (!window.API) return;
    API.get('/api/issues/meta/')
      .then(function (meta) {
        var mx = meta.max_id || 0;
        if (lastMaxId && mx > lastMaxId) {
          window.dispatchEvent(new CustomEvent('civic-data-changed', { detail: meta }));
        }
        lastMaxId = mx;
        return API.get('/api/issues/?mine=true').catch(function () {
          return [];
        });
      })
      .then(function (rows) {
        if (Array.isArray(rows) && Object.keys(issueStatus).length) {
          checkResolvedToast(rows);
        } else if (Array.isArray(rows)) {
          rows.forEach(function (r) {
            issueStatus[r.id] = r.status;
          });
        }
      })
      .catch(function () {});
  }

  window.CivicRealtime = {
    start: function () {
      rememberMine();
      poll();
      if (timer) clearInterval(timer);
      timer = setInterval(poll, META_MS);
    },
    stop: function () {
      if (timer) clearInterval(timer);
      timer = null;
    },
    pollOnce: poll,
  };
})();
