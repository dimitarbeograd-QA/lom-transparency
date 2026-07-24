/*
 * Community Лом -- Admin "Обществени поръчки" (Public Procurement) page.
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

  let currentStatus = 'pending';
  let currentRows = [];

  function reviewStatusBadge(status) {
    return `<span class="badge badge-${status}">${REVIEW_STATUS_LABELS[status] || status}</span>`;
  }

  function formatMoney(amount) {
    if (amount === null || amount === undefined || amount === '') return '&mdash;';
    return `${Number(amount).toFixed(2)} лв.`;
  }

  async function loadRows() {
    const tbody = document.getElementById('procurement-tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Зареждане...</td></tr>';

    try {
      const data = await fetchJson(`/api/admin/procurements?status=${encodeURIComponent(currentStatus)}`);
      currentRows = (data && data.procurements) || [];
      renderRows();
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Грешка при зареждане.</td></tr>';
    }
  }

  function renderRows() {
    const tbody = document.getElementById('procurement-tbody');

    if (currentRows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Няма записи в тази категория.</td></tr>';
      return;
    }

    tbody.innerHTML = currentRows
      .map((row) => {
        const isPending = row.review_status === 'pending';
        return `
          <tr data-id="${row.id}">
            <td>${reviewStatusBadge(row.review_status)}<br><span class="text-muted">${escapeHtml(row.status)}</span></td>
            <td>${row.publish_date ? escapeHtml(row.publish_date) : '&mdash;'}</td>
            <td>${escapeHtml(row.procedure_type) || '&mdash;'}</td>
            <td>${escapeHtml(row.title) || '&mdash;'}</td>
            <td>${formatMoney(row.estimated_value)}</td>
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
        await fetchJson(`/api/review/procurements/${id}/${action}`, { method: 'POST' });
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
      if (!confirm('Сигурни ли сте, че искате да изтриете тази поръчка?')) return;
      btn.disabled = true;
      try {
        await fetchJson(`/api/procurements/${id}`, { method: 'DELETE' });
        await loadRows();
      } catch (err) {
        alert('Изтриването не бе успешно: ' + err.message);
        btn.disabled = false;
      }
    }
  }

  function openForm(row) {
    const panel = document.getElementById('procurement-form-panel');
    const title = document.getElementById('procurement-form-title');
    const errorBox = document.getElementById('procurement-form-error');

    errorBox.classList.remove('visible');
    errorBox.textContent = '';

    document.getElementById('procurement-id').value = row ? row.id : '';
    document.getElementById('procurement-title').value = row ? row.title || '' : '';
    document.getElementById('procurement-procedure-type').value = row ? row.procedure_type || '' : '';
    document.getElementById('procurement-description').value = row ? row.description || '' : '';
    document.getElementById('procurement-status').value = row ? row.status || 'обявена' : 'обявена';
    document.getElementById('procurement-estimated-value').value = row && row.estimated_value !== null ? row.estimated_value : '';
    document.getElementById('procurement-publish-date').value = row ? row.publish_date || '' : '';
    document.getElementById('procurement-deadline-date').value = row ? row.deadline_date || '' : '';
    document.getElementById('procurement-awarded-contractor').value = row ? row.awarded_contractor || '' : '';
    document.getElementById('procurement-contract-value').value = row && row.contract_value !== null ? row.contract_value : '';
    document.getElementById('procurement-contract-date').value = row ? row.contract_date || '' : '';
    document.getElementById('procurement-project-id').value = row && row.project_id !== null ? row.project_id : '';

    title.textContent = row ? 'Редактиране на поръчка' : 'Нова поръчка';
    panel.classList.add('open');
    document.getElementById('procurement-title').focus();
  }

  function closeForm() {
    document.getElementById('procurement-form-panel').classList.remove('open');
    document.getElementById('procurement-form').reset();
  }

  async function handleFormSubmit(event) {
    event.preventDefault();

    const errorBox = document.getElementById('procurement-form-error');
    errorBox.classList.remove('visible');
    errorBox.textContent = '';

    const id = document.getElementById('procurement-id').value;
    const body = {
      title: document.getElementById('procurement-title').value.trim(),
      procedure_type: document.getElementById('procurement-procedure-type').value.trim() || null,
      description: document.getElementById('procurement-description').value.trim() || null,
      status: document.getElementById('procurement-status').value,
      estimated_value: document.getElementById('procurement-estimated-value').value || null,
      publish_date: document.getElementById('procurement-publish-date').value || null,
      deadline_date: document.getElementById('procurement-deadline-date').value || null,
      awarded_contractor: document.getElementById('procurement-awarded-contractor').value.trim() || null,
      contract_value: document.getElementById('procurement-contract-value').value || null,
      contract_date: document.getElementById('procurement-contract-date').value || null,
      project_id: document.getElementById('procurement-project-id').value || null,
    };

    const submitBtn = document.getElementById('procurement-form-submit');
    submitBtn.disabled = true;

    try {
      if (id) {
        await fetchJson(`/api/procurements/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await fetchJson('/api/procurements', {
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

  function initAdminProcurementPage() {
    document.getElementById('procurement-tbody').addEventListener('click', handleTableClick);
    document.getElementById('new-procurement-btn').addEventListener('click', () => openForm(null));
    document.getElementById('procurement-form-cancel').addEventListener('click', closeForm);
    document.getElementById('procurement-form').addEventListener('submit', handleFormSubmit);

    document.getElementById('status-tabs').addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-status]');
      if (!btn) return;
      currentStatus = btn.getAttribute('data-status');
      document.querySelectorAll('#status-tabs button').forEach((b) => b.classList.toggle('active', b === btn));
      loadRows();
    });

    loadRows();
  }

  window.initAdminProcurementPage = initAdminProcurementPage;
})(window);
