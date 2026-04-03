/* login.js */

document.addEventListener('DOMContentLoaded', () => {
  const form      = document.getElementById('login-form');
  const submitBtn = document.getElementById('submit-btn');
  const alertBox  = document.getElementById('alert-box');
  const alertMsg  = document.getElementById('alert-msg');

  function showAlert(msg) {
    alertMsg.textContent = msg;
    alertBox.classList.add('show');
  }
  function hideAlert() { alertBox.classList.remove('show'); }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    hideAlert();

    const username = form.querySelector('#username');
    const password = form.querySelector('#password');
    const remember = form.querySelector('#remember-me');

    // Clear errors
    form.querySelectorAll('.form-error').forEach(el => {
      el.textContent = ''; el.classList.remove('show');
    });
    form.querySelectorAll('.form-input').forEach(el => el.style.borderColor = '');

    let valid = true;
    if (!username.value.trim()) {
      Validator.showError(username, 'Username or email is required.');
      valid = false;
    }
    if (!password.value.trim()) {
      Validator.showError(password, 'Password is required.');
      valid = false;
    }
    if (!valid) return;

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Signing in…';

    try {
      const data = await API.post('/api/login/', {
        username: username.value.trim(),
        password: password.value,
        remember: remember.checked,
      });
      if (remember.checked) {
        localStorage.setItem('civic_user', JSON.stringify({ username: data.username }));
      }
      Toast.show('Welcome back! 👋', 'success');
      setTimeout(() => { window.location.href = '/dashboard/'; }, 900);
    } catch (err) {
      showAlert(err.message || 'Invalid credentials. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Sign In';
    }
  });
});
