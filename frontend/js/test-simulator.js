/**
 * test-simulator.js — Симулятор тесту НМТ
 * =========================================
 * ПРАВИЛО: TOKEN_KEY, USER_KEY, getCurrentUser, logout — НЕ оголошувати тут.
 * Вони глобальні з api.js.
 *
 * Підтримувані типи питань:
 *   single   — радіо-кнопки, state.answers[id] = {answer_id: N}
 *   multiple — чекбокси,     state.answers[id] = {answer_ids: [N, M]}
 *   matching — select-и,     state.answers[id] = {pairs: {"1":"A","2":"C"}}
 *   open     — input text,   state.answers[id] = {text: "42"}
 */

// ============================================
// 1. СТАН ДОДАТКУ
// ============================================

const state = {
  sessionToken: null,
  testData:     null,
  currentIndex: 0,
  // answers: { [questionId]: answer_data }
  // answer_data формат залежить від типу питання (див. вище)
  answers:      {},
  skipped:      {},
  timeLeft:     0,
};

let timerInterval  = null;
let openDebounceId = null; // debounce для open-input

// ============================================
// 2. ІНІЦІАЛІЗАЦІЯ
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams    = new URLSearchParams(window.location.search);
  state.sessionToken = urlParams.get('session');
  const testId       = localStorage.getItem('active_test_id');

  if (!state.sessionToken || !testId) {
    return redirectToTests('Сесію не знайдено. Будь ласка, почніть тест заново.');
  }

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

  restoreStateFromStorage();

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

function renderQuestion() {
  const q     = currentQuestion();
  const total = state.testData.questions.length;
  const num   = state.currentIndex + 1;

  document.getElementById('question-number').textContent = `Питання ${num} з ${total}`;
  document.getElementById('question-text').innerHTML     = q.text;

  // Зображення питання
  const existingImg = document.getElementById('question-image-wrap');
  if (existingImg) existingImg.remove();

  if (q.image_url) {
    const imgWrap = document.createElement('div');
    imgWrap.id = 'question-image-wrap';
    imgWrap.style.cssText = 'margin-top:1.25rem;';
    imgWrap.innerHTML = `
      <img src="${q.image_url}" alt="Ілюстрація до питання" class="question-image"
        style="display:block;max-width:100%;max-height:320px;width:auto;
               border-radius:var(--radius-md);border:1px solid var(--color-border);
               background:var(--color-surface-2);object-fit:contain;"
        onerror="this.parentElement.style.display='none'">
    `;
    document.getElementById('question-text').after(imgWrap);
  }

  renderOptions(q);
  updateNavigator();
  updateNavButtons();
}

/**
 * Рендерить варіанти відповідей залежно від типу питання.
 */
function renderOptions(question) {
  const list = document.getElementById('options-list');

  // Очищаємо попередній вміст (включно з debounce-слухачами)
  list.innerHTML = '';

  switch (question.type) {

    // ─── SINGLE — радіо-кнопки ───────────────────────────────
    case 'single':
      renderSingleOptions(list, question);
      break;

    // ─── MULTIPLE — чекбокси ─────────────────────────────────
    case 'multiple':
      renderMultipleOptions(list, question);
      break;

    // ─── MATCHING — таблиця з select-ами ─────────────────────
    case 'matching':
      renderMatchingOptions(list, question);
      break;

    // ─── OPEN — текстовий input ───────────────────────────────
    case 'open':
      renderOpenInput(list, question);
      break;

    default:
      list.innerHTML = `<li style="color:var(--color-text-muted);">Невідомий тип питання: ${question.type}</li>`;
  }
}

// ─── Рендер single ───────────────────────────────────────────

function renderSingleOptions(list, question) {
  const selectedId = state.answers[question.id]?.answer_id ?? null;
  const letters    = ['А', 'Б', 'В', 'Г', 'Д'];

  list.innerHTML = question.options.map((opt, i) => `
    <li class="option-item">
      <button
        class="option-btn ${opt.id === selectedId ? 'selected' : ''}"
        data-question-id="${question.id}"
        data-option-id="${opt.id}"
        data-question-type="single"
      >
        <span class="option-letter">${letters[i] ?? i + 1}</span>
        <span class="option-text">${opt.text}</span>
      </button>
    </li>
  `).join('');
}

// ─── Рендер multiple ─────────────────────────────────────────

