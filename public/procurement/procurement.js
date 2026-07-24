/*
 * Community Лом -- Public "Обществени поръчки" (Public Procurement) pages.
 * Plain script, no bundler -- relies on /js/common.js being loaded first
 * for fetchJson/formatBGN/formatDate/renderSourceBadge/renderNav.
 */

(function (window) {
  'use strict';

  // All procurement/attachment fields ultimately come from either scraped
  // third-party HTML content or admin form input -- neither is trusted
  // enough to interpolate into innerHTML unescaped.
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  const STATUS_BADGE_CLASS = {
    'обявена': 'badge-pending',
    'в ход': 'badge-pending',
    'възложена': 'badge-approved',
    'приключена': 'badge-approved',
    'прекратена': 'badge-rejected',
  };

  function statusBadge(status) {
    if (!status) return '';
    const cls = STATUS_BADGE_CLASS[status] || 'badge-pending';
    return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
  }

  function qs(params) {
    const usp = new URLSearchParams();
    Object.keys(params).forEach((key) => {
      if (params[key]) usp.set(key, params[key]);
    });
    const s = usp.toString();
    return s ? `?${s}` : '';
  }

  function readFiltersFromForm(form) {
    return {
      status: form.status.value,
      procedure_type: form.procedure_type.value.trim(),
      year: form.year.value,
    };
  }

  function readFiltersFromUrl() {
    const usp = new URLSearchParams(window.location.search);
    return {
      status: usp.get('status') || '',
      procedure_type: usp.get('procedure_type') || '',
      year: usp.get('year') || '',
    };
  }

  function renderProcurementCard(procurement) {
    return `
      <a class="card procurement-card" href="/procurement/detail.html?id=${escapeAttr(procurement.id)}">
        <div class="procurement-card-header">
          ${statusBadge(procurement.status)}
          ${procurement.publish_date ? `<span class="text-muted">${escapeHtml(formatDate(procurement.publish_date))}</span>` : ''}
          ${procurement.procedure_type ? `<span class="text-muted">${escapeHtml(procurement.procedure_type)}</span>` : ''}
        </div>
        <h3 style="margin: 0.35em 0;">${escapeHtml(procurement.title) || '(без заглавие)'}</h3>
        ${procurement.estimated_value ? `<p class="text-muted" style="margin:0;">Прогнозна стойност: ${escapeHtml(formatBGN(procurement.estimated_value))}</p>` : ''}
      </a>
    `;
  }

  async function loadProcurementsList(filters) {
    const container = document.getElementById('procurements-list');
    container.innerHTML = '<p class="empty-state">Зареждане...</p>';

    try {
      const data = await fetchJson(`/api/procurements${qs(filters)}`);
      const procurements = (data && data.procurements) || [];

      if (procurements.length === 0) {
        container.innerHTML =
          '<p class="empty-state">Няма намерени поръчки по зададените критерии.</p>';
        return;
      }

      container.innerHTML = procurements.map(renderProcurementCard).join('');
    } catch (err) {
      container.innerHTML =
        '<p class="empty-state">Грешка при зареждане на поръчките. Опитайте отново по-късно.</p>';
    }
  }

  function initProcurementListPage() {
    const form = document.getElementById('filter-form');
    const resetBtn = document.getElementById('filter-reset');

    const initialFilters = readFiltersFromUrl();
    form.status.value = initialFilters.status;
    form.procedure_type.value = initialFilters.procedure_type;
    form.year.value = initialFilters.year;

    loadProcurementsList(initialFilters);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      const filters = readFiltersFromForm(form);
      const newUrl = `${window.location.pathname}${qs(filters)}`;
      window.history.replaceState(null, '', newUrl);
      loadProcurementsList(filters);
    });

    resetBtn.addEventListener('click', function () {
      form.reset();
      window.history.replaceState(null, '', window.location.pathname);
      loadProcurementsList({});
    });
  }

  async function initProcurementDetailPage() {
    const container = document.getElementById('procurement-detail');
    const usp = new URLSearchParams(window.location.search);
    const id = usp.get('id');

    if (!id) {
      container.innerHTML = '<p class="empty-state">Липсва идентификатор на поръчка.</p>';
      return;
    }

    try {
      const data = await fetchJson(`/api/procurements/${encodeURIComponent(id)}`);
      const procurement = data.procurement;
      const attachments = data.attachments || [];
      const project = data.project || null;

      document.title = `${procurement.title || 'Обществена поръчка'} — Община Лом`;

      const attachmentsHtml = attachments.length
        ? `<ul class="attachments-list">${attachments
            .map((a) => {
              const href = a.url || (a.stored_filename ? `/uploads/${a.stored_filename}` : '#');
              const label = a.label || a.original_filename || 'Документ';
              return `<li><a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></li>`;
            })
            .join('')}</ul>`
        : '<p class="text-muted">Няма прикачени документи.</p>';

      container.innerHTML = `
        <div class="page-header">
          <p class="text-muted">
            <a href="/procurement/">&larr; Всички поръчки</a>
          </p>
          <h1>${escapeHtml(procurement.title) || '(без заглавие)'}</h1>
          <p class="lead">
            ${statusBadge(procurement.status)}
            ${procurement.procedure_type ? ` &middot; ${escapeHtml(procurement.procedure_type)}` : ''}
          </p>
        </div>

        <div class="card">
          ${procurement.description ? `<p>${escapeHtml(procurement.description)}</p>` : '<p class="text-muted">Няма добавено описание.</p>'}

          <dl class="detail-facts">
            <div>
              <dt>Дата на публикуване</dt>
              <dd>${procurement.publish_date ? escapeHtml(formatDate(procurement.publish_date)) : '&mdash;'}</dd>
            </div>
            <div>
              <dt>Краен срок</dt>
              <dd>${procurement.deadline_date ? escapeHtml(formatDate(procurement.deadline_date)) : '&mdash;'}</dd>
            </div>
            <div>
              <dt>Прогнозна стойност</dt>
              <dd>${procurement.estimated_value ? escapeHtml(formatBGN(procurement.estimated_value)) : '&mdash;'}</dd>
            </div>
            <div>
              <dt>Изпълнител</dt>
              <dd>${procurement.awarded_contractor ? escapeHtml(procurement.awarded_contractor) : '&mdash;'}</dd>
            </div>
            <div>
              <dt>Стойност на договора</dt>
              <dd>${procurement.contract_value ? escapeHtml(formatBGN(procurement.contract_value)) : '&mdash;'}</dd>
            </div>
            <div>
              <dt>Дата на договора</dt>
              <dd>${procurement.contract_date ? escapeHtml(formatDate(procurement.contract_date)) : '&mdash;'}</dd>
            </div>
          </dl>

          ${project ? `<p><a href="/budget/project.html?id=${escapeAttr(project.id)}">&rarr; Виж свързания проект в бюджета: ${escapeHtml(project.name)}</a></p>` : ''}

          ${renderSourceBadge(procurement.source_url, procurement.scraped_at)}
        </div>

        <div class="card">
          <h2>Прикачени документи</h2>
          ${attachmentsHtml}
        </div>
      `;
    } catch (err) {
      container.innerHTML =
        '<p class="empty-state">Поръчката не е намерена или все още не е одобрена за публикуване.</p>';
    }
  }

  window.initProcurementListPage = initProcurementListPage;
  window.initProcurementDetailPage = initProcurementDetailPage;
})(window);
