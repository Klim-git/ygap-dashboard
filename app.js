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
  const BOT_USERNAME = 'YGAPMonitorBot';

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
        statusChangedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 - 3 * 60 * 60 * 1000).toISOString(),
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
    events: [
      {
        timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        appId: '540397',
        title: 'Space Runner',
        from: 'DRAFT',
        to: 'IN_REVIEW',
        iconUrl: null,
      },
      {
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        appId: '540398',
        title: 'Neon Blocks',
        from: 'APPROVED',
        to: 'PUBLISHED',
        iconUrl: null,
      },
      {
        timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        appId: '540399',
        title: 'Pixel Quest',
        from: 'IN_REVIEW',
        to: 'REJECTED',
        iconUrl: null,
      },
    ],
    lastFullCheck: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  };

  // ─── State ────────────────────────────────────────────────
  let currentData = null;
  let activeFilter = null;
  let expandedCardId = null;
  let autoRefreshTimer = null;
  let waitTimerInterval = null;
  let isLoading = false;
  let isAutoRefreshing = false;
  let activeTab = 'games';

  // ─── DOM references ──────────────────────────────────────
  const gamesContainer = document.getElementById('games-container');
  const statsBar = document.getElementById('stats-bar');
  const appEl = document.getElementById('app');

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

  function relativeTimeDetailed(isoString) {
    if (!isoString) return '—';
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'только что';
    if (mins < 60) return `${mins} мин назад`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ч назад`;
    // For events — show "Вчера 14:30" or date
    const d = new Date(isoString);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const timeStr = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === yesterday.toDateString()) {
      return `Вчера ${timeStr}`;
    }
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' ' + timeStr;
  }

  function formatWaitDuration(isoString) {
    if (!isoString) return null;
    const diff = Date.now() - new Date(isoString).getTime();
    if (diff < 0) return null;
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins} мин`;
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    if (hours < 24) {
      return remainMins > 0 ? `${hours} ч ${remainMins} мин` : `${hours} ч`;
    }
    const days = Math.floor(hours / 24);
    const remainHours = hours % 24;
    return remainHours > 0 ? `${days} дн ${remainHours} ч` : `${days} дн`;
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

  function hapticSelection() {
    try {
      Telegram.WebApp?.HapticFeedback?.selectionChanged?.();
    } catch (_) { /* ignore */ }
  }

  function getDateGroupLabel(date) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.floor((today - d) / (24 * 60 * 60 * 1000));
    if (diffDays === 0) return 'Сегодня';
    if (diffDays === 1) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }

  // ─── Page Navigation / Tab Bar ─────────────────────────────
  function createPageContainers() {
    // Wrap existing games container and stats bar into a page
    const pageGames = document.createElement('div');
    pageGames.id = 'page-games';
    pageGames.className = 'page page--active';

    // Move gamesContainer into page-games
    gamesContainer.parentNode.insertBefore(pageGames, gamesContainer);
    pageGames.appendChild(gamesContainer);

    // Create events page
    const pageEvents = document.createElement('div');
    pageEvents.id = 'page-events';
    pageEvents.className = 'page';
    pageEvents.innerHTML = '<div class="events-page" id="events-content"></div>';
    appEl.appendChild(pageEvents);

    // Create settings page
    const pageSettings = document.createElement('div');
    pageSettings.id = 'page-settings';
    pageSettings.className = 'page';
    pageSettings.innerHTML = '<div class="settings-page" id="settings-content"></div>';
    appEl.appendChild(pageSettings);
  }

  function createTabBar() {
    const tabBar = document.createElement('nav');
    tabBar.className = 'tab-bar';
    tabBar.id = 'tab-bar';
    tabBar.innerHTML = `
      <div class="tab-bar__item tab-bar__item--active" data-tab="games">
        <span class="tab-bar__icon">🎮</span>
        <span class="tab-bar__label">Игры</span>
      </div>
      <div class="tab-bar__item" data-tab="events">
        <span class="tab-bar__icon">📜</span>
        <span class="tab-bar__label">События</span>
      </div>
      <div class="tab-bar__item" data-tab="settings">
        <span class="tab-bar__icon">⚙️</span>
        <span class="tab-bar__label">Настройки</span>
      </div>
    `;
    document.body.appendChild(tabBar);

    tabBar.addEventListener('click', (e) => {
      const item = e.target.closest('.tab-bar__item');
      if (!item) return;
      const tab = item.dataset.tab;
      if (tab && tab !== activeTab) {
        switchTab(tab);
      }
    });
  }

  function switchTab(tab) {
    hapticSelection();
    activeTab = tab;

    // Update tab bar active state
    const tabItems = document.querySelectorAll('.tab-bar__item');
    tabItems.forEach((item) => {
      if (item.dataset.tab === tab) {
        item.classList.add('tab-bar__item--active');
      } else {
        item.classList.remove('tab-bar__item--active');
      }
    });

    // Update pages
    const pages = document.querySelectorAll('.page');
    pages.forEach((page) => {
      page.classList.remove('page--active');
    });
    const activePage = document.getElementById(`page-${tab}`);
    if (activePage) {
      activePage.classList.add('page--active');
    }

    // Stats bar visibility — only on games page
    if (tab === 'games') {
      if (currentData) statsBar.classList.add('visible');
    } else {
      statsBar.classList.remove('visible');
    }

    // Render page content on demand
    if (tab === 'events' && currentData) {
      renderEvents(currentData);
    }
    if (tab === 'settings' && currentData) {
      renderSettings(currentData);
    }
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

  // ─── Wait Timer for IN_REVIEW ─────────────────────────────
  function renderWaitTimer(game) {
    if (game.status !== 'IN_REVIEW' || !game.statusChangedAt) return '';
    const duration = formatWaitDuration(game.statusChangedAt);
    if (!duration) return '';
    return `
      <div class="game-card__wait-timer" data-status-changed="${escapeHtml(game.statusChangedAt)}">
        <span class="game-card__wait-timer-icon">⏱</span>
        <span class="game-card__meta-value">На модерации: ${duration}</span>
      </div>
    `;
  }

  function updateWaitTimers() {
    const timers = document.querySelectorAll('.game-card__wait-timer');
    timers.forEach((timer) => {
      const changedAt = timer.dataset.statusChanged;
      if (!changedAt) return;
      const duration = formatWaitDuration(changedAt);
      if (duration) {
        const valueEl = timer.querySelector('.game-card__meta-value');
        if (valueEl) valueEl.textContent = `На модерации: ${duration}`;
      }
    });
  }

  function startWaitTimerUpdates() {
    stopWaitTimerUpdates();
    waitTimerInterval = setInterval(updateWaitTimers, 60000);
  }

  function stopWaitTimerUpdates() {
    if (waitTimerInterval) {
      clearInterval(waitTimerInterval);
      waitTimerInterval = null;
    }
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
            ${renderWaitTimer(game)}
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

    // Start wait timer updates
    startWaitTimerUpdates();
  }

  // ─── Events Page ──────────────────────────────────────────
  function renderEvents(data) {
    const container = document.getElementById('events-content');
    if (!container) return;

    const events = data?.events;
    if (!events || events.length === 0) {
      container.innerHTML = `
        <div class="events-empty">
          <div class="events-empty__icon">🕐</div>
          <div class="events-empty__text">Пока нет событий</div>
        </div>
      `;
      return;
    }

    // Sort by timestamp descending, limit to 50
    const sorted = [...events]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 50);

    // Group by date
    const groups = {};
    sorted.forEach((evt) => {
      const d = new Date(evt.timestamp);
      const dateKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!groups[dateKey]) {
        groups[dateKey] = { date: d, events: [] };
      }
      groups[dateKey].events.push(evt);
    });

    let html = '';
    Object.values(groups).forEach((group) => {
      const label = getDateGroupLabel(group.date);
      html += `<div class="events-date-group">`;
      html += `<div class="events-date-label">${escapeHtml(label)}</div>`;
      html += `<div class="event-timeline">`;

      group.events.forEach((evt) => {
        const toCfg = getStatusConfig(evt.to);
        const fromCfg = getStatusConfig(evt.from);
        const timeStr = relativeTimeDetailed(evt.timestamp);
        const iconHtml = evt.iconUrl
          ? `<img class="event-card__game-icon" src="${escapeHtml(evt.iconUrl)}" alt="" onerror="this.style.display='none'">`
          : '';

        html += `
          <div class="event-item">
            <div class="event-dot" style="background: ${toCfg.color}"></div>
            <div class="event-card">
              <div class="event-card__header">
                ${iconHtml}
                <span class="event-card__game-title">${escapeHtml(evt.title || evt.appId)}</span>
                <span class="event-card__time">${escapeHtml(timeStr)}</span>
              </div>
              <div class="event-card__status-change">
                <span class="event-badge" style="background: ${fromCfg.color}">${fromCfg.emoji} ${escapeHtml(evt.from)}</span>
                <span class="event-arrow">→</span>
                <span class="event-badge" style="background: ${toCfg.color}">${toCfg.emoji} ${escapeHtml(evt.to)}</span>
              </div>
            </div>
          </div>
        `;
      });

      html += `</div></div>`;
    });

    container.innerHTML = html;
  }

  // ─── Settings Page ────────────────────────────────────────
  function renderSettings(data) {
    const container = document.getElementById('settings-content');
    if (!container) return;

    const games = data?.games || {};
    const entries = Object.entries(games);
    const totalGames = entries.length;

    // Section 1: My Games
    let gamesListHtml = '';
    entries.forEach(([dirName, game]) => {
      const cfg = getStatusConfig(game.status);
      const iconHtml = game.iconUrl
        ? `<img class="settings-game-row__icon" src="${escapeHtml(game.iconUrl)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : '';
      const emojiStyle = game.iconUrl ? 'style="display:none"' : '';

      gamesListHtml += `
        <div class="settings-game-row">
          ${iconHtml}
          <span class="settings-game-row__icon-emoji" ${emojiStyle}>${cfg.emoji}</span>
          <div class="settings-game-row__info">
            <div class="settings-game-row__title">${escapeHtml(game.title || dirName)}</div>
            <div class="settings-game-row__appid">ID: ${escapeHtml(game.appId || '—')}</div>
          </div>
          <button class="settings-game-row__delete" data-appid="${escapeHtml(game.appId || '')}" title="Удалить">🗑️</button>
        </div>
      `;
    });

    if (entries.length === 0) {
      gamesListHtml = `
        <div style="text-align:center; color: var(--tg-hint); padding: 16px; font-size: 0.85rem;">
          Нет отслеживаемых игр
        </div>
      `;
    }

    // Format last check time
    const lastCheckStr = data.lastFullCheck
      ? new Date(data.lastFullCheck).toLocaleString('ru-RU', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        })
      : '—';

    container.innerHTML = `
      <!-- My Games Section -->
      <div class="settings-section">
        <div class="settings-section__title">
          <span class="settings-section__title-icon">🎮</span>
          Мои игры
        </div>
        <div class="settings-game-list">
          ${gamesListHtml}
        </div>
      </div>

      <!-- Add Game Section -->
      <div class="settings-section">
        <div class="settings-section__title">
          <span class="settings-section__title-icon">➕</span>
          Добавить игру
        </div>
        <div class="settings-add-form">
          <input
            type="text"
            id="settings-add-input"
            class="settings-add-form__input"
            placeholder="App ID"
            inputmode="numeric"
            pattern="[0-9]*"
            autocomplete="off"
          >
          <button class="settings-add-form__button" id="settings-add-btn">Добавить</button>
        </div>
        <div class="settings-add-form__hint">Введите ID игры из консоли Яндекс Игр</div>
      </div>

      <!-- Info Section -->
      <div class="settings-section">
        <div class="settings-section__title">
          <span class="settings-section__title-icon">ℹ️</span>
          Информация
        </div>
        <div class="settings-info-list">
          <div class="settings-info-row">
            <span class="settings-info-row__label">Версия бота</span>
            <span class="settings-info-row__value">v1.0.0</span>
          </div>
          <div class="settings-info-row">
            <span class="settings-info-row__label">Игр отслеживается</span>
            <span class="settings-info-row__value">${totalGames}</span>
          </div>
          <div class="settings-info-row">
            <span class="settings-info-row__label">Последняя проверка</span>
            <span class="settings-info-row__value">${escapeHtml(lastCheckStr)}</span>
          </div>
          <div class="settings-info-row">
            <span class="settings-info-row__label">GitHub</span>
            <span class="settings-info-row__value"><a href="https://github.com" target="_blank" rel="noopener noreferrer">Репозиторий ↗</a></span>
          </div>
        </div>
      </div>
    `;

    // Attach event listeners
    initSettingsHandlers();
  }

  function initSettingsHandlers() {
    // Delete buttons
    const deleteButtons = document.querySelectorAll('.settings-game-row__delete');
    deleteButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const appId = btn.dataset.appid;
        if (!appId) return;

        hapticLight();
        const gameName = btn.closest('.settings-game-row')?.querySelector('.settings-game-row__title')?.textContent || appId;
        const confirmed = confirm(`Удалить «${gameName}» (ID: ${appId}) из отслеживания?`);
        if (!confirmed) return;

        openBotCommand(`/remove ${appId}`);
      });
    });

    // Add game button
    const addBtn = document.getElementById('settings-add-btn');
    const addInput = document.getElementById('settings-add-input');
    if (addBtn && addInput) {
      addBtn.addEventListener('click', () => {
        const appId = addInput.value.trim();
        if (!appId || !/^\d+$/.test(appId)) {
          addInput.focus();
          return;
        }
        hapticLight();
        openBotCommand(`/add ${appId}`);
        addInput.value = '';
      });

      addInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          addBtn.click();
        }
      });
    }
  }

  function openBotCommand(command) {
    // Format: /add 123456 → text=/add+123456
    const encoded = encodeURIComponent(command);
    const url = `https://t.me/${BOT_USERNAME}?text=${encoded}`;
    try {
      if (tg && tg.openTelegramLink) {
        tg.openTelegramLink(url);
      } else {
        window.open(url, '_blank');
      }
    } catch (_) {
      window.open(url, '_blank');
    }
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

    // Only show on games tab
    if (activeTab === 'games') {
      requestAnimationFrame(() => {
        statsBar.classList.add('visible');
      });
    }
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
      currentData = data;
      hideRefreshIndicator();
      hideAutoRefreshDot();
      renderGames(data);

      // If currently on events/settings, re-render those too
      if (activeTab === 'events') renderEvents(data);
      if (activeTab === 'settings') renderSettings(data);
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
      stopWaitTimerUpdates();
    } else {
      startAutoRefresh();
      startWaitTimerUpdates();
      // Immediate silent refresh when coming back
      fetchAndRender(true);
    }
  }

  // ─── Retry global function ────────────────────────────────
  window.__ygapRetry = fetchAndRender;

  // ─── Init ─────────────────────────────────────────────────
  function init() {
    initTelegram();
    createPageContainers();
    createTabBar();
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
