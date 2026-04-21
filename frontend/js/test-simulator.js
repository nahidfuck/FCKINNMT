/**
 * test-simulator.js — Симулятор тесту НМТ
 * =========================================
 *
 * Потік:
 *  1. DOMContentLoaded → читаємо sessionToken (URL) + testId (localStorage)
 *  2. api.getTest(testId) → отримуємо питання (без правильних відповідей)
 *  3. Рендеримо перше питання, запускаємо таймер
 *  4. Відповідь → зберігаємо локально + api.saveAnswer() у фоні
 *  5. "Завершити" → api.finishSession() → ховаємо симулятор, показуємо результати
 *
 * Два рівні збереження:
 *  - localStorage  — миттєво, для відновлення після F5
 *  - api.saveAnswer — фоново, авторитетне джерело на сервері
 */

// ============================================
// 1. СТАН ДОДАТКУ
// ============================================

const state = {
  sessionToken:         null,   // JWT сесії тесту з URL
  testData:             null,   // { id, title, duration, questions, ... }
  currentIndex:         0,      // Індекс поточного питання (0-based)
  answers:              {},     // { [questionId]: answerOptionId }
  skipped:              {},     // { [questionId]: true }
  timeLeft:             0,      // Секунди що залишились
};

let timerInterval = null; // Ідентифікатор setInterval таймера

// ============================================
// 2. ІНІЦІАЛІЗАЦІЯ
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  // --- 2.1 Читаємо параметри запуску ---
  const urlParams   = new URLSearchParams(window.location.search);
  state.sessionToken = urlParams.get('session');
  const testId       = localStorage.getItem('active_test_id');

  // Якщо чогось бракує — нема сенсу продовжувати
  if (!state.sessionToken || !testId) {
    return redirectToTests('Сесію не знайдено. Будь ласка, почніть тест заново.');
  }

  // --- 2.2 Завантажуємо дані тесту ---
  showLoading(true);

  try {
    state.testData = await api.getTest(parseInt(testId, 10));
  } catch (err) {
    showLoading(false);
    return redirectToTests(
      err instanceof ApiError && err.status === 0
        ? 'Сервер недоступний. Перевірте підключення.'
        : `Помилка завантаження тесту: ${err.message}`
    );
  }

  // --- 2.3 Відновлюємо прогрес з localStorage (якщо юзер перезавантажив) ---
  restoreStateFromStorage();

  // --- 2.4 Рендеримо інтерфейс ---
  renderHeader();
  renderNavigator();
  renderQuestion();
  startTimer();
  setupEventListeners();

  showLoading(false);
});

// ============================================
// 3. РЕНДЕР ПИТАННЯ
// ============================================

/**
 * Рендерить поточне питання та оновлює навігатор.
 * Якщо питання має image_url — відображає зображення під текстом.
 */
function renderQuestion() {
  const q     = currentQuestion();
  const total = state.testData.questions.length;
  const num   = state.currentIndex + 1;

  document.getElementById('question-number').textContent = `Питання ${num} з ${total}`;
  document.getElementById('question-text').innerHTML     = q.text;

  // --- Зображення питання ---
  // Видаляємо попереднє зображення (якщо було від попереднього питання)
  const existingImg = document.getElementById('question-image-wrap');
  if (existingImg) existingImg.remove();

  if (q.image_url) {
    const imgWrap = document.createElement('div');
    imgWrap.id = 'question-image-wrap';
    imgWrap.style.cssText = 'margin-top: 1.25rem;';

    imgWrap.innerHTML = `
      <img
        src="${q.image_url}"
        alt="Ілюстрація до питання"
        class="question-image"
        style="
          display: block;
          max-width: 100%;
          max-height: 320px;
          width: auto;
          border-radius: var(--radius-md);
          border: 1px solid var(--color-border);
          background: var(--color-surface-2);
          object-fit: contain;
        "
        onerror="this.parentElement.style.display='none'"
      >
    `;
    // Вставляємо між текстом питання і списком варіантів
    document.getElementById('question-text').after(imgWrap);
  }

  renderOptions(q);
  updateNavigator();
  updateNavButtons();
}

/**
 * Рендерить варіанти відповідей для питання.
 * Підсвічує вибраний варіант (якщо вже є відповідь).
 */
