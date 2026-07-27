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
        <a class="brand" href="/">Община Лом &mdash; Прозрачност</a>
        <nav class="site-nav">${links}</nav>
      </header>
    `;
  }

  window.fetchJson = fetchJson;
  window.formatBGN = formatBGN;
  window.formatDate = formatDate;
  window.renderSourceBadge = renderSourceBadge;
  window.renderNav = renderNav;
})(window);
