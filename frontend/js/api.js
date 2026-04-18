/**
 * api.js — Сервісний шар для роботи з бекендом
 * ==============================================
 * Це єдине місце де живуть fetch-запити.
 * Компоненти (tests-list.js, test-simulator.js) НЕ пишуть fetch напряму —
 * вони викликають функції звідси.
 *
 * Переваги такого підходу:
 * - Якщо змінився URL бекенду → міняємо тільки тут (BASE_URL)
 * - Вся обробка помилок в одному місці
 * - Легко підмінити на mock для тестів
 *
 * Всі функції — async, повертають або дані, або кидають Error.
 */

// ============================================
// КОНФІГУРАЦІЯ
// ============================================

/**
 * Базовий URL бекенду.
 * Під час розробки: http://localhost:8000
 * На продакшені: https://api.nmt-platform.ua (зміниш тут одним рядком)
 */
const BASE_URL = 'http://localhost:8000';

// Ключ в localStorage де зберігається JWT токен (той самий що в auth.js)
const TOKEN_KEY = 'nmt_token';

// ============================================
// БАЗОВИЙ HTTP-КЛІЄНТ
// ============================================

/**
 * Внутрішня функція-обгортка над fetch.
 * Додає базові заголовки, обробляє HTTP-помилки.
 *
 * @param {string} path   — шлях відносно BASE_URL (наприклад '/api/tests')
 * @param {object} options — опції fetch (method, body тощо)
 * @returns {Promise<any>} — розпарсений JSON
 * @throws {ApiError} — при HTTP-помилці або мережевій проблемі
 */
async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;

  // Читаємо токен з localStorage (зберігається при логіні в auth.js)
  const token = localStorage.getItem(TOKEN_KEY);

  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      // Якщо токен є — додаємо заголовок авторизації до КОЖНОГО запиту.
      // Сервер перевірить його у залежності get_current_user.
      // Якщо токена нема (гість) — заголовок просто відсутній.
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
  };

  // Зливаємо дефолтні опції з переданими
  const mergedOptions = {
    ...defaultOptions,
    ...options,
    headers: { ...defaultOptions.headers, ...options.headers },
  };

  let response;
  try {
    response = await fetch(url, mergedOptions);
  } catch (networkError) {
    // fetch кидає помилку тільки при мережевій проблемі (сервер недоступний)
    throw new ApiError(
      'Сервер недоступний. Перевірте підключення до інтернету.',
      0, // status 0 = мережева помилка
      'NETWORK_ERROR'
    );
  }

  // Парсимо тіло відповіді (навіть для помилок — там може бути опис)
  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  // Якщо статус не 2xx — кидаємо помилку
  if (!response.ok) {
    // 401 Unauthorized — токен протухлий або невалідний.
    // Очищаємо localStorage і відправляємо на сторінку логіну.
    if (response.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem('nmt_user');
      window.location.href = 'auth.html';
      return; // Зупиняємо виконання — відбудеться redirect
    }
    const message = data?.detail?.message || data?.detail || 'Невідома помилка сервера';
    const code    = data?.detail?.code    || 'SERVER_ERROR';
    throw new ApiError(message, response.status, code);
  }

  return data;
}

// ============================================
// КЛАС ПОМИЛКИ API
// ============================================

/**
 * Кастомний клас помилки для API-запитів.
 * Дозволяє розрізняти API-помилки від інших помилок JavaScript.
 *
 * Використання:
 *   try {
 *     const data = await api.getTests();
 *   } catch (err) {
 *     if (err instanceof ApiError && err.code === 'TEST_LOCKED') {
 *       // специфічна обробка
 *     }
 *   }
 */
class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name    = 'ApiError';
    this.status  = status; // HTTP статус-код (403, 404, 500...)
    this.code    = code;   // Наш кастомний код ('TEST_LOCKED', 'NETWORK_ERROR'...)
  }
}

// ============================================
// API-МЕТОДИ
// ============================================

const api = {

  // --- ТЕСТИ ---

  /**
   * Отримати список всіх тестів.
   * @param {string|null} subjectSlug — фільтр по предмету ('math', 'ukrainian'...)
   * @returns {Promise<TestListItem[]>}
   */
  getTests(subjectSlug = null) {
    const query = subjectSlug ? `?subject_slug=${subjectSlug}` : '';
    return request(`/api/tests/${query}`);
  },

  /**
   * Отримати деталі тесту (з питаннями, без правильних відповідей).
   * @param {number} testId
   * @returns {Promise<TestDetail>}
   * @throws {ApiError} з code='TEST_LOCKED' якщо тест заблокований
   */
  getTest(testId) {
    return request(`/api/tests/${testId}`);
  },

  // --- СЕСІЇ ---

  /**
   * Почати нову сесію проходження тесту.
   * @param {number} testId
   * @returns {Promise<{id, session_token, time_left, ...}>}
   */
  createSession(testId) {
    return request('/api/sessions/', {
      method: 'POST',
      body: JSON.stringify({ test_id: testId }),
    });
  },

  /**
   * Зберегти відповідь на питання.
   * @param {string} sessionToken
   * @param {object} answer — { question_id, answer_option_id, is_skipped, time_left }
   */
  saveAnswer(sessionToken, answer) {
    return request(`/api/sessions/${sessionToken}/answer`, {
      method: 'POST',
      body: JSON.stringify(answer),
    });
  },

  /**
   * Завершити тест і отримати результати.
   * @param {string} sessionToken
   * @returns {Promise<SessionResult>}
   */
  finishSession(sessionToken) {
    return request(`/api/sessions/${sessionToken}/finish`, {
      method: 'POST',
    });
  },

  // --- РЕПОРТИ ---

  /**
   * Надіслати репорт про помилку в питанні.
   * @param {object} report — { question_id, report_type, comment }
   */
  sendReport(report) {
    return request('/api/reports/', {
      method: 'POST',
      body: JSON.stringify(report),
    });
  },

  // --- АВТОРИЗАЦІЯ ---

  /**
   * Логін через email + пароль.
   * ВАЖЛИВО: /api/auth/token приймає form-data (не JSON!) — стандарт OAuth2.
   * @returns {Promise<{access_token, user}>}
   */
  login(email, password) {
    // FormData або URLSearchParams — FastAPI OAuth2PasswordRequestForm вимагає саме це
    const formData = new URLSearchParams();
    formData.append('username', email); // OAuth2 стандарт: поле називається username
    formData.append('password', password);

    // Не передаємо 'Content-Type': 'application/json' — форма має свій тип
    return request('/api/auth/token', {
      method: 'POST',
      body: formData,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  },

  /**
   * Реєстрація нового акаунту.
   * @param {{ email, password, full_name }} userData
   * @returns {Promise<{access_token, user}>}
   */
  register(userData) {
    return request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  },

  /**
   * Отримати дані поточного авторизованого юзера.
   * Вимагає валідний токен в localStorage.
   */
  getMe() {
    return request('/api/auth/me');
  },

  // --- УТИЛІТИ ---

  /**
   * Перевірити чи бекенд доступний.
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    try {
      await request('/api/health');
      return true;
    } catch {
      return false;
    }
  },
};

const USER_KEY = 'nmt_user';

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch { return null; }
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.location.href = 'auth.html';
}