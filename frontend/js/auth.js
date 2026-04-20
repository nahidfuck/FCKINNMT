/**
 * auth.js — Логіка сторінки авторизації
 * =======================================
 * ВАЖЛИВО: TOKEN_KEY, USER_KEY, getCurrentUser(), logout()
 * оголошені в api.js і доступні глобально.
 * Цей файл їх НЕ оголошує — тільки використовує.
 */

// ============================================
// ІНІЦІАЛІЗАЦІЯ
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  // Якщо вже авторизований — редірект залежно від ролі
  if (localStorage.getItem(TOKEN_KEY)) {
    redirectByRole(getCurrentUser()?.role);
    return;
  }

  setupTabs();
  setupForms();
});

// ============================================
// ВКЛАДКИ
// ============================================

function setupTabs() {
  document.querySelectorAll('.auth-tab').forEach(tab =>
    tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
}

function switchTab(tabName) {
  document.querySelectorAll('.auth-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.auth-panel').forEach(p =>
    p.classList.toggle('active', p.id === `panel-${tabName}`));
  clearErrors();
}

// ============================================
// ФОРМИ
// ============================================

function setupForms() {
  document.getElementById('btn-login').addEventListener('click', handleLogin);
  document.getElementById('btn-register').addEventListener('click', handleRegister);

  ['login-email', 'login-password'].forEach(id =>
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') handleLogin();
    }));

  ['reg-name', 'reg-email', 'reg-password'].forEach(id =>
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') handleRegister();
    }));
}

async function handleLogin() {
  clearErrors();
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  let valid = true;
  if (!isValidEmail(email))  { showFieldError('login-email',    'Введіть коректний email'); valid = false; }
  if (!password.length)      { showFieldError('login-password', 'Введіть пароль');          valid = false; }
  if (!valid) return;

  const btn = document.getElementById('btn-login');
  setLoading(btn, true);
  try {
    const result = await api.login(email, password);
    onAuthSuccess(result);
  } catch (err) {
    showBanner(err instanceof ApiError ? err.message : 'Помилка підключення до сервера');
  } finally {
    setLoading(btn, false);
  }
}

async function handleRegister() {
  clearErrors();
  const name     = document.getElementById('reg-name').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;

  // Зчитуємо вибрану роль з radio-кнопок
  const roleEl   = document.querySelector('input[name="reg-role"]:checked');
  const role     = roleEl ? roleEl.value : 'student';

  let valid = true;
  if (!isValidEmail(email))    { showFieldError('reg-email',    'Введіть коректний email');           valid = false; }
  if (password.length < 8)     { showFieldError('reg-password', 'Пароль має містити мінімум 8 символів'); valid = false; }
  if (!valid) return;

  const btn = document.getElementById('btn-register');
  setLoading(btn, true);
  try {
    // Передаємо role в api.register
    const result = await api.register({
      email,
      password,
      full_name: name || null,
      role,               // 'student' або 'teacher'
    });
    onAuthSuccess(result);
  } catch (err) {
    showBanner(err instanceof ApiError ? err.message : 'Помилка підключення до сервера');
  } finally {
    setLoading(btn, false);
  }
}

// ============================================
// ПІСЛЯ УСПІШНОЇ АВТОРИЗАЦІЇ
// ============================================

function onAuthSuccess(result) {
  localStorage.setItem(TOKEN_KEY, result.access_token);
  localStorage.setItem(USER_KEY, JSON.stringify(result.user));

  showToast(`👋 Вітаємо, ${result.user.full_name || result.user.email}!`, 'success');

  setTimeout(() => redirectByRole(result.user.role), 800);
}

/**
 * Редірект залежно від ролі юзера.
 * Єдине місце де визначається куди йде student/teacher.
 */
function redirectByRole(role) {
  window.location.href = (role === 'teacher' || role === 'admin')
    ? 'teacher-dashboard.html'
    : 'tests.html';
}

// ============================================
// УТИЛІТИ UI
// ============================================

function showFieldError(fieldId, message) {
  document.getElementById(fieldId)?.classList.add('error');
  const el = document.getElementById(`${fieldId}-error`);
  if (el) { el.textContent = message; el.classList.add('visible'); }
}

function showBanner(message) {
  const el = document.getElementById('auth-error');
  el.textContent = message;
  el.classList.add('visible');
}

function clearErrors() {
  document.querySelectorAll('.auth-input').forEach(el => el.classList.remove('error'));
  document.querySelectorAll('.field-error').forEach(el => {
    el.textContent = '';
    el.classList.remove('visible');
  });
  document.getElementById('auth-error')?.classList.remove('visible');
}

function setLoading(btn, loading) {
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function showToast(message, type = 'default') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type !== 'default' ? type : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
