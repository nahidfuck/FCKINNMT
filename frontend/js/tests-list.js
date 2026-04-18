/**
 * tests-list.js — Логіка головного дашборду
 * ===========================================
 * Ключові функції:
 * 1. Перевірка авторизації при завантаженні
 * 2. Відображення імені юзера в шапці
 * 3. Завантаження тестів з API
 * 4. Групування тестів за предметами
 * 5. Обробка is_locked (бета-лок)
 * 6. Старт сесії та редірект на симулятор
 */

// ============================================
// ІНІЦІАЛІЗАЦІЯ
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  // КРОК 1: Перевірка авторизації
  // Якщо токена нема — редірект на auth.html
  if (!checkAuth()) {
    return; // Зупиняємо виконання, redirect вже відбувся
  }

  // КРОК 2: Відображення імені юзера в шапці
  displayUserInfo();

  // КРОК 3: Підключення обробників
  setupEventListeners();

  // КРОК 4: Завантаження та рендер тестів
  await loadAndRenderTests();
});

// ============================================
// АВТОРИЗАЦІЯ
// ============================================

/**
 * Перевіряє чи користувач авторизований.
 * Якщо ні — робить редірект на auth.html.
 * @returns {boolean} true якщо авторизований, false якщо ні (після redirect)
 */
function checkAuth() {
  const token = localStorage.getItem(TOKEN_KEY);
  
  if (!token) {
    // Токена нема → не авторизований → на сторінку логіну
    window.location.href = 'auth.html';
    return false;
  }

  // Токен є → все ОК, продовжуємо
  return true;
}

/**
 * Відображає ім'я юзера в шапці та hero-секції.
 * Використовує getCurrentUser() з auth.js.
 */
function displayUserInfo() {
  // getCurrentUser() визначена в auth.js і читає дані з localStorage
  const user = getCurrentUser();

  if (!user) {
    // Якщо дані юзера нема (токен є, але user_key якось відсутній)
    // — показуємо тільки email або "Користувач"
    document.getElementById('user-name').textContent = 'Користувач';
    document.getElementById('hero-user-name').textContent = 'користувач';
    return;
  }

  // Визначаємо що показувати: ім'я або email
  const displayName = user.full_name || user.email.split('@')[0]; // "ivan" з "ivan@gmail.com"

  // Оновлюємо обидва місця
  document.getElementById('user-name').textContent = displayName;
  document.getElementById('hero-user-name').textContent = displayName;
}

// ============================================
// ОБРОБНИКИ ПОДІЙ
// ============================================

function setupEventListeners() {
  // Кнопка "Вийти" викликає logout() з auth.js
  document.getElementById('btn-logout').addEventListener('click', () => {
    logout(); // функція з auth.js: очищає токен + редірект на auth.html
  });
}

// ============================================
// ЗАВАНТАЖЕННЯ ТА РЕНДЕР ТЕСТІВ
// ============================================

/**
 * Головна функція: завантажує тести з API та рендерить їх,
 * групуючи за предметами.
 */
async function loadAndRenderTests() {
  const container = document.getElementById('subjects-container');

  // Показуємо skeleton поки йде завантаження
  renderSkeletons(container);

  try {
    // Запит до API (без фільтру по предмету — отримуємо всі тести)
    const tests = await api.getTests();

    // Перевіряємо чи є тести взагалі
    if (!tests || tests.length === 0) {
      showEmptyState();
      return;
    }

    // Групуємо тести за предметами
    const groupedBySubject = groupTestsBySubject(tests);

    // Рендеримо кожен предмет окремою секцією
    renderSubjectSections(container, groupedBySubject);

    // Перевіряємо чи є хоча б один is_locked тест
    // Якщо так — показуємо бета-банер
    const hasLockedTests = tests.some(test => test.is_locked);
    if (hasLockedTests) {
      document.getElementById('beta-banner').style.display = 'inline-flex';
    }

  } catch (err) {
    // Обробляємо помилку (мережева або від API)
    showErrorState(err);
  }
}

