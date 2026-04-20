/**
 * teacher.js — Логіка кабінету вчителя
 * ======================================
 * Структура:
 *  1. Перевірка авторизації та ролі
 *  2. Навігація між секціями (groups / stats)
 *  3. Секція "Мої групи": завантаження, рендер, створення
 *  4. Секція "Статистика": завантаження, рендер, пошук
 *  5. Модалка створення групи
 *  6. Утиліти
 */

// ============================================
// 1. ІНІЦІАЛІЗАЦІЯ
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  // --- Перевірка авторизації ---
  const token = localStorage.getItem('nmt_token');
  if (!token) {
    window.location.href = 'auth.html';
    return;
  }

  // --- Перевірка ролі ---
  // getCurrentUser() визначена в auth.js
  const user = getCurrentUser();
  if (!user || (user.role !== 'teacher' && user.role !== 'admin')) {
    // Студент потрапив сюди — редірект на свою сторінку
    window.location.href = 'tests.html';
    return;
  }

  // --- Відображаємо ім'я ---
  const displayName = user.full_name || user.email.split('@')[0];
  document.getElementById('user-name').textContent = displayName;

  // --- Підключаємо обробники ---
  setupSidebarNav();
  setupModalListeners();
  document.getElementById('btn-logout').addEventListener('click', logout);

  // --- Завантажуємо першу секцію ---
  await loadGroups();
});

// ============================================
// 2. НАВІГАЦІЯ SIDEBAR
// ============================================

/**
 * Перемикає активну секцію при кліку на sidebar-посилання.
 * Lazy-load: статистика завантажується тільки при першому відкритті.
 */
let statsLoaded = false;

function setupSidebarNav() {
  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', async () => {
      const sectionId = link.dataset.section;

      // Оновлюємо активний клас у sidebar
      document.querySelectorAll('.sidebar-link').forEach(l =>
        l.classList.remove('active'));
      link.classList.add('active');

      // Показуємо відповідну секцію
      document.querySelectorAll('.dashboard-section').forEach(s =>
        s.classList.remove('active'));
      document.getElementById(`section-${sectionId}`).classList.add('active');

      // Lazy-load статистики
      if (sectionId === 'stats' && !statsLoaded) {
        await loadStats();
        statsLoaded = true;
      }
    });
  });

  // Кнопка оновити в статистиці
  document.getElementById('btn-refresh-stats').addEventListener('click', async () => {
    statsLoaded = false;
    await loadStats();
    statsLoaded = true;
  });
}

// ============================================
// 3. СЕКЦІЯ: МОЇ ГРУПИ
// ============================================

async function loadGroups() {
  const grid = document.getElementById('groups-grid');
  renderGroupSkeletons(grid);

  try {
    const groups = await api.getMyGroups();

    if (!groups || groups.length === 0) {
      grid.innerHTML = '';
      document.getElementById('groups-empty').style.display = 'block';
      return;
    }

    document.getElementById('groups-empty').style.display = 'none';
    renderGroupCards(grid, groups);

  } catch (err) {
    grid.innerHTML = '';
    showToast(`❌ Помилка завантаження груп: ${err.message}`, 'error');
  }
}

/**
 * Рендерить картки груп у сітку.
 */
function renderGroupCards(container, groups) {
  container.innerHTML = groups.map((group, i) => `
    <div class="group-card" style="animation-delay: ${i * 0.05}s">

      <div class="group-card-name">${escapeHtml(group.name)}</div>

      <div class="invite-code-block">
        <div>
          <div class="invite-code-label">Код запрошення</div>
          <div class="invite-code-value">${group.invite_code}</div>
        </div>
        <button
          class="btn-copy"
          data-code="${group.invite_code}"
          title="Скопіювати код"
        >
          📋 Копіювати
        </button>
      </div>

      <div class="group-card-meta">
        👤 ${group.member_count} ${pluralize(group.member_count, 'учень', 'учні', 'учнів')}
        &nbsp;·&nbsp;
        ${formatDate(group.created_at)}
      </div>

    </div>
  `).join('');

  // Обробники кнопок копіювання
  container.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', () => copyInviteCode(btn));
  });
}

