/*
 * Community Лом -- Admin "Наредби и нормативни актове" (Ordinances) page.
 * Plain script, no bundler -- relies on /admin/admin-common.js being loaded
 * first for fetchJson/checkAuthOrRedirect/renderAdminNav.
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

  const REVIEW_STATUS_LABELS = {
    pending: 'Чакащо',
    approved: 'Одобрено',
    rejected: 'Отхвърлено',
  };

  const ORDINANCE_STATUS_LABELS = {
    active: 'Действаща',
    repealed: 'Отменена',
  };

  let currentStatus = 'pending';
  let currentRows = [];

  function reviewStatusBadge(status) {
    return `<span class="badge badge-${status}">${REVIEW_STATUS_LABELS[status] || status}</span>`;
  }

  async function loadRows() {
    const tbody = document.getElementById('ordinances-tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Зареждане...</td></tr>';

    try {
      const data = await fetchJson(`/api/admin/ordinances?status=${encodeURIComponent(currentStatus)}`);
      currentRows = (data && data.ordinances) || [];
      renderRows();
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Грешка при зареждане.</td></tr>';
    }
  }

  function renderRows() {
    const tbody = document.getElementById('ordinances-tbody');

    if (currentRows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Няма записи в тази категория.</td></tr>';
      return;
    }

    tbody.innerHTML = currentRows
      .map((row) => {
        const isPending = row.review_status === 'pending';
        const dateCell = row.adoption_date
          ? escapeHtml(row.adoption_date)
          : '<span class="no-date">неизвестна</span>';

        return `
          <tr data-id="${row.id}">
            <td>${reviewStatusBadge(row.review_status)}</td>
            <td>${escapeHtml(row.title) || '&mdash;'}</td>
            <td>${escapeHtml(row.category) || '&mdash;'}</td>
            <td>${escapeHtml(ORDINANCE_STATUS_LABELS[row.status] || row.status)}</td>
            <td>${dateCell}</td>
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
        await fetchJson(`/api/review/ordinances/${id}/${action}`, { method: 'POST' });
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
      if (!confirm('Сигурни ли сте, че искате да изтриете тази наредба?')) return;
      btn.disabled = true;
      try {
        await fetchJson(`/api/ordinances/${id}`, { method: 'DELETE' });
        await loadRows();
      } catch (err) {
        alert('Изтриването не бе успешно: ' + err.message);
        btn.disabled = false;
      }
    }
  }

  function openForm(row) {
    const panel = document.getElementById('ordinance-form-panel');
    const title = document.getElementById('ordinance-form-title');
    const errorBox = document.getElementById('ordinance-form-error');

    errorBox.classList.remove('visible');
    errorBox.textContent = '';

    document.getElementById('ordinance-id').value = row ? row.id : '';
    document.getElementById('ordinance-title').value = row ? row.title || '' : '';
    document.getElementById('ordinance-category').value = row ? row.category || '' : '';
    document.getElementById('ordinance-status').value = row ? row.status || 'active' : 'active';
    document.getElementById('ordinance-adoption-date').value = row ? row.adoption_date || '' : '';
    document.getElementById('ordinance-amended-date').value = row ? row.last_amended_date || '' : '';

    title.textContent = row ? 'Редактиране на наредба' : 'Нова наредба';
    panel.classList.add('open');
    document.getElementById('ordinance-title').focus();
  }

  function closeForm() {
    document.getElementById('ordinance-form-panel').classList.remove('open');
    document.getElementById('ordinance-form').reset();
  }

  async function handleFormSubmit(event) {
    event.preventDefault();

    const errorBox = document.getElementById('ordinance-form-error');
    errorBox.classList.remove('visible');
    errorBox.textContent = '';

    const id = document.getElementById('ordinance-id').value;
    const body = {
      title: document.getElementById('ordinance-title').value.trim(),
      category: document.getElementById('ordinance-category').value.trim() || null,
      status: document.getElementById('ordinance-status').value,
      adoption_date: document.getElementById('ordinance-adoption-date').value || null,
      last_amended_date: document.getElementById('ordinance-amended-date').value || null,
    };

    const submitBtn = document.getElementById('ordinance-form-submit');
    submitBtn.disabled = true;

    try {
      if (id) {
        await fetchJson(`/api/ordinances/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await fetchJson('/api/ordinances', {
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

  function initAdminOrdinancesPage() {
    document.getElementById('ordinances-tbody').addEventListener('click', handleTableClick);
    document.getElementById('new-ordinance-btn').addEventListener('click', () => openForm(null));
    document.getElementById('ordinance-form-cancel').addEventListener('click', closeForm);
    document.getElementById('ordinance-form').addEventListener('submit', handleFormSubmit);

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

  window.initAdminOrdinancesPage = initAdminOrdinancesPage;
})(window);
