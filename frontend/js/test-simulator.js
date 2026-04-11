/**
 * test-simulator.js — Симулятор тесту (підключений до API)
 * ==========================================================
 * Головна зміна порівняно з попередньою версією:
 *
 * БУЛО:  дані беруться зі статичного data.js
 * СТАЛО: дані завантажуються з API, відповіді зберігаються на сервері
 *
 * Архітектура збереження стану (два рівні):
 *   1. localStorage — швидко, миттєво, без запиту (для UI)
 *   2. Сервер (API) — надійно, не втрачається при очищенні браузера
 *
 * Потік роботи:
 *   1. Читаємо session_token з URL (?session=abc123)
 *   2. Завантажуємо дані тесту з GET /api/tests/{id}
 *   3. Відновлюємо стан з localStorage (якщо є)
 *   4. При відповіді → зберігаємо в localStorage + POST на сервер
 *   5. При завершенні → POST /finish → показуємо результати з сервера
 */

// ============================================
// 1. СТАН
// ============================================

let state = {
  currentQuestionIndex: 0,
  answers:  {},   // { questionId: answerOptionId }
  skipped:  {},   // { questionId: true }
  timeLeft: 0,
  sessionToken: null,
  testData: null, // Завантажується з API
  isSyncing: false, // Чи йде запит до сервера (щоб не дублювати)
};

let timerInterval = null;

// ============================================
// 2. ІНІЦІАЛІЗАЦІЯ
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  // Читаємо токен сесії з URL: test.html?session=TOKEN
  const urlParams = new URLSearchParams(window.location.search);
  state.sessionToken = urlParams.get('session');

  if (!state.sessionToken) {
    // Якщо токена нема — redirect на список тестів
    showFatalError('Сесію не знайдено. Будь ласка, почніть тест заново.');
    return;
  }

  // Показуємо екран завантаження
  showLoadingScreen(true);

  try {
    await initializeTest();
  } catch (err) {
    showFatalError(
      err instanceof ApiError && err.status === 0
        ? 'Не вдалося підключитися до сервера.'
        : `Помилка завантаження тесту: ${err.message}`
    );
  } finally {
    showLoadingScreen(false);
  }
});

/**
 * Завантажує дані тесту і запускає симулятор.
 */
async function initializeTest() {
  // Читаємо testId з localStorage (збережено при створенні сесії)
  const testId = localStorage.getItem('active_test_id');
  if (!testId) throw new Error('ID тесту не знайдено');

  // Завантажуємо тест з API (без правильних відповідей)
  state.testData = await api.getTest(parseInt(testId, 10));

  // Відновлюємо локальний прогрес (якщо сторінку перезавантажили)
  const restored = loadStateFromStorage();
  if (!restored) {
    state.timeLeft = state.testData.duration;
  }

  // Рендеримо інтерфейс
  renderHeader();
  renderNavigator();
  renderQuestion();

  // Запускаємо таймер
  startTimer();

  // Підключаємо обробники
  setupEventListeners();

  if (restored) {
    showToast('💾 Прогрес відновлено', 'success');
  }
}

// ============================================
// 3. РЕНДЕР (без змін від попередньої версії,
//    тільки читає з state.testData замість TEST_DATA)
// ============================================

function renderHeader() {
  document.getElementById('subject-badge').textContent = state.testData.subject.name;
  document.getElementById('test-title').textContent    = state.testData.title;
  // Заповнюємо довідник з даних API
  if (state.testData.reference_materials) {
    document.getElementById('modal-reference-body').innerHTML =
      state.testData.reference_materials;
  }
}

function renderQuestion() {
  const question = state.testData.questions[state.currentQuestionIndex];
  const total    = state.testData.questions.length;

  document.getElementById('question-number').textContent =
    `Питання ${state.currentQuestionIndex + 1} з ${total}`;
  document.getElementById('question-text').innerHTML = question.text;

  renderOptions(question);
  updateNavigatorHighlight();
  updateNavButtons();
}

