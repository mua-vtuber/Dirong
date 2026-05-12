const setupStepDefinitions = [
      { id: 'language', title: '언어 선택' },
      { id: 'welcome', title: '환영/모드 선택' },
      { id: 'discord', title: 'Discord 봇 연결' },
      { id: 'guild', title: 'Discord 서버 선택' },
      { id: 'stt', title: 'STT provider/model 선택' },
      { id: 'ai', title: 'Claude CLI/API 선택' },
      { id: 'notionToken', title: 'Notion token 입력' },
      { id: 'notionParent', title: 'Notion parent page URL 입력' },
      { id: 'notionManaged', title: 'managed DB 생성' },
      { id: 'recording', title: '녹음 자동 종료 확인' },
      { id: 'privacy', title: '개인정보/보관 정책 확인' },
      { id: 'final', title: '최종 점검' }
    ];
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
        setHtml('setupWizard', '<div class="setup-top"><div><h2 class="setup-title">첫 설정 위자드</h2>' +
          '<p class="setup-copy">설정 상태 API를 기다리는 중입니다.</p></div></div>');
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
      const progress = setupStepDefinitions.filter((step) => isSetupStepReady(setup, step.id)).length;
      const stepButtons = setupStepDefinitions.map((step, index) => {
        const ready = isSetupStepReady(setup, step.id);
        const current = index === setupLocalState.stepIndex;
        const disabled = index > currentLimit && !ready;
        const className = 'setup-step' + (current ? ' is-active' : '') + (ready ? ' is-ready' : '');
        const mark = ready ? '✓ ' : current ? '• ' : '';
        return '<button type="button" class="' + className + '"' +
          (disabled ? ' disabled' : '') + ' onclick="setSetupStep(' + index + ')">' +
          mark + escapeHtml(step.title) + '</button>';
      }).join('');
      setHtml('setupWizard',
        '<div class="setup-top"><div><h2 class="setup-title">첫 설정 위자드</h2>' +
        '<p class="setup-copy">비개발자도 token, 서버 선택, STT, Claude, Notion 생성까지 대시보드에서 끝낼 수 있게 안내합니다.</p>' +
        '</div><div class="setup-progress">' + escapeHtml(progress) + ' / ' + escapeHtml(setupStepDefinitions.length) +
        '<br>' + escapeHtml(setup.status ?? 'not_configured') + '</div></div>' +
        '<div class="setup-layout"><nav class="setup-steps">' + stepButtons + '</nav>' +
        '<div class="setup-panel">' + renderSetupStepContent(activeStep.id, setup) +
        renderSetupResult() + '</div></div>'
      );
    }
    function isSetupStepReady(setup, id) {
      if (!setup) return false;
      if (id === 'language') return setup.locale === 'ko' || setup.locale === 'en';
      if (id === 'welcome') return setupLocalState.welcomeDone;
      if (id === 'discord') {
        return Boolean(setup.features?.discord?.applicationIdConfigured && setup.secrets?.discordBot?.configured);
      }
      if (id === 'guild') return (setup.features?.discord?.guildAllowlistCount ?? 0) > 0;
      if (id === 'stt') return setup.features?.stt?.status === 'ready';
      if (id === 'ai') return setup.features?.ai?.status === 'ready';
      if (id === 'notionToken') return setup.secrets?.notion?.configured === true;
      if (id === 'notionParent') return setup.features?.notion?.parentPageConfigured === true;
      if (id === 'notionManaged') return setup.features?.notion?.managedRegistryReady === true;
      if (id === 'recording') return setupLocalState.recordingDone;
      if (id === 'privacy') return setupLocalState.privacyDone;
      if (id === 'final') {
        return setup.status === 'ready' && setupLocalState.recordingDone && setupLocalState.privacyDone;
      }
      return false;
    }
    function renderSetupStepContent(id, setup) {
      if (id === 'language') return renderSetupLanguage(setup);
      if (id === 'welcome') return renderSetupWelcome();
      if (id === 'discord') return renderSetupDiscord(setup);
      if (id === 'guild') return renderSetupGuild(setup);
      if (id === 'stt') return renderSetupStt(setup);
      if (id === 'ai') return renderSetupAi(setup);
      if (id === 'notionToken') return renderSetupNotionToken(setup);
      if (id === 'notionParent') return renderSetupNotionParent(setup);
      if (id === 'notionManaged') return renderSetupNotionManaged(setup);
      if (id === 'recording') return renderSetupRecording();
      if (id === 'privacy') return renderSetupPrivacy(setup);
      return renderSetupFinal(setup);
    }
    function renderSetupLanguage(setup) {
      const locale = setup.locale ?? setupDefaults(setup)?.dashboard?.locale;
      return '<h3>앱 언어를 선택해 주세요</h3>' +
        '<p class="setup-copy">MVP에서는 앱 언어, 위자드 언어, Notion schema locale을 같은 값으로 저장합니다.</p>' +
        '<div class="setup-cards">' +
        setupRadioCard('setupLanguage', 'ko', locale, '한국어', 'Notion managed DB 생성을 지원합니다.') +
        setupRadioCard('setupLanguage', 'en', locale, 'English', 'UI language can be saved, but managed Notion DB creation is limited to Korean in this MVP.') +
        '</div>' +
        (locale === 'en' ? '<div class="setup-notice">English를 선택하면 Notion schema locale도 en으로 저장됩니다. 단, 이번 MVP의 managed Notion DB 자동 생성은 한국어 preset만 지원하므로 생성 단계에서 한국어로 전환하라는 안내가 표시됩니다.</div>' : '') +
        '<div class="setup-actions"><button type="button" onclick="setupSaveLanguage()">언어 저장</button>' +
        setupNextButton(setup, 'language') + '</div>';
    }
    function renderSetupWelcome() {
      return '<h3>로컬 개인 모드로 시작합니다</h3>' +
        '<p class="setup-copy">Dirong은 사용자의 PC에서 Discord 녹음, STT, Claude 회의록 생성, Notion 업로드를 연결합니다. Hosted Dirong bot이나 Notion OAuth는 이번 범위에 포함하지 않습니다.</p>' +
        '<div class="setup-cards">' +
        '<label class="setup-card is-selected"><input type="radio" checked> <strong>로컬 개인 모드</strong><br><span class="muted">사용자 소유 Discord bot token과 Notion internal connection을 저장합니다.</span></label>' +
        '<label class="setup-card"><input type="radio" disabled> <strong>Hosted mode</strong><br><span class="muted">후속 제품 결정 뒤 지원합니다.</span></label>' +
        '</div><div class="setup-actions"><button type="button" onclick="setupAcknowledge(&quot;welcomeDone&quot;)">계속</button></div>';
    }
    function renderSetupDiscord(setup) {
      const inviteUrl = setup.wizard?.inviteUrl ?? setupLocalState.lastResult?.inviteUrl ?? '';
      return '<h3>Discord 봇을 연결합니다</h3>' +
        '<p class="setup-copy">Discord Developer Portal에서 만든 application ID와 bot token을 저장합니다. Token은 저장 후 다시 표시하지 않습니다.</p>' +
        '<div class="setup-form">' +
        '<label>Discord application ID<input id="setupDiscordApplicationId" type="text" inputmode="numeric" autocomplete="off" placeholder="숫자 application ID"></label>' +
        '<div class="setup-actions"><button type="button" onclick="setupSaveDiscordApplicationId()">애플리케이션 ID 저장</button></div>' +
        (inviteUrl ? '<div class="setup-result setup-ok"><div class="label">초대 링크</div><a href="' + escapeHtml(inviteUrl) + '" target="_blank" rel="noreferrer">Discord 서버에 Dirong 봇 추가</a></div>' : '') +
        '<label>Discord bot token<input id="setupDiscordBotToken" type="password" autocomplete="off" placeholder="저장 후 화면에 다시 표시되지 않습니다"></label>' +
        '<div class="setup-actions"><button type="button" onclick="setupSaveDiscordBotToken()">bot token 저장</button>' +
        '<button type="button" onclick="setupTestDiscord()">연결 확인</button>' + setupNextButton(setup, 'discord') + '</div>' +
        '</div>';
    }
    function renderSetupGuild(setup) {
      const guilds = setupLocalState.guilds ?? [];
      const list = guilds.length
        ? '<div class="setup-guild-list">' + guilds.map((guild) =>
            '<label class="setup-guild"><input type="radio" name="setupGuild" value="' + escapeHtml(guild.id) + '"' +
            (setupLocalState.selectedGuildId === guild.id ? ' checked' : '') +
            ' onchange="setupRememberGuild(this.value)"> <strong>' + escapeHtml(guild.name) + '</strong></label>'
          ).join('') + '</div>'
        : '<div class="muted">아직 서버 목록을 불러오지 않았습니다.</div>';
      return '<h3>녹음을 허용할 Discord 서버를 선택합니다</h3>' +
        '<p class="setup-copy">봇이 들어간 서버 이름만 보여줍니다. 서버 ID는 직접 입력하지 않습니다.</p>' +
        '<div class="setup-actions"><button type="button" onclick="setupLoadGuilds()">서버 목록 불러오기</button></div>' +
        list +
        '<div class="setup-actions"><button type="button" onclick="setupSaveGuild()">선택한 서버 저장</button>' +
        setupNextButton(setup, 'guild') + '</div>';
    }
    function renderSetupStt(setup) {
      const defaults = setupDefaults(setup);
      const provider = setupLocalState.sttProvider ?? defaults?.stt?.provider;
      const model = setupLocalState.sttModel ?? defaults?.stt?.localWhisper?.model;
      return '<h3>STT provider와 모델을 선택합니다</h3>' +
        '<p class="setup-copy">기본 추천은 내 PC에서 처리하는 local faster-whisper입니다. OpenAI STT는 API 발급이 필요한 유료 고급 대안입니다.</p>' +
        '<div class="setup-cards">' +
        setupRadioCard('setupSttProvider', 'local-whisper', provider, '추천: local faster-whisper', '무료이며 음성이 외부 STT API로 전송되지 않습니다.', 'setupRememberSttProvider') +
        setupRadioCard('setupSttProvider', 'openai', provider, '고급: OpenAI STT 사용 (API 발급 필요 - 유료)', '처리는 쉬울 수 있지만 API 비용이 발생하고 음성이 OpenAI로 전송됩니다.', 'setupRememberSttProvider') +
        '</div>' +
        (provider === 'local-whisper'
          ? '<div class="setup-cards">' +
            setupRadioCard('setupSttModel', 'small', model, '추천: 빠름', 'small / cpu / int8. 대부분의 PC에 먼저 권장합니다.', 'setupRememberSttModel') +
            setupRadioCard('setupSttModel', 'medium', model, '정확도 우선', 'medium / cpu / int8. 더 느릴 수 있지만 한국어 회의 품질이 좋아질 수 있습니다.', 'setupRememberSttModel') +
            '</div>'
          : '<div class="setup-form"><label>OpenAI API key<input id="setupOpenAiApiKey" type="password" autocomplete="off" placeholder="API 발급 필요 - 유료"></label></div>') +
        '<div class="setup-actions"><button type="button" onclick="setupSaveStt()">STT 설정 저장</button>' +
        setupNextButton(setup, 'stt') + '</div>';
    }
    function renderSetupAi(setup) {
      const mode = setupLocalState.aiMode ?? setupDefaults(setup)?.ai?.mode;
      return '<h3>Claude 사용 방식을 선택합니다</h3>' +
        '<p class="setup-copy">MVP에서는 Claude만 실제 지원합니다. CLI 또는 API 중 하나를 선택합니다.</p>' +
        '<div class="setup-cards">' +
        setupRadioCard('setupAiMode', 'cli', mode, 'Claude CLI 사용', '로컬 Claude command를 실행해 회의록을 만듭니다.', 'setupRememberAiMode') +
        setupRadioCard('setupAiMode', 'api', mode, 'Claude API 사용', 'API key를 저장해 회의록을 만듭니다.', 'setupRememberAiMode') +
        '</div>' +
        '<div class="setup-form">' +
        (mode === 'cli'
          ? ''
          : '<label>Claude API key<input id="setupClaudeApiKey" type="password" autocomplete="off" placeholder="저장 후 화면에 다시 표시되지 않습니다"></label>') +
        '<label>Model (선택)<input id="setupClaudeModel" type="text" autocomplete="off" placeholder="비워 두면 기본값을 사용합니다"></label>' +
        '</div><div class="setup-actions"><button type="button" onclick="setupSaveClaude()">Claude 설정 저장</button>' +
        '<button type="button" onclick="setupTestClaude()">연결 확인</button>' + setupNextButton(setup, 'ai') + '</div>';
    }
    function renderSetupNotionToken(setup) {
      return '<h3>Notion internal connection token을 입력합니다</h3>' +
        '<p class="setup-copy">Notion 내부 연결 설정에서 token을 복사해 붙여넣습니다. Token은 local secret file에 저장되고 원문은 다시 표시하지 않습니다.</p>' +
        '<div class="setup-form"><label>Notion token<input id="setupNotionToken" type="password" autocomplete="off" placeholder="secret_ 또는 ntn_ token"></label></div>' +
        '<div class="setup-actions"><button type="button" onclick="setupSaveNotionToken()">Notion token 저장</button>' +
        setupNextButton(setup, 'notionToken') + '</div>';
    }
    function renderSetupNotionParent(setup) {
      return '<h3>Dirong 전용 Notion parent page URL을 입력합니다</h3>' +
        '<p class="setup-copy">데이터베이스 링크가 아니라, 회의록 표를 만들 상위 page 링크를 붙여넣습니다. 이 page에 Dirong internal connection을 Add connection으로 공유해 주세요.</p>' +
        '<div class="setup-form"><label>Parent page URL<input id="setupNotionParentPageUrl" type="url" autocomplete="off" placeholder="https://www.notion.so/..."></label></div>' +
        '<div class="setup-actions"><button type="button" onclick="setupSaveNotionParent()">parent page URL 저장</button>' +
        '<button type="button" onclick="setupVerifyNotionParent()">접근 확인</button>' + setupNextButton(setup, 'notionParent') + '</div>';
    }
    function renderSetupNotionManaged(setup) {
      const locale = setup.locale ?? setupDefaults(setup)?.dashboard?.locale;
      const unsupported = locale !== 'ko';
      const notice = unsupported
        ? '<div class="setup-notice">현재 앱 언어와 Notion schema locale은 ' + escapeHtml(locale) + '입니다. MVP managed Notion DB 자동 생성은 한국어 preset만 지원하므로, 생성하려면 언어 선택 단계에서 한국어로 바꿔 주세요.</div>'
        : '<div class="setup-notice setup-ok">이 버튼은 parent page 아래에 회의록, 작업자, 액션 아이템 DB를 만들고 registry에 내부 mapping을 저장합니다.</div>';
      return '<h3>Notion managed DB 세트를 생성합니다</h3>' +
        '<p class="setup-copy">사용자는 database id, data source id, property id를 입력하지 않습니다. Dirong이 생성 결과를 registry에 저장합니다.</p>' +
        notice +
        '<div class="setup-actions"><button type="button"' + (unsupported ? ' disabled' : '') + ' onclick="setupCreateManagedDatabases()">managed DB 생성</button>' +
        setupNextButton(setup, 'notionManaged') + '</div>' +
        renderManagedRegistryDetails(setup.features?.notion?.managedRegistry, { compact: true }) +
        renderCreatedNotionDatabases();
    }
    function renderSetupRecording() {
      return '<h3>녹음 자동 종료를 확인합니다</h3>' +
        '<p class="setup-copy">추천 기본값은 켜짐입니다. 음성 채널에 사람이 모두 나가고 Dirong 봇만 남으면 90초 뒤 녹음을 종료합니다.</p>' +
        '<label class="setup-guild"><input id="setupRecordingConfirm" type="checkbox"' + (setupLocalState.recordingDone ? ' checked' : '') + '> 자동 종료 기본값을 확인했습니다.</label>' +
        '<div class="setup-actions"><button type="button" onclick="setupConfirmRecording()">계속</button></div>';
    }
    function renderSetupPrivacy(setup) {
      const retention = setup.features?.dataRetention;
      const defaultRetention = setupDefaults(setup)?.retention;
      const audioCopy = retention?.deleteAudioAfterNotionUpload === false
        ? '음성 파일 자동 삭제가 꺼져 있으며 Dirong 실행 PC에 보관됩니다.'
        : '음성 파일은 Dirong 실행 PC에 저장되며, Notion 업로드 성공 후 즉시 삭제합니다.';
      return '<h3>개인정보와 보관 정책을 확인합니다</h3>' +
        '<p class="setup-copy">' + audioCopy + ' STT 텍스트와 AI draft는 기본 ' +
        escapeHtml(retention?.textDraftRetentionDays ?? defaultRetention?.textDraftRetentionDays ?? '-') + '일 뒤 삭제합니다.</p>' +
        '<label class="setup-guild"><input id="setupPrivacyConfirm" type="checkbox"' + (setupLocalState.privacyDone ? ' checked' : '') + '> 녹음 시작 안내와 기본 보관 정책을 확인했습니다.</label>' +
        '<div class="setup-actions"><button type="button" onclick="setupConfirmPrivacy()">계속</button></div>';
    }
    function renderSetupFinal(setup) {
      return '<h3>최종 점검</h3>' +
        '<p class="setup-copy">기능별 상태가 모두 ready이면 녹음부터 Notion 업로드까지 사용할 준비가 된 상태입니다.</p>' +
        renderSetupFeatureGrid(setup) +
        '<div class="setup-actions"><button type="button" onclick="setSetupStep(0)">처음부터 다시 보기</button></div>';
    }
    function setupRadioCard(name, value, current, title, body, handler) {
      const selected = current === value;
      const onChange = handler ? ' onchange="' + handler + '(this.value)"' : '';
      return '<label class="setup-card' + (selected ? ' is-selected' : '') + '">' +
        '<input type="radio" name="' + escapeHtml(name) + '" value="' + escapeHtml(value) + '"' +
        (selected ? ' checked' : '') + onChange + '> <strong>' + escapeHtml(title) + '</strong><br>' +
        '<span class="muted">' + escapeHtml(body) + '</span></label>';
    }
    function setupNextButton(setup, id) {
      const ready = isSetupStepReady(setup, id);
      return '<button type="button"' + (ready ? '' : ' disabled') + ' onclick="setupGoNext()">다음</button>';
    }
    function renderSetupResult() {
      const result = setupLocalState.lastResult;
      if (!result) return '';
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
        (database.url ? '<a href="' + escapeHtml(database.url) + '" target="_blank" rel="noreferrer">Notion에서 열기</a>' : '') +
        '</div>'
      ).join('') + '</div>';
    }
    function renderSetupFeatureGrid(setup) {
      const features = [
        ['Discord', setup.features?.discord],
        ['Recording', setup.features?.recording],
        ['STT', setup.features?.stt],
        ['AI', setup.features?.ai],
        ['Notion', setup.features?.notion],
        ['Data retention', setup.features?.dataRetention]
      ];
      return '<div class="setup-status-grid">' + features.map(([label, feature]) =>
        '<div class="setup-status-card"><div class="label">' + escapeHtml(label) + ' · ' +
        escapeHtml(feature?.status ?? '-') + '</div>' +
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
        if (Array.isArray(result.guilds)) {
          setupLocalState.guilds = result.guilds;
        }
        setupLocalState.forceRender = true;
        await refresh();
        setupLocalState.forceRender = false;
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setupLocalState.lastResult = { ok: false, status: 'failed', message, userAction: '잠시 후 다시 시도해 주세요.' };
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
    function setupConfirmRecording() {
      if (document.getElementById('setupRecordingConfirm')?.checked !== true) return;
      setupLocalState.recordingDone = true;
      window.localStorage.setItem('dirong.setup.recordingDone', 'true');
      setupGoNext();
    }
    function setupConfirmPrivacy() {
      if (document.getElementById('setupPrivacyConfirm')?.checked !== true) return;
      setupLocalState.privacyDone = true;
      window.localStorage.setItem('dirong.setup.privacyDone', 'true');
      setupGoNext();
    }
    async function setupSaveDiscordApplicationId() {
      await setupPost('/api/setup/discord/application-id', {
        applicationId: document.getElementById('setupDiscordApplicationId')?.value ?? ''
      });
    }
    async function setupSaveDiscordBotToken() {
      await setupPost('/api/setup/discord/bot-token', {
        botToken: document.getElementById('setupDiscordBotToken')?.value ?? ''
      });
    }
    async function setupTestDiscord() {
      await setupPost('/api/setup/discord/test', {});
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
        setupLocalState.lastResult = { ok: false, status: 'failed', message, userAction: 'Discord bot token 저장 상태를 확인해 주세요.' };
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
        await setupPost('/api/setup/stt', {
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
      await setupPost('/api/setup/stt', {
        provider: 'local-whisper',
        profile: defaults.stt.localWhisper.profile,
        model,
        device: defaults.stt.localWhisper.device,
        computeType: defaults.stt.localWhisper.computeType,
        language: defaults.stt.language,
        timeoutMs: defaults.stt.timeoutMs
      });
    }
    async function setupSaveClaude() {
      const defaults = requireSetupDefaults();
      if (!defaults) return;
      const mode = setupLocalState.aiMode ?? defaults.ai.mode;
      const model = document.getElementById('setupClaudeModel')?.value ?? '';
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
