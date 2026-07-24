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

  function pct(spent, allocated) {
    if (!allocated || allocated <= 0) return 0;
    var p = (spent / allocated) * 100;
    return Math.max(0, Math.min(100, p));
  }

  function renderOverallStats(overall) {
    var container = document.getElementById('overall-stats');
    var spentPct = pct(overall.spent_total, overall.allocated_total);
    container.innerHTML =
      '<div class="stat-card">' +
      '<div class="stat-number">' + formatBGN(overall.allocated_total) + '</div>' +
      '<div class="stat-label">Общо разпределени средства</div>' +
      '</div>' +
      '<div class="stat-card">' +
      '<div class="stat-number">' + formatBGN(overall.spent_total) + '</div>' +
      '<div class="stat-label">Общо изразходвани средства</div>' +
      '</div>' +
      '<div class="stat-card">' +
      '<div class="stat-number">' + spentPct.toFixed(1) + '%</div>' +
      '<div class="stat-label">Дял на изразходваните средства</div>' +
      '</div>';
  }

  function renderBarChart(containerId, rows, nameFn) {
    var container = document.getElementById(containerId);

    if (!rows || rows.length === 0) {
      container.innerHTML = '<p class="empty-state">Няма одобрени данни все още.</p>';
      return;
    }

    var maxAllocated = Math.max.apply(
      null,
      rows.map(function (r) { return Math.max(r.allocated_total, r.spent_total); })
    ) || 1;

    var legend =
      '<div class="bar-legend">' +
      '<span><span class="swatch swatch-allocated"></span> Разпределени средства</span>' +
      '<span><span class="swatch swatch-spent"></span> Изразходвани средства</span>' +
      '</div>';

    var bars = rows
      .map(function (r) {
        var allocatedWidth = (r.allocated_total / maxAllocated) * 100;
        var spentWidth = (r.spent_total / maxAllocated) * 100;
        return (
          '<div class="bar-group">' +
          '<div class="bar-group-label"><span class="bar-group-name">' +
          escapeHtml(nameFn(r)) +
          '</span><span class="bar-group-values">' +
          formatBGN(r.spent_total) + ' / ' + formatBGN(r.allocated_total) +
          '</span></div>' +
          '<div class="bar-track">' +
          '<div class="bar-fill-allocated" style="width:' + allocatedWidth.toFixed(2) + '%"></div>' +
          '<div class="bar-fill-spent" style="width:' + spentWidth.toFixed(2) + '%"></div>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');

    container.innerHTML = legend + bars;
  }

  function renderProjectsTable(projects) {
    var tbody = document.getElementById('projects-tbody');

    if (!projects || projects.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Няма намерени проекти.</td></tr>';
      return;
    }

    tbody.innerHTML = projects
      .map(function (p) {
        return (
          '<tr>' +
          '<td>' + escapeHtml(p.name) + '</td>' +
          '<td>' + escapeHtml(p.category || '—') + '</td>' +
          '<td><span class="badge badge-approved">' + (STATUS_LABELS[p.status] || p.status) + '</span></td>' +
          '<td class="amount-cell">' + formatBGN(p.allocated_total) + '</td>' +
          '<td class="amount-cell">' + formatBGN(p.spent_total) + '</td>' +
          '<td><a class="btn btn-secondary" href="/budget/project.html?id=' + encodeURIComponent(p.id) + '">Преглед</a></td>' +
          '</tr>'
        );
      })
      .join('');
  }

  function populateSelect(select, values, current) {
    var existing = new Set(Array.prototype.slice.call(select.options).map(function (o) { return o.value; }));
    values.forEach(function (v) {
      if (v === null || v === undefined || v === '' || existing.has(String(v))) return;
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
      existing.add(String(v));
    });
    if (current) select.value = current;
  }

  async function loadDashboard() {
    try {
      var data = await fetchJson('/api/dashboard/budget');
      renderOverallStats(data.overall);
      renderBarChart('by-category-chart', data.by_category, function (r) { return r.category; });
      renderBarChart('by-year-chart', data.by_year, function (r) { return String(r.year); });

      var yearSelect = document.getElementById('filter-year');
      populateSelect(
        yearSelect,
        data.by_year.map(function (r) { return r.year; }).sort(function (a, b) { return b - a; })
      );
    } catch (err) {
      document.getElementById('overall-stats').innerHTML =
        '<p class="empty-state">Грешка при зареждане на обобщените данни.</p>';
      document.getElementById('by-category-chart').innerHTML = '';
      document.getElementById('by-year-chart').innerHTML = '';
    }
  }

  function buildQuery(params) {
    var parts = [];
    Object.keys(params).forEach(function (key) {
      if (params[key]) parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  async function loadProjects(filters) {
    var tbody = document.getElementById('projects-tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Зареждане...</td></tr>';

    try {
      var query = buildQuery(filters || {});
      var data = await fetchJson('/api/projects' + query);
      renderProjectsTable(data.projects);

      if (!filters || (!filters.category)) {
        var categorySelect = document.getElementById('filter-category');
        var categories = Array.from(
          new Set(data.projects.map(function (p) { return p.category; }).filter(Boolean))
        ).sort();
        populateSelect(categorySelect, categories);
      }
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Грешка при зареждане на проектите.</td></tr>';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderNav('budget');
    loadDashboard();
    loadProjects();

    var form = document.getElementById('filters-form');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var formData = new FormData(form);
      loadProjects({
        year: formData.get('year'),
        category: formData.get('category'),
        status: formData.get('status'),
      });
    });
  });
})();
