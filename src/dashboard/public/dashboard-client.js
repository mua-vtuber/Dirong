async function refresh() {
      try {
        const [res, setupRes, i18nRes] = await Promise.all([
          fetch('/api/state', { cache: 'no-store' }),
          fetch('/api/setup/state', { cache: 'no-store' }),
          fetch('/api/i18n', { cache: 'no-store' })
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
      syncActiveViewForSetup(setupSnapshot);
      const runtime = state.runtime ?? {};
      const theme =
        setupSnapshot?.dashboardTheme ??
        setupSnapshot?.defaults?.dashboard?.theme ??
        document.body.dataset.theme;
      document.body.dataset.theme = theme;
      document.getElementById('generatedAt').textContent =
        tr('dashboard.app.generatedAt') + ': ' + (state.generatedAt ?? '-');
      document.getElementById('viewTitle').textContent = titleForView(activeView);
      document.getElementById('audioTitle').textContent = tr('dashboard.audio.title');
      document.getElementById('notesTitle').textContent = tr('dashboard.notes.title');
      document.getElementById('needsAttentionTitle').textContent = tr('dashboard.logs.needsAttention.title');
      document.getElementById('timelineTitle').textContent = tr('dashboard.logs.timeline.title');
      document.getElementById('sttQueueTitle').textContent = tr('dashboard.logs.sttQueue.title');
      document.getElementById('aiCleanupTitle').textContent = tr('dashboard.logs.aiCleanup.title');

      renderSetupWizard(setupSnapshot);
      renderSidebar(state, setupSnapshot);
      renderSetupIncompleteBanner(setupSnapshot);
      setHtml('statusChips', renderStatusChips(state, setupSnapshot));
      setHtml('lockedCards', renderLockedCards(setupSnapshot));
      setHtml('pipeline', renderPhaseFlowCards(state));
      setHtml('metrics', renderAudioSummary(state));
      setHtml('chunks', renderAudioRows(state));
      setHtml('transcripts', renderTranscriptRows(state));
      setHtml('draftPreview', renderDraftPreview(state));
      setHtml('dbTabs', renderTabs([
        ['meeting', 'dashboard.db.tabs.meeting'],
        ['members', 'dashboard.db.tabs.members'],
        ['actionItems', 'dashboard.db.tabs.actionItems'],
        ['customDb', 'dashboard.db.tabs.customDb']
      ], activeDbTab, 'setDbTab'));
      setHtml('settingsTabs', renderTabs([
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
      setHtml('settingsPanel', renderSettingsPanel(state, setupSnapshot));
      setHtml('events', renderEventTimeline(state));
      setHtml('repairs', renderNeedsAttention(state));
      setHtml('sttJobs', renderSttJobTable(state));
      setHtml('aiCleanup', renderAiCleanupTable(state));
      setLogSectionVisibility();
      updateVisibleView();
    }
    function titleForView(view) {
      if (view === 'setup') return tr('dashboard.common.openWizard');
      if (view === 'db') return tr('dashboard.nav.databaseSettings');
      if (view === 'logs') return tr('dashboard.nav.logs');
      if (view === 'settings') return tr('dashboard.nav.settings');
      return tr('dashboard.nav.dashboard');
    }
    function renderSidebar(state, setup) {
      const session = state.currentSession;
      const hasServer = Boolean(session?.guild_id) || (setup?.features?.discord?.guildAllowlistCount ?? 0) > 0;
      const serverLabel = hasServer
        ? tr('dashboard.server.current')
        : tr('dashboard.server.unselected');
      setHtml('sidebarServers',
        '<button type="button" class="server-button">' +
        '<span>' + escapeHtml(serverLabel) + '</span><span class="muted">' +
        escapeHtml(session?.guild_id ?? setup?.features?.discord?.guildAllowlistCount ?? '-') + '</span></button>' +
        '<button type="button" class="server-button" onclick="setActiveView(\'settings\');setSettingsTab(\'discord\')">' +
        i18n('dashboard.server.add.action') + '</button>'
      );
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
        '<button type="button" class="nav-button" title="/dirong start는 Discord에서 실행합니다" disabled>' +
        '<span>' + i18n('dashboard.quick.startRecording') + '</span></button>' +
        '<button type="button" class="nav-button" onclick="refresh()"><span>' +
        i18n('dashboard.quick.refreshStatus') + '</span></button>'
      );
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
      const status = draft ? 'ready' :
        ['processing', 'queued'].includes(String(latestAiJob?.status)) ? 'processing' :
        ['failed', 'blocked'].includes(String(latestAiJob?.status)) ? 'failed' : 'idle';
      const key = draft ? 'dashboard.card.aiNotes.done' :
        status === 'processing' ? 'dashboard.card.aiNotes.processing' :
        status === 'failed' ? 'dashboard.card.aiNotes.failed' :
        'dashboard.card.aiNotes.waiting';
      const detail = latestAiJob
        ? '<div class="muted">' + escapeHtml(latestAiJob.status) + ' / ' + escapeHtml(latestAiJob.provider) + '</div>'
        : '';
      return flowCard('dashboard.card.aiNotes.title', status, i18n(key) + detail);
    }
    function renderNotionFlowCard(state) {
      const latest = state.latestNotionWrite;
      const status = latest?.status === 'done' ? 'ready' :
        ['processing', 'queued', 'retry_wait'].includes(String(state.notionAutomation?.status ?? latest?.status)) ? 'processing' :
        ['failed', 'blocked'].includes(String(latest?.status ?? state.notion?.status)) ? 'failed' : 'idle';
      const key = status === 'ready' ? 'dashboard.card.notionUpload.done' :
        status === 'processing' ? 'dashboard.card.notionUpload.processing' :
        status === 'failed' ? 'dashboard.card.notionUpload.failed' :
        'dashboard.card.notionUpload.waiting';
      const link = latest?.notion_page_url
        ? '<div><a href="' + escapeHtml(latest.notion_page_url) + '" target="_blank" rel="noreferrer">' +
          i18n('dashboard.common.openNotion') + '</a></div>'
        : '';
      return flowCard('dashboard.card.notionUpload.title', status, i18n(key) + link);
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
    function renderSettingsPanel(state, setup) {
      const featureMap = {
        discord: setup?.features?.discord,
        stt: setup?.features?.stt,
        ai: setup?.features?.ai,
        notion: setup?.features?.notion,
        retention: setup?.features?.dataRetention,
        aloneFinalize: state.aloneFinalize,
        reset: null
      };
      if (activeSettingsTab === 'reset') {
        return '<div class="metric"><div class="label">' + i18n('dashboard.settings.tabs.reset') + '</div>' +
          '<div class="value error">' + i18n('dashboard.settings.resetDanger') + '</div></div>';
      }
      const theme =
        setup?.dashboardTheme ??
        setup?.defaults?.dashboard?.theme ??
        document.body.dataset.theme;
      const body = activeSettingsTab === 'retention'
        ? renderRetentionSettings(setup)
        : activeSettingsTab === 'aloneFinalize'
          ? renderAloneFinalize(state.aloneFinalize)
          : '<div class="metric"><div class="label">' + i18n('dashboard.settings.tabs.' + activeSettingsTab) + '</div>' +
            renderHumanDisplay(featureMap[activeSettingsTab]) +
            renderRuntimeEffect(featureMap[activeSettingsTab]?.runtimeEffect) +
            '<div class="muted">' + i18n('dashboard.settings.secretsHidden') + '</div></div>';
      return body + renderThemeSettings(theme, setup);
    }
    function renderRetentionSettings(setup) {
      const retention = setup?.features?.dataRetention;
      const defaultRetention = setup?.defaults?.retention;
      const audioPolicy = retention?.deleteAudioAfterNotionUpload === false
        ? 'dashboard.settings.retention.audioKept'
        : 'dashboard.settings.retention.audioDeleteAfterNotion';
      return '<div class="metric"><div class="label">' + i18n('dashboard.settings.tabs.retention') + '</div>' +
        renderHumanDisplay(retention) +
        '<div class="muted">' + i18n(audioPolicy) + '<br>' +
        i18n('dashboard.settings.retention.textDraftDays', {
          days: retention?.textDraftRetentionDays ??
            defaultRetention?.textDraftRetentionDays ?? '-'
        }) + '</div></div>';
    }
    function renderThemeSettings(theme, setup) {
      const values = setup?.defaults?.dashboard?.themes ?? [];
      const options = values.map((value) =>
        '<label><input type="radio" name="dashboardTheme" value="' + value + '"' +
        (theme === value ? ' checked' : '') + '> ' + i18n('dashboard.settings.theme.' + value) + '</label>'
      ).join('');
      return '<div class="metric" style="margin-top:10px"><div class="label">' +
        i18n('dashboard.settings.theme.label') + '</div><div class="theme-options">' + options + '</div>' +
        '<div class="toolbar"><button type="button" onclick="saveDashboardTheme()">' +
        i18n('dashboard.settings.theme.save') + '</button><span class="muted" id="themeStatus"></span></div></div>';
    }
    async function saveDashboardTheme() {
      const defaults = setupDefaults(setupLocalState.lastSetup);
      const theme = document.querySelector('input[name="dashboardTheme"]:checked')?.value ??
        defaults?.dashboard?.theme;
      if (!theme) return;
      const statusEl = document.getElementById('themeStatus');
      if (statusEl) statusEl.textContent = tr('dashboard.common.saving');
      try {
        const res = await fetch('/api/settings/theme', {
          method: 'POST',
          headers: dashboardJsonHeaders(),
          body: JSON.stringify({ theme })
        });
        const result = await res.json();
        if (statusEl) {
          statusEl.textContent = [
            result.message ?? result.status,
            result.runtimeEffect?.message,
          ].filter(Boolean).join(' · ');
        }
        await refresh();
      } catch (error) {
        if (statusEl) statusEl.textContent = error instanceof Error ? error.message : String(error);
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
        idle: 'dashboard.status.value.idle',
        recording: 'dashboard.status.value.recording',
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
        '</td><td>' + rawDetails(item.details) + '</td></tr>';
    }
    function renderLogJobRow(item) {
      return '<tr><td>' + escapeHtml(item.summary) + '</td><td>' +
        escapeHtml(statusLabel(item.status)) + '</td><td>' +
        escapeHtml(item.nextAction ?? tr('dashboard.common.none')) + '</td><td>' +
        rawDetails(item.details) + '</td></tr>';
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
    function rawDetails(value) {
      return '<details><summary>' + i18n('dashboard.logs.details.toggle') +
        '</summary><pre>' + escapeHtml(JSON.stringify(value, null, 2)) + '</pre></details>';
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
    function setHtml(id, html) {
      if (sectionCache.get(id) === html) {
        return;
      }
      sectionCache.set(id, html);
      document.getElementById(id).innerHTML = html;
    }
    function metric(label, value) {
      return '<div class="metric"><div class="label">' + escapeHtml(label) +
        '</div><div class="value">' + escapeHtml(value) + '</div></div>';
    }
    function renderPipelineSummary(state) {
      const session = state.currentSession;
      if (!session) {
        return '<div class="metric"><div class="label">current session · idle</div>' +
          '<div class="value">최근 세션 없음</div><div class="muted">녹음이 시작되면 여기에 진행 상태가 표시됩니다.</div></div>';
      }
      const sttCounts = countStatuses(state.recentSttJobs ?? []);
      const latestAiJob = (state.recentAiCleanupJobs ?? [])[0];
      const draft = state.latestMeetingNotesDraft;
      const queuedOrProcessingStt =
        (sttCounts.get('queued') ?? 0) + (sttCounts.get('processing') ?? 0);
      const failedStt =
        (sttCounts.get('failed') ?? 0) + (sttCounts.get('failed_missing_file') ?? 0);
      let status = 'recording';
      let message = '녹음 중';
      if (draft) {
        status = 'done';
        message = '회의록 draft 생성 완료';
      } else if (latestAiJob?.status === 'processing') {
        status = 'running';
        message = '회의록 생성 중';
      } else if (latestAiJob?.status === 'queued') {
        status = 'queued';
        message = 'AI cleanup job 대기 중';
      } else if (latestAiJob?.status === 'failed' || latestAiJob?.status === 'blocked') {
        status = latestAiJob.status;
        message = latestAiJob.status === 'blocked' ? '회의록 생성 보류' : '회의록 생성 실패';
      } else if (queuedOrProcessingStt > 0) {
        status = 'stt';
        message = 'STT 처리 중';
      } else if (session.status === 'finalized') {
        status = 'waiting_ai';
        message = failedStt > 0 ? 'STT 확인 필요' : 'AI cleanup 대기 중';
      }
      const aiJob = latestAiJob
        ? '<br>AI job: ' + escapeHtml(latestAiJob.status) + ' / ' + escapeHtml(latestAiJob.provider) +
          ' / ' + escapeHtml(latestAiJob.model)
        : '';
      return '<div class="metric"><div class="label">current session · ' + escapeHtml(status) +
        '</div><div class="value ' + runtimeValueClass(status) + '">' + escapeHtml(message) + '</div>' +
        '<div class="muted"><code>' + escapeHtml(session.id) + '</code><br>' +
        'session: ' + escapeHtml(session.status) +
        '<br>STT: queued ' + escapeHtml(sttCounts.get('queued') ?? 0) +
        ' / processing ' + escapeHtml(sttCounts.get('processing') ?? 0) +
        ' / done ' + escapeHtml(sttCounts.get('done') ?? 0) +
        ' / failed ' + escapeHtml(failedStt) + aiJob + '</div></div>';
    }
    function renderAiReadiness(readiness) {
      if (!readiness) {
        return '<div class="muted">AI readiness snapshot이 아직 없습니다.</div>';
      }
      return '<div class="metric" style="margin-bottom:10px">' +
        '<div class="label">' + escapeHtml(readiness.provider) + ' / ' + escapeHtml(readiness.model) +
        ' · ' + escapeHtml(readiness.status) + ' · ' + escapeHtml(readiness.checkedAt ?? 'not checked') +
        '</div>' + renderHumanDisplay(readiness) + '</div>';
    }
    function renderSttAutomation(automation) {
      if (!automation) {
        return '<div class="metric"><div class="label">STT automation · unavailable</div>' +
          '<div class="value">STT 자동화 snapshot이 아직 없습니다.</div></div>';
      }
      const run = automation.lastRun
        ? '<div class="muted">examined ' + escapeHtml(automation.lastRun.examined) +
          ' / done ' + escapeHtml(automation.lastRun.done) +
          ' / missing ' + escapeHtml(automation.lastRun.missingAudio) +
          ' / failed ' + escapeHtml(automation.lastRun.failed) +
          ' / more ' + escapeHtml(automation.lastRun.remainingQueuedHint > 0 ? 'yes' : 'no') + '</div>'
        : '';
      return '<div class="metric" style="margin-bottom:10px">' +
        '<div class="label">' + escapeHtml(automation.provider) + ' / ' + escapeHtml(automation.model) +
        ' · ' + escapeHtml(automation.status) + ' · ' + escapeHtml(automation.checkedAt ?? 'not checked') +
        '</div>' + renderHumanDisplay(automation) + run + '</div>';
    }
    function renderAiCleanupAutomation(automation) {
      if (!automation) {
        return '<div class="muted">AI cleanup 자동화 snapshot이 아직 없습니다.</div>';
      }
      const action = automation.userAction
        ? '<div class="value">' + escapeHtml(automation.userAction) + '</div>'
        : '';
      const stt = automation.stt
        ? '<div class="muted">STT done ' + escapeHtml(automation.stt.sttDoneCount) +
          ' / failed ' + escapeHtml(automation.stt.sttFailedCount) +
          ' / missing file ' + escapeHtml(automation.stt.sttFailedMissingFileCount) +
          ' / real transcript ' + escapeHtml(automation.stt.realTranscriptEntryCount) + '</div>'
        : '';
      const warnings = automation.warnings?.length
        ? '<div class="warn">' + automation.warnings.map(escapeHtml).join(', ') + '</div>'
        : '';
      const progress = automation.progress
        ? '<div class="muted">progress ' + escapeHtml(automation.progress.phase) +
          ' · elapsed ' + escapeHtml(automation.progress.elapsedMs) + 'ms' +
          ' · lines ' + escapeHtml(automation.progress.streamLineCount) +
          ' · bytes ' + escapeHtml(automation.progress.stdoutBytes) +
          ' · last ' + escapeHtml(automation.progress.lastEventType ?? '-') +
          (automation.progress.repairAttempt ? ' · repair' : '') + '</div>'
        : '';
      const technical = automation.technicalDetail
        ? '<details><summary class="muted">자동화 세부정보</summary><pre>' + escapeHtml(automation.technicalDetail) + '</pre></details>'
        : '';
      return '<div class="metric" style="margin-bottom:10px">' +
        '<div class="label">' + escapeHtml(automation.provider) + ' / ' + escapeHtml(automation.model) +
        ' · ' + escapeHtml(automation.status) + ' · ' + escapeHtml(automation.checkedAt ?? 'not checked') +
        '</div><div class="value ' + runtimeValueClass(automation.status) + '">' + escapeHtml(automation.message) + '</div>' +
        stt + progress + warnings + action + technical + '</div>';
    }
    function renderNotionUpload(state) {
      const notion = state.notion;
      const latest = state.latestNotionWrite;
      if (!notion) {
        return '<div class="metric"><div class="label">notion · unavailable</div>' +
          '<div class="value">Notion 상태를 아직 불러오지 못했습니다.</div></div>';
      }
      const page = latest?.notion_page_url
        ? '<div class="value"><a href="' + escapeHtml(latest.notion_page_url) + '" target="_blank" rel="noreferrer">Open Notion page</a></div>'
        : '';
      const error = latest?.last_error
        ? '<details><summary class="muted">last error</summary><pre>' + escapeHtml(latest.last_error) + '</pre></details>'
        : '';
      const automation = state.notionAutomation
        ? '<div style="margin-top:10px"><div class="label">automation · ' + escapeHtml(state.notionAutomation.status) + '</div>' +
          renderHumanDisplay(state.notionAutomation) + '</div>'
        : '';
      const latestDetails = latest
        ? '<details><summary class="muted">최근 Notion write 자세히 보기</summary><pre>' + escapeHtml(JSON.stringify({
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
        '<div class="label">notion · ' + escapeHtml(notion.status) + ' · ' + escapeHtml(notion.uploadMode) + '</div>' +
        renderHumanDisplay(notion, { status: latest?.status ?? notion.status }) +
        managedRegistry + page + automation + latestDetails + buttons + error + '</div>';
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
        return latest.status + (latest.notion_page_url ? ' / page ready' : '') + auto;
      }
      return displayTitle(state.notionAutomation, displayTitle(state.notion));
    }
    function renderNotionButtons(state) {
      const draftId = state.latestMeetingNotesDraft?.id ?? '';
      const sessionId = state.currentSession?.id ?? '';
      const disabled = (!draftId && !sessionId) || state.notion?.status !== 'ready';
      const disabledAttr = disabled ? ' disabled' : '';
      return '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
        '<button type="button"' + disabledAttr + ' onclick="postNotionAction(\'send\')">Send to Notion</button>' +
        '<button type="button"' + disabledAttr + ' onclick="postNotionAction(\'retry\')">Retry</button>' +
        '<span class="muted" id="notionActionStatus"></span>' +
        '</div>';
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
        ? '<div class="label">' + i18n('dashboard.audio.playback.sttSafe') + '</div><audio controls preload="metadata" src="' + escapeHtml(sttUrl) + '"></audio>'
        : '';
      return stt + '<div class="label">' + i18n('dashboard.audio.playback.raw') + '</div><audio controls preload="metadata" src="' + escapeHtml(rawUrl) + '"></audio>';
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
