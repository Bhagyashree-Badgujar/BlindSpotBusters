document.addEventListener('DOMContentLoaded', () => {
  const themeToggle = document.getElementById('theme-toggle');
  const root = document.documentElement;
  const storedTheme = localStorage.getItem('civiclens_theme');
  if (storedTheme === 'dark') root.classList.add('theme-dark');

  if (themeToggle) {
    themeToggle.textContent = root.classList.contains('theme-dark') ? 'Light' : 'Dark';
    themeToggle.addEventListener('click', () => {
      root.classList.toggle('theme-dark');
      const dark = root.classList.contains('theme-dark');
      localStorage.setItem('civiclens_theme', dark ? 'dark' : 'light');
      themeToggle.textContent = dark ? 'Light' : 'Dark';
    });
  }

  async function refreshLandingStats() {
    try {
      const issues = await API.get('/api/issues/');
      const total = issues.length;
      const resolved = issues.filter((i) => i.status === 'resolved').length;
      const active = issues.filter((i) => i.status !== 'resolved').length;
      document.getElementById('landing-total').textContent = total;
      document.getElementById('landing-resolved').textContent = resolved;
      document.getElementById('landing-active').textContent = active;
    } catch (_) {}
  }

  refreshLandingStats();
  setInterval(refreshLandingStats, 12000);
});
