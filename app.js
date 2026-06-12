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

  const PIPELINE_STAGES = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED'];
  const PIPELINE_LABELS = {
    DRAFT: 'Черновик',
    IN_REVIEW: 'Проверка',
    APPROVED: 'Одобрено',
    PUBLISHED: 'Опубликовано',
  };

  const CONSOLE_URL = 'https://games.yandex.ru/console/application/';
  const GIST_API = 'https://api.github.com/gists/';
  const GIST_FILENAME = 'ygap_dashboard_data.json';
  const AUTO_REFRESH_INTERVAL = 30000; // 30 seconds

  const DEMO_DATA = {
    games: {
      'crystal-clicker': {
        appId: '540396',
        title: 'Кристальный Кликер',
        version: '1.0.0',
        status: 'DRAFT',
        lastCheck: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        previousStatus: null,
        rejectionReason: null,
      },
      'space-runner': {
        appId: '540397',
        title: 'Space Runner',
        version: '2.3.1',
        status: 'IN_REVIEW',
        lastCheck: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
        previousStatus: 'DRAFT',
        rejectionReason: null,
      },
      'neon-blocks': {
        appId: '540398',
        title: 'Neon Blocks',
        version: '1.4.0',
        status: 'PUBLISHED',
        lastCheck: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        previousStatus: 'APPROVED',
        rejectionReason: null,
      },
      'pixel-quest': {
        appId: '540399',
        title: 'Pixel Quest',
        version: '0.9.2',
        status: 'REJECTED',
        lastCheck: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
        previousStatus: 'IN_REVIEW',
        rejectionReason: 'Игра содержит запрещённый контент в описании. Пожалуйста, исправьте и отправьте повторно.',
      },
      'bubble-world': {
        appId: '540400',
        title: 'Bubble World',
        version: '3.1.0',
        status: 'APPROVED',
        lastCheck: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
        previousStatus: 'IN_REVIEW',
        rejectionReason: null,
      },
    },
    lastFullCheck: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  };

  // ─── State ────────────────────────────────────────────────
  let currentData = null;
  let activeFilter = null;
  let expandedCardId = null;
  let autoRefreshTimer = null;
  let isLoading = false;
  let isAutoRefreshing = false;

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

  function hapticLight() {
    try {
      Telegram.WebApp?.HapticFeedback?.impactOccurred?.('light');
    } catch (_) { /* ignore */ }
  }

  // ─── Pipeline Progress Bar ─────────────────────────────────
  function renderPipeline(game) {
    const status = game.status || 'UNKNOWN';
    const isRejected = status === 'REJECTED';
    // For rejected, the stage they were at is previousStatus or DRAFT
    const rejectedAtStage = isRejected ? (game.previousStatus || 'DRAFT') : null;
    const currentStageIndex = PIPELINE_STAGES.indexOf(isRejected ? rejectedAtStage : status);

    let stagesHtml = '';
    PIPELINE_STAGES.forEach((stage, i) => {
      const cfg = getStatusConfig(stage);
      const isCompleted = !isRejected && i < currentStageIndex;
      const isCurrent = !isRejected && i === currentStageIndex;
      const isRejectedAt = isRejected && i === currentStageIndex;
      const isFuture = i > currentStageIndex;
      const isBeforeRejected = isRejected && i < currentStageIndex;

      let dotClass = 'pipeline__dot';
      let dotContent = '';
      if (isCompleted || isBeforeRejected) {
        dotClass += ' pipeline__dot--completed';
        dotContent = '●';
      } else if (isCurrent) {
        dotClass += ' pipeline__dot--current';
        dotContent = '●';
      } else if (isRejectedAt) {
        dotClass += ' pipeline__dot--rejected';
        dotContent = '✕';
      } else {
        dotClass += ' pipeline__dot--future';
        dotContent = '○';
      }

      // Line before dot (not for first)
      if (i > 0) {
        let lineClass = 'pipeline__line';
        if (i <= currentStageIndex && !isRejected) {
          lineClass += ' pipeline__line--completed';
        } else if (isRejected && i <= currentStageIndex) {
          lineClass += i === currentStageIndex ? ' pipeline__line--rejected' : ' pipeline__line--completed';
        }
        stagesHtml += `<span class="${lineClass}"></span>`;
      }

      const stageColor = (isCompleted || isCurrent || isBeforeRejected)
        ? cfg.color
        : isRejectedAt
          ? '#dc3545'
          : '';

      stagesHtml += `
        <span class="pipeline__stage">
          <span class="${dotClass}" style="${stageColor ? `color: ${stageColor}` : ''}">
            ${dotContent}
          </span>
          <span class="pipeline__label">${PIPELINE_LABELS[stage]}</span>
        </span>
      `;
    });

    return `<div class="pipeline">${stagesHtml}</div>`;
  }

  // ─── Quick Links ──────────────────────────────────────────
  function renderQuickLinks(game) {
    if (!game.appId) return '';
    const base = `${CONSOLE_URL}${game.appId}`;
    return `
      <div class="quick-links">
        <a class="quick-link" href="${base}#application-analytics" target="_blank" rel="noopener noreferrer">
          <span class="quick-link__icon">📊</span>
          <span class="quick-link__text">Метрики</span>
        </a>
        <a class="quick-link" href="${base}#application-reviews" target="_blank" rel="noopener noreferrer">
          <span class="quick-link__icon">💬</span>
          <span class="quick-link__text">Отзывы</span>
        </a>
        <a class="quick-link" href="${base}#application-info-draft" target="_blank" rel="noopener noreferrer">
          <span class="quick-link__icon">📝</span>
          <span class="quick-link__text">Черновик</span>
        </a>
      </div>
    `;
  }

  // ─── Rejection Reason Box ─────────────────────────────────
  function renderRejectionReason(game) {
    if (game.status !== 'REJECTED' || !game.rejectionReason) return '';
    return `
      <div class="rejection-box">
        <span class="rejection-box__icon">⚠️</span>
        <div class="rejection-box__content">
          <div class="rejection-box__title">Причина отклонения</div>
          <div class="rejection-box__text">${escapeHtml(game.rejectionReason)}</div>
        </div>
      </div>
    `;
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

  // ─── Card expand / collapse ───────────────────────────────
  function handleCardClick(e) {
    // Don't toggle if clicking a link or button
    if (e.target.closest('a, button')) return;

    const card = e.target.closest('.game-card');
    if (!card) return;

    const cardId = card.dataset.cardId;
    hapticLight();

    if (expandedCardId === cardId) {
      // Collapse current
      expandedCardId = null;
      card.classList.remove('game-card--expanded');
    } else {
      // Collapse previously expanded
      const prev = gamesContainer.querySelector('.game-card--expanded');
      if (prev) prev.classList.remove('game-card--expanded');

      // Expand new
      expandedCardId = cardId;
      card.classList.add('game-card--expanded');
    }
  }

  // ─── Render game cards ───────────────────────────────────
  function renderGames(data) {
    const games = data?.games;
    if (!games || Object.keys(games).length === 0) {
      showEmpty();
      return;
    }

    currentData = data;
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
      const prevCfg = (game.previousStatus && game.previousStatus !== game.status) ? getStatusConfig(game.previousStatus) : null;
      const consoleLink = game.appId ? `${CONSOLE_URL}${game.appId}` : '#';
      const cardId = game.appId || dirName;
      const isExpanded = expandedCardId === cardId;
      const isHidden = activeFilter && game.status !== activeFilter;

      html += `
        <article
          class="game-card ${cssClass} ${isExpanded ? 'game-card--expanded' : ''} ${isHidden ? 'game-card--hidden' : ''}"
          style="--card-status-color: ${cfg.color}; animation-delay: ${index * 0.08}s"
          data-index="${index}"
          data-card-id="${cardId}"
          data-status="${game.status}"
        >
          <div class="game-card__top">
            <div class="game-card__info">
              <div class="game-card__title">
                ${game.iconUrl 
                  ? `<img class="game-card__icon" src="${escapeHtml(game.iconUrl)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'">`
                  : ''}
                <span class="game-card__title-emoji" ${game.iconUrl ? 'style="display:none"' : ''}>${cfg.emoji}</span>
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

          <div class="game-card__expand-indicator">
            <span class="game-card__chevron"></span>
          </div>

          <div class="game-card__expandable">
            <div class="game-card__expandable-inner">
              ${renderRejectionReason(game)}
              ${renderQuickLinks(game)}
              ${renderPipeline(game)}
            </div>
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

  // ─── Status filter ────────────────────────────────────────
  function setFilter(status) {
    if (activeFilter === status) {
      // Deselect
      activeFilter = null;
    } else {
      activeFilter = status;
    }
    applyFilter();
    // Re-render stats to update chip highlights
    if (currentData) renderStats(currentData);
  }

  function clearFilter() {
    activeFilter = null;
    applyFilter();
    if (currentData) renderStats(currentData);
  }

  function applyFilter() {
    const cards = gamesContainer.querySelectorAll('.game-card');
    cards.forEach((card) => {
      const cardStatus = card.dataset.status;
      if (activeFilter && cardStatus !== activeFilter) {
        card.classList.add('game-card--hidden');
      } else {
        card.classList.remove('game-card--hidden');
      }
    });
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

    // "All" chip — only shown when a filter is active
    if (activeFilter) {
      chipsHtml += `
        <span class="stats-chip stats-chip--all" data-filter-action="clear">
          <span class="stats-chip__count">${total}</span>
          Все
        </span>
      `;
    }

    const order = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED'];
    order.forEach((status) => {
      if (counts[status]) {
        const cfg = getStatusConfig(status);
        const isActive = activeFilter === status;
        chipsHtml += `
          <span class="stats-chip ${isActive ? 'stats-chip--active' : ''}" data-filter-status="${status}">
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
      const isActive = activeFilter === 'UNKNOWN';
      chipsHtml += `
        <span class="stats-chip ${isActive ? 'stats-chip--active' : ''}" data-filter-status="UNKNOWN">
          <span class="stats-chip__dot" style="background: ${cfg.color}"></span>
          <span class="stats-chip__count">${counts.UNKNOWN}</span>
          ${cfg.label}
        </span>
      `;
    }

    const updateTimeStr = formatTime(data.lastFullCheck);

    statsBar.innerHTML = `
      <div class="stats-bar__chips">${chipsHtml}</div>
      <div class="stats-bar__footer">
        <span class="stats-bar__total">Всего: ${total} ${pluralize(total, 'игра', 'игры', 'игр')}</span>
        <span class="stats-bar__time">
          <span class="stats-bar__time-dot"></span>
          Обновлено: ${updateTimeStr}
        </span>
      </div>
    `;

    // Animate in
    requestAnimationFrame(() => {
      statsBar.classList.add('visible');
    });
  }

  // ─── Stats chip click handler (event delegation) ──────────
  function handleStatsClick(e) {
    const chip = e.target.closest('.stats-chip');
    if (!chip) return;

    hapticLight();

    if (chip.dataset.filterAction === 'clear') {
      clearFilter();
      return;
    }

    const status = chip.dataset.filterStatus;
    if (status) {
      setFilter(status);
    }
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

  // ─── Auto-refresh indicator (subtle pulsing dot) ─────────
  function showAutoRefreshDot() {
    if (document.getElementById('auto-refresh-dot')) return;
    const dot = document.createElement('span');
    dot.className = 'auto-refresh-dot';
    dot.id = 'auto-refresh-dot';
    const headerContent = document.querySelector('.header__content');
    if (headerContent) headerContent.appendChild(dot);
  }

  function hideAutoRefreshDot() {
    const dot = document.getElementById('auto-refresh-dot');
    if (dot) dot.remove();
  }

  // ─── Fetch & render ──────────────────────────────────────
  async function fetchAndRender(silent = false) {
    if (isLoading) return;
    isLoading = true;

    if (!silent) {
      showRefreshIndicator();
      showSkeleton();
      statsBar.classList.remove('visible');
    } else {
      isAutoRefreshing = true;
      showAutoRefreshDot();
    }

    const params = new URLSearchParams(window.location.search);
    const gistId = params.get('gist') || '89ea20278297942db9f7ccf901a8d9d1';

    if (!gistId) {
      // Show demo data
      await sleep(600); // Simulate loading for smooth UX
      hideRefreshIndicator();
      hideAutoRefreshDot();
      showDemoBanner();
      renderGames(DEMO_DATA);
      isLoading = false;
      isAutoRefreshing = false;
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
      hideAutoRefreshDot();
      renderGames(data);
    } catch (err) {
      console.error('[YGAP] Fetch error:', err);
      hideRefreshIndicator();
      hideAutoRefreshDot();
      if (!silent) {
        showError(
          'Не удалось загрузить данные',
          err.message || 'Проверьте ID гиста и попробуйте снова'
        );
      }
    } finally {
      isLoading = false;
      isAutoRefreshing = false;
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

  // ─── Card click handler (event delegation) ────────────────
  function initCardClickHandler() {
    gamesContainer.addEventListener('click', handleCardClick);
  }

  // ─── Stats bar click handler ──────────────────────────────
  function initStatsClickHandler() {
    statsBar.addEventListener('click', handleStatsClick);
  }

  // ─── Auto-refresh ─────────────────────────────────────────
  function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshTimer = setInterval(() => {
      if (!document.hidden) {
        fetchAndRender(true); // silent refresh
      }
    }, AUTO_REFRESH_INTERVAL);
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      stopAutoRefresh();
    } else {
      startAutoRefresh();
      // Immediate silent refresh when coming back
      fetchAndRender(true);
    }
  }

  // ─── Retry global function ────────────────────────────────
  window.__ygapRetry = fetchAndRender;

  // ─── Init ─────────────────────────────────────────────────
  function init() {
    initTelegram();
    initCardHoverEffect();
    initCardClickHandler();
    initStatsClickHandler();
    fetchAndRender();
    startAutoRefresh();
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  // DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
