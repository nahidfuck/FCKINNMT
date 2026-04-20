/**
 * teacher.js — Логіка кабінету вчителя
 * ======================================
 * ВАЖЛИВО: TOKEN_KEY, USER_KEY, getCurrentUser(), logout()
 * визначені в api.js. Тут їх НЕ оголошуємо.
 *
 * Секції:
 *  1. Ініціалізація + перевірка ролі
 *  2. Навігація sidebar
 *  3. Секція "Мої групи": завантаження, рендер, створення
 *  4. Секція "Статистика": завантаження, рендер, пошук
 *  5. Модалка створення групи
 *  6. Модалка "Задати тест групі"
 *  7. Утиліти
 */

// ============================================
// 1. ІНІЦІАЛІЗАЦІЯ
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  // Перевірка авторизації (TOKEN_KEY з api.js)
  if (!localStorage.getItem(TOKEN_KEY)) {
    window.location.href = 'auth.html';
    return;
  }

  // Перевірка ролі (getCurrentUser з api.js)
  const user = getCurrentUser();
  if (!user || (user.role !== 'teacher' && user.role !== 'admin')) {
    window.location.href = 'tests.html';
    return;
  }

  const displayName = user.full_name || user.email.split('@')[0];
  document.getElementById('user-name').textContent = displayName;

  document.getElementById('btn-logout').addEventListener('click', logout); // logout з api.js

  setupSidebarNav();
  setupModalListeners();

  await loadGroups();
});

// ============================================
// 2. НАВІГАЦІЯ SIDEBAR
// ============================================

let statsLoaded = false;

