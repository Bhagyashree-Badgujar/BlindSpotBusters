/* dashboard.js — CivicLens */

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try {
      await API.post('/api/logout/');
    } catch {}
    localStorage.removeItem('civic_user');
    window.location.href = '/login/';
  });

  const stored = JSON.parse(localStorage.getItem('civic_user') || '{}');
  const greeting = document.getElementById('user-greeting');
  if (greeting && stored.username) greeting.textContent = `👤 ${stored.username}`;

  let categoryChart = null;

  async function loadStats() {
    try {
      const data = await API.get('/api/user/stats/');
      document.getElementById('stat-total').textContent = data.total ?? 0;
      document.getElementById('stat-resolved').textContent = data.resolved ?? 0;
      document.getElementById('stat-pending').textContent = data.pending ?? 0;
      document.getElementById('stat-upvotes').textContent = data.upvotes ?? 0;
      const pt = document.getElementById('stat-points');
      if (pt) pt.textContent = data.civic_points ?? 0;

      const max = Math.max(data.pending || 1, data.in_progress || 1, data.resolved || 1, 1);
      setBar('bar-pending', data.pending, max);
      setBar('bar-progress', data.in_progress, max);
      setBar('bar-resolved', data.resolved, max);

      const badgeRow = document.getElementById('badge-row');
      if (badgeRow) {
        const badges = data.badges || [];
        if (!badges.length) badgeRow.innerHTML = '<span class="text-muted">Earn badges by filing evidence-rich reports.</span>';
        else {
          badgeRow.innerHTML = badges
            .map(
              (b) =>
                `<span class="badge badge-blue">${escHtml(String(b).replace(/_/g, ' '))}</span>`
            )
            .join('');
        }
      }

      const ctx = document.getElementById('chart-category');
      if (ctx && window.Chart) {
        const rows = data.by_category || [];
        const labels = rows.map((r) => String(r.category || '').replace(/_/g, ' '));
        const values = rows.map((r) => r.count || 0);
        if (categoryChart) categoryChart.destroy();
        categoryChart = new Chart(ctx, {
          type: 'doughnut',
          data: {
            labels,
            datasets: [
              {
                data: values.length ? values : [1],
                backgroundColor: ['#38bdf8', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#94a3b8'],
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

  function setBar(id, val, max) {
    const el = document.getElementById(id);
    if (el) el.style.height = `${Math.max(4, ((val || 0) / max) * 56)}px`;
  }

  await loadStats();

  async function loadLeaderboard() {
    const ul = document.getElementById('leaderboard-list');
    if (!ul) return;
    try {
      const rows = await API.get('/api/leaderboard/');
      if (!Array.isArray(rows) || !rows.length) {
        ul.innerHTML = '<li class="text-muted">No contributors yet.</li>';
        return;
      }
      ul.innerHTML = rows
        .map(
          (r, i) => `
        <li>
          <span><span class="lb-rank">#${i + 1}</span>${escHtml(r.username)}</span>
          <span><span class="badge badge-blue">${r.points ?? 0} pts</span></span>
        </li>`
        )
        .join('');
    } catch {
      ul.innerHTML = '<li class="text-muted">Leaderboard unavailable.</li>';
    }
  }
  await loadLeaderboard();

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

    tbody.innerHTML = slice
      .map(
        (issue, i) => `
      <tr style="cursor:pointer;" data-id="${issue.id}">
        <td style="color:var(--text-muted);font-size:.8rem;">${start + i + 1}</td>
        <td><strong>${escHtml(issue.title)}</strong> ${issue.trending ? '<span class="badge badge-trending" style="font-size:.62rem;">HOT</span>' : ''}</td>
        <td>${statusBadge(issue.status)}</td>
        <td>👍 ${issue.votes ?? 0}</td>
        <td style="color:var(--text-muted);font-size:.85rem;">${formatDate(issue.updated_at)}</td>
        <td><button class="btn btn-outline btn-sm view-btn" data-id="${issue.id}">View</button></td>
      </tr>`
      )
      .join('');

    tbody.querySelectorAll('tr[data-id]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if ((e.target).classList.contains('view-btn')) return;
        openModal(row.dataset.id);
      });
    });
    tbody.querySelectorAll('.view-btn').forEach((btn) => {
      btn.addEventListener('click', () => openModal(btn.dataset.id));
    });

    renderPagination(
      document.getElementById('reports-pagination'),
      allReports.length,
      PER_PAGE,
      page,
      (p) => {
        currentPage = p;
        renderTable(p);
      }
    );
  }

  await loadReports();

  let map = null;
  let mapLayer = null;

  function initMap() {
    const el = document.getElementById('map');
    if (!el || typeof L === 'undefined') return;
    map = L.map('map').setView([20.5937, 78.9629], 5);
    mapLayer = L.layerGroup().addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
  }

  async function loadMapMarkers() {
    if (!map || !mapLayer) return;
    try {
      const issues = await API.get('/api/issues/');
      mapLayer.clearLayers();
      issues.forEach((issue) => {
        if (!issue.lat || !issue.lng) return;
        const color = markerColorForIssue(issue);
        const icon = L.divIcon({
          html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 10px rgba(56,189,248,.4);"></div>`,
          className: '',
          iconSize: [14, 14],
        });
        L.marker([issue.lat, issue.lng], { icon })
          .addTo(mapLayer)
          .bindPopup(`<strong>${escHtml(issue.title)}</strong><br>${statusBadge(issue.status)}`)
          .on('click', () => openModal(issue.id));
      });
    } catch {}
  }

  initMap();
  await loadMapMarkers();

  let currentIssueId = null;

  function renderModalMedia(issue) {
    const box = document.getElementById('modal-media');
    if (!box) return;
    const media = issue.media || [];
    if (!media.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML =
      '<div style="font-weight:600;margin-bottom:6px;">Evidence</div>' +
      media
        .map((m) => {
          const u = m.url || '';
          if (m.type === 'video')
            return `<video src="${escAttr(u)}" controls style="max-width:100%;border-radius:8px;margin-bottom:8px;"></video>`;
          if (m.type === 'audio')
            return `<audio src="${escAttr(u)}" controls style="width:100%;margin-bottom:8px;"></audio>`;
          return `<a href="${escAttr(u)}" target="_blank" rel="noopener">📎 Attachment</a>`;
        })
        .join('');
  }

  function escAttr(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  async function openModal(id) {
    currentIssueId = id;
    try {
      const issue = await API.get('/api/issues/' + id + '/');
      document.getElementById('modal-title').textContent = issue.title;
      document.getElementById('modal-desc').textContent = issue.description || '';
      document.getElementById('modal-vote-count').textContent = issue.votes ?? 0;
      const scoreVal =
        issue.impact_score != null ? issue.impact_score : calcImpact(issue.votes, issue.recent_reports);
      document.getElementById('modal-score').textContent = scoreVal;

      document.getElementById('modal-trending')?.classList.toggle('hidden', !issue.trending);

      const beforeImg = document.getElementById('modal-before-img');
      const afterImg = document.getElementById('modal-after-img');
      if (beforeImg) beforeImg.src = issue.before_img || 'https://placehold.co/640x220?text=Before';
      if (afterImg) afterImg.src = issue.after_img || 'https://placehold.co/640x220?text=After';

      renderModalMedia(issue);
      initImgSlider(document.getElementById('modal-slider'));

      const stepIdx = { pending: 0, in_progress: 1, resolved: 2 };
      const current = stepIdx[issue.status] ?? 0;
      document.querySelectorAll('#modal-timeline .tl-step').forEach((step, i) => {
        step.classList.toggle('done', i < current);
        step.classList.toggle('active', i === current);
      });

      document.getElementById('modal-duplicate')?.classList.toggle('show', !!issue.is_duplicate);

      const upvoteBtn = document.getElementById('modal-upvote-btn');
      upvoteBtn.classList.toggle('voted', !!issue.user_voted);
      upvoteBtn.disabled = !!issue.user_voted;

      Modal.open('issue-modal');
    } catch {
      Toast.show('Could not load issue details.', 'error');
    }
  }

  document.getElementById('modal-upvote-btn')?.addEventListener('click', async () => {
    if (!currentIssueId) return;
    const btn = document.getElementById('modal-upvote-btn');
    try {
      const res = await API.post('/api/issues/' + currentIssueId + '/vote/');
      document.getElementById('modal-vote-count').textContent = res.votes;
      btn.classList.add('voted');
      btn.disabled = true;
      document.getElementById('modal-score').textContent =
        res.impact_score != null ? res.impact_score : calcImpact(res.votes, 0);
      Toast.show('Upvote recorded!', 'success');
    } catch (err) {
      if (err.data && err.data.user_voted) {
        btn.classList.add('voted');
        btn.disabled = true;
        Toast.show('You already upvoted this issue.', 'warn');
      } else {
        Toast.show(err.message || 'Could not vote.', 'error');
      }
    }
  });

  document.getElementById('hamburger')?.addEventListener('click', () => {
    const nav = document.getElementById('main-nav');
    const open = nav.style.display === 'flex';
    nav.style.display = open ? 'none' : 'flex';
    if (!open) {
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
    }
  });

  window.addEventListener('civic-data-changed', async () => {
    await loadStats();
    await loadReports();
    await loadMapMarkers();
    await loadLeaderboard();
  });
});

function escHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str || ''));
  return d.innerHTML;
}

function formatDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
