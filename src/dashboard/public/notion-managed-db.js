document.addEventListener('click', onManagedDbClick);

let managedDbCheckResult = null;
let managedDbBusyAction = null;

function clearManagedDbCheckResult() {
      managedDbCheckResult = null;
      managedDbBusyAction = null;
    }

function renderManagedDbPanel(state, setup, role) {
      const registry = state.notion?.managedRegistry ?? setup?.features?.notion?.managedRegistry ?? null;
      const remoteCheck = managedDbCheckResult?.snapshot ?? registry?.remoteCheck ?? null;
      return renderManagedDatabaseStatus(registry, remoteCheck, role) +
        renderManagedRequiredFields(registry, remoteCheck, role) +
        renderManagedSchemaActions(registry, role) +
        renderManagedRepairPlan(role);
    }

function renderManagedDatabaseStatus(registry, remoteCheck, role) {
      if (!registry) {
        return '<div class="metric"><div class="label">' + i18n('dashboard.db.status.title') + '</div>' +
          '<div class="value">' + i18n('dashboard.db.registry.missing') + '</div></div>';
      }
      const database = managedRegistryDatabase(registry, role);
      const remote = managedRemoteRole(remoteCheck, role);
      const databaseName = database?.expectedName ?? tr('dashboard.db.customFields.target.' + role);
      const registryStatus = database
        ? database.ready ? 'ready' : database.hasDatabase ? 'partial' : 'missing'
        : 'missing';
      const remoteStatus = remote?.remote?.status ?? 'unchecked';
      const parent = registry.workspace?.parentPageUrl
        ? '<div class="muted">' + i18n('dashboard.db.registry.parentPage') + ': <a href="' +
          escapeHtml(registry.workspace.parentPageUrl) + '" target="_blank" rel="noreferrer">' +
          i18n('dashboard.common.openNotion') + '</a></div>'
        : '';
      const notionLink = database?.url
        ? '<div class="value"><a href="' + escapeHtml(database.url) + '" target="_blank" rel="noreferrer">' +
          i18n('dashboard.common.openNotion') + '</a></div>'
        : '';
      const remoteError = remote?.remote?.error
        ? '<div class="display-next">' + i18n('dashboard.db.requiredFields.checkFailed') + ': ' +
          escapeHtml(remote.remote.error) + '</div>'
        : '';
      return '<div class="metric"><div class="label">' + i18n('dashboard.db.status.title') +
        ' · ' + escapeHtml(databaseName) + '</div>' +
        '<div class="value ' + runtimeValueClass(registryStatus) + '">' +
        i18n('dashboard.db.requiredFields.registryLabel') + ' · ' + escapeHtml(statusLabel(registryStatus)) +
        '</div>' +
        '<div class="muted">' + i18n('dashboard.db.registry.summary', {
          databaseCount: registry.databaseCount ?? 0,
          expectedDatabaseCount: registry.expectedDatabaseCount ?? 3,
          mappingCount: database?.mappingCount ?? 0,
          expectedMappingCount: database?.expectedMappingCount ?? 0
        }) + '</div>' +
        '<div class="value ' + managedRemoteClass(remoteStatus) + '">' +
        i18n('dashboard.db.requiredFields.remoteLabel') + ' · ' + managedRemoteStatusLabel(remoteStatus) +
        '</div>' +
        '<div class="muted">' + i18n('dashboard.db.requiredFields.lastChecked') + ': ' +
        escapeHtml(remote?.remote?.checkedAt ?? remoteCheck?.checkedAt ?? tr('dashboard.db.requiredFields.notChecked')) +
        '</div>' + remoteError + parent + notionLink + '</div>';
    }

