    const settingsEditorState = {
      busy: null,
      lastResult: null,
      lastResultScope: null,
      sttProvider: null,
      sttModel: null,
      sttLanguage: null,
      sttTimeoutMs: null,
      aiProvider: null,
      aiMode: null,
      aiModel: null,
      retentionDays: null,
      notionUploadMode: null,
      settingsLocale: null,
      discordGuilds: null,
      discordSelectedGuildId: null,
      forceRender: false
    };
    const settingsNotionUploadModes = ['automatic_after_ai_cleanup', 'manual'];
    const settingsWhisperModels = ['tiny', 'base', 'small', 'medium', 'large-v3'];
    const settingsOpenAiSttModels = ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'];
    const settingsSttLanguages = ['ko', 'en'];
    const settingsAiProviders = ['claude', 'codex', 'gemini'];
    const settingsAiModelsByProvider = {
      claude: ['haiku', 'sonnet', 'opus'],
      codex: ['default'],
      gemini: ['default']
    };
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
        return renderSettingsResetPanel(state, setup) + renderSettingsCredits();
      }
      const theme =
        setup?.dashboardTheme ??
        setup?.defaults?.dashboard?.theme ??
        document.body.dataset.theme;
      // 'general' 탭에 언어와 테마를 함께 묶는다(발견성 통합). 테마는 더 이상
      // 모든 탭 하단에 상시 렌더하지 않고 general 탭 안에서만 보인다.
      const body = activeSettingsTab === 'general'
        ? renderLanguageSettings(setup) + renderThemeSettings(theme, setup)
        : activeSettingsTab === 'discord'
          ? renderDiscordSettings(setup)
          : activeSettingsTab === 'retention'
            ? renderRetentionSettings(setup)
            : activeSettingsTab === 'aloneFinalize'
              ? renderAloneFinalizeSettings(state.aloneFinalize, setup)
              : activeSettingsTab === 'stt'
                ? renderSttSettings(setup)
                : activeSettingsTab === 'ai'
                  ? renderAiSettings(setup)
                  : activeSettingsTab === 'notion'
                    ? renderNotionConnectionSettings(setup)
                    : '<div class="metric"><div class="label">' + i18n('dashboard.settings.tabs.' + activeSettingsTab) + '</div>' +
                      renderHumanDisplay(featureMap[activeSettingsTab]) +
                      renderRuntimeEffect(featureMap[activeSettingsTab]?.runtimeEffect) +
                      '<div class="muted">' + i18n('dashboard.settings.secretsHidden') + '</div></div>';
      return body + renderSettingsCredits();
    }
    function renderLanguageSettings(setup) {
      const defaults = setup?.defaults?.dashboard ?? {};
      const locale = settingsEditorState.settingsLocale ?? setup?.locale ?? defaults.locale ?? 'ko';
      const card = (value, titleKey, descriptionKey) =>
        '<label class="setup-card' + (locale === value ? ' is-selected' : '') + '">' +
        '<input type="radio" name="settingsLanguage" value="' + escapeHtml(value) + '"' +
        (locale === value ? ' checked' : '') + ' onchange="settingsRememberLanguage(this.value)"> ' +
        '<strong>' + i18n(titleKey) + '</strong><br>' +
        '<span class="muted">' + i18n(descriptionKey) + '</span></label>';
      const englishNotice = locale === 'en'
        ? '<div class="setup-notice">' + i18n('dashboard.setupWizard.language.englishNotice') + '</div>'
        : '';
      return '<div class="metric"><div class="label">' + i18n('dashboard.settings.editor.language.title') + '</div>' +
        '<div class="setup-cards">' +
        card('ko', 'dashboard.setupWizard.language.korean.title', 'dashboard.setupWizard.language.korean.description') +
        card('en', 'dashboard.setupWizard.language.english.title', 'dashboard.setupWizard.language.english.description') +
        '</div>' + englishNotice +
        '<div class="toolbar"><button type="button" onclick="saveSettingsLanguage()"' +
        (settingsEditorState.busy === 'language' ? ' disabled' : '') + '>' +
        (settingsEditorState.busy === 'language' ? i18n('dashboard.settings.editor.saving') : i18n('dashboard.settings.editor.save')) +
        '</button></div>' + renderSettingsEditorResult('language') + '</div>';
    }
    function settingsRememberLanguage(value) {
      settingsEditorState.settingsLocale = value === 'en' ? 'en' : 'ko';
      settingsEditorState.lastResult = null;
      settingsEditorState.lastResultScope = null;
      rerenderSettingsPanel();
    }
    async function saveSettingsLanguage() {
      const defaults = lastSetupSnapshot?.defaults?.dashboard ?? {};
      const locale = document.querySelector('input[name="settingsLanguage"]:checked')?.value ??
        settingsEditorState.settingsLocale ?? lastSetupSnapshot?.locale ?? defaults.locale ?? 'ko';
      await postSettingsEditor('language', '/api/settings/language', { locale });
    }
    function renderDiscordSettings(setup) {
      const feature = setup?.features?.discord;
      const discord = setup?.editableSettings?.discord ?? {};
      const inviteUrl = setup?.wizard?.inviteUrl ?? null;
      const applicationId = discord.applicationId ?? '';
      const statusCard = '<div class="metric"><div class="label">' + i18n('dashboard.settings.tabs.discord') + '</div>' +
        renderHumanDisplay(feature) +
        renderRuntimeEffect(feature?.runtimeEffect) +
        '<div class="muted">' + i18n('dashboard.settings.secretsHidden') + '</div></div>';
      const credentialsCard = '<div class="metric"><div class="label">' +
        i18n('dashboard.settings.editor.discord.credentialsTitle') + '</div>' +
        '<div class="setup-form">' +
        '<label>' + i18n('dashboard.setupWizard.discord.applicationIdLabel') +
        '<input id="settingsDiscordApplicationId" type="text" inputmode="numeric" autocomplete="off" value="' +
        escapeHtml(applicationId) + '" placeholder="' +
        i18n('dashboard.setupWizard.discord.applicationIdPlaceholder') + '"></label>' +
        '<div class="toolbar"><button type="button" onclick="saveSettingsDiscordApplicationId()"' +
        (settingsEditorState.busy === 'discord' ? ' disabled' : '') + '>' +
        (settingsEditorState.busy === 'discord' ? i18n('dashboard.settings.editor.saving') : i18n('dashboard.setupWizard.actions.saveDiscordApplicationId')) +
        '</button></div>' +
        '<label>' + i18n('dashboard.setupWizard.discord.botTokenLabel') +
        '<input id="settingsDiscordBotToken" type="password" autocomplete="off" placeholder="' +
        i18n('dashboard.setupWizard.discord.botTokenPlaceholder') + '"></label>' +
        '<span class="muted">' + i18n('dashboard.settings.editor.discord.tokenKeepHint') + '</span>' +
        '<div class="toolbar"><button type="button" onclick="saveSettingsDiscordBotToken()"' +
        (settingsEditorState.busy === 'discordToken' ? ' disabled' : '') + '>' +
        (settingsEditorState.busy === 'discordToken' ? i18n('dashboard.settings.editor.saving') : i18n('dashboard.setupWizard.actions.saveDiscordBotToken')) +
        '</button><button type="button" onclick="testSettingsDiscord()"' +
        (settingsEditorState.busy === 'discordTest' ? ' disabled' : '') + '>' +
        (settingsEditorState.busy === 'discordTest' ? i18n('dashboard.settings.editor.testing') : i18n('dashboard.setupWizard.actions.testConnection')) +
        '</button></div>' +
        '</div>' +
        renderSettingsEditorResult('discord') +
        renderSettingsEditorResult('discordToken') +
        renderSettingsEditorResult('discordTest') + '</div>';
      const guildCard = '<div class="metric"><div class="label">' +
        i18n('dashboard.settings.editor.discord.guildTitle') + '</div>' +
        '<div class="value">' + i18n('dashboard.settings.editor.discord.currentGuild') + ': ' +
        escapeHtml(discord.guildName ?? discord.guildId ?? tr('dashboard.projects.guildMissing')) + '</div>' +
        (inviteUrl ? renderSettingsGuildInvite(inviteUrl) : '') +
        '<div class="toolbar"><button type="button" onclick="loadSettingsDiscordGuilds()"' +
        (settingsEditorState.busy === 'discordGuildsLoad' ? ' disabled' : '') + '>' +
        i18n('dashboard.setupWizard.actions.loadGuilds') + '</button></div>' +
        renderSettingsGuildList() +
        '<div class="toolbar"><button type="button" onclick="saveSettingsDiscordGuild()"' +
        (settingsEditorState.busy === 'discordGuild' ? ' disabled' : '') + '>' +
        (settingsEditorState.busy === 'discordGuild' ? i18n('dashboard.settings.editor.saving') : i18n('dashboard.setupWizard.actions.saveSelectedGuild')) +
        '</button></div>' +
        renderSettingsEditorResult('discordGuild') + '</div>';
      return statusCard + credentialsCard + guildCard;
    }
    function renderSettingsGuildInvite(inviteUrl) {
      return '<section class="setup-help"><h4>' + i18n('dashboard.setupWizard.guild.invite.title') + '</h4>' +
        '<p>' + i18n('dashboard.setupWizard.guild.invite.description') + '</p>' +
        '<a href="' + escapeHtml(inviteUrl) + '" target="_blank" rel="noreferrer">' +
        i18n('dashboard.setupWizard.guild.invite.link') + '</a></section>';
    }
    function renderSettingsGuildList() {
      const guilds = settingsEditorState.discordGuilds;
      if (!Array.isArray(guilds)) {
        return '<div class="muted">' + i18n('dashboard.setupWizard.guild.empty') + '</div>';
      }
      if (guilds.length === 0) {
        return '<div class="muted">' + i18n('dashboard.setupWizard.guild.empty') + '</div>';
      }
      return '<div class="setup-guild-list">' + guilds.map((guild) =>
        '<label class="setup-guild"><input type="radio" name="settingsDiscordGuild" value="' +
        escapeHtml(guild.id) + '"' +
        (settingsEditorState.discordSelectedGuildId === guild.id ? ' checked' : '') +
        ' onchange="settingsRememberDiscordGuild(this.value)"> <strong>' +
        escapeHtml(guild.name) + '</strong></label>'
      ).join('') + '</div>';
    }
    function settingsRememberDiscordGuild(value) {
      settingsEditorState.discordSelectedGuildId = value;
    }
    async function saveSettingsDiscordApplicationId() {
      await postSettingsEditor('discord', '/api/setup/discord/application-id', {
        applicationId: document.getElementById('settingsDiscordApplicationId')?.value ?? ''
      });
    }
    async function saveSettingsDiscordBotToken() {
      await postSettingsEditor('discordToken', '/api/setup/discord/bot-token', {
        botToken: document.getElementById('settingsDiscordBotToken')?.value ?? ''
      });
    }
    async function testSettingsDiscord() {
      await postSettingsEditor('discordTest', '/api/setup/discord/test', {});
    }
    async function loadSettingsDiscordGuilds() {
      settingsEditorState.busy = 'discordGuildsLoad';
      settingsEditorState.lastResult = null;
      settingsEditorState.lastResultScope = 'discordGuild';
      rerenderSettingsPanel();
      try {
        const res = await fetch('/api/setup/discord/guilds', { cache: 'no-store' });
        const result = await dashboardApiReadJson(res);
        if (Array.isArray(result.guilds)) {
          settingsEditorState.discordGuilds = result.guilds;
        }
        if (result.ok === false) {
          settingsEditorState.lastResult = result;
          settingsEditorState.lastResultScope = 'discordGuild';
        }
      } catch (error) {
        settingsEditorState.lastResult = {
          ok: false,
          status: 'failed',
          message: error instanceof Error ? error.message : String(error)
        };
        settingsEditorState.lastResultScope = 'discordGuild';
      } finally {
        settingsEditorState.busy = null;
        rerenderSettingsPanel();
      }
    }
    async function saveSettingsDiscordGuild() {
      const selected = document.querySelector('input[name="settingsDiscordGuild"]:checked')?.value ??
        settingsEditorState.discordSelectedGuildId ?? '';
      await postSettingsEditor('discordGuild', '/api/setup/discord/guild-allowlist', {
        guildIds: selected ? [selected] : []
      });
    }
    function renderSttSettings(setup) {
      const current = setup?.editableSettings?.stt ?? {};
      const defaults = setup?.defaults?.stt ?? {};
      const feature = setup?.features?.stt;
      const provider = settingsEditorState.sttProvider ?? current.provider ?? defaults.provider ?? 'local-whisper';
      const model = provider === 'openai'
        ? settingsSelectValue(settingsEditorState.sttModel ?? current.openAiModel ?? defaults.openAiModel, settingsOpenAiSttModels, defaults.openAiModel ?? settingsOpenAiSttModels[0])
        : settingsSelectValue(settingsEditorState.sttModel ?? current.localWhisper?.model ?? defaults.localWhisper?.model, settingsWhisperModels, defaults.localWhisper?.model ?? 'small');
      const modelLabel = provider === 'openai'
        ? 'dashboard.settings.editor.stt.openAiModel'
        : 'dashboard.settings.editor.stt.localWhisperModel';
      const language = settingsSelectValue(
        settingsEditorState.sttLanguage ?? current.language ?? defaults.language,
        settingsSttLanguages,
        defaults.language ?? 'ko'
      );
      const timeoutMs = settingsEditorState.sttTimeoutMs ?? current.timeoutMs ?? defaults.timeoutMs ?? 120000;
      const timeoutMin = defaults.timeoutMsMin ?? 5000;
      const timeoutMax = defaults.timeoutMsMax ?? 600000;
      const secret = provider === 'openai'
        ? '<label>' + i18n('dashboard.settings.editor.stt.openAiApiKey') +
          '<input id="settingsOpenAiApiKey" type="password" autocomplete="off">' +
          '<span class="muted">' + i18n('dashboard.settings.editor.optionalSecret') + '</span></label>'
        : '';
      const testButton = provider === 'openai'
        ? '<button type="button" onclick="testSettingsStt()"' +
          (settingsEditorState.busy === 'sttTest' ? ' disabled' : '') + '>' +
          (settingsEditorState.busy === 'sttTest' ? i18n('dashboard.settings.editor.testing') : i18n('dashboard.settings.editor.stt.test')) +
          '</button>'
        : '';
      const testHint = provider === 'openai'
        ? '<div class="muted">' + i18n('dashboard.settings.editor.stt.testHint') + '</div>'
        : '';
      return '<div class="metric"><div class="label">' + i18n('dashboard.settings.tabs.stt') + '</div>' +
        renderHumanDisplay(feature) +
        renderRuntimeEffect(feature?.runtimeEffect) +
        '<div class="muted">' + i18n('dashboard.settings.secretsHidden') + '</div></div>' +
        '<div class="metric"><div class="label">' + i18n('dashboard.settings.editor.stt.title') + '</div>' +
        '<div class="settings-grid">' +
        '<label>' + i18n('dashboard.settings.editor.provider') +
        '<select id="settingsSttProvider" onchange="settingsRememberSttProvider(this.value)">' +
        renderOptions(['local-whisper', 'openai'], provider) + '</select></label>' +
        '<label>' + i18n(modelLabel) +
        '<select id="settingsSttModel" onchange="settingsRememberSttModel(this.value)">' +
        renderOptions(provider === 'openai' ? settingsOpenAiSttModels : settingsWhisperModels, model) +
        '</select></label>' +
        '<label>' + i18n('dashboard.settings.editor.stt.language') +
        '<select id="settingsSttLanguage" onchange="settingsRememberSttLanguage(this.value)">' +
        renderSttLanguageOptions(language) + '</select></label>' +
        '<label>' + i18n('dashboard.settings.editor.stt.timeoutMs') +
        '<input id="settingsSttTimeoutMs" type="number" min="' + timeoutMin + '" max="' + timeoutMax +
        '" step="1000" value="' + escapeHtml(timeoutMs) + '"></label>' +
        secret + '</div>' +
        '<div class="muted">' + i18n('dashboard.settings.editor.stt.languageHint') + '</div>' +
        '<div class="muted">' + i18n('dashboard.settings.editor.stt.timeoutHint') + '</div>' +
        testHint +
        '<div class="toolbar"><button type="button" onclick="saveSettingsStt()"' +
        (settingsEditorState.busy === 'stt' ? ' disabled' : '') + '>' +
        (settingsEditorState.busy === 'stt' ? i18n('dashboard.settings.editor.saving') : i18n('dashboard.settings.editor.save')) +
        '</button>' + testButton + '</div>' +
        renderSettingsEditorResult('stt') + renderSettingsEditorResult('sttTest') + '</div>';
    }
    function renderSttLanguageOptions(current) {
      const labels = {
        ko: 'dashboard.setupWizard.language.korean.title',
        en: 'dashboard.setupWizard.language.english.title'
      };
      return settingsSttLanguages.map((value) =>
        '<option value="' + escapeHtml(value) + '"' + (current === value ? ' selected' : '') + '>' +
        i18n(labels[value] ?? value) + '</option>'
      ).join('');
    }
    function renderAiSettings(setup) {
      const current = setup?.editableSettings?.ai ?? {};
      const defaults = setup?.defaults?.ai ?? {};
      const feature = setup?.features?.ai;
      const provider = settingsSelectValue(settingsEditorState.aiProvider ?? current.provider ?? defaults.provider, settingsAiProviders, 'claude');
      const mode = provider === 'claude'
        ? (settingsEditorState.aiMode ?? current.mode ?? defaults.mode ?? 'cli')
        : 'cli';
      const model = settingsSelectValue(
        settingsEditorState.aiModel ?? current.model ?? defaults.model,
        settingsAiModelsByProvider[provider] ?? settingsAiModelsByProvider.claude,
        (settingsAiModelsByProvider[provider] ?? settingsAiModelsByProvider.claude)[0]
      );
      const secret = mode === 'api'
        ? '<label>' + i18n('dashboard.settings.editor.ai.apiKey') +
          '<input id="settingsClaudeApiKey" type="password" autocomplete="off">' +
          '<span class="muted">' + i18n('dashboard.settings.editor.optionalSecret') + '</span></label>'
        : '';
      return '<div class="metric"><div class="label">' + i18n('dashboard.settings.tabs.ai') + '</div>' +
        renderHumanDisplay(feature) +
        renderRuntimeEffect(feature?.runtimeEffect) +
        '<div class="muted">' + i18n('dashboard.settings.secretsHidden') + '</div></div>' +
        '<div class="metric"><div class="label">' + i18n('dashboard.settings.editor.ai.title') + '</div>' +
        '<div class="settings-grid">' +
        '<label>' + i18n('dashboard.settings.editor.provider') +
        '<select id="settingsAiProvider" onchange="settingsRememberAiProvider(this.value)">' +
        renderAiProviderSettingsOptions(provider) + '</select></label>' +
        '<label>' + i18n('dashboard.settings.editor.mode') +
        '<select id="settingsAiMode" onchange="settingsRememberAiMode(this.value)">' +
        '<option value="cli"' + (mode === 'cli' ? ' selected' : '') + '>' + i18n('dashboard.settings.editor.ai.modeCli') + '</option>' +
        (provider === 'claude'
          ? '<option value="api"' + (mode === 'api' ? ' selected' : '') + '>' + i18n('dashboard.settings.editor.ai.modeApi') + '</option>'
          : '') +
        '</select></label>' +
        '<label>' + i18n('dashboard.settings.editor.model') +
        '<select id="settingsAiModel" onchange="settingsRememberAiModel(this.value)">' +
        renderAiSettingsOptions(provider, model) + '</select></label>' + secret + '</div>' +
        '<div class="muted">' + i18n('dashboard.settings.editor.ai.testHint') + '</div>' +
        '<div class="toolbar"><button type="button" onclick="saveSettingsAi()"' +
        (settingsEditorState.busy === 'ai' ? ' disabled' : '') + '>' +
        (settingsEditorState.busy === 'ai' ? i18n('dashboard.settings.editor.saving') : i18n('dashboard.settings.editor.save')) +
        '</button><button type="button" onclick="testSettingsAi()"' +
        (settingsEditorState.busy === 'aiTest' ? ' disabled' : '') + '>' +
        (settingsEditorState.busy === 'aiTest' ? i18n('dashboard.settings.editor.testing') : i18n('dashboard.settings.editor.ai.test')) +
        '</button></div>' + renderSettingsEditorResult('ai') + renderSettingsEditorResult('aiTest') + '</div>';
    }
    function renderNotionConnectionSettings(setup) {
      const feature = setup?.features?.notion;
      const notion = setup?.editableSettings?.notion ?? {};
      const parentPageUrl = notion.parentPageUrl ?? '';
      const tokenConfigured = notion.credentialConfigured === true;
      const statusCard = '<div class="metric"><div class="label">' + i18n('dashboard.settings.tabs.notion') + '</div>' +
        renderHumanDisplay(feature) +
        renderRuntimeEffect(feature?.runtimeEffect) +
        '<div class="muted">' + i18n('dashboard.settings.secretsHidden') + '</div></div>';
      const tokenCard = '<div class="metric"><div class="label">' +
        i18n('dashboard.settings.editor.notion.tokenTitle') + '</div>' +
        '<div class="value">' + i18n(tokenConfigured
          ? 'dashboard.settings.editor.notion.tokenConfigured'
          : 'dashboard.settings.editor.notion.tokenMissing') + '</div>' +
        '<div class="setup-form"><label>' + i18n('dashboard.settings.editor.notion.tokenLabel') +
        '<input id="settingsNotionToken" type="password" autocomplete="off" placeholder="' +
        i18n('dashboard.setupWizard.notionToken.placeholder') + '"></label></div>' +
        '<span class="muted">' + i18n('dashboard.settings.editor.notion.tokenKeepHint') + '</span>' +
        '<div class="toolbar"><button type="button" onclick="saveSettingsNotionToken()"' +
        (settingsEditorState.busy === 'notionToken' ? ' disabled' : '') + '>' +
        (settingsEditorState.busy === 'notionToken' ? i18n('dashboard.settings.editor.saving') : i18n('dashboard.setupWizard.actions.saveNotionToken')) +
        '</button></div>' + renderSettingsEditorResult('notionToken') + '</div>';
      const parentCard = '<div class="metric"><div class="label">' + i18n('dashboard.settings.editor.notion.title') + '</div>' +
        '<div class="setup-form"><label>' + i18n('dashboard.settings.editor.notion.parentPageUrl') +
        '<input id="settingsNotionParentPageUrl" type="url" autocomplete="off" value="' +
        escapeHtml(parentPageUrl) + '" placeholder="' +
        i18n('dashboard.settings.editor.notion.parentPagePlaceholder') + '"></label></div>' +
        '<div class="toolbar"><button type="button" onclick="saveSettingsNotionParent()"' +
        (settingsEditorState.busy === 'notion' ? ' disabled' : '') + '>' +
        (settingsEditorState.busy === 'notion' ? i18n('dashboard.settings.editor.saving') : i18n('dashboard.settings.editor.save')) +
        '</button><button type="button" onclick="verifySettingsNotionParent()"' +
        (settingsEditorState.busy === 'notionVerify' ? ' disabled' : '') + '>' +
        (settingsEditorState.busy === 'notionVerify' ? i18n('dashboard.settings.editor.testing') : i18n('dashboard.settings.editor.verify')) +
        '</button></div>' + renderSettingsEditorResult('notion') + renderSettingsEditorResult('notionVerify') + '</div>';
      return statusCard + tokenCard + parentCard + renderNotionUploadModeSettings(setup) + renderSettingsManagedDb(setup);
    }
    function renderNotionUploadModeSettings(setup) {
      const notion = setup?.editableSettings?.notion ?? {};
      const current = settingsSelectValue(
        settingsEditorState.notionUploadMode ?? notion.uploadMode,
        settingsNotionUploadModes,
        settingsNotionUploadModes[0]
      );
      const optionLabels = {
        automatic_after_ai_cleanup: 'dashboard.settings.notionUploadMode.optionAutomatic',
        manual: 'dashboard.settings.notionUploadMode.optionManual'
      };
      const options = settingsNotionUploadModes.map((value) =>
        '<option value="' + escapeHtml(value) + '"' + (current === value ? ' selected' : '') + '>' +
        i18n(optionLabels[value]) + '</option>'
      ).join('');
      return '<div class="metric"><div class="label">' + i18n('dashboard.settings.notionUploadMode.title') + '</div>' +
        '<div class="settings-grid"><label>' + i18n('dashboard.settings.notionUploadMode.title') +
        '<select id="settingsNotionUploadMode" onchange="settingsRememberNotionUploadMode(this.value)">' +
        options + '</select></label></div>' +
        '<div class="toolbar"><button type="button" onclick="saveSettingsNotionUploadMode()"' +
        (settingsEditorState.busy === 'notionUploadMode' ? ' disabled' : '') + '>' +
        (settingsEditorState.busy === 'notionUploadMode' ? i18n('dashboard.settings.editor.saving') : i18n('dashboard.settings.notionUploadMode.save')) +
        '</button></div>' + renderSettingsEditorResult('notionUploadMode') + '</div>';
    }
    function settingsRememberNotionUploadMode(value) {
      settingsEditorState.notionUploadMode = settingsNotionUploadModes.includes(value)
        ? value
        : settingsNotionUploadModes[0];
    }
    async function saveSettingsNotionUploadMode() {
      const value = document.getElementById('settingsNotionUploadMode')?.value;
      await postSettingsEditor('notionUploadMode', '/api/setup/notion/upload-mode', { uploadMode: value });
    }
    function renderSettingsManagedDb(setup) {
      const feature = setup?.features?.notion;
      const registry = feature?.managedRegistry;
      const status = registry?.status ?? feature?.managedRegistryStatus ?? 'missing';
      const details = registry
        ? renderManagedRegistryDetails(registry, { compact: true })
        : '';
      const action = status === 'missing'
        ? '<div class="toolbar"><button type="button" onclick="createSettingsManagedDatabases()"' +
          (settingsEditorState.busy === 'managedDb' ? ' disabled' : '') + '>' +
          (settingsEditorState.busy === 'managedDb' ? i18n('dashboard.settings.editor.saving') : i18n('dashboard.settings.editor.notion.managedCreate')) +
          '</button></div>'
        : '<div class="muted">' + i18n('dashboard.settings.editor.notion.managedRepairHint') + '</div>' +
          '<div class="toolbar"><button type="button" onclick="goToManagedDbView()">' +
          i18n('dashboard.settings.editor.notion.managedRepairLink') + '</button></div>';
      return '<div class="metric"><div class="label">' + i18n('dashboard.settings.editor.notion.managedTitle') + '</div>' +
        details + action + renderSettingsEditorResult('managedDb') + '</div>';
    }
    async function createSettingsManagedDatabases() {
      await postSettingsEditor('managedDb', '/api/setup/notion/managed-databases', {});
    }
    function goToManagedDbView() {
      setActiveView('db');
      setDbTab('meeting');
    }
    async function saveSettingsNotionToken() {
      await postSettingsEditor('notionToken', '/api/setup/notion/token', {
        token: document.getElementById('settingsNotionToken')?.value ?? ''
      });
    }
    function renderAloneFinalizeSettings(aloneFinalize, setup) {
      const recording = setup?.editableSettings?.recording ?? {};
      const graceSeconds = Math.round((recording.aloneFinalizeGraceMs ?? 90000) / 1000);
      return renderAloneFinalize(aloneFinalize) +
        '<div class="metric"><div class="label">' + i18n('dashboard.settings.tabs.aloneFinalize') + '</div>' +
        '<div class="settings-grid">' +
        '<label class="settings-reset-confirm"><input id="settingsAloneFinalizeEnabled" type="checkbox"' +
        (recording.aloneFinalizeEnabled === false ? '' : ' checked') + '> ' +
        i18n('dashboard.settings.editor.aloneFinalize.enabled') + '</label>' +
        '<label>' + i18n('dashboard.settings.editor.aloneFinalize.graceSeconds') +
        '<input id="settingsAloneFinalizeGraceSeconds" type="number" min="5" max="3600" step="5" value="' +
        escapeHtml(graceSeconds) + '"></label></div>' +
        '<div class="muted">' + i18n('dashboard.settings.editor.aloneFinalize.help') + '</div>' +
        '<div class="toolbar"><button type="button" onclick="saveSettingsAloneFinalize()"' +
        (settingsEditorState.busy === 'aloneFinalize' ? ' disabled' : '') + '>' +
        (settingsEditorState.busy === 'aloneFinalize' ? i18n('dashboard.settings.editor.saving') : i18n('dashboard.settings.editor.save')) +
        '</button></div>' + renderSettingsEditorResult('aloneFinalize') + '</div>';
    }
    function renderOptions(values, current) {
      return values.map((value) =>
        '<option value="' + escapeHtml(value) + '"' + (current === value ? ' selected' : '') + '>' +
        escapeHtml(value) + '</option>'
      ).join('');
    }
    function renderAiProviderSettingsOptions(current) {
      return settingsAiProviders.map((provider) =>
        '<option value="' + escapeHtml(provider) + '"' + (current === provider ? ' selected' : '') + '>' +
        i18n('dashboard.settings.editor.ai.provider' + capitalizeProvider(provider)) + '</option>'
      ).join('');
    }
    function renderAiSettingsOptions(provider, current) {
      const models = settingsAiModelsByProvider[provider] ?? settingsAiModelsByProvider.claude;
      return models.map((model) =>
        '<option value="' + escapeHtml(model) + '"' + (current === model ? ' selected' : '') + '>' +
        i18n('dashboard.setupWizard.ai.models.' + model) + '</option>'
      ).join('');
    }
    function capitalizeProvider(provider) {
      return provider.charAt(0).toUpperCase() + provider.slice(1);
    }
    function settingsSelectValue(value, values, fallback) {
      return values.includes(value) ? value : fallback;
    }
    function renderSettingsEditorResult(scope) {
      const result = settingsEditorState.lastResultScope === scope
        ? settingsEditorState.lastResult
        : null;
      if (!result) return '';
      const ok = result.ok === true;
      const message = escapeHtml(result.message ?? result.status ?? '');
      return '<div class="setup-result ' + (ok ? 'is-ok' : 'is-error') + '">' +
        '<div class="value ' + (ok ? 'status' : 'error') + '">' + message + '</div>' +
        renderRuntimeEffect(result.runtimeEffect) + '</div>';
    }
    function rerenderSettingsPanel() {
      settingsEditorState.forceRender = true;
      setHtml('settingsPanel', renderSettingsPanel(lastDashboardState ?? {}, lastSetupSnapshot));
      settingsEditorState.forceRender = false;
    }
    function settingsRememberSttProvider(value) {
      settingsEditorState.sttProvider = value === 'openai' ? 'openai' : 'local-whisper';
      settingsEditorState.sttModel = null;
      settingsEditorState.lastResult = null;
      settingsEditorState.lastResultScope = null;
      rerenderSettingsPanel();
    }
    function settingsRememberSttModel(value) {
      settingsEditorState.sttModel = value;
    }
    function settingsRememberSttLanguage(value) {
      settingsEditorState.sttLanguage = settingsSttLanguages.includes(value) ? value : 'ko';
    }
    function settingsRememberAiMode(value) {
      const provider = settingsEditorState.aiProvider ?? lastSetupSnapshot?.editableSettings?.ai?.provider ?? 'claude';
      settingsEditorState.aiMode = provider === 'claude' && value === 'api' ? 'api' : 'cli';
      settingsEditorState.lastResult = null;
      settingsEditorState.lastResultScope = null;
      rerenderSettingsPanel();
    }
    function settingsRememberAiProvider(value) {
      const provider = settingsAiProviders.includes(value) ? value : 'claude';
      settingsEditorState.aiProvider = provider;
      settingsEditorState.aiMode = provider === 'claude' ? (settingsEditorState.aiMode ?? 'cli') : 'cli';
      settingsEditorState.aiModel = (settingsAiModelsByProvider[provider] ?? settingsAiModelsByProvider.claude)[0];
      settingsEditorState.lastResult = null;
      settingsEditorState.lastResultScope = null;
      rerenderSettingsPanel();
    }
    function settingsRememberAiModel(value) {
      const provider = settingsEditorState.aiProvider ?? lastSetupSnapshot?.editableSettings?.ai?.provider ?? 'claude';
      const models = settingsAiModelsByProvider[provider] ?? settingsAiModelsByProvider.claude;
      settingsEditorState.aiModel = models.includes(value) ? value : models[0];
    }
    async function postSettingsEditor(scope, path, body) {
      settingsEditorState.busy = scope;
      settingsEditorState.lastResult = null;
      settingsEditorState.lastResultScope = scope;
      rerenderSettingsPanel();
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: dashboardJsonHeaders(),
          body: JSON.stringify(body ?? {})
        });
        settingsEditorState.lastResult = await dashboardApiReadJson(res);
        settingsEditorState.lastResultScope = scope;
        await refresh();
      } catch (error) {
        settingsEditorState.lastResult = {
          ok: false,
          status: 'failed',
          message: error instanceof Error ? error.message : String(error)
        };
        settingsEditorState.lastResultScope = scope;
        rerenderSettingsPanel();
      } finally {
        settingsEditorState.busy = null;
        rerenderSettingsPanel();
      }
    }
    function readSettingsSttLanguage() {
      const value = document.getElementById('settingsSttLanguage')?.value;
      return settingsSttLanguages.includes(value) ? value : undefined;
    }
    function readSettingsSttTimeoutMs() {
      const raw = document.getElementById('settingsSttTimeoutMs')?.value;
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
    }
    async function saveSettingsStt() {
      const setup = lastSetupSnapshot ?? {};
      const current = setup.editableSettings?.stt ?? {};
      const defaults = setup.defaults?.stt ?? {};
      const provider = document.getElementById('settingsSttProvider')?.value ?? current.provider ?? defaults.provider ?? 'local-whisper';
      const model = document.getElementById('settingsSttModel')?.value ?? '';
      const language = readSettingsSttLanguage() ?? current.language ?? defaults.language ?? 'ko';
      const timeoutMs = readSettingsSttTimeoutMs() ?? current.timeoutMs ?? defaults.timeoutMs ?? 120000;
      if (provider === 'openai') {
        await postSettingsEditor('stt', '/api/setup/stt', {
          provider,
          model,
          apiKey: document.getElementById('settingsOpenAiApiKey')?.value ?? '',
          language,
          timeoutMs
        });
        return;
      }
      await postSettingsEditor('stt', '/api/setup/stt', {
        provider: 'local-whisper',
        profile: current.localWhisper?.profile ?? defaults.localWhisper?.profile,
        model,
        device: current.localWhisper?.device ?? defaults.localWhisper?.device,
        computeType: current.localWhisper?.computeType ?? defaults.localWhisper?.computeType,
        language,
        timeoutMs
      });
    }
    async function testSettingsStt() {
      await postSettingsEditor('sttTest', '/api/setup/stt/openai/test', {
        model: document.getElementById('settingsSttModel')?.value ?? '',
        apiKey: document.getElementById('settingsOpenAiApiKey')?.value ?? '',
        language: readSettingsSttLanguage(),
        timeoutMs: readSettingsSttTimeoutMs()
      });
    }
    async function testSettingsAi() {
      await postSettingsEditor('aiTest', '/api/setup/ai/test', {});
    }
    async function saveSettingsAi() {
      const setup = lastSetupSnapshot ?? {};
      const defaults = setup.defaults?.ai ?? {};
      const provider = settingsAiProviders.includes(document.getElementById('settingsAiProvider')?.value)
        ? document.getElementById('settingsAiProvider')?.value
        : defaults.provider ?? 'claude';
      const mode = provider === 'claude' && document.getElementById('settingsAiMode')?.value === 'api' ? 'api' : 'cli';
      const models = settingsAiModelsByProvider[provider] ?? settingsAiModelsByProvider.claude;
      const rawModel = document.getElementById('settingsAiModel')?.value ?? defaults.model ?? models[0];
      const model = models.includes(rawModel) ? rawModel : models[0];
      const profile = defaults.providerProfiles?.[provider] ?? defaults.cliProfile ?? defaults.claudeProfile;
      await postSettingsEditor('ai', '/api/setup/ai', mode === 'api'
        ? { provider, mode, model, apiKey: document.getElementById('settingsClaudeApiKey')?.value ?? '' }
        : { provider, mode, model, profile });
    }
    async function saveSettingsNotionParent() {
      await postSettingsEditor('notion', '/api/setup/notion/parent-page', {
        parentPageUrl: document.getElementById('settingsNotionParentPageUrl')?.value ?? ''
      });
    }
    async function verifySettingsNotionParent() {
      await postSettingsEditor('notionVerify', '/api/setup/notion/verify-parent-page', {});
    }
    async function saveSettingsAloneFinalize() {
      const graceSeconds = Number(document.getElementById('settingsAloneFinalizeGraceSeconds')?.value ?? 0);
      await postSettingsEditor('aloneFinalize', '/api/setup/recording/alone-finalize', {
        enabled: document.getElementById('settingsAloneFinalizeEnabled')?.checked === true,
        graceSeconds
      });
    }
    function renderRetentionSettings(setup) {
      const retention = setup?.features?.dataRetention;
      const defaultRetention = setup?.defaults?.retention;
      const audioPolicy = retention?.deleteAudioAfterNotionUpload === false
        ? 'dashboard.settings.retention.audioKept'
        : 'dashboard.settings.retention.audioDeleteAfterNotion';
      const days = settingsEditorState.retentionDays ??
        retention?.textDraftRetentionDays ??
        defaultRetention?.textDraftRetentionDays ?? 30;
      const daysMin = defaultRetention?.daysMin ?? 1;
      const daysMax = defaultRetention?.daysMax ?? 365;
      const statusCard = '<div class="metric"><div class="label">' + i18n('dashboard.settings.tabs.retention') + '</div>' +
        renderHumanDisplay(retention) +
        '<div class="muted">' + i18n(audioPolicy) + '<br>' +
        i18n('dashboard.settings.retention.audioReadOnly') + '</div></div>';
      const editCard = '<div class="metric"><div class="label">' + i18n('dashboard.settings.retention.editTitle') + '</div>' +
        '<div class="settings-grid">' +
        '<label>' + i18n('dashboard.settings.retention.textDraftLabel') +
        '<input id="settingsRetentionDays" type="number" min="' + daysMin + '" max="' + daysMax +
        '" step="1" value="' + escapeHtml(days) + '"></label></div>' +
        '<div class="muted">' + i18n('dashboard.settings.retention.consumeHint') + '</div>' +
        '<div class="toolbar"><button type="button" onclick="saveSettingsRetention()"' +
        (settingsEditorState.busy === 'retention' ? ' disabled' : '') + '>' +
        (settingsEditorState.busy === 'retention' ? i18n('dashboard.settings.editor.saving') : i18n('dashboard.settings.editor.save')) +
        '</button></div>' + renderSettingsEditorResult('retention') + '</div>';
      return statusCard + editCard;
    }
    async function saveSettingsRetention() {
      const raw = document.getElementById('settingsRetentionDays')?.value;
      const parsed = Number(raw);
      const textDraftRetentionDays = Number.isFinite(parsed) && parsed > 0
        ? Math.trunc(parsed)
        : undefined;
      await postSettingsEditor('retention', '/api/setup/retention', {
        textDraftRetentionDays
      });
    }
    function settingsRememberRetentionDays(value) {
      const parsed = Number(value);
      settingsEditorState.retentionDays = Number.isFinite(parsed) && parsed > 0
        ? Math.trunc(parsed)
        : null;
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
