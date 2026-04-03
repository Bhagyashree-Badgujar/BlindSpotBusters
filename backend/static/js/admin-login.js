/* admin-login.js */

document.addEventListener('DOMContentLoaded', () => {
  const form      = document.getElementById('admin-login-form');
  const submitBtn = document.getElementById('submit-btn');
  const alertBox  = document.getElementById('alert-box');
  const alertMsg  = document.getElementById('alert-msg');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    alertBox.classList.remove('show');

    const pass = document.getElementById('admin-pass');
    if (!pass.value.trim()) {
      Validator.showError(pass, 'Password is required.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Authenticating…';

    try {
      await API.post('/api/admin-login/', { password: pass.value });
      Toast.show('Welcome, Admin! 🏛️', 'success');
      setTimeout(() => { window.location.href = '/admin-dashboard/'; }, 900);
    } catch (err) {
      alertMsg.textContent = err.message || 'Invalid admin password.';
      alertBox.classList.add('show');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '🔐 Access Admin Panel';
    }
  });
});
