const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[ch]));
    let i18nMessages = {};
    let i18nLocale = 'ko';
    const SETUP_SKIP_DASHBOARD_KEY = 'dirong.setup.skipToDashboard';
    function normalizeActiveView(view) {
      return ['setup', 'dashboard', 'db', 'logs', 'settings'].includes(view) ? view : 'dashboard';
    }
    let activeView = normalizeActiveView(window.localStorage.getItem('dirong.dashboard.view') ?? 'dashboard');
    document.body.dataset.view = activeView;
    let activeDbTab = normalizeDbTab(window.localStorage.getItem('dirong.dashboard.dbTab') ?? 'meeting');
    let activeSettingsTab = window.localStorage.getItem('dirong.dashboard.settingsTab') ?? 'discord';
    let activeLogFilter = window.localStorage.getItem('dirong.dashboard.logFilter') ?? 'all';
    function tr(key, params = {}) {
      const template = i18nMessages[key] ?? key;
      return String(template).replace(/\{(\w+)\}/g, (_match, name) =>
        params[name] === undefined ? '' : String(params[name])
      );
    }
    function i18n(key, params = {}) {
      return escapeHtml(tr(key, params));
    }
    function dashboardJsonHeaders() {
      return {
        'Content-Type': 'application/json',
        'X-Dirong-Dashboard-Token': window.__DIRONG_DASHBOARD_TOKEN__ ?? ''
      };
    }
    function applyStaticI18n() {
      document.querySelectorAll('[data-i18n]').forEach((node) => {
        node.textContent = tr(node.getAttribute('data-i18n'));
      });
      document.title = tr('dashboard.app.title');
    }
    function setupIsIncomplete(setup) {
      return Boolean(setup && setup.status !== 'ready');
    }
    function setupDashboardSkipped() {
      return window.sessionStorage.getItem(SETUP_SKIP_DASHBOARD_KEY) === 'true';
    }
    function syncActiveViewForSetup(setup) {
      if (!setup) return;
      if (!setupIsIncomplete(setup)) {
        window.sessionStorage.removeItem(SETUP_SKIP_DASHBOARD_KEY);
        if (activeView === 'setup') {
          activeView = 'dashboard';
          window.localStorage.setItem('dirong.dashboard.view', activeView);
        }
        return;
      }
      if (activeView !== 'setup' && !setupDashboardSkipped()) {
        activeView = 'setup';
        window.localStorage.setItem('dirong.dashboard.view', activeView);
      }
    }
    function setActiveView(view) {
      activeView = normalizeActiveView(view);
      window.localStorage.setItem('dirong.dashboard.view', activeView);
      updateVisibleView();
      refresh();
    }
    function openSetupWizard() {
      window.sessionStorage.removeItem(SETUP_SKIP_DASHBOARD_KEY);
      setActiveView('setup');
    }
    function skipSetupToDashboard() {
      window.sessionStorage.setItem(SETUP_SKIP_DASHBOARD_KEY, 'true');
      setActiveView('dashboard');
    }
    function normalizeDbTab(tab) {
      if (tab === 'customFields') return 'meeting';
      return ['meeting', 'members', 'actionItems', 'customDb'].includes(tab) ? tab : 'meeting';
    }
    function setDbTab(tab) {
      const normalized = normalizeDbTab(tab);
      if (activeDbTab !== normalized) {
        notionRulesDirty = false;
        notionSchemaResult = null;
        if (typeof clearManagedDbCheckResult === 'function') {
          clearManagedDbCheckResult();
        }
      }
      activeDbTab = normalized;
      window.localStorage.setItem('dirong.dashboard.dbTab', normalized);
      refresh();
    }
    function setSettingsTab(tab) {
      activeSettingsTab = tab;
      window.localStorage.setItem('dirong.dashboard.settingsTab', tab);
      refresh();
    }
    function setLogFilter(filter) {
      activeLogFilter = filter;
      window.localStorage.setItem('dirong.dashboard.logFilter', filter);
      refresh();
    }
    function updateVisibleView() {
      document.body.dataset.view = activeView;
      for (const view of ['setup', 'dashboard', 'db', 'logs', 'settings']) {
        const node = document.getElementById(view + 'View');
        if (node) node.hidden = view !== activeView;
      }
    }
    function renderHumanDisplay(source, options = {}) {
      const display = source?.display;
      const status = source?.status ?? options.status ?? '';
      if (!display) {
        const message = options.message ?? source?.message ?? status ?? '-';
        const action = options.userAction ?? source?.userAction ?? null;
        const technical = source?.technicalDetail
          ? '<details><summary class="muted">' + i18n('dashboard.logs.details.toggle') + '</summary><pre>' + escapeHtml(source.technicalDetail) + '</pre></details>'
          : '';
        return '<div class="display-title ' + runtimeValueClass(status) + '">' + escapeHtml(message) + '</div>' +
          (action ? '<div class="display-next">' + escapeHtml(action) + '</div>' : '') + technical;
      }
      return '<div class="display-title ' + runtimeValueClass(status) + '">' + escapeHtml(display.title) + '</div>' +
        '<div class="display-desc muted">' + escapeHtml(display.description) + '</div>' +
        (display.nextAction ? '<div class="display-next">' + escapeHtml(display.nextAction) + '</div>' : '') +
        renderHumanDisplayDetails(display.details);
    }
    function renderHumanDisplayDetails(details) {
      if (!Array.isArray(details) || details.length === 0) {
        return '';
      }
      const rows = details.map((detail) =>
        '<tr><td>' + escapeHtml(detail.label) + '</td><td><pre>' +
        escapeHtml(detail.value) + '</pre></td></tr>'
      ).join('');
      return '<details><summary class="muted">' + i18n('dashboard.logs.details.toggle') + '</summary>' +
        '<table class="display-details-table"><tbody>' + rows + '</tbody></table></details>';
    }
    function renderRuntimeEffect(effect) {
      if (!effect) return '';
      const action = effect.userAction ? '<br>' + escapeHtml(effect.userAction) : '';
      return '<div class="display-next">' + escapeHtml(effect.message ?? '') + action + '</div>';
    }
    function displayTitle(source, fallback = '-') {
      return source?.display?.title ?? source?.message ?? fallback;
    }
    const sectionCache = new Map();
    const setupLocalState = {
      stepIndex: Number(window.localStorage.getItem('dirong.setup.stepIndex') ?? 0),
      welcomeDone: window.localStorage.getItem('dirong.setup.welcomeDone') === 'true',
      recordingDone: window.localStorage.getItem('dirong.setup.recordingDone') === 'true',
      privacyDone: window.localStorage.getItem('dirong.setup.privacyDone') === 'true',
      sttProvider: window.localStorage.getItem('dirong.setup.sttProvider') || null,
      sttModel: window.localStorage.getItem('dirong.setup.sttModel') || null,
      aiMode: window.localStorage.getItem('dirong.setup.aiMode') || null,
      selectedGuildId: window.localStorage.getItem('dirong.setup.guildId') ?? '',
      guilds: [],
      lastResult: null,
      busy: false,
      forceRender: false
    };
    let notionRulesDirty = false;
    function setupDefaults(setup) {
      return setup?.defaults ?? setupLocalState.lastSetup?.defaults ?? null;
    }
    function requireSetupDefaults() {
      const defaults = setupDefaults(setupLocalState.lastSetup);
      if (!defaults) {
        setupLocalState.lastResult = {
          ok: false,
          status: 'failed',
          message: '서버 기본값을 아직 불러오지 못했습니다.',
          userAction: '잠시 후 다시 시도해 주세요.'
        };
        setupLocalState.forceRender = true;
        renderSetupWizard(setupLocalState.lastSetup);
        setupLocalState.forceRender = false;
        return null;
      }
      return defaults;
    }
    let notionSchemaResult = null;
    const rel = (value) => {
      if (!value) return "";
      const text = String(value).replaceAll("\\", "/");
      const idx = text.lastIndexOf("/data/");
      return idx >= 0 ? text.slice(idx + 1) : text;
    };
    const table = (headers, rows) => {
      if (!rows.length) return '<div class="muted">' + i18n('dashboard.common.none') + '</div>';
      return '<table><thead><tr>' + headers.map((h) => '<th>' + escapeHtml(h) + '</th>').join('') +
        '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
    };
