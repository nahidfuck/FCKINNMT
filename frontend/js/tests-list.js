/**
 * tests-list.js — Логіка сторінки зі списком тестів
 * ===================================================
 * Ця сторінка — головна для студента.
 * Показує всі тести: безкоштовні (доступні) та платні (з замком).
 *
 * Потік:
 * 1. Завантажуємо список тестів з API
 * 2. Рендеримо картки — для кожного тесту своя картка
 * 3. Клік на доступний тест → POST /sessions → переходимо на test.html
 * 4. Клік на заблокований тест → показуємо toast "Скоро"
 */

// ============================================
// ІНІЦІАЛІЗАЦІЯ
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  await loadAndRenderTests();
  setupFilterListeners();
});

// ============================================
// ЗАВАНТАЖЕННЯ ТА РЕНДЕР
// ============================================

/**
 * Головна функція: завантажує тести і рендерить їх.
 * @param {string|null} subjectSlug — фільтр по предмету
 */
async function loadAndRenderTests(subjectSlug = null) {
  const grid = document.getElementById('tests-grid');

  // Показуємо скелетон-завантаження
  renderSkeletons(grid);

  try {
    const tests = await api.getTests(subjectSlug);
    renderTestCards(grid, tests);
  } catch (err) {
    renderError(grid, err);
  }
}

/**
 * Рендерить скелетон-картки поки дані завантажуються.
 * Це краще ніж спінер — одразу видно скільки тестів буде.
 */
function renderSkeletons(container) {
  container.innerHTML = Array(6).fill(0).map(() => `
    <div class="test-card skeleton">
      <div class="skeleton-badge"></div>
      <div class="skeleton-line long"></div>
      <div class="skeleton-line short"></div>
      <div class="skeleton-line medium"></div>
      <div class="skeleton-btn"></div>
    </div>
  `).join('');
}

/**
 * Рендерить картки тестів.
 * @param {HTMLElement} container
 * @param {Array} tests — масив тестів з API
 */
function renderTestCards(container, tests) {
  if (tests.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <p>Тестів не знайдено</p>
      </div>
    `;
    return;
  }

  container.innerHTML = tests.map(test => buildTestCardHTML(test)).join('');

  // Підключаємо обробники кліків на картки
  container.querySelectorAll('.test-card-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const testId    = parseInt(btn.dataset.testId, 10);
      const isLocked  = btn.dataset.locked === 'true';
      handleTestClick(testId, isLocked);
    });
  });
}

/**
 * Будує HTML для однієї картки тесту.
 * @param {object} test — об'єкт тесту з API
 * @returns {string} HTML-рядок
 */
function buildTestCardHTML(test) {
  const durationText = formatDuration(test.duration);
  const subjectIcon  = test.subject.icon || '📝';

  // Кнопка залежить від стану тесту
  const buttonHTML = test.is_locked
    ? `<button class="test-card-btn btn-locked" data-test-id="${test.id}" data-locked="true">
         🔒 Відкриється після релізу
       </button>`
    : `<button class="test-card-btn btn-start" data-test-id="${test.id}" data-locked="false">
         Почати тест →
       </button>`;

  // Бейдж "Безкоштовно" або "Преміум"
  const accessBadge = test.is_premium
    ? `<span class="badge badge-premium">⭐ Преміум</span>`
    : `<span class="badge badge-free">✓ Безкоштовно</span>`;

  return `
    <div class="test-card ${test.is_locked ? 'test-card--locked' : ''}">
      <div class="test-card-header">
        <span class="test-subject-badge">${subjectIcon} ${test.subject.name}</span>
        ${accessBadge}
      </div>

      <h2 class="test-card-title">${test.title}</h2>

      ${test.description
        ? `<p class="test-card-desc">${test.description}</p>`
        : ''}

      <div class="test-card-meta">
        <span class="meta-item">⏱ ${durationText}</span>
        <span class="meta-item">📋 ${test.question_count} питань</span>
      </div>

      <div class="test-card-footer">
        ${buttonHTML}
      </div>
    </div>
  `;
}

/**
 * Рендерить повідомлення про помилку.
 */
function renderError(container, err) {
  const isNetwork = err instanceof ApiError && err.status === 0;
  container.innerHTML = `
    <div class="error-state">
      <div class="error-icon">${isNetwork ? '📡' : '⚠️'}</div>
      <p>${isNetwork
        ? 'Не вдалося підключитися до сервера. Переконайтеся що бекенд запущено.'
        : `Помилка завантаження: ${err.message}`
      }</p>
      <button class="btn btn-ghost" onclick="loadAndRenderTests()">
        ↺ Спробувати ще раз
      </button>
    </div>
  `;
}

// ============================================
// ОБРОБНИКИ ПОДІЙ
// ============================================

/**
 * Обробляє клік на картку тесту.
 */
async function handleTestClick(testId, isLocked) {
  if (isLocked) {
    showToast('🔒 Цей тест буде доступний після офіційного релізу платформи', 'default');
    return;
  }

  // Показуємо що щось відбувається
  const btn = document.querySelector(`[data-test-id="${testId}"]`);
  const originalText = btn.textContent;
  btn.textContent = 'Завантаження...';
  btn.disabled = true;

  try {
    // Створюємо сесію на сервері
    const session = await api.createSession(testId);

    // Зберігаємо токен сесії в localStorage
    // test-simulator.js підхопить його при завантаженні
    localStorage.setItem('active_session_token', session.session_token);
    localStorage.setItem('active_test_id', String(testId));

    // Переходимо на сторінку тесту
    window.location.href = `test.html?session=${session.session_token}`;

  } catch (err) {
    btn.textContent = originalText;
    btn.disabled = false;

    const message = err instanceof ApiError
      ? err.message
      : 'Не вдалося розпочати тест. Спробуйте ще раз.';
    showToast(`❌ ${message}`, 'error');
  }
}

/**
 * Підключає фільтри по предметах.
 */
function setupFilterListeners() {
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      // Знімаємо активний клас з усіх
      document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const slug = btn.dataset.filter === 'all' ? null : btn.dataset.filter;
      loadAndRenderTests(slug);
    });
  });
}

// ============================================
// УТИЛІТИ
// ============================================

/**
 * Форматує секунди у читабельний рядок.
 * 600 → "10 хв", 10800 → "3 год"
 */
function formatDuration(seconds) {
  if (seconds < 3600) return `${Math.round(seconds / 60)} хв`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h} год ${m} хв` : `${h} год`;
}

/**
 * Toast-повідомлення (та сама функція що і в test-simulator.js).
 */
function showToast(message, type = 'default') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type !== 'default' ? type : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