function renderOptions(question) {
  const list       = document.getElementById('options-list');
  const selectedId = state.answers[question.id] ?? null;
  const letters    = ['А', 'Б', 'В', 'Г', 'Д'];

  list.innerHTML = question.options.map((opt, i) => `
    <li class="option-item">
      <button
        class="option-btn ${opt.id === selectedId ? 'selected' : ''}"
        data-question-id="${question.id}"
        data-option-id="${opt.id}"
      >
        <span class="option-letter">${letters[i] ?? i + 1}</span>
        <span class="option-text">${opt.text}</span>
      </button>
    </li>
  `).join('');
}

/**
 * Рендерить шапку: бейдж предмету, назву тесту, довідник.
 */
function renderHeader() {
  document.getElementById('subject-badge').textContent = state.testData.subject.name;
  document.getElementById('test-title').textContent    = state.testData.title;

  if (state.testData.reference_materials) {
    document.getElementById('modal-reference-body').innerHTML =
      state.testData.reference_materials;
  }
}

// ============================================
// 4. НАВІГАТОР (сітка питань)
// ============================================

/**
 * Будує сітку кнопок-номерів (викликається один раз при ініціалізації).
 */
function renderNavigator() {
  const grid = document.getElementById('nav-grid');

  grid.innerHTML = state.testData.questions.map((_, i) => `
    <button class="nav-cell" id="nav-cell-${i}" data-index="${i}">
      ${i + 1}
    </button>
  `).join('');

  updateNavigator();
  updateProgressBar();
}

/**
 * Оновлює CSS-класи клітинок залежно від стану кожного питання.
 * Викликається після кожної відповіді/переходу.
 */
function updateNavigator() {
  state.testData.questions.forEach((q, i) => {
    const cell = document.getElementById(`nav-cell-${i}`);
    if (!cell) return;

    cell.className = 'nav-cell'; // скидаємо

    if (i === state.currentIndex)    cell.classList.add('active');
    else if (state.answers[q.id])    cell.classList.add('answered');
    else if (state.skipped[q.id])    cell.classList.add('skipped');
  });
}

/**
 * Оновлює прогрес-бар та лічильник "X / Y відповідей".
 */
function updateProgressBar() {
  const total    = state.testData.questions.length;
  const answered = Object.keys(state.answers).length;

  document.getElementById('progress-fill').style.width =
    `${(answered / total) * 100}%`;
  document.getElementById('progress-text').textContent =
    `${answered} / ${total} відповідей`;
}

/**
 * Оновлює стан кнопок "Назад" / "Далі" / "Завершити".
 */
function updateNavButtons() {
  const isFirst = state.currentIndex === 0;
  const isLast  = state.currentIndex === state.testData.questions.length - 1;
  const btnNext = document.getElementById('btn-next');

  document.getElementById('btn-prev').disabled = isFirst;

  if (isLast) {
    btnNext.textContent  = '✓ Завершити';
    btnNext.className    = 'btn btn-finish';
  } else {
    btnNext.textContent  = 'Далі →';
    btnNext.className    = 'btn btn-primary';
  }
}

// ============================================
// 5. ОБРОБНИКИ ПОДІЙ
// ============================================

function setupEventListeners() {
  // --- Вибір відповіді (event delegation на список) ---
  document.getElementById('options-list').addEventListener('click', e => {
    const btn = e.target.closest('.option-btn');
    if (btn) onAnswerSelect(btn.dataset.questionId, parseInt(btn.dataset.optionId, 10));
  });

  // --- Навігаційна сітка ---
  document.getElementById('nav-grid').addEventListener('click', e => {
    const cell = e.target.closest('.nav-cell');
    if (cell) goToQuestion(parseInt(cell.dataset.index, 10));
  });

  // --- Кнопки навігації ---
  document.getElementById('btn-prev').addEventListener('click', () =>
    goToQuestion(state.currentIndex - 1));

  document.getElementById('btn-next').addEventListener('click', () => {
    const isLast = state.currentIndex === state.testData.questions.length - 1;
    isLast ? confirmAndFinish() : goToQuestion(state.currentIndex + 1);
  });

  // --- Пропустити питання ---
  document.getElementById('btn-skip').addEventListener('click', onSkip);

  // --- Завершити тест (кнопка в навігаторі) ---
  document.getElementById('btn-finish-nav').addEventListener('click', confirmAndFinish);

  // --- Модалки ---
  document.getElementById('btn-reference').addEventListener('click',
    () => openModal('modal-reference'));

  document.getElementById('btn-report').addEventListener('click', () => {
    const q = currentQuestion();
    document.getElementById('report-question-context').textContent =
      `Питання ${state.currentIndex + 1} (ID: ${q.id})`;
    openModal('modal-report');
  });

  document.getElementById('btn-submit-report').addEventListener('click', submitReport);

  document.querySelectorAll('.modal-close, .modal-overlay').forEach(el =>
    el.addEventListener('click', e => { if (e.target === el) closeModals(); }));

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModals();
  });
}

