    const projectLocalState = {
      busyProjectId: null,
      addBusy: false,
      addFormOpen: false,
      newProjectName: '',
      lastResult: null
    };
    const settingsResetLocalState = {
      confirmations: {
        full: false,
        current_project_connection: false
      },
      busyMode: null,
      lastResult: null
    };
    const AUDIO_TOKEN_REFRESH_MARGIN_MS = 60 * 1000;
    let lastDashboardState = null;
    let lastSetupSnapshot = null;

    async function refresh() {
      try {
        const [res, setupRes, i18nRes, projects] = await Promise.all([
          fetch('/api/state', { cache: 'no-store' }),
          fetch('/api/setup/state', { cache: 'no-store' }),
          fetch('/api/i18n', { cache: 'no-store' }),
          dashboardApiGetProjects()
        ]);
        if (i18nRes.ok) {
          const i18n = await i18nRes.json();
          i18nLocale = i18n.locale ?? 'ko';
          i18nMessages = i18n.messages ?? {};
          document.documentElement.lang = i18nLocale;
          applyStaticI18n();
        }
        if (!res.ok) {
          throw new Error('HTTP ' + res.status);
        }
        const state = await res.json();
        state.projects = projects ?? state.projects ?? null;
        const setup = setupRes.ok ? await setupRes.json() : state.setup ?? null;
        renderState(state, setup);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setHtml('events', '<div class="metric"><div class="label">dashboard fetch failed</div>' +
          '<div class="value error">' + escapeHtml(message) + '</div></div>');
        setHtml('setupWizard', '<div class="setup-top"><div><h2 class="setup-title">' +
          i18n('dashboard.setupWizard.title') + '</h2>' +
          '<p class="setup-copy">' + i18n('dashboard.setupWizard.fetchFailed') + '</p></div></div>' +
          '<div class="setup-result"><div class="value error">' + escapeHtml(message) + '</div></div>');
      }
    }
    function renderState(state, setup) {
      const setupSnapshot = setup ?? state.setup ?? null;
      lastDashboardState = state;
      lastSetupSnapshot = setupSnapshot;
      syncActiveViewForSetup(setupSnapshot);
      const runtime = state.runtime ?? {};
      const theme =
        setupSnapshot?.dashboardTheme ??
        setupSnapshot?.defaults?.dashboard?.theme ??
        document.body.dataset.theme;
      document.body.dataset.theme = theme;
      document.getElementById('generatedAt').textContent =
        tr('dashboard.app.generatedAt') + ': ' + (state.generatedAt ?? '-');
      document.getElementById('viewTitle').textContent = titleForView(activeView, state, setupSnapshot);
      document.getElementById('audioTitle').textContent = tr('dashboard.audio.title');
      document.getElementById('notesTitle').textContent = tr('dashboard.notes.title');
      document.getElementById('needsAttentionTitle').textContent = tr('dashboard.logs.needsAttention.title');
      document.getElementById('timelineTitle').textContent = tr('dashboard.logs.timeline.title');
      document.getElementById('sttQueueTitle').textContent = tr('dashboard.logs.sttQueue.title');
      document.getElementById('aiCleanupTitle').textContent = tr('dashboard.logs.aiCleanup.title');

      renderSetupWizard(setupSnapshot);
      if (shouldRenderSidebar()) {
        renderSidebar(state, setupSnapshot);
      }
      renderSetupIncompleteBanner(setupSnapshot);
      setHtml('statusChips', renderStatusChips(state, setupSnapshot));
      setHtml('lockedCards', renderLockedCards(setupSnapshot));
      setHtml('pipeline', renderPhaseFlowCards(state));
      setHtml('metrics', renderAudioSummary(state));
      setHtml('chunks', renderAudioRows(state), stableAudioRowsCacheKey);
      syncAudioControlSources(state);
      setHtml('transcripts', renderTranscriptRows(state));
      setHtml('draftPreview', renderDraftPreview(state));
      setHtml('dbTabs', renderTabs([
        ['meeting', 'dashboard.db.tabs.meeting'],
        ['members', 'dashboard.db.tabs.members'],
        ['actionItems', 'dashboard.db.tabs.actionItems'],
        ['customDb', 'dashboard.db.tabs.customDb']
      ], activeDbTab, 'setDbTab'));
      setHtml('settingsTabs', renderTabs([
        ['language', 'dashboard.settings.tabs.language'],
        ['discord', 'dashboard.settings.tabs.discord'],
        ['stt', 'dashboard.settings.tabs.stt'],
        ['ai', 'dashboard.settings.tabs.ai'],
        ['notion', 'dashboard.settings.tabs.notion'],
        ['retention', 'dashboard.settings.tabs.retention'],
        ['aloneFinalize', 'dashboard.settings.tabs.aloneFinalize'],
        ['reset', 'dashboard.settings.tabs.reset']
      ], activeSettingsTab, 'setSettingsTab'));
      setHtml('logFilters', renderTabs([
        ['all', 'dashboard.logs.filters.all'],
        ['needsAttention', 'dashboard.logs.filters.needsAttention'],
        ['recording', 'dashboard.logs.filters.recording'],
        ['stt', 'dashboard.logs.filters.stt'],
        ['ai', 'dashboard.logs.filters.ai'],
        ['notion', 'dashboard.logs.filters.notion'],
        ['system', 'dashboard.logs.filters.system']
      ], activeLogFilter, 'setLogFilter'));
      const activeRole = activeDatabaseRole();
      setHtml('notion', renderDbPanel(state, setupSnapshot, activeRole));
      if (!notionRulesDirty) {
        setHtml('notionProperties', renderDbCustomFieldsSection(state, activeRole));
      }
      if (shouldRenderSettingsPanel()) {
        setHtml('settingsPanel', renderSettingsPanel(state, setupSnapshot));
        settingsEditorState.forceRender = false;
      }
      setHtml('events', renderEventTimeline(state));
      setHtml('repairs', renderNeedsAttention(state));
      setHtml('sttJobs', renderSttJobTable(state));
      setHtml('aiCleanup', renderAiCleanupTable(state));
      setLogSectionVisibility();
      updateVisibleView();
    }
    function shouldRenderSettingsPanel() {
      if (settingsEditorState.forceRender || activeView !== 'settings') return true;
      const panel = document.getElementById('settingsPanel');
      const active = document.activeElement;
      return !(
        panel &&
        active &&
        panel.contains(active) &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)
      );
    }
    function titleForView(view, state, setup) {
      if (view === 'setup') return tr('dashboard.common.openWizard');
      const viewTitle = view === 'db'
        ? tr('dashboard.nav.databaseSettings')
        : view === 'logs'
          ? tr('dashboard.nav.logs')
          : view === 'settings'
            ? tr('dashboard.nav.settings')
            : tr('dashboard.nav.dashboard');
      const activeProject =
        state?.projects?.activeProject ??
        setup?.projectSetup?.activeProject ??
        null;
      const projectName = String(activeProject?.name ?? '').trim();
      return projectName ? projectName + ' ' + viewTitle : viewTitle;
    }
    function shouldRenderSidebar() {
      const sidebar = document.querySelector('.sidebar');
      const active = document.activeElement;
      return !(
        projectLocalState.addFormOpen &&
        sidebar &&
        active &&
        sidebar.contains(active) &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)
      );
    }
    function renderSidebar(state, setup) {
      setHtml('sidebarServers', renderProjectList(state.projects, state));
      const nav = [
        ...(setupIsIncomplete(setup) ? [['setup', 'dashboard.common.openWizard']] : []),
        ['dashboard', 'dashboard.nav.dashboard'],
        ['db', 'dashboard.nav.databaseSettings'],
        ['logs', 'dashboard.nav.logs'],
        ['settings', 'dashboard.nav.settings']
      ].map(([view, key]) => '<button type="button" class="nav-button' +
        (activeView === view ? ' is-active' : '') + '" onclick="setActiveView(\'' + view + '\')">' +
        '<span>' + i18n(key) + '</span></button>').join('');
      setHtml('sectionNav', nav);
      setHtml('quickActions',
        '<button type="button" class="nav-button" title="' +
        i18n('dashboard.quick.startRecordingHint') + '" disabled>' +
        '<span>' + i18n('dashboard.quick.startRecording') + '</span></button>' +
        '<button type="button" class="nav-button" onclick="refresh()"><span>' +
        i18n('dashboard.quick.refreshStatus') + '</span></button>'
      );
    }
    function renderProjectList(snapshot, state) {
      const projects = Array.isArray(snapshot?.projects) ? snapshot.projects : [];
      const activeProjectId = snapshot?.activeProjectId ?? snapshot?.activeProject?.id ?? null;
      const list = projects.length
        ? '<div class="project-list">' + projects.map((project) =>
            renderProjectButton(project, activeProjectId)
          ).join('') + '</div>'
        : '<div class="project-empty muted">' + i18n('dashboard.projects.empty') + '</div>';
      const addDisabled = projectLocalState.addBusy || projectLocalState.busyProjectId !== null;
      const addLabel = projectLocalState.addBusy
        ? 'dashboard.projects.adding'
        : 'dashboard.projects.add';
      return list +
        (projectLocalState.addFormOpen
          ? renderProjectCreateForm(addDisabled)
          : '<button type="button" class="server-button project-add-button"' +
            (addDisabled ? ' disabled' : '') + ' onclick="openProjectCreateForm()">' +
            '<span>' + i18n(addLabel) + '</span></button>') +
        renderProjectActionStatus(snapshot, state);
    }
    function renderProjectCreateForm(disabled) {
      return '<form class="project-create-form" onsubmit="createProjectFromSidebar(event)">' +
        '<label><span class="label">' + i18n('dashboard.projects.nameLabel') + '</span>' +
        '<input id="projectCreateName" type="text" maxlength="80" autocomplete="off" value="' +
        escapeHtml(projectLocalState.newProjectName) + '" placeholder="' +
        i18n('dashboard.projects.namePlaceholder') + '" oninput="rememberProjectCreateName(this.value)"></label>' +
        '<div class="project-create-actions">' +
        '<button type="submit"' + (disabled ? ' disabled' : '') + '>' +
        i18n(disabled ? 'dashboard.projects.adding' : 'dashboard.projects.create') + '</button>' +
        '<button type="button"' + (disabled ? ' disabled' : '') + ' onclick="cancelProjectCreate()">' +
        i18n('dashboard.projects.cancel') + '</button></div></form>';
    }
    function renderProjectButton(project, activeProjectId) {
      const isActive = activeProjectId === project.id;
      const isBusy = projectLocalState.busyProjectId === project.id;
      const lifecycleStatus = project.lifecycleStatus ?? 'draft';
      const guildLabel = project.guildName ?? project.guildId ?? tr('dashboard.projects.guildMissing');
      const badges = '<span class="project-badges">' +
        (isActive ? '<span class="project-status project-status-active">' +
          i18n('dashboard.projects.active') + '</span>' : '') +
        '<span class="project-status ' + projectLifecycleTone(lifecycleStatus) + '">' +
        escapeHtml(projectLifecycleLabel(lifecycleStatus)) + '</span></span>';
      return '<button type="button" class="server-button project-button' +
        (isActive ? ' is-active' : '') + ' project-lifecycle-' + escapeHtml(lifecycleStatus) + '"' +
        (projectLocalState.addBusy || (projectLocalState.busyProjectId !== null && !isBusy)
          ? ' disabled'
          : '') +
        ' aria-current="' + (isActive ? 'true' : 'false') + '"' +
        ' onclick="switchProject(' + escapeHtml(JSON.stringify(project.id)) + ')">' +
        '<span class="project-button-main"><span class="project-name">' +
        escapeHtml(project.name) + '</span><span class="project-meta">' +
        escapeHtml(guildLabel) + '</span></span>' +
        (isBusy ? '<span class="project-status project-status-busy">' +
          i18n('dashboard.projects.switching') + '</span>' : badges) +
        '</button>';
    }
    function renderProjectActionStatus(snapshot, state) {
      const result = projectLocalState.lastResult;
      if (result) {
        const failed = result.ok === false || ['blocked', 'failed', 'not_configured'].includes(String(result.status));
        const blockReason = result.reason ?? result.switchResult?.reason ?? null;
        const reason = blockReason ? projectSwitchReasonLabel(blockReason) : null;
        const message =
          result.message ??
          result.switchResult?.message ??
          (result.messageKey ? tr(result.messageKey) : null);
        return '<div id="projectActionStatus" class="project-action-status ' + (failed ? 'is-error' : 'is-ok') + '">' +
          '<div class="label">' + i18n(failed
            ? 'dashboard.projects.actionBlocked'
            : 'dashboard.projects.actionDone') + '</div>' +
          '<div class="value ' + (failed ? 'error' : 'status') + '">' +
          escapeHtml(reason ?? projectActionSuccessText(result)) + '</div>' +
          (message ? '<div class="muted">' + escapeHtml(message) + '</div>' : '') +
          '</div>';
      }
      if (snapshot && snapshot.ok === false) {
        const message = snapshot.message ?? (snapshot.messageKey ? tr(snapshot.messageKey) : snapshot.status ?? 'failed');
        return '<div id="projectActionStatus" class="project-action-status is-error">' +
          '<div class="label">' + i18n('dashboard.projects.unavailable') + '</div>' +
          '<div class="value error">' + escapeHtml(message) + '</div></div>';
      }
      const active = snapshot?.activeProject;
      if (!active) {
        return '<div id="projectActionStatus" class="project-action-status">' +
          '<div class="label">' + i18n('dashboard.projects.activeContext') + '</div>' +
          '<div class="muted">' + i18n('dashboard.projects.noActive') + '</div></div>';
      }
      const sessionGuild = state.currentSession?.guild_id;
      return '<div id="projectActionStatus" class="project-action-status">' +
        '<div class="label">' + i18n('dashboard.projects.activeContext') + '</div>' +
        '<div class="value">' + escapeHtml(active.name) + '</div>' +
        '<div class="muted">' + escapeHtml(active.guildName ?? active.guildId ?? sessionGuild ?? tr('dashboard.projects.guildMissing')) +
        '</div></div>';
    }
    function projectLifecycleLabel(status) {
      const key = 'dashboard.projects.lifecycle.' + String(status ?? 'draft');
      const label = tr(key);
      return label === key ? String(status ?? 'draft') : label;
    }
    function projectLifecycleTone(status) {
      const value = String(status ?? 'draft');
      if (value === 'ready') return 'project-status-ready';
      if (value === 'archived') return 'project-status-archived';
      if (value === 'resetting') return 'project-status-resetting';
      return 'project-status-draft';
    }
    function projectSwitchReasonLabel(reason) {
      const key = 'dashboard.projects.blockReasons.' + String(reason ?? 'unknown');
      const label = tr(key);
      return label === key ? String(reason ?? 'unknown') : label;
    }
    function projectActionSuccessText(result) {
      if (result?.reused) return tr('dashboard.projects.createReused');
      if (result?.project && result?.switchResult) return tr('dashboard.projects.createDone');
      return tr('dashboard.projects.switchDone');
    }
    function clearProjectScopedUiCache() {
      notionRulesDirty = false;
      notionSchemaResult = null;
      if (typeof clearManagedDbCheckResult === 'function') {
        clearManagedDbCheckResult();
      }
    }
    function resetProjectSetupSelection() {
      setupLocalState.selectedGuildId = '';
      window.localStorage.removeItem('dirong.setup.guildId');
    }
    function openProjectCreateForm() {
      if (projectLocalState.addBusy || projectLocalState.busyProjectId) {
        return;
      }
      projectLocalState.addFormOpen = true;
      projectLocalState.lastResult = null;
      if (lastDashboardState) renderSidebar(lastDashboardState, lastSetupSnapshot);
      window.setTimeout(() => document.getElementById('projectCreateName')?.focus(), 0);
    }
    function cancelProjectCreate() {
      if (projectLocalState.addBusy) {
        return;
      }
      projectLocalState.addFormOpen = false;
      projectLocalState.newProjectName = '';
      if (lastDashboardState) renderSidebar(lastDashboardState, lastSetupSnapshot);
    }
    function rememberProjectCreateName(value) {
      projectLocalState.newProjectName = value;
    }
    function goDashboardFromProjectMenu() {
      window.sessionStorage.setItem(SETUP_SKIP_DASHBOARD_KEY, 'true');
      activeView = 'dashboard';
      window.localStorage.setItem('dirong.dashboard.view', activeView);
      updateVisibleView();
    }
    async function switchProject(projectId) {
      if (!projectId || projectLocalState.addBusy || projectLocalState.busyProjectId) {
        return;
      }
      const activeProjectId =
        lastDashboardState?.projects?.activeProjectId ??
        lastDashboardState?.projects?.activeProject?.id ??
        null;
      if (activeProjectId === projectId) {
        goDashboardFromProjectMenu();
        await refresh();
        return;
      }
      projectLocalState.busyProjectId = projectId;
      projectLocalState.lastResult = null;
      projectLocalState.addFormOpen = false;
      if (lastDashboardState) renderSidebar(lastDashboardState, lastSetupSnapshot);
      try {
        const result = await dashboardApiSwitchProject(projectId);
        projectLocalState.lastResult = result;
        if (result.ok) {
          clearProjectScopedUiCache();
          resetProjectSetupSelection();
          goDashboardFromProjectMenu();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        projectLocalState.lastResult = {
          ok: false,
          status: 'failed',
          message
        };
      } finally {
        projectLocalState.busyProjectId = null;
        await refresh();
      }
    }
    async function createProjectFromSidebar(event) {
      event?.preventDefault?.();
      if (projectLocalState.addBusy || projectLocalState.busyProjectId) {
        return;
      }
      projectLocalState.addBusy = true;
      projectLocalState.lastResult = null;
      const projectName = String(
        document.getElementById('projectCreateName')?.value ?? projectLocalState.newProjectName ?? ''
      ).trim();
      if (lastDashboardState) renderSidebar(lastDashboardState, lastSetupSnapshot);
      try {
        const result = await dashboardApiCreateProject({
          name: projectName || undefined,
          reuseEmptyDraft: true,
          activate: true
        });
        projectLocalState.lastResult = result;
        if (result.ok) {
          clearProjectScopedUiCache();
          resetProjectSetupSelection();
          projectLocalState.addFormOpen = false;
          projectLocalState.newProjectName = '';
          window.sessionStorage.removeItem(SETUP_SKIP_DASHBOARD_KEY);
          activeView = 'setup';
          window.localStorage.setItem('dirong.dashboard.view', activeView);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        projectLocalState.lastResult = {
          ok: false,
          status: 'failed',
          message
        };
      } finally {
        projectLocalState.addBusy = false;
        await refresh();
      }
    }
    function renderSetupIncompleteBanner(setup) {
      const root = document.getElementById('setupIncompleteBanner');
      if (!setup || setup.status === 'ready' || activeView === 'setup') {
        root.classList.remove('is-visible');
        root.innerHTML = '';
        return;
      }
      root.classList.add('is-visible');
      root.innerHTML =
        '<div><strong>' + i18n('dashboard.setupIncomplete.banner.title') + '</strong> ' +
        '<span>' + i18n('dashboard.setupIncomplete.banner.description') + '</span></div>' +
        '<button type="button" onclick="openSetupWizard()">' +
        i18n('dashboard.setupIncomplete.banner.action') + '</button>';
    }
    function renderStatusChips(state, setup) {
      const chips = [
        ['recording', 'dashboard.status.recording.label', state.runtime?.isRecording ? 'recording' : setup?.features?.recording?.status],
        ['stt', 'dashboard.status.stt.label', setup?.features?.stt?.status ?? state.sttAutomation?.status],
        ['ai', 'dashboard.status.ai.label', setup?.features?.ai?.status ?? state.aiReadiness?.status],
        ['notion', 'dashboard.status.notion.label', setup?.features?.notion?.status ?? state.notion?.status]
      ];
      return chips.map(([_id, labelKey, status]) =>
        '<span class="status-chip ' + statusTone(status) + '"><span class="status-dot"></span>' +
        '<span>' + i18n(labelKey) + '</span><strong>' + escapeHtml(statusLabel(status)) +
        '</strong></span>'
      ).join('');
    }
    function renderLockedCards(setup) {
      const features = setup?.features;
      if (!features || setup.status === 'ready') return '';
      const entries = [
        ['Discord', features.discord],
        ['STT', features.stt],
        ['AI', features.ai],
        ['Notion', features.notion],
        ['Recording', features.recording]
      ].filter(([, feature]) => feature?.status !== 'ready');
      if (entries.length === 0) return '';
      return '<div class="section-heading"><h2>' + i18n('dashboard.setupIncomplete.lockedTitle') + '</h2></div>' +
        '<div class="locked-grid">' + entries.map(([label, feature]) =>
          '<div class="locked-card"><div class="label">' + escapeHtml(label) + ' · ' +
          escapeHtml(statusLabel(feature?.status)) + '</div>' + renderHumanDisplay(feature) + '</div>'
        ).join('') + '</div>';
    }
    function renderPhaseFlowCards(state) {
      return [
        renderParticipantFlowCard(state),
        renderRecordingFlowCard(state),
        renderAiFlowCard(state),
        renderNotionFlowCard(state)
      ].join('');
    }
    function renderParticipantFlowCard(state) {
      const speakers = state.speakers ?? [];
      const humans = speakers.filter((s) => !s.is_bot);
      const status = humans.length > 0 ? 'ready' : 'idle';
      return flowCard('dashboard.card.participants.title', status,
        humans.length > 0
          ? humans.slice(0, 4).map((s) => escapeHtml(s.display_name_snapshot)).join('<br>')
          : i18n('dashboard.card.participants.empty')
      );
    }
    function renderRecordingFlowCard(state) {
      const runtime = state.runtime ?? {};
      const sttCounts = countStatuses(state.recentSttJobs ?? []);
      const failed = (sttCounts.get('failed') ?? 0) + (sttCounts.get('failed_missing_file') ?? 0);
      const status = runtime.isRecording ? 'processing' : state.currentSession ? 'ready' : 'idle';
      const message = runtime.isRecording
        ? tr('dashboard.card.recording.active')
        : state.currentSession
          ? tr('dashboard.card.recording.ended')
          : tr('dashboard.card.recording.idle');
      return flowCard('dashboard.card.recording.title', status,
        escapeHtml(message) + '<br>' +
        i18n('dashboard.card.recording.audioFiles', { count: (state.recentChunks ?? []).length }) + '<br>' +
        renderSttSummaryBoxes(sttCounts.get('done') ?? 0, failed)
      );
    }
    function renderAiFlowCard(state) {
      const latestAiJob = (state.recentAiCleanupJobs ?? [])[0];
      const draft = state.latestMeetingNotesDraft;
      const retrying = latestAiJob?.status === 'queued' && Number(latestAiJob.attempts ?? 0) > 0;
      const status = draft ? 'ready' :
        ['processing', 'queued'].includes(String(latestAiJob?.status)) ? 'processing' :
        ['failed', 'blocked'].includes(String(latestAiJob?.status)) ? 'failed' : 'idle';
      const key = draft ? 'dashboard.card.aiNotes.done' :
        retrying ? 'dashboard.card.aiNotes.retrying' :
        status === 'processing' ? 'dashboard.card.aiNotes.processing' :
        status === 'failed' ? 'dashboard.card.aiNotes.failed' :
        'dashboard.card.aiNotes.waiting';
      const detail = latestAiJob
        ? '<div class="muted">' + escapeHtml(latestAiJob.status) + ' / ' + escapeHtml(latestAiJob.provider) + '</div>'
        : '';
      const retryState = retrying
        ? '<div class="muted">' + i18n('dashboard.automation.retrying', {
            attempts: latestAiJob.attempts ?? 0,
            maxAttempts: latestAiJob.max_attempts ?? '-'
          }) + '</div>'
        : '';
      const failure = latestAiJob && ['failed', 'blocked'].includes(String(latestAiJob.status))
        ? renderInlineFailureReason('dashboard.automation.failureReason', latestAiJob.last_error) +
          '<div class="toolbar" style="margin-top:8px"><button type="button" onclick="postAiCleanupRetry(\'' +
          escapeHtml(latestAiJob.id) + '\')">' + i18n('dashboard.automation.retry') +
          '</button><span class="muted" id="aiCleanupActionStatus"></span></div>'
        : '';
      return flowCard('dashboard.card.aiNotes.title', status, i18n(key) + detail + retryState + failure);
    }
    function renderNotionFlowCard(state) {
      const latest = state.latestNotionWrite;
      const status = latest?.status === 'done' ? 'ready' :
        ['processing', 'queued', 'retry_wait'].includes(String(state.notionAutomation?.status ?? latest?.status)) ? 'processing' :
        ['failed', 'blocked'].includes(String(latest?.status ?? state.notionAutomation?.status ?? state.notion?.status)) ? 'failed' : 'idle';
      const key = status === 'ready' ? 'dashboard.card.notionUpload.done' :
        status === 'processing' ? 'dashboard.card.notionUpload.processing' :
        status === 'failed' ? 'dashboard.card.notionUpload.failed' :
        'dashboard.card.notionUpload.waiting';
      const link = latest?.notion_page_url
        ? '<div><a href="' + escapeHtml(latest.notion_page_url) + '" target="_blank" rel="noreferrer">' +
          i18n('dashboard.common.openNotion') + '</a></div>'
        : '';
      const failed = ['failed', 'blocked'].includes(String(latest?.status ?? state.notionAutomation?.status ?? ''));
      const retry = failed
        ? renderInlineFailureReason(
            'dashboard.notionUploadPanel.failureReason',
            latest?.last_error ?? state.notionAutomation?.technicalDetail
          ) + renderNotionRetryButton(state)
        : '';
      return flowCard('dashboard.card.notionUpload.title', status, i18n(key) + link + retry);
    }
    function flowCard(titleKey, status, body) {
      return '<article class="flow-card ' + statusTone(status) + '"><div class="flow-card-header"><h3>' + i18n(titleKey) +
        '</h3><span class="card-state ' + cardStateClass(status) + '"></span></div>' +
        '<div class="value ' + runtimeValueClass(status) + '">' + body + '</div></article>';
    }
    function renderAudioSummary(state) {
      const speakers = (state.speakers ?? []).filter((s) => !s.is_bot);
      const sttCounts = countStatuses(state.recentSttJobs ?? []);
      const failed = (sttCounts.get('failed') ?? 0) + (sttCounts.get('failed_missing_file') ?? 0);
      return '<div class="summary-list">' +
        speakers.map((s) => '<span class="summary-pill">' +
          i18n('dashboard.audio.summary.speakerUtterances', { name: s.display_name_snapshot, count: s.chunk_count ?? 0 }) +
          '</span>').join('') +
        '<span class="summary-pill summary-pill-stt tone-ready">' + i18n('dashboard.audio.summary.sttDone', { count: sttCounts.get('done') ?? 0 }) + '</span>' +
        '<span class="summary-pill summary-pill-stt tone-danger">' + i18n('dashboard.audio.summary.sttFailed', { count: failed }) + '</span></div>';
    }
    function renderSttSummaryBoxes(done, failed) {
      return '<span class="stt-summary-list">' +
        '<span class="stt-summary-box tone-ready">' + i18n('dashboard.audio.summary.sttDone', { count: done }) + '</span>' +
        '<span class="stt-summary-box tone-danger">' + i18n('dashboard.audio.summary.sttFailed', { count: failed }) + '</span></span>';
    }
    function renderAudioRows(state) {
      const rows = (state.recentChunks ?? []).map((c) => '<tr><td>' +
        escapeHtml(formatMs(c.started_at_ms ?? c.startedAtMs ?? 0)) + '</td><td>' +
        escapeHtml(c.display_name_snapshot) + '</td><td>' +
        escapeHtml(c.status) + ' / ' + escapeHtml(c.transcode_status) + '</td><td>' +
        renderAudioControls(c) + '</td><td><details><summary>' +
        i18n('dashboard.audio.transcriptToggle') + '</summary><code>' +
        escapeHtml(c.stt_job_status ?? '-') + '</code></details></td></tr>');
      return table([
        tr('dashboard.table.time'),
        tr('dashboard.table.speaker'),
        tr('dashboard.table.status'),
        tr('dashboard.table.playback'),
        tr('dashboard.table.transcript')
      ], rows);
    }
    function renderTranscriptRows(state) {
      const rows = (state.recentTranscriptSegments ?? []).slice(0, 8).map((t) =>
        '<tr><td>' + escapeHtml(formatMs(t.start_ms)) + '</td><td>' +
        escapeHtml(t.display_name_snapshot) + '</td><td>' +
        escapeHtml((t.speech_status === 'no_speech' && !t.text) ? '(no speech)' : t.text) +
        '</td></tr>');
      return rows.length ? table([
        tr('dashboard.table.time'),
        tr('dashboard.table.speaker'),
        tr('dashboard.table.text')
      ], rows) : '';
    }
    function renderDraftPreview(state) {
      const draft = state.latestMeetingNotesDraft;
      return draft
        ? '<pre>' + escapeHtml(draft.markdown) + '</pre>'
        : '<div class="muted">' + i18n('dashboard.notes.empty') + '</div>';
    }
    function activeDatabaseRole() {
      if (activeDbTab === 'members') return 'member';
      if (activeDbTab === 'actionItems') return 'task';
      if (activeDbTab === 'meeting') return 'meeting';
      return null;
    }
    function renderDbPanel(state, setup, role) {
      if (!role) {
        return renderCustomDatabasePlaceholder();
      }
      return renderManagedDbPanel(state, setup, role);
    }
    function renderCustomDatabasePlaceholder() {
      return '<div class="section-heading"><h2>' + i18n('dashboard.db.customDb.title') + '</h2></div>' +
        '<div class="metric"><div class="label">' + i18n('dashboard.db.customDb.label') + '</div>' +
        '<div class="value">' + i18n('dashboard.db.customDb.body') + '</div>' +
        '<div class="muted">' + i18n('dashboard.db.customDb.notice') + '</div></div>';
    }
    function renderDbCustomFieldsSection(state, role) {
      if (!role) return '';
      const target = tr('dashboard.db.customFields.target.' + role);
      const intro = '<div style="margin-top:12px"><div class="section-heading"><h2>' +
        i18n('dashboard.db.customFields.scopedTitle', { database: target }) + '</h2></div>' +
        '<p class="muted">' + i18n('dashboard.db.customFields.scopeHelp', { database: target }) + '</p>';
      return intro + renderNotionPropertyRules(state, role) + '</div>';
    }
    function renderSettingsCredits() {
      const githubUrl = tr('dashboard.settings.credits.githubUrl');
      return '<div class="metric settings-credits" style="margin-top:10px">' +
        '<div class="label">' + i18n('dashboard.settings.credits.title') + '</div>' +
        '<div class="value">' + i18n('dashboard.settings.credits.directorLabel') + ': ' +
        i18n('dashboard.settings.credits.directorName') + '</div>' +
        '<div class="muted">' + i18n('dashboard.settings.credits.githubLabel') + ': ' +
        '<a href="' + escapeHtml(githubUrl) + '" target="_blank" rel="noreferrer">' +
        escapeHtml(githubUrl) + '</a><br>' +
        i18n('dashboard.settings.credits.madeWith') + '</div></div>';
    }
    function renderSettingsResetPanel(state, setup) {
      const recordingActive = Boolean(state.runtime?.isRecording);
      const notionBusy = (state.notionAutomation?.inFlightDraftIds ?? []).length > 0;
      const aiBusy = (state.aiCleanupAutomation?.inFlightSessionIds ?? []).length > 0;
      const blocker = recordingActive
        ? 'recording_active'
        : notionBusy
          ? 'notion_upload_in_flight'
          : aiBusy
            ? 'ai_cleanup_in_flight'
            : null;
      const modes = [
        {
          mode: 'current_project_connection',
          title: 'dashboard.settings.reset.currentProject.title',
          label: 'dashboard.settings.reset.currentProject.button',
          deletes: 'dashboard.settings.reset.currentProject.deletes',
          keeps: 'dashboard.settings.reset.currentProject.keeps'
        },
        {
          mode: 'full',
          title: 'dashboard.settings.reset.full.title',
          label: 'dashboard.settings.reset.full.button',
          deletes: 'dashboard.settings.reset.full.deletes',
          keeps: 'dashboard.settings.reset.full.keeps'
        }
      ];
      const result = renderSettingsResetResult(settingsResetLocalState.lastResult);
      const activeProject = setup?.activeProject ?? state.projects?.activeProject ?? null;
      const activeProjectLine = '<div class="muted">' + i18n('dashboard.settings.reset.activeProject') + ': ' +
        escapeHtml(activeProject?.name ?? tr('dashboard.common.none')) + '</div>';
      return '<div class="section-heading"><h2>' + i18n('dashboard.settings.reset.title') + '</h2></div>' +
        '<div class="metric"><div class="label">' + i18n('dashboard.settings.reset.safetyLabel') + '</div>' +
        '<div class="value">' + i18n('dashboard.settings.reset.safetyCopy') + '</div>' +
        activeProjectLine +
        (blocker ? '<div class="display-next error">' + i18n('dashboard.settings.reset.conflict.' + blocker) + '</div>' : '') +
        '</div>' +
        '<div class="settings-reset-grid">' + modes.map((entry) =>
          renderSettingsResetMode(entry, blocker)
        ).join('') + '</div>' + result;
    }
    function renderSettingsResetMode(entry, blocker) {
      const mode = entry.mode;
      const checked = settingsResetLocalState.confirmations[mode] === true;
      const busy = settingsResetLocalState.busyMode === mode;
      const disabled = Boolean(blocker || settingsResetLocalState.busyMode || !checked);
      return '<section class="settings-reset-card">' +
        '<div class="section-heading"><h3>' + i18n(entry.title) + '</h3></div>' +
        '<div class="settings-reset-list"><strong>' + i18n('dashboard.settings.reset.deletesLabel') + '</strong><span>' +
        i18n(entry.deletes) + '</span></div>' +
        '<div class="settings-reset-list"><strong>' + i18n('dashboard.settings.reset.keepsLabel') + '</strong><span>' +
        i18n(entry.keeps) + '</span></div>' +
        '<label class="settings-reset-confirm"><input type="checkbox" ' +
        (checked ? 'checked ' : '') +
        'onchange="setSettingsResetConfirm(\'' + mode + '\', this.checked)">' +
        '<span>' + i18n('dashboard.settings.reset.confirm') + '</span></label>' +
        '<button type="button" class="danger-button" onclick="executeSettingsReset(\'' + mode + '\')" ' +
        (disabled ? 'disabled ' : '') + '>' +
        (busy ? i18n('dashboard.settings.reset.running') : i18n(entry.label)) + '</button>' +
        '</section>';
    }
    function renderSettingsResetResult(result) {
      if (!result) return '';
      const ok = result.ok === true;
      const reason = result.reason ? i18n('dashboard.settings.reset.conflict.' + result.reason) : '';
      const message = ok
        ? i18n('dashboard.settings.reset.success')
        : reason || escapeHtml(result.message ?? result.status ?? 'failed');
      const details = ok && result.deleted
        ? '<div class="muted">' +
          i18n('dashboard.settings.reset.deletedSummary', {
            secrets: result.deleted.secretRefs?.length ?? 0,
            writes: result.deleted.blockedNotionWrites ?? 0
          }) + '</div>'
        : '';
      return '<div class="setup-result ' + (ok ? 'is-ok' : 'is-error') + '">' +
        '<div class="value ' + (ok ? 'status' : 'error') + '">' + message + '</div>' +
        details + '</div>';
    }
    function setSettingsResetConfirm(mode, checked) {
      if (mode !== 'full' && mode !== 'current_project_connection') return;
      settingsResetLocalState.confirmations[mode] = Boolean(checked);
      setHtml('settingsPanel', renderSettingsPanel(lastDashboardState ?? {}, lastSetupSnapshot));
    }
    async function executeSettingsReset(mode) {
      if (mode !== 'full' && mode !== 'current_project_connection') return;
      if (settingsResetLocalState.busyMode || !settingsResetLocalState.confirmations[mode]) return;
      settingsResetLocalState.busyMode = mode;
      settingsResetLocalState.lastResult = null;
      setHtml('settingsPanel', renderSettingsPanel(lastDashboardState ?? {}, lastSetupSnapshot));
      try {
        const result = await dashboardApiResetSettings(mode);
        settingsResetLocalState.lastResult = result;
        if (result.ok) {
          settingsResetLocalState.confirmations.full = false;
          settingsResetLocalState.confirmations.current_project_connection = false;
          window.sessionStorage.setItem(SETUP_SKIP_DASHBOARD_KEY, 'true');
          activeView = 'settings';
          window.localStorage.setItem('dirong.dashboard.view', activeView);
          clearProjectScopedUiCache();
          resetProjectSetupSelection();
        }
      } catch (error) {
        settingsResetLocalState.lastResult = {
          ok: false,
          status: 'failed',
          message: error instanceof Error ? error.message : String(error)
        };
      } finally {
        settingsResetLocalState.busyMode = null;
        await refresh();
      }
    }
    async function postAiCleanupRetry(jobId) {
      const statusEl = document.getElementById('aiCleanupActionStatus');
      if (statusEl) statusEl.textContent = tr('dashboard.automation.retryRequested');
      try {
        const res = await fetch('/api/ai-cleanup/retry', {
          method: 'POST',
          headers: dashboardJsonHeaders(),
          body: JSON.stringify({ jobId })
        });
        const result = await res.json();
        if (statusEl) statusEl.textContent = result.status + ': ' + result.message;
        await refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (statusEl) statusEl.textContent = message;
      }
    }
    function renderNeedsAttention(state) {
      const rows = filterLogItems(buildLogItems(state).filter((item) => item.needsAttention));
      if (rows.length === 0) return logEmptyState();
      return table([
        tr('dashboard.table.updated'),
        tr('dashboard.table.area'),
        tr('dashboard.table.summary'),
        tr('dashboard.table.nextAction'),
        tr('dashboard.table.details')
      ], rows.map(renderLogItemRow));
    }
    function renderEventTimeline(state) {
      const events = filterLogItems(buildLogItems(state));
      if (events.length === 0) return logEmptyState();
      return table([
        tr('dashboard.table.time'),
        tr('dashboard.table.area'),
        tr('dashboard.table.summary'),
        tr('dashboard.table.nextAction'),
        tr('dashboard.logs.details.toggle')
      ], events.map(renderLogItemRow));
    }
    function renderSttJobTable(state) {
      const rows = filterLogItems(buildSttJobLogItems(state));
      if (rows.length === 0) return logEmptyState();
      return table([
        tr('dashboard.table.job'),
        tr('dashboard.table.status'),
        tr('dashboard.table.nextAction'),
        tr('dashboard.table.details')
      ], rows.map(renderLogJobRow));
    }
    function renderAiCleanupTable(state) {
      const rows = filterLogItems(buildAiCleanupLogItems(state));
      if (rows.length === 0) return logEmptyState();
      return table([
        tr('dashboard.table.job'),
        tr('dashboard.table.status'),
        tr('dashboard.table.nextAction'),
        tr('dashboard.table.details')
      ], rows.map(renderLogJobRow));
    }
    function renderTabs(items, active, handlerName) {
      return items.map(([id, key]) => '<button type="button" class="tab-button' +
        (active === id ? ' is-active' : '') + '" onclick="' + handlerName + '(\'' + id + '\')">' +
        i18n(key) + '</button>').join('');
    }
    function statusLabel(status) {
      const normalized = String(status ?? 'idle');
      const map = {
        ready: 'dashboard.status.value.ready',
        connected: 'dashboard.status.value.connected',
        checking: 'dashboard.status.value.checking',
        countdown: 'dashboard.status.value.processing',
        processing: 'dashboard.status.value.processing',
        running: 'dashboard.status.value.processing',
        queued: 'dashboard.status.value.processing',
        warning: 'dashboard.status.value.warning',
        blocked: 'dashboard.status.value.blocked',
        repair_required: 'dashboard.status.value.warning',
        not_configured: 'dashboard.status.value.notConfigured',
        not_synced: 'dashboard.status.value.notConfigured',
        idle: 'dashboard.status.value.idle',
        recording: 'dashboard.status.value.recording',
        active: 'dashboard.status.value.recording',
        created: 'dashboard.status.value.idle',
        reconnecting: 'dashboard.status.value.checking',
        stopping: 'dashboard.status.value.processing',
        finalized: 'dashboard.status.value.done',
        needs_repair: 'dashboard.status.value.warning',
        done: 'dashboard.status.value.done',
        failed: 'dashboard.status.value.failed',
        failed_missing_file: 'dashboard.status.value.failed',
        not_installed: 'dashboard.status.value.notConfigured',
        partial: 'dashboard.status.value.warning',
        missing: 'dashboard.status.value.notConfigured',
        retry_wait: 'dashboard.status.value.processing',
        disabled: 'dashboard.status.value.disabled',
        manual: 'dashboard.status.value.manual'
      };
      return tr(map[normalized] ?? map.idle);
    }
    function statusTone(status) {
      const value = String(status ?? '');
      if (['ready', 'done', 'connected'].includes(value)) return 'tone-ready';
      if (['running', 'queued', 'processing', 'checking', 'recording', 'retry_wait'].includes(value)) return 'tone-progress';
      if (['partial'].includes(value)) return 'tone-progress';
      if (['failed', 'blocked', 'not_configured', 'repair_required'].includes(value)) return 'tone-danger';
      return 'tone-muted';
    }
    function cardStateClass(status) {
      const tone = statusTone(status);
      if (tone === 'tone-ready') return 'card-state-ready';
      if (tone === 'tone-progress') return 'card-state-progress';
      if (tone === 'tone-danger') return 'card-state-danger';
      return 'card-state-muted';
    }
    function buildLogItems(state) {
      return [
        ...buildRepairLogItems(state),
        ...buildConnectionLogItems(state),
        ...buildSttJobLogItems(state),
        ...buildAiCleanupLogItems(state),
        ...buildNotionLogItems(state)
      ].sort((a, b) => String(b.sortTime ?? '').localeCompare(String(a.sortTime ?? '')));
    }
    function buildRepairLogItems(state) {
      return (state.recentRepairItems ?? []).map((r) => ({
        time: r.updated_at,
        sortTime: r.updated_at,
        area: logAreaId(r.item_type),
        kind: 'repair',
        summary: tr('dashboard.logSummary.repairItem'),
        status: r.status,
        needsAttention: r.status === 'open' || logSeverityNeedsAttention(r.severity),
        nextAction: tr('dashboard.quick.refreshStatus'),
        details: {
          type: r.item_type,
          status: r.status,
          severity: r.severity,
          path: r.path,
          chunkId: r.chunk_id,
          sttJobId: r.stt_job_id
        }
      }));
    }
    function buildConnectionLogItems(state) {
      return (state.recentConnectionEvents ?? []).map((e) => ({
        time: e.created_at,
        sortTime: e.created_at,
        area: logAreaId(e.event_type),
        kind: 'event',
        summary: logSummary(e),
        status: e.level,
        needsAttention: logSeverityNeedsAttention(e.level),
        nextAction: nextActionForEvent(e),
        details: {
          type: e.event_type,
          level: e.level,
          sessionId: e.session_id,
          startedAtMs: e.started_at_ms,
          endedAtMs: e.ended_at_ms,
          details: safeJson(e.details_json)
        }
      }));
    }
    function buildSttJobLogItems(state) {
      return (state.recentSttJobs ?? []).map((j) => ({
        time: j.updated_at ?? j.created_at ?? '-',
        sortTime: j.updated_at ?? j.created_at ?? '',
        area: 'stt',
        kind: 'sttJob',
        summary: tr('dashboard.logSummary.sttJob'),
        status: j.status,
        needsAttention: logStatusNeedsAttention(j.status),
        nextAction: jobNextAction(j.status),
        details: {
          id: j.id,
          chunkId: j.chunk_id,
          attempts: j.attempts,
          maxAttempts: j.max_attempts,
          inputAudioPath: j.input_audio_path,
          lastError: j.last_error
        }
      }));
    }
    function buildAiCleanupLogItems(state) {
      return (state.recentAiCleanupJobs ?? []).map((j) => ({
        time: j.updated_at ?? j.created_at ?? '-',
        sortTime: j.updated_at ?? j.created_at ?? '',
        area: 'ai',
        kind: 'aiJob',
        summary: tr('dashboard.logSummary.aiJob'),
        status: j.status,
        needsAttention: logStatusNeedsAttention(j.status),
        nextAction: jobNextAction(j.status),
        details: {
          id: j.id,
          provider: j.provider,
          model: j.model,
          attempts: j.attempts,
          maxAttempts: j.max_attempts,
          failureKind: j.failure_kind,
          lastError: j.last_error,
          nextAttemptAt: j.next_attempt_at,
          promptPath: j.prompt_path,
          rawOutputPath: j.raw_output_path,
          stderrPath: j.stderr_path
        }
      }));
    }
    function buildNotionLogItems(state) {
      const items = [];
      const write = state.latestNotionWrite;
      if (write) {
        items.push({
          time: write.updated_at ?? write.created_at ?? '-',
          sortTime: write.updated_at ?? write.created_at ?? '',
          area: 'notion',
          kind: 'notionWrite',
          summary: tr('dashboard.logSummary.notionWrite'),
          status: write.status,
          needsAttention: logStatusNeedsAttention(write.status),
          nextAction: notionWriteNextAction(write.status),
          details: {
            id: write.id,
            draftId: write.draft_id,
            targetType: write.target_type,
            targetUrl: write.target_url,
            notionPageUrl: write.notion_page_url,
            contentHash: write.content_hash,
            status: write.status,
            statusMessage: write.status_message,
            lastError: write.last_error
          }
        });
      }
      const automation = state.notionAutomation;
      if (automation) {
        items.push({
          time: automation.checkedAt ?? '-',
          sortTime: automation.checkedAt ?? '',
          area: 'notion',
          kind: 'notionAutomation',
          summary: tr('dashboard.logSummary.notionAutomation'),
          status: automation.status,
          needsAttention: logStatusNeedsAttention(automation.status),
          nextAction: automation.userAction ?? notionWriteNextAction(automation.status),
          details: {
            status: automation.status,
            sessionId: automation.sessionId,
            draftId: automation.draftId,
            writeId: automation.writeId,
            pageUrl: automation.pageUrl,
            lastRunStatus: automation.lastRunStatus,
            repairedExpiredLeases: automation.repairedExpiredLeases,
            technicalDetail: automation.technicalDetail
          }
        });
      }
      return items;
    }
    function filterLogItems(items) {
      if (activeLogFilter === 'all') return items;
      if (activeLogFilter === 'needsAttention') {
        return items.filter((item) => item.needsAttention);
      }
      return items.filter((item) => item.area === activeLogFilter);
    }
    function renderLogItemRow(item) {
      return '<tr><td>' + escapeHtml(item.time ?? '-') + '</td><td>' +
        i18n('dashboard.logs.filters.' + item.area) + '</td><td>' +
        escapeHtml(item.summary) + '</td><td>' + escapeHtml(item.nextAction ?? tr('dashboard.common.none')) +
        '</td><td>' + rawDetails(item.details, logDetailsKey(item)) + '</td></tr>';
    }
    function renderLogJobRow(item) {
      return '<tr><td>' + escapeHtml(item.summary) + '</td><td>' +
        escapeHtml(statusLabel(item.status)) + '</td><td>' +
        escapeHtml(item.nextAction ?? tr('dashboard.common.none')) + '</td><td>' +
        rawDetails(item.details, logDetailsKey(item)) + '</td></tr>';
    }
    function logEmptyState() {
      const key = 'dashboard.logs.empty.' + activeLogFilter;
      const message = tr(key);
      return '<div class="log-empty muted">' + escapeHtml(message === key ? tr('dashboard.logs.empty.all') : message) + '</div>';
    }
    function setLogSectionVisibility() {
      const stt = document.getElementById('sttQueueSection');
      const ai = document.getElementById('aiCleanupSection');
      if (stt) stt.hidden = !shouldShowLogAreaSection('stt');
      if (ai) ai.hidden = !shouldShowLogAreaSection('ai');
    }
    function shouldShowLogAreaSection(area) {
      return activeLogFilter === 'all' || activeLogFilter === 'needsAttention' || activeLogFilter === area;
    }
    function logAreaId(type) {
      const text = String(type ?? '').toLowerCase();
      if (['notion', 'database', 'registry', 'property', 'upload'].some((token) => text.includes(token))) return 'notion';
      if (['stt', 'transcript', 'transcription', 'whisper', 'speech'].some((token) => text.includes(token))) return 'stt';
      if (['ai', 'claude', 'draft', 'meeting_notes', 'cleanup'].some((token) => text.includes(token))) return 'ai';
      if (['chunk', 'voice', 'record', 'audio', 'join', 'stop', 'alone', 'connection'].some((token) => text.includes(token))) return 'recording';
      return 'system';
    }
    function logSeverityNeedsAttention(level) {
      return ['error', 'warn', 'warning'].includes(String(level ?? '').toLowerCase());
    }
    function logStatusNeedsAttention(status) {
      return ['failed', 'blocked', 'failed_missing_file', 'repair_required', 'needs_repair'].includes(String(status ?? '').toLowerCase());
    }
    function nextActionForEvent(event) {
      return logSeverityNeedsAttention(event.level)
        ? tr('dashboard.quick.refreshStatus')
        : tr('dashboard.common.none');
    }
    function logSummary(event) {
      return logSeverityNeedsAttention(event.level)
        ? tr('dashboard.logSummary.attentionEvent')
        : tr('dashboard.logSummary.normalEvent');
    }
    function jobNextAction(status) {
      return logStatusNeedsAttention(status)
        ? tr('dashboard.quick.refreshStatus')
        : tr('dashboard.common.none');
    }
    function notionWriteNextAction(status) {
      return logStatusNeedsAttention(status)
        ? tr('dashboard.quick.refreshStatus')
        : tr('dashboard.common.none');
    }
    function safeJson(value) {
      if (!value) return null;
      try {
        return JSON.parse(value);
      } catch (_error) {
        return value;
      }
    }
    function rawDetails(value, key = null) {
      const keyAttr = key ? ' data-details-key="' + escapeHtml(key) + '"' : '';
      return '<details' + keyAttr + '><summary>' + i18n('dashboard.logs.details.toggle') +
        '</summary><pre>' + escapeHtml(JSON.stringify(value, null, 2)) + '</pre></details>';
    }
    function logDetailsKey(item) {
      const details = item.details ?? {};
      return [
        item.kind,
        item.area,
        details.id,
        details.type,
        details.sessionId,
        details.chunkId,
        details.sttJobId,
        details.writeId,
        details.path,
        details.startedAtMs,
        details.endedAtMs
      ].filter((part) => part !== undefined && part !== null && part !== '').join(':');
    }
    function requiredKeysForRole(role) {
      if (role === 'member') {
        return ['member.discordName', 'member.notionPerson', 'member.organization', 'member.roles'];
      }
      if (role === 'task') {
        return ['task.title', 'task.meeting', 'task.workerRelation', 'task.assignee', 'task.role', 'task.dueDate', 'task.status', 'task.evidence', 'task.sourceActionId'];
      }
      return ['meeting.title', 'meeting.date', 'meeting.time', 'meeting.channel', 'meeting.memberRelation', 'meeting.participants', 'meeting.actionItems', 'meeting.status', 'meeting.sessionId', 'meeting.draftId', 'meeting.contentHash', 'meeting.localStatus'];
    }
    function propertyLabel(key) {
      const catalogKey = 'dashboard.db.requiredFields.labels.' + key;
      const label = tr(catalogKey);
      return label === catalogKey ? key : label;
    }
    function formatMs(ms) {
      const value = Number(ms ?? 0);
      const totalSeconds = Math.max(0, Math.floor(value / 1000));
      const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
      const seconds = String(totalSeconds % 60).padStart(2, '0');
      return minutes + ':' + seconds;
    }
    function setHtml(id, html, cacheKeyBuilder = null) {
      const cacheKey = cacheKeyBuilder ? cacheKeyBuilder(html) : html;
      if (sectionCache.get(id) === cacheKey) {
        return;
      }
      sectionCache.set(id, cacheKey);
      const root = document.getElementById(id);
      const openDetails = captureOpenDetails(root);
      root.innerHTML = html;
      restoreOpenDetails(root, openDetails);
    }
    function captureOpenDetails(root) {
      const open = new Set();
      root.querySelectorAll('details[open]').forEach((details, index) => {
        open.add(detailsStateKey(details, index));
      });
      return open;
    }
    function restoreOpenDetails(root, open) {
      if (open.size === 0) return;
      root.querySelectorAll('details').forEach((details, index) => {
        if (open.has(detailsStateKey(details, index))) {
          details.open = true;
        }
      });
    }
    function detailsStateKey(details, index) {
      return details.getAttribute('data-details-key') ?? String(index);
    }
    function metric(label, value) {
      return '<div class="metric"><div class="label">' + escapeHtml(label) +
        '</div><div class="value">' + escapeHtml(value) + '</div></div>';
    }
    function renderPipelineSummary(state) {
      const session = state.currentSession;
      if (!session) {
        return '<div class="metric"><div class="label">' + i18n('dashboard.pipeline.currentSession') +
          ' · ' + escapeHtml(statusLabel('idle')) + '</div>' +
          '<div class="value">' + i18n('dashboard.pipeline.noRecentSession') + '</div><div class="muted">' +
          i18n('dashboard.pipeline.startsAfterRecording') + '</div></div>';
      }
      const sttCounts = countStatuses(state.recentSttJobs ?? []);
      const latestAiJob = (state.recentAiCleanupJobs ?? [])[0];
      const draft = state.latestMeetingNotesDraft;
      const queuedOrProcessingStt =
        (sttCounts.get('queued') ?? 0) + (sttCounts.get('processing') ?? 0);
      const failedStt =
        (sttCounts.get('failed') ?? 0) + (sttCounts.get('failed_missing_file') ?? 0);
      let status = 'recording';
      let message = tr('dashboard.pipeline.recording');
      if (draft) {
        status = 'done';
        message = tr('dashboard.pipeline.draftDone');
      } else if (latestAiJob?.status === 'processing') {
        status = 'running';
        message = tr('dashboard.pipeline.aiRunning');
      } else if (latestAiJob?.status === 'queued') {
        status = 'queued';
        message = Number(latestAiJob.attempts ?? 0) > 0
          ? tr('dashboard.pipeline.aiRetryQueued', {
              attempts: latestAiJob.attempts ?? 0,
              maxAttempts: latestAiJob.max_attempts ?? '-'
            })
          : tr('dashboard.pipeline.aiQueued');
      } else if (latestAiJob?.status === 'failed' || latestAiJob?.status === 'blocked') {
        status = latestAiJob.status;
        message = latestAiJob.status === 'blocked' ? tr('dashboard.pipeline.aiBlocked') : tr('dashboard.pipeline.aiFailed');
      } else if (queuedOrProcessingStt > 0) {
        status = 'stt';
        message = tr('dashboard.pipeline.sttRunning');
      } else if (session.status === 'finalized') {
        status = 'waiting_ai';
        message = failedStt > 0 ? tr('dashboard.pipeline.sttNeedsAttention') : tr('dashboard.pipeline.aiWaiting');
      }
      const aiJob = latestAiJob
        ? '<br>' + i18n('dashboard.pipeline.aiJob') + ': ' + escapeHtml(statusLabel(latestAiJob.status)) +
          ' (' + escapeHtml(latestAiJob.status) + ') / ' + escapeHtml(latestAiJob.provider) +
          ' / ' + escapeHtml(latestAiJob.model)
        : '';
      return '<div class="metric"><div class="label">' + i18n('dashboard.pipeline.currentSession') +
        ' · ' + escapeHtml(statusLabel(status)) + ' (' + escapeHtml(status) + ')' +
        '</div><div class="value ' + runtimeValueClass(status) + '">' + escapeHtml(message) + '</div>' +
        '<div class="muted"><code>' + escapeHtml(session.id) + '</code><br>' +
        i18n('dashboard.pipeline.sessionStatus') + ': ' + escapeHtml(statusLabel(session.status)) +
        ' (' + escapeHtml(session.status) + ')' +
        '<br>' + i18n('dashboard.pipeline.sttCounts') + ': ' +
        escapeHtml(statusLabel('queued')) + ' ' + escapeHtml(sttCounts.get('queued') ?? 0) +
        ' / ' + escapeHtml(statusLabel('processing')) + ' ' + escapeHtml(sttCounts.get('processing') ?? 0) +
        ' / ' + escapeHtml(statusLabel('done')) + ' ' + escapeHtml(sttCounts.get('done') ?? 0) +
        ' / ' + escapeHtml(statusLabel('failed')) + ' ' + escapeHtml(failedStt) + aiJob + '</div></div>';
    }
    function renderAiReadiness(readiness) {
      if (!readiness) {
        return '<div class="muted">' + i18n('dashboard.automation.aiReadinessMissing') + '</div>';
      }
      return '<div class="metric" style="margin-bottom:10px">' +
        '<div class="label">' + escapeHtml(readiness.provider) + ' / ' + escapeHtml(readiness.model) +
        ' · ' + escapeHtml(statusLabel(readiness.status)) + ' (' + escapeHtml(readiness.status) + ')' +
        ' · ' + i18n('dashboard.automation.checkedAt') + ': ' +
        escapeHtml(readiness.checkedAt ?? tr('dashboard.automation.notChecked')) +
        '</div>' + renderHumanDisplay(readiness) + '</div>';
    }
    function renderSttAutomation(automation) {
      if (!automation) {
        return '<div class="metric"><div class="label">STT automation · ' + i18n('dashboard.automation.unavailable') + '</div>' +
          '<div class="value">' + i18n('dashboard.automation.sttMissing') + '</div></div>';
      }
      const run = automation.lastRun
        ? '<div class="muted">' + i18n('dashboard.automation.runStats') + ': ' +
          i18n('dashboard.automation.examined') + ' ' + escapeHtml(automation.lastRun.examined) +
          ' / ' + i18n('dashboard.automation.done') + ' ' + escapeHtml(automation.lastRun.done) +
          ' / ' + i18n('dashboard.automation.missing') + ' ' + escapeHtml(automation.lastRun.missingAudio) +
          ' / ' + i18n('dashboard.automation.failed') + ' ' + escapeHtml(automation.lastRun.failed) +
          ' / ' + i18n('dashboard.automation.more') + ' ' +
          escapeHtml(automation.lastRun.remainingQueuedHint > 0 ? tr('dashboard.automation.yes') : tr('dashboard.automation.no')) + '</div>'
        : '';
      return '<div class="metric" style="margin-bottom:10px">' +
        '<div class="label">' + escapeHtml(automation.provider) + ' / ' + escapeHtml(automation.model) +
        ' · ' + escapeHtml(statusLabel(automation.status)) + ' (' + escapeHtml(automation.status) + ')' +
        ' · ' + i18n('dashboard.automation.checkedAt') + ': ' +
        escapeHtml(automation.checkedAt ?? tr('dashboard.automation.notChecked')) +
        '</div>' + renderHumanDisplay(automation) + run + '</div>';
    }
    function renderAiCleanupAutomation(automation) {
      if (!automation) {
        return '<div class="muted">' + i18n('dashboard.automation.aiCleanupMissing') + '</div>';
      }
      const action = automation.userAction
        ? '<div class="value">' + escapeHtml(automation.userAction) + '</div>'
        : '';
      const stt = automation.stt
        ? '<div class="muted">' + i18n('dashboard.automation.sttDone') + ' ' + escapeHtml(automation.stt.sttDoneCount) +
          ' / ' + i18n('dashboard.automation.sttFailed') + ' ' + escapeHtml(automation.stt.sttFailedCount) +
          ' / ' + i18n('dashboard.automation.sttMissingFile') + ' ' + escapeHtml(automation.stt.sttFailedMissingFileCount) +
          ' / ' + i18n('dashboard.automation.realTranscript') + ' ' + escapeHtml(automation.stt.realTranscriptEntryCount) + '</div>'
        : '';
      const warnings = automation.warnings?.length
        ? '<div class="warn">' + automation.warnings.map(escapeHtml).join(', ') + '</div>'
        : '';
      const progress = automation.progress
        ? '<div class="muted">' + i18n('dashboard.automation.progress') + ' ' + escapeHtml(automation.progress.phase) +
          ' · ' + i18n('dashboard.automation.elapsed') + ' ' + escapeHtml(automation.progress.elapsedMs) + 'ms' +
          ' · ' + i18n('dashboard.automation.lines') + ' ' + escapeHtml(automation.progress.streamLineCount) +
          ' · ' + i18n('dashboard.automation.bytes') + ' ' + escapeHtml(automation.progress.stdoutBytes) +
          ' · ' + i18n('dashboard.automation.last') + ' ' + escapeHtml(automation.progress.lastEventType ?? '-') +
          (automation.progress.repairAttempt ? ' · ' + i18n('dashboard.automation.repair') : '') + '</div>'
        : '';
      const technical = automation.technicalDetail
        ? '<details><summary class="muted">' + i18n('dashboard.automation.details') + '</summary><pre>' + escapeHtml(automation.technicalDetail) + '</pre></details>'
        : '';
      return '<div class="metric" style="margin-bottom:10px">' +
        '<div class="label">' + escapeHtml(automation.provider) + ' / ' + escapeHtml(automation.model) +
        ' · ' + escapeHtml(statusLabel(automation.status)) + ' (' + escapeHtml(automation.status) + ')' +
        ' · ' + i18n('dashboard.automation.checkedAt') + ': ' +
        escapeHtml(automation.checkedAt ?? tr('dashboard.automation.notChecked')) +
        '</div><div class="value ' + runtimeValueClass(automation.status) + '">' + escapeHtml(automation.message) + '</div>' +
        stt + progress + warnings + action + technical + '</div>';
    }
    function renderNotionUpload(state) {
      const notion = state.notion;
      const latest = state.latestNotionWrite;
      if (!notion) {
        return '<div class="metric"><div class="label">notion · ' + i18n('dashboard.automation.unavailable') + '</div>' +
          '<div class="value">' + i18n('dashboard.notionUploadPanel.unavailable') + '</div></div>';
      }
      const page = latest?.notion_page_url
        ? '<div class="value"><a href="' + escapeHtml(latest.notion_page_url) + '" target="_blank" rel="noreferrer">' + i18n('dashboard.notionUploadPanel.openPage') + '</a></div>'
        : '';
      const error = latest?.last_error
        ? renderInlineFailureReason('dashboard.notionUploadPanel.failureReason', latest.last_error)
        : '';
      const automation = state.notionAutomation
        ? '<div style="margin-top:10px"><div class="label">' + i18n('dashboard.notionUploadPanel.automation') +
          ' · ' + escapeHtml(statusLabel(state.notionAutomation.status)) +
          ' (' + escapeHtml(state.notionAutomation.status) + ')</div>' +
          renderHumanDisplay(state.notionAutomation) + '</div>'
        : '';
      const latestDetails = latest
        ? '<details><summary class="muted">' + i18n('dashboard.notionUploadPanel.latestDetails') + '</summary><pre>' + escapeHtml(JSON.stringify({
            target: notion.targetUrl ?? null,
            writeId: latest.id ?? null,
            draftId: latest.draft_id ?? state.latestMeetingNotesDraft?.id ?? null,
            contentHash: latest.content_hash ?? null,
            status: latest.status ?? null
          }, null, 2)) + '</pre></details>'
        : '';
      const buttons = renderNotionButtons(state);
      const managedRegistry = renderManagedRegistryDetails(notion.managedRegistry);
      return '<div class="metric">' +
        '<div class="label">notion · ' + escapeHtml(statusLabel(notion.status)) +
        ' (' + escapeHtml(notion.status) + ') · ' + escapeHtml(notion.uploadMode) + '</div>' +
        renderHumanDisplay(notion, { status: latest?.status ?? notion.status }) +
        managedRegistry + page + automation + error + latestDetails + buttons + '</div>';
    }
    function renderManagedRegistryDetails(registry, options = {}) {
      if (!registry) {
        return '';
      }
      const databases = Array.isArray(registry.databases) ? registry.databases : [];
      if (registry.status === 'missing' && options.compact) {
        return '';
      }
      const rows = databases.map((database) =>
        '<tr><td>' + escapeHtml(database.expectedName ?? database.role) + '</td>' +
        '<td>' + escapeHtml(statusLabel(database.ready ? 'ready' : database.hasDatabase ? 'partial' : 'missing')) + '</td>' +
        '<td>' + escapeHtml((database.mappingCount ?? 0) + ' / ' + (database.expectedMappingCount ?? 0)) + '</td>' +
        '<td>' + (database.url ? '<a href="' + escapeHtml(database.url) + '" target="_blank" rel="noreferrer">' +
          i18n('dashboard.common.openNotion') + '</a>' : '-') + '</td></tr>'
      ).join('');
      const workspace = registry.workspace?.parentPageUrl
        ? '<div class="muted">' + i18n('dashboard.db.registry.parentPage') + ': <a href="' +
          escapeHtml(registry.workspace.parentPageUrl) + '" target="_blank" rel="noreferrer">' +
          i18n('dashboard.common.openNotion') + '</a></div>'
        : '';
      const actionItems = registry.status === 'ready'
        ? '<div class="muted">' + escapeHtml(registry.actionItemUpload?.message ?? tr('dashboard.db.registry.actionItemsReady')) + '</div>'
        : '';
      return '<div style="margin-top:10px">' +
        '<div class="label">' + i18n('dashboard.db.registry.title') + ' · ' + escapeHtml(statusLabel(registry.status)) + '</div>' +
        '<div class="muted">' + i18n('dashboard.db.registry.summary', {
          databaseCount: registry.databaseCount ?? 0,
          expectedDatabaseCount: registry.expectedDatabaseCount ?? 3,
          mappingCount: registry.propertyMappingCount ?? 0,
          expectedMappingCount: registry.expectedPropertyMappingCount ?? 0
        }) + '</div>' +
        workspace +
        (rows ? '<table><thead><tr><th>' + i18n('dashboard.table.database') + '</th><th>' +
          i18n('dashboard.table.status') + '</th><th>' + i18n('dashboard.db.registry.fieldMappings') +
          '</th><th>' + i18n('dashboard.table.notion') + '</th></tr></thead><tbody>' + rows + '</tbody></table>' : '') +
        actionItems + '</div>';
    }
    function renderNotionMetric(state) {
      const latest = state.latestNotionWrite;
      if (latest) {
        const auto = state.notionAutomation?.status ? ' / auto ' + state.notionAutomation.status : '';
        return statusLabel(latest.status) + ' (' + latest.status + ')' +
          (latest.notion_page_url ? ' / ' + tr('dashboard.notionUploadPanel.pageReady') : '') + auto;
      }
      return displayTitle(state.notionAutomation, displayTitle(state.notion));
    }
    function renderNotionButtons(state) {
      return renderNotionRetryButton(state);
    }
    function renderNotionRetryButton(state) {
      const latest = state.latestNotionWrite;
      const failed = ['failed', 'blocked'].includes(String(latest?.status ?? state.notionAutomation?.status ?? ''));
      if (!failed) return '';
      const draftId = state.latestMeetingNotesDraft?.id ?? '';
      const sessionId = state.currentSession?.id ?? '';
      const disabled = (!draftId && !sessionId) || state.notion?.status !== 'ready';
      const disabledAttr = disabled ? ' disabled' : '';
      return '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
        '<button type="button"' + disabledAttr + ' onclick="postNotionAction(\'retry\')">' + i18n('dashboard.notionUploadPanel.retry') + '</button>' +
        '<span class="muted" id="notionActionStatus"></span>' +
        '</div>';
    }
    function renderInlineFailureReason(labelKey, reason) {
      if (!reason) return '';
      return '<details class="muted" style="margin-top:8px"><summary>' + i18n(labelKey) +
        '</summary><pre>' + escapeHtml(reason) + '</pre></details>';
    }
    function renderAloneFinalize(aloneFinalize) {
      if (!aloneFinalize) {
        return '';
      }
      const countdown = aloneFinalize.status === 'countdown' && aloneFinalize.remainingMs !== null
        ? '<div class="muted">' + i18n('dashboard.settings.aloneFinalize.countdown', {
            seconds: Math.ceil(aloneFinalize.remainingMs / 1000)
          }) + '</div>'
        : '';
      const warnings = aloneFinalize.warnings?.length
        ? '<div class="warn">' + aloneFinalize.warnings.map(escapeHtml).join(', ') + '</div>'
        : '';
      return '<div class="metric" style="margin-bottom:10px">' +
        '<div class="label">' + i18n('dashboard.settings.aloneFinalize.title') + ' · ' +
        escapeHtml(statusLabel(aloneFinalize.status)) + ' · ' +
        i18n('dashboard.settings.aloneFinalize.checkedAt') + ': ' +
        escapeHtml(aloneFinalize.checkedAt ?? tr('dashboard.settings.aloneFinalize.notChecked')) +
        '</div>' + renderHumanDisplay(aloneFinalize) +
        countdown + warnings + '</div>';
    }
    function renderAudioControls(c) {
      if (!(c.raw_byte_size > 0) || c.status === 'writing') {
        return '<span class="muted">' + i18n('dashboard.audio.playback.pending') + '</span>';
      }
      const rawUrl = c.audioUrls?.raw;
      if (!rawUrl) {
        return '<span class="muted">' + i18n('dashboard.audio.playback.pending') + '</span>';
      }
      const sttUrl = c.audioUrls?.stt;
      const stt = c.stt_audio_path && c.stt_byte_size > 0 && sttUrl
        ? '<div class="label">' + i18n('dashboard.audio.playback.sttSafe') + '</div>' + audioControl(c.id, 'stt', sttUrl)
        : '';
      return stt + '<div class="label">' + i18n('dashboard.audio.playback.raw') + '</div>' + audioControl(c.id, 'raw', rawUrl);
    }
    function audioControl(chunkId, kind, url) {
      return '<audio controls preload="metadata" data-audio-chunk-id="' +
        escapeHtml(chunkId) + '" data-audio-kind="' + escapeHtml(kind) +
        '" src="' + escapeHtml(url) + '"></audio>';
    }
    function stableAudioRowsCacheKey(html) {
      return html.replace(/tok%65n=[^"'<\s]+/g, 'tok%65n=__signed_audio_token__');
    }
    function syncAudioControlSources(state) {
      const root = document.getElementById('chunks');
      if (!root) return;
      const urls = new Map();
      for (const chunk of state.recentChunks ?? []) {
        if (!chunk?.id) continue;
        if (chunk.audioUrls?.raw) {
          urls.set(chunk.id + ':raw', chunk.audioUrls.raw);
        }
        if (chunk.audioUrls?.stt) {
          urls.set(chunk.id + ':stt', chunk.audioUrls.stt);
        }
      }
      root.querySelectorAll('audio[data-audio-chunk-id][data-audio-kind]').forEach((audio) => {
        const key = audio.getAttribute('data-audio-chunk-id') + ':' +
          audio.getAttribute('data-audio-kind');
        const nextUrl = urls.get(key);
        if (!nextUrl || shouldKeepAudioSource(audio, nextUrl)) {
          return;
        }
        audio.setAttribute('src', nextUrl);
      });
    }
    function shouldKeepAudioSource(audio, nextUrl) {
      const currentUrl = audio.getAttribute('src') ?? '';
      if (currentUrl === nextUrl) {
        return true;
      }
      if (!audio.paused && !audio.ended) {
        return true;
      }
      const currentExpiresAt = signedAudioUrlExpiresAt(currentUrl);
      const nextExpiresAt = signedAudioUrlExpiresAt(nextUrl);
      if (currentExpiresAt && currentExpiresAt - Date.now() > AUDIO_TOKEN_REFRESH_MARGIN_MS) {
        return true;
      }
      return Boolean(currentExpiresAt && nextExpiresAt && nextExpiresAt <= currentExpiresAt);
    }
    function signedAudioUrlExpiresAt(value) {
      try {
        const url = new URL(value, window.location.origin);
        const token = url.searchParams.get('token') ?? url.searchParams.get('tok%65n');
        const expiresAt = Number(String(token ?? '').split('.')[0]);
        return Number.isSafeInteger(expiresAt) ? expiresAt : null;
      } catch (_error) {
        return null;
      }
    }
    function shortHash(value) {
      if (!value) return '';
      return String(value).slice(0, 12);
    }
    function queueSummary(rows) {
      const counts = new Map(rows.map((row) => [row.status, row.count]));
      return ['queued', 'processing', 'done', 'failed', 'failed_missing_file']
        .map((status) => status + ':' + (counts.get(status) ?? 0))
        .join(' / ');
    }
    function countStatuses(rows) {
      const counts = new Map();
      for (const row of rows) {
        counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
      }
      return counts;
    }
    function runtimeValueClass(status) {
      if (['failed', 'blocked', 'not_installed', 'failed_missing_file'].includes(String(status))) {
        return 'error';
      }
      if ([
        'running',
        'queued',
        'processing',
        'partial',
        'countdown',
        'checking',
        'waiting_for_stt',
        'waiting_for_ai_provider',
        'waiting_ai',
        'stt',
      ].includes(String(status))) {
        return 'warn';
      }
      return 'status';
    }
    refresh();
    setInterval(refresh, 3000);
