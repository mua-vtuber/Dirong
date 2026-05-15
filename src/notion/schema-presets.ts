export const NOTION_LOCALES = ["ko", "en"] as const;
export type NotionLocale = (typeof NOTION_LOCALES)[number];

export const NOTION_DATABASE_ROLES = ["meeting", "member", "task"] as const;
export type NotionDatabaseRole = (typeof NOTION_DATABASE_ROLES)[number];

export const NOTION_PROPERTY_SEMANTIC_KEYS = [
  "meeting.title",
  "meeting.date",
  "meeting.time",
  "meeting.channel",
  "meeting.memberRelation",
  "meeting.participants",
  "meeting.actionItems",
  "meeting.status",
  "meeting.sessionId",
  "meeting.draftId",
  "meeting.contentHash",
  "meeting.localStatus",
  "member.discordName",
  "member.notionPerson",
  "member.organization",
  "member.roles",
  "task.title",
  "task.meeting",
  "task.workerRelation",
  "task.assignee",
  "task.role",
  "task.dueDate",
  "task.status",
  "task.evidence",
  "task.sourceActionId",
] as const;
export type NotionPropertySemanticKey =
  (typeof NOTION_PROPERTY_SEMANTIC_KEYS)[number];

export type NotionSchemaPresetPropertyType =
  | "title"
  | "rich_text"
  | "date"
  | "people"
  | "select"
  | "multi_select"
  | "status"
  | "relation"
  | "rollup";

export type NotionRelationPresetTarget =
  | {
      mode: "direct";
      targetDatabase: NotionDatabaseRole;
    }
  | {
      mode: "synced";
      targetDatabase: NotionDatabaseRole;
      sourceProperty: NotionPropertySemanticKey;
    };

export type NotionRollupPresetTarget = {
  relationProperty: NotionPropertySemanticKey;
  targetProperty: NotionPropertySemanticKey;
};

export type NotionSchemaPresetProperty = {
  key: NotionPropertySemanticKey;
  name: string;
  type: NotionSchemaPresetPropertyType;
  locked: boolean;
  options?: readonly string[];
  relation?: NotionRelationPresetTarget;
  rollup?: NotionRollupPresetTarget;
};

export type NotionSchemaPresetDatabase = {
  name: string;
  properties: readonly NotionSchemaPresetProperty[];
};

export type NotionSchemaPreset = {
  locale: NotionLocale;
  databases: Record<NotionDatabaseRole, NotionSchemaPresetDatabase>;
};

export type NotionSchemaPresetValidationErrorCode =
  | "missing_database"
  | "missing_semantic_key"
  | "duplicate_semantic_key"
  | "semantic_key_role_mismatch"
  | "duplicate_property_name"
  | "missing_relation_target"
  | "unexpected_relation_target"
  | "missing_rollup_target"
  | "unexpected_rollup_target"
  | "invalid_relation_database"
  | "invalid_synced_relation"
  | "invalid_rollup_target"
  | "invalid_task_status_options";

export type NotionSchemaPresetValidationError = {
  code: NotionSchemaPresetValidationErrorCode;
  message: string;
  databaseRole?: NotionDatabaseRole;
  semanticKey?: NotionPropertySemanticKey;
};

export type NotionSchemaPresetValidation =
  | { ok: true; errors: [] }
  | { ok: false; errors: NotionSchemaPresetValidationError[] };

export const NOTION_TASK_STATUS_OPTIONS = ["할 일", "진행 중", "완료"] as const;
export const ENGLISH_NOTION_TASK_STATUS_OPTIONS = [
  "To do",
  "In progress",
  "Done",
] as const;

export const NOTION_MEETING_STATUS_OPTIONS = [
  "draft",
  "done",
  "retry_wait",
  "failed",
] as const;

