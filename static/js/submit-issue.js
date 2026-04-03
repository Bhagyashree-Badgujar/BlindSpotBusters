/* submit-issue.js — CivicLens */

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try {
      await API.post('/api/logout/');
    } catch {}
    localStorage.removeItem('civic_user');
    window.location.href = '/login/';
  });

  initFileUpload(document.getElementById('upload-area'));

  const evidenceInput = document.getElementById('evidence-files');
  const evidenceArea = document.getElementById('evidence-area');
  const evidenceList = document.getElementById('evidence-list');

  evidenceArea?.addEventListener('click', () => evidenceInput?.click());

  evidenceInput?.addEventListener('change', () => {
    if (!evidenceList || !evidenceInput.files) return;
    const names = Array.from(evidenceInput.files)
      .map((f) => f.name)
      .slice(0, 8);
    evidenceList.textContent = names.length ? names.join(' · ') : '';
  });

  document.getElementById('detect-btn')?.addEventListener('click', () => {
    const latEl = document.getElementById('lat');
    const lngEl = document.getElementById('lng');
    const labelEl = document.getElementById('location-label');
    detectLocation(latEl, lngEl, labelEl);
    setTimeout(() => refreshNearby(), 1200);
  });

  let dupTimeout;
  document.getElementById('title')?.addEventListener('input', (e) => {
    clearTimeout(dupTimeout);
    const val = e.target.value.trim();
    if (val.length < 4) return;
    dupTimeout = setTimeout(() => checkDuplicate(val), 700);
  });

  let aiTimeout;
  document.getElementById('description')?.addEventListener('input', (e) => {
    clearTimeout(aiTimeout);
    const val = e.target.value.trim();
    const hint = document.getElementById('ai-category-hint');
    if (val.length < 12) return;
    aiTimeout = setTimeout(async () => {
      try {
        const res = await API.get('/api/issues/suggest-category/?q=' + encodeURIComponent(val));
        if (res.category) {
          const sel = document.getElementById('category');
          if (sel && !sel.dataset.userLocked) {
            sel.value = res.category;
            if (hint) hint.textContent = 'AI routed to ' + res.category.replace(/_/g, ' ') + ' (editable).';
          }
        }
      } catch {}
    }, 600);
  });

  document.getElementById('category')?.addEventListener('change', (e) => {
    e.target.dataset.userLocked = '1';
    const hint = document.getElementById('ai-category-hint');
    if (hint) hint.textContent = 'Manual category selected.';
  });

  ['lat', 'lng'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => refreshNearby());
  });
  document.getElementById('description')?.addEventListener('input', autoSuggestCategory);

  function autoSuggestCategory() {
    const text = `${document.getElementById('title')?.value || ''} ${document.getElementById('description')?.value || ''}`.toLowerCase();
    let category = 'Others';
    if (text.match(/pothole|road|crack|asphalt/)) category = 'Potholes';
    else if (text.match(/garbage|waste|trash|dump/)) category = 'Garbage';
    else if (text.match(/light|streetlight|lamp/)) category = 'Streetlight Broken';
    else if (text.match(/water|leak|pipe|drain/)) category = 'Water Issue';
    const ai = document.getElementById('ai-category');
    if (ai) ai.textContent = category;
    const select = document.getElementById('category');
    if (select && !select.value) select.value = category;
  }

  async function checkNearbyIssues(lat, lng) {
    if (!lat || !lng) return;
    try {
      const issues = await API.get('/api/issues/');
      const hereLat = parseFloat(lat);
      const hereLng = parseFloat(lng);
      const near = issues.some((i) => i.lat && i.lng && haversineKm(hereLat, hereLng, i.lat, i.lng) <= 0.8);
      document.getElementById('nearby-alert')?.classList.toggle('show', near);
    } catch (_) {}
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  async function checkDuplicate(title) {
    const lat = document.getElementById('lat')?.value || '';
    const lng = document.getElementById('lng')?.value || '';
    try {
      const qs =
        '/api/issues/check-duplicate/?title=' +
        encodeURIComponent(title) +
        (lat ? '&lat=' + encodeURIComponent(lat) : '') +
        (lng ? '&lng=' + encodeURIComponent(lng) : '');
      const res = await API.get(qs);
      document.getElementById('dup-alert')?.classList.toggle('show', !!res.is_duplicate);
    } catch {}
  }

  async function refreshNearby() {
    const lat = document.getElementById('lat')?.value?.trim();
    const lng = document.getElementById('lng')?.value?.trim();
    const box = document.getElementById('nearby-alert');
    const txt = document.getElementById('nearby-alert-text');
    if (!lat || !lng) {
      box?.classList.remove('show');
      return;
    }
    try {
      const rows = await API.get(
        '/api/issues/nearby/?lat=' + encodeURIComponent(lat) + '&lng=' + encodeURIComponent(lng)
      );
      if (Array.isArray(rows) && rows.length) {
        box?.classList.add('show');
        if (txt) {
          txt.textContent =
            'Nearby reports: ' +
            rows
              .slice(0, 4)
              .map((r) => '#' + r.id + ' ' + r.title)
              .join('; ');
        }
      } else {
        box?.classList.remove('show');
      }
    } catch {
      box?.classList.remove('show');
    }
  }

  const form = document.getElementById('issue-form');
  const submitBtn = document.getElementById('submit-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.querySelectorAll('.form-error').forEach((el) => {
      el.textContent = '';
      el.classList.remove('show');
    });
    form.querySelectorAll('.form-input, .form-textarea').forEach((el) => (el.style.borderColor = ''));

    const title = form.querySelector('#title');
    const desc = form.querySelector('#description');
    const category = form.querySelector('#category');
    let valid = true;
    if (!title.value.trim()) {
      Validator.showError(title, 'Title is required.');
      valid = false;
    }
    if (!desc.value.trim()) {
      Validator.showError(desc, 'Description is required.');
      valid = false;
    }
    if (desc.value.trim().length < 20) {
      Validator.showError(desc, 'Please add a bit more detail (20+ characters).');
      valid = false;
    }
    if (!valid) return;

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Submitting…';

    try {
      const formData = new FormData(form);
      const res = await API.post('/report/', formData);
      document.getElementById('success-alert')?.classList.add('show');
      if (res.is_duplicate) {
        document.getElementById('dup-alert')?.classList.add('show');
        Toast.show('Saved — similar issues may already exist nearby.', 'warn');
      } else {
        document.getElementById('dup-alert')?.classList.remove('show');
        Toast.show('Issue submitted!', 'success');
      }
      setTimeout(() => (window.location.href = '/my-reports/'), 1600);
    } catch (err) {
      Toast.show(err.message || 'Submission failed.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Submit report';
    }
  });
});
