/*
 * Community Лом -- Admin "Решения на Общински съвет" (Council Decisions)
 * page. Plain script, no bundler -- relies on /admin/admin-common.js being
 * loaded first for fetchJson/checkAuthOrRedirect/renderAdminNav.
 */

(function (window) {
  'use strict';

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const STATUS_LABELS = {
    pending: 'Чакащо',
    approved: 'Одобрено',
    rejected: 'Отхвърлено',
  };

  let currentStatus = 'pending';
  let currentRows = [];

  function statusBadge(status) {
    return `<span class="badge badge-${status}">${STATUS_LABELS[status] || status}</span>`;
  }

  async function loadRows() {
    const tbody = document.getElementById('decisions-tbody');
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Зареждане...</td></tr>';

    try {
      const data = await fetchJson(`/api/admin/council-decisions?status=${encodeURIComponent(currentStatus)}`);
      currentRows = (data && data.decisions) || [];
      renderRows();
    } catch (err) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="empty-state">Грешка при зареждане.</td></tr>';
    }
  }

  function renderRows() {
    const tbody = document.getElementById('decisions-tbody');

    if (currentRows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Няма записи в тази категория.</td></tr>';
      return;
    }

    tbody.innerHTML = currentRows
      .map((row) => {
        const isPending = row.review_status === 'pending';
        return `
          <tr data-id="${row.id}">
            <td>${statusBadge(row.review_status)}</td>
            <td>${escapeHtml(row.session_date) || '&mdash;'}</td>
            <td>${escapeHtml(row.session_number) || '&mdash;'}</td>
            <td>${escapeHtml(row.decision_number) || '&mdash;'}</td>
            <td>${escapeHtml(row.title) || '&mdash;'}</td>
            <td>${escapeHtml(row.category) || '&mdash;'}</td>
            <td>
              <div class="row-actions">
                ${
                  isPending
                    ? `<button type="button" class="btn-approve" data-action="approve" data-id="${row.id}">Одобри</button>
                       <button type="button" class="btn-reject" data-action="reject" data-id="${row.id}">Отхвърли</button>`
                    : ''
                }
                <button type="button" class="btn-secondary" data-action="edit" data-id="${row.id}">Редакция</button>
                <button type="button" class="btn-danger" data-action="delete" data-id="${row.id}">Изтрий</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  async function handleTableClick(event) {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;

    const id = btn.getAttribute('data-id');
    const action = btn.getAttribute('data-action');

    if (action === 'approve' || action === 'reject') {
      btn.disabled = true;
      try {
        await fetchJson(`/api/review/council_decisions/${id}/${action}`, { method: 'POST' });
        await loadRows();
      } catch (err) {
        alert('Действието не бе успешно: ' + err.message);
        btn.disabled = false;
      }
      return;
    }

    if (action === 'edit') {
      const row = currentRows.find((r) => String(r.id) === String(id));
      if (row) openForm(row);
      return;
    }

    if (action === 'delete') {
      if (!confirm('Сигурни ли сте, че искате да изтриете това решение?')) return;
      btn.disabled = true;
      try {
        await fetchJson(`/api/council-decisions/${id}`, { method: 'DELETE' });
        await loadRows();
      } catch (err) {
        alert('Изтриването не бе успешно: ' + err.message);
        btn.disabled = false;
      }
    }
  }

  function openForm(row) {
    const panel = document.getElementById('decision-form-panel');
    const title = document.getElementById('decision-form-title');
    const errorBox = document.getElementById('decision-form-error');

    errorBox.classList.remove('visible');
    errorBox.textContent = '';

    document.getElementById('decision-id').value = row ? row.id : '';
    document.getElementById('decision-title').value = row ? row.title || '' : '';
    document.getElementById('decision-category').value = row ? row.category || '' : '';
    document.getElementById('decision-session-date').value = row ? row.session_date || '' : '';
    document.getElementById('decision-session-number').value = row ? row.session_number || '' : '';
    document.getElementById('decision-number').value = row ? row.decision_number || '' : '';
    document.getElementById('decision-summary').value = row ? row.summary || '' : '';

    title.textContent = row ? 'Редактиране на решение' : 'Ново решение';
    panel.classList.add('open');
    document.getElementById('decision-title').focus();
  }

  function closeForm() {
    document.getElementById('decision-form-panel').classList.remove('open');
    document.getElementById('decision-form').reset();
  }

  async function handleFormSubmit(event) {
    event.preventDefault();

    const errorBox = document.getElementById('decision-form-error');
    errorBox.classList.remove('visible');
    errorBox.textContent = '';

    const id = document.getElementById('decision-id').value;
    const body = {
      title: document.getElementById('decision-title').value.trim(),
      category: document.getElementById('decision-category').value.trim() || null,
      session_date: document.getElementById('decision-session-date').value || null,
      session_number: document.getElementById('decision-session-number').value.trim() || null,
      decision_number: document.getElementById('decision-number').value.trim() || null,
      summary: document.getElementById('decision-summary').value.trim() || null,
    };

    const submitBtn = document.getElementById('decision-form-submit');
    submitBtn.disabled = true;

    try {
      if (id) {
        await fetchJson(`/api/council-decisions/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await fetchJson('/api/council-decisions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      closeForm();
      await loadRows();
    } catch (err) {
      let message = err.message;
      try {
        const parsed = JSON.parse(message.slice(message.indexOf('{')));
        if (parsed.message) message = parsed.message;
        else if (parsed.error) message = parsed.error;
      } catch (parseErr) {
        // keep the raw message
      }
      errorBox.textContent = message;
      errorBox.classList.add('visible');
    } finally {
      submitBtn.disabled = false;
    }
  }

  function initAdminDecisionsPage() {
    document.getElementById('decisions-tbody').addEventListener('click', handleTableClick);
    document.getElementById('new-decision-btn').addEventListener('click', () => openForm(null));
    document.getElementById('decision-form-cancel').addEventListener('click', closeForm);
    document.getElementById('decision-form').addEventListener('submit', handleFormSubmit);

    document.getElementById('status-tabs').addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-status]');
      if (!btn) return;
      currentStatus = btn.getAttribute('data-status');
      document
        .querySelectorAll('#status-tabs button')
        .forEach((b) => b.classList.toggle('active', b === btn));
      loadRows();
    });

    loadRows();
  }

  window.initAdminDecisionsPage = initAdminDecisionsPage;
})(window);
