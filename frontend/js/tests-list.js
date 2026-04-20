/**
 * tests-list.js — Головний дашборд студента
 * ===========================================
 * ВАЖЛИВО: TOKEN_KEY, USER_KEY, getCurrentUser(), logout()
 * визначені в api.js. Тут їх НЕ оголошуємо.
 *
 * Потік:
 *  1. Перевірка авторизації
 *  2. Відображення імені юзера
 *  3. Паралельне завантаження: getTests() + getMyGroup()
 *  4. Рендер блоку групи (join / in-group)
 *  5. Рендер секції "Задані тести" (якщо є)
 *  6. Рендер всіх тестів, згрупованих по предметах
 */

// ============================================
// ІНІЦІАЛІЗАЦІЯ
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  // Перевірка авторизації — без TOKEN_KEY тут
  if (!localStorage.getItem(TOKEN_KEY)) {
    window.location.href = 'auth.html';
    return;
  }

  displayUserInfo();
  setupEventListeners();

  // Паралельне завантаження для швидкості
  await Promise.all([
    loadGroupStatus(),
    loadAndRenderTests(),
  ]);
});

// ============================================
// ВІДОБРАЖЕННЯ ЮЗЕРА
// ============================================

function displayUserInfo() {
  const user = getCurrentUser(); // з api.js
  if (!user) return;

  const name = user.full_name || user.email.split('@')[0];
  document.getElementById('user-name').textContent    = name;
  document.getElementById('hero-user-name').textContent = name;
}

function setupEventListeners() {
  document.getElementById('btn-logout').addEventListener('click', logout); // з api.js
}

// ============================================
// БЛОК ГРУПИ
// ============================================

/**
 * Завантажує статус групи і рендерить відповідний блок.
 * Також завантажує задані тести якщо студент в групі.
 */
async function loadGroupStatus() {
  const user = getCurrentUser();

  // Якщо user.group_id є в кеші — не робимо зайвий запит
  if (user?.group_id) {
    try {
      const myGroup = await api.getMyGroup();
      renderInGroupBlock(myGroup);
      renderAssignedTests(myGroup.assigned_tests);
    } catch {
      // Якщо щось пішло не так — показуємо join-форму
      renderJoinGroupBlock();
    }
  } else {
    renderJoinGroupBlock();
  }
}

/**
 * Рендерить блок "Ви в групі: [Назва]".
 */
function renderInGroupBlock(myGroup) {
  const block = document.getElementById('group-block');
  block.innerHTML = `
    <div class="group-status-block in-group">
      <span style="font-size:1.25rem;">✅</span>
      <span class="group-status-text">
        Ви у групі: <strong>${escapeHtml(myGroup.group_name)}</strong>
      </span>
    </div>
  `;
}

/**
 * Рендерить блок з формою приєднання до групи.
 */
function renderJoinGroupBlock() {
  const block = document.getElementById('group-block');
  block.innerHTML = `
    <div class="group-status-block">
      <span style="font-size:1.25rem;">🏫</span>
      <span class="group-status-text">Приєднайтесь до групи вчителя:</span>
      <div class="join-group-form">
        <input
          class="join-code-input"
          id="join-code-input"
          type="text"
          maxlength="10"
          placeholder="Код групи"
        >
        <button class="btn btn-primary" id="btn-join-group"
          style="padding:7px 16px; font-size:0.85rem;">
          Приєднатись
        </button>
      </div>
    </div>
  `;

  document.getElementById('btn-join-group').addEventListener('click', handleJoinGroup);
  document.getElementById('join-code-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleJoinGroup();
  });
}

/**
 * Обробляє клік "Приєднатись до групи".
 */
async function handleJoinGroup() {
  const input = document.getElementById('join-code-input');
  const code  = input?.value.trim().toUpperCase();

  if (!code || code.length < 4) {
    input?.focus();
    showToast('⚠ Введіть код групи', 'default');
    return;
  }

  const btn = document.getElementById('btn-join-group');
  btn.textContent = 'Приєднання...';
  btn.disabled    = true;

  try {
    const result = await api.joinGroup(code);

    showToast(`✅ ${result.message}`, 'success');

    // Оновлюємо кеш юзера з новим group_id (не знаємо ID — перезавантажуємо)
    try {
      const freshUser = await api.getMe();
      localStorage.setItem(USER_KEY, JSON.stringify(freshUser));
    } catch { /* не критично */ }

    // Перезавантажуємо блок групи
    await loadGroupStatus();

  } catch (err) {
    btn.textContent = 'Приєднатись';
    btn.disabled    = false;
    showToast(`❌ ${err.message}`, 'error');
  }
}

// ============================================
// ЗАДАНІ ТЕСТИ
// ============================================

/**
 * Рендерить секцію "Задані вчителем тести" вгорі сторінки.
 * @param {Array} assignedTests — масив AssignedTestItem
 */
