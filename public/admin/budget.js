(function () {
  'use strict';

  var STATUS_LABELS = { planned: 'Планиран', active: 'Активен', completed: 'Завършен' };
  var REVIEW_LABELS = { pending: 'Чака преглед', approved: 'Одобрено', rejected: 'Отхвърлено' };
  var REVIEW_BADGE_CLASS = { pending: 'badge-pending', approved: 'badge-approved', rejected: 'badge-rejected' };

  var currentProjectId = null;

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function reviewBadge(status) {
    return '<span class="badge ' + REVIEW_BADGE_CLASS[status] + '">' + REVIEW_LABELS[status] + '</span>';
  }

  function showError(elId, message) {
    var el = document.getElementById(elId);
    el.textContent = message;
    el.classList.add('visible');
  }

  function clearError(elId) {
    var el = document.getElementById(elId);
    el.textContent = '';
    el.classList.remove('visible');
  }

  // -------------------------------------------------------------------------
  // Projects list
  // -------------------------------------------------------------------------

  async function loadProjectsList() {
    var tbody = document.getElementById('projects-tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Зареждане...</td></tr>';

    try {
      var data = await fetchJson('/api/admin/projects');
      renderProjectsList(data.projects);
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Грешка при зареждане.</td></tr>';
    }
  }

  function renderProjectsList(projects) {
    var tbody = document.getElementById('projects-tbody');

    if (!projects || projects.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Все още няма проекти.</td></tr>';
      return;
    }

    tbody.innerHTML = projects
      .map(function (p) {
        return (
          '<tr>' +
          '<td>' + escapeHtml(p.name) + '</td>' +
          '<td>' + escapeHtml(p.category || '—') + '</td>' +
          '<td>' + (STATUS_LABELS[p.status] || p.status) + '</td>' +
          '<td>' + reviewBadge(p.review_status) + '</td>' +
          '<td>' + formatBGN(p.allocated_total) + ' / ' + formatBGN(p.spent_total) + '</td>' +
          '<td class="row-actions">' +
          '<button type="button" class="btn btn-secondary" data-open="' + p.id + '">Преглед</button>' +
          '<button type="button" class="btn-danger btn" data-delete-project="' + p.id + '">Изтрий</button>' +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    tbody.querySelectorAll('[data-open]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openProjectDetail(btn.getAttribute('data-open'));
      });
    });
    tbody.querySelectorAll('[data-delete-project]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        deleteProject(btn.getAttribute('data-delete-project'));
      });
    });
  }

  async function deleteProject(id) {
    if (!window.confirm('Сигурни ли сте, че искате да изтриете този проект? Това ще изтрие и всички свързани бюджетни редове, разходи и прикачени файлове.')) {
      return;
    }
    try {
      await fetchJson('/api/projects/' + id, { method: 'DELETE' });
      if (String(currentProjectId) === String(id)) {
        closeProjectDetail();
      }
      loadProjectsList();
    } catch (err) {
      window.alert('Грешка при изтриване на проекта.');
    }
  }

  // -------------------------------------------------------------------------
  // Create project form
  // -------------------------------------------------------------------------

  function openNewProjectForm() {
    clearError('project-form-error');
    document.getElementById('project-form-title').textContent = 'Нов проект';
    document.getElementById('project-form').reset();
    document.getElementById('project-form-section').classList.remove('hidden');
    document.getElementById('project-detail-section').classList.add('hidden');
  }

  function closeProjectForm() {
    document.getElementById('project-form-section').classList.add('hidden');
  }

  async function handleProjectFormSubmit(event) {
    event.preventDefault();
    clearError('project-form-error');

    var form = document.getElementById('project-form');
    var formData = new FormData(form);
    var payload = {
      name: formData.get('name'),
      category: formData.get('category') || null,
      status: formData.get('status'),
      description: formData.get('description') || null,
    };

    try {
      var res = await fetchJson('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      closeProjectForm();
      loadProjectsList();
      openProjectDetail(res.project.id);
    } catch (err) {
      showError('project-form-error', 'Грешка при запис на проекта. Проверете попълнените данни.');
    }
  }

  // -------------------------------------------------------------------------
  // Project detail (edit meta + budget lines + expenditures + attachments)
  // -------------------------------------------------------------------------

  async function openProjectDetail(id) {
    currentProjectId = id;
    closeProjectForm();
    document.getElementById('project-detail-section').classList.remove('hidden');
    document.getElementById('detail-project-name').textContent = 'Зареждане...';
    document.getElementById('detail-project-meta').innerHTML = '';
    document.getElementById('detail-project-actions').innerHTML = '';
    document.getElementById('budget-lines-tbody').innerHTML = '';
    document.getElementById('expenditures-tbody').innerHTML = '';
    document.getElementById('attachments-list').innerHTML = '';

    await refreshProjectDetail();
    window.scrollTo({ top: document.getElementById('project-detail-section').offsetTop - 20, behavior: 'smooth' });
  }

  function closeProjectDetail() {
    currentProjectId = null;
    document.getElementById('project-detail-section').classList.add('hidden');
  }

  async function refreshProjectDetail() {
    if (!currentProjectId) return;
    var data = await fetchJson('/api/admin/projects/' + currentProjectId);
    renderProjectMeta(data.project);
    renderBudgetLines(data.budget_lines);
    renderExpenditures(data.expenditures);
    renderAttachments(data.attachments);
  }

  function renderProjectMeta(p) {
    document.getElementById('detail-project-name').textContent = p.name;

    var actionsHtml = '';
    if (p.review_status === 'pending') {
      actionsHtml +=
        '<button type="button" class="btn btn-approve" id="approve-project-btn">Одобри</button> ' +
        '<button type="button" class="btn btn-reject" id="reject-project-btn">Отхвърли</button> ';
    }
    document.getElementById('detail-project-actions').innerHTML = actionsHtml;

    if (p.review_status === 'pending') {
      document.getElementById('approve-project-btn').addEventListener('click', function () {
        reviewAction('projects', p.id, 'approve').then(refreshProjectDetail).then(loadProjectsList);
      });
      document.getElementById('reject-project-btn').addEventListener('click', function () {
        reviewAction('projects', p.id, 'reject').then(refreshProjectDetail).then(loadProjectsList);
      });
    }

    var metaHtml =
      '<div class="progress-note">' + reviewBadge(p.review_status) +
      (p.source_url ? ' &middot; ' + renderSourceBadge(p.source_url, p.scraped_at) : '') +
      '</div>' +
      '<form id="detail-meta-form" class="inline-form" style="margin-top:1rem;">' +
      '<div><label for="dpm-name">Наименование</label><input type="text" id="dpm-name" name="name" value="' + escapeHtml(p.name) + '" required></div>' +
      '<div><label for="dpm-category">Категория</label><input type="text" id="dpm-category" name="category" value="' + escapeHtml(p.category || '') + '"></div>' +
      '<div><label for="dpm-status">Статус</label><select id="dpm-status" name="status">' +
      Object.keys(STATUS_LABELS).map(function (s) { return '<option value="' + s + '"' + (s === p.status ? ' selected' : '') + '>' + STATUS_LABELS[s] + '</option>'; }).join('') +
      '</select></div>' +
      '<div style="flex-basis:100%;"><label for="dpm-description">Описание</label><textarea id="dpm-description" name="description" rows="3">' + escapeHtml(p.description || '') + '</textarea></div>' +
      '<div class="form-actions"><button type="submit" class="btn">Запази промените</button></div>' +
      '</form>' +
      '<p><strong>Разпределени средства:</strong> ' + formatBGN(p.allocated_total) + ' &nbsp; <strong>Изразходвани средства:</strong> ' + formatBGN(p.spent_total) + '</p>';

    document.getElementById('detail-project-meta').innerHTML = metaHtml;

    document.getElementById('detail-meta-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var formData = new FormData(event.target);
      var payload = {
        name: formData.get('name'),
        category: formData.get('category') || null,
        status: formData.get('status'),
        description: formData.get('description') || null,
      };
      try {
        await fetchJson('/api/projects/' + p.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        await refreshProjectDetail();
        loadProjectsList();
      } catch (err) {
        window.alert('Грешка при запис на промените.');
      }
    });
  }

  async function reviewAction(table, id, action) {
    return fetchJson('/api/review/' + table + '/' + id + '/' + action, { method: 'POST' });
  }

  // -------------------------------------------------------------------------
  // Budget lines
  // -------------------------------------------------------------------------

  function renderBudgetLines(lines) {
    var tbody = document.getElementById('budget-lines-tbody');

    if (!lines || lines.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Няма бюджетни редове.</td></tr>';
      return;
    }

    tbody.innerHTML = lines
      .map(function (bl) {
        var reviewActions = bl.review_status === 'pending'
          ? '<button type="button" class="btn btn-approve" data-approve-bl="' + bl.id + '">Одобри</button> ' +
            '<button type="button" class="btn btn-reject" data-reject-bl="' + bl.id + '">Отхвърли</button> '
          : '';
        return (
          '<tr>' +
          '<td>' + escapeHtml(bl.year != null ? bl.year : '—') + '</td>' +
          '<td>' + escapeHtml(bl.funding_source || '—') + '</td>' +
          '<td>' + formatBGN(bl.allocated_amount) + '</td>' +
          '<td>' + escapeHtml(bl.notes || '') + '</td>' +
          '<td>' + reviewBadge(bl.review_status) + '</td>' +
          '<td class="row-actions">' + reviewActions +
          '<button type="button" class="btn btn-secondary" data-edit-bl="' + bl.id + '">Редактирай</button>' +
          '<button type="button" class="btn-danger btn" data-delete-bl="' + bl.id + '">Изтрий</button>' +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    tbody.querySelectorAll('[data-approve-bl]').forEach(function (btn) {
      btn.addEventListener('click', function () { reviewAction('budget_lines', btn.getAttribute('data-approve-bl'), 'approve').then(refreshProjectDetail); });
    });
    tbody.querySelectorAll('[data-reject-bl]').forEach(function (btn) {
      btn.addEventListener('click', function () { reviewAction('budget_lines', btn.getAttribute('data-reject-bl'), 'reject').then(refreshProjectDetail); });
    });
    tbody.querySelectorAll('[data-edit-bl]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var line = lines.find(function (l) { return String(l.id) === btn.getAttribute('data-edit-bl'); });
        openBudgetLineForm(line);
      });
    });
    tbody.querySelectorAll('[data-delete-bl]').forEach(function (btn) {
      btn.addEventListener('click', function () { deleteBudgetLine(btn.getAttribute('data-delete-bl')); });
    });
  }

  function openBudgetLineForm(line) {
    var wrap = document.getElementById('budget-line-form-wrap');
    var form = document.getElementById('budget-line-form');
    form.reset();
    form.elements['id'].value = line ? line.id : '';
    if (line) {
      form.elements['year'].value = line.year != null ? line.year : '';
      form.elements['funding_source'].value = line.funding_source || '';
      form.elements['allocated_amount'].value = line.allocated_amount != null ? line.allocated_amount : '';
      form.elements['notes'].value = line.notes || '';
    }
    wrap.classList.remove('hidden');
  }

  function closeBudgetLineForm() {
    document.getElementById('budget-line-form-wrap').classList.add('hidden');
    document.getElementById('budget-line-form').reset();
  }

  async function handleBudgetLineFormSubmit(event) {
    event.preventDefault();
    var form = event.target;
    var formData = new FormData(form);
    var id = formData.get('id');
    var payload = {
      year: formData.get('year') || null,
      funding_source: formData.get('funding_source') || null,
      allocated_amount: formData.get('allocated_amount') || null,
      notes: formData.get('notes') || null,
    };

    try {
      if (id) {
        await fetchJson('/api/budget-lines/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } else {
        await fetchJson('/api/projects/' + currentProjectId + '/budget-lines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      }
      closeBudgetLineForm();
      await refreshProjectDetail();
      loadProjectsList();
    } catch (err) {
      window.alert('Грешка при запис на бюджетния ред. Проверете стойностите (сумата трябва да е >= 0).');
    }
  }

  async function deleteBudgetLine(id) {
    if (!window.confirm('Изтриване на бюджетния ред?')) return;
    try {
      await fetchJson('/api/budget-lines/' + id, { method: 'DELETE' });
      await refreshProjectDetail();
      loadProjectsList();
    } catch (err) {
      window.alert('Грешка при изтриване.');
    }
  }

  // -------------------------------------------------------------------------
  // Expenditures
  // -------------------------------------------------------------------------

  function renderExpenditures(items) {
    var tbody = document.getElementById('expenditures-tbody');

    if (!items || items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Няма разходи.</td></tr>';
      return;
    }

    tbody.innerHTML = items
      .map(function (e) {
        var reviewActions = e.review_status === 'pending'
          ? '<button type="button" class="btn btn-approve" data-approve-exp="' + e.id + '">Одобри</button> ' +
            '<button type="button" class="btn btn-reject" data-reject-exp="' + e.id + '">Отхвърли</button> '
          : '';
        return (
          '<tr>' +
          '<td>' + escapeHtml(formatDate(e.expenditure_date)) + '</td>' +
          '<td>' + escapeHtml(e.vendor_name || '—') + '</td>' +
          '<td>' + formatBGN(e.amount) + '</td>' +
          '<td>' + escapeHtml(e.document_reference || '') + '</td>' +
          '<td>' + reviewBadge(e.review_status) + '</td>' +
          '<td class="row-actions">' + reviewActions +
          '<button type="button" class="btn btn-secondary" data-edit-exp="' + e.id + '">Редактирай</button>' +
          '<button type="button" class="btn-danger btn" data-delete-exp="' + e.id + '">Изтрий</button>' +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    tbody.querySelectorAll('[data-approve-exp]').forEach(function (btn) {
      btn.addEventListener('click', function () { reviewAction('expenditures', btn.getAttribute('data-approve-exp'), 'approve').then(refreshProjectDetail); });
    });
    tbody.querySelectorAll('[data-reject-exp]').forEach(function (btn) {
      btn.addEventListener('click', function () { reviewAction('expenditures', btn.getAttribute('data-reject-exp'), 'reject').then(refreshProjectDetail); });
    });
    tbody.querySelectorAll('[data-edit-exp]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item = items.find(function (x) { return String(x.id) === btn.getAttribute('data-edit-exp'); });
        openExpenditureForm(item);
      });
    });
    tbody.querySelectorAll('[data-delete-exp]').forEach(function (btn) {
      btn.addEventListener('click', function () { deleteExpenditure(btn.getAttribute('data-delete-exp')); });
    });
  }

  function openExpenditureForm(item) {
    var wrap = document.getElementById('expenditure-form-wrap');
    var form = document.getElementById('expenditure-form');
    form.reset();
    form.elements['id'].value = item ? item.id : '';
    if (item) {
      form.elements['vendor_name'].value = item.vendor_name || '';
      form.elements['amount'].value = item.amount != null ? item.amount : '';
      form.elements['expenditure_date'].value = item.expenditure_date || '';
      form.elements['document_reference'].value = item.document_reference || '';
      form.elements['description'].value = item.description || '';
    }
    wrap.classList.remove('hidden');
  }

  function closeExpenditureForm() {
    document.getElementById('expenditure-form-wrap').classList.add('hidden');
    document.getElementById('expenditure-form').reset();
  }

  async function handleExpenditureFormSubmit(event) {
    event.preventDefault();
    var form = event.target;
    var formData = new FormData(form);
    var id = formData.get('id');
    var payload = {
      vendor_name: formData.get('vendor_name'),
      amount: formData.get('amount') || null,
      expenditure_date: formData.get('expenditure_date') || null,
      document_reference: formData.get('document_reference') || null,
      description: formData.get('description') || null,
    };

    try {
      if (id) {
        await fetchJson('/api/expenditures/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } else {
        await fetchJson('/api/projects/' + currentProjectId + '/expenditures', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      }
      closeExpenditureForm();
      await refreshProjectDetail();
      loadProjectsList();
    } catch (err) {
      window.alert('Грешка при запис на разхода. Доставчик е задължителен, а сумата трябва да е >= 0.');
    }
  }

  async function deleteExpenditure(id) {
    if (!window.confirm('Изтриване на разхода?')) return;
    try {
      await fetchJson('/api/expenditures/' + id, { method: 'DELETE' });
      await refreshProjectDetail();
      loadProjectsList();
    } catch (err) {
      window.alert('Грешка при изтриване.');
    }
  }

  // -------------------------------------------------------------------------
  // Attachments
  // -------------------------------------------------------------------------

  function renderAttachments(attachments) {
    var list = document.getElementById('attachments-list');
    if (!attachments || attachments.length === 0) {
      list.innerHTML = '<li class="empty-state">Няма прикачени документи.</li>';
      return;
    }

    list.innerHTML = attachments
      .map(function (a) {
        var href = a.url || ('/uploads/' + a.stored_filename);
        var label = a.label || a.original_filename || href;
        return (
          '<li>' +
          '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + '</a>' +
          '<button type="button" class="btn-danger btn" data-delete-att="' + a.id + '">Изтрий</button>' +
          '</li>'
        );
      })
      .join('');

    list.querySelectorAll('[data-delete-att]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!window.confirm('Изтриване на прикачения документ?')) return;
        try {
          await fetchJson('/api/attachments/' + btn.getAttribute('data-delete-att'), { method: 'DELETE' });
          await refreshProjectDetail();
        } catch (err) {
          window.alert('Грешка при изтриване.');
        }
      });
    });
  }

  async function handleAttachmentFormSubmit(event) {
    event.preventDefault();
    var form = event.target;
    var formData = new FormData(form);
    var label = formData.get('label');
    var url = formData.get('url');

    if (!url) {
      window.alert('Моля, въведете URL адрес на документа.');
      return;
    }

    try {
      await fetchJson('/api/attachments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_type: 'project', entity_id: currentProjectId, label: label || null, url: url }),
      });
      form.reset();
      await refreshProjectDetail();
    } catch (err) {
      window.alert('Грешка при прикачване на документа.');
    }
  }

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', async function () {
    var user = await checkAuthOrRedirect();
    if (!user) return;

    renderAdminNav('budget');
    loadProjectsList();

    document.getElementById('new-project-btn').addEventListener('click', openNewProjectForm);
    document.getElementById('project-form-cancel').addEventListener('click', closeProjectForm);
    document.getElementById('project-form').addEventListener('submit', handleProjectFormSubmit);

    document.getElementById('back-to-list-btn').addEventListener('click', closeProjectDetail);

    document.getElementById('new-budget-line-btn').addEventListener('click', function () { openBudgetLineForm(null); });
    document.getElementById('budget-line-form').addEventListener('submit', handleBudgetLineFormSubmit);
    document.querySelector('.budget-line-form-cancel').addEventListener('click', closeBudgetLineForm);

    document.getElementById('new-expenditure-btn').addEventListener('click', function () { openExpenditureForm(null); });
    document.getElementById('expenditure-form').addEventListener('submit', handleExpenditureFormSubmit);
    document.querySelector('.expenditure-form-cancel').addEventListener('click', closeExpenditureForm);

    document.getElementById('attachment-form').addEventListener('submit', handleAttachmentFormSubmit);
  });
})();