function renderMultipleOptions(list, question) {
  const selectedIds = new Set(state.answers[question.id]?.answer_ids ?? []);
  const letters     = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Є'];

  list.innerHTML = `
    <li class="option-item" style="color:var(--color-text-muted);font-size:0.8rem;padding:0 0.25rem 0.75rem;">
      Оберіть усі правильні відповіді (може бути декілька)
    </li>
    ${question.options.map((opt, i) => `
      <li class="option-item">
        <label class="option-btn ${selectedIds.has(opt.id) ? 'selected' : ''}"
          style="cursor:pointer;" data-option-label>
          <input
            type="checkbox"
            style="display:none;"
            data-question-id="${question.id}"
            data-option-id="${opt.id}"
            data-question-type="multiple"
            ${selectedIds.has(opt.id) ? 'checked' : ''}
          >
          <span class="option-letter">${letters[i] ?? i + 1}</span>
          <span class="option-text">${opt.text}</span>
        </label>
      </li>
    `).join('')}
  `;

  // Обробники для чекбоксів
  list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => onMultipleChange(question));
  });
}

// ─── Рендер matching — два блоки (НМТ-стиль) ─────────────────

/**
 * renderMatchingOptions — НМТ-формат з двох блоків:
 *
 * БЛОК 1: Умова — два стовпчики з текстами
 *   Ліворуч: 1. Твердження один
 *            2. Твердження два
 *   Праворуч: А. Варіант перший
 *             Б. Варіант другий
 *
 * БЛОК 2: Компактна матриця відповідей — тільки цифри і букви
 *   Колонки: А Б В Г Д
 *   Рядки:   1 (○ ○ ○ ○ ○)
 *            2 (○ ○ ○ ○ ○)
 *
 * Логіка унікальності збережена у handleMatchingClick().
 * state.answers[qId] = { pairs: {"1":"А","2":"Г",...} }
 */
