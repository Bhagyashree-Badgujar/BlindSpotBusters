/* register.js */

document.addEventListener('DOMContentLoaded', () => {
  const form      = document.getElementById('register-form');
  const submitBtn = document.getElementById('submit-btn');
  const alertBox  = document.getElementById('alert-box');
  const alertMsg  = document.getElementById('alert-msg');

  function showAlert(msg) {
    alertMsg.textContent = msg;
    alertBox.classList.add('show');
  }

  function hideAlert() {
    alertBox.classList.remove('show');
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    hideAlert();

    const username = form.querySelector('#username');
    const email    = form.querySelector('#email');
    const password = form.querySelector('#password');
    const confirm  = form.querySelector('#confirm-password');

    // Clear previous errors
    form.querySelectorAll('.form-error').forEach(el => {
      el.textContent = '';
      el.classList.remove('show');
    });
    form.querySelectorAll('.form-input').forEach(el => el.style.borderColor = '');

    let valid = true;

    // Validation
    if (!username.value.trim()) {
      Validator.showError(username, 'Username is required.');
      valid = false;
    }
    if (!Validator.email(email)) valid = false;
    if (password.value.length < 8) {
      Validator.showError(password, 'Password must be at least 8 characters.');
      valid = false;
    }
    if (!Validator.passwordMatch(password, confirm)) valid = false;

    if (!valid) return;

    // Disable button & show spinner
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Creating account…';

    try {
      // Use Django URL routing
      await API.post('/api/register/', {
        username: username.value.trim(),
        email:    email.value.trim(),
        password: password.value,
      });

      Toast.show('Account created! Redirecting…', 'success');
      localStorage.setItem('civic_user', JSON.stringify({ username: username.value.trim() }));
      setTimeout(() => { window.location.href = '/dashboard/'; }, 1200);

    } catch (err) {
      showAlert(err.message || 'Registration failed. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Create Account';
    }
  });
});