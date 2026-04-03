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
    autoSuggestCategory();
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
    try {
      const res = await API.get(`/api/issues/check-duplicate/?title=${encodeURIComponent(title)}`); // Django endpoint
      const dupAlert = document.getElementById('dup-alert');
      dupAlert.classList.toggle('show', !!res.is_duplicate);
    } catch (err) {
      console.error('Duplicate check failed', err);
    }
  }

  /* ---------- Form submit ---------- */
  const form = document.getElementById('issue-form');
  const submitBtn = document.getElementById('submit-btn');

  form.addEventListener('submit', async e => {
    e.preventDefault();

    // Clear previous errors
    form.querySelectorAll('.form-error').forEach(el => {
      el.textContent = '';
      el.classList.remove('show');
    });
    form.querySelectorAll('.form-input, .form-textarea, .form-select').forEach(el => el.style.borderColor = '');

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
    if (!category.value) {
      Validator.showError(category, 'Please select a category.');
      valid = false;
    }
    if (!valid) return;

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Submitting…';

    try {
      const formData = new FormData(form);
      formData.set('title', `[${category.value}] ${title.value.trim()}`);
      await checkNearbyIssues(formData.get('lat'), formData.get('lng'));

      // Submit to Django backend
      const res = await API.post('/report/', formData);

      // Handle duplicate in response
      if (res.is_duplicate) {
        document.getElementById('dup-alert')?.classList.add('show');
        Toast.show('⚠️ Possible duplicate detected!', 'warn');
      } else {
        document.getElementById('success-alert')?.classList.add('show');
        document.getElementById('dup-alert')?.classList.remove('show');
        Toast.show('Issue submitted successfully! ✅', 'success');

        // Redirect to My Reports page
        setTimeout(() => window.location.href = '/my-reports/', 1800);
      }

    } catch (err) {
      console.error(err);
      Toast.show(err.message || 'Submission failed. Try again.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '🚀 Submit Issue';
    }
  });

});