/**
 * Копіює invite_code у буфер обміну.
 */
async function copyInviteCode(btn) {
  const code = btn.dataset.code;
  try {
    await navigator.clipboard.writeText(code);
    btn.textContent = '✓ Скопійовано';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = '📋 Копіювати';
      btn.classList.remove('copied');
    }, 2000);
  } catch {
    // Fallback для браузерів без clipboard API
    showToast(`Код: ${code}`, 'default');
  }
}

function renderGroupSkeletons(container) {
  container.innerHTML = Array(3).fill(`
    <div class="skeleton-card">
      <div class="skeleton-line" style="width:60%;"></div>
      <div class="skeleton-line" style="width:90%;height:38px;margin-top:0.5rem;"></div>
      <div class="skeleton-line" style="width:40%;"></div>
    </div>
  `).join('');
}

// ============================================
// 4. СЕКЦІЯ: СТАТИСТИКА
// ============================================

// Зберігаємо всі рядки для клієнтського пошуку
let allStatsRows = [];

async function loadStats() {
  const wrap = document.getElementById('stats-table-wrap');
  wrap.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--color-text-muted);">Завантаження...</div>';
  document.getElementById('stats-empty').style.display = 'none';
  document.getElementById('stats-count').textContent = '';

  try {
    const rows = await api.getStudentsStats();
    allStatsRows = rows;

    if (!rows || rows.length === 0) {
      wrap.innerHTML = '';
      document.getElementById('stats-empty').style.display = 'block';
      return;
    }

    renderStatsTable(rows);
    setupStatsSearch();

  } catch (err) {
    wrap.innerHTML = '';
    showToast(`❌ Помилка завантаження статистики: ${err.message}`, 'error');
  }
}

/**
 * Рендерить таблицю результатів.
 * @param {Array} rows — масив StudentStatRow з API
 */
function renderStatsTable(rows) {
  const wrap = document.getElementById('stats-table-wrap');

  if (rows.length === 0) {
    wrap.innerHTML = `
      <div style="padding:2rem;text-align:center;color:var(--color-text-muted);">
        Нічого не знайдено
      </div>
    `;
    document.getElementById('stats-count').textContent = '';
    return;
  }

  const rowsHTML = rows.map(row => {
    // Клас бейджа залежно від відсотку
    const scoreClass = row.percentage >= 75 ? 'good'
                     : row.percentage >= 50 ? 'medium'
                     : 'bad';

    const scoreIcon  = row.percentage >= 75 ? '✅' : row.percentage >= 50 ? '⚠️' : '❌';

    return `
      <tr>
        <td>
          <div style="font-weight:500;">${escapeHtml(row.student_name)}</div>
          <div style="font-size:0.75rem;color:var(--color-text-muted);">
            ${escapeHtml(row.student_email)}
          </div>
        </td>
        <td>
          <span style="
            font-size:0.75rem;color:var(--color-text-muted);
            background:var(--color-surface-2);border:1px solid var(--color-border);
            padding:2px 8px;border-radius:100px;
          ">${escapeHtml(row.group_name)}</span>
        </td>
        <td>${escapeHtml(row.test_title)}</td>
        <td>
          <span class="score-badge ${scoreClass}">
            ${scoreIcon} ${row.score}/${row.max_score}
            <span style="color:var(--color-text-muted);font-weight:400;">
              (${row.percentage}%)
            </span>
          </span>
        </td>
        <td style="color:var(--color-text-muted);font-size:0.82rem;white-space:nowrap;">
          ${row.finished_at ? formatDate(row.finished_at) : '—'}
        </td>
      </tr>
    `;
  }).join('');

  wrap.innerHTML = `
    <table class="stats-table">
      <thead>
        <tr>
          <th>Учень</th>
          <th>Група</th>
          <th>Тест</th>
          <th>Результат</th>
          <th>Дата</th>
        </tr>
      </thead>
      <tbody id="stats-tbody">
        ${rowsHTML}
      </tbody>
    </table>
  `;

  updateStatsCount(rows.length, allStatsRows.length);
}

