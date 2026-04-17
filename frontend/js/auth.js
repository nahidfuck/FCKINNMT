/**
 * auth.js — Логіка сторінки авторизації
 * =======================================
 * Відповідає за:
 * 1. Перемикання між вкладками Вхід / Реєстрація
 * 2. Клієнтська валідація форм (до запиту на сервер)
 * 3. Запити до API (через api.js)
 * 4. Збереження токена і redirect після успіху
 */

// ============================================
// КОНСТАНТИ
// ============================================

// Ключ у localStorage де зберігаємо JWT токен
const TOKEN_KEY = 'nmt_token';

// Ключ де зберігаємо дані юзера (щоб не декодувати токен щоразу)
const USER_KEY = 'nmt_user';

// Куди redirect після успішного входу
const REDIRECT_AFTER_LOGIN = 'tests.html';

// ============================================
// ІНІЦІАЛІЗАЦІЯ
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  // Якщо юзер вже авторизований — одразу на головну
  if (localStorage.getItem(TOKEN_KEY)) {
    window.location.href = REDIRECT_AFTER_LOGIN;
    return;
  }

  setupTabs();
  setupForms();
});

// ============================================
// ВКЛАДКИ
// ============================================

function setupTabs() {
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
}

/**
 * Перемикає активну вкладку.
 * @param {'login'|'register'} tabName
 */
function switchTab(tabName) {
  // Оновлюємо кнопки вкладок
  document.querySelectorAll('.auth-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });

  // Показуємо відповідну панель
  document.querySelectorAll('.auth-panel').forEach(p => {
    p.classList.toggle('active', p.id === `panel-${tabName}`);
  });

  // Скидаємо помилки при переключенні
  clearErrors();
}

// ============================================
// ФОРМИ
// ============================================

function setupForms() {
  document.getElementById('btn-login').addEventListener('click', handleLogin);
  document.getElementById('btn-register').addEventListener('click', handleRegister);

  // Submit по Enter в полях
  ['login-email', 'login-password'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') handleLogin();
    });
  });

  ['reg-email', 'reg-password', 'reg-name'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') handleRegister();
    });
  });
}

/**
 * Обробляє форму входу.
 */
async function handleLogin() {
  clearErrors();

  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  // Клієнтська валідація
  let isValid = true;
  if (!isValidEmail(email)) {
    showFieldError('login-email', 'Введіть коректний email');
    isValid = false;
  }
  if (password.length < 1) {
    showFieldError('login-password', 'Введіть пароль');
    isValid = false;
  }
  if (!isValid) return;

  const btn = document.getElementById('btn-login');
  setButtonLoading(btn, true);

  try {
    // /api/auth/token приймає form-data (OAuth2), не JSON
    // Тому використовуємо окремий метод api.login
    const result = await api.login(email, password);
    onAuthSuccess(result);

  } catch (err) {
    const message = err instanceof ApiError
      ? err.message
      : 'Помилка підключення до сервера';
    showBanner(message);
  } finally {
    setButtonLoading(btn, false);
  }
}

/**
 * Обробляє форму реєстрації.
 */
async function handleRegister() {
  clearErrors();

  const name     = document.getElementById('reg-name').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;

  // Клієнтська валідація
  let isValid = true;
  if (!isValidEmail(email)) {
    showFieldError('reg-email', 'Введіть коректний email');
    isValid = false;
  }
  if (password.length < 8) {
    showFieldError('reg-password', 'Пароль має містити мінімум 8 символів');
    isValid = false;
  }
  if (!isValid) return;

  const btn = document.getElementById('btn-register');
  setButtonLoading(btn, true);

  try {
    const result = await api.register({ email, password, full_name: name || null });
    onAuthSuccess(result);

  } catch (err) {
    const message = err instanceof ApiError
      ? err.message
      : 'Помилка підключення до сервера';
    showBanner(message);
  } finally {
    setButtonLoading(btn, false);
  }
}

// ============================================
// ПІСЛЯ УСПІШНОЇ АВТОРИЗАЦІЇ
// ============================================

/**
 * Зберігає токен і дані юзера, робить redirect.
 * @param {{ access_token: string, user: object }} result
 */
function onAuthSuccess(result) {
  // Зберігаємо токен — api.js підхопить його автоматично
  localStorage.setItem(TOKEN_KEY, result.access_token);

  // Зберігаємо дані юзера для відображення в UI (ім'я, роль)
  localStorage.setItem(USER_KEY, JSON.stringify(result.user));

  showToast(`👋 Вітаємо, ${result.user.full_name || result.user.email}!`, 'success');

  // Невелика затримка щоб toast встиг показатися
  setTimeout(() => {
    window.location.href = REDIRECT_AFTER_LOGIN;
  }, 800);
}

// ============================================
// УТИЛІТИ UI
// ============================================

function showFieldError(fieldId, message) {
  document.getElementById(fieldId)?.classList.add('error');
  const errEl = document.getElementById(`${fieldId}-error`);
  if (errEl) {
    errEl.textContent = message;
    errEl.classList.add('visible');
  }
}

function showBanner(message) {
  const banner = document.getElementById('auth-error');
  banner.textContent = message;
  banner.classList.add('visible');
}

function clearErrors() {
  document.querySelectorAll('.auth-input').forEach(el => el.classList.remove('error'));
  document.querySelectorAll('.field-error').forEach(el => {
    el.textContent = '';
    el.classList.remove('visible');
  });
  document.getElementById('auth-error').classList.remove('visible');
}

function setButtonLoading(btn, loading) {
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

// ============================================
// ПУБЛІЧНІ УТИЛІТИ (для інших JS-файлів)
// ============================================

/**
 * Повертає збережені дані юзера або null.
 * Використовуй у tests-list.js для відображення імені в шапці.
 */
function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch { return null; }
}

/**
 * Виходить з акаунту: очищає токен і redirect на auth.html.
 */
function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.location.href = 'auth.html';
}