// ============================================
// 6. ЛОГІКА ВІДПОВІДІ ТА НАВІГАЦІЇ
// ============================================

/**
 * Обробляє вибір відповіді.
 * 1. Зберігає локально в state.answers
 * 2. Оновлює DOM
 * 3. Відправляє на сервер у фоні (не блокує UI)
 */
function onAnswerSelect(questionId, optionId) {
  // Зберігаємо локально
  state.answers[questionId] = optionId;
  delete state.skipped[questionId]; // знімаємо мітку "пропущено"

  // Оновлюємо UI одразу
  renderOptions(currentQuestion());
  updateNavigator();
  updateProgressBar();

  // Зберігаємо в localStorage (захист від F5)
  saveStateToStorage();

  // Відправляємо на сервер у фоні
  // Помилку не показуємо — при фінішуванні сервер підрахує по своїх даних
  api.saveAnswer(state.sessionToken, {
    question_id:      parseInt(questionId, 10),
    answer_option_id: optionId,
    is_skipped:       false,
    time_left:        state.timeLeft,
  }).catch(err => console.warn('[sync] saveAnswer failed:', err.message));
}

/**
 * Позначає питання як "пропущене" і переходить до наступного.
 */
function onSkip() {
  const q = currentQuestion();

  // Пропускаємо тільки якщо ще немає відповіді
  if (!state.answers[q.id]) {
    state.skipped[q.id] = true;
    saveStateToStorage();

    // Синхронізуємо "пропуск" із сервером
    api.saveAnswer(state.sessionToken, {
      question_id:      q.id,
      answer_option_id: null,
      is_skipped:       true,
      time_left:        state.timeLeft,
    }).catch(err => console.warn('[sync] skip failed:', err.message));

    showToast('⏭ Питання пропущено', 'default');
  }

  const isLast = state.currentIndex === state.testData.questions.length - 1;
  if (!isLast) goToQuestion(state.currentIndex + 1);
}

/**
 * Переходить до питання за індексом.
 */
function goToQuestion(index) {
  const max = state.testData.questions.length - 1;
  if (index < 0 || index > max) return;

  state.currentIndex = index;
  renderQuestion();

  // На мобільних скролимо до картки
  if (window.innerWidth <= 768) {
    document.getElementById('question-panel')?.scrollIntoView({ behavior: 'smooth' });
  }
}

// ============================================
// 7. ЗАВЕРШЕННЯ ТЕСТУ
// ============================================

/**
 * Показує підтвердження і завершує тест.
 */
function confirmAndFinish() {
  const unanswered = state.testData.questions.filter(
    q => !state.answers[q.id]
  ).length;

  if (unanswered > 0) {
    const ok = window.confirm(
      `Залишилось ${unanswered} питань без відповіді.\nЗавершити тест?`
    );
    if (!ok) return;
  }

  finishTest();
}

/**
 * Надсилає запит на завершення тесту та показує результати.
 */
async function finishTest() {
  // Зупиняємо таймер
  clearInterval(timerInterval);

  // Блокуємо кнопки щоб уникнути подвійного запиту
  document.getElementById('btn-finish-nav').disabled = true;
  document.getElementById('btn-next').disabled       = true;

  try {
    const result = await api.finishSession(state.sessionToken);

    // Очищаємо localStorage — тест завершено
    clearStorage();

    // Показуємо екран результатів
    showResults(result);

  } catch (err) {
    // Відновлюємо кнопки при помилці
    document.getElementById('btn-finish-nav').disabled = false;
    document.getElementById('btn-next').disabled       = false;

    showToast(`❌ Помилка: ${err.message}`, 'error');
  }
}

// ============================================
// 8. ЕКРАН РЕЗУЛЬТАТІВ
// ============================================

/**
 * Перемикає видимість: ховає симулятор, показує результати.
 * @param {object} result — відповідь api.finishSession()
 */
function showResults(result) {
  // Ховаємо весь симулятор
  document.getElementById('simulator-container').style.display = 'none';
  document.querySelector('.app-header').style.display          = 'none';

  // Рендеримо результати
  renderResults(result);

  // Показуємо контейнер результатів
  document.getElementById('results-container').style.display = 'block';
}

/**
 * Генерує HTML результатів і вставляє в #results-container.
 */
