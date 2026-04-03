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

      renderCertificates(data.certificates || []);
    } catch {}
  }

  function setBar(id, val, max) {
    const el = document.getElementById(id);
    if (el) el.style.height = `${Math.max(4, ((val || 0) / max) * 56)}px`;
  }

  await loadStats();

  let lastNotifMaxId = 0;

  async function loadNotifications() {
    const box = document.getElementById('notifications-feed');
    if (!box) return;
    try {
      const rows = await API.get('/api/user/notifications/');
      if (!Array.isArray(rows) || !rows.length) {
        box.innerHTML = '<span class="text-muted">No notifications yet.</span>';
        return;
      }
      const maxId = Math.max.apply(
        null,
        rows.map((r) => r.id)
      );
      if (lastNotifMaxId && maxId > lastNotifMaxId) {
        const newest = rows.find((r) => r.id === maxId);
        if (newest && window.Toast) Toast.show(newest.title, 'info');
      }
      lastNotifMaxId = maxId;
      box.innerHTML = rows
        .slice(0, 8)
        .map(
          (n) =>
            `<div style="padding:8px 0;border-bottom:1px solid var(--border);"><strong>${escHtml(
              n.title
            )}</strong><br/><span class="text-muted" style="font-size:.85rem;">${escHtml(n.body || '')}</span></div>`
        )
        .join('');
    } catch {
      box.innerHTML = '<span class="text-muted">No notifications to display.</span>';
    }
  }

  await loadNotifications();
  setInterval(loadNotifications, 12000);

  function renderCertificates(certs) {
    const box = document.getElementById('cert-list');
    if (!box) return;
    if (!Array.isArray(certs) || !certs.length) {
      box.innerHTML = '<span class="text-muted">No certificates yet. Earn points via verified resolutions.</span>';
      return;
    }
    const nameMap = {
      civic_spark: 'Civic Spark Recognition (50+ Points)',
      active_citizen: 'Active Citizen Award',
      city_contributor: 'City Contributor Certificate',
    };
    box.innerHTML = certs
      .map((c) => {
        const nm = nameMap[c.cert_type] || c.cert_type;
        return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);">
          <div>
            <div style="font-weight:700;">${escHtml(nm)}</div>
            <div class="text-muted" style="font-size:.85rem;">Issued ${formatDate(c.issued_at)} · Points: ${
          c.points_at_issue ?? ''
        }</div>
          </div>
          <a class="btn btn-outline btn-sm" href="/certificates/${c.id}/" target="_blank" rel="noopener">View</a>
        </div>`;
      })
      .join('');
  }

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

      const verifyLabel = document.getElementById('verify-label');
      if (verifyLabel) verifyLabel.textContent = issue.verification_label || '—';
      const vOk = issue.status === 'resolved';
      const btnC = document.getElementById('verify-confirm-btn');
      const btnD = document.getElementById('verify-dispute-btn');
      if (btnC) {
        btnC.disabled = !vOk || issue.user_verification === 'confirm';
        btnC.classList.toggle('voted', issue.user_verification === 'confirm');
      }
      if (btnD) {
        btnD.disabled = !vOk || issue.user_verification === 'dispute';
        btnD.classList.toggle('voted', issue.user_verification === 'dispute');
      }

      Modal.open('issue-modal');
    } catch {
      Toast.show('Could not load issue details.', 'error');
    }
  }

  async function sendVerify(choice) {
    if (!currentIssueId) return;
    try {
      const res = await API.post('/api/issues/' + currentIssueId + '/verify/', { choice });
      document.getElementById('verify-label').textContent = res.verification_label || '—';
      document.getElementById('verify-confirm-btn').disabled = choice === 'confirm';
      document.getElementById('verify-dispute-btn').disabled = choice === 'dispute';
      Toast.show('Verification saved.', 'success');
      await loadReports();
      await loadStats();
    } catch (err) {
      Toast.show(err.message || 'Could not verify.', 'error');
    }
  }

  document.getElementById('verify-confirm-btn')?.addEventListener('click', () => sendVerify('confirm'));
  document.getElementById('verify-dispute-btn')?.addEventListener('click', () => sendVerify('dispute'));

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
    await loadNotifications();
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