function renderAssignedTests(assignedTests) {
  const section = document.getElementById('assigned-tests-section');
  const grid    = document.getElementById('assigned-tests-grid');

  if (!assignedTests || assignedTests.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  grid.innerHTML = assignedTests.map(test => buildTestCardHTML({
    ...test,
    is_locked:      false,
    is_premium:     false,
    description:    '',
    question_count: test.question_count,
  })).join('');

  // Обробники кліків
  grid.querySelectorAll('.test-card-btn').forEach(btn =>
    btn.addEventListener('click', () =>
      handleStartTest(parseInt(btn.dataset.testId, 10))));
}

// ============================================
// ЗАВАНТАЖЕННЯ ТА РЕНДЕР ВСІХ ТЕСТІВ
// ============================================

async function loadAndRenderTests() {
  const container = document.getElementById('subjects-container');
  renderSkeletons(container);

  try {
    const tests = await api.getTests();

    if (!tests || tests.length === 0) {
      container.innerHTML = '';
      document.getElementById('empty-state').style.display = 'flex';
      return;
    }

    const hasLocked = tests.some(t => t.is_locked);
    if (hasLocked) document.getElementById('beta-banner').style.display = 'inline-flex';

    renderSubjectSections(container, groupTestsBySubject(tests));

  } catch (err) {
    showErrorState(err);
  }
}

function groupTestsBySubject(tests) {
  return tests.reduce((acc, test) => {
    const key = test.subject.name;
    if (!acc[key]) acc[key] = { subject: test.subject, tests: [] };
    acc[key].tests.push(test);
    return acc;
  }, {});
}

function renderSubjectSections(container, grouped) {
  container.innerHTML = '';

  Object.values(grouped).forEach(({ subject, tests }) => {
    const section = document.createElement('div');
    section.className = 'subject-section';
    section.innerHTML = `
      <div class="subject-header">
        <span class="subject-icon">${subject.icon || '📚'}</span>
        <span class="subject-name">${subject.name}</span>
        <span class="subject-count">${tests.length} ${pluralize(tests.length, 'тест', 'тести', 'тестів')}</span>
      </div>
      <div class="tests-grid" id="grid-${subject.slug}"></div>
    `;
    container.appendChild(section);

    const grid = document.getElementById(`grid-${subject.slug}`);
    grid.innerHTML = tests.map(t => buildTestCardHTML(t)).join('');

    grid.querySelectorAll('.test-card-btn:not([disabled])').forEach(btn =>
      btn.addEventListener('click', () =>
        handleStartTest(parseInt(btn.dataset.testId, 10))));
  });
}

/**
 * Будує HTML картки тесту.
 * Використовується і для звичайних тестів, і для "Заданих".
 */
function buildTestCardHTML(test) {
  const duration    = formatDuration(test.duration);
  const accessBadge = test.is_premium
    ? '<span class="badge badge-premium">⭐ Преміум</span>'
    : '<span class="badge badge-free">✓ Безкоштовно</span>';

  const buttonHTML = test.is_locked
    ? `<button class="btn-locked test-card-btn" disabled data-test-id="${test.id}">🔒 Відкриється після релізу</button>`
    : `<button class="btn-start test-card-btn" data-test-id="${test.id}">Почати тест →</button>`;

  return `
    <div class="test-card ${test.is_locked ? 'test-card--locked' : ''}">
      <div class="test-card-header">
        <span class="test-subject-badge">
          ${test.subject?.icon || '📝'} ${test.subject?.name || ''}
        </span>
        ${accessBadge}
      </div>
      <h2 class="test-card-title">${escapeHtml(test.title)}</h2>
      ${test.description
        ? `<p class="test-card-desc">${escapeHtml(test.description)}</p>`
        : ''}
      <div class="test-card-meta">
        <span class="meta-item">⏱ ${duration}</span>
        <span class="meta-item">📋 ${test.question_count} ${pluralize(test.question_count, 'питання', 'питання', 'питань')}</span>
      </div>
      <div class="test-card-footer">${buttonHTML}</div>
    </div>
  `;
}

// ============================================
// СТАРТ ТЕСТУ
// ============================================

async function handleStartTest(testId) {
  const btn = document.querySelector(`[data-test-id="${testId}"]`);
  if (!btn || btn.disabled) return;

  const originalText = btn.textContent;
  btn.textContent = 'Завантаження...';
  btn.disabled    = true;

  try {
    const session = await api.createSession(testId);
    localStorage.setItem('active_session_token', session.session_token);
    localStorage.setItem('active_test_id', String(testId));
    window.location.href = `test.html?session=${session.session_token}`;
  } catch (err) {
    btn.textContent = originalText;
    btn.disabled    = false;
    showToast(`❌ ${err instanceof ApiError ? err.message : 'Помилка старту тесту'}`, 'error');
  }
}

// ============================================
// СТАНИ UI
// ============================================

function renderSkeletons(container) {
  container.innerHTML = Array(2).fill(`
    <div class="skeleton-subject">
      <div class="skeleton-subject-header">
        <div class="skeleton-icon"></div>
        <div class="skeleton-text"></div>
      </div>
      <div class="tests-grid">
        ${Array(3).fill('<div class="test-card skeleton" style="height:160px;"></div>').join('')}
      </div>
    </div>
  `).join('');
}

function showErrorState(err) {
  document.getElementById('subjects-container').style.display = 'none';
  const msg = err instanceof ApiError && err.status === 0
    ? 'Не вдалося підключитися до сервера.'
    : `Помилка: ${err?.message || 'невідома'}`;
  document.getElementById('error-message').textContent = msg;
  document.getElementById('error-state').style.display = 'flex';
}

// ============================================
// УТИЛІТИ
// ============================================

function formatDuration(seconds) {
  if (seconds < 3600) return `${Math.round(seconds / 60)} хв`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h} год ${m} хв` : `${h} год`;
}

function pluralize(count, one, few, many) {
  const m10 = count % 10, m100 = count % 100;
  if (m100 >= 11 && m100 <= 14) return many;
  if (m10 === 1)                 return one;
  if (m10 >= 2 && m10 <= 4)     return few;
  return many;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(message, type = 'default') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type !== 'default' ? type : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