function renderOptions(question) {
  const container = document.getElementById('options-list');
  container.innerHTML = '';
  const letters = ['А', 'Б', 'В', 'Г', 'Д'];
  const selectedId = state.answers[question.id] || null;

  question.options.forEach((option, index) => {
    const li = document.createElement('li');
    li.className = 'option-item';
    li.innerHTML = `
      <button
        class="option-btn ${option.id === selectedId ? 'selected' : ''}"
        data-option-id="${option.id}"
        data-question-id="${question.id}"
      >
        <span class="option-letter">${letters[index]}</span>
        <span class="option-text">${option.text}</span>
      </button>
    `;
    container.appendChild(li);
  });
}

function renderNavigator() {
  const grid = document.getElementById('nav-grid');
  grid.innerHTML = '';
  state.testData.questions.forEach((_, index) => {
    const cell = document.createElement('button');
    cell.className   = 'nav-cell';
    cell.id          = `nav-cell-${index}`;
    cell.textContent = index + 1;
    cell.dataset.index = index;
    grid.appendChild(cell);
  });
  updateNavigatorHighlight();
  updateProgressBar();
}

function updateNavigatorHighlight() {
  state.testData.questions.forEach((question, index) => {
    const cell = document.getElementById(`nav-cell-${index}`);
    if (!cell) return;
    cell.className = 'nav-cell';
    if (index === state.currentQuestionIndex)   cell.classList.add('active');
    else if (state.answers[question.id])        cell.classList.add('answered');
    else if (state.skipped[question.id])        cell.classList.add('skipped');
  });
}

function updateProgressBar() {
  const total     = state.testData.questions.length;
  const answered  = Object.keys(state.answers).length;
  document.getElementById('progress-fill').style.width = `${(answered / total) * 100}%`;
  document.getElementById('progress-text').textContent = `${answered} / ${total} відповідей`;
}

function updateNavButtons() {
  const isFirst = state.currentQuestionIndex === 0;
  const isLast  = state.currentQuestionIndex === state.testData.questions.length - 1;
  document.getElementById('btn-prev').disabled = isFirst;
  const btnNext = document.getElementById('btn-next');
  btnNext.textContent = isLast ? '✓ Завершити' : 'Далі →';
  btnNext.className   = isLast ? 'btn btn-finish' : 'btn btn-primary';
}

function updateTimerDisplay() {
  const el = document.getElementById('timer');
  document.getElementById('timer-value').textContent = formatTime(state.timeLeft);
  el.className = 'timer';
  if (state.timeLeft <= 60)       el.classList.add('danger');
  else if (state.timeLeft <= 180) el.classList.add('warning');
}

// ============================================
// 4. ОБРОБНИКИ ПОДІЙ
// ============================================