function renderManagedRequiredFields(registry, remoteCheck, role) {
      const database = managedRegistryDatabase(registry, role);
      if (!database) {
        return '<div class="metric"><div class="label">' + i18n('dashboard.db.registry.title') + '</div>' +
          '<div class="value">' + i18n('dashboard.db.registry.missing') + '</div></div>';
      }
      const registryMissing = new Set(database.missingSemanticKeys ?? []);
      const issuesByKey = managedIssuesBySemanticKey(remoteCheck, role);
      const keys = requiredKeysForRole(role);
      const problemKeys = new Set(registryMissing);
      for (const key of issuesByKey.keys()) {
        problemKeys.add(key);
      }
      const missingCount = problemKeys.size;
      const summary = missingCount > 0
        ? '<div class="setup-notice"><strong>' +
          i18n('dashboard.db.requiredFields.missingSummary', { count: missingCount }) +
          '</strong><br>' + i18n('dashboard.db.requiredFields.repairHelp') + '</div>'
        : '';
      return '<div style="margin-top:12px"><div class="section-heading"><h2>' +
        i18n('dashboard.db.requiredFields.title') + '</h2></div>' +
        '<p class="muted">' + i18n('dashboard.db.requiredFields.info') + '</p>' +
        '<div class="required-field-grid">' + keys.map((key) => {
          const issues = issuesByKey.get(key) ?? [];
          const hasProblem = registryMissing.has(key) || issues.some((issue) => issue.severity !== 'warning');
          const issueText = renderManagedFieldStatus(registryMissing.has(key), issues);
          return '<div class="required-field' + (hasProblem ? ' is-missing' : '') + '">' +
            '<div class="value">' + escapeHtml(propertyLabel(key)) + '</div><div class="muted">' +
            i18n('dashboard.db.requiredFields.locked') + ' · ' + issueText +
            '</div></div>';
        }).join('') + '</div>' + summary + '</div>';
    }

function renderManagedSchemaActions(registry, role) {
      const disabled = managedDbBusyAction !== null || !registry || registry.status === 'missing';
      const disabledAttr = disabled ? ' disabled' : '';
      const statusText = managedDbCheckResult
        ? actionStatusText(managedDbCheckResult)
        : '';
      return '<div class="metric"><div class="label">' + i18n('dashboard.db.requiredFields.remoteLabel') +
        ' · ' + escapeHtml(managedDbRoleLabel(role)) + '</div>' +
        '<div class="toolbar">' +
        '<button type="button" data-managed-db-action="check"' + disabledAttr + '>' +
        i18n('dashboard.db.requiredFields.checkAction') + '</button>' +
        '<span class="muted" id="managedDbActionStatus">' + escapeHtml(statusText) + '</span>' +
        '</div></div>';
    }

function renderManagedRepairPlan(role) {
      const plan = managedPlanForRole(role);
      if (!plan) {
        return '<div class="metric"><div class="label">' +
          i18n('dashboard.db.requiredFields.planTitle') + '</div>' +
          '<div class="muted">' + i18n('dashboard.db.requiredFields.planMissing') + '</div>' +
          '<div class="toolbar"><button type="button" data-managed-db-action="repair" disabled>' +
          i18n('dashboard.db.requiredFields.repairAction') + '</button></div></div>';
      }
      const operations = Array.isArray(plan.operations) ? plan.operations : [];
      const blocked = Array.isArray(plan.blocked) ? plan.blocked : [];
      const canApply = plan.status === 'ready' && operations.length > 0 && managedDbBusyAction === null;
      const operationsHtml = operations.length
        ? '<div class="label">' + i18n('dashboard.db.requiredFields.operations') + '</div>' +
          '<table><tbody>' + operations.map((operation) =>
            '<tr><td><label><input type="checkbox" data-managed-repair-operation="' +
            escapeHtml(operation.id) + '" checked> ' + escapeHtml(operation.description) +
            '</label></td><td>' + escapeHtml(propertyLabel(operation.semanticKey)) + '</td></tr>'
          ).join('') + '</tbody></table>'
        : '<div class="muted">' + i18n('dashboard.db.requiredFields.planEmpty') + '</div>';
      const blockedHtml = blocked.length
        ? '<div class="label">' + i18n('dashboard.db.requiredFields.blockedItems') + '</div>' +
          '<table><tbody>' + blocked.map((item) =>
            '<tr><td>' + escapeHtml(item.semanticKey ? propertyLabel(item.semanticKey) : item.propertyName) +
            '</td><td>' + escapeHtml(item.reason) + '</td></tr>'
          ).join('') + '</tbody></table>'
        : '';
      const warnings = plan.warnings?.length
        ? '<div class="muted">' + plan.warnings.map(escapeHtml).join('<br>') + '</div>'
        : '';
      const summaryKey = canApply
        ? 'dashboard.db.requiredFields.planReady'
        : plan.status === 'blocked'
          ? 'dashboard.db.requiredFields.planBlocked'
          : 'dashboard.db.requiredFields.planEmpty';
      return '<div class="metric" data-managed-repair-plan data-role="' + escapeHtml(role) +
        '" data-plan-hash="' + escapeHtml(plan.planHash ?? '') + '">' +
        '<div class="label">' + i18n('dashboard.db.requiredFields.planTitle') +
        ' · ' + managedRepairStatusLabel(plan.status) + '</div>' +
        '<div class="value">' + i18n(summaryKey, { count: operations.length }) + '</div>' +
        operationsHtml + blockedHtml + warnings +
        '<div class="toolbar"><button type="button" data-managed-db-action="repair"' +
        (canApply ? '' : ' disabled') + '>' + i18n('dashboard.db.requiredFields.repairAction') +
        '</button></div></div>';
    }

