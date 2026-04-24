/**
 * api.js — Сервісний шар + глобальні auth-утиліти
 * =================================================
 * АРХІТЕКТУРНЕ ПРАВИЛО:
 * Цей файл — ЄДИНЕ місце де оголошуються:
 *   - TOKEN_KEY, USER_KEY (ключі localStorage)
 *   - getCurrentUser()    (читає дані юзера)
 *   - logout()            (очищає сесію)
 * Жоден інший JS-файл не повинен їх оголошувати.
 * Вони доступні глобально, бо api.js завжди підключається першим.
 */

// ============================================
// КОНФІГУРАЦІЯ
// ============================================

const BASE_URL  = 'https://fckinnmt.onrender.com';

// Ключі localStorage — ЄДИНЕ оголошення у всьому проєкті
const TOKEN_KEY = 'nmt_token';
const USER_KEY  = 'nmt_user';

// ============================================
// ГЛОБАЛЬНІ AUTH-УТИЛІТИ
// (використовуються у auth.js, tests-list.js, teacher.js тощо)
// ============================================

/**
 * Повертає збережені дані юзера з localStorage або null.
 */
function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}

/**
 * Виходить з акаунту: очищає localStorage і робить redirect.
 */
function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.location.href = 'auth.html';
}

// ============================================
// БАЗОВИЙ HTTP-КЛІЄНТ
// ============================================

async function request(path, options = {}) {
  const url   = `${BASE_URL}${path}`;
  const token = localStorage.getItem(TOKEN_KEY);

  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
  };

  const mergedOptions = {
    ...defaultOptions,
    ...options,
    headers: { ...defaultOptions.headers, ...options.headers },
  };

  let response;
  try {
    response = await fetch(url, mergedOptions);
  } catch {
    throw new ApiError('Сервер недоступний. Перевірте підключення.', 0, 'NETWORK_ERROR');
  }

  let data;
  try { data = await response.json(); } catch { data = null; }

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      window.location.href = 'auth.html';
      return;
    }
    const message = data?.detail?.message || data?.detail || 'Невідома помилка сервера';
    const code    = data?.detail?.code    || 'SERVER_ERROR';
    throw new ApiError(message, response.status, code);
  }

  return data;
}

// ============================================
// КЛАС ПОМИЛКИ
// ============================================

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name   = 'ApiError';
    this.status = status;
    this.code   = code;
  }
}

// ============================================
// API-МЕТОДИ
// ============================================

const api = {

  // --- ТЕСТИ ---
  getTests(subjectSlug = null) {
    const q = subjectSlug ? `?subject_slug=${subjectSlug}` : '';
    return request(`/api/tests/${q}`);
  },

  getTest(testId) {
    return request(`/api/tests/${testId}`);
  },

  // --- СЕСІЇ ---
  createSession(testId) {
    return request('/api/sessions/', {
      method: 'POST',
      body: JSON.stringify({ test_id: testId }),
    });
  },

  saveAnswer(sessionToken, answer) {
    return request(`/api/sessions/${sessionToken}/answer`, {
      method: 'POST',
      body: JSON.stringify(answer),
    });
  },

  finishSession(sessionToken) {
    return request(`/api/sessions/${sessionToken}/finish`, { method: 'POST' });
  },

  // --- РЕПОРТИ ---
  sendReport(report) {
    return request('/api/reports/', {
      method: 'POST',
      body: JSON.stringify(report),
    });
  },

  // --- АВТОРИЗАЦІЯ ---
  login(email, password) {
    const formData = new URLSearchParams();
    formData.append('username', email);
    formData.append('password', password);
    return request('/api/auth/token', {
      method: 'POST',
      body: formData,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  },

  /**
   * Реєстрація. Приймає { email, password, full_name, role }.
   * role: 'student' | 'teacher' (default 'student')
   */
  register(userData) {
    return request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  },

  getMe() {
    return request('/api/auth/me');
  },

  // --- ВЧИТЕЛЬ ---
  createGroup(name) {
    return request('/api/teachers/groups', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  getMyGroups() {
    return request('/api/teachers/groups');
  },

  getStudentsStats() {
    return request('/api/teachers/stats');
  },

  /**
   * Задати тест групі.
   * @param {number} groupId
   * @param {number} testId
   */
  assignTestToGroup(groupId, testId) {
    return request(`/api/teachers/groups/${groupId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ test_id: testId }),
    });
  },

  // --- СТУДЕНТ ---
  joinGroup(inviteCode) {
    return request(`/api/students/join/${inviteCode.trim().toUpperCase()}`, {
      method: 'POST',
    });
  },

  /**
   * Отримати дані своєї групи + задані тести.
   * Повертає { group, assigned_tests } або null якщо не в групі.
   */
  getMyGroup() {
    return request('/api/students/my-group');
  },

  // --- УТИЛІТИ ---
  async healthCheck() {
    try { await request('/api/health'); return true; }
    catch { return false; }
  },
};