function setupEventListeners() {
  // Вибір відповіді
  document.getElementById('options-list').addEventListener('click', e => {
    const btn = e.target.closest('.option-btn');
    if (btn) handleAnswerSelect(btn.dataset.questionId, btn.dataset.optionId);
  });

  // Навігаційна сітка
  document.getElementById('nav-grid').addEventListener('click', e => {
    const cell = e.target.closest('.nav-cell');
    if (cell) navigateToQuestion(parseInt(cell.dataset.index, 10));
  });

  document.getElementById('btn-prev').addEventListener('click', () =>
    navigateToQuestion(state.currentQuestionIndex - 1));

  document.getElementById('btn-next').addEventListener('click', () => {
    const isLast = state.currentQuestionIndex === state.testData.questions.length - 1;
    isLast ? handleFinishTest() : navigateToQuestion(state.currentQuestionIndex + 1);
  });

  document.getElementById('btn-skip').addEventListener('click', () => {
    const q = state.testData.questions[state.currentQuestionIndex];
    if (!state.answers[q.id]) {
      state.skipped[q.id] = true;
      saveStateToStorage();
      // Синхронізуємо "пропуск" на сервер (fire-and-forget, не блокуємо UI)
      syncAnswerToServer(q.id, null, true);
      showToast('⏭ Питання позначено як "пропущене"', 'default');
    }
    if (state.currentQuestionIndex < state.testData.questions.length - 1) {
      navigateToQuestion(state.currentQuestionIndex + 1);
    }
  });

  document.getElementById('btn-reference').addEventListener('click',
    () => openModal('modal-reference'));

  document.getElementById('btn-report').addEventListener('click', () => {
    const q = state.testData.questions[state.currentQuestionIndex];
    document.getElementById('report-question-context').textContent =
      `Питання ${state.currentQuestionIndex + 1} (ID: ${q.id})`;
    openModal('modal-report');
  });

  document.querySelectorAll('.modal-close, .modal-overlay').forEach(el => {
    el.addEventListener('click', e => { if (e.target === el) closeAllModals(); });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllModals();
  });

  document.getElementById('btn-submit-report').addEventListener('click', submitReport);
  document.getElementById('btn-finish-nav').addEventListener('click', handleFinishTest);
}

/**
 * Обробляє вибір відповіді.
 * Зберігає в localStorage одразу, на сервер — асинхронно.
 */
function handleAnswerSelect(questionId, optionId) {
  state.answers[questionId] = optionId;
  delete state.skipped[questionId];

  // Оновлюємо UI миттєво
  const question = state.testData.questions[state.currentQuestionIndex];
  renderOptions(question);
  updateNavigatorHighlight();
  updateProgressBar();

  // Зберігаємо локально (синхронно, швидко)
  saveStateToStorage();

  // Відправляємо на сервер (асинхронно, не блокує UI)
  // Якщо запит впаде — наступна відповідь або фініш надолужить
  syncAnswerToServer(questionId, optionId, false);
}

/**
 * Асинхронно синхронізує відповідь з сервером.
 * Помилки не показуємо користувачу — тихо логуємо.
 */
async function syncAnswerToServer(questionId, answerOptionId, isSkipped) {
  try {
    await api.saveAnswer(state.sessionToken, {
      question_id:      questionId,
      answer_option_id: answerOptionId,
      is_skipped:       isSkipped,
      time_left:        state.timeLeft,
    });
  } catch (err) {
    // Не показуємо помилку юзеру — відповідь вже в localStorage
    // При фінішу сервер підрахує по своїм даним
    console.warn('Помилка синхронізації відповіді:', err.message);
  }
}

function navigateToQuestion(index) {
  if (index < 0 || index >= state.testData.questions.length) return;
  state.currentQuestionIndex = index;
  renderQuestion();
  if (window.innerWidth <= 768) {
    document.getElementById('question-panel').scrollIntoView({ behavior: 'smooth' });
  }
}

function handleFinishTest() {
  const unanswered = state.testData.questions.filter(q => !state.answers[q.id]).length;
  if (unanswered > 0) {
    const ok = window.confirm(
      `Залишилось ${unanswered} питань без відповіді.\nЗавершити тест?`
    );
    if (!ok) return;
  }
  finishTest();
}

/**
 * Завершує тест — отримує результати з сервера.
 */
async function finishTest() {
  clearInterval(timerInterval);

  // Блокуємо UI під час запиту
  const btnFinish = document.getElementById('btn-finish-nav');
  btnFinish.textContent = 'Завершення...';
  btnFinish.disabled = true;

  try {
    const result = await api.finishSession(state.sessionToken);
    clearStateFromStorage();
    renderResults(result);
  } catch (err) {
    btnFinish.textContent = '✓ Завершити тест';
    btnFinish.disabled = false;
    showToast(`❌ Помилка завершення: ${err.message}`, 'error');
  }
}

/**
 * Рендерить екран результатів.
 * result — відповідь POST /sessions/{token}/finish
 */
