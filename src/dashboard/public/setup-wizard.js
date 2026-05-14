const setupWizardI18nPrefix = 'dashboard.setupWizard.';
    const discordDeveloperPortalUrl = 'https://discord.com/developers/home';
    const notionDevelopersUrl = 'https://www.notion.so/developers';
    const setupStepDefinitions = [
      { id: 'language', titleKey: 'steps.language' },
      { id: 'discord', titleKey: 'steps.discord' },
      { id: 'guild', titleKey: 'steps.guild' },
      { id: 'stt', titleKey: 'steps.stt' },
      { id: 'ai', titleKey: 'steps.ai' },
      { id: 'notionToken', titleKey: 'steps.notionToken' },
      { id: 'notionParent', titleKey: 'steps.notionParent' },
      { id: 'notionManaged', titleKey: 'steps.notionManaged' },
      { id: 'projectName', titleKey: 'steps.projectName' }
    ];
    const setupClaudeModels = ['haiku', 'sonnet', 'opus'];
    function setupWizardKey(key) {
      return setupWizardI18nPrefix + key;
    }
    function setupWizardText(key, params = {}) {
      return i18n(setupWizardKey(key), params);
    }
    function setupWizardRawText(key, params = {}) {
      return tr(setupWizardKey(key), params);
    }
    function renderSetupWizard(setup) {
      const root = document.getElementById('setupWizard');
      const active = document.activeElement;
      if (
        !setupLocalState.forceRender &&
        active &&
        root.contains(active) &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)
      ) {
        return;
      }
      if (!setup) {
        setHtml('setupWizard', '<div class="setup-top"><div><h2 class="setup-title">' + setupWizardText('title') + '</h2>' +
          '<p class="setup-copy">' + setupWizardText('loading') + '</p></div></div>');
        return;
      }
      setupLocalState.lastSetup = setup;
      const firstIncomplete = setupStepDefinitions.findIndex((step) => !isSetupStepReady(setup, step.id));
      const currentLimit = firstIncomplete >= 0 ? firstIncomplete : setupStepDefinitions.length - 1;
      if (!Number.isFinite(setupLocalState.stepIndex) || setupLocalState.stepIndex < 0) {
        setupLocalState.stepIndex = 0;
      }
      if (setupLocalState.stepIndex > currentLimit && !isSetupStepReady(setup, setupStepDefinitions[setupLocalState.stepIndex]?.id)) {
        setupLocalState.stepIndex = currentLimit;
        window.localStorage.setItem('dirong.setup.stepIndex', String(setupLocalState.stepIndex));
      }
      const activeStep = setupStepDefinitions[setupLocalState.stepIndex] ?? setupStepDefinitions[0];
      const shouldAutoCheckDiscord = prepareDiscordAutoCheck(setup, activeStep.id);
      const progress = setupStepDefinitions.filter((step) => isSetupStepReady(setup, step.id)).length;
      const setupAction = setup.status === 'ready'
        ? '<button type="button" onclick="setupGoDashboard()">' + setupWizardText('actions.goDashboard') + '</button>'
        : '<button type="button" onclick="skipSetupToDashboard()">' + setupWizardText('actions.skipToDashboard') + '</button>';
      const stepButtons = setupStepDefinitions.map((step, index) => {
        const ready = isSetupStepReady(setup, step.id);
        const current = index === setupLocalState.stepIndex;
        const disabled = index > currentLimit && !ready;
        const className = 'setup-step' + (current ? ' is-active' : '') + (ready ? ' is-ready' : '');
        const mark = ready ? '✓ ' : current ? '• ' : '';
        return '<button type="button" class="' + className + '"' +
          (disabled ? ' disabled' : '') + ' onclick="setSetupStep(' + index + ')">' +
          mark + setupWizardText(step.titleKey) + '</button>';
      }).join('');
      setHtml('setupWizard',
        '<div class="setup-top"><div><h2 class="setup-title">' + setupWizardText('title') + '</h2>' +
        '<p class="setup-copy">' + setupWizardText('intro') + '</p>' +
        '</div><div class="setup-progress-panel"><div class="setup-progress">' +
        setupWizardText('progress', { completed: progress, total: setupStepDefinitions.length }) +
        '<br>' + escapeHtml(setupWizardStatusLabel(setup.status)) + '</div>' + setupAction + '</div></div>' +
        '<div class="setup-layout"><nav class="setup-steps">' + stepButtons + '</nav>' +
        '<div class="setup-panel">' + renderSetupStepContent(activeStep.id, setup) +
        renderSetupResult() + '</div></div>'
      );
      if (shouldAutoCheckDiscord) {
        window.setTimeout(setupAutoTestDiscord, 0);
      }
    }
    function setupWizardStatusLabel(status) {
      return typeof statusLabel === 'function' ? statusLabel(status) : String(status ?? 'not_configured');
    }
    function isSetupStepReady(setup, id) {
      if (!setup) return false;
      if (id === 'language') return setup.locale === 'ko' || setup.locale === 'en';
      if (id === 'discord') {
        return isDiscordCredentialsSaved(setup) && setupLocalState.discordConnectionStatus === 'verified';
      }
      if (id === 'guild') return (setup.features?.discord?.guildAllowlistCount ?? 0) > 0;
      if (id === 'stt') {
        if (setup.features?.stt?.status !== 'ready') return false;
        const provider = setupLocalState.sttProvider ?? setup.features?.stt?.provider;
        return provider === 'local-whisper'
          ? setupLocalState.localWhisperInstall?.status === 'done'
          : true;
      }
      if (id === 'ai') return setup.features?.ai?.status === 'ready';
      if (id === 'notionToken') return setup.secrets?.notion?.configured === true;
      if (id === 'notionParent') return setup.features?.notion?.parentPageConfigured === true;
      if (id === 'notionManaged') return setup.features?.notion?.managedRegistryReady === true;
      if (id === 'projectName') return isSetupProjectNameReady(setup);
      return false;
    }
    function isSetupProjectNameReady(setup) {
      const name = setup?.projectSetup?.activeProject?.name;
      return Boolean(name && !['Default Project', 'Untitled Project', 'Fresh Project'].includes(name));
    }
    function isDiscordCredentialsSaved(setup) {
      return Boolean(setup?.features?.discord?.applicationIdConfigured && setup?.secrets?.discordBot?.configured);
    }
    function prepareDiscordAutoCheck(setup, activeStepId) {
      if (activeStepId !== 'discord' || !isDiscordCredentialsSaved(setup) || setupLocalState.busy) {
        return false;
      }
      if (['checking', 'verified', 'failed'].includes(setupLocalState.discordConnectionStatus)) {
        return false;
      }
      if (setupLocalState.discordConnectionAutoStarted) {
        return false;
      }
      setupLocalState.discordConnectionStatus = 'checking';
      setupLocalState.discordConnectionAutoStarted = true;
      return true;
    }
    function resetDiscordConnectionCheck() {
      setupLocalState.discordConnectionStatus = 'idle';
      setupLocalState.discordConnectionAutoStarted = false;
    }
    function renderSetupStepContent(id, setup) {
      if (id === 'language') return renderSetupLanguage(setup);
      if (id === 'discord') return renderSetupDiscord(setup);
      if (id === 'guild') return renderSetupGuild(setup);
      if (id === 'stt') return renderSetupStt(setup);
      if (id === 'ai') return renderSetupAi(setup);
      if (id === 'notionToken') return renderSetupNotionToken(setup);
      if (id === 'notionParent') return renderSetupNotionParent(setup);
      if (id === 'notionManaged') return renderSetupNotionManaged(setup);
      return renderSetupProjectName(setup);
    }
    function renderSetupLanguage(setup) {
      const locale = setup.locale ?? setupDefaults(setup)?.dashboard?.locale;
      return '<h3>' + setupWizardText('language.title') + '</h3>' +
        '<p class="setup-copy">' + setupWizardText('language.description') + '</p>' +
        '<div class="setup-cards">' +
        setupRadioCard(
          'setupLanguage',
          'ko',
          locale,
          setupWizardRawText('language.korean.title'),
          setupWizardRawText('language.korean.description')
        ) +
        setupRadioCard(
          'setupLanguage',
          'en',
          locale,
          setupWizardRawText('language.english.title'),
          setupWizardRawText('language.english.description')
        ) +
        '</div>' +
        (locale === 'en' ? '<div class="setup-notice">' + setupWizardText('language.englishNotice') + '</div>' : '') +
        '<div class="setup-actions"><button type="button" onclick="setupSaveLanguage()">' +
        setupWizardText('actions.saveLanguage') + '</button>' +
        setupNextButton(setup, 'language') + '</div>';
    }
    function renderSetupDiscord(setup) {
      return '<h3>' + setupWizardText('discord.title') + '</h3>' +
        '<p class="setup-copy">' + setupWizardText('discord.description') + '</p>' +
        renderDiscordSetupGuides() +
        '<div class="setup-form">' +
        '<label>' + setupWizardText('discord.applicationIdLabel') +
        '<input id="setupDiscordApplicationId" type="text" inputmode="numeric" autocomplete="off" placeholder="' +
        setupWizardText('discord.applicationIdPlaceholder') + '"></label>' +
        '<div class="setup-actions"><button type="button" onclick="setupSaveDiscordApplicationId()">' +
        setupWizardText('actions.saveDiscordApplicationId') + '</button></div>' +
        '<label>' + setupWizardText('discord.botTokenLabel') +
        '<input id="setupDiscordBotToken" type="password" autocomplete="off" placeholder="' +
        setupWizardText('discord.botTokenPlaceholder') + '"></label>' +
        '<div class="setup-actions"><button type="button" onclick="setupSaveDiscordBotToken()">' +
        setupWizardText('actions.saveDiscordBotToken') + '</button>' +
        setupNextButton(setup, 'discord') + '</div>' +
        '</div>' +
        renderDiscordConnectionCheck(setup);
    }
    function renderDiscordSetupGuides() {
      return '<div class="setup-help-grid">' +
        renderSetupGuide('discord.guide.applicationIdTitle', [
          renderDiscordPortalStep('discord.guide.applicationIdStep1Suffix'),
          setupWizardText('discord.guide.applicationIdStep2'),
          setupWizardText('discord.guide.applicationIdStep3'),
          setupWizardText('discord.guide.applicationIdStep4'),
          setupWizardText('discord.guide.applicationIdStep5'),
          setupWizardText('discord.guide.applicationIdStep6')
        ]) +
        renderSetupGuide('discord.guide.botTokenTitle', [
          setupWizardText('discord.guide.botTokenStep1'),
          setupWizardText('discord.guide.botTokenStep2'),
          setupWizardText('discord.guide.botTokenStep3'),
          setupWizardText('discord.guide.botTokenStep4'),
          setupWizardText('discord.guide.botTokenStep5')
        ]) +
        '</div>';
    }
    function renderDiscordPortalStep(suffixKey) {
      return '<a href="' + discordDeveloperPortalUrl + '" target="_blank" rel="noreferrer">' +
        setupWizardText('discord.guide.portalLink') + '</a>' + setupWizardText(suffixKey);
    }
    function renderSetupGuide(titleKey, steps) {
      return '<section class="setup-help"><h4>' + setupWizardText(titleKey) + '</h4><ol>' +
        steps.map((step) => '<li>' + step + '</li>').join('') + '</ol></section>';
    }
    function renderDiscordConnectionCheck(setup) {
      if (!isDiscordCredentialsSaved(setup)) {
        return '';
      }
      const status = setupLocalState.discordConnectionStatus;
      if (status === 'verified') {
        return '<section class="setup-help setup-ok setup-connection-card"><h4>' +
          setupWizardText('discord.connectionCheck.verifiedTitle') + '</h4>' +
          '<p>' + setupWizardText('discord.connectionCheck.verifiedDescription') + '</p></section>';
      }
      if (status === 'failed') {
        return '<section class="setup-help setup-error setup-connection-card"><h4>' +
          setupWizardText('discord.connectionCheck.failedTitle') + '</h4>' +
          '<p>' + setupWizardText('discord.connectionCheck.failedDescription') + '</p></section>';
      }
      return '<section class="setup-help setup-connection-card"><h4>' +
        setupWizardText('discord.connectionCheck.checkingTitle') + '</h4>' +
        '<p>' + setupWizardText('discord.connectionCheck.checkingDescription') + '</p></section>';
    }
    function renderSetupGuild(setup) {
      const inviteUrl = setup.wizard?.inviteUrl ?? setupLocalState.lastResult?.inviteUrl ?? '';
      const guilds = setupLocalState.guilds ?? [];
      const list = guilds.length
        ? '<div class="setup-guild-list">' + guilds.map((guild) =>
            '<label class="setup-guild"><input type="radio" name="setupGuild" value="' + escapeHtml(guild.id) + '"' +
            (setupLocalState.selectedGuildId === guild.id ? ' checked' : '') +
            ' onchange="setupRememberGuild(this.value)"> <strong>' + escapeHtml(guild.name) + '</strong></label>'
          ).join('') + '</div>'
        : '<div class="muted">' + setupWizardText('guild.empty') + '</div>';
      return '<h3>' + setupWizardText('guild.title') + '</h3>' +
        '<p class="setup-copy">' + setupWizardText('guild.description') + '</p>' +
        (inviteUrl ? renderSetupGuildInvite(inviteUrl) : '') +
        '<div class="setup-actions"><button type="button" onclick="setupLoadGuilds()">' +
        setupWizardText('actions.loadGuilds') + '</button></div>' +
        list +
        '<div class="setup-actions"><button type="button" onclick="setupSaveGuild()">' +
        setupWizardText('actions.saveSelectedGuild') + '</button>' +
        setupNextButton(setup, 'guild') + '</div>';
    }
    function renderSetupGuildInvite(inviteUrl) {
      return '<section class="setup-help"><h4>' + setupWizardText('guild.invite.title') + '</h4>' +
        '<p>' + setupWizardText('guild.invite.description') + '</p>' +
        '<a href="' + escapeHtml(inviteUrl) + '" target="_blank" rel="noreferrer">' +
        setupWizardText('guild.invite.link') + '</a></section>';
    }
    function renderSetupStt(setup) {
      const defaults = setupDefaults(setup);
      const provider = setupLocalState.sttProvider ?? defaults?.stt?.provider;
      const model = setupLocalState.sttModel ?? defaults?.stt?.localWhisper?.model;
      if (provider === 'local-whisper') {
        setupEnsureLocalWhisperInstallStatusLoaded();
      }
      const installRunning = provider === 'local-whisper' &&
        setupLocalState.localWhisperInstall?.status === 'running';
      return '<h3>' + setupWizardText('stt.title') + '</h3>' +
        '<p class="setup-copy">' + setupWizardText('stt.description') + '</p>' +
        '<div class="setup-cards">' +
        setupRadioCard(
          'setupSttProvider',
          'local-whisper',
          provider,
          setupWizardRawText('stt.localWhisper.title'),
          setupWizardRawText('stt.localWhisper.description'),
          'setupRememberSttProvider'
        ) +
        setupRadioCard(
          'setupSttProvider',
          'openai',
          provider,
          setupWizardRawText('stt.openAi.title'),
          setupWizardRawText('stt.openAi.description'),
          'setupRememberSttProvider'
        ) +
        '</div>' +
        (provider === 'local-whisper'
          ? '<div class="setup-cards">' +
            setupRadioCard(
              'setupSttModel',
              'small',
              model,
              setupWizardRawText('stt.smallModel.title'),
              setupWizardRawText('stt.smallModel.description'),
              'setupRememberSttModel'
            ) +
            setupRadioCard(
              'setupSttModel',
              'medium',
              model,
              setupWizardRawText('stt.mediumModel.title'),
              setupWizardRawText('stt.mediumModel.description'),
              'setupRememberSttModel'
            ) +
            '</div>' +
            renderLocalWhisperInstallStatus()
          : '<div class="setup-form"><label>' + setupWizardText('stt.openAi.apiKeyLabel') +
            '<input id="setupOpenAiApiKey" type="password" autocomplete="off" placeholder="' +
            setupWizardText('stt.openAi.apiKeyPlaceholder') + '"></label></div>') +
        '<div class="setup-actions"><button type="button"' +
        ((setupLocalState.busy || installRunning) ? ' disabled' : '') +
        ' onclick="setupSaveStt()">' +
        setupWizardText(provider === 'local-whisper' ? 'actions.saveAndInstallStt' : 'actions.saveAndTestOpenAi') +
        '</button>' +
        setupNextButton(setup, 'stt') + '</div>';
    }
    function renderLocalWhisperInstallStatus() {
      const install = setupLocalState.localWhisperInstall;
      if (!install) {
        return '<section class="setup-help setup-install-card"><h4>' +
          setupWizardText('stt.localWhisper.install.title') + '</h4><p>' +
          setupWizardText('stt.localWhisper.install.idle') + '</p></section>';
      }
      const status = String(install.status ?? 'idle');
      const stage = String(install.stage ?? 'idle');
      const titleKey = status === 'done'
        ? 'stt.localWhisper.install.doneTitle'
        : status === 'failed'
          ? 'stt.localWhisper.install.failedTitle'
          : status === 'running'
            ? 'stt.localWhisper.install.runningTitle'
            : 'stt.localWhisper.install.title';
      const statusClass = status === 'done'
        ? ' setup-ok'
        : status === 'failed'
          ? ' setup-error'
          : '';
      const bar = status === 'running'
        ? '<div class="setup-loading-bar" aria-hidden="true"><span></span></div>'
        : '';
      const detail = install.detail
        ? '<div class="muted">' + escapeHtml(install.detail) + '</div>'
        : '';
      const log = install.lastLog
        ? '<details><summary class="muted">' + setupWizardText('stt.localWhisper.install.lastLog') +
          '</summary><pre>' + escapeHtml(install.lastLog) + '</pre></details>'
        : '';
      return '<section class="setup-help setup-install-card' + statusClass + '"><h4>' +
        setupWizardText(titleKey) + '</h4><p>' +
        escapeHtml(localWhisperInstallStageText(stage, install.message)) +
        '</p>' + bar + detail + log + '</section>';
    }
    function localWhisperInstallStageText(stage, fallback) {
      const key = setupWizardKey('stt.localWhisper.install.stages.' + stage);
      const text = tr(key);
      return text === key ? (fallback ?? stage) : text;
    }
    function renderSetupAi(setup) {
      const defaults = setupDefaults(setup);
      const mode = setupLocalState.aiMode ?? defaults?.ai?.mode;
      const model = setupNormalizeClaudeModel(
        setupLocalState.aiModel ?? setup.features?.ai?.model ?? defaults?.ai?.model
      );
      return '<h3>' + setupWizardText('ai.title') + '</h3>' +
        '<p class="setup-copy">' + setupWizardText('ai.description') + '</p>' +
        '<div class="setup-cards">' +
        setupRadioCard(
          'setupAiMode',
          'cli',
          mode,
          setupWizardRawText('ai.cli.title'),
          setupWizardRawText('ai.cli.description'),
          'setupRememberAiMode'
        ) +
        setupRadioCard(
          'setupAiMode',
          'api',
          mode,
          setupWizardRawText('ai.api.title'),
          setupWizardRawText('ai.api.description'),
          'setupRememberAiMode'
        ) +
        '</div>' +
        '<div class="setup-form">' +
        (mode === 'cli'
          ? ''
          : '<label>' + setupWizardText('ai.api.apiKeyLabel') +
            '<input id="setupClaudeApiKey" type="password" autocomplete="off" placeholder="' +
            setupWizardText('ai.apiKeyPlaceholder') + '"></label>') +
        '<label>' + setupWizardText('ai.modelLabel') +
        '<select id="setupClaudeModel" onchange="setupRememberClaudeModel(this.value)">' +
        renderClaudeModelOptions(model) + '</select></label>' +
        '</div><div class="setup-actions"><button type="button" onclick="setupSaveClaude()">' +
        setupWizardText('actions.saveClaude') + '</button>' +
        '<button type="button" onclick="setupTestClaude()">' + setupWizardText('actions.testConnection') +
        '</button>' + setupNextButton(setup, 'ai') + '</div>';
    }
    function renderSetupNotionToken(setup) {
      return '<h3>' + setupWizardText('notionToken.title') + '</h3>' +
        '<p class="setup-copy">' + setupWizardText('notionToken.description') + '</p>' +
        renderNotionTokenGuide() +
        '<div class="setup-form"><label>' + setupWizardText('notionToken.label') +
        '<input id="setupNotionToken" type="password" autocomplete="off" placeholder="' +
        setupWizardText('notionToken.placeholder') + '"></label></div>' +
        '<div class="setup-actions"><button type="button" onclick="setupSaveNotionToken()">' +
        setupWizardText('actions.saveNotionToken') + '</button>' +
        setupNextButton(setup, 'notionToken') + '</div>';
    }
    function renderNotionTokenGuide() {
      return '<div class="setup-help-grid">' +
        renderSetupGuide('notionToken.guide.title', [
          renderNotionDevelopersStep('notionToken.guide.step1Suffix'),
          setupWizardText('notionToken.guide.step2'),
          setupWizardText('notionToken.guide.step3'),
          setupWizardText('notionToken.guide.step4'),
          setupWizardText('notionToken.guide.step5'),
          setupWizardText('notionToken.guide.step6'),
          setupWizardText('notionToken.guide.step7'),
          setupWizardText('notionToken.guide.step8')
        ]) +
        '</div>';
    }
    function renderNotionDevelopersStep(suffixKey) {
      return '<a href="' + notionDevelopersUrl + '" target="_blank" rel="noreferrer">' +
        setupWizardText('notionToken.guide.profileLink') + '</a>' + setupWizardText(suffixKey);
    }
    function renderSetupNotionParent(setup) {
      return '<h3>' + setupWizardText('notionParent.title') + '</h3>' +
        '<p class="setup-copy">' + setupWizardText('notionParent.description') + '</p>' +
        '<div class="setup-form"><label>' + setupWizardText('notionParent.label') +
        '<input id="setupNotionParentPageUrl" type="url" autocomplete="off" placeholder="' +
        setupWizardText('notionParent.placeholder') + '"></label></div>' +
        '<div class="setup-actions"><button type="button" onclick="setupSaveNotionParent()">' +
        setupWizardText('actions.saveParentPage') + '</button>' +
        '<button type="button" onclick="setupVerifyNotionParent()">' + setupWizardText('actions.verifyAccess') +
        '</button>' + setupNextButton(setup, 'notionParent') + '</div>';
    }
    function renderSetupNotionManaged(setup) {
      const locale = setup.locale ?? setupDefaults(setup)?.dashboard?.locale;
      const unsupported = locale !== 'ko';
      const notice = unsupported
        ? '<div class="setup-notice">' + setupWizardText('notionManaged.unsupportedNotice', { locale }) + '</div>'
        : '<div class="setup-notice setup-ok">' + setupWizardText('notionManaged.readyNotice') + '</div>';
      return '<h3>' + setupWizardText('notionManaged.title') + '</h3>' +
        '<p class="setup-copy">' + setupWizardText('notionManaged.description') + '</p>' +
        notice +
        '<div class="setup-actions"><button type="button"' + (unsupported ? ' disabled' : '') +
        ' onclick="setupCreateManagedDatabases()">' + setupWizardText('actions.createManagedDb') + '</button>' +
        setupNextButton(setup, 'notionManaged') + '</div>' +
        renderManagedRegistryDetails(setup.features?.notion?.managedRegistry, { compact: true }) +
        renderCreatedNotionDatabases();
    }
    function renderSetupProjectName(setup) {
      const projectName = setup?.projectSetup?.activeProject?.name ?? '';
      const ready = setup.status === 'ready' || isSetupProjectNameReady(setup);
      const restartNotice = ready
        ? '<section class="setup-help setup-ok"><h4>' + setupWizardText('projectName.restartTitle') +
          '</h4><p>' + setupWizardText('projectName.restartDescription') + '</p></section>'
        : '';
      const goDashboard = ready
        ? '<button type="button" onclick="setupGoDashboard()">' + setupWizardText('actions.goDashboard') + '</button>'
        : '';
      return '<h3>' + setupWizardText('projectName.title') + '</h3>' +
        '<p class="setup-copy">' + setupWizardText('projectName.description') + '</p>' +
        '<div class="setup-form"><label>' + setupWizardText('projectName.label') +
        '<input id="setupProjectName" type="text" maxlength="80" autocomplete="off" value="' +
        escapeHtml(projectName) + '" placeholder="' + setupWizardText('projectName.placeholder') + '"></label></div>' +
        '<div class="setup-actions"><button type="button" onclick="setupSaveProjectName()">' +
        setupWizardText('actions.saveProjectName') + '</button>' + goDashboard + '</div>' +
        restartNotice +
        renderSetupFeatureGrid(setup);
    }
    function setupRadioCard(name, value, current, title, body, handler) {
      const selected = current === value;
      const onChange = handler ? ' onchange="' + handler + '(this.value)"' : '';
      return '<label class="setup-card' + (selected ? ' is-selected' : '') + '">' +
        '<input type="radio" name="' + escapeHtml(name) + '" value="' + escapeHtml(value) + '"' +
        (selected ? ' checked' : '') + onChange + '> <strong>' + escapeHtml(title) + '</strong><br>' +
        '<span class="muted">' + escapeHtml(body) + '</span></label>';
    }
    function renderClaudeModelOptions(current) {
      const selected = setupNormalizeClaudeModel(current);
      return setupClaudeModels.map((model) =>
        '<option value="' + escapeHtml(model) + '"' + (selected === model ? ' selected' : '') + '>' +
        setupWizardText('ai.models.' + model) + '</option>'
      ).join('');
    }
    function setupNormalizeClaudeModel(value) {
      return setupClaudeModels.includes(value) ? value : 'haiku';
    }
    function setupNextButton(setup, id) {
      const ready = isSetupStepReady(setup, id);
      return '<button type="button"' + (ready ? '' : ' disabled') + ' onclick="setupGoNext()">' +
        setupWizardText('actions.next') + '</button>';
    }
    function renderSetupResult() {
      const result = setupLocalState.lastResult;
      if (!result) return '';
      if (setupLocalState.lastResultPath === '/api/setup/discord/test' && result.ok === true) {
        return '';
      }
      const failed = result.ok === false || ['failed', 'blocked', 'not_configured'].includes(String(result.status));
      return '<div class="setup-result">' +
        '<div class="' + (failed ? 'error' : 'status') + '">' +
        renderHumanDisplay(result) + renderRuntimeEffect(result.runtimeEffect) + '</div></div>';
    }
    function renderCreatedNotionDatabases() {
      const databases = setupLocalState.lastResult?.notion?.databases;
      if (!Array.isArray(databases) || databases.length === 0) {
        return '';
      }
      return '<div class="setup-status-grid">' + databases.map((database) =>
        '<div class="setup-status-card"><div class="label">' + escapeHtml(database.role) + '</div>' +
        '<div class="value">' + escapeHtml(database.name) + '</div>' +
        (database.url ? '<a href="' + escapeHtml(database.url) + '" target="_blank" rel="noreferrer">' +
          setupWizardText('notionManaged.openInNotion') + '</a>' : '') +
        '</div>'
      ).join('') + '</div>';
    }
    function renderSetupFeatureGrid(setup) {
      const features = [
        ['features.discord', setup.features?.discord],
        ['features.recording', setup.features?.recording],
        ['features.stt', setup.features?.stt],
        ['features.ai', setup.features?.ai],
        ['features.notion', setup.features?.notion],
        ['features.dataRetention', setup.features?.dataRetention]
      ];
      return '<div class="setup-status-grid">' + features.map(([labelKey, feature]) =>
        '<div class="setup-status-card"><div class="label">' + setupWizardText(labelKey) + ' · ' +
        escapeHtml(setupWizardStatusLabel(feature?.status)) + '</div>' +
        renderHumanDisplay(feature) +
        renderRuntimeEffect(feature?.runtimeEffect) +
        '</div>'
      ).join('') + '</div>';
    }
    function setSetupStep(index) {
      setupLocalState.stepIndex = Math.max(0, Math.min(setupStepDefinitions.length - 1, Number(index) || 0));
      window.localStorage.setItem('dirong.setup.stepIndex', String(setupLocalState.stepIndex));
      setupLocalState.forceRender = true;
      renderSetupWizard(setupLocalState.lastSetup);
      setupLocalState.forceRender = false;
    }
    function setupGoNext() {
      setSetupStep(setupLocalState.stepIndex + 1);
    }
    function setupAcknowledge(key) {
      setupLocalState[key] = true;
      window.localStorage.setItem('dirong.setup.' + key, 'true');
      setupGoNext();
    }
    function setupRememberGuild(value) {
      setupLocalState.selectedGuildId = value;
      window.localStorage.setItem('dirong.setup.guildId', value);
    }
    function setupRememberSttProvider(value) {
      setupLocalState.sttProvider = value;
      window.localStorage.setItem('dirong.setup.sttProvider', value);
      if (value === 'local-whisper') {
        setupEnsureLocalWhisperInstallStatusLoaded();
      }
      setupLocalState.forceRender = true;
      renderSetupWizard(setupLocalState.lastSetup);
      setupLocalState.forceRender = false;
    }
    function setupRememberSttModel(value) {
      setupLocalState.sttModel = value;
      window.localStorage.setItem('dirong.setup.sttModel', value);
      setupLocalState.forceRender = true;
      renderSetupWizard(setupLocalState.lastSetup);
      setupLocalState.forceRender = false;
    }
    function setupRememberAiMode(value) {
      setupLocalState.aiMode = value;
      window.localStorage.setItem('dirong.setup.aiMode', value);
      setupLocalState.forceRender = true;
      renderSetupWizard(setupLocalState.lastSetup);
      setupLocalState.forceRender = false;
    }
    function setupRememberClaudeModel(value) {
      setupLocalState.aiModel = setupNormalizeClaudeModel(value);
      window.localStorage.setItem('dirong.setup.aiModel', setupLocalState.aiModel);
    }
    async function setupPost(path, body) {
      setupLocalState.busy = true;
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: dashboardJsonHeaders(),
          body: JSON.stringify(body ?? {})
        });
        const result = await res.json();
        setupLocalState.lastResult = result;
        setupLocalState.lastResultPath = path;
        if (Array.isArray(result.guilds)) {
          setupLocalState.guilds = result.guilds;
        }
        if (result.install) {
          setupLocalState.localWhisperInstall = result.install;
          setupScheduleLocalWhisperInstallPoll();
        }
        setupLocalState.forceRender = true;
        await refresh();
        setupLocalState.forceRender = false;
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setupLocalState.lastResult = {
          ok: false,
          status: 'failed',
          message,
          userAction: setupWizardRawText('fallback.retryLater')
        };
        setupLocalState.lastResultPath = path;
        setupLocalState.forceRender = true;
        renderSetupWizard(setupLocalState.lastSetup);
        setupLocalState.forceRender = false;
        return setupLocalState.lastResult;
      } finally {
        setupLocalState.busy = false;
      }
    }
    async function setupSaveLanguage() {
      const defaults = requireSetupDefaults();
      if (!defaults) return;
      const selected = document.querySelector('input[name="setupLanguage"]:checked')?.value ?? defaults.dashboard.locale;
      const result = await setupPost('/api/settings/language', { locale: selected });
      if (result.ok) setupGoNext();
    }
    async function setupSaveDiscordApplicationId() {
      resetDiscordConnectionCheck();
      const result = await setupPost('/api/setup/discord/application-id', {
        applicationId: document.getElementById('setupDiscordApplicationId')?.value ?? ''
      });
      if (result.ok && isDiscordCredentialsSaved(result.setup ?? setupLocalState.lastSetup)) {
        await setupAutoTestDiscord();
      }
    }
    async function setupSaveDiscordBotToken() {
      resetDiscordConnectionCheck();
      const result = await setupPost('/api/setup/discord/bot-token', {
        botToken: document.getElementById('setupDiscordBotToken')?.value ?? ''
      });
      if (result.ok && isDiscordCredentialsSaved(result.setup ?? setupLocalState.lastSetup)) {
        await setupAutoTestDiscord();
      }
    }
    async function setupTestDiscord() {
      await setupPost('/api/setup/discord/test', {});
    }
    async function setupAutoTestDiscord() {
      if (!isDiscordCredentialsSaved(setupLocalState.lastSetup) || setupLocalState.discordConnectionStatus === 'verified') {
        return;
      }
      setupLocalState.discordConnectionStatus = 'checking';
      setupLocalState.discordConnectionAutoStarted = true;
      setupLocalState.forceRender = true;
      renderSetupWizard(setupLocalState.lastSetup);
      setupLocalState.forceRender = false;
      const result = await setupPost('/api/setup/discord/test', {});
      setupLocalState.discordConnectionStatus = result.ok ? 'verified' : 'failed';
      setupLocalState.discordConnectionAutoStarted = false;
      setupLocalState.forceRender = true;
      renderSetupWizard(result.setup ?? setupLocalState.lastSetup);
      setupLocalState.forceRender = false;
    }
    async function setupLoadGuilds() {
      try {
        const res = await fetch('/api/setup/discord/guilds', { cache: 'no-store' });
        const result = await res.json();
        setupLocalState.lastResult = result;
        setupLocalState.guilds = Array.isArray(result.guilds) ? result.guilds : [];
        setupLocalState.forceRender = true;
        renderSetupWizard(setupLocalState.lastSetup);
        setupLocalState.forceRender = false;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setupLocalState.lastResult = {
          ok: false,
          status: 'failed',
          message,
          userAction: setupWizardRawText('fallback.checkDiscordToken')
        };
        setupLocalState.forceRender = true;
        renderSetupWizard(setupLocalState.lastSetup);
        setupLocalState.forceRender = false;
      }
    }
    async function setupSaveGuild() {
      const selected = document.querySelector('input[name="setupGuild"]:checked')?.value || setupLocalState.selectedGuildId;
      await setupPost('/api/setup/discord/guild-allowlist', { guildIds: selected ? [selected] : [] });
    }
    async function setupSaveStt() {
      const defaults = requireSetupDefaults();
      if (!defaults) return;
      const provider = setupLocalState.sttProvider ?? defaults.stt.provider;
      if (provider === 'openai') {
        await setupPost('/api/setup/stt/openai/test', {
          provider,
          model: defaults.stt.openAiModel,
          apiKey: document.getElementById('setupOpenAiApiKey')?.value ?? '',
          language: defaults.stt.language,
          timeoutMs: defaults.stt.timeoutMs
        });
        return;
      }
      const model = setupLocalState.sttModel === 'medium'
        ? 'medium'
        : defaults.stt.localWhisper.model;
      const saved = await setupPost('/api/setup/stt', {
        provider: 'local-whisper',
        profile: defaults.stt.localWhisper.profile,
        model,
        device: defaults.stt.localWhisper.device,
        computeType: defaults.stt.localWhisper.computeType,
        language: defaults.stt.language,
        timeoutMs: defaults.stt.timeoutMs
      });
      if (!saved.ok) return;
      await setupPost('/api/setup/stt/local-whisper/install', {
        model,
        device: defaults.stt.localWhisper.device,
        computeType: defaults.stt.localWhisper.computeType
      });
    }
    async function setupLoadLocalWhisperInstallStatus() {
      if (setupLocalState.localWhisperInstallPolling) return;
      setupLocalState.localWhisperInstallPolling = true;
      try {
        const response = await fetch('/api/setup/stt/local-whisper/install', { cache: 'no-store' });
        const result = await response.json();
        if (result.install) {
          setupLocalState.localWhisperInstall = result.install;
          setupLocalState.forceRender = true;
          renderSetupWizard(setupLocalState.lastSetup);
          setupLocalState.forceRender = false;
          setupScheduleLocalWhisperInstallPoll();
        }
      } catch (_error) {
        // Explicit POST failures are shown in the setup result area.
      } finally {
        setupLocalState.localWhisperInstallPolling = false;
      }
    }
    function setupEnsureLocalWhisperInstallStatusLoaded() {
      if (setupLocalState.localWhisperInstall || setupLocalState.localWhisperInstallPolling) {
        return;
      }
      window.setTimeout(setupLoadLocalWhisperInstallStatus, 0);
    }
    function setupScheduleLocalWhisperInstallPoll() {
      if (setupLocalState.localWhisperInstallTimer) {
        window.clearTimeout(setupLocalState.localWhisperInstallTimer);
        setupLocalState.localWhisperInstallTimer = null;
      }
      if (setupLocalState.localWhisperInstall?.status === 'running') {
        setupLocalState.localWhisperInstallTimer =
          window.setTimeout(setupLoadLocalWhisperInstallStatus, 2000);
      }
    }
    async function setupSaveClaude() {
      const defaults = requireSetupDefaults();
      if (!defaults) return;
      const mode = setupLocalState.aiMode ?? defaults.ai.mode;
      const model = setupNormalizeClaudeModel(document.getElementById('setupClaudeModel')?.value ?? defaults.ai.model);
      await setupPost('/api/setup/ai/claude', mode === 'api'
        ? { mode, apiKey: document.getElementById('setupClaudeApiKey')?.value ?? '', model }
        : { mode, profile: defaults.ai.claudeProfile, model });
    }
    async function setupTestClaude() {
      await setupPost('/api/setup/ai/claude/test', {});
    }
    async function setupSaveNotionToken() {
      await setupPost('/api/setup/notion/token', {
        token: document.getElementById('setupNotionToken')?.value ?? ''
      });
    }
    async function setupSaveNotionParent() {
      await setupPost('/api/setup/notion/parent-page', {
        parentPageUrl: document.getElementById('setupNotionParentPageUrl')?.value ?? ''
      });
    }
    async function setupVerifyNotionParent() {
      await setupPost('/api/setup/notion/verify-parent-page', {});
    }
    async function setupCreateManagedDatabases() {
      await setupPost('/api/setup/notion/managed-databases', {});
    }
    async function setupSaveProjectName() {
      window.sessionStorage.setItem(SETUP_RESTART_NOTICE_KEY, 'true');
      await setupPost('/api/setup/project/name', {
        name: document.getElementById('setupProjectName')?.value ?? ''
      });
    }
    function setupGoDashboard() {
      window.sessionStorage.removeItem(SETUP_RESTART_NOTICE_KEY);
      setActiveView('dashboard');
    }
