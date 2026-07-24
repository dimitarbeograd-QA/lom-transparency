/*
 * Community Лом -- Public "Наредби и нормативни актове" (Ordinances) pages.
 * Plain script, no bundler -- relies on /js/common.js being loaded first
 * for fetchJson/formatDate/renderSourceBadge/renderNav.
 */

(function (window) {
  'use strict';

  // Ordinance fields ultimately come from either scraped third-party
  // HTML content or admin form input -- neither is trusted enough to
  // interpolate into innerHTML unescaped.
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
      status: form.status.value,
      category: form.category.value.trim(),
    };
  }

  function readFiltersFromUrl() {
    const usp = new URLSearchParams(window.location.search);
    return {
      status: usp.get('status') || '',
      category: usp.get('category') || '',
    };
  }

  // Adoption dates are frequently absent at the source (the listing page
  // this data is scraped from never shows them) -- the UI must handle that
  // gracefully rather than showing a blank or broken date.
  function adoptionDateLabel(ordinance) {
    return ordinance.adoption_date
      ? formatDate(ordinance.adoption_date)
      : 'Дата на приемане: неизвестна';
  }

  const STATUS_LABELS = {
    active: 'Действаща',
    repealed: 'Отменена',
  };

  function statusBadge(status) {
    const cls = status === 'repealed' ? 'badge-rejected' : 'badge-approved';
    return `<span class="badge ${cls}">${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
  }

  function renderOrdinanceCard(ordinance) {
    const dateText = ordinance.adoption_date
      ? `Дата на приемане: ${escapeHtml(formatDate(ordinance.adoption_date))}`
      : escapeHtml(adoptionDateLabel(ordinance));

    return `
      <a class="card ordinance-card" href="/ordinances/detail.html?id=${escapeAttr(ordinance.id)}">
        <div class="ordinance-card-header">
          ${statusBadge(ordinance.status)}
          <span class="text-muted">${dateText}</span>
        </div>
        <h3 style="margin: 0.35em 0;">${escapeHtml(ordinance.title) || '(без заглавие)'}</h3>
        ${ordinance.category ? `<span class="badge badge-approved">${escapeHtml(ordinance.category)}</span>` : ''}
      </a>
    `;
  }

  async function loadOrdinancesList(filters) {
    const container = document.getElementById('ordinances-list');
    container.innerHTML = '<p class="empty-state">Зареждане...</p>';

    try {
      const data = await fetchJson(`/api/ordinances${qs(filters)}`);
      const ordinances = (data && data.ordinances) || [];

      if (ordinances.length === 0) {
        container.innerHTML =
          '<p class="empty-state">Няма намерени наредби по зададените критерии.</p>';
        return;
      }

      container.innerHTML = ordinances.map(renderOrdinanceCard).join('');
    } catch (err) {
      container.innerHTML =
        '<p class="empty-state">Грешка при зареждане на наредбите. Опитайте отново по-късно.</p>';
    }
  }

  function initOrdinancesListPage() {
    const form = document.getElementById('filter-form');
    const resetBtn = document.getElementById('filter-reset');

    const initialFilters = readFiltersFromUrl();
    form.status.value = initialFilters.status;
    form.category.value = initialFilters.category;

    loadOrdinancesList(initialFilters);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      const filters = readFiltersFromForm(form);
      const newUrl = `${window.location.pathname}${qs(filters)}`;
      window.history.replaceState(null, '', newUrl);
      loadOrdinancesList(filters);
    });

    resetBtn.addEventListener('click', function () {
      form.reset();
      window.history.replaceState(null, '', window.location.pathname);
      loadOrdinancesList({});
    });
  }

  async function initOrdinanceDetailPage() {
    const container = document.getElementById('ordinance-detail');
    const usp = new URLSearchParams(window.location.search);
    const id = usp.get('id');

    if (!id) {
      container.innerHTML = '<p class="empty-state">Липсва идентификатор на наредба.</p>';
      return;
    }

    try {
      const data = await fetchJson(`/api/ordinances/${encodeURIComponent(id)}`);
      const ordinance = data.ordinance;
      const attachments = data.attachments || [];

      document.title = `${ordinance.title || 'Наредба'} — Община Лом`;

      const attachmentsHtml = attachments.length
        ? `<ul class="attachments-list">${attachments
            .map((a) => {
              const href = a.url || (a.stored_filename ? `/uploads/${a.stored_filename}` : '#');
              const label = a.label || a.original_filename || 'Документ';
              return `<li><a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></li>`;
            })
            .join('')}</ul>`
        : '<p class="text-muted">Няма прикачени документи.</p>';

      const dateLine = ordinance.adoption_date
        ? `Дата на приемане: ${escapeHtml(formatDate(ordinance.adoption_date))}`
        : escapeHtml(adoptionDateLabel(ordinance));

      const amendedLine = ordinance.last_amended_date
        ? `<p class="text-muted">Последно изменение: ${escapeHtml(formatDate(ordinance.last_amended_date))}</p>`
        : '';

      // Source page for scraped ordinances is often a direct file download
      // (service-download-file.php) or a content page -- either way, offer
      // it as a primary "read the ordinance" link in addition to the
      // standard source badge.
      const sourceLinkHtml = ordinance.source_url
        ? `<p><a class="btn" href="${escapeAttr(ordinance.source_url)}" target="_blank" rel="noopener noreferrer">Отвори документа</a></p>`
        : '';

      container.innerHTML = `
        <div class="page-header">
          <p class="text-muted">
            <a href="/ordinances/">&larr; Всички наредби</a>
          </p>
          <h1>${escapeHtml(ordinance.title) || '(без заглавие)'}</h1>
          <p class="lead">
            ${statusBadge(ordinance.status)}
            ${ordinance.category ? ` &middot; ${escapeHtml(ordinance.category)}` : ''}
          </p>
        </div>

        <div class="card">
          <p>${dateLine}</p>
          ${amendedLine}
          ${sourceLinkHtml}
          ${renderSourceBadge(ordinance.source_url, ordinance.scraped_at)}
        </div>

        <div class="card">
          <h2>Прикачени документи</h2>
          ${attachmentsHtml}
        </div>
      `;
    } catch (err) {
      container.innerHTML =
        '<p class="empty-state">Наредбата не е намерена или все още не е одобрена за публикуване.</p>';
    }
  }

  window.initOrdinancesListPage = initOrdinancesListPage;
  window.initOrdinanceDetailPage = initOrdinanceDetailPage;
})(window);
