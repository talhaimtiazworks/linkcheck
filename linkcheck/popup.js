// LinkCheck — Popup Controller
// Production-quality link scanner for Chrome Manifest V3

(function () {
  'use strict';

  // ============================
  // STATE
  // ============================
  const state = {
    isScanning: false,
    cancelled: false,
    currentTab: null,
    links: [],           // { url, anchorText, isInternal, sourceLocation, index }
    results: [],         // { url, anchorText, isInternal, sourceLocation, status, code, label }
    progress: { checked: 0, total: 0, working: 0, broken: 0, redirect: 0, timeout: 0, unknown: 0 },
    settings: {
      maxLinks: 500,
      timeout: 10000,
      includeExternal: true,
      includeInternal: true,
      compactMode: false,
      rememberLatest: true
    },
    filter: 'all',
    searchQuery: '',
    sortBy: 'status', // status, url, anchor, code
    ignoredCount: 0
  };

  // ============================
  // DOM REFERENCES
  // ============================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const els = {
    // States
    unsupportedState: $('#unsupportedState'),
    readyState: $('#readyState'),
    scanningState: $('#scanningState'),
    resultsState: $('#resultsState'),

    // Header / Brand
    settingsBtn: $('#settingsBtn'),

    // Ready
    domainName: $('#domainName'),
    startScanBtn: $('#startScanBtn'),

    // Scanning
    progressPercent: $('#progressPercent'),
    progressBar: $('#progressBar'),
    progressCount: $('#progressCount'),
    currentUrl: $('#currentUrl'),
    statWorking: $('#statWorking'),
    statBroken: $('#statBroken'),
    statRedirect: $('#statRedirect'),
    statChecking: $('#statChecking'),
    cancelScanBtn: $('#cancelScanBtn'),

    // Results — Summary
    summaryDomain: $('#summaryDomain'),
    healthScore: $('#healthScore'),
    sumWorking: $('#sumWorking'),
    sumRedirect: $('#sumRedirect'),
    sumBroken: $('#sumBroken'),
    sumUnknown: $('#sumUnknown'),
    totalLinks: $('#totalLinks'),
    uniqueLinks: $('#uniqueLinks'),

    // Results — Controls
    searchInput: $('#searchInput'),
    clearSearchBtn: $('#clearSearchBtn'),
    filterTabs: $$('.filter-tab'),
    resultsList: $('#resultsList'),
    noResults: $('#noResults'),
    sortSelect: $('#sortSelect'),

    // Results — Actions
    rescanBtn: $('#rescanBtn'),
    exportBtn: $('#exportBtn'),
    copySummaryBtn: $('#copySummaryBtn'),

    // Settings
    settingsPanel: $('#settingsPanel'),
    backFromSettings: $('#backFromSettings'),
    settingMaxLinks: $('#settingMaxLinks'),
    settingTimeout: $('#settingTimeout'),
    settingExternal: $('#settingExternal'),
    settingInternal: $('#settingInternal'),
    settingCompact: $('#settingCompact'),
    settingRemember: $('#settingRemember'),
    saveSettingsBtn: $('#saveSettingsBtn'),

    // History
    historyPanel: $('#historyPanel'),
    historyBtn: $('#historyBtn'),
    backFromHistory: $('#backFromHistory'),
    historyContent: $('#historyContent'),

    // Detail Modal
    detailModal: $('#detailModal'),
    closeDetailBtn: $('#closeDetailBtn'),
    detailUrl: $('#detailUrl'),
    detailAnchor: $('#detailAnchor'),
    detailType: $('#detailType'),
    detailStatus: $('#detailStatus'),
    detailCode: $('#detailCode'),
    detailLocation: $('#detailLocation'),
    openLinkBtn: $('#openLinkBtn'),
    copyDetailUrlBtn: $('#copyDetailUrlBtn'),

    // Toast
    toast: $('#toast'),

    // Limit warning
    limitWarning: $('#limitWarning'),
    ignoredBadge: $('#ignoredBadge')
  };

  // ============================
  // INITIALIZATION
  // ============================
  document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();
    await detectTab();
    setupEventListeners();
    applyCompactMode();
  });

  function setupEventListeners() {
    // Scan controls
    els.startScanBtn.addEventListener('click', startScan);
    els.cancelScanBtn.addEventListener('click', cancelScan);
    els.rescanBtn.addEventListener('click', startScan);

    // Search & Filter
    els.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim().toLowerCase();
      els.clearSearchBtn.classList.toggle('hidden', !state.searchQuery);
      renderResults();
    });
    els.clearSearchBtn.addEventListener('click', () => {
      els.searchInput.value = '';
      state.searchQuery = '';
      els.clearSearchBtn.classList.add('hidden');
      renderResults();
    });
    els.filterTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        els.filterTabs.forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        state.filter = tab.dataset.filter;
        renderResults();
      });
    });
    els.sortSelect.addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      renderResults();
    });

    // Export
    els.exportBtn.addEventListener('click', exportCSV);
    els.copySummaryBtn.addEventListener('click', copySummary);

    // Settings
    els.settingsBtn.addEventListener('click', openSettings);
    els.backFromSettings.addEventListener('click', closeSettings);
    els.saveSettingsBtn.addEventListener('click', saveSettings);

    // History
    els.historyBtn.addEventListener('click', openHistory);
    els.backFromHistory.addEventListener('click', closeHistory);

    // Modal
    els.closeDetailBtn.addEventListener('click', closeDetailModal);
    els.detailModal.addEventListener('click', (e) => {
      if (e.target === els.detailModal) closeDetailModal();
    });
    els.openLinkBtn.addEventListener('click', () => {
      const url = els.detailUrl.textContent;
      if (url) chrome.tabs.create({ url });
    });
    els.copyDetailUrlBtn.addEventListener('click', () => {
      const url = els.detailUrl.textContent;
      if (url) copyToClipboard(url);
    });

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!els.detailModal.classList.contains('hidden')) {
          closeDetailModal();
        } else if (!els.settingsPanel.classList.contains('hidden')) {
          closeSettings();
        } else if (!els.historyPanel.classList.contains('hidden')) {
          closeHistory();
        }
      }
    });
  }

  // ============================
  // TAB DETECTION
  // ============================
  async function detectTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) {
        showUnsupported();
        return;
      }
      const url = tab.url;
      const isUnsupported = (
        url.startsWith('chrome://') ||
        url.startsWith('edge://') ||
        url.startsWith('about:') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('moz-extension://') ||
        url.startsWith('file://')
      );
      if (isUnsupported) {
        showUnsupported();
        return;
      }
      state.currentTab = tab;
      const domain = new URL(url).hostname;
      els.domainName.textContent = domain;
      els.summaryDomain.textContent = domain;
      showState('ready');
    } catch (e) {
      showUnsupported();
    }
  }

  function showUnsupported() {
    showState('unsupported');
  }

  // ============================
  // SETTINGS
  // ============================
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['linkcheck_settings'], (res) => {
        if (res.linkcheck_settings) {
          Object.assign(state.settings, res.linkcheck_settings);
        }
        syncSettingsUI();
        resolve();
      });
    });
  }

  function syncSettingsUI() {
    els.settingMaxLinks.value = state.settings.maxLinks;
    els.settingTimeout.value = state.settings.timeout;
    els.settingExternal.checked = state.settings.includeExternal;
    els.settingInternal.checked = state.settings.includeInternal;
    els.settingCompact.checked = state.settings.compactMode;
    els.settingRemember.checked = state.settings.rememberLatest;
  }

  function saveSettings() {
    state.settings.maxLinks = parseInt(els.settingMaxLinks.value, 10) || 500;
    state.settings.timeout = parseInt(els.settingTimeout.value, 10) || 10000;
    state.settings.includeExternal = els.settingExternal.checked;
    state.settings.includeInternal = els.settingInternal.checked;
    state.settings.compactMode = els.settingCompact.checked;
    state.settings.rememberLatest = els.settingRemember.checked;

    chrome.storage.local.set({ linkcheck_settings: state.settings }, () => {
      applyCompactMode();
      closeSettings();
      showToast('Settings saved');
    });
  }

  function applyCompactMode() {
    document.body.classList.toggle('compact', state.settings.compactMode);
  }

  function openSettings() {
    els.settingsPanel.classList.remove('hidden');
  }
  function closeSettings() {
    els.settingsPanel.classList.add('hidden');
  }

  // ============================
  // HISTORY
  // ============================
  async function openHistory() {
    await loadHistory();
    els.historyPanel.classList.remove('hidden');
  }
  function closeHistory() {
    els.historyPanel.classList.add('hidden');
  }

  async function loadHistory() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['linkcheck_history'], (res) => {
        const history = res.linkcheck_history || null;
        if (!history) {
          els.historyContent.innerHTML = `
            <div class="empty-state small">
              <p>No scan history yet.</p>
            </div>
          `;
        } else {
          const date = new Date(history.timestamp);
          const timeStr = date.toLocaleString();
          els.historyContent.innerHTML = `
            <div class="history-card">
              <div class="history-domain">${escapeHtml(history.domain)}</div>
              <div class="history-meta">
                <span>${history.total} links</span>
                <span class="history-score">Score ${history.score}</span>
              </div>
              <div class="history-time">${timeStr}</div>
              <div class="history-breakdown">
                <span class="hb working">${history.working} Working</span>
                <span class="hb redirect">${history.redirect} Redirects</span>
                <span class="hb broken">${history.broken} Broken</span>
                <span class="hb unknown">${history.unknown} Unable</span>
              </div>
            </div>
          `;
        }
        resolve();
      });
    });
  }

  function saveHistory() {
    if (!state.settings.rememberLatest) return;
    const working = state.results.filter(r => r.status === 'working').length;
    const redirect = state.results.filter(r => r.status === 'redirect').length;
    const broken = state.results.filter(r => r.status === 'broken').length;
    const unknown = state.results.filter(r => r.status === 'unknown' || r.status === 'timeout').length;
    const score = calculateHealthScore();
    const domain = state.currentTab ? new URL(state.currentTab.url).hostname : 'unknown';

    const history = {
      domain,
      total: state.results.length,
      working,
      redirect,
      broken,
      unknown,
      score,
      timestamp: Date.now()
    };
    chrome.storage.local.set({ linkcheck_history: history, linkcheck_results: state.results });
  }

  // ============================
  // SCAN FLOW
  // ============================
  async function startScan() {
    if (!state.currentTab) return;
    resetScan();
    state.isScanning = true;
    state.cancelled = false;
    showState('scanning');

    try {
      // Extract links via content script messaging
      let extracted;
      try {
        extracted = await chrome.tabs.sendMessage(state.currentTab.id, {
          action: 'extractLinks',
          pageUrl: state.currentTab.url
        });
      } catch (err) {
        // Content script may not be loaded; fall back to injection
        const injection = await chrome.scripting.executeScript({
          target: { tabId: state.currentTab.id },
          func: (pageUrl) => {
            const anchors = Array.from(document.querySelectorAll('a[href]'));
            const base = new URL(pageUrl);
            const pageDomain = base.hostname;
            const links = [];
            let ignored = 0;
            anchors.forEach((a, index) => {
              const raw = a.getAttribute('href');
              if (!raw || !raw.trim()) { ignored++; return; }
              const href = raw.trim();
              if (href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('sms:')) { ignored++; return; }
              if (href.startsWith('#')) { ignored++; return; }
              if (href.startsWith('data:')) { ignored++; return; }
              let url;
              try { url = new URL(href, pageUrl).href; } catch (e) { ignored++; return; }
              const urlObj = new URL(url);
              if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') { ignored++; return; }
              const isInternal = urlObj.hostname === pageDomain || urlObj.hostname.endsWith('.' + pageDomain);
              const anchorText = (a.innerText || a.textContent || a.getAttribute('title') || '').trim();
              let sourceLocation = 'Other';
              let el = a;
              while (el && el.tagName !== 'BODY') {
                const tag = el.tagName.toLowerCase();
                if (tag === 'nav') { sourceLocation = 'Navigation'; break; }
                if (tag === 'footer') { sourceLocation = 'Footer'; break; }
                if (tag === 'header') { sourceLocation = 'Header'; break; }
                if (tag === 'main' || tag === 'article') { sourceLocation = 'Main Content'; break; }
                if (tag === 'aside') { sourceLocation = 'Sidebar'; break; }
                el = el.parentElement;
              }
              links.push({ url, anchorText, isInternal, sourceLocation, index });
            });
            return { links, ignored };
          },
          args: [state.currentTab.url]
        });
        extracted = injection[0]?.result || { links: [], ignored: 0 };
      }
      state.ignoredCount = extracted.ignored || 0;
      processExtracted(extracted.links || []);

      if (state.links.length === 0) {
        finishScan(true);
        return;
      }

      await checkLinks();
      if (!state.cancelled) finishScan(false);
    } catch (err) {
      console.error('Scan error:', err);
      state.isScanning = false;
      showToast('Scan failed. Please try again.');
      showState('ready');
    }
  }

  function cancelScan() {
    state.cancelled = true;
    state.isScanning = false;
    showState('ready');
    showToast('Scan cancelled');
  }

  function resetScan() {
    state.links = [];
    state.results = [];
    state.progress = { checked: 0, total: 0, working: 0, broken: 0, redirect: 0, timeout: 0, unknown: 0 };
    state.ignoredCount = 0;
    state.filter = 'all';
    state.searchQuery = '';
    els.searchInput.value = '';
    els.clearSearchBtn.classList.add('hidden');
    els.filterTabs.forEach(t => {
      t.classList.toggle('active', t.dataset.filter === 'all');
      t.setAttribute('aria-selected', t.dataset.filter === 'all');
    });
    els.limitWarning.classList.add('hidden');
    els.ignoredBadge.classList.add('hidden');
    updateProgressUI();
  }

  // ============================
  // PROCESS EXTRACTED
  // ============================
  function processExtracted(rawLinks) {
    // Deduplicate by URL
    const seen = new Map();
    rawLinks.forEach(link => {
      if (!seen.has(link.url)) {
        seen.set(link.url, link);
      }
    });
    let unique = Array.from(seen.values());

    // Filter by settings
    unique = unique.filter(l => {
      if (l.isInternal && !state.settings.includeInternal) return false;
      if (!l.isInternal && !state.settings.includeExternal) return false;
      return true;
    });

    // Limit
    let limited = false;
    if (unique.length > state.settings.maxLinks) {
      unique = unique.slice(0, state.settings.maxLinks);
      limited = true;
    }

    state.links = unique;
    state.results = unique.map(l => ({
      ...l,
      status: 'pending',
      code: null,
      label: 'Checking...'
    }));
    state.progress.total = unique.length;

    if (limited) {
      els.limitWarning.classList.remove('hidden');
      els.limitWarning.querySelector('span').textContent =
        `This page contains many links. Only the first ${state.settings.maxLinks} unique HTTP links are checked.`;
    }
    if (state.ignoredCount > 0) {
      els.ignoredBadge.classList.remove('hidden');
      els.ignoredBadge.textContent = `${state.ignoredCount} non-HTTP links ignored`;
    }
  }

  // ============================
  // LINK CHECKING
  // ============================
  async function checkLinks() {
    const concurrency = 5;
    const queue = state.links.map(l => l.url);
    let active = 0;
    let index = 0;

    return new Promise((resolve) => {
      const workers = [];
      const workerCount = Math.min(concurrency, queue.length || 1);

      const runWorker = async () => {
        while (index < queue.length && !state.cancelled) {
          const url = queue[index++];
          active++;
          updateCheckingCount(active);

          try {
            await checkSingleLink(url);
          } catch (e) {
            // Individual errors handled inside checkSingleLink
          }

          active--;
          state.progress.checked++;
          updateProgressUI();
          updateCheckingCount(active);
        }
        if (active === 0) resolve();
      };

      for (let i = 0; i < workerCount; i++) {
        workers.push(runWorker());
      }
      if (queue.length === 0) resolve();
    });
  }

  async function checkSingleLink(url) {
    if (state.cancelled) return;

    const result = state.results.find(r => r.url === url);
    if (!result) return;

    els.currentUrl.textContent = truncateUrl(url, 50);

    const timeoutMs = state.settings.timeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const doFetch = async (method) => {
      const res = await fetch(url, {
        method,
        signal: controller.signal,
        redirect: 'manual',
        cache: 'no-store'
      });
      // If HEAD is not allowed, retry with GET
      if (method === 'HEAD' && (res.status === 405 || res.status === 501)) {
        throw new Error('HEAD not allowed');
      }
      return res;
    };

    try {
      let response;
      try {
        response = await doFetch('HEAD');
      } catch (firstErr) {
        if (firstErr.message === 'HEAD not allowed') {
          response = await doFetch('GET');
        } else {
          throw firstErr;
        }
      }

      clearTimeout(timeoutId);

      // Opaque redirect (cross-origin manual redirect)
      if (response.type === 'opaqueredirect') {
        result.status = 'redirect';
        result.code = 0;
        result.label = 'Redirect';
        state.progress.redirect++;
        return;
      }

      const code = response.status;
      result.code = code;

      if (code >= 200 && code < 300) {
        result.status = 'working';
        result.label = `${code} ${response.statusText || 'OK'}`;
        state.progress.working++;
      } else if (code >= 300 && code < 400) {
        result.status = 'redirect';
        result.label = `${code} ${response.statusText || 'Redirect'}`;
        state.progress.redirect++;
      } else if (code >= 400 && code < 500) {
        result.status = 'broken';
        result.label = `${code} ${response.statusText || 'Client Error'}`;
        state.progress.broken++;
      } else if (code >= 500) {
        result.status = 'broken';
        result.label = `${code} ${response.statusText || 'Server Error'}`;
        state.progress.broken++;
      } else {
        result.status = 'unknown';
        result.label = `${code} Unknown`;
        state.progress.unknown++;
      }
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        result.status = 'timeout';
        result.code = 0;
        result.label = 'Timeout';
        state.progress.timeout++;
      } else {
        // Network error, CORS, blocked, DNS failure, etc.
        result.status = 'unknown';
        result.code = 0;
        result.label = 'Unable to verify';
        state.progress.unknown++;
      }
    }
  }

  // ============================
  // PROGRESS UI
  // ============================
  function updateProgressUI() {
    const { checked, total, working, broken, redirect, timeout, unknown } = state.progress;
    const pct = total > 0 ? Math.round((checked / total) * 100) : 0;

    els.progressPercent.textContent = `${pct}%`;
    els.progressBar.style.width = `${pct}%`;
    els.progressCount.textContent = `${checked} / ${total} links checked`;
    els.statWorking.textContent = working;
    els.statBroken.textContent = broken;
    els.statRedirect.textContent = redirect;
  }

  function updateCheckingCount(active) {
    const remaining = state.progress.total - state.progress.checked;
    els.statChecking.textContent = Math.max(0, active + remaining - (state.progress.checked > 0 ? 0 : 0));
    // Simplify: show how many are still in progress
    const inProgress = state.links.length - state.progress.checked;
    els.statChecking.textContent = Math.max(0, inProgress);
  }

  // ============================
  // FINISH SCAN
  // ============================
  function finishScan(empty = false) {
    state.isScanning = false;

    if (empty) {
      els.resultsList.innerHTML = '';
      els.noResults.classList.remove('hidden');
      els.noResults.querySelector('h3').textContent = 'No links found';
      els.noResults.querySelector('p').textContent = "This page doesn't appear to contain any links that can be checked.";
    } else {
      updateSummary();
      renderResults();
      saveHistory();
    }

    showState('results');
  }

  function updateSummary() {
    const working = state.results.filter(r => r.status === 'working').length;
    const redirect = state.results.filter(r => r.status === 'redirect').length;
    const broken = state.results.filter(r => r.status === 'broken').length;
    const unknown = state.results.filter(r => r.status === 'unknown' || r.status === 'timeout').length;

    els.sumWorking.textContent = working;
    els.sumRedirect.textContent = redirect;
    els.sumBroken.textContent = broken;
    els.sumUnknown.textContent = unknown;
    els.totalLinks.textContent = `${state.results.length} Links`;
    els.uniqueLinks.textContent = `${state.links.length} Unique`;
    els.healthScore.textContent = calculateHealthScore();
  }

  function calculateHealthScore() {
    if (state.results.length === 0) return '—';
    let total = 0;
    state.results.forEach(r => {
      switch (r.status) {
        case 'working': total += 100; break;
        case 'redirect': total += 75; break;
        case 'unknown': total += 50; break;
        case 'timeout': total += 0; break;
        case 'broken': total += 0; break;
        default: total += 50;
      }
    });
    return Math.round(total / state.results.length);
  }

  // ============================
  // RENDER RESULTS
  // ============================
  function renderResults() {
    let filtered = state.results.filter(r => {
      if (state.filter !== 'all') {
        const match = (state.filter === 'unknown') ? (r.status === 'unknown' || r.status === 'timeout') : (r.status === state.filter);
        if (!match) return false;
      }
      if (state.searchQuery) {
        const q = state.searchQuery;
        const inUrl = r.url.toLowerCase().includes(q);
        const inDomain = new URL(r.url).hostname.toLowerCase().includes(q);
        const inAnchor = (r.anchorText || '').toLowerCase().includes(q);
        return inUrl || inDomain || inAnchor;
      }
      return true;
    });

    // Sort
    filtered.sort((a, b) => {
      switch (state.sortBy) {
        case 'status':
          const order = { broken: 0, timeout: 1, unknown: 2, redirect: 3, working: 4, pending: 5 };
          return (order[a.status] ?? 99) - (order[b.status] ?? 99);
        case 'url':
          return a.url.localeCompare(b.url);
        case 'anchor':
          return (a.anchorText || '').localeCompare(b.anchorText || '');
        case 'code':
          return (b.code || 0) - (a.code || 0);
        default:
          return 0;
      }
    });

    // Update filter counts
    const counts = {
      all: state.results.length,
      working: state.results.filter(r => r.status === 'working').length,
      broken: state.results.filter(r => r.status === 'broken').length,
      redirect: state.results.filter(r => r.status === 'redirect').length,
      unknown: state.results.filter(r => r.status === 'unknown' || r.status === 'timeout').length
    };
    $('#countAll').textContent = counts.all;
    $('#countWorking').textContent = counts.working;
    $('#countBroken').textContent = counts.broken;
    $('#countRedirect').textContent = counts.redirect;
    $('#countUnknown').textContent = counts.unknown;

    if (filtered.length === 0) {
      els.resultsList.innerHTML = '';
      els.noResults.classList.remove('hidden');
      els.noResults.querySelector('h3').textContent = 'No matching links';
      els.noResults.querySelector('p').textContent = 'Try another URL, domain, or anchor text.';
      return;
    }

    els.noResults.classList.add('hidden');

    const html = filtered.map(r => {
      const statusConfig = getStatusConfig(r.status);
      const typeLabel = r.isInternal ? 'Internal' : 'External';
      const displayUrl = truncateUrl(r.url, 45);
      const displayAnchor = escapeHtml(truncateText(r.anchorText || '(no text)', 30));
      const codeDisplay = r.code || '—';

      return `
        <div class="result-item" data-url="${escapeHtml(r.url)}" tabindex="0" role="button" aria-label="View details for ${escapeHtml(r.url)}">
          <div class="result-main">
            <div class="result-status ${r.status}">
              <span class="status-icon" aria-hidden="true">${statusConfig.icon}</span>
              <span class="status-label">${statusConfig.label}</span>
            </div>
            <div class="result-info">
              <div class="result-url" title="${escapeHtml(r.url)}">${escapeHtml(displayUrl)}</div>
              <div class="result-meta">
                <span class="result-anchor">${displayAnchor}</span>
                <span class="result-type">${typeLabel}</span>
              </div>
            </div>
            <div class="result-code">${codeDisplay}</div>
          </div>
          <div class="result-actions">
            <button class="action-btn open-btn" data-url="${escapeHtml(r.url)}" title="Open link" aria-label="Open link">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </button>
            <button class="action-btn copy-btn" data-url="${escapeHtml(r.url)}" title="Copy URL" aria-label="Copy URL">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    els.resultsList.innerHTML = html;

    // Attach event listeners to result items
    els.resultsList.querySelectorAll('.result-item').forEach(item => {
      const url = item.dataset.url;
      const result = state.results.find(r => r.url === url);

      item.addEventListener('click', (e) => {
        if (e.target.closest('.action-btn')) return;
        showDetailModal(result);
      });
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          showDetailModal(result);
        }
      });
    });

    els.resultsList.querySelectorAll('.open-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.tabs.create({ url: btn.dataset.url });
      });
    });

    els.resultsList.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(btn.dataset.url);
      });
    });
  }

  function getStatusConfig(status) {
    switch (status) {
      case 'working': return { icon: '✓', label: 'Working', color: 'green' };
      case 'redirect': return { icon: '↗', label: 'Redirect', color: 'amber' };
      case 'broken': return { icon: '✕', label: 'Broken', color: 'red' };
      case 'timeout': return { icon: '⏱', label: 'Timeout', color: 'red' };
      case 'unknown': return { icon: '?', label: 'Unable to verify', color: 'gray' };
      case 'pending': return { icon: '⋯', label: 'Checking', color: 'blue' };
      default: return { icon: '?', label: 'Unknown', color: 'gray' };
    }
  }

  // ============================
  // DETAIL MODAL
  // ============================
  function showDetailModal(result) {
    if (!result) return;
    const cfg = getStatusConfig(result.status);

    els.detailUrl.textContent = result.url;
    els.detailAnchor.textContent = result.anchorText || '(no text)';
    els.detailType.textContent = result.isInternal ? 'Internal' : 'External';
    els.detailStatus.textContent = cfg.label;
    els.detailStatus.className = 'detail-value status-' + result.status;
    els.detailCode.textContent = result.code ? `${result.code} ${result.label.replace(/^\d+\s*/, '')}` : result.label;
    els.detailLocation.textContent = result.sourceLocation || 'Other';

    els.detailModal.classList.remove('hidden');
    els.closeDetailBtn.focus();
  }

  function closeDetailModal() {
    els.detailModal.classList.add('hidden');
  }

  // ============================
  // EXPORT & COPY
  // ============================
  function exportCSV() {
    if (state.results.length === 0) return;

    const headers = ['URL', 'Anchor Text', 'Status', 'HTTP Status', 'Type'];
    const rows = state.results.map(r => [
      r.url,
      (r.anchorText || '').replace(/"/g, '""'),
      r.status,
      r.code || '',
      r.isInternal ? 'Internal' : 'External'
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `linkcheck-${new URL(state.currentTab.url).hostname}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('CSV exported');
  }

  function copySummary() {
    const working = state.results.filter(r => r.status === 'working').length;
    const redirect = state.results.filter(r => r.status === 'redirect').length;
    const broken = state.results.filter(r => r.status === 'broken').length;
    const unknown = state.results.filter(r => r.status === 'unknown' || r.status === 'timeout').length;
    const domain = new URL(state.currentTab.url).hostname;
    const score = calculateHealthScore();

    const text = `LinkCheck Report — ${domain}
Link Health Score: ${score}/100
Total Links: ${state.results.length}
✓ Working: ${working}
↗ Redirects: ${redirect}
✕ Broken: ${broken}
? Unable to verify: ${unknown}`;

    copyToClipboard(text);
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied to clipboard');
    } catch (e) {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Copied to clipboard');
    }
  }

  // ============================
  // UI UTILITIES
  // ============================
  function showState(name) {
    ['unsupportedState', 'readyState', 'scanningState', 'resultsState'].forEach(id => {
      const el = els[id];
      if (el) el.classList.toggle('hidden', id !== name + 'State');
    });
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove('hidden');
    clearTimeout(els.toast._timer);
    els.toast._timer = setTimeout(() => {
      els.toast.classList.add('hidden');
    }, 2000);
  }

  function truncateUrl(url, max) {
    if (url.length <= max) return url;
    return url.slice(0, max - 3) + '...';
  }

  function truncateText(text, max) {
    if (!text) return '';
    if (text.length <= max) return text;
    return text.slice(0, max - 3) + '...';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