const NOTION_TASK_STATUS_OPTIONS_BY_LOCALE = {
  ko: NOTION_TASK_STATUS_OPTIONS,
  en: ENGLISH_NOTION_TASK_STATUS_OPTIONS,
} as const satisfies Record<NotionLocale, readonly string[]>;

export const KOREAN_NOTION_SCHEMA_PRESET = {
  locale: "ko",
  databases: {
    meeting: {
      name: "회의록",
      properties: [
        { key: "meeting.title", name: "회의록", type: "title", locked: true },
        { key: "meeting.date", name: "날짜", type: "date", locked: true },
        {
          key: "meeting.time",
          name: "회의 시간",
          type: "rich_text",
          locked: true,
        },
        {
          key: "meeting.channel",
          name: "채널",
          type: "rich_text",
          locked: true,
        },
        {
          key: "meeting.memberRelation",
          name: "참가자 연결",
          type: "relation",
          locked: true,
          relation: { mode: "direct", targetDatabase: "member" },
        },
        {
          key: "meeting.participants",
          name: "참가자",
          type: "rollup",
          locked: true,
          rollup: {
            relationProperty: "meeting.memberRelation",
            targetProperty: "member.notionPerson",
          },
        },
        {
          key: "meeting.actionItems",
          name: "할 일 목록",
          type: "relation",
          locked: true,
          relation: {
            mode: "synced",
            targetDatabase: "task",
            sourceProperty: "task.meeting",
          },
        },
        {
          key: "meeting.status",
          name: "상태",
          type: "select",
          locked: true,
          options: NOTION_MEETING_STATUS_OPTIONS,
        },
        {
          key: "meeting.sessionId",
          name: "Dirong 세션 ID",
          type: "rich_text",
          locked: true,
        },
        {
          key: "meeting.draftId",
          name: "Dirong 초안 ID",
          type: "rich_text",
          locked: true,
        },
        {
          key: "meeting.contentHash",
          name: "Dirong 내용 해시",
          type: "rich_text",
          locked: true,
        },
        {
          key: "meeting.localStatus",
          name: "Dirong 상태",
          type: "rich_text",
          locked: true,
        },
      ],
    },
    member: {
      name: "작업자",
      properties: [
        {
          key: "member.discordName",
          name: "디스코드 닉네임",
          type: "title",
          locked: true,
        },
        {
          key: "member.notionPerson",
          name: "노션 연결",
          type: "people",
          locked: true,
        },
        {
          key: "member.organization",
          name: "소속",
          type: "select",
          locked: true,
        },
        {
          key: "member.roles",
          name: "담당",
          type: "multi_select",
          locked: true,
        },
      ],
    },
    task: {
      name: "할 일 목록",
      properties: [
        { key: "task.title", name: "작업", type: "title", locked: true },
        {
          key: "task.meeting",
          name: "회의록",
          type: "relation",
          locked: true,
          relation: { mode: "direct", targetDatabase: "meeting" },
        },
        {
          key: "task.workerRelation",
          name: "작업자 연결",
          type: "relation",
          locked: true,
          relation: { mode: "direct", targetDatabase: "member" },
        },
        {
          key: "task.assignee",
          name: "담당자",
          type: "rollup",
          locked: true,
          rollup: {
            relationProperty: "task.workerRelation",
            targetProperty: "member.notionPerson",
          },
        },
        {
          key: "task.role",
          name: "담당",
          type: "rollup",
          locked: true,
          rollup: {
            relationProperty: "task.workerRelation",
            targetProperty: "member.roles",
          },
        },
        { key: "task.dueDate", name: "마감일", type: "date", locked: true },
        {
          key: "task.status",
          name: "상태",
          type: "select",
          locked: true,
          options: NOTION_TASK_STATUS_OPTIONS,
        },
        {
          key: "task.evidence",
          name: "근거",
          type: "rich_text",
          locked: true,
        },
        {
          key: "task.sourceActionId",
          name: "Dirong 할 일 ID",
          type: "rich_text",
          locked: true,
        },
      ],
    },
  },
} as const satisfies NotionSchemaPreset;

