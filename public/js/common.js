/*
 * Community Лом -- Портал за прозрачност
 * Shared plain-script utilities for public pages. No bundler, no ES modules
 * -- load with a plain <script src="/js/common.js"></script> tag. Everything
 * is exposed as window globals.
 */

(function (window) {
  'use strict';

  async function fetchJson(url, opts) {
    const options = Object.assign({}, opts, { credentials: 'include' });
    const res = await fetch(url, options);
    const text = await res.text();

    if (!res.ok) {
      throw new Error(`Request to ${url} failed with ${res.status}: ${text}`);
    }

    if (!text) {
      return null;
    }

    return JSON.parse(text);
  }

  function formatBGN(amount) {
    const value = Number(amount) || 0;
    return (
      new Intl.NumberFormat('bg-BG', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value) + ' лв.'
    );
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat('bg-BG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(d);
  }

  function renderSourceBadge(sourceUrl, scrapedAt) {
    if (!sourceUrl && !scrapedAt) {
      return '';
    }

    const parts = [];
    if (sourceUrl) {
      parts.push(
        `<a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">Източник</a>`
      );
    }
    if (scrapedAt) {
      parts.push(`обработено на ${formatDate(scrapedAt)}`);
    }

    return `<span class="source-badge">${parts.join(' &middot; ')}</span>`;
  }

  const NAV_LINKS = [
    { key: 'home', label: 'Начало', href: '/' },
    { key: 'budget', label: 'Бюджет и разходи', href: '/budget/' },
    { key: 'procurement', label: 'Обществени поръчки', href: '/procurement/' },
    { key: 'decisions', label: 'Решения на ОбС', href: '/decisions/' },
    { key: 'ordinances', label: 'Наредби', href: '/ordinances/' },
    { key: 'administration', label: 'Администрация', href: '/administration/' },
    { key: 'minfin', label: 'Финансови показатели (МФ)', href: '/minfin/' },
  ];

  function renderNav(activeKey) {
    const container = document.getElementById('site-nav');
    if (!container) return;

    const links = NAV_LINKS.map((link) => {
      const activeClass = link.key === activeKey ? ' class="active"' : '';
      return `<a href="${link.href}"${activeClass}>${link.label}</a>`;
    }).join('');

    container.innerHTML = `
      <header class="site-header">
        <div class="site-header-inner">
          <a class="brand" href="/">Община Лом &mdash; Прозрачност</a>
          <nav class="site-nav">${links}</nav>
          <div class="site-search" id="site-search-root">
            <input type="search" id="site-search-input" placeholder="Търсене в бюджет, поръчки, решения, наредби..." autocomplete="off" />
            <div class="site-search-results" id="site-search-results"></div>
          </div>
        </div>
      </header>
    `;

    initGlobalSearch();
  }

  function escapeSearchHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderSearchResults(data) {
    const panel = document.getElementById('site-search-results');
    if (!panel) return;

    if (!data.groups || data.groups.length === 0) {
      panel.innerHTML = `<div class="site-search-empty">Няма резултати за &bdquo;${escapeSearchHtml(data.query)}&ldquo;.</div>`;
      return;
    }

    panel.innerHTML = data.groups
      .map((group) => {
        const items = group.items
          .map(
            (item) => `
              <a class="site-search-item" href="${escapeSearchHtml(item.href)}">
                <span class="item-title">${escapeSearchHtml(item.title || '(без заглавие)')}</span>
                ${item.meta ? `<span class="item-meta">${escapeSearchHtml(item.meta)}</span>` : ''}
              </a>
            `
          )
          .join('');
        return `
          <div class="site-search-group">
            <div class="site-search-group-label">${escapeSearchHtml(group.label)}</div>
            ${items}
          </div>
        `;
      })
      .join('');
  }

  function initGlobalSearch() {
    const input = document.getElementById('site-search-input');
    const panel = document.getElementById('site-search-results');
    const root = document.getElementById('site-search-root');
    if (!input || !panel || !root) return;

    let debounceTimer = null;
    let latestQuery = '';

    async function runSearch(q) {
      latestQuery = q;
      if (q.trim().length < 2) {
        panel.classList.remove('open');
        panel.innerHTML = '';
        return;
      }
      panel.innerHTML = '<div class="site-search-loading">Търсене...</div>';
      panel.classList.add('open');
      try {
        const data = await fetchJson(`/api/search?q=${encodeURIComponent(q)}`);
        if (latestQuery !== q) return; // a newer keystroke has already superseded this response
        renderSearchResults(data);
      } catch (err) {
        panel.innerHTML = '<div class="site-search-empty">Грешка при търсене.</div>';
      }
    }

    input.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      const value = input.value;
      debounceTimer = setTimeout(function () {
        runSearch(value);
      }, 250);
    });

    input.addEventListener('focus', function () {
      if (input.value.trim().length >= 2) panel.classList.add('open');
    });

    document.addEventListener('click', function (event) {
      if (!root.contains(event.target)) {
        panel.classList.remove('open');
      }
    });

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        panel.classList.remove('open');
        input.blur();
      }
    });
  }

  window.fetchJson = fetchJson;
  window.formatBGN = formatBGN;
  window.formatDate = formatDate;
  window.renderSourceBadge = renderSourceBadge;
  window.renderNav = renderNav;
})(window);