function renderResults(result) {
  const scorePercent = result.percentage;
  const emoji   = scorePercent >= 75 ? '🎉' : scorePercent >= 50 ? '👍' : '📚';
  const comment = scorePercent >= 75
    ? 'Відмінний результат!'
    : scorePercent >= 50
    ? 'Непоганий результат. Є куди зростати!'
    : 'Варто повторити матеріал і спробувати ще раз.';

  // ФІКС: JSON завжди серіалізує ключі словника як рядки ("1", "2"...),
  // навіть якщо в Python це були int. Тому конвертуємо всі ключі назад у числа.
  const userAnswers = {};
  for (const [key, val] of Object.entries(result.user_answers || {})) {
    userAnswers[parseInt(key, 10)] = val;
  }

  document.querySelector('.app-main').innerHTML = `
    <div class="question-panel" style="grid-column: 1 / -1;">
      <div class="question-card" style="text-align: center; padding: 3rem 2rem;">
        <div style="font-size: 3.5rem; margin-bottom: 1rem;">${emoji}</div>
        <div class="question-number" style="font-size: 0.85rem; margin-bottom: 0.5rem;">РЕЗУЛЬТАТ ТЕСТУ</div>
        <div style="
          font-family: var(--font-display);
          font-size: 5rem; font-weight: 700;
          color: var(--color-accent); line-height: 1;
          margin-bottom: 0.5rem;
        ">${result.score}/${result.max_score}</div>
        <div style="color: var(--color-text-muted); margin-bottom: 0.5rem;">
          <strong style="color: var(--color-text); font-size: 1.2rem;">${scorePercent}%</strong>
        </div>
        <div style="color: var(--color-text-muted); font-size: 0.9rem; margin-bottom: 2rem;">
          ${comment}
        </div>
        <div style="
          display: inline-flex; gap: 1.5rem;
          background: var(--color-surface-2); border: 1px solid var(--color-border);
          border-radius: var(--radius-md); padding: 0.75rem 1.5rem;
          font-size: 0.85rem; color: var(--color-text-muted);
          margin-bottom: 2.5rem; flex-wrap: wrap; justify-content: center;
        ">
          <span>⏱ Витрачено: ${formatTime(result.time_spent)}</span>
          <span>✓ Правильно: ${result.score} з ${result.max_score}</span>
        </div>

        <div style="text-align: left; margin-bottom: 2rem;">
          <div class="question-number" style="margin-bottom: 1rem;">РОЗБІР ВІДПОВІДЕЙ</div>
          ${result.questions.map((q, i) => {
            // Тепер ключі числові — порівняння працює коректно
            const userAnswerId = userAnswers[q.id];
            const isCorrect    = userAnswerId != null && userAnswerId === q.correct_answer_id;
            const userOpt      = q.options.find(o => o.id === userAnswerId);
            const correctOpt   = q.options.find(o => o.id === q.correct_answer_id);
            return `
              <div style="
                padding: 1rem; margin-bottom: 0.75rem;
                background: var(--color-surface-2); border-radius: var(--radius-md);
                border-left: 3px solid ${isCorrect ? 'var(--color-success)' : 'var(--color-danger)'};
              ">
                <div style="font-size: 0.78rem; color: var(--color-text-muted); margin-bottom: 0.4rem;">
                  ${isCorrect ? '✅' : '❌'} Питання ${i + 1}
                </div>
                <div style="font-size: 0.9rem; margin-bottom: 0.5rem;">${q.text}</div>
                ${!isCorrect ? `
                  <div style="font-size: 0.82rem; color: var(--color-danger);">
                    Ваша відповідь: ${userOpt?.text || '<em>не відповіли</em>'}
                  </div>
                  <div style="font-size: 0.82rem; color: var(--color-success);">
                    Правильна: ${correctOpt?.text || '—'}
                  </div>
                ` : ''}
                ${q.explanation ? `
                  <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.4rem; font-style: italic;">
                    💡 ${q.explanation}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>

        <div style="display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
          <button class="btn btn-ghost" onclick="window.location.href='tests.html'">← До списку тестів</button>
          <button class="btn btn-primary" onclick="window.location.href='tests.html'">Пройти інший тест</button>
        </div>
      </div>
    </div>
  `;
}

// ============================================
// 5. ТАЙМЕР
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
    if (state.timeLeft % 10 === 0) saveStateToStorage();
  }, 1000);
}

