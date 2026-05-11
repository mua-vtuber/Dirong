import type { NotionClient } from "./client.js";
import {
  readDataSourceProperties,
  readId,
  readResults,
} from "./data-source-readers.js";
import type { NotionDraftInput } from "./draft-input.js";
import {
  buildNotionPagePropertyValues,
  richText,
  sanitizeParticipantNames,
} from "./page-properties.js";
import type { NotionCustomPropertyRule } from "./property-rules.js";
import type { NotionSemanticResolvedProperty } from "./schema.js";
import {
  normalizeNotionId,
  parseNotionPageUrl,
  parseNotionTargetUrl,
} from "./target.js";
import {
  resolveTarget,
  type ManagedResolvedTarget,
  type RemoteResolvedTarget,
} from "./upload-target-resolver.js";

export async function renderNotionCustomPageProperties(input: {
  client: NotionClient | null;
  draftInput: NotionDraftInput;
  rules: readonly NotionCustomPropertyRule[];
}): Promise<Record<string, unknown>> {
  const properties: Record<string, unknown> = {};
  const enabledRules = input.rules.filter((rule) => rule.enabled);
  if (enabledRules.length === 0) {
    return properties;
  }

  for (const rule of enabledRules) {
    const values = readCustomPropertyValues(input.draftInput, rule);

    if (rule.propertyType === "relation") {
      const relation = await renderRelationProperty({
        client: input.client,
        rule,
        values,
      });
      if (relation.length > 0) {
        properties[rule.propertyName] = { relation };
      }
      continue;
    }

    if (values.length === 0) {
      continue;
    }
    if (rule.propertyType === "rich_text") {
      properties[rule.propertyName] = {
        rich_text: richText(values.join("\n").slice(0, rule.maxLength)),
      };
      continue;
    }
    if (rule.propertyType === "select") {
      properties[rule.propertyName] = { select: { name: values[0] } };
      continue;
    }
    if (rule.propertyType === "multi_select") {
      properties[rule.propertyName] = {
        multi_select: values.slice(0, 100).map((name) => ({ name })),
      };
      continue;
    }
    if (rule.propertyType === "checkbox") {
      properties[rule.propertyName] = {
        checkbox: readCheckboxValue(values[0] ?? ""),
      };
      continue;
    }
    if (rule.propertyType === "date") {
      const date = readDateValue(values[0] ?? "");
      if (date) {
        properties[rule.propertyName] = { date: { start: date } };
      }
      continue;
    }
  }

  return properties;
}

export async function resolveManagedMemberRelations(input: {
  client: NotionClient | null;
  draftInput: NotionDraftInput;
  target: ManagedResolvedTarget;
}): Promise<{ pageIds: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  if (!input.client) {
    return { pageIds: [], warnings };
  }

  const participants = buildNotionPagePropertyValues({
    draftInput: input.draftInput,
  });

  const pageIds: string[] = [];
  const seenPageIds = new Set<string>();
  for (const name of participants.values.participants) {
    const pageId = await findManagedMemberPageByDiscordName({
      client: input.client,
      target: input.target,
      name,
    });
    if (!pageId) {
      warnings.push(
        `Notion 작업자 DB에서 Discord 참가자 "${name}"를 찾지 못해 참가자 relation에서 제외했습니다.`,
      );
      continue;
    }
    if (seenPageIds.has(pageId)) {
      continue;
    }
    seenPageIds.add(pageId);
    pageIds.push(pageId);
  }

  return { pageIds, warnings };
}

async function findManagedMemberPageByDiscordName(input: {
  client: NotionClient;
  target: ManagedResolvedTarget;
  name: string;
}): Promise<string | null> {
  const filter = buildManagedMemberMatchFilter(
    input.target.memberDiscordNameProperty,
    input.name,
  );
  if (!filter) {
    return null;
  }

  const existing = await input.client.queryDataSource(
    input.target.memberDatabase.dataSourceId,
    {
      filter,
      page_size: 2,
    },
  );
  const results = readResults(existing);
  return results.length === 1 ? readId(results[0]) : null;
}

function buildManagedMemberMatchFilter(
  property: NotionSemanticResolvedProperty,
  value: string,
): Record<string, unknown> | null {
  if (property.type === "title") {
    return {
      property: property.name,
      title: { equals: value },
    };
  }
  if (property.type === "rich_text") {
    return {
      property: property.name,
      rich_text: { equals: value },
    };
  }
  return null;
}

function readCustomPropertyValues(
  draftInput: NotionDraftInput,
  rule: NotionCustomPropertyRule,
): string[] {
  if (rule.valueSource === "participants") {
    return sanitizeParticipantNames(
      draftInput.speakers
        .filter((speaker) => speaker.is_bot === 0)
        .map((speaker) => speaker.display_name_snapshot),
    ).map((value) => value.slice(0, rule.maxLength));
  }

  const notionProperties = draftInput.draftContent.notionProperties;
  const entry = notionProperties?.[rule.propertyName];
  const rawValues = isRecord(entry) && Array.isArray(entry.values)
    ? entry.values
    : Array.isArray(entry)
      ? entry
      : typeof entry === "string"
        ? [entry]
        : [];
  const seen = new Set<string>();
  const values: string[] = [];
  for (const rawValue of rawValues) {
    if (typeof rawValue !== "string") {
      continue;
    }
    const value = rawValue.replace(/\s+/g, " ").trim();
    if (!value) {
      continue;
    }
    const key = value.toLocaleLowerCase("ko-KR");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    values.push(value.slice(0, rule.maxLength));
  }
  return values;
}

