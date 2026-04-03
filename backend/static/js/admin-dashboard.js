/* admin-dashboard.js */

document.addEventListener('DOMContentLoaded', async () => {

  /* ---------- Logout ---------- */
  document.getElementById('admin-logout-btn')?.addEventListener('click', async () => {
    try { await API.post('/api/logout/'); } catch {}
    window.location.href = '/admin-login/';
  });

  let statusChart = null;

  /* ---------- Tab panels ---------- */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(p => {
        p.classList.toggle('active', p.id === 'tab-' + tab);
      });
      if (tab === 'users' && !allUsers.length) loadUsers();
      if (tab === 'map') initAdminMap();
    });
  });

  /* ---------- Sidebar tab nav ---------- */
  document.querySelectorAll('.sidebar-tab').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const target = link.dataset.target;
      document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.dataset.tab === target) btn.click();
      });
    });
  });

  /* ---------- Stats ---------- */
  async function loadStats() {
    try {
      const data = await API.get('/api/admin/stats/');
      document.getElementById('admin-stat-users').textContent   = data.users    ?? 0;
      document.getElementById('admin-stat-issues').textContent  = data.issues   ?? 0;
      document.getElementById('admin-stat-pending').textContent = data.pending  ?? 0;
      const inProgress = data.in_progress ?? 0;
      document.getElementById('admin-stat-resolved').textContent= data.resolved ?? 0;

      const canvas = document.getElementById('admin-status-chart');
      if (canvas && typeof Chart !== 'undefined') {
        const ctx = canvas.getContext('2d');
        if (statusChart) statusChart.destroy();

        statusChart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: ['Pending', 'In Progress', 'Resolved'],
            datasets: [
              {
                label: 'Issues',
                data: [data.pending ?? 0, inProgress, data.resolved ?? 0],
                backgroundColor: ['#ef4444', '#f59e0b', '#10b981'],
                borderWidth: 0,
              },
            ],
          },
          options: {
            responsive: true,
            plugins: {
              legend: { display: false },
              tooltip: { enabled: true },
            },
            scales: {
              y: {
                beginAtZero: true,
                ticks: { precision: 0 },
              },
            },
          },
        });
      }
    } catch {}
  }
  loadStats();

  /* ---------- Issues Table ---------- */
  let allIssues   = [];
  let issuesPage  = 1;
  const I_PER_PAGE = 10;
  let pendingStatusId = null;
  let pendingAfterImgId = null;

  async function loadIssues() {
    try {
      allIssues = await API.get('/api/admin/issues/');
    } catch { allIssues = []; }
    filterIssues();
  }

  function filterIssues() {
    const q = (document.getElementById('admin-issue-search')?.value || '').toLowerCase();
    const s = document.getElementById('admin-issue-status')?.value || '';
    const filtered = allIssues.filter(i =>
      (!q || i.title.toLowerCase().includes(q) || String(i.id).includes(q)) &&
      (!s || i.status === s)
    );
    renderIssuesTable(filtered, 1);
  }

  document.getElementById('admin-issue-search')?.addEventListener('input', filterIssues);
  document.getElementById('admin-issue-status')?.addEventListener('change', filterIssues);

  function renderIssuesTable(issues, page) {
    issuesPage = page;
    const tbody = document.getElementById('admin-issues-tbody');
    const start = (page - 1) * I_PER_PAGE;
    const slice = issues.slice(start, start + I_PER_PAGE);

    if (!slice.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted);">No issues found.</td></tr>`;
      document.getElementById('admin-issues-pagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = slice.map(issue => `
      <tr>
        <td style="font-size:.8rem;color:var(--text-muted);">#${issue.id}</td>
        <td>
          <strong>${esc(issue.title)}</strong>
          ${issue.is_duplicate ? '<br><span class="badge badge-pending" style="font-size:.65rem;">⚠️ Duplicate</span>' : ''}
        </td>
        <td style="font-size:.85rem;">${esc(issue.user || '—')}</td>
        <td>👍 ${issue.votes ?? 0}</td>
        <td>${statusBadge(issue.status)}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn btn-outline btn-sm change-status-btn"
                    data-id="${issue.id}" data-title="${esc(issue.title)}" data-status="${issue.status}">
              ✏️ Status
            </button>
            <button class="btn btn-outline btn-sm upload-after-btn"
                    data-id="${issue.id}" data-title="${esc(issue.title)}">
              📸 After
            </button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.change-status-btn').forEach(btn => {
      btn.addEventListener('click', () => openStatusModal(btn.dataset.id, btn.dataset.title, btn.dataset.status));
    });
    tbody.querySelectorAll('.upload-after-btn').forEach(btn => {
      btn.addEventListener('click', () => openAfterImgModal(btn.dataset.id, btn.dataset.title));
    });

    renderPagination(
      document.getElementById('admin-issues-pagination'),
      issues.length, I_PER_PAGE, page,
      p => renderIssuesTable(issues, p)
    );
  }

  loadIssues();

  /* ---------- Status Modal ---------- */
  function openStatusModal(id, title, currentStatus) {
    pendingStatusId = id;
    document.getElementById('status-modal-issue-title').textContent = title;
    document.getElementById('new-status-select').value = currentStatus;
    Modal.open('status-modal');
  }

  document.getElementById('confirm-status-btn')?.addEventListener('click', async () => {
    if (!pendingStatusId) return;
    const newStatus = document.getElementById('new-status-select').value;
    try {
      await API.patch(`/api/admin/issues/${pendingStatusId}/`, { status: newStatus });
      Toast.show('Status updated! ✅', 'success');
      Modal.close('status-modal');
      loadIssues();
      loadStats();
    } catch (err) {
      Toast.show(err.message || 'Update failed.', 'error');
    }
  });

  /* ---------- After Image Modal ---------- */
  function openAfterImgModal(id, title) {
    pendingAfterImgId = id;
    document.getElementById('after-img-issue-title').textContent = title;
    Modal.open('after-img-modal');
    initFileUpload(document.getElementById('after-upload-area'));
  }

  document.getElementById('confirm-after-img-btn')?.addEventListener('click', async () => {
    if (!pendingAfterImgId) return;
    const fileInput = document.getElementById('after-img-file');
    if (!fileInput.files[0]) { Toast.show('Please select an image.', 'warn'); return; }
    const fd = new FormData();
    fd.append('after_img', fileInput.files[0]);
    try {
      await API.post(`/api/admin/issues/${pendingAfterImgId}/after-image/`, fd);
      Toast.show('After image uploaded! 📸', 'success');
      Modal.close('after-img-modal');
      loadIssues();
    } catch (err) {
      Toast.show(err.message || 'Upload failed.', 'error');
    }
  });

  /* ---------- Users Table ---------- */
  let allUsers  = [];
  let usersPage = 1;
  const U_PER_PAGE = 10;

  async function loadUsers() {
    try {
      allUsers = await API.get('/api/admin/users/');
    } catch { allUsers = []; }
    renderUsersTable(allUsers, 1);
  }

  function renderUsersTable(users, page) {
    usersPage = page;
    const tbody = document.getElementById('admin-users-tbody');
    const start = (page - 1) * U_PER_PAGE;
    const slice = users.slice(start, start + U_PER_PAGE);

    if (!slice.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted);">No users found.</td></tr>`;
      return;
    }

    tbody.innerHTML = slice.map(user => `
      <tr>
        <td style="font-size:.8rem;color:var(--text-muted);">#${user.id}</td>
        <td><strong>${esc(user.username)}</strong></td>
        <td style="font-size:.85rem;">${esc(user.email)}</td>
        <td><span class="badge badge-blue">${user.issues_submitted ?? 0} issues</span></td>
        <td style="font-size:.82rem;color:var(--text-muted);">${fmtDate(user.last_login)}</td>
        <td>${user.is_active !== false
          ? '<span class="badge badge-resolved">Active</span>'
          : '<span class="badge badge-pending">Inactive</span>'}</td>
      </tr>
    `).join('');

    renderPagination(
      document.getElementById('admin-users-pagination'),
      users.length, U_PER_PAGE, page,
      p => renderUsersTable(users, p)
    );
  }

  /* ---------- Admin Hotspot Map ---------- */
  let adminMap      = null;
  let mapInitialized = false;

  function initAdminMap() {
    if (mapInitialized) return;
    mapInitialized = true;

    adminMap = L.map('admin-map').setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(adminMap);

    const clusterGrp = L.markerClusterGroup({ maxClusterRadius: 60 });
    const colorMap = {
      high: '#ef4444',
      medium: '#f59e0b',
      resolved: '#10b981',
      low: '#10b981',
    };

    allIssues.forEach(issue => {
      if (!issue.lat || !issue.lng) return;
      const color =
        issue.status === 'resolved'
          ? colorMap.resolved
          : issue.priority === 'high'
            ? colorMap.high
            : colorMap.medium;
      const icon  = L.divIcon({
        html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);"></div>`,
        className: '', iconSize: [16, 16]
      });
      L.marker([issue.lat, issue.lng], { icon })
        .bindPopup(
          `<strong>#${issue.id} – ${esc(issue.title)}</strong><br>${statusBadge(issue.status)}<br>Impact: ${issue.impact_score ?? calcImpact(issue.votes, issue.recent_reports)}${issue.is_trending ? ' 🔥' : ''}<br>User: ${esc(issue.user || '—')}`
        )
        .addTo(clusterGrp);
    });

    adminMap.addLayer(clusterGrp);
  }

});

/* ---------- Helpers ---------- */
function esc(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str || ''));
  return d.innerHTML;
}
function fmtDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}