function renderResults(result) {
  const { score, max_score, percentage, time_spent, questions } = result;

  // Конвертуємо ключі user_answers у числа (JSON завжди рядки)
  const userAnswers = {};
  for (const [k, v] of Object.entries(result.user_answers ?? {})) {
    userAnswers[parseInt(k, 10)] = v;
  }

  // Емодзі та коментар залежно від результату
  const emoji   = percentage >= 75 ? '🎉' : percentage >= 50 ? '👍' : '📚';
  const comment = percentage >= 75
    ? 'Відмінний результат! Ти добре підготовлений.'
    : percentage >= 50
    ? 'Непоганий результат. Є куди зростати.'
    : 'Варто повторити матеріал і спробувати ще раз.';

  // HTML кожного питання у розборі
  const questionsHTML = questions.map((q, i) => {
    const userOptId  = userAnswers[q.id];
    const isCorrect  = userOptId != null && userOptId === q.correct_answer_id;
    const userOpt    = q.options.find(o => o.id === userOptId);
    const correctOpt = q.options.find(o => o.id === q.correct_answer_id);

    return `
      <div style="
        padding:1rem; margin-bottom:0.75rem;
        background:var(--color-surface-2); border-radius:var(--radius-md);
        border-left:3px solid ${isCorrect ? 'var(--color-success)' : 'var(--color-danger)'};
      ">
        <div style="font-size:0.75rem;color:var(--color-text-muted);margin-bottom:0.35rem;">
          ${isCorrect ? '✅' : '❌'} &nbsp;Питання ${i + 1}
        </div>
        <div style="font-size:0.9rem;margin-bottom:0.5rem;line-height:1.5;">${q.text}</div>
        ${!isCorrect ? `
          <div style="font-size:0.82rem;color:var(--color-danger);">
            Ваша відповідь:&nbsp;${userOpt?.text ?? '<em>не відповіли</em>'}
          </div>
          <div style="font-size:0.82rem;color:var(--color-success);margin-top:2px;">
            Правильна:&nbsp;${correctOpt?.text ?? '—'}
          </div>
        ` : ''}
        ${q.explanation ? `
          <div style="font-size:0.8rem;color:var(--color-text-muted);margin-top:0.4rem;font-style:italic;">
            💡 ${q.explanation}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  document.getElementById('results-container').innerHTML = `
    <div style="max-width:720px;margin:0 auto;padding:2rem 1.5rem;">
      <div class="question-card" style="text-align:center;padding:2.5rem 2rem 2rem;">

        <!-- Бал -->
        <div style="font-size:3rem;margin-bottom:0.75rem;">${emoji}</div>
        <div style="
          font-family:var(--font-display);font-size:4.5rem;font-weight:700;
          color:var(--color-accent);line-height:1;margin-bottom:0.4rem;
        ">${score}/${max_score}</div>
        <div style="font-size:1rem;color:var(--color-text-muted);margin-bottom:0.4rem;">
          <strong style="color:var(--color-text);font-size:1.3rem;">${percentage}%</strong>
        </div>
        <div style="font-size:0.88rem;color:var(--color-text-muted);margin-bottom:1.75rem;">
          ${comment}
        </div>

        <!-- Мета-дані сесії -->
        <div style="
          display:inline-flex;gap:1.5rem;flex-wrap:wrap;justify-content:center;
          background:var(--color-surface-2);border:1px solid var(--color-border);
          border-radius:var(--radius-md);padding:0.75rem 1.5rem;
          font-size:0.82rem;color:var(--color-text-muted);margin-bottom:2rem;
        ">
          <span>⏱ Витрачено: ${formatTime(time_spent)}</span>
          <span>✓ Правильних: ${score} з ${max_score}</span>
        </div>

        <!-- Розбір відповідей -->
        <div style="text-align:left;">
          <div style="
            font-family:var(--font-display);font-size:0.6rem;font-weight:700;
            letter-spacing:0.1em;text-transform:uppercase;color:var(--color-accent);
            margin-bottom:1rem;
          ">Розбір відповідей</div>
          ${questionsHTML}
        </div>

        <!-- Кнопки -->
        <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;margin-top:2rem;">
          <button class="btn btn-ghost"
            onclick="window.location.href='tests.html'">
            ← До списку тестів
          </button>
          <button class="btn btn-primary"
            onclick="window.location.href='tests.html'">
            Пройти ще один
          </button>
        </div>

      </div>
    </div>
  `;
}

// ============================================
// 9. ТАЙМЕР
// ============================================

function startTimer() {
  updateTimerDisplay();

  timerInterval = setInterval(() => {
    state.timeLeft--;

    if (state.timeLeft <= 0) {
      state.timeLeft = 0;
      updateTimerDisplay();
      clearInterval(timerInterval);
      showToast('⏰ Час вийшов! Тест завершується...', 'error');
      setTimeout(() => finishTest(), 2000);
      return;
    }

    updateTimerDisplay();

    // Зберігаємо в localStorage кожні 10 секунд
    if (state.timeLeft % 10 === 0) saveStateToStorage();
  }, 1000);
}

function updateTimerDisplay() {
  const el = document.getElementById('timer');
  document.getElementById('timer-value').textContent = formatTime(state.timeLeft);

  el.className = 'timer';
  if      (state.timeLeft <= 60)  el.classList.add('danger');
  else if (state.timeLeft <= 180) el.classList.add('warning');
}

// ============================================
// 10. МОДАЛЬНІ ВІКНА
// ============================================

function openModal(id) {
  document.getElementById(id)?.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closeModals() {
  document.querySelectorAll('.modal-overlay').forEach(el =>
    el.classList.remove('visible'));
  document.body.style.overflow = '';
}

async function submitReport() {
  const comment = document.getElementById('report-comment').value.trim();
  if (!comment) return showToast('⚠ Опишіть помилку', 'error');

  const btn = document.getElementById('btn-submit-report');
  btn.textContent = 'Надсилання...';
  btn.disabled    = true;

  try {
    await api.sendReport({
      question_id: currentQuestion().id,
      report_type: document.getElementById('report-type').value,
      comment,
    });
    document.getElementById('report-comment').value = '';
    closeModals();
    showToast('✅ Репорт надіслано. Дякуємо!', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    btn.textContent = '📤 Надіслати репорт';
    btn.disabled    = false;
  }
}

// ============================================
// 11. ЛОКАЛЬНЕ ЗБЕРЕЖЕННЯ СТАНУ
// ============================================

function storageKey() {
  return `nmt_session_${state.sessionToken}`;
}

function saveStateToStorage() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify({
      currentIndex: state.currentIndex,
      answers:      state.answers,
      skipped:      state.skipped,
      timeLeft:     state.timeLeft,
      savedAt:      Date.now(),
    }));
  } catch (e) {
    console.warn('localStorage write failed:', e);
  }
}

/**
 * Відновлює стан із localStorage.
 * Викликається після завантаження testData, тому state.timeLeft
 * за замовчуванням береться з testData.duration.
 */
function restoreStateFromStorage() {
  // Ініціалізуємо часу з тесту (може бути перезаписано нижче)
  state.timeLeft = state.testData.duration;

  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return;

    const saved = JSON.parse(raw);

    // Ігноруємо збереження старше 24 годин
    if (Date.now() - saved.savedAt > 24 * 3600 * 1000) {
      localStorage.removeItem(storageKey());
      return;
    }

    state.currentIndex = saved.currentIndex ?? 0;
    state.answers      = saved.answers      ?? {};
    state.skipped      = saved.skipped      ?? {};
    state.timeLeft     = saved.timeLeft     ?? state.testData.duration;

    showToast('💾 Прогрес відновлено', 'success');
  } catch (e) {
    console.warn('localStorage read failed:', e);
  }
}