export const ENGLISH_NOTION_SCHEMA_PRESET = {
  locale: "en",
  databases: {
    meeting: {
      name: "Meeting Notes",
      properties: [
        {
          key: "meeting.title",
          name: "Meeting Notes",
          type: "title",
          locked: true,
        },
        { key: "meeting.date", name: "Date", type: "date", locked: true },
        {
          key: "meeting.time",
          name: "Meeting Time",
          type: "rich_text",
          locked: true,
        },
        {
          key: "meeting.channel",
          name: "Channel",
          type: "rich_text",
          locked: true,
        },
        {
          key: "meeting.memberRelation",
          name: "Participant Relation",
          type: "relation",
          locked: true,
          relation: { mode: "direct", targetDatabase: "member" },
        },
        {
          key: "meeting.participants",
          name: "Participants",
          type: "rollup",
          locked: true,
          rollup: {
            relationProperty: "meeting.memberRelation",
            targetProperty: "member.notionPerson",
          },
        },
        {
          key: "meeting.actionItems",
          name: "Action Items",
          type: "relation",
          locked: true,
          relation: {
            mode: "synced",
            targetDatabase: "task",
            sourceProperty: "task.meeting",
          },
        },
        {
          key: "meeting.status",
          name: "Status",
          type: "select",
          locked: true,
          options: NOTION_MEETING_STATUS_OPTIONS,
        },
        {
          key: "meeting.sessionId",
          name: "Dirong Session ID",
          type: "rich_text",
          locked: true,
        },
        {
          key: "meeting.draftId",
          name: "Dirong Draft ID",
          type: "rich_text",
          locked: true,
        },
        {
          key: "meeting.contentHash",
          name: "Dirong Content Hash",
          type: "rich_text",
          locked: true,
        },
        {
          key: "meeting.localStatus",
          name: "Dirong Status",
          type: "rich_text",
          locked: true,
        },
      ],
    },
    member: {
      name: "Members",
      properties: [
        {
          key: "member.discordName",
          name: "Discord Name",
          type: "title",
          locked: true,
        },
        {
          key: "member.notionPerson",
          name: "Notion Person",
          type: "people",
          locked: true,
        },
        {
          key: "member.organization",
          name: "Organization",
          type: "select",
          locked: true,
        },
        {
          key: "member.roles",
          name: "Roles",
          type: "multi_select",
          locked: true,
        },
      ],
    },
    task: {
      name: "Action Items",
      properties: [
        { key: "task.title", name: "Task", type: "title", locked: true },
        {
          key: "task.meeting",
          name: "Meeting Notes",
          type: "relation",
          locked: true,
          relation: { mode: "direct", targetDatabase: "meeting" },
        },
        {
          key: "task.workerRelation",
          name: "Member Relation",
          type: "relation",
          locked: true,
          relation: { mode: "direct", targetDatabase: "member" },
        },
        {
          key: "task.assignee",
          name: "Assignee",
          type: "rollup",
          locked: true,
          rollup: {
            relationProperty: "task.workerRelation",
            targetProperty: "member.notionPerson",
          },
        },
        {
          key: "task.role",
          name: "Roles",
          type: "rollup",
          locked: true,
          rollup: {
            relationProperty: "task.workerRelation",
            targetProperty: "member.roles",
          },
        },
        { key: "task.dueDate", name: "Due Date", type: "date", locked: true },
        {
          key: "task.status",
          name: "Status",
          type: "select",
          locked: true,
          options: ENGLISH_NOTION_TASK_STATUS_OPTIONS,
        },
        {
          key: "task.evidence",
          name: "Evidence",
          type: "rich_text",
          locked: true,
        },
        {
          key: "task.sourceActionId",
          name: "Dirong Action ID",
          type: "rich_text",
          locked: true,
        },
      ],
    },
  },
} as const satisfies NotionSchemaPreset;