function renderMatchingOptions(list, question) {
  const content    = question.content || {};
  const leftSide   = content.left  || [];
  const rightSide  = content.right || [];
  const savedPairs = state.answers[question.id]?.pairs || {};
  const qId        = question.id;

  // ── Обгортка ──
  const wrapper = document.createElement('li');
  wrapper.className  = 'option-item';
  wrapper.style.cssText = 'padding:0; list-style:none;';

  // ════════════════════════════════════════
  // БЛОК 1: Умова (тексти тверджень і варіантів)
  // ════════════════════════════════════════
  const conditionBlock = document.createElement('div');
  conditionBlock.style.cssText = `
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem 1.25rem;
    margin-bottom: 1.25rem;
    padding: 1rem 1.25rem;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  `;

  // Заголовки колонок
  const leftHeader = document.createElement('div');
  leftHeader.style.cssText = `
    font-family: var(--font-display); font-size: 0.6rem;
    font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--color-text-faint); margin-bottom: 0.4rem;
    grid-column: 1;
  `;
  leftHeader.textContent = 'Твердження';

  const rightHeader = document.createElement('div');
  rightHeader.style.cssText = leftHeader.style.cssText;
  rightHeader.style.gridColumn = '2';
  rightHeader.textContent = 'Варіанти відповідей';

  conditionBlock.appendChild(leftHeader);
  conditionBlock.appendChild(rightHeader);

  // Заповнюємо обидві колонки — рівну кількість рядків
  const maxRows = Math.max(leftSide.length, rightSide.length);
  for (let i = 0; i < maxRows; i++) {
    // Ліва колонка
    const leftDiv = document.createElement('div');
    leftDiv.style.cssText = `
      font-size: 0.88rem; line-height: 1.5; padding: 2px 0;
      color: var(--color-text);
    `;
    if (leftSide[i]) {
      leftDiv.innerHTML =
        `<span style="font-family:var(--font-mono);font-weight:700;color:var(--color-accent);
          margin-right:0.35rem;">${leftSide[i].id}.</span>${leftSide[i].text}`;
    }
    conditionBlock.appendChild(leftDiv);

    // Права колонка
    const rightDiv = document.createElement('div');
    rightDiv.style.cssText = leftDiv.style.cssText;
    if (rightSide[i]) {
      rightDiv.innerHTML =
        `<span style="font-family:var(--font-mono);font-weight:700;color:var(--color-blue);
          margin-right:0.35rem;">${rightSide[i].id}.</span>${rightSide[i].text}`;
    }
    conditionBlock.appendChild(rightDiv);
  }

  wrapper.appendChild(conditionBlock);

  // ════════════════════════════════════════
  // БЛОК 2: Матриця відповідей (тільки цифри і букви)
  // ════════════════════════════════════════
  const matrixLabel = document.createElement('div');
  matrixLabel.style.cssText = `
    font-size: 0.75rem; color: var(--color-text-muted);
    margin-bottom: 0.5rem;
  `;
  matrixLabel.textContent = 'Встановіть відповідність (кожна буква — лише один раз):';
  wrapper.appendChild(matrixLabel);

  // Таблиця матриці — компактна, без текстів
  const table = document.createElement('table');
  table.dataset.questionId = qId;
  table.style.cssText = `
    border-collapse: collapse;
    table-layout: fixed;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  `;
  // Ширина: перша колонка (номер) + рівні колонки для букв
  // Не 100% — матриця компактна, не розтягнута на всю ширину
  const radioColPx = 56; // px на колонку (зручно для мобільного)
  const numColPx   = 36;
  const totalPx    = numColPx + rightSide.length * radioColPx;
  table.style.width = `${totalPx}px`;
  table.style.maxWidth = '100%';

  // ─ Заголовок матриці: порожня комірка + букви ─
  const thead = document.createElement('thead');
  const hRow  = document.createElement('tr');
  hRow.style.background = 'var(--color-surface)';

  const thNum = document.createElement('th');
  thNum.style.cssText = `
    width: ${numColPx}px; padding: 6px 4px;
    border: 1px solid var(--color-border);
    text-align: center;
  `;
  thNum.textContent = '';
  hRow.appendChild(thNum);

  rightSide.forEach(r => {
    const th = document.createElement('th');
    th.style.cssText = `
      width: ${radioColPx}px; padding: 6px 4px;
      border: 1px solid var(--color-border);
      text-align: center;
      font-family: var(--font-mono); font-size: 0.95rem; font-weight: 700;
      color: var(--color-blue);
    `;
    th.textContent = r.id;
    hRow.appendChild(th);
  });

  thead.appendChild(hRow);
  table.appendChild(thead);

  // ─ Тіло матриці: рядки з цифрами і radio ─
  const tbody = document.createElement('tbody');

  leftSide.forEach((leftItem, rowIdx) => {
    const tr = document.createElement('tr');
    if (rowIdx % 2 === 1) {
      tr.style.background = 'rgba(255,255,255,0.025)';
    }

    // Комірка номера (тільки цифра)
    const tdNum = document.createElement('td');
    tdNum.style.cssText = `
      padding: 6px 4px;
      border: 1px solid var(--color-border);
      text-align: center; vertical-align: middle;
      font-family: var(--font-mono); font-size: 0.95rem; font-weight: 700;
      color: var(--color-accent);
    `;
    tdNum.textContent = leftItem.id;
    tr.appendChild(tdNum);

    // Комірки radio для кожної букви
    rightSide.forEach(r => {
      const isSelected = savedPairs[leftItem.id] === r.id;

      const td = document.createElement('td');
      td.style.cssText = `
        padding: 4px;
        border: 1px solid var(--color-border);
        text-align: center; vertical-align: middle;
        transition: background 0.12s ease;
        ${isSelected ? 'background: var(--color-blue-bg);' : ''}
      `;
      td.dataset.leftId  = leftItem.id;
      td.dataset.rightId = r.id;

      // Мінімальний label — вся комірка клікабельна
      const label = document.createElement('label');
      label.style.cssText = `
        display: flex; align-items: center; justify-content: center;
        width: 100%; min-height: 44px; cursor: pointer;
      `;
      label.title = `${leftItem.id} → ${r.id}`;

      const radio = document.createElement('input');
      radio.type             = 'radio';
      radio.name             = `matching-${qId}-row-${leftItem.id}`;
      radio.value            = r.id;
      radio.checked          = isSelected;
      radio.dataset.leftId   = leftItem.id;
      radio.dataset.rightId  = r.id;
      radio.dataset.qId      = qId;
      radio.style.cssText    = `
        width: 20px; height: 20px; cursor: pointer;
        accent-color: var(--color-blue);
      `;

      radio.addEventListener('change', () => {
        handleMatchingClick(qId, leftItem.id, r.id, table);
      });

      label.appendChild(radio);
      td.appendChild(label);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrapper.appendChild(table);
  list.appendChild(wrapper);
}

// ─── Рендер open ─────────────────────────────────────────────

function renderOpenInput(list, question) {
  const savedText = state.answers[question.id]?.text ?? '';

  list.innerHTML = `
    <li class="option-item">
      <div style="padding:0.5rem 0.25rem;">
        <label style="font-size:0.8rem;color:var(--color-text-muted);display:block;margin-bottom:0.5rem;">
          Введіть вашу відповідь:
        </label>
        <input
          type="text"
          id="open-answer-input"
          value="${savedText.replace(/"/g, '&quot;')}"
          placeholder="Введіть число або слово..."
          autocomplete="off"
          style="
            width:100%; padding:12px 14px;
            background:var(--color-surface-2);
            border:1px solid var(--color-border);
            border-radius:var(--radius-md);
            color:var(--color-text);
            font-family:var(--font-mono);
            font-size:1rem;
            transition:border-color 0.15s ease;
            user-select:text; -webkit-user-select:text;
          "
        >
        <div style="font-size:0.75rem;color:var(--color-text-faint);margin-top:0.4rem;">
          Ваша відповідь зберігається автоматично
        </div>
      </div>
    </li>
  `;

  const input = document.getElementById('open-answer-input');
  if (input) {
    // focus-стиль
    input.addEventListener('focus',  () => { input.style.borderColor = 'var(--color-accent)'; });
    input.addEventListener('blur',   () => {
      input.style.borderColor = input.value.trim() ? 'var(--color-blue)' : 'var(--color-border)';
    });

    // Debounce — зберігаємо через 400мс після останнього введення
    input.addEventListener('input', () => {
      clearTimeout(openDebounceId);
      openDebounceId = setTimeout(() => {
        onOpenInput(question, input.value);
      }, 400);
    });

    // Одразу зберегти якщо вже є текст
    if (savedText) input.style.borderColor = 'var(--color-blue)';
  }
}

// ============================================
// 4. НАВІГАТОР
// ============================================

function renderHeader() {
  document.getElementById('subject-badge').textContent = state.testData.subject.name;
  document.getElementById('test-title').textContent    = state.testData.title;

  if (state.testData.reference_materials) {
    document.getElementById('modal-reference-body').innerHTML =
      state.testData.reference_materials;
  }
}

function renderNavigator() {
  const grid = document.getElementById('nav-grid');

  grid.innerHTML = state.testData.questions.map((_, i) => `
    <button class="nav-cell" id="nav-cell-${i}" data-index="${i}">${i + 1}</button>
  `).join('');

  updateNavigator();
  updateProgressBar();
}

function updateNavigator() {
  state.testData.questions.forEach((q, i) => {
    const cell = document.getElementById(`nav-cell-${i}`);
    if (!cell) return;
    cell.className = 'nav-cell';

    if (i === state.currentIndex) {
      cell.classList.add('active');
    } else if (_hasAnswer(q)) {
      cell.classList.add('answered');
    } else if (state.skipped[q.id]) {
      cell.classList.add('skipped');
    }
  });
}

/** Перевіряє чи є непорожня відповідь на питання */
function _hasAnswer(q) {
  const a = state.answers[q.id];
  if (!a) return false;
  if (q.type === 'single')   return a.answer_id != null;
  if (q.type === 'multiple') return (a.answer_ids?.length ?? 0) > 0;
  if (q.type === 'matching') return Object.keys(a.pairs ?? {}).length > 0;
  if (q.type === 'open')     return (a.text ?? '').trim().length > 0;
  return false;
}

function updateProgressBar() {
  const total    = state.testData.questions.length;
  const answered = state.testData.questions.filter(q => _hasAnswer(q)).length;

  document.getElementById('progress-fill').style.width =
    `${(answered / total) * 100}%`;
  document.getElementById('progress-text').textContent =
    `${answered} / ${total} відповідей`;
}

function updateNavButtons() {
  const isFirst = state.currentIndex === 0;
  const isLast  = state.currentIndex === state.testData.questions.length - 1;
  const btnNext = document.getElementById('btn-next');

  document.getElementById('btn-prev').disabled = isFirst;
  btnNext.textContent = isLast ? '✓ Завершити' : 'Далі →';
  btnNext.className   = isLast ? 'btn btn-finish' : 'btn btn-primary';
}

function updateTimerDisplay() {
  const el = document.getElementById('timer');
  document.getElementById('timer-value').textContent = formatTime(state.timeLeft);
  el.className = 'timer';
  if      (state.timeLeft <= 60)  el.classList.add('danger');
  else if (state.timeLeft <= 180) el.classList.add('warning');
}

// ============================================
// 5. ОБРОБНИКИ ПОДІЙ
// ============================================

function setupEventListeners() {
  // Вибір відповіді — single: клік по .option-btn
  document.getElementById('options-list').addEventListener('click', e => {
    const btn = e.target.closest('.option-btn[data-question-type="single"]');
    if (btn) onSingleSelect(btn.dataset.questionId, parseInt(btn.dataset.optionId, 10));
  });

  // Навігатор
  document.getElementById('nav-grid').addEventListener('click', e => {
    const cell = e.target.closest('.nav-cell');
    if (cell) goToQuestion(parseInt(cell.dataset.index, 10));
  });

  document.getElementById('btn-prev').addEventListener('click', () =>
    goToQuestion(state.currentIndex - 1));

  document.getElementById('btn-next').addEventListener('click', () => {
    const isLast = state.currentIndex === state.testData.questions.length - 1;
    isLast ? confirmAndFinish() : goToQuestion(state.currentIndex + 1);
  });

  document.getElementById('btn-skip').addEventListener('click', onSkip);
  document.getElementById('btn-finish-nav').addEventListener('click', confirmAndFinish);

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
// 6. ЛОГІКА ВІДПОВІДІ ПО ТИПАХ
// ============================================

/** single: клік на кнопку варіанту */
function onSingleSelect(questionId, optionId) {
  _setAnswer(questionId, { answer_id: optionId });
  renderOptions(currentQuestion());
  _afterAnswer(questionId);
}

/** multiple: зміна чекбокса */
function onMultipleChange(question) {
  const checked = [...document.querySelectorAll(
    `input[type="checkbox"][data-question-id="${question.id}"]:checked`
  )].map(cb => parseInt(cb.dataset.optionId, 10));

  _setAnswer(question.id, { answer_ids: checked });

  // Оновлюємо візуальний стан label
  document.querySelectorAll(
    `input[type="checkbox"][data-question-id="${question.id}"]`
  ).forEach(cb => {
    const label = cb.closest('label');
    if (label) label.classList.toggle('selected', cb.checked);
  });

  _afterAnswer(question.id);
}

/**
 * matching: клік на radio в сітці відповідностей.
 *
 * Логіка унікальності:
 *   Перш ніж встановити нову пару (leftId → rightId),
 *   перевіряємо чи ця rightId вже вибрана для ІНШОГО рядка.
 *   Якщо так — знімаємо попередній вибір і підсвічування.
 *
 * @param {number} qId      — ID питання
 * @param {string} leftId   — ID твердження зліва ("1","2",...)
 * @param {string} rightId  — ID букви справа ("А","Б",...)
 * @param {HTMLElement} table — DOM-елемент таблиці
 */
function handleMatchingClick(qId, leftId, rightId, table) {
  // Поточний стан пар для цього питання
  const pairs = { ...(state.answers[qId]?.pairs || {}) };

  // Шукаємо: чи rightId вже зайнята іншим рядком?
  const prevLeftId = Object.keys(pairs).find(
    k => k !== leftId && pairs[k] === rightId
  );

  if (prevLeftId) {
    // Знімаємо попередній вибір з іншого рядка
    delete pairs[prevLeftId];

    // Знімаємо підсвічування TD для prevLeftId
    table.querySelectorAll(`td[data-left-id="${prevLeftId}"]`)
      .forEach(td => { td.style.background = ''; });

    // Знімаємо radio в попередньому рядку (браузер сам не скине —
    // radio з різними name не конфліктують між рядками)
    const prevRadio = table.querySelector(
      `input[type="radio"][data-left-id="${prevLeftId}"][data-right-id="${rightId}"]`
    );
    if (prevRadio) prevRadio.checked = false;
  }

  // Записуємо нову пару
  pairs[leftId] = rightId;

  // Підсвічуємо вибрану TD, скидаємо решту в цьому рядку
  table.querySelectorAll(`td[data-left-id="${leftId}"]`).forEach(td => {
    td.style.background = td.dataset.rightId === rightId
      ? 'var(--color-blue-bg)'
      : '';
  });

  _setAnswer(qId, { pairs });
  _afterAnswer(qId);
}

/** open: введення тексту (з debounce) */
function onOpenInput(question, text) {
  const val = text.trim();
  _setAnswer(question.id, val ? { text: val } : null);
  _afterAnswer(question.id);
}

/** Внутрішній хелпер: встановити відповідь і зняти skipped */
function _setAnswer(questionId, data) {
  if (data !== null) {
    state.answers[questionId] = data;
  } else {
    delete state.answers[questionId];
  }
  delete state.skipped[questionId];
}

/** Після будь-якої відповіді: UI + localStorage + API */
function _afterAnswer(questionId) {
  updateNavigator();
  updateProgressBar();
  saveStateToStorage();

  api.saveAnswer(state.sessionToken, {
    question_id: parseInt(questionId, 10),
    answer_data: state.answers[questionId] ?? null,
    is_skipped:  false,
    time_left:   state.timeLeft,
  }).catch(err => console.warn('[sync] saveAnswer:', err.message));
}

function onSkip() {
  const q = currentQuestion();
  if (!_hasAnswer(q)) {
    state.skipped[q.id] = true;
    saveStateToStorage();

    api.saveAnswer(state.sessionToken, {
      question_id: q.id,
      answer_data: null,
      is_skipped:  true,
      time_left:   state.timeLeft,
    }).catch(err => console.warn('[sync] skip:', err.message));

    showToast('⏭ Питання пропущено', 'default');
  }

  const isLast = state.currentIndex === state.testData.questions.length - 1;
  if (!isLast) goToQuestion(state.currentIndex + 1);
}

function goToQuestion(index) {
  const max = state.testData.questions.length - 1;
  if (index < 0 || index > max) return;

  state.currentIndex = index;
  renderQuestion();

  if (window.innerWidth <= 768) {
    document.getElementById('question-panel')?.scrollIntoView({ behavior: 'smooth' });
  }
}

// ============================================
// 7. ЗАВЕРШЕННЯ ТЕСТУ
// ============================================

function confirmAndFinish() {
  const unanswered = state.testData.questions.filter(q => !_hasAnswer(q)).length;

  if (unanswered > 0) {
    const ok = window.confirm(
      `Залишилось ${unanswered} питань без відповіді.\nЗавершити тест?`
    );
    if (!ok) return;
  }

  finishTest();
}

async function finishTest() {
  clearInterval(timerInterval);
  document.getElementById('btn-finish-nav').disabled = true;
  document.getElementById('btn-next').disabled       = true;

  try {
    const result = await api.finishSession(state.sessionToken);
    clearStorage();
    showResults(result);
  } catch (err) {
    document.getElementById('btn-finish-nav').disabled = false;
    document.getElementById('btn-next').disabled       = false;
    showToast(`❌ Помилка: ${err.message}`, 'error');
  }
}

// ============================================
// 8. ЕКРАН РЕЗУЛЬТАТІВ
// ============================================

function showResults(result) {
  document.getElementById('simulator-container').style.display = 'none';
  document.querySelector('.app-header').style.display          = 'none';
  renderResults(result);
  document.getElementById('results-container').style.display = 'block';
}

function renderResults(result) {
  const { score, max_score, percentage, time_spent, questions } = result;

  // user_answers: { "questionId": answer_data }
  const userAnswers = result.user_answers ?? {};

  const emoji   = percentage >= 75 ? '🎉' : percentage >= 50 ? '👍' : '📚';
  const comment = percentage >= 75
    ? 'Відмінний результат! Ти добре підготовлений.'
    : percentage >= 50
    ? 'Непоганий результат. Є куди зростати.'
    : 'Варто повторити матеріал і спробувати ще раз.';

  const questionsHTML = questions.map((q, i) => {
    const userAnswerData    = userAnswers[String(q.id)];
    const { isCorrect, userText, correctText } =
      _evaluateForDisplay(q, userAnswerData);

    return `
      <div style="
        padding:1rem; margin-bottom:0.75rem;
        background:var(--color-surface-2); border-radius:var(--radius-md);
        border-left:3px solid ${isCorrect ? 'var(--color-success)' : 'var(--color-danger)'};
      ">
        <div style="font-size:0.75rem;color:var(--color-text-muted);margin-bottom:0.35rem;
          display:flex;align-items:center;justify-content:space-between;">
          <span>${isCorrect ? '✅' : '❌'} Питання ${i + 1}
            <span style="margin-left:0.5rem;opacity:0.6;">[${q.type}]</span>
          </span>
          <span style="font-family:var(--font-mono);font-size:0.8rem;color:var(--color-accent);">
            ${isCorrect ? q.points : 0}/${q.points} балів
          </span>
        </div>
        <div style="font-size:0.88rem;margin-bottom:0.5rem;line-height:1.5;">${q.text}</div>
        ${!isCorrect ? `
          <div style="font-size:0.82rem;color:var(--color-danger);">Ваша відповідь: ${userText}</div>
          <div style="font-size:0.82rem;color:var(--color-success);margin-top:2px;">Правильна: ${correctText}</div>
        ` : ''}
        ${q.explanation ? `
          <div style="font-size:0.78rem;color:var(--color-text-muted);margin-top:0.4rem;font-style:italic;">
            💡 ${q.explanation}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  document.getElementById('results-container').innerHTML = `
    <div style="max-width:720px;margin:0 auto;padding:2rem 1.5rem;">
      <div class="question-card" style="text-align:center;padding:2.5rem 2rem 2rem;">
        <div style="font-size:3rem;margin-bottom:0.75rem;">${emoji}</div>
        <div style="font-family:var(--font-display);font-size:4.5rem;font-weight:700;
          color:var(--color-accent);line-height:1;margin-bottom:0.4rem;">
          ${score}/${max_score}
        </div>
        <div style="font-size:1rem;color:var(--color-text-muted);margin-bottom:0.4rem;">
          <strong style="color:var(--color-text);font-size:1.3rem;">${percentage}%</strong>
        </div>
        <div style="font-size:0.88rem;color:var(--color-text-muted);margin-bottom:1.75rem;">${comment}</div>
        <div style="display:inline-flex;gap:1.5rem;flex-wrap:wrap;justify-content:center;
          background:var(--color-surface-2);border:1px solid var(--color-border);
          border-radius:var(--radius-md);padding:0.75rem 1.5rem;
          font-size:0.82rem;color:var(--color-text-muted);margin-bottom:2rem;">
          <span>⏱ Витрачено: ${formatTime(time_spent)}</span>
          <span>✓ Набрано: ${score} з ${max_score} балів</span>
        </div>
        <div style="text-align:left;">
          <div style="font-family:var(--font-display);font-size:0.6rem;font-weight:700;
            letter-spacing:0.1em;text-transform:uppercase;color:var(--color-accent);
            margin-bottom:1rem;">Розбір відповідей</div>
          ${questionsHTML}
        </div>
        <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;margin-top:2rem;">
          <button class="btn btn-ghost" onclick="window.location.href='tests.html'">← До списку</button>
          <button class="btn btn-primary" onclick="window.location.href='tests.html'">Пройти ще один</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Формує текстовий опис відповіді студента і правильної відповіді
 * для відображення у розборі (тільки для фронтенду).
 */
function _evaluateForDisplay(q, userAnswerData) {
  const correct_data = q.correct_data || {};
  let isCorrect   = false;
  let userText    = '<em>не відповіли</em>';
  let correctText = '—';

  if (!userAnswerData) {
    // Будуємо correctText незалежно
    correctText = _buildCorrectText(q, correct_data);
    return { isCorrect: false, userText, correctText };
  }

  switch (q.type) {
    case 'single': {
      const userId   = userAnswerData?.answer_id;
      const corrId   = correct_data?.answer_id;
      isCorrect      = userId === corrId;
      const userOpt  = q.options.find(o => o.id === userId);
      const corrOpt  = q.options.find(o => o.id === corrId);
      userText    = userOpt?.text ?? String(userId ?? '—');
      correctText = corrOpt?.text ?? String(corrId ?? '—');
      break;
    }
    case 'multiple': {
      const userIds = new Set(userAnswerData?.answer_ids ?? []);
      const corrIds = new Set(correct_data?.answer_ids ?? []);
      isCorrect  = userIds.size === corrIds.size &&
                   [...userIds].every(id => corrIds.has(id));
      const letters = ['А','Б','В','Г','Д','Е','Є'];
      const toLetters = (ids) => q.options
        .filter(o => ids.has(o.id))
        .map((o, _i) => {
          const idx = q.options.indexOf(o);
          return `${letters[idx] ?? idx + 1}. ${o.text}`;
        }).join(', ') || '—';
      userText    = toLetters(userIds);
      correctText = toLetters(corrIds);
      break;
    }
    case 'matching': {
      const corrPairs = correct_data?.pairs ?? {};
      const userPairs = userAnswerData?.pairs ?? {};
      const total = Object.keys(corrPairs).length;
      const right = Object.entries(corrPairs).filter(
        ([k, v]) => String(userPairs[k]) === String(v)
      ).length;
      isCorrect = right === total && total > 0;

      const content   = q.content || {};
      const leftMap   = Object.fromEntries((content.left  || []).map(i => [i.id, i.text]));
      const rightMap  = Object.fromEntries((content.right || []).map(i => [i.id, i.text]));
      userText = Object.entries(userPairs)
        .map(([l, r]) => `${l}→${r}`)
        .join(', ') || '—';
      correctText = Object.entries(corrPairs)
        .map(([l, r]) => `${leftMap[l] ?? l} → ${rightMap[r] ?? r}`)
        .join(', ') || '—';
      break;
    }
    case 'open': {
      const corrAnswers = (correct_data?.answers ?? [])
        .map(a => String(a).trim().toLowerCase());
      const uText  = String(userAnswerData?.text ?? '').trim();
      isCorrect    = corrAnswers.includes(uText.toLowerCase());
      userText     = uText || '<em>не відповіли</em>';
      correctText  = correct_data?.answers?.join(' або ') ?? '—';
      break;
    }
  }

  return { isCorrect, userText, correctText };
}

function _buildCorrectText(q, correct_data) {
  switch (q.type) {
    case 'single': {
      const opt = q.options.find(o => o.id === correct_data?.answer_id);
      return opt?.text ?? '—';
    }
    case 'multiple': {
      const ids = new Set(correct_data?.answer_ids ?? []);
      return q.options.filter(o => ids.has(o.id)).map(o => o.text).join(', ') || '—';
    }
    case 'matching': {
      const content  = q.content || {};
      const rightMap = Object.fromEntries((content.right || []).map(i => [i.id, i.text]));
      return Object.entries(correct_data?.pairs ?? {})
        .map(([l, r]) => `${l}→${rightMap[r] ?? r}`).join(', ') || '—';
    }
    case 'open':
      return correct_data?.answers?.join(' або ') ?? '—';
    default:
      return '—';
  }
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
    if (state.timeLeft % 10 === 0) saveStateToStorage();
  }, 1000);
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

function saveStateToStorage() {
  try {
    localStorage.setItem(`nmt_session_${state.sessionToken}`, JSON.stringify({
      currentIndex: state.currentIndex,
      answers:      state.answers,
      skipped:      state.skipped,
      timeLeft:     state.timeLeft,
      savedAt:      Date.now(),
    }));
  } catch (e) { console.warn('localStorage write:', e); }
}

function restoreStateFromStorage() {
  state.timeLeft = state.testData.duration;
  try {
    const raw = localStorage.getItem(`nmt_session_${state.sessionToken}`);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (Date.now() - saved.savedAt > 24 * 3600 * 1000) {
      localStorage.removeItem(`nmt_session_${state.sessionToken}`);
      return;
    }
    state.currentIndex = saved.currentIndex ?? 0;
    state.answers      = saved.answers      ?? {};
    state.skipped      = saved.skipped      ?? {};
    state.timeLeft     = saved.timeLeft     ?? state.testData.duration;
    showToast('💾 Прогрес відновлено', 'success');
  } catch (e) { console.warn('localStorage read:', e); }
}

function clearStorage() {
  try {
    localStorage.removeItem(`nmt_session_${state.sessionToken}`);
    localStorage.removeItem('active_session_token');
    localStorage.removeItem('active_test_id');
  } catch (e) { /* ignore */ }
}

// ============================================
// 12. УТИЛІТИ
// ============================================

function currentQuestion() {
  return state.testData.questions[state.currentIndex];
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const p = n => String(n).padStart(2, '0');
  return h > 0 ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

function showToast(message, type = 'default') {
  const container = document.getElementById('toast-container');
  const toast     = document.createElement('div');
  toast.className = `toast ${type !== 'default' ? type : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function showLoading(visible) {
  const el = document.getElementById('loading-screen');
  if (el) el.style.display = visible ? 'flex' : 'none';
}

function redirectToTests(message) {
  if (message) showToast(`❌ ${message}`, 'error');
  setTimeout(() => { window.location.href = 'tests.html'; }, 1500);
}