/**
 * Клієнтський пошук у таблиці статистики.
 */
function setupStatsSearch() {
  const input = document.getElementById('stats-search');

  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();

    if (!query) {
      renderStatsTable(allStatsRows);
      return;
    }

    const filtered = allStatsRows.filter(row =>
      row.student_name.toLowerCase().includes(query)  ||
      row.student_email.toLowerCase().includes(query) ||
      row.test_title.toLowerCase().includes(query)    ||
      row.group_name.toLowerCase().includes(query)
    );

    renderStatsTable(filtered);
  });
}

function updateStatsCount(shown, total) {
  const el = document.getElementById('stats-count');
  el.textContent = shown === total
    ? `${total} ${pluralize(total, 'результат', 'результати', 'результатів')}`
    : `${shown} з ${total}`;
}

// ============================================
// 5. МОДАЛКА СТВОРЕННЯ ГРУПИ
// ============================================

function setupModalListeners() {
  // Відкриття
  document.getElementById('btn-open-create-group').addEventListener('click', () => {
    document.getElementById('input-group-name').value = '';
    openModal('modal-create-group');
    // Фокус на поле після анімації
    setTimeout(() => document.getElementById('input-group-name').focus(), 150);
  });

  // Submit по Enter
  document.getElementById('input-group-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleCreateGroup();
  });

  // Кнопка "Створити"
  document.getElementById('btn-create-group').addEventListener('click', handleCreateGroup);

  // Закриття модалок
  document.querySelectorAll('.modal-close, .modal-overlay').forEach(el =>
    el.addEventListener('click', e => { if (e.target === el) closeModals(); }));

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModals();
  });
}

async function handleCreateGroup() {
  const nameInput = document.getElementById('input-group-name');
  const name      = nameInput.value.trim();

  if (!name) {
    nameInput.focus();
    nameInput.style.borderColor = 'var(--color-danger)';
    setTimeout(() => nameInput.style.borderColor = '', 1500);
    return;
  }

  const btn      = document.getElementById('btn-create-group');
  const btnText  = btn.querySelector('.btn-text');
  const spinner  = btn.querySelector('.spinner');

  // Показуємо spinner
  btn.disabled         = true;
  btnText.style.display = 'none';
  spinner.style.display = 'inline-block';
  spinner.classList.add('spinning');

  try {
    const newGroup = await api.createGroup(name);

    closeModals();
    showToast(`✅ Групу "${newGroup.name}" створено! Код: ${newGroup.invite_code}`, 'success');

    // Перезавантажуємо список груп
    await loadGroups();

  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    btn.disabled          = false;
    btnText.style.display = '';
    spinner.style.display = 'none';
    spinner.classList.remove('spinning');
  }
}

// ============================================
// 6. УТИЛІТИ
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

function showToast(message, type = 'default') {
  const container = document.getElementById('toast-container');
  const toast     = document.createElement('div');
  toast.className = `toast ${type !== 'default' ? type : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

/** Правильна українська форма слова */
function pluralize(count, one, few, many) {
  const m10  = count % 10;
  const m100 = count % 100;
  if (m100 >= 11 && m100 <= 14) return many;
  if (m10 === 1)                 return one;
  if (m10 >= 2 && m10 <= 4)     return few;
  return many;
}

/** Форматує ISO дату у "15 лют 2025, 14:30" */
function formatDate(isoString) {
  if (!isoString) return '—';
  try {
    return new Date(isoString).toLocaleString('uk-UA', {
      day:    'numeric',
      month:  'short',
      year:   'numeric',
      hour:   '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

/** Екранує HTML-символи щоб уникнути XSS */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
