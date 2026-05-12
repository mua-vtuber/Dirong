document.addEventListener('click', onNotionPropertyClick);
document.addEventListener('input', onNotionPropertyInput);
document.addEventListener('change', onNotionPropertyChange);

function renderNotionPropertyRules(state, role = 'meeting') {
      const notion = state.notion;
      const customRoot = notion?.customProperties;
      const custom = customRoot?.roles?.[role] ?? customRoot;
      const target = tr('dashboard.db.customFields.target.' + role);
      if (!custom) {
        return '<div class="metric"><div class="label">' + i18n('dashboard.db.customFields.unavailable.label') + '</div>' +
          '<div class="value">' + i18n('dashboard.db.customFields.unavailable.body') + '</div></div>';
      }
      const disabled = notion.status !== 'ready';
      const schemaDisabled = disabled || role !== 'meeting';
      const roleSchemaNotice = role === 'meeting'
        ? ''
        : '<div class="muted">' + i18n('dashboard.db.customFields.roleSchemaNotice') + '</div>';
      const rows = (custom.rules ?? []).map((rule) => renderNotionPropertyRuleRow(rule, custom));
      const ruleTable = '<table id="notionPropertyRulesTable" data-target-db-role="' + escapeHtml(role) + '"><thead><tr>' +
        [
          'dashboard.db.customFields.columns.enabled',
          'dashboard.db.customFields.columns.property',
          'dashboard.db.customFields.columns.type',
          'dashboard.db.customFields.columns.source',
          'dashboard.db.customFields.columns.description',
          'dashboard.db.customFields.columns.limit',
          'dashboard.db.customFields.columns.lastSeen',
          'dashboard.db.customFields.columns.actions'
        ].map((key) => '<th>' + i18n(key) + '</th>').join('') +
        '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
      const preview = custom.promptPreview
        ? '<details><summary class="muted">' + i18n('dashboard.db.customFields.promptPreview') + '</summary><pre>' + escapeHtml(custom.promptPreview) + '</pre></details>'
        : '';
      const action = custom.userAction
        ? '<div class="value">' + escapeHtml(custom.userAction) + '</div>'
        : '';
      return '<div class="metric">' +
        '<input type="hidden" id="notionPropertyTargetRole" value="' + escapeHtml(role) + '">' +
        '<div class="label">' + i18n('dashboard.db.customFields.targetLabel') + ' · ' +
        escapeHtml(target) + '</div>' +
        '<div class="label">' + i18n('dashboard.db.customFields.title') + ' · ' +
        i18n('dashboard.db.customFields.enabledCount', { count: custom.enabledCount ?? 0 }) + '</div>' +
        '<div class="value">' + escapeHtml(custom.message) + '</div>' +
        '<div class="muted">' + i18n('dashboard.db.customFields.meetingScopeNotice') + '<br>' +
        i18n('dashboard.db.customFields.unmanagedNotice') + '</div>' +
        roleSchemaNotice +
        action +
        '<div class="toolbar">' +
        '<button type="button" data-notion-action="sync"' + (disabled ? ' disabled' : '') + '>' +
        i18n('dashboard.db.customFields.actions.refresh') + '</button>' +
        '<button type="button" data-notion-action="add">' + i18n('dashboard.db.customFields.actions.add') + '</button>' +
        '<button type="button" data-notion-action="save">' + i18n('dashboard.db.customFields.actions.save') + '</button>' +
        '<button type="button" data-notion-action="inspect"' + (schemaDisabled ? ' disabled' : '') + '>' +
        i18n('dashboard.db.customFields.actions.inspect') + '</button>' +
        '<button type="button" data-notion-action="apply"' + (schemaDisabled ? ' disabled' : '') + '>' +
        i18n('dashboard.db.customFields.actions.apply') + '</button>' +
        '<label class="muted"><input type="checkbox" id="notionSchemaUpdateTypes"> ' +
        i18n('dashboard.db.customFields.actions.updateTypes') + '</label>' +
        '<span class="muted" id="notionPropertyStatus"></span>' +
        '</div>' + ruleTable + renderNotionSchemaResult(notionSchemaResult) + preview + '</div>';
    }
    function renderNotionPropertyRuleRow(rule, custom) {
      const checked = rule.enabled ? ' checked' : '';
      const original = rule.propertyName ?? '';
      const locked = rule.protected === true;
      const lockedAttr = locked ? ' data-protected-rule="true"' : '';
      const disabledAttr = locked ? ' disabled' : '';
      return '<tr data-notion-rule-row data-original-property-name="' + escapeHtml(original) + '"' + lockedAttr + '>' +
        '<td><input type="checkbox" data-field="enabled"' + checked + '></td>' +
        '<td><input type="text" data-field="propertyName" value="' + escapeHtml(rule.propertyName ?? '') +
        '"' + disabledAttr + '></td>' +
        '<td>' + renderPropertyTypeSelect(rule.propertyType ?? 'rich_text', custom.supportedTypes ?? [], locked) + '</td>' +
        '<td>' + renderValueSourceSelect(rule.valueSource ?? 'ai', locked) + '</td>' +
        '<td><textarea data-field="promptDescription">' +
        escapeHtml(rule.promptDescription ?? '') + '</textarea>' +
        renderRelationFields(rule) + '</td>' +
        '<td><input type="number" min="1" max="2000" data-field="maxLength" value="' +
        escapeHtml(rule.maxLength ?? 1000) + '"></td>' +
        '<td class="muted">' + escapeHtml(rule.lastSeenAt ?? '-') + '</td>' +
        '<td><button type="button" data-notion-action="delete-rule"' +
        (locked ? ' disabled title="' + i18n('dashboard.db.customFields.protectedDelete') + '"' : '') + '>' +
        i18n('dashboard.db.customFields.actions.remove') + '</button></td></tr>';
    }
    function renderPropertyTypeSelect(currentType, supportedTypes, disabled = false) {
      const types = supportedTypes.length ? supportedTypes : ['rich_text', 'select', 'multi_select', 'checkbox', 'date', 'relation'];
      const options = types.map((type) =>
        '<option value="' + escapeHtml(type) + '"' + (type === currentType ? ' selected' : '') + '>' +
        escapeHtml(propertyTypeLabel(type)) + '</option>'
      );
      if (!types.includes(currentType)) {
        options.unshift('<option value="' + escapeHtml(currentType) + '" selected>' +
          escapeHtml(propertyTypeLabel(currentType)) + '</option>');
      }
      return '<select data-field="propertyType"' +
        (disabled ? ' disabled' : '') + '>' + options.join('') + '</select>';
    }
    function propertyTypeLabel(type) {
      const catalogKey = 'dashboard.db.customFields.type.' + type;
      const label = tr(catalogKey);
      return label === catalogKey ? type : label;
    }
    function renderValueSourceSelect(currentSource, disabled = false) {
      const sources = [
        ['ai', tr('dashboard.db.customFields.source.ai')],
        ['participants', tr('dashboard.db.customFields.source.participants')]
      ];
      return '<select data-field="valueSource"' +
        (disabled ? ' disabled' : '') + '>' +
        sources.map(([value, label]) => '<option value="' + escapeHtml(value) + '"' +
          (value === currentSource ? ' selected' : '') + '>' + escapeHtml(label) + '</option>').join('') +
        '</select>';
    }
    function renderRelationFields(rule) {
      const visible = (rule.propertyType ?? '') === 'relation';
      return '<div class="relation-fields" data-relation-fields style="' + (visible ? '' : 'display:none') + '">' +
        '<input type="hidden" data-field="relationDataSourceId" value="' +
        escapeHtml(rule.relationDataSourceId ?? '') + '">' +
        '<input type="hidden" data-field="relationTargetPageId" value="' +
        escapeHtml(rule.relationTargetPageId ?? '') + '">' +
        '<label class="muted">' + i18n('dashboard.db.customFields.relation.targetDatabaseUrl') +
        '<input type="text" data-field="relationTargetUrl" value="' + escapeHtml(rule.relationTargetUrl ?? '') +
        '"></label>' +
        '<label class="muted">' + i18n('dashboard.db.customFields.relation.targetPageUrl') +
        '<input type="text" data-field="relationTargetPageUrl" value="' + escapeHtml(rule.relationTargetPageUrl ?? '') +
        '"></label>' +
        '<label class="muted">' + i18n('dashboard.db.customFields.relation.matchProperty') +
        '<input type="text" data-field="relationMatchPropertyName" value="' +
        escapeHtml(rule.relationMatchPropertyName ?? 'Name') + '"></label>' +
        '<label class="muted"><input type="checkbox" data-field="relationAutoCreate"' +
        (rule.relationAutoCreate ? ' checked' : '') + '> ' +
        i18n('dashboard.db.customFields.relation.autoCreate') + '</label>' +
        '</div>';
    }
    async function onNotionPropertyClick(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest('button[data-notion-action]');
      if (!button) return;
      const action = button.getAttribute('data-notion-action');
      if (!action) return;
      event.preventDefault();
      if (action === 'sync') {
        await syncNotionProperties();
        return;
      }
      if (action === 'add') {
        addNotionPropertyRule();
        return;
      }
      if (action === 'save') {
        await saveNotionPropertyRules();
        return;
      }
      if (action === 'inspect') {
        await inspectNotionSchema();
        return;
      }
      if (action === 'apply') {
        await applyNotionSchema();
        return;
      }
      if (action === 'delete-rule') {
        deleteNotionRuleRow(button);
      }
    }
    function onNotionPropertyInput(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('#notionPropertyRulesTable')) {
        markNotionRulesDirty();
      }
    }
    function onNotionPropertyChange(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest('#notionPropertyRulesTable')) return;
      if (target.matches('select[data-field="propertyType"]')) {
        onNotionPropertyTypeChange(target);
        return;
      }
      markNotionRulesDirty();
    }
    function onNotionPropertyTypeChange(select) {
      const row = select.closest('[data-notion-rule-row]');
      const relationFields = row?.querySelector('[data-relation-fields]');
      if (relationFields) {
        relationFields.style.display = select.value === 'relation' ? '' : 'none';
      }
      const valueSource = row?.querySelector('[data-field="valueSource"]');
      if (valueSource && select.value !== 'relation' && valueSource.value === 'participants') {
        valueSource.value = 'ai';
      }
      markNotionRulesDirty();
    }
    function markNotionRulesDirty() {
      notionRulesDirty = true;
    }
    function addNotionPropertyRule() {
      const tbody = document.querySelector('#notionPropertyRulesTable tbody');
      if (!tbody) return;
      const rule = {
        propertyName: '',
        propertyType: 'rich_text',
        valueSource: 'ai',
        enabled: true,
        promptDescription: '',
        maxLength: 1000,
        lastSeenAt: null
      };
      const custom = {
        supportedTypes: ['rich_text', 'select', 'multi_select', 'checkbox', 'date', 'relation']
      };
      tbody.insertAdjacentHTML('beforeend', renderNotionPropertyRuleRow(rule, custom));
      markNotionRulesDirty();
    }
    function deleteNotionRuleRow(button) {
      const row = button.closest('[data-notion-rule-row]');
      if (!row) return;
      if (row.getAttribute('data-protected-rule') === 'true') {
        const statusEl = document.getElementById('notionPropertyStatus');
        if (statusEl) statusEl.textContent = tr('dashboard.db.customFields.protectedDelete');
        return;
      }
      const original = row.getAttribute('data-original-property-name') ?? '';
      if (original) {
        row.setAttribute('data-deleted', 'true');
        row.style.display = 'none';
      } else {
        row.remove();
      }
      markNotionRulesDirty();
    }
    async function syncNotionProperties() {
      const statusEl = document.getElementById('notionPropertyStatus');
      if (statusEl) statusEl.textContent = tr('dashboard.db.customFields.status.syncing');
      try {
        const res = await fetch('/api/notion/properties/sync', {
          method: 'POST',
          headers: dashboardJsonHeaders(),
          body: JSON.stringify({
            targetDatabaseRole: document.getElementById('notionPropertyTargetRole')?.value ?? 'meeting'
          })
        });
        const result = await res.json();
        notionRulesDirty = false;
        if (statusEl) statusEl.textContent = actionStatusText(result);
        refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (statusEl) statusEl.textContent = message;
      }
    }
    function renderNotionSchemaResult(result) {
      if (!result) {
        return '';
      }
      const diff = result.diff;
      const warnings = (result.warnings ?? []).length
        ? '<div class="warn">' + result.warnings.map(escapeHtml).join('<br>') + '</div>'
        : '';
      if (!diff) {
        return '<div style="margin-top:10px"><div class="value ' + runtimeValueClass(result.status) + '">' +
          escapeHtml(actionStatusText(result)) + '</div>' + warnings + '</div>';
      }
      const rows = []
        .concat((diff.missing ?? []).map((item) => schemaRow(
          tr('dashboard.db.customFields.schemaResult.categories.missing'),
          item.propertyName,
          propertyTypeLabel(item.propertyType),
          tr('dashboard.db.customFields.schemaResult.handling.autoPossible')
        )))
        .concat((diff.renames ?? []).map((item) => schemaRow(
          tr('dashboard.db.customFields.schemaResult.categories.rename'),
          item.fromName + ' -> ' + item.toName,
          propertyTypeLabel(item.propertyType),
          tr('dashboard.db.customFields.schemaResult.handling.autoPossible')
        )))
        .concat((diff.wrongType ?? []).map((item) => schemaRow(
          tr('dashboard.db.customFields.schemaResult.categories.wrongType'),
          item.propertyName,
          propertyTypeLabel(item.actualType) + ' -> ' + propertyTypeLabel(item.expectedType),
          item.canUpdate ? tr('dashboard.db.customFields.schemaResult.handling.autoPossible') : tr('dashboard.db.customFields.schemaResult.handling.manualNeeded')
        )))
        .concat((diff.missingOptions ?? []).map((item) => schemaRow(
          tr('dashboard.db.customFields.schemaResult.categories.missingOptions'),
          item.propertyName,
          item.missingOptions.join(', '),
          item.canUpdate ? tr('dashboard.db.customFields.schemaResult.handling.autoPossible') : tr('dashboard.db.customFields.schemaResult.handling.manualNeeded')
        )))
        .concat((diff.extra ?? []).map((item) => schemaRow(
          tr('dashboard.db.customFields.schemaResult.categories.extra'),
          item.propertyName,
          propertyTypeLabel(item.propertyType),
          tr('dashboard.db.customFields.schemaResult.handling.preserved')
        )));
      const detail = rows.length
        ? table([
            tr('dashboard.table.summary'),
            tr('dashboard.db.customFields.columns.property'),
            tr('dashboard.db.customFields.columns.type'),
            tr('dashboard.table.nextAction')
          ], rows)
        : '<div class="muted">' + i18n('dashboard.db.customFields.schemaResult.ok') + '</div>';
      return '<div style="margin-top:10px">' +
        '<div class="label">' + i18n('dashboard.db.customFields.schemaResult.title') + ' · ' +
        escapeHtml(statusLabel(result.status)) + '</div>' +
        '<div class="value ' + runtimeValueClass(result.status) + '">' + escapeHtml(result.message) + '</div>' +
        (result.userAction ? '<div class="muted">' + escapeHtml(result.userAction) + '</div>' : '') +
        warnings + detail + '</div>';
    }
    function schemaRow(kind, property, type, handling) {
      return '<tr><td>' + escapeHtml(kind) + '</td><td>' + escapeHtml(property) +
        '</td><td>' + escapeHtml(type) + '</td><td>' + escapeHtml(handling) + '</td></tr>';
    }
    function actionStatusText(result) {
      const label = statusLabel(result?.status);
      const message = result?.message ?? (result?.messageKey ? tr(result.messageKey) : '');
      return message ? label + ': ' + message : label;
    }
    async function saveNotionPropertyRules(options = {}) {
      const statusEl = document.getElementById('notionPropertyStatus');
      if (statusEl) statusEl.textContent = tr('dashboard.db.customFields.status.saving');
      const targetDatabaseRole = document.getElementById('notionPropertyTargetRole')?.value ?? 'meeting';
      const rules = Array.from(document.querySelectorAll('[data-notion-rule-row]')).map((row) => ({
        originalPropertyName: row.getAttribute('data-original-property-name') || null,
        propertyName: row.querySelector('[data-field="propertyName"]')?.value ?? '',
        propertyType: row.querySelector('[data-field="propertyType"]')?.value ?? 'rich_text',
        valueSource: row.querySelector('[data-field="valueSource"]')?.value ?? 'ai',
        enabled: row.querySelector('[data-field="enabled"]')?.checked === true,
        promptDescription: row.querySelector('[data-field="promptDescription"]')?.value ?? '',
        maxLength: Number(row.querySelector('[data-field="maxLength"]')?.value ?? 1000),
        relationTargetUrl: row.querySelector('[data-field="relationTargetUrl"]')?.value ?? '',
        relationDataSourceId: row.querySelector('[data-field="relationDataSourceId"]')?.value ?? '',
        relationTargetPageUrl: row.querySelector('[data-field="relationTargetPageUrl"]')?.value ?? '',
        relationTargetPageId: row.querySelector('[data-field="relationTargetPageId"]')?.value ?? '',
        relationMatchPropertyName: row.querySelector('[data-field="relationMatchPropertyName"]')?.value ?? 'Name',
        relationAutoCreate: row.querySelector('[data-field="relationAutoCreate"]')?.checked === true,
        deleted: row.getAttribute('data-deleted') === 'true'
      }));
      try {
        const res = await fetch('/api/notion/properties', {
          method: 'POST',
          headers: dashboardJsonHeaders(),
          body: JSON.stringify({ targetDatabaseRole, rules })
        });
        const result = await res.json();
        notionRulesDirty = false;
        if (statusEl) statusEl.textContent = actionStatusText(result);
        if (options.refresh !== false) {
          refresh();
        }
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (statusEl) statusEl.textContent = message;
        throw error;
      }
    }
    async function inspectNotionSchema() {
      const statusEl = document.getElementById('notionPropertyStatus');
      if (statusEl) statusEl.textContent = tr('dashboard.db.customFields.status.checking');
      try {
        if (notionRulesDirty) {
          await saveNotionPropertyRules({ refresh: false });
        }
        const res = await fetch('/api/notion/schema/inspect', {
          method: 'POST',
          headers: dashboardJsonHeaders(),
          body: '{}'
        });
        notionSchemaResult = await res.json();
        if (statusEl) statusEl.textContent = actionStatusText(notionSchemaResult);
        notionRulesDirty = false;
        refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (statusEl) statusEl.textContent = message;
      }
    }
    async function applyNotionSchema() {
      const statusEl = document.getElementById('notionPropertyStatus');
      if (statusEl) statusEl.textContent = tr('dashboard.db.customFields.status.applying');
      try {
        if (notionRulesDirty) {
          await saveNotionPropertyRules({ refresh: false });
        }
        const body = {
          createMissing: true,
          updateTypes: document.getElementById('notionSchemaUpdateTypes')?.checked === true,
          deleteExtra: false,
          confirmDeleteExtra: false
        };
        const res = await fetch('/api/notion/schema/apply', {
          method: 'POST',
          headers: dashboardJsonHeaders(),
          body: JSON.stringify(body)
        });
        notionSchemaResult = await res.json();
        if (statusEl) statusEl.textContent = actionStatusText(notionSchemaResult);
        notionRulesDirty = false;
        refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (statusEl) statusEl.textContent = message;
      }
    }
    async function postNotionAction(action) {
      const statusEl = document.getElementById('notionActionStatus');
      if (statusEl) statusEl.textContent = 'running...';
      try {
        const stateRes = await fetch('/api/state', { cache: 'no-store' });
        const state = await stateRes.json();
        const body = {
          draftId: state.latestMeetingNotesDraft?.id ?? null,
          sessionId: state.currentSession?.id ?? null
        };
        const res = await fetch('/api/notion/' + action, {
          method: 'POST',
          headers: dashboardJsonHeaders(),
          body: JSON.stringify(body)
        });
        const result = await res.json();
        if (statusEl) statusEl.textContent = result.status + ': ' + result.message;
        refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (statusEl) statusEl.textContent = message;
      }
    }
