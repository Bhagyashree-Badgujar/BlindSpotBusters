/* submit-issue.js */

document.addEventListener('DOMContentLoaded', () => {

  /* ---------- Logout ---------- */
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try { await API.post('/api/logout/'); } catch {}
    localStorage.removeItem('civic_user'); // Clear local storage
    window.location.href = '/login/'; // Django login page
  });

  /* ---------- File upload preview ---------- */
  initFileUpload(document.getElementById('upload-area'));

  /* ---------- Detect location ---------- */
  document.getElementById('detect-btn')?.addEventListener('click', () => {
    const latEl = document.getElementById('lat');
    const lngEl = document.getElementById('lng');
    const labelEl = document.getElementById('location-label');
    detectLocation(latEl, lngEl, labelEl);
  });

  /* ---------- Duplicate check (debounced) ---------- */
  let dupTimeout;
  document.getElementById('title')?.addEventListener('input', e => {
    clearTimeout(dupTimeout);
    const val = e.target.value.trim();
    if (val.length < 5) return;
    dupTimeout = setTimeout(() => checkDuplicate(val), 800);
  });

  async function checkDuplicate(title) {
    try {
      const res = await API.get(`/api/issues/check-duplicate/?title=${encodeURIComponent(title)}`); // Django endpoint
      const dupAlert = document.getElementById('dup-alert');
      dupAlert.classList.toggle('show', !!res.is_duplicate);
    } catch (err) {
      console.error('Duplicate check failed', err);
    }
  }

  /* ---------- Live duplicate suggestions (description typing) ---------- */
  const form = document.getElementById('issue-form');
  const submitBtn = document.getElementById('submit-btn');
  const descEl = document.getElementById('description');
  const suggestionsEl = document.getElementById('dup-suggestions');

  let suggestTimeout;
  descEl?.addEventListener('input', e => {
    clearTimeout(suggestTimeout);
    const val = (e.target.value || '').trim();
    if (val.length < 10) {
      suggestionsEl?.classList.remove('show');
      if (suggestionsEl) suggestionsEl.innerHTML = '';
      return;
    }
    suggestTimeout = setTimeout(() => loadSuggestions(val), 650);
  });

  async function loadSuggestions(text) {
    try {
      const lat = document.getElementById('lat')?.value?.trim();
      const lng = document.getElementById('lng')?.value?.trim();
      let url = `/api/issues/similar/?text=${encodeURIComponent(text)}`;
      if (lat && lng) {
        url += `&lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`;
      }
      const res = await API.get(url);
      const issues = res.issues || [];

      if (!issues.length) {
        suggestionsEl?.classList.remove('show');
        if (suggestionsEl) suggestionsEl.innerHTML = '';
        return;
      }

      suggestionsEl.innerHTML = issues
        .map(i => `
          <div class="suggestion-item" role="button" tabindex="0">
            <div class="suggestion-meta">
              <div class="suggestion-title">${escHtml(i.title)}</div>
              <div style="color:var(--text-muted);font-size:.82rem;">
                ${statusBadge(i.status)} • ⭐ ${i.impact_score ?? calcImpact(i.votes, i.recent_reports)}${i.is_trending ? ' 🔥' : ''}
              </div>
            </div>
            <button class="btn btn-outline btn-sm" type="button" data-view-id="${i.id}">View</button>
          </div>
        `)
        .join('');

      suggestionsEl.classList.add('show');
      suggestionsEl.querySelectorAll('button[data-view-id]').forEach(btn => {
        btn.addEventListener('click', ev => {
          ev.preventDefault();
          ev.stopPropagation();
          openIssueModal(btn.dataset.viewId);
        });
      });
    } catch (err) {
      // Suggestions are optional; don't block submission.
    }
  }

  function escHtml(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str || ''));
    return d.innerHTML;
  }

  function formatDate(str) {
    if (!str) return '—';
    return new Date(str).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /* ---------- Issue viewing modal (for similar reports) ---------- */
  let modalIssueId = null;

  async function openIssueModal(id) {
    modalIssueId = id;
    try {
      const issue = await API.get('/api/issues/' + id + '/');

      document.getElementById('modal-title').textContent = issue.title;
      document.getElementById('modal-desc').textContent = issue.description || '';

      document.getElementById('modal-vote-count').textContent = issue.votes ?? 0;
      const scoreEl = document.getElementById('modal-score');
      const score = issue.impact_score ?? calcImpact(issue.votes, issue.recent_reports);
      scoreEl.textContent = score + (issue.is_trending ? ' 🔥' : '');

      const bi = document.getElementById('modal-before-img');
      const ai = document.getElementById('modal-after-img');
      if (bi) bi.src = issue.before_img || 'https://placehold.co/640x220?text=No+Image';
      if (ai) ai.src = issue.after_img || 'https://placehold.co/640x220?text=No+After+Image';

      initImgSlider(document.getElementById('modal-slider'));

      const stepIdx = { pending: 0, in_progress: 1, resolved: 2 };
      const current = stepIdx[issue.status] ?? 0;
      document.querySelectorAll('#modal-timeline .tl-step').forEach((step, i) => {
        step.classList.toggle('done', i < current);
        step.classList.toggle('active', i === current);
      });

      // Timeline dates
      const tl = document.getElementById('modal-timeline');
      const pendingDate = tl?.querySelector('.tl-step[data-step="pending"] .tl-date');
      const progressDate = tl?.querySelector('.tl-step[data-step="in_progress"] .tl-date');
      const resolvedDate = tl?.querySelector('.tl-step[data-step="resolved"] .tl-date');
      if (pendingDate) pendingDate.textContent = formatDate(issue.reported_at);
      if (progressDate) progressDate.textContent = formatDate(issue.in_progress_at);
      if (resolvedDate) resolvedDate.textContent = formatDate(issue.resolved_at);

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

      document.getElementById('modal-duplicate')?.classList.toggle('show', !!issue.is_duplicate);
      document.getElementById('modal-upvote-btn')?.classList.toggle('voted', !!issue.user_voted);

      Modal.open('issue-modal');
    } catch {
      Toast.show('Could not load issue details.', 'error');
    }
  }

  document.getElementById('modal-upvote-btn')?.addEventListener('click', async () => {
    if (!modalIssueId) return;
    try {
      const res = await API.post('/api/issues/' + modalIssueId + '/vote/');
      document.getElementById('modal-vote-count').textContent = res.votes;
      document.getElementById('modal-upvote-btn').classList.toggle('voted', res.user_voted);
      const scoreEl = document.getElementById('modal-score');
      const score = res.impact_score ?? calcImpact(res.votes, res.recent_reports);
      scoreEl.textContent = score + (res.is_trending ? ' 🔥' : '');
      Toast.show(res.user_voted ? '⭐ Upvote added!' : 'Upvote removed.', 'success');
    } catch {
      Toast.show('Could not vote.', 'error');
    }
  });

  /* ---------- Nearby duplicate check (before form submit) ---------- */
  let pendingFormData = null;

  function resetSubmitButton() {
    pendingFormData = null;
    submitBtn.disabled = false;
    submitBtn.innerHTML = '🚀 Submit Issue';
  }

  document.getElementById('nearby-review-later-btn')?.addEventListener('click', resetSubmitButton);
  document.getElementById('nearby-close-btn')?.addEventListener('click', resetSubmitButton);

  document.getElementById('nearby-continue-btn')?.addEventListener('click', async () => {
    if (!pendingFormData) return;
    try {
      const res = await API.post('/report/', pendingFormData);
      if (res.is_duplicate) {
        document.getElementById('dup-alert')?.classList.add('show');
        Toast.show('⚠️ Possible duplicate detected!', 'warn');
      } else {
        document.getElementById('success-alert')?.classList.add('show');
        document.getElementById('dup-alert')?.classList.remove('show');
        Toast.show('Issue submitted successfully! ✅', 'success');
        setTimeout(() => window.location.href = '/my-reports/', 1800);
      }
    } catch (err) {
      Toast.show(err.message || 'Submission failed. Try again.', 'error');
    } finally {
      resetSubmitButton();
      Modal.close('nearby-dup-modal');
    }
  });

  function showNearbyModal(issues) {
    const listEl = document.getElementById('nearby-issues-list');
    listEl.innerHTML = issues
      .map(i => `
        <div class="suggestion-item">
          <div class="suggestion-meta">
            <div class="suggestion-title">${escHtml(i.title)}</div>
            <div style="color:var(--text-muted);font-size:.82rem;">
              ${statusBadge(i.status)} • ⭐ ${i.impact_score ?? calcImpact(i.votes, i.recent_reports)}${i.is_trending ? ' 🔥' : ''} ${i.distance_km != null ? ' • ' + i.distance_km + 'km' : ''}
            </div>
          </div>
          <button class="btn btn-outline btn-sm" type="button" data-view-id="${i.id}">View</button>
        </div>
      `)
      .join('');

    listEl.querySelectorAll('button[data-view-id]').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        openIssueModal(btn.dataset.viewId);
      });
    });

    Modal.open('nearby-dup-modal');
  }

  async function submitIssueNow(formData) {
    const res = await API.post('/report/', formData);
    if (res.is_duplicate) {
      document.getElementById('dup-alert')?.classList.add('show');
      Toast.show('⚠️ Possible duplicate detected!', 'warn');
    } else {
      document.getElementById('success-alert')?.classList.add('show');
      document.getElementById('dup-alert')?.classList.remove('show');
      Toast.show('Issue submitted successfully! ✅', 'success');
      setTimeout(() => window.location.href = '/my-reports/', 1800);
    }
  }

  /* ---------- Form submit ---------- */
  form.addEventListener('submit', async e => {
    e.preventDefault();

    // Clear previous errors
    form.querySelectorAll('.form-error').forEach(el => {
      el.textContent = '';
      el.classList.remove('show');
    });
    form.querySelectorAll('.form-input, .form-textarea').forEach(el => (el.style.borderColor = ''));

    const title = form.querySelector('#title');
    const desc = form.querySelector('#description');
    let valid = true;

    if (!title.value.trim()) {
      Validator.showError(title, 'Title is required.');
      valid = false;
    }
    if (!desc.value.trim()) {
      Validator.showError(desc, 'Description is required.');
      valid = false;
    }
    if (!valid) return;

    // Start submission flow.
    pendingFormData = new FormData(form);
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Submitting…';

    try {
      const lat = pendingFormData.get('lat');
      const lng = pendingFormData.get('lng');
      const q = (title.value || '').trim();

      let nearby = { issues: [] };
      if (lat && lng && q.length >= 3) {
        nearby = await API.get(
          `/api/issues/nearby-similar/?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&q=${encodeURIComponent(q)}`
        );
      }

      if (nearby.issues && nearby.issues.length) {
        showNearbyModal(nearby.issues.slice(0, 5));
        return; // wait for user to continue in the modal
      }

      // No nearby duplicates => submit immediately.
      await submitIssueNow(pendingFormData);
    } catch (err) {
      console.error(err);
      Toast.show(err.message || 'Submission failed. Try again.', 'error');
    } finally {
      // If we showed the modal and user continues, modal handler will reset.
      if (!document.getElementById('nearby-dup-modal')?.classList.contains('open')) {
        resetSubmitButton();
      }
    }
  });

});