/* dashboard.js */

document.addEventListener('DOMContentLoaded', async () => {

  /* ---------- Logout ---------- */
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try {
      await API.post('/api/logout/');
    } catch {}
    localStorage.removeItem('civic_user');
    window.location.href = '/login/'; // updated to Django login page
  });

  /* ---------- Greeting ---------- */
  const stored = JSON.parse(localStorage.getItem('civic_user') || '{}');
  const greeting = document.getElementById('user-greeting');
  if (greeting && stored.username) greeting.textContent = `👤 ${stored.username}`;

  /* ---------- Load Dashboard Stats ---------- */
  async function loadStats() {
    try {
      const data = await API.get('/api/user/stats/');
      document.getElementById('stat-total').textContent    = data.total    ?? 0;
      document.getElementById('stat-resolved').textContent = data.resolved ?? 0;
      document.getElementById('stat-pending').textContent  = data.pending  ?? 0;
      document.getElementById('stat-upvotes').textContent  = data.upvotes  ?? 0;

      // mini bar chart
      const max = Math.max(data.pending || 1, data.in_progress || 1, data.resolved || 1, 1);
      setBar('bar-pending',  data.pending,     max);
      setBar('bar-progress', data.in_progress, max);
      setBar('bar-resolved', data.resolved,    max);
    } catch {
      /* keep dashes */
    }
  }

  function setBar(id, val, max) {
    const el = document.getElementById(id);
    if (el) el.style.height = `${Math.max(4, ((val || 0) / max) * 56)}px`;
  }

  loadStats();

  /* ---------- Reports Table ---------- */
  let allReports = [];
  let currentPage = 1;
  const PER_PAGE = 8;

  async function loadReports() {
    try {
      allReports = await API.get('/api/issues/?mine=true');
    } catch {
      allReports = [];
    }
    renderTable(currentPage);
  }

  function renderTable(page) {
    const tbody = document.getElementById('reports-tbody');
    if (!tbody) return;

    const start = (page - 1) * PER_PAGE;
    const slice = allReports.slice(start, start + PER_PAGE);

    if (!slice.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-muted);">No reports yet. <a href="/submit-issue/">Submit one!</a></td></tr>`;
      return;
    }

    tbody.innerHTML = slice.map((issue, i) => `
      <tr style="cursor:pointer;" data-id="${issue.id}">
        <td style="color:var(--text-muted);font-size:.8rem;">${start + i + 1}</td>
        <td><strong>${escHtml(issue.title)}</strong></td>
        <td>${statusBadge(issue.status)}</td>
        <td>👍 ${issue.votes ?? 0}</td>
        <td style="color:var(--text-muted);font-size:.85rem;">${formatDate(issue.updated_at)}</td>
        <td><button class="btn btn-outline btn-sm view-btn" data-id="${issue.id}">View</button></td>
      </tr>
    `).join('');

    tbody.querySelectorAll('tr[data-id]').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.classList.contains('view-btn')) return;
        openModal(row.dataset.id);
      });
    });

    tbody.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => openModal(btn.dataset.id));
    });

    renderPagination(
      document.getElementById('reports-pagination'),
      allReports.length, PER_PAGE, page,
      p => { currentPage = p; renderTable(p); }
    );
  }

  loadReports();

  /* ---------- Map ---------- */
  let map;
  function initMap() {
    map = L.map('map').setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);
  }

  async function loadMapMarkers() {
    try {
      const issues = await API.get('/api/issues/');
      issues.forEach(issue => {
        if (!issue.lat || !issue.lng) return;
        const colors = { pending: '#ef4444', in_progress: '#f59e0b', resolved: '#10b981' };
        const color  = colors[issue.status] || '#6b7a99';
        const icon   = L.divIcon({
          html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);"></div>`,
          className: '', iconSize: [14, 14]
        });
        L.marker([issue.lat, issue.lng], { icon })
          .addTo(map)
          .bindPopup(`<strong>${escHtml(issue.title)}</strong><br>${statusBadge(issue.status)}<br>${escHtml(issue.description || '')}`)
          .on('click', () => openModal(issue.id));
      });
    } catch {}
  }

  initMap();
  loadMapMarkers();

  /* ---------- Issue Detail Modal ---------- */
  let currentIssueId = null;

  async function openModal(id) {
    currentIssueId = id;
    try {
      const issue = await API.get('/api/issues/' + id + '/');

      document.getElementById('modal-title').textContent       = issue.title;
      document.getElementById('modal-desc').textContent        = issue.description || '';
      document.getElementById('modal-vote-count').textContent  = issue.votes ?? 0;
      document.getElementById('modal-score').textContent       = calcImpact(issue.votes, issue.recent_reports);

      const beforeImg = document.getElementById('modal-before-img');
      const afterImg  = document.getElementById('modal-after-img');
      if (beforeImg) beforeImg.src = issue.before_img || 'https://placehold.co/640x220?text=No+Image';
      if (afterImg)  afterImg.src  = issue.after_img  || 'https://placehold.co/640x220?text=No+After+Image';

      initImgSlider(document.getElementById('modal-slider'));

      const stepIdx = { pending: 0, in_progress: 1, resolved: 2 };
      const current = stepIdx[issue.status] ?? 0;
      document.querySelectorAll('#modal-timeline .tl-step').forEach((step, i) => {
        step.classList.toggle('done',   i < current);
        step.classList.toggle('active', i === current);
      });

      const dupAlert = document.getElementById('modal-duplicate');
      dupAlert.classList.toggle('show', !!issue.is_duplicate);

      const upvoteBtn = document.getElementById('modal-upvote-btn');
      upvoteBtn.classList.toggle('voted', !!issue.user_voted);

      Modal.open('issue-modal');
    } catch (err) {
      Toast.show('Could not load issue details.', 'error');
    }
  }

  document.getElementById('modal-upvote-btn')?.addEventListener('click', async () => {
    if (!currentIssueId) return;
    try {
      const res = await API.post('/api/issues/' + currentIssueId + '/vote/');
      document.getElementById('modal-vote-count').textContent = res.votes;
      document.getElementById('modal-upvote-btn').classList.toggle('voted', res.user_voted);
      document.getElementById('modal-score').textContent = calcImpact(res.votes, 0);
      Toast.show(res.user_voted ? '⭐ Upvote added!' : 'Upvote removed.', 'success');
    } catch (err) {
      Toast.show(err.message || 'Could not vote.', 'error');
    }
  });

  /* ---------- Hamburger ---------- */
  document.getElementById('hamburger')?.addEventListener('click', () => {
    const nav = document.getElementById('main-nav');
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

});

/* ---------- Helpers ---------- */
function escHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str || ''));
  return d.innerHTML;
}
function formatDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}