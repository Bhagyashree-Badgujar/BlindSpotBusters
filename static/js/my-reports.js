/* my-reports.js — CivicLens */

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try {
      await API.post('/api/logout/');
    } catch {}
    localStorage.removeItem('civic_user');
    window.location.href = '/login/';
  });

  let allReports = [];
  let currentPage = 1;
  const PER_PAGE = 10;

  async function loadReports() {
    try {
      allReports = await API.get('/api/issues/?mine=true');
    } catch {
      allReports = [];
      Toast.show('Could not load reports.', 'error');
    }
    applyFilters();
  }

  function applyFilters() {
    const q = document.getElementById('search-input')?.value.trim().toLowerCase() || '';
    const status = document.getElementById('status-filter')?.value || '';
    const filtered = allReports.filter((r) => {
      const matchQ =
        !q || r.title.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q);
      const matchS = !status || r.status === status;
      return matchQ && matchS;
    });
    renderTable(filtered, 1);
  }

  document.getElementById('search-input')?.addEventListener('input', applyFilters);
  document.getElementById('status-filter')?.addEventListener('change', applyFilters);

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
          return `<a href="${escAttr(u)}" target="_blank" rel="noopener">Attachment</a>`;
        })
        .join('');
  }

  function escAttr(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

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

    tbody.innerHTML = slice
      .map(
        (issue, i) => `
      <tr style="cursor:pointer;" data-id="${issue.id}">
        <td style="color:var(--text-muted);font-size:.8rem;">${start + i + 1}</td>
        <td><strong>${esc(issue.title)}</strong> ${issue.trending ? '<span class="badge badge-trending" style="font-size:.62rem;">HOT</span>' : ''}</td>
        <td>${statusBadge(issue.status)}</td>
        <td>${issue.votes ?? 0}</td>
        <td>${issue.impact_score != null ? issue.impact_score : calcImpact(issue.votes, issue.recent_reports)}</td>
        <td style="font-size:.82rem;color:var(--text-muted);">${fmtDate(issue.created_at)}</td>
        <td><button class="btn btn-outline btn-sm view-btn" data-id="${issue.id}">View</button></td>
      </tr>`
      )
      .join('');

    tbody.querySelectorAll('.view-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openModal(btn.dataset.id);
      });
    });
    tbody.querySelectorAll('tr[data-id]').forEach((row) => {
      row.addEventListener('click', () => openModal(row.dataset.id));
    });

    renderPagination(
      document.getElementById('my-pagination'),
      reports.length,
      PER_PAGE,
      page,
      (p) => renderTable(reports, p)
    );
  }

  let currentIssueId = null;

  async function openModal(id) {
    currentIssueId = id;
    try {
      const issue = await API.get('/api/issues/' + id + '/');
      document.getElementById('modal-title').textContent = issue.title;
      document.getElementById('modal-desc').textContent = issue.description || '';
      document.getElementById('modal-vote-count').textContent = issue.votes ?? 0;
      const score =
        issue.impact_score != null ? issue.impact_score : calcImpact(issue.votes, issue.recent_reports);
      document.getElementById('modal-score').textContent = score;
      document.getElementById('modal-trending')?.classList.toggle('hidden', !issue.trending);

      const bi = document.getElementById('modal-before-img');
      const ai = document.getElementById('modal-after-img');
      if (bi) bi.src = issue.before_img || 'https://placehold.co/640x220?text=Before';
      if (ai) ai.src = issue.after_img || 'https://placehold.co/640x220?text=After';

      renderModalMedia(issue);
      initImgSlider(document.getElementById('modal-slider'));

      const stepIdx = { pending: 0, in_progress: 1, resolved: 2 };
      const cur = stepIdx[issue.status] ?? 0;
      document.querySelectorAll('#modal-timeline .tl-step').forEach((s, i) => {
        s.classList.toggle('done', i < cur);
        s.classList.toggle('active', i === cur);
      });

      document.getElementById('modal-duplicate')?.classList.toggle('show', !!issue.is_duplicate);
      const upvoteBtn = document.getElementById('modal-upvote-btn');
      upvoteBtn?.classList.toggle('voted', !!issue.user_voted);
      if (upvoteBtn) upvoteBtn.disabled = !!issue.user_voted;

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
      loadReports();
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
        Toast.show('Already upvoted.', 'warn');
      } else {
        Toast.show(err.message || 'Could not vote.', 'error');
      }
    }
  });

  await loadReports();

  window.addEventListener('civic-data-changed', loadReports);
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