/**
 * Групує тести за предметами.
 * Повертає об'єкт виду: { "Математика": [test1, test2], "Укр. мова": [test3] }
 */
function groupTestsBySubject(tests) {
  const grouped = {};

  tests.forEach(test => {
    const subjectName = test.subject.name;

    if (!grouped[subjectName]) {
      // Якщо це перший тест з цього предмета — створюємо масив
      grouped[subjectName] = {
        subject: test.subject,  // зберігаємо повний об'єкт subject (з icon, slug)
        tests: []
      };
    }

    // Додаємо тест до відповідного предмета
    grouped[subjectName].tests.push(test);
  });

  return grouped;
}

/**
 * Рендерить секції предметів з тестами.
 */
function renderSubjectSections(container, groupedBySubject) {
  container.innerHTML = ''; // Очищаємо skeleton

  // Перебираємо кожен предмет
  Object.keys(groupedBySubject).forEach(subjectName => {
    const { subject, tests } = groupedBySubject[subjectName];

    // Створюємо секцію для цього предмета
    const section = document.createElement('div');
    section.className = 'subject-section';
    section.innerHTML = `
      <!-- Заголовок предмета -->
      <div class="subject-header">
        <span class="subject-icon">${subject.icon || '📚'}</span>
        <span class="subject-name">${subjectName}</span>
        <span class="subject-count">${tests.length} ${pluralize(tests.length, 'тест', 'тести', 'тестів')}</span>
      </div>

      <!-- Сітка тестів для цього предмета -->
      <div class="tests-grid" id="grid-${subject.slug}"></div>
    `;

    container.appendChild(section);

    // Рендеримо картки тестів всередині цієї сітки
    const grid = document.getElementById(`grid-${subject.slug}`);
    tests.forEach(test => {
      const card = buildTestCard(test);
      grid.appendChild(card);
    });
  });
}

/**
 * Будує DOM-елемент картки одного тесту.
 * @param {object} test — об'єкт тесту з API
 * @returns {HTMLElement}
 */
function buildTestCard(test) {
  const card = document.createElement('div');
  card.className = `test-card ${test.is_locked ? 'test-card--locked' : ''}`;

  // Формуємо текст тривалості
  const durationText = formatDuration(test.duration);

  // Бейдж доступу (Безкоштовно / Преміум)
  const accessBadge = test.is_premium
    ? '<span class="badge badge-premium">⭐ Преміум</span>'
    : '<span class="badge badge-free">✓ Безкоштовно</span>';

  // Кнопка залежить від is_locked
  let buttonHTML;
  if (test.is_locked) {
    // Заблокований тест — неклікабельна кнопка з замком
    buttonHTML = `
      <button class="btn-locked" disabled>
        🔒 Відкриється після релізу
      </button>
    `;
  } else {
    // Доступний тест — кнопка "Почати"
    buttonHTML = `
      <button class="btn-start" data-test-id="${test.id}">
        Почати тест →
      </button>
    `;
  }

  card.innerHTML = `
    <div class="test-card-header">
      <span class="test-subject-badge">${test.subject.icon || '📝'} ${test.subject.name}</span>
      ${accessBadge}
    </div>

    <h2 class="test-card-title">${test.title}</h2>

    ${test.description
      ? `<p class="test-card-desc">${test.description}</p>`
      : '<p class="test-card-desc" style="opacity: 0.5;">Пробний тест для підготовки</p>'}

    <div class="test-card-meta">
      <span class="meta-item">⏱ ${durationText}</span>
      <span class="meta-item">📋 ${test.question_count} ${pluralize(test.question_count, 'питання', 'питання', 'питань')}</span>
    </div>

    <div class="test-card-footer">
      ${buttonHTML}
    </div>
  `;

  // Якщо тест НЕ заблокований — додаємо обробник кліку на кнопку
  if (!test.is_locked) {
    const btn = card.querySelector('.btn-start');
    btn.addEventListener('click', () => handleStartTest(test.id));
  }

  // Легка анімація появи картки
  card.style.animation = 'fade-in 0.3s ease both';

  return card;
}

