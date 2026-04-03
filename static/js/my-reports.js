/* ============================================================
   MY REPORTS PAGE — JS (my-reports.js)
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {

  /* ---------- Logout ---------- */
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try { await API.post('/api/logout/'); } catch {}
    localStorage.removeItem('civic_user');
    window.location.href = '/login/';
  });

  let allReports = [];
  let currentPage = 1;
  const PER_PAGE = 10;

  /* ---------- Load Reports ---------- */
  async function loadReports() {
    try {
      allReports = await API.get('/api/issues/?mine=true');
    } catch (err) {
      allReports = [];
      Toast.show('Could not load reports.', 'error');
    }
    applyFilters();
  }

  /* ---------- Filter + Search ---------- */
  function applyFilters() {
    const q = document.getElementById('search-input')?.value.trim().toLowerCase() || '';
    const status = document.getElementById('status-filter')?.value || '';
    const filtered = allReports.filter(r => {
      const matchQ = !q || r.title.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q);
      const matchS = !status || r.status === status;
      return matchQ && matchS;
    });
    renderTable(filtered, 1);
  }

  document.getElementById('search-input')?.addEventListener('input', applyFilters);
  document.getElementById('status-filter')?.addEventListener('change', applyFilters);

  /* ---------- Render Reports Table ---------- */
  function renderTable(reports, page) {
    currentPage = page;
    const tbody = document.getElementById('my-reports-tbody');
    const start = (page - 1) * PER_PAGE;
    const slice = reports.slice(start, start + PER_PAGE);

    if (!slice.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted);">No reports found.</td></tr>`;
      document.getElementById('my-pagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = slice.map((issue, i) => `
      <tr style="cursor:pointer;" data-id="${issue.id}">
        <td style="color:var(--text-muted);font-size:.8rem;">${start + i + 1}</td>
        <td><strong>${esc(issue.title)}</strong></td>
        <td>${statusBadge(issue.status)}</td>
        <td>👍 ${issue.votes ?? 0}</td>
        <td>⭐ ${calcImpact(issue.votes, issue.recent_reports)}</td>
        <td style="font-size:.82rem;color:var(--text-muted);">${fmtDate(issue.created_at)}</td>
        <td><button class="btn btn-outline btn-sm view-btn" data-id="${issue.id}">View</button></td>
      </tr>
    `).join('');

    // Row click or view button click
    tbody.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        openModal(btn.dataset.id);
      });
    });
    tbody.querySelectorAll('tr[data-id]').forEach(row => {
      row.addEventListener('click', () => openModal(row.dataset.id));
    });

    // Pagination
    renderPagination(
      document.getElementById('my-pagination'),
      reports.length, PER_PAGE, page,
      p => renderTable(reports, p)
    );
  }

  /* ---------- Modal ---------- */
  let currentIssueId = null;

  async function openModal(id) {
    currentIssueId = id;
    try {
      const issue = await API.get('/api/issues/' + id + '/');

      document.getElementById('modal-title').textContent      = issue.title;
      document.getElementById('modal-desc').textContent       = issue.description || '';
      document.getElementById('modal-vote-count').textContent = issue.votes ?? 0;
      document.getElementById('modal-score').textContent      = calcImpact(issue.votes, issue.recent_reports);

      const bi = document.getElementById('modal-before-img');
      const ai = document.getElementById('modal-after-img');
      if (bi) bi.src = issue.before_img || 'https://placehold.co/640x220?text=No+Image';
      if (ai) ai.src = issue.after_img  || 'https://placehold.co/640x220?text=No+After+Image';

      initImgSlider(document.getElementById('modal-slider'));

      const stepIdx = { pending: 0, in_progress: 1, resolved: 2 };
      const cur = stepIdx[issue.status] ?? 0;
      document.querySelectorAll('#modal-timeline .tl-step').forEach((s, i) => {
        s.classList.toggle('done',   i < cur);
        s.classList.toggle('active', i === cur);
      });

      document.getElementById('modal-duplicate')?.classList.toggle('show', !!issue.is_duplicate);
      const upvoteBtn = document.getElementById('modal-upvote-btn');
      upvoteBtn?.classList.toggle('voted', !!issue.user_voted);

      Modal.open('issue-modal');
    } catch {
      Toast.show('Could not load issue details.', 'error');
    }
  }

  /* ---------- Upvote ---------- */
  document.getElementById('modal-upvote-btn')?.addEventListener('click', async () => {
    if (!currentIssueId) return;
    const voteKey = `civiclens_vote_${currentIssueId}`;
    if (localStorage.getItem(voteKey)) {
      Toast.show('You already upvoted this issue from this account on this device.', 'warn');
      return;
    }
    try {
      const res = await API.post('/api/issues/' + currentIssueId + '/vote/');
      document.getElementById('modal-vote-count').textContent = res.votes;
      document.getElementById('modal-upvote-btn').classList.toggle('voted', res.user_voted);
      document.getElementById('modal-score').textContent = calcImpact(res.votes, 0);
      localStorage.setItem(voteKey, '1');
      Toast.show(res.user_voted ? '⭐ Upvoted!' : 'Vote removed.', 'success');
    } catch {
      Toast.show('Could not vote.', 'error');
    }
  });

  /* ---------- Init ---------- */
  loadReports();
  setInterval(loadReports, 10000);
});

/* ---------- Helper Functions ---------- */
function esc(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str || ''));
  return d.innerHTML;
}

function fmtDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}