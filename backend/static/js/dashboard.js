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
  let filteredReports = [];
  let currentPage = 1;
  const PER_PAGE = 8;

  async function loadReports() {
    try {
      allReports = await API.get('/api/issues/?mine=true');
    } catch {
      allReports = [];
    }
    applyFilters();
    renderTable(currentPage);
  }

  function applyFilters() {
    const q =
      document.getElementById('dashboard-search-input')?.value?.trim()?.toLowerCase() || '';
    const status = document.getElementById('dashboard-status-filter')?.value || '';

    filteredReports = allReports.filter(r => {
      const matchQ =
        !q ||
        (r.title || '').toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q);
      const matchS = !status || r.status === status;
      return matchQ && matchS;
    });
  }

  function renderTable(page) {
    const tbody = document.getElementById('reports-tbody');
    if (!tbody) return;

    const start = (page - 1) * PER_PAGE;
    const slice = filteredReports.slice(start, start + PER_PAGE);

    if (!slice.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-muted);">No reports yet. <a href="/submit-issue/">Submit one!</a></td></tr>`;
      return;
    }

    tbody.innerHTML = slice.map((issue, i) => `
      <tr style="cursor:pointer;" data-id="${issue.id}">
        <td style="color:var(--text-muted);font-size:.8rem;">${start + i + 1}</td>
        <td><strong>${escHtml(issue.title)}</strong></td>
        <td>${statusBadge(issue.status)}</td>
        <td>👍 ${issue.votes ?? 0}</td>
        <td>⭐ ${issue.impact_score ?? calcImpact(issue.votes, issue.recent_reports)}${issue.is_trending ? ' 🔥' : ''}</td>
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
      filteredReports.length, PER_PAGE, page,
      p => { currentPage = p; renderTable(p); }
    );
  }

  loadReports();

  document.getElementById('dashboard-search-input')?.addEventListener('input', () => {
    applyFilters();
    currentPage = 1;
    renderTable(currentPage);
  });
  document.getElementById('dashboard-status-filter')?.addEventListener('change', () => {
    applyFilters();
    currentPage = 1;
    renderTable(currentPage);
  });

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
        const colorMap = {
          high: '#ef4444',
          medium: '#f59e0b',
          resolved: '#10b981',
        };
        const color =
          issue.status === 'resolved'
            ? colorMap.resolved
            : issue.priority === 'high'
              ? colorMap.high
              : colorMap.medium;
        const icon   = L.divIcon({
          html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);"></div>`,
          className: '', iconSize: [14, 14]
        });
        L.marker([issue.lat, issue.lng], { icon })
          .addTo(map)
          .bindPopup(
            `<strong>${escHtml(issue.title)}</strong><br>${statusBadge(issue.status)}<br>Impact: ${issue.impact_score ?? calcImpact(issue.votes, issue.recent_reports)}<br>${escHtml(issue.description || '')}`
          )
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
      const scoreEl = document.getElementById('modal-score');
      const score = issue.impact_score ?? calcImpact(issue.votes, issue.recent_reports);
      scoreEl.textContent = score + (issue.is_trending ? ' 🔥' : '');

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

      // Timeline dates (reported / in-progress / resolved)
      const tl = document.getElementById('modal-timeline');
      const pendingDate = tl?.querySelector('.tl-step[data-step="pending"] .tl-date');
      const progressDate = tl?.querySelector('.tl-step[data-step="in_progress"] .tl-date');
      const resolvedDate = tl?.querySelector('.tl-step[data-step="resolved"] .tl-date');
      if (pendingDate) pendingDate.textContent = formatDate(issue.reported_at);
      if (progressDate) progressDate.textContent = formatDate(issue.in_progress_at);
      if (resolvedDate) resolvedDate.textContent = formatDate(issue.resolved_at);

      // Proof thumbnails (before / after)
      const beforeThumb = tl?.querySelector('.tl-thumb[data-thumb="before"]');
      const afterThumb = tl?.querySelector('.tl-thumb[data-thumb="after"]');
      if (beforeThumb) {
        if (issue.before_img) {
          beforeThumb.src = issue.before_img;
          beforeThumb.classList.add('show');
        } else {
          beforeThumb.classList.remove('show');
        }
      }
      if (afterThumb) {
        if (issue.after_img) {
          afterThumb.src = issue.after_img;
          afterThumb.classList.add('show');
        } else {
          afterThumb.classList.remove('show');
        }
      }

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
      const scoreEl = document.getElementById('modal-score');
      const score = res.impact_score ?? calcImpact(res.votes, res.recent_reports);
      scoreEl.textContent = score + (res.is_trending ? ' 🔥' : '');
      scoreEl.style.transform = 'scale(1.06)';
      setTimeout(() => { scoreEl.style.transform = ''; }, 220);
      Toast.show(res.user_voted ? '⭐ Upvote added!' : 'Upvote removed.', 'success');
    } catch (err) {
      Toast.show(err.message || 'Could not vote.', 'error');
    }
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