function clearStorage() {
  try {
    localStorage.removeItem(storageKey());
    localStorage.removeItem('active_session_token');
    localStorage.removeItem('active_test_id');
  } catch (e) { /* ignore */ }
}

// ============================================
// 12. УТИЛІТИ
// ============================================

/** Повертає поточне питання зі state.testData. */
function currentQuestion() {
  return state.testData.questions[state.currentIndex];
}

/** Форматує секунди у рядок "MM:SS" або "HH:MM:SS". */
function formatTime(seconds) {
  const h   = Math.floor(seconds / 3600);
  const m   = Math.floor((seconds % 3600) / 60);
  const s   = seconds % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Показує toast-повідомлення. */
function showToast(message, type = 'default') {
  const container = document.getElementById('toast-container');
  const toast     = document.createElement('div');
  toast.className = `toast ${type !== 'default' ? type : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

/** Перемикає видимість екрану завантаження. */
function showLoading(visible) {
  const el = document.getElementById('loading-screen');
  if (el) el.style.display = visible ? 'flex' : 'none';
}

/** Показує помилку і робить redirect на tests.html. */
function redirectToTests(message) {
  if (message) showToast(`❌ ${message}`, 'error');
  setTimeout(() => { window.location.href = 'tests.html'; }, 1500);
}