export const NOTION_SCHEMA_PRESETS = {
  ko: KOREAN_NOTION_SCHEMA_PRESET,
  en: ENGLISH_NOTION_SCHEMA_PRESET,
} as const satisfies Record<NotionLocale, NotionSchemaPreset>;

export function notionSchemaPresetForLocale(
  locale: NotionLocale | null | undefined,
): NotionSchemaPreset {
  return NOTION_SCHEMA_PRESETS[locale ?? "ko"] ?? KOREAN_NOTION_SCHEMA_PRESET;
}

export function validateNotionSchemaPreset(
  preset: NotionSchemaPreset,
): NotionSchemaPresetValidation {
  const errors: NotionSchemaPresetValidationError[] = [];
  const propertyByKey = new Map<
    NotionPropertySemanticKey,
    { databaseRole: NotionDatabaseRole; property: NotionSchemaPresetProperty }
  >();

  for (const databaseRole of NOTION_DATABASE_ROLES) {
    const database = preset.databases[databaseRole];
    if (!database) {
      errors.push({
        code: "missing_database",
        message: `Missing ${databaseRole} database preset.`,
        databaseRole,
      });
      continue;
    }

    const propertyNames = new Map<string, string>();
    for (const property of database.properties) {
      if (propertyByKey.has(property.key)) {
        errors.push({
          code: "duplicate_semantic_key",
          message: `${property.key} is declared more than once.`,
          databaseRole,
          semanticKey: property.key,
        });
      }
      propertyByKey.set(property.key, { databaseRole, property });

      const expectedRole = databaseRoleForSemanticKey(property.key);
      if (expectedRole !== databaseRole) {
        errors.push({
          code: "semantic_key_role_mismatch",
          message: `${property.key} belongs to ${expectedRole}, not ${databaseRole}.`,
          databaseRole,
          semanticKey: property.key,
        });
      }

      const normalizedName = normalizePropertyName(property.name);
      const existingName = propertyNames.get(normalizedName);
      if (existingName !== undefined) {
        errors.push({
          code: "duplicate_property_name",
          message: `${databaseRole} has duplicate property name ${property.name}.`,
          databaseRole,
          semanticKey: property.key,
        });
      }
      propertyNames.set(normalizedName, property.name);

      validateRelationPresence(property, databaseRole, errors);
      validateRollupPresence(property, databaseRole, errors);
    }
  }

  for (const semanticKey of NOTION_PROPERTY_SEMANTIC_KEYS) {
    if (!propertyByKey.has(semanticKey)) {
      errors.push({
        code: "missing_semantic_key",
        message: `Missing semantic key ${semanticKey}.`,
        databaseRole: databaseRoleForSemanticKey(semanticKey),
        semanticKey,
      });
    }
  }

  for (const { databaseRole, property } of propertyByKey.values()) {
    validateRelationTarget(property, databaseRole, propertyByKey, errors);
    validateRollupTarget(property, databaseRole, propertyByKey, errors);
  }

  validateTaskStatusOptions(propertyByKey, errors, preset.locale);

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

export function databaseRoleForSemanticKey(
  key: NotionPropertySemanticKey,
): NotionDatabaseRole {
  if (key.startsWith("meeting.")) {
    return "meeting";
  }
  if (key.startsWith("member.")) {
    return "member";
  }
  return "task";
}

function validateRelationPresence(
  property: NotionSchemaPresetProperty,
  databaseRole: NotionDatabaseRole,
  errors: NotionSchemaPresetValidationError[],
): void {
  if (property.type === "relation" && !property.relation) {
    errors.push({
      code: "missing_relation_target",
      message: `${property.key} is a relation without a target.`,
      databaseRole,
      semanticKey: property.key,
    });
  }
  if (property.type !== "relation" && property.relation) {
    errors.push({
      code: "unexpected_relation_target",
      message: `${property.key} is not a relation but has a relation target.`,
      databaseRole,
      semanticKey: property.key,
    });
  }
}

function validateRollupPresence(
  property: NotionSchemaPresetProperty,
  databaseRole: NotionDatabaseRole,
  errors: NotionSchemaPresetValidationError[],
): void {
  if (property.type === "rollup" && !property.rollup) {
    errors.push({
      code: "missing_rollup_target",
      message: `${property.key} is a rollup without a target.`,
      databaseRole,
      semanticKey: property.key,
    });
  }
  if (property.type !== "rollup" && property.rollup) {
    errors.push({
      code: "unexpected_rollup_target",
      message: `${property.key} is not a rollup but has a rollup target.`,
      databaseRole,
      semanticKey: property.key,
    });
  }
}

function validateRelationTarget(
  property: NotionSchemaPresetProperty,
  databaseRole: NotionDatabaseRole,
  propertyByKey: ReadonlyMap<
    NotionPropertySemanticKey,
    { databaseRole: NotionDatabaseRole; property: NotionSchemaPresetProperty }
  >,
  errors: NotionSchemaPresetValidationError[],
): void {
  if (!property.relation) {
    return;
  }

  if (!NOTION_DATABASE_ROLES.includes(property.relation.targetDatabase)) {
    errors.push({
      code: "invalid_relation_database",
      message: `${property.key} points to unknown DB role ${property.relation.targetDatabase}.`,
      databaseRole,
      semanticKey: property.key,
    });
    return;
  }

  if (property.relation.mode !== "synced") {
    return;
  }

  const source = propertyByKey.get(property.relation.sourceProperty);
  if (
    !source ||
    source.databaseRole !== property.relation.targetDatabase ||
    !source.property.relation ||
    source.property.relation.targetDatabase !== databaseRole
  ) {
    errors.push({
      code: "invalid_synced_relation",
      message: `${property.key} must sync from a relation on ${property.relation.targetDatabase} back to ${databaseRole}.`,
      databaseRole,
      semanticKey: property.key,
    });
  }
}

function validateRollupTarget(
  property: NotionSchemaPresetProperty,
  databaseRole: NotionDatabaseRole,
  propertyByKey: ReadonlyMap<
    NotionPropertySemanticKey,
    { databaseRole: NotionDatabaseRole; property: NotionSchemaPresetProperty }
  >,
  errors: NotionSchemaPresetValidationError[],
): void {
  if (!property.rollup) {
    return;
  }

  const relation = propertyByKey.get(property.rollup.relationProperty);
  const target = propertyByKey.get(property.rollup.targetProperty);
  if (
    !relation ||
    !target ||
    relation.databaseRole !== databaseRole ||
    relation.property.type !== "relation" ||
    !relation.property.relation ||
    target.databaseRole !== relation.property.relation.targetDatabase
  ) {
    errors.push({
      code: "invalid_rollup_target",
      message: `${property.key} has an invalid rollup target.`,
      databaseRole,
      semanticKey: property.key,
    });
  }
}

function validateTaskStatusOptions(
  propertyByKey: ReadonlyMap<
    NotionPropertySemanticKey,
    { databaseRole: NotionDatabaseRole; property: NotionSchemaPresetProperty }
  >,
  errors: NotionSchemaPresetValidationError[],
  locale: NotionLocale,
): void {
  const status = propertyByKey.get("task.status")?.property;
  const expected = NOTION_TASK_STATUS_OPTIONS_BY_LOCALE[locale];
  if (!status || !sameStringList(status.options ?? [], expected)) {
    errors.push({
      code: "invalid_task_status_options",
      message: `task.status options must be ${expected.join(", ")}.`,
      databaseRole: "task",
      semanticKey: "task.status",
    });
  }
}

function sameStringList(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizePropertyName(value: string): string {
  return value.trim().toLocaleLowerCase("ko-KR");
}
