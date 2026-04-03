/* admin-dashboard.js — CivicLens */

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('admin-logout-btn')?.addEventListener('click', async () => {
    try {
      await API.post('/api/logout/');
    } catch {}
    window.location.href = '/admin-login/';
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-content').forEach((p) => {
        p.classList.toggle('active', p.id === 'tab-' + tab);
      });
      if (tab === 'users' && !allUsers.length) loadUsers();
      if (tab === 'map') initAdminMap(true);
    });
  });

  document.querySelectorAll('.sidebar-tab').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = link.dataset.target;
      document.querySelectorAll('.tab-btn').forEach((btn) => {
        if (btn.dataset.tab === target) btn.click();
      });
    });
  });

  let chartStatus = null;
  let chartVerification = null;

  async function loadStats() {
    try {
      const data = await API.get('/api/admin/stats/');
      document.getElementById('admin-stat-users').textContent = data.users ?? 0;
      document.getElementById('admin-stat-issues').textContent = data.issues ?? 0;
      document.getElementById('admin-stat-pending').textContent = data.pending ?? 0;
      document.getElementById('admin-stat-resolved').textContent = data.resolved ?? 0;
      document.getElementById('admin-total-points').textContent = data.total_points ?? 0;
      document.getElementById('admin-max-points').textContent = data.max_points ?? 0;

      const ctxS = document.getElementById('admin-chart-status');
      if (ctxS && window.Chart) {
        const rows = data.by_status || [];
        const map = {};
        rows.forEach((r) => {
          map[r.status] = r.count || 0;
        });
        const labels = ['Pending', 'In progress', 'Resolved'];
        const values = [map.pending || 0, map.in_progress || 0, map.resolved || 0];
        if (chartStatus) chartStatus.destroy();
        chartStatus = new Chart(ctxS, {
          type: 'bar',
          data: {
            labels,
            datasets: [
              {
                label: 'Issues',
                data: values,
                backgroundColor: ['#f87171', '#fbbf24', '#34d399'],
                borderRadius: 8,
              },
            ],
          },
          options: {
            plugins: { legend: { display: false } },
            scales: {
              x: { ticks: { color: getComputedStyle(document.body).color } },
              y: { ticks: { color: getComputedStyle(document.body).color } },
            },
            animation: { duration: 900 },
          },
        });
      }

      const ctxV = document.getElementById('admin-chart-verification');
      if (ctxV && window.Chart) {
        const rows = data.by_verification || [];
        const map = { unverified: 0, verified: 0, disputed: 0 };
        rows.forEach((r) => {
          map[r.verification_state] = r.count || 0;
        });
        const labels = ['Unverified', 'Verified', 'Disputed'];
        const values = [map.unverified || 0, map.verified || 0, map.disputed || 0];
        if (chartVerification) chartVerification.destroy();
        chartVerification = new Chart(ctxV, {
          type: 'doughnut',
          data: {
            labels,
            datasets: [
              {
                data: values.length ? values : [1],
                backgroundColor: ['rgba(56,189,248,.55)', '#34d399', '#fbbf24'],
                borderWidth: 0,
              },
            ],
          },
          options: {
            plugins: { legend: { labels: { color: getComputedStyle(document.body).color } } },
            animation: { duration: 900, easing: 'easeOutQuart' },
          },
        });
      }
    } catch {}
  }

  await loadStats();

  let allIssues = [];
  let issuesPage = 1;
  const I_PER_PAGE = 10;
  let pendingStatusId = null;
  let pendingAfterImgId = null;

  async function loadIssues() {
    try {
      allIssues = await API.get('/api/admin/issues/');
    } catch {
      allIssues = [];
    }
    filterIssues();
  }

  function filterIssues() {
    const q = (document.getElementById('admin-issue-search')?.value || '').toLowerCase();
    const s = document.getElementById('admin-issue-status')?.value || '';
    const filtered = allIssues.filter(
      (i) =>
        (!q || i.title.toLowerCase().includes(q) || String(i.id).includes(q)) && (!s || i.status === s)
    );
    renderIssuesTable(filtered, 1);
  }

  document.getElementById('admin-issue-search')?.addEventListener('input', filterIssues);
  document.getElementById('admin-issue-status')?.addEventListener('change', filterIssues);

  function priBadge(p) {
    if (p === 'high') return '<span class="badge badge-priority-high">HIGH</span>';
    if (p === 'low') return '<span class="badge badge-priority-low">LOW</span>';
    return '<span class="badge badge-priority-med">MED</span>';
  }

  function renderIssuesTable(issues, page) {
    issuesPage = page;
    const tbody = document.getElementById('admin-issues-tbody');
    const start = (page - 1) * I_PER_PAGE;
    const slice = issues.slice(start, start + I_PER_PAGE);

    if (!slice.length) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-muted);">No issues found.</td></tr>`;
      document.getElementById('admin-issues-pagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = slice
      .map(
        (issue) => `
      <tr>
        <td style="font-size:.8rem;color:var(--text-muted);">#${issue.id}</td>
        <td>
          <strong>${esc(issue.title)}</strong>
          ${issue.trending ? '<br><span class="badge badge-trending" style="font-size:.62rem;">TRENDING</span>' : ''}
          ${issue.is_duplicate ? '<br><span class="badge badge-pending" style="font-size:.62rem;">DUP?</span>' : ''}
        </td>
        <td style="font-size:.78rem;">${esc(issue.category || '')}</td>
        <td>${priBadge(issue.priority)}</td>
        <td>${
          issue.verification_state === 'verified'
            ? '<span class="badge badge-resolved">VERIFIED</span>'
            : issue.verification_state === 'disputed'
              ? '<span class="badge badge-progress">DISPUTED</span>'
              : '<span class="badge badge-blue">UNVERIFIED</span>'
        }</td>
        <td><span class="badge badge-blue">${issue.impact_score ?? 0}</span></td>
        <td style="font-size:.85rem;">${esc(issue.user || '—')}</td>
        <td>${issue.votes ?? 0}</td>
        <td>${statusBadge(issue.status)}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="btn btn-outline btn-sm change-status-btn" data-id="${issue.id}">Route</button>
            <button type="button" class="btn btn-outline btn-sm upload-after-btn" data-id="${issue.id}">After</button>
          </div>
        </td>
      </tr>`
      )
      .join('');

    tbody.querySelectorAll('.change-status-btn').forEach((btn) => {
      btn.addEventListener('click', () => openStatusModal(btn.dataset.id));
    });
    tbody.querySelectorAll('.upload-after-btn').forEach((btn) => {
      btn.addEventListener('click', () => openAfterImgModal(btn.dataset.id));
    });

    renderPagination(
      document.getElementById('admin-issues-pagination'),
      issues.length,
      I_PER_PAGE,
      page,
      (p) => renderIssuesTable(issues, p)
    );
  }

  await loadIssues();

  function openStatusModal(id) {
    pendingStatusId = id;
    const issue = allIssues.find((i) => String(i.id) === String(id));
    document.getElementById('status-modal-issue-title').textContent = issue ? issue.title : '';
    if (issue) {
      document.getElementById('new-status-select').value = issue.status;
      document.getElementById('department-input').value = issue.department || '';
      document.getElementById('priority-select').value = issue.priority || 'medium';
    }
    Modal.open('status-modal');
  }

  document.getElementById('confirm-status-btn')?.addEventListener('click', async () => {
    if (!pendingStatusId) return;
    const newStatus = document.getElementById('new-status-select').value;
    const dept = document.getElementById('department-input').value || '';
    const pri = document.getElementById('priority-select').value;
    try {
      await API.patch(`/api/admin/issues/${pendingStatusId}/`, {
        status: newStatus,
        department: dept,
        priority: pri,
      });
      Toast.show('Issue updated', 'success');
      Modal.close('status-modal');
      await loadIssues();
      await loadStats();
      mapInitialized = false;
    } catch (err) {
      Toast.show(err.message || 'Update failed.', 'error');
    }
  });

  function openAfterImgModal(id) {
    pendingAfterImgId = id;
    const issue = allIssues.find((i) => String(i.id) === String(id));
    document.getElementById('after-img-issue-title').textContent = issue ? issue.title : '';
    Modal.open('after-img-modal');
    initFileUpload(document.getElementById('after-upload-area'));
  }

  document.getElementById('confirm-after-img-btn')?.addEventListener('click', async () => {
    if (!pendingAfterImgId) return;
    const fileInput = document.getElementById('after-img-file');
    if (!fileInput.files[0]) {
      Toast.show('Select an image.', 'warn');
      return;
    }
    const fd = new FormData();
    fd.append('after_img', fileInput.files[0]);
    try {
      await API.post(`/api/admin/issues/${pendingAfterImgId}/after-image/`, fd);
      Toast.show('After photo uploaded', 'success');
      Modal.close('after-img-modal');
      await loadIssues();
    } catch (err) {
      Toast.show(err.message || 'Upload failed.', 'error');
    }
  });

  let allUsers = [];
  const U_PER_PAGE = 10;

  async function loadUsers() {
    try {
      allUsers = await API.get('/api/admin/users/');
    } catch {
      allUsers = [];
    }
    renderUsersTable(allUsers, 1);
  }

  function renderUsersTable(users, page) {
    const tbody = document.getElementById('admin-users-tbody');
    const start = (page - 1) * U_PER_PAGE;
    const slice = users.slice(start, start + U_PER_PAGE);

    if (!slice.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted);">No users found.</td></tr>`;
      return;
    }

    tbody.innerHTML = slice
      .map(
        (user) => `
      <tr>
        <td style="font-size:.8rem;color:var(--text-muted);">#${user.id}</td>
        <td><strong>${esc(user.username)}</strong></td>
        <td style="font-size:.85rem;">${esc(user.email)}</td>
        <td><span class="badge badge-blue">${user.issues_submitted ?? 0} issues</span></td>
        <td style="font-size:.82rem;color:var(--text-muted);">${fmtDate(user.last_login)}</td>
        <td>${
          user.is_active !== false
            ? '<span class="badge badge-resolved">Active</span>'
            : '<span class="badge badge-pending">Inactive</span>'
        }</td>
      </tr>`
      )
      .join('');

    renderPagination(
      document.getElementById('admin-users-pagination'),
      users.length,
      U_PER_PAGE,
      page,
      (p) => renderUsersTable(users, p)
    );
  }

  let adminMap = null;
  let mapInitialized = false;
  let clusterGrp = null;

  function initAdminMap(force) {
    if (mapInitialized && !force) return;
    mapInitialized = true;

    const el = document.getElementById('admin-map');
    if (!el || typeof L === 'undefined') return;
    if (adminMap) {
      adminMap.remove();
      adminMap = null;
    }

    adminMap = L.map('admin-map').setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(adminMap);

    const clusterGrp = L.markerClusterGroup({ maxClusterRadius: 60 });
    allIssues.forEach((issue) => {
      if (!issue.lat || !issue.lng) return;
      const color = markerColorForIssue(issue);
      const icon = L.divIcon({
        html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 12px rgba(56,189,248,.35);"></div>`,
        className: '',
        iconSize: [16, 16],
      });
      L.marker([issue.lat, issue.lng], { icon })
        .bindPopup(
          `<strong>#${issue.id} – ${esc(issue.title)}</strong><br>${statusBadge(issue.status)}<br>User: ${esc(
            issue.user || '—'
          )}<br>Impact ${issue.impact_score ?? 0}`
        )
        .addTo(clusterGrp);
    });
    adminMap.addLayer(clusterGrp);
  }

  window.addEventListener('civic-data-changed', async () => {
    await loadStats();
    await loadIssues();
    mapInitialized = false;
    if (document.getElementById('tab-map')?.classList.contains('active')) initAdminMap(true);
  });
});

function esc(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str || ''));
  return d.innerHTML;
}

function fmtDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