function renderManagedFieldStatus(registryMissing, issues) {
      const labels = [];
      if (registryMissing) {
        labels.push(i18n('dashboard.db.requiredFields.issue.registryMissing'));
      }
      for (const issue of issues) {
        if (registryMissing && issue.code === 'mapping_missing') {
          continue;
        }
        labels.push(managedIssueLabel(issue));
      }
      return labels.length ? labels.join(' · ') : i18n('dashboard.db.requiredFields.normal');
    }

function managedIssuesBySemanticKey(remoteCheck, role) {
      const result = new Map();
      const issues = managedRemoteRole(remoteCheck, role)?.remote?.diff?.issues ?? [];
      for (const issue of issues) {
        if (!issue.semanticKey || issue.code === 'extra') {
          continue;
        }
        const current = result.get(issue.semanticKey) ?? [];
        current.push(issue);
        result.set(issue.semanticKey, current);
      }
      return result;
    }

function managedIssueLabel(issue) {
      const map = {
        mapping_missing: 'dashboard.db.requiredFields.issue.registryMissing',
        remote_missing: 'dashboard.db.requiredFields.issue.remoteMissing',
        name_drift: 'dashboard.db.requiredFields.issue.nameDrift',
        wrong_type: 'dashboard.db.requiredFields.issue.wrongType',
        relation_target_mismatch: 'dashboard.db.requiredFields.issue.relationTarget',
        rollup_target_mismatch: 'dashboard.db.requiredFields.issue.rollupTarget',
        option_missing: 'dashboard.db.requiredFields.issue.optionMissing',
        extra: 'dashboard.db.requiredFields.issue.extra'
      };
      const key = map[issue.code] ?? 'dashboard.db.requiredFields.issue.unknown';
      return i18n(key);
    }

function managedRegistryDatabase(registry, role) {
      return (registry?.databases ?? []).find((db) => db.role === role) ?? null;
    }

function managedRemoteRole(remoteCheck, role) {
      return (remoteCheck?.databases ?? []).find((db) => db.role === role) ?? null;
    }

function managedPlanForRole(role) {
      if (managedDbCheckResult?.plans?.[role]) {
        return managedDbCheckResult.plans[role];
      }
      if (managedDbCheckResult?.plan?.role === role) {
        return managedDbCheckResult.plan;
      }
      return null;
    }

function managedDbRoleLabel(role) {
      return tr('dashboard.db.customFields.target.' + role);
    }

