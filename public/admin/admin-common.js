/*
 * Community Лом -- Admin area shared utilities.
 * Plain script, no bundler, no ES modules -- load with a plain
 * <script src="/admin/admin-common.js"></script> tag. Self-contained
 * (does not depend on /js/common.js) so the admin area can evolve
 * independently.
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

  async function checkAuthOrRedirect() {
    try {
      const data = await fetchJson('/api/auth/me');
      return data.user;
    } catch (err) {
      window.location.href = '/admin/index.html';
      return null;
    }
  }

  async function logout() {
    try {
      await fetchJson('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/admin/index.html';
    }
  }

  const ADMIN_NAV_LINKS = [
    { key: 'dashboard', label: 'Табло', href: '/admin/dashboard.html' },
    { key: 'budget', label: 'Бюджет', href: '/admin/budget.html' },
    { key: 'procurement', label: 'Поръчки', href: '/admin/procurement.html' },
    { key: 'decisions', label: 'Решения', href: '/admin/decisions.html' },
    { key: 'ordinances', label: 'Наредби', href: '/admin/ordinances.html' },
    { key: 'administration', label: 'Администрация', href: '/admin/administration.html' },
    { key: 'minfin', label: 'Финанси (МФ)', href: '/admin/minfin.html' },
  ];

  function renderAdminNav(activeKey) {
    const container = document.getElementById('admin-nav');
    if (!container) return;

    const links = ADMIN_NAV_LINKS.map((link) => {
      const activeClass = link.key === activeKey ? ' class="active"' : '';
      return `<a href="${link.href}"${activeClass}>${link.label}</a>`;
    }).join('');

    container.innerHTML = `
      <header class="site-header">
        <a class="brand" href="/admin/dashboard.html">Община Лом &mdash; Администрация</a>
        <nav class="admin-nav">
          ${links}
          <a href="#" class="logout" id="logout-link">Изход</a>
        </nav>
      </header>
    `;

    const logoutLink = document.getElementById('logout-link');
    if (logoutLink) {
      logoutLink.addEventListener('click', function (event) {
        event.preventDefault();
        logout();
      });
    }
  }

  window.fetchJson = fetchJson;
  window.formatBGN = formatBGN;
  window.formatDate = formatDate;
  window.renderSourceBadge = renderSourceBadge;
  window.checkAuthOrRedirect = checkAuthOrRedirect;
  window.logout = logout;
  window.renderAdminNav = renderAdminNav;
})(window);