/**
 * Обробляє клік на кнопку "Почати тест".
 * Створює сесію на сервері та робить редірект на симулятор.
 */
async function handleStartTest(testId) {
  // Знаходимо кнопку для візуального feedback
  const btn = document.querySelector(`[data-test-id="${testId}"]`);
  if (!btn) return;

  const originalText = btn.textContent;
  btn.textContent = 'Завантаження...';
  btn.disabled = true;

  try {
    // КРОК 1: Створюємо сесію на сервері
    // api.createSession повертає { id, session_token, test_id, ... }
    const session = await api.createSession(testId);

    // КРОК 2: Зберігаємо токен сесії та ID тесту в localStorage
    // test-simulator.js використає ці дані при завантаженні
    localStorage.setItem('active_session_token', session.session_token);
    localStorage.setItem('active_test_id', String(testId));

    // КРОК 3: Redirect на сторінку симулятора з токеном в URL
    window.location.href = `test.html?session=${session.session_token}`;

  } catch (err) {
    // Відновлюємо кнопку якщо сталася помилка
    btn.textContent = originalText;
    btn.disabled = false;

    // Показуємо помилку користувачу
    const message = err instanceof ApiError
      ? err.message
      : 'Не вдалося розпочати тест. Перевірте підключення.';
    
    showToast(`❌ ${message}`, 'error');
    console.error('Помилка створення сесії:', err);
  }
}

// ============================================
// СТАНИ UI (завантаження / помилка / порожньо)
// ============================================

/**
 * Показує skeleton поки тести завантажуються.
 */
function renderSkeletons(container) {
  container.innerHTML = `
    <!-- Skeleton для 2 предметів -->
    <div class="skeleton-subject">
      <div class="skeleton-subject-header">
        <div class="skeleton-icon"></div>
        <div class="skeleton-text"></div>
      </div>
      <div class="tests-grid">
        ${Array(3).fill('<div class="test-card skeleton"></div>').join('')}
      </div>
    </div>
    <div class="skeleton-subject">
      <div class="skeleton-subject-header">
        <div class="skeleton-icon"></div>
        <div class="skeleton-text"></div>
      </div>
      <div class="tests-grid">
        ${Array(2).fill('<div class="test-card skeleton"></div>').join('')}
      </div>
    </div>
  `;
}

/**
 * Показує стан "порожньо" якщо тестів нема взагалі.
 */
function showEmptyState() {
  document.getElementById('subjects-container').style.display = 'none';
  document.getElementById('empty-state').style.display = 'flex';
}

/**
 * Показує стан "помилка" при невдалому завантаженні.
 */
function showErrorState(err) {
  document.getElementById('subjects-container').style.display = 'none';

  const errorStateEl = document.getElementById('error-state');
  const errorMessageEl = document.getElementById('error-message');

  // Визначаємо текст помилки
  if (err instanceof ApiError && err.status === 0) {
    errorMessageEl.textContent = 'Не вдалося підключитися до сервера. Перевірте з\'єднання.';
  } else if (err instanceof ApiError) {
    errorMessageEl.textContent = `Помилка: ${err.message}`;
  } else {
    errorMessageEl.textContent = 'Не вдалося завантажити тести. Спробуйте пізніше.';
  }

  errorStateEl.style.display = 'flex';

  console.error('Помилка завантаження тестів:', err);
}

// ============================================
// УТИЛІТИ
// ============================================

/**
 * Форматує секунди у читабельний рядок тривалості.
 * 600 → "10 хв", 10800 → "3 год"
 */
function formatDuration(seconds) {
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)} хв`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h} год ${m} хв` : `${h} год`;
}

/**
 * Правильна форма українського слова залежно від числа.
 * pluralize(1, 'тест', 'тести', 'тестів') → "тест"
 * pluralize(2, 'тест', 'тести', 'тестів') → "тести"
 * pluralize(5, 'тест', 'тести', 'тестів') → "тестів"
 */
function pluralize(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * Toast-повідомлення (та сама функція що і в інших файлах).
 */
function showToast(message, type = 'default') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type !== 'default' ? type : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
