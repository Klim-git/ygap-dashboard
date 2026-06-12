/**
 * YGAP Dashboard — Telegram Mini App
 * Game status monitoring dashboard
 */

(function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────
  const STATUS_CONFIG = {
    DRAFT:     { emoji: '📝', color: '#6c757d', label: 'Draft' },
    IN_REVIEW: { emoji: '⏳', color: '#f0ad4e', label: 'In Review' },
    APPROVED:  { emoji: '✅', color: '#28a745', label: 'Approved' },
    PUBLISHED: { emoji: '🚀', color: '#007bff', label: 'Published' },
    REJECTED:  { emoji: '❌', color: '#dc3545', label: 'Rejected' },
    UNKNOWN:   { emoji: '❓', color: '#6c757d', label: 'Unknown' },
  };

  const CONSOLE_URL = 'https://games.yandex.ru/console/games/';
  const GIST_API = 'https://api.github.com/gists/';
  const GIST_FILENAME = 'ygap_dashboard_data.json';

  const DEMO_DATA = {
    games: {
      'crystal-clicker': {
        appId: '540396',
        title: 'Кристальный Кликер',
        version: '1.0.0',
        status: 'DRAFT',
        lastCheck: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        previousStatus: null,
      },
      'space-runner': {
        appId: '540397',
        title: 'Space Runner',
        version: '2.3.1',
        status: 'IN_REVIEW',
        lastCheck: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
        previousStatus: 'DRAFT',
      },
      'neon-blocks': {
        appId: '540398',
        title: 'Neon Blocks',
        version: '1.4.0',
        status: 'PUBLISHED',
        lastCheck: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        previousStatus: 'APPROVED',
      },
      'pixel-quest': {
        appId: '540399',
        title: 'Pixel Quest',
        version: '0.9.2',
        status: 'REJECTED',
        lastCheck: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
        previousStatus: 'IN_REVIEW',
      },
      'bubble-world': {
        appId: '540400',
        title: 'Bubble World',
        version: '3.1.0',
        status: 'APPROVED',
        lastCheck: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
        previousStatus: 'IN_REVIEW',
      },
    },
    lastFullCheck: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  };

  // ─── DOM references ──────────────────────────────────────
  const gamesContainer = document.getElementById('games-container');
  const statsBar = document.getElementById('stats-bar');

  // ─── Telegram WebApp init ─────────────────────────────────
  const tg = window.Telegram?.WebApp;

  function initTelegram() {
    if (!tg) return;

    tg.ready();
    tg.expand();

    // Apply Telegram theme colors
    const tp = tg.themeParams || {};
    const root = document.documentElement.style;
    root.setProperty('--tg-bg', tp.bg_color || '#0f0f23');
    root.setProperty('--tg-text', tp.text_color || '#e8e8f0');
    root.setProperty('--tg-hint', tp.hint_color || '#8888a0');
    root.setProperty('--tg-link', tp.link_color || '#7c8aff');
    root.setProperty('--tg-button', tp.button_color || '#7c5cfc');
    root.setProperty('--tg-button-text', tp.button_text_color || '#ffffff');
    root.setProperty('--tg-secondary-bg', tp.secondary_bg_color || '#1a1a35');

    // Set body bg
    document.body.style.backgroundColor = tp.bg_color || '';

    // Main button for refresh
    tg.MainButton.setText('🔄 Обновить');
    tg.MainButton.show();
    tg.MainButton.onClick(() => fetchAndRender());
  }

  // ─── Helpers ──────────────────────────────────────────────
  function getStatusConfig(status) {
    return STATUS_CONFIG[status] || STATUS_CONFIG.UNKNOWN;
  }

  function relativeTime(isoString) {
    if (!isoString) return '—';
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'только что';
    if (mins < 60) return `${mins} мин назад`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ч назад`;
    const days = Math.floor(hours / 24);
    return `${days} дн назад`;
  }

  function formatTime(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function statusCssClass(status) {
    return 'game-card--' + (status || 'unknown').toLowerCase().replace('_', '-');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Skeleton loading ────────────────────────────────────
  function showSkeleton(count = 3) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += `
        <div class="skeleton-card" style="animation-delay: ${i * 0.08}s">
          <div class="skeleton-line skeleton-line--title"></div>
          <div class="skeleton-line skeleton-line--meta"></div>
          <div class="skeleton-line skeleton-line--meta" style="width: 55%"></div>
          <div class="skeleton-line skeleton-line--button"></div>
        </div>
      `;
    }
    gamesContainer.innerHTML = html;
  }

  // ─── Error state ──────────────────────────────────────────
  function showError(title, message) {
    gamesContainer.innerHTML = `
      <div class="error-state">
        <div class="error-state__icon">😔</div>
        <div class="error-state__title">${escapeHtml(title)}</div>
        <div class="error-state__message">${escapeHtml(message)}</div>
        <button class="error-state__retry" onclick="window.__ygapRetry()">
          🔄 Попробовать снова
        </button>
      </div>
    `;
    statsBar.classList.remove('visible');
  }

  // ─── Empty state ──────────────────────────────────────────
  function showEmpty() {
    gamesContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">🎮</div>
        <div class="empty-state__text">Нет данных об играх</div>
      </div>
    `;
    statsBar.classList.remove('visible');
  }

  // ─── Render game cards ───────────────────────────────────
  function renderGames(data) {
    const games = data?.games;
    if (!games || Object.keys(games).length === 0) {
      showEmpty();
      return;
    }

    const entries = Object.entries(games);

    // Sort: IN_REVIEW first, then REJECTED, then others
    const priority = { IN_REVIEW: 0, REJECTED: 1, DRAFT: 2, APPROVED: 3, PUBLISHED: 4 };
    entries.sort(([, a], [, b]) => {
      return (priority[a.status] ?? 5) - (priority[b.status] ?? 5);
    });

    let html = '';
    entries.forEach(([dirName, game], index) => {
      const cfg = getStatusConfig(game.status);
      const cssClass = statusCssClass(game.status);
      const prevCfg = game.previousStatus ? getStatusConfig(game.previousStatus) : null;
      const consoleLink = game.appId ? `${CONSOLE_URL}${game.appId}` : '#';

      html += `
        <article
          class="game-card ${cssClass}"
          style="--card-status-color: ${cfg.color}; animation-delay: ${index * 0.08}s"
          data-index="${index}"
        >
          <div class="game-card__top">
            <div class="game-card__info">
              <div class="game-card__title">
                <span class="game-card__title-emoji">${cfg.emoji}</span>
                <span class="game-card__title-text">${escapeHtml(game.title || dirName)}</span>
              </div>
            </div>
            <div class="game-card__badge" style="background: ${cfg.color}">
              <span class="game-card__badge-dot"></span>
              ${escapeHtml(game.status || 'UNKNOWN')}
            </div>
          </div>

          <div class="game-card__meta">
            <div class="game-card__meta-row">
              <span class="game-card__meta-icon">📦</span>
              <span class="game-card__meta-value">v${escapeHtml(game.version || '—')}</span>
            </div>
            <div class="game-card__meta-row">
              <span class="game-card__meta-icon">🕐</span>
              <span class="game-card__meta-value">Проверен: ${relativeTime(game.lastCheck)}</span>
            </div>
            ${prevCfg ? `
            <div class="game-card__prev-status">
              ${prevCfg.emoji} было: ${escapeHtml(game.previousStatus)}
              <span class="arrow">→</span>
              ${cfg.emoji} ${escapeHtml(game.status)}
            </div>
            ` : ''}
          </div>

          <a
            class="game-card__link"
            href="${consoleLink}"
            target="_blank"
            rel="noopener noreferrer"
          >
            Открыть в консоли
            <span class="game-card__link-icon">↗</span>
          </a>
        </article>
      `;
    });

    gamesContainer.innerHTML = html;

    // Trigger entrance animations with stagger via IntersectionObserver
    requestAnimationFrame(() => {
      const cards = gamesContainer.querySelectorAll('.game-card');
      cards.forEach((card, i) => {
        setTimeout(() => {
          card.classList.add('visible');
        }, i * 100);
      });
    });

    // Render stats
    renderStats(data);
  }

  // ─── Render stats bar ────────────────────────────────────
  function renderStats(data) {
    const games = data?.games || {};
    const entries = Object.values(games);
    const total = entries.length;

    // Count per status
    const counts = {};
    entries.forEach((g) => {
      const s = g.status || 'UNKNOWN';
      counts[s] = (counts[s] || 0) + 1;
    });

    // Build chips
    let chipsHtml = '';
    const order = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED'];
    order.forEach((status) => {
      if (counts[status]) {
        const cfg = getStatusConfig(status);
        chipsHtml += `
          <span class="stats-chip">
            <span class="stats-chip__dot" style="background: ${cfg.color}"></span>
            <span class="stats-chip__count">${counts[status]}</span>
            ${cfg.label}
          </span>
        `;
      }
    });

    // Add unknown if exists
    if (counts.UNKNOWN) {
      const cfg = getStatusConfig('UNKNOWN');
      chipsHtml += `
        <span class="stats-chip">
          <span class="stats-chip__dot" style="background: ${cfg.color}"></span>
          <span class="stats-chip__count">${counts.UNKNOWN}</span>
          ${cfg.label}
        </span>
      `;
    }

    statsBar.innerHTML = `
      <div class="stats-bar__chips">${chipsHtml}</div>
      <div class="stats-bar__footer">
        <span class="stats-bar__total">Всего: ${total} ${pluralize(total, 'игра', 'игры', 'игр')}</span>
        <span class="stats-bar__time">
          <span class="stats-bar__time-dot"></span>
          Обновлено: ${formatTime(data.lastFullCheck)}
        </span>
      </div>
    `;

    // Animate in
    requestAnimationFrame(() => {
      statsBar.classList.add('visible');
    });
  }

  function pluralize(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  }

  // ─── Refresh indicator ───────────────────────────────────
  function showRefreshIndicator() {
    const el = document.createElement('div');
    el.className = 'refresh-indicator';
    el.id = 'refresh-indicator';
    document.body.appendChild(el);
  }

  function hideRefreshIndicator() {
    const el = document.getElementById('refresh-indicator');
    if (el) el.remove();
  }

  // ─── Fetch & render ──────────────────────────────────────
  let isLoading = false;

  async function fetchAndRender() {
    if (isLoading) return;
    isLoading = true;

    showRefreshIndicator();
    showSkeleton();
    statsBar.classList.remove('visible');

    const params = new URLSearchParams(window.location.search);
    const gistId = params.get('gist');

    if (!gistId) {
      // Show demo data
      await sleep(600); // Simulate loading for smooth UX
      hideRefreshIndicator();
      showDemoBanner();
      renderGames(DEMO_DATA);
      isLoading = false;
      return;
    }

    try {
      const res = await fetch(`${GIST_API}${gistId}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const gist = await res.json();

      if (!gist.files || !gist.files[GIST_FILENAME]) {
        throw new Error(`Файл "${GIST_FILENAME}" не найден в Gist`);
      }

      const data = JSON.parse(gist.files[GIST_FILENAME].content);
      hideRefreshIndicator();
      renderGames(data);
    } catch (err) {
      console.error('[YGAP] Fetch error:', err);
      hideRefreshIndicator();
      showError(
        'Не удалось загрузить данные',
        err.message || 'Проверьте ID гиста и попробуйте снова'
      );
    } finally {
      isLoading = false;
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ─── Demo banner ─────────────────────────────────────────
  function showDemoBanner() {
    // Remove existing if any
    const existing = document.querySelector('.demo-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.className = 'demo-banner';
    banner.innerHTML = `
      <span class="demo-banner__icon">💡</span>
      <span>Демо-режим. Добавьте <code style="font-size:0.72rem;opacity:0.8">?gist=ID</code> для загрузки данных</span>
    `;
    gamesContainer.parentNode.insertBefore(banner, gamesContainer);
  }

  // ─── Interactive card hover effect ───────────────────────
  function initCardHoverEffect() {
    gamesContainer.addEventListener('pointermove', (e) => {
      const card = e.target.closest('.game-card');
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      card.style.setProperty('--mouse-x', `${x}%`);
      card.style.setProperty('--mouse-y', `${y}%`);
    });
  }

  // ─── Retry global function ────────────────────────────────
  window.__ygapRetry = fetchAndRender;

  // ─── Init ─────────────────────────────────────────────────
  function init() {
    initTelegram();
    initCardHoverEffect();
    fetchAndRender();
  }

  // DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