async function renderRelationProperty(input: {
  client: NotionClient | null;
  rule: NotionCustomPropertyRule;
  values: readonly string[];
}): Promise<Array<{ id: string }>> {
  const fixedPageId = readRelationTargetPageId(input.rule);
  if (fixedPageId) {
    return [{ id: fixedPageId }];
  }
  if (!input.client) {
    return [];
  }
  if (input.values.length === 0) {
    return [];
  }
  const target = await resolveRelationTarget(input.client, input.rule);
  if (!target) {
    return [];
  }

  const matchPropertyName = input.rule.relationMatchPropertyName || "Name";
  const matchProperty = readDataSourceProperties(target.dataSource)[matchPropertyName];
  if (!matchProperty) {
    return [];
  }
  const relation: Array<{ id: string }> = [];
  for (const value of input.values.slice(0, 25)) {
    const pageId = await findOrCreateRelationPage({
      client: input.client,
      targetId: target.id,
      matchPropertyName,
      matchPropertyType: matchProperty.type ?? "unknown",
      value,
      autoCreate: input.rule.relationAutoCreate,
    });
    if (pageId) {
      relation.push({ id: pageId });
    }
  }
  return relation;
}

function readRelationTargetPageId(rule: NotionCustomPropertyRule): string | null {
  const storedId = rule.relationTargetPageId
    ? normalizeNotionId(rule.relationTargetPageId)
    : null;
  if (storedId) {
    return storedId;
  }
  if (!rule.relationTargetPageUrl) {
    return null;
  }
  const parsed = parseNotionPageUrl(rule.relationTargetPageUrl);
  return parsed.kind === "page_id" ? parsed.id : null;
}

async function resolveRelationTarget(
  client: NotionClient,
  rule: NotionCustomPropertyRule,
): Promise<RemoteResolvedTarget | null> {
  if (rule.relationTargetUrl) {
    const parsed = parseNotionTargetUrl(rule.relationTargetUrl);
    if (parsed.kind !== "invalid") {
      return await resolveTarget(client, parsed);
    }
  }
  if (rule.relationDataSourceId) {
    const dataSource = await client.retrieveDataSource(rule.relationDataSourceId);
    return {
      id: rule.relationDataSourceId,
      name: readTargetName(dataSource),
      dataSource,
    };
  }
  return null;
}

async function findOrCreateRelationPage(input: {
  client: NotionClient;
  targetId: string;
  matchPropertyName: string;
  matchPropertyType: string;
  value: string;
  autoCreate: boolean;
}): Promise<string | null> {
  const filter = buildRelationMatchFilter(input);
  if (!filter) {
    return null;
  }
  const existing = await input.client.queryDataSource(input.targetId, {
    filter,
    page_size: 2,
  });
  const results = readResults(existing);
  if (results.length === 1) {
    return readId(results[0]);
  }
  if (results.length > 1 || !input.autoCreate || input.matchPropertyType !== "title") {
    return null;
  }
  const created = await input.client.createPage({
    parent: { data_source_id: input.targetId },
    properties: {
      [input.matchPropertyName]: {
        title: richText(input.value),
      },
    },
  });
  return readId(created);
}

function buildRelationMatchFilter(input: {
  matchPropertyName: string;
  matchPropertyType: string;
  value: string;
}): Record<string, unknown> | null {
  if (input.matchPropertyType === "title") {
    return {
      property: input.matchPropertyName,
      title: { equals: input.value },
    };
  }
  if (input.matchPropertyType === "rich_text") {
    return {
      property: input.matchPropertyName,
      rich_text: { equals: input.value },
    };
  }
  if (input.matchPropertyType === "select") {
    return {
      property: input.matchPropertyName,
      select: { equals: input.value },
    };
  }
  return null;
}

function readCheckboxValue(value: string): boolean {
  return /^(true|yes|y|1|done|완료|예|네|맞음)$/i.test(value.trim());
}

function readDateValue(value: string): string | null {
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function readTargetName(dataSource: Record<string, unknown>): string {
  if (typeof dataSource.name === "string" && dataSource.name.trim()) {
    return dataSource.name.trim();
  }
  if (Array.isArray(dataSource.title)) {
    const title = readRichTextPlainText(dataSource.title);
    if (title) {
      return title;
    }
  }
  return "Notion data source";
}

function readRichTextPlainText(value: unknown[]): string {
  return value
    .map((part) =>
      isRecord(part) && typeof part.plain_text === "string"
        ? part.plain_text
        : isRecord(part) &&
            isRecord(part.text) &&
            typeof part.text.content === "string"
          ? part.text.content
          : "",
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
