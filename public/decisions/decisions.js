/*
 * Community Лом -- Public "Решения на Общински съвет" (Council Decisions)
 * pages. Plain script, no bundler -- relies on /js/common.js being loaded
 * first for fetchJson/formatDate/renderSourceBadge/renderNav.
 */

(function (window) {
  'use strict';

  // All decision/attachment fields ultimately come from either scraped
  // third-party HTML/PDF content or admin form input -- neither is trusted
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
      session_number: form.session_number.value.trim(),
      category: form.category.value.trim(),
      from: form.from.value,
      to: form.to.value,
    };
  }

  function readFiltersFromUrl() {
    const usp = new URLSearchParams(window.location.search);
    return {
      session_number: usp.get('session_number') || '',
      category: usp.get('category') || '',
      from: usp.get('from') || '',
      to: usp.get('to') || '',
    };
  }

  function decisionNumberLabel(decision) {
    return decision.decision_number && !decision.decision_number.startsWith('НЕИЗВЕСТНО')
      ? `Решение № ${escapeHtml(decision.decision_number)}`
      : 'Номер на решението предстои да бъде уточнен';
  }

  function renderDecisionCard(decision) {
    const number = decisionNumberLabel(decision);

    return `
      <a class="card decision-card" href="/decisions/detail.html?id=${escapeAttr(decision.id)}">
        <div class="decision-card-header">
          <strong>${number}</strong>
          ${decision.session_date ? `<span class="text-muted">${escapeHtml(formatDate(decision.session_date))}</span>` : ''}
        </div>
        <h3 style="margin: 0.35em 0;">${escapeHtml(decision.title) || '(без заглавие)'}</h3>
        ${decision.category ? `<span class="badge badge-approved">${escapeHtml(decision.category)}</span>` : ''}
        ${decision.summary ? `<p class="text-muted" style="margin-top:0.5em;">${escapeHtml(decision.summary)}</p>` : ''}
      </a>
    `;
  }

  async function loadDecisionsList(filters) {
    const container = document.getElementById('decisions-list');
    container.innerHTML = '<p class="empty-state">Зареждане...</p>';

    try {
      const data = await fetchJson(`/api/council-decisions${qs(filters)}`);
      const decisions = (data && data.decisions) || [];

      if (decisions.length === 0) {
        container.innerHTML =
          '<p class="empty-state">Няма намерени решения по зададените критерии.</p>';
        return;
      }

      container.innerHTML = decisions.map(renderDecisionCard).join('');
    } catch (err) {
      container.innerHTML =
        '<p class="empty-state">Грешка при зареждане на решенията. Опитайте отново по-късно.</p>';
    }
  }

  function initDecisionsListPage() {
    const form = document.getElementById('filter-form');
    const resetBtn = document.getElementById('filter-reset');

    const initialFilters = readFiltersFromUrl();
    form.session_number.value = initialFilters.session_number;
    form.category.value = initialFilters.category;
    form.from.value = initialFilters.from;
    form.to.value = initialFilters.to;

    loadDecisionsList(initialFilters);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      const filters = readFiltersFromForm(form);
      const newUrl = `${window.location.pathname}${qs(filters)}`;
      window.history.replaceState(null, '', newUrl);
      loadDecisionsList(filters);
    });

    resetBtn.addEventListener('click', function () {
      form.reset();
      window.history.replaceState(null, '', window.location.pathname);
      loadDecisionsList({});
    });
  }

  async function initDecisionDetailPage() {
    const container = document.getElementById('decision-detail');
    const usp = new URLSearchParams(window.location.search);
    const id = usp.get('id');

    if (!id) {
      container.innerHTML = '<p class="empty-state">Липсва идентификатор на решение.</p>';
      return;
    }

    try {
      const data = await fetchJson(`/api/council-decisions/${encodeURIComponent(id)}`);
      const decision = data.decision;
      const attachments = data.attachments || [];

      const number = decisionNumberLabel(decision);

      document.title = `${decision.title || number} — Община Лом`;

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
            <a href="/decisions/">&larr; Всички решения</a>
          </p>
          <h1>${number}</h1>
          ${decision.session_date ? `<p class="lead">Заседание от ${escapeHtml(formatDate(decision.session_date))}${decision.session_number ? ` &middot; сесия ${escapeHtml(decision.session_number)}` : ''}</p>` : ''}
        </div>

        <div class="card">
          <h2>${escapeHtml(decision.title) || '(без заглавие)'}</h2>
          ${decision.category ? `<p><span class="badge badge-approved">${escapeHtml(decision.category)}</span></p>` : ''}
          ${decision.summary ? `<p>${escapeHtml(decision.summary)}</p>` : '<p class="text-muted">Няма добавено резюме.</p>'}
          ${renderSourceBadge(decision.source_url, decision.scraped_at)}
        </div>

        <div class="card">
          <h2>Прикачени документи</h2>
          ${attachmentsHtml}
        </div>
      `;
    } catch (err) {
      container.innerHTML =
        '<p class="empty-state">Решението не е намерено или все още не е одобрено за публикуване.</p>';
    }
  }

  window.initDecisionsListPage = initDecisionsListPage;
  window.initDecisionDetailPage = initDecisionDetailPage;
})(window);