function setupSidebarNav() {
  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', async () => {
      const sectionId = link.dataset.section;

      document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');

      document.querySelectorAll('.dashboard-section').forEach(s => s.classList.remove('active'));
      document.getElementById(`section-${sectionId}`).classList.add('active');

      if (sectionId === 'stats' && !statsLoaded) {
        await loadStats();
        statsLoaded = true;
      }
    });
  });

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
 * Рендерить картки груп.
 * Кожна картка має: назву, invite_code, кількість учнів, кнопку "Задати тест".
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

      <!-- Кнопка задати тест -->
      <div style="margin-top:0.75rem; padding-top:0.75rem; border-top:1px solid var(--color-border);">
        <button
          class="btn btn-ghost"
          style="width:100%; font-size:0.82rem; padding:7px; justify-content:center;"
          data-group-id="${group.id}"
          data-group-name="${escapeHtml(group.name)}"
          onclick="openAssignModal(this.dataset.groupId, this.dataset.groupName)"
        >
          🎯 Задати тест
        </button>
      </div>

    </div>
  `).join('');

  // Обробники кнопок копіювання
  container.querySelectorAll('.btn-copy').forEach(btn =>
    btn.addEventListener('click', () => copyInviteCode(btn)));
}

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

function renderStatsTable(rows) {
  const wrap = document.getElementById('stats-table-wrap');

  if (rows.length === 0) {
    wrap.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--color-text-muted);">Нічого не знайдено</div>`;
    document.getElementById('stats-count').textContent = '';
    return;
  }

  const rowsHTML = rows.map(row => {
    const scoreClass = row.percentage >= 75 ? 'good' : row.percentage >= 50 ? 'medium' : 'bad';
    const scoreIcon  = row.percentage >= 75 ? '✅' : row.percentage >= 50 ? '⚠️' : '❌';

    return `
      <tr>
        <td>
          <div style="font-weight:500;">${escapeHtml(row.student_name)}</div>
          <div style="font-size:0.75rem;color:var(--color-text-muted);">${escapeHtml(row.student_email)}</div>
        </td>
        <td>
          <span style="font-size:0.75rem;color:var(--color-text-muted);
            background:var(--color-surface-2);border:1px solid var(--color-border);
            padding:2px 8px;border-radius:100px;">
            ${escapeHtml(row.group_name)}
          </span>
        </td>
        <td>${escapeHtml(row.test_title)}</td>
        <td>
          <span class="score-badge ${scoreClass}">
            ${scoreIcon} ${row.score}/${row.max_score}
            <span style="color:var(--color-text-muted);font-weight:400;">(${row.percentage}%)</span>
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
      <tbody id="stats-tbody">${rowsHTML}</tbody>
    </table>
  `;

  updateStatsCount(rows.length, allStatsRows.length);
}

function setupStatsSearch() {
  const input = document.getElementById('stats-search');
  // Скидаємо старий listener (на випадок повторного виклику)
  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);

  newInput.addEventListener('input', () => {
    const q = newInput.value.trim().toLowerCase();
    const filtered = !q ? allStatsRows : allStatsRows.filter(row =>
      row.student_name.toLowerCase().includes(q)  ||
      row.student_email.toLowerCase().includes(q) ||
      row.test_title.toLowerCase().includes(q)    ||
      row.group_name.toLowerCase().includes(q)
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
// 5. МОДАЛКА: СТВОРЕННЯ ГРУПИ
// ============================================

function setupModalListeners() {
  // --- Відкриття модалки ---
  document.getElementById('btn-open-create-group').addEventListener('click', () => {
    document.getElementById('input-group-name').value = '';
    openModal('modal-create-group');
    setTimeout(() => document.getElementById('input-group-name').focus(), 150);
  });

  document.getElementById('input-group-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleCreateGroup();
  });

  document.getElementById('btn-create-group').addEventListener('click', handleCreateGroup);

  // --- Підтвердження задати тест ---
  document.getElementById('btn-confirm-assign').addEventListener('click', handleAssignTest);

  // --- Закриття всіх модалок ---
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
    setTimeout(() => { nameInput.style.borderColor = ''; }, 1500);
    return;
  }

  const btn     = document.getElementById('btn-create-group');
  const btnText = btn.querySelector('.btn-text');
  const spinner = btn.querySelector('.spinner');

  btn.disabled          = true;
  btnText.style.display = 'none';
  spinner.style.display = 'inline-block';
  spinner.classList.add('spinning');

  try {
    const newGroup = await api.createGroup(name);
    closeModals();
    showToast(`✅ Групу «${newGroup.name}» створено! Код: ${newGroup.invite_code}`, 'success');
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
// 6. МОДАЛКА: ЗАДАТИ ТЕСТ ГРУПІ
// ============================================

// Зберігаємо ID групи для якої відкрита модалка
let assignTargetGroupId = null;

/**
 * Відкриває модалку задати тест.
 * Викликається через onclick="openAssignModal(...)" на картці групи.
 * @param {string|number} groupId
 * @param {string} groupName
 */
async function openAssignModal(groupId, groupName) {
  assignTargetGroupId = parseInt(groupId, 10);

  // Показуємо назву групи в модалці
  document.getElementById('assign-group-name').textContent = groupName;

  // Завантажуємо список тестів у select
  const select = document.getElementById('assign-test-select');
  select.innerHTML = '<option value="">Завантаження тестів...</option>';
  select.disabled  = true;

  openModal('modal-assign-test');

  try {
    const tests = await api.getTests();
    const available = tests.filter(t => !t.is_locked);

    if (available.length === 0) {
      select.innerHTML = '<option value="">Немає доступних тестів</option>';
      return;
    }

    select.innerHTML =
      '<option value="">— Оберіть тест —</option>' +
      available.map(t =>
        `<option value="${t.id}">${t.subject.name} — ${escapeHtml(t.title)}</option>`
      ).join('');

    select.disabled = false;
  } catch (err) {
    select.innerHTML = '<option value="">Помилка завантаження</option>';
    showToast(`❌ ${err.message}`, 'error');
  }
}

/**
 * Відправляє запит на призначення тесту групі.
 */
async function handleAssignTest() {
  const select = document.getElementById('assign-test-select');
  const testId = parseInt(select.value, 10);

  if (!testId) {
    select.style.borderColor = 'var(--color-danger)';
    setTimeout(() => { select.style.borderColor = ''; }, 1500);
    return;
  }

  if (!assignTargetGroupId) return;

  const btn     = document.getElementById('btn-confirm-assign');
  const btnText = btn.querySelector('.btn-text');
  const spinner = btn.querySelector('.spinner');

  btn.disabled          = true;
  btnText.style.display = 'none';
  spinner.style.display = 'inline-block';
  spinner.classList.add('spinning');

  try {
    const result = await api.assignTestToGroup(assignTargetGroupId, testId);

    closeModals();
    assignTargetGroupId = null;

    const msg = result.already_assigned
      ? '⚠ Цей тест вже був задано цій групі'
      : `✅ ${result.message}`;
    showToast(msg, result.already_assigned ? 'default' : 'success');

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
// 7. УТИЛІТИ
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

function pluralize(count, one, few, many) {
  const m10 = count % 10, m100 = count % 100;
  if (m100 >= 11 && m100 <= 14) return many;
  if (m10 === 1)                 return one;
  if (m10 >= 2 && m10 <= 4)     return few;
  return many;
}

function formatDate(isoString) {
  if (!isoString) return '—';
  try {
    return new Date(isoString).toLocaleString('uk-UA', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return isoString; }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
