(function () {
  'use strict';

  var STATUS_LABELS = {
    planned: 'Планиран',
    active: 'Активен',
    completed: 'Завършен',
  };

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getProjectId() {
    var params = new URLSearchParams(window.location.search);
    return params.get('id');
  }

  function renderNotFound() {
    document.getElementById('project-content').innerHTML =
      '<div class="card"><p class="empty-state">Проектът не е намерен или все още не е одобрен за публикуване.</p></div>';
  }

  function renderProject(data) {
    var p = data.project;
    var budgetLines = data.budget_lines || [];
    var expenditures = data.expenditures || [];
    var attachments = data.attachments || [];
    var procurements = data.procurements || [];

    var budgetLinesRows = budgetLines.length
      ? budgetLines
          .map(function (bl) {
            return (
              '<tr>' +
              '<td>' + escapeHtml(bl.year != null ? bl.year : '—') + '</td>' +
              '<td>' + escapeHtml(bl.funding_source || '—') + '</td>' +
              '<td class="amount-cell">' + formatBGN(bl.allocated_amount) + '</td>' +
              '<td>' + escapeHtml(bl.notes || '') + '</td>' +
              '</tr>'
            );
          })
          .join('')
      : '<tr><td colspan="4" class="empty-state">Няма одобрени бюджетни редове.</td></tr>';

    var expenditureRows = expenditures.length
      ? expenditures
          .map(function (e) {
            return (
              '<tr>' +
              '<td>' + escapeHtml(formatDate(e.expenditure_date)) + '</td>' +
              '<td>' + escapeHtml(e.vendor_name || '—') + '</td>' +
              '<td class="amount-cell">' + formatBGN(e.amount) + '</td>' +
              '<td>' + escapeHtml(e.document_reference || '') + '</td>' +
              '<td>' + escapeHtml(e.description || '') + '</td>' +
              '</tr>'
            );
          })
          .join('')
      : '<tr><td colspan="5" class="empty-state">Няма одобрени разходи.</td></tr>';

    var attachmentsHtml = attachments.length
      ? '<ul class="attachment-list">' +
        attachments
          .map(function (a) {
            var href = a.url || ('/uploads/' + a.stored_filename);
            var label = a.label || a.original_filename || href;
            return '<li><a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + '</a></li>';
          })
          .join('') +
        '</ul>'
      : '<p class="empty-state">Няма прикачени документи.</p>';

    var procurementsHtml = procurements.length
      ? '<ul class="attachment-list">' +
        procurements
          .map(function (proc) {
            return (
              '<li><a href="/procurement/detail.html?id=' + escapeHtml(proc.id) + '">' +
              escapeHtml(proc.title || '(без заглавие)') +
              '</a>' +
              (proc.status ? ' &mdash; <span class="badge">' + escapeHtml(proc.status) + '</span>' : '') +
              '</li>'
            );
          })
          .join('') +
        '</ul>'
      : '<p class="empty-state">Няма свързани обществени поръчки.</p>';

    var sourceBadge = renderSourceBadge(p.source_url, p.scraped_at);

    document.getElementById('project-content').innerHTML =
      '<div class="page-header">' +
      '<h1>' + escapeHtml(p.name) + '</h1>' +
      (p.description ? '<p class="lead">' + escapeHtml(p.description).replace(/\n/g, '<br>') + '</p>' : '') +
      '</div>' +
      '<div class="card">' +
      '<dl class="detail-list">' +
      '<dt>Категория</dt><dd>' + escapeHtml(p.category || '—') + '</dd>' +
      '<dt>Статус</dt><dd><span class="badge badge-approved">' + (STATUS_LABELS[p.status] || p.status) + '</span></dd>' +
      '<dt>Разпределени средства</dt><dd>' + formatBGN(p.allocated_total) + '</dd>' +
      '<dt>Изразходвани средства</dt><dd>' + formatBGN(p.spent_total) + '</dd>' +
      '</dl>' +
      (sourceBadge ? '<p class="progress-note">' + sourceBadge + '</p>' : '') +
      '</div>' +
      '<div class="card">' +
      '<h2>Бюджетни редове</h2>' +
      '<div class="table-responsive"><table><thead><tr><th>Година</th><th>Източник на финансиране</th><th>Разпределена сума</th><th>Бележки</th></tr></thead>' +
      '<tbody>' + budgetLinesRows + '</tbody></table></div>' +
      '</div>' +
      '<div class="card">' +
      '<h2>Разходи</h2>' +
      '<div class="table-responsive"><table><thead><tr><th>Дата</th><th>Доставчик</th><th>Сума</th><th>Документ</th><th>Описание</th></tr></thead>' +
      '<tbody>' + expenditureRows + '</tbody></table></div>' +
      '</div>' +
      '<div class="card">' +
      '<h2>Прикачени документи</h2>' +
      attachmentsHtml +
      '</div>' +
      '<div class="card">' +
      '<h2>Свързани обществени поръчки</h2>' +
      procurementsHtml +
      '</div>';
  }

  async function load() {
    var id = getProjectId();
    if (!id) {
      renderNotFound();
      return;
    }

    try {
      var data = await fetchJson('/api/projects/' + encodeURIComponent(id));
      renderProject(data);
    } catch (err) {
      renderNotFound();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderNav('budget');
    load();
  });
})();
