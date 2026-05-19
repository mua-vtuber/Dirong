import { renderNotionBlocks } from "./blocks.js";
import type { RenderedNotionBlock } from "./blocks.js";
import { computeNotionContentHash } from "./content-hash.js";
import type { NotionDraftInput } from "./draft-input.js";
import {
  DEFAULT_DIRONG_LOCALE,
  isDirongLocale,
  type DirongLocale,
} from "../settings/local-settings-store.js";
import { t } from "../i18n/catalog.js";
import {
  buildNotionPagePropertyValues,
  renderNotionPageProperties,
  renderNotionPagePropertiesFromSemanticMappings,
  type NotionParticipantsPropertyType,
  type NotionStatusPropertyType,
} from "./page-properties.js";
import type { ResolvedTarget } from "./upload-target-resolver.js";

export type NotionUploadPlan = {
  contentHash: string;
  blocks: RenderedNotionBlock[];
  properties: Record<string, unknown>;
  doneProperties: Record<string, unknown>;
  warnings: string[];
};

export function renderUploadPlan(input: {
  draftInput: NotionDraftInput;
  targetId: string;
  target: ResolvedTarget;
  memberRelationPageIds: readonly string[];
  extraWarnings: readonly string[];
}): NotionUploadPlan {
  const locale = resolveDraftLocale(input.draftInput);
  const localStatus = notionUploadLocalStatusText(locale);
  const propertyValues = buildNotionPagePropertyValues({
    draftInput: input.draftInput,
    locale,
  });
  const hashBlocks = renderNotionBlocks(input.draftInput, { locale });
  const contentHash = computeNotionContentHash({
    draftId: input.draftInput.draft.id,
    draftOutputHash: input.draftInput.draft.output_hash,
    sessionId: input.draftInput.session.id,
    targetDataSourceId: input.targetId,
    propertyValues: propertyValues.values,
    renderedBlocks: hashBlocks.map((block) => block.block),
  });
  const blocks = renderNotionBlocks(input.draftInput, { contentHash, locale });
  const properties =
    input.target.kind === "managed"
      ? renderNotionPagePropertiesFromSemanticMappings({
          draftInput: input.draftInput,
          propertiesBySemanticKey: input.target.meetingProperties,
          contentHash,
          status: "draft",
          localStatus: localStatus.inProgress,
          locale,
          memberRelationPageIds: input.memberRelationPageIds,
        }).properties
      : renderNotionPageProperties({
          draftInput: input.draftInput,
          propertyNames: input.target.propertyNames,
          contentHash,
          status: "draft",
          statusPropertyType: readStatusPropertyType(
            input.target.propertyIds.status.type,
          ),
          participantsPropertyType: readParticipantsPropertyType(
            input.target.propertyIds.participants.type,
          ),
          localStatus: localStatus.inProgress,
          locale,
        }).properties;
  const doneProperties =
    input.target.kind === "managed"
      ? renderNotionPagePropertiesFromSemanticMappings({
          draftInput: input.draftInput,
          propertiesBySemanticKey: input.target.meetingProperties,
          contentHash,
          status: "done",
          localStatus: localStatus.complete,
          locale,
          memberRelationPageIds: input.memberRelationPageIds,
        }).properties
      : renderNotionPageProperties({
          draftInput: input.draftInput,
          propertyNames: input.target.propertyNames,
          contentHash,
          status: "done",
          statusPropertyType: readStatusPropertyType(
            input.target.propertyIds.status.type,
          ),
          participantsPropertyType: readParticipantsPropertyType(
            input.target.propertyIds.participants.type,
          ),
          localStatus: localStatus.complete,
          locale,
        }).properties;

  return {
    contentHash,
    blocks,
    warnings: [...propertyValues.warnings, ...input.extraWarnings],
    properties,
    doneProperties,
  };
}

function readStatusPropertyType(type: string): NotionStatusPropertyType {
  return type === "status" ? "status" : "select";
}

function readParticipantsPropertyType(type: string): NotionParticipantsPropertyType {
  return type === "rollup" ? "rollup" : "multi_select";
}

function resolveDraftLocale(input: NotionDraftInput): DirongLocale {
  return isDirongLocale(input.draftContent.language)
    ? input.draftContent.language
    : DEFAULT_DIRONG_LOCALE;
}

function notionUploadLocalStatusText(locale: DirongLocale): {
  inProgress: string;
  complete: string;
} {
  return {
    inProgress: t(locale, "notionPageProperties.uploadInProgress"),
    complete: t(locale, "notionPageProperties.uploadComplete"),
  };
}