function managedRemoteStatusLabel(status) {
      const key = {
        unchecked: 'dashboard.db.requiredFields.remoteStatus.unchecked',
        checking: 'dashboard.db.requiredFields.remoteStatus.checking',
        healthy: 'dashboard.db.requiredFields.remoteStatus.healthy',
        needs_repair: 'dashboard.db.requiredFields.remoteStatus.needsRepair',
        manual_required: 'dashboard.db.requiredFields.remoteStatus.manualRequired',
        failed: 'dashboard.db.requiredFields.remoteStatus.failed'
      }[String(status ?? 'unchecked')] ?? 'dashboard.db.requiredFields.remoteStatus.unchecked';
      return i18n(key);
    }

function managedRepairStatusLabel(status) {
      const key = {
        empty: 'dashboard.db.requiredFields.planStatus.empty',
        ready: 'dashboard.db.requiredFields.planStatus.ready',
        blocked: 'dashboard.db.requiredFields.planStatus.blocked'
      }[String(status ?? 'empty')] ?? 'dashboard.db.requiredFields.planStatus.empty';
      return i18n(key);
    }

function managedRemoteClass(status) {
      const normalized = String(status ?? 'unchecked');
      if (normalized === 'healthy') return 'status';
      if (normalized === 'needs_repair' || normalized === 'unchecked') return 'warn';
      return 'error';
    }

async function onManagedDbClick(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest('button[data-managed-db-action]');
      if (!button) return;
      const action = button.getAttribute('data-managed-db-action');
      if (!action) return;
      event.preventDefault();
      if (action === 'check') {
        await checkManagedSchema();
        return;
      }
      if (action === 'repair') {
        await repairManagedSchema(button);
      }
    }

async function checkManagedSchema() {
      const statusEl = document.getElementById('managedDbActionStatus');
      managedDbBusyAction = 'check';
      if (statusEl) statusEl.textContent = tr('dashboard.db.requiredFields.checking');
      try {
        const res = await fetch('/api/notion/managed-schema/check', {
          method: 'POST',
          headers: dashboardJsonHeaders(),
          body: '{}'
        });
        managedDbCheckResult = await res.json();
        if (statusEl) statusEl.textContent = actionStatusText(managedDbCheckResult);
        managedDbBusyAction = null;
        await refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (statusEl) statusEl.textContent = message;
      } finally {
        managedDbBusyAction = null;
      }
    }

async function repairManagedSchema(button) {
      const planEl = button.closest('[data-managed-repair-plan]');
      const statusEl = document.getElementById('managedDbActionStatus');
      const role = planEl?.getAttribute('data-role') ?? '';
      const expectedPlanHash = planEl?.getAttribute('data-plan-hash') ?? '';
      const operations = Array.from(
        planEl?.querySelectorAll('[data-managed-repair-operation]:checked') ?? []
      ).map((input) => input.getAttribute('data-managed-repair-operation')).filter(Boolean);
      if (!role || !expectedPlanHash || operations.length === 0) {
        if (statusEl) statusEl.textContent = tr('dashboard.db.requiredFields.planMissing');
        return;
      }
      if (!window.confirm(tr('dashboard.db.requiredFields.confirmRepair'))) {
        return;
      }
      managedDbBusyAction = 'repair';
      if (statusEl) statusEl.textContent = tr('dashboard.db.requiredFields.repairing');
      try {
        const res = await fetch('/api/notion/managed-schema/repair', {
          method: 'POST',
          headers: dashboardJsonHeaders(),
          body: JSON.stringify({
            role,
            confirm: true,
            expectedPlanHash,
            operations
          })
        });
        managedDbCheckResult = await res.json();
        if (statusEl) statusEl.textContent = actionStatusText(managedDbCheckResult);
        if (res.ok) {
          managedDbBusyAction = null;
          await checkManagedSchema();
        } else {
          managedDbBusyAction = null;
          await refresh();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (statusEl) statusEl.textContent = message;
      } finally {
        managedDbBusyAction = null;
      }
    }