// ============================================
// 6. МОДАЛЬНІ ВІКНА
// ============================================

function openModal(id) {
  document.getElementById(id)?.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('visible'));
  document.body.style.overflow = '';
}

async function submitReport() {
  const type    = document.getElementById('report-type').value;
  const comment = document.getElementById('report-comment').value.trim();

  if (!comment) {
    showToast('⚠ Опишіть помилку перед відправкою', 'error');
    return;
  }

  const btn = document.getElementById('btn-submit-report');
  btn.textContent = 'Надсилання...';
  btn.disabled = true;

  try {
    const q = state.testData.questions[state.currentQuestionIndex];
    await api.sendReport({
      question_id: q.id,
      report_type: type,
      comment,
    });
    document.getElementById('report-comment').value = '';
    closeAllModals();
    showToast('✅ Репорт надіслано. Дякуємо!', 'success');
  } catch (err) {
    showToast(`❌ Помилка: ${err.message}`, 'error');
  } finally {
    btn.textContent = '📤 Надіслати репорт';
    btn.disabled = false;
  }
}

// ============================================
// 7. ЗБЕРЕЖЕННЯ СТАНУ
// ============================================

function saveStateToStorage() {
  const key = `nmt_state_${state.sessionToken}`;
  try {
    localStorage.setItem(key, JSON.stringify({
      currentQuestionIndex: state.currentQuestionIndex,
      answers:  state.answers,
      skipped:  state.skipped,
      timeLeft: state.timeLeft,
      savedAt:  Date.now(),
    }));
  } catch(e) { console.warn('localStorage error:', e); }
}

function loadStateFromStorage() {
  const key = `nmt_state_${state.sessionToken}`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    // Ігноруємо якщо збережено більше 24 годин тому
    if ((Date.now() - saved.savedAt) / 3600000 > 24) {
      localStorage.removeItem(key);
      return false;
    }
    state.currentQuestionIndex = saved.currentQuestionIndex || 0;
    state.answers  = saved.answers  || {};
    state.skipped  = saved.skipped  || {};
    state.timeLeft = saved.timeLeft || state.testData.duration;
    return true;
  } catch(e) { return false; }
}

function clearStateFromStorage() {
  try {
    localStorage.removeItem(`nmt_state_${state.sessionToken}`);
    localStorage.removeItem('active_session_token');
    localStorage.removeItem('active_test_id');
  } catch(e) {}
}

// ============================================
// 8. УТИЛІТИ
// ============================================

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function showToast(message, type = 'default') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type !== 'default' ? type : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function showLoadingScreen(visible) {
  const el = document.getElementById('loading-screen');
  if (el) el.style.display = visible ? 'flex' : 'none';
}

function showFatalError(message) {
  document.body.innerHTML = `
    <div style="
      min-height: 100vh; display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      font-family: sans-serif; color: #e6edf3; background: #0d1117;
      gap: 1rem; padding: 2rem; text-align: center;
    ">
      <div style="font-size: 3rem;">⚠️</div>
      <p style="color: #8b949e; max-width: 400px;">${message}</p>
      <a href="tests.html" style="
        color: #58a6ff; text-decoration: none; border: 1px solid #58a6ff;
        padding: 8px 20px; border-radius: 6px;
      ">← Повернутись до списку тестів</a>
    </div>
  `;
}
