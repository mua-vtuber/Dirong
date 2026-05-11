import { renderNotionBlocks } from "./blocks.js";
import type { RenderedNotionBlock } from "./blocks.js";
import { computeNotionContentHash } from "./content-hash.js";
import type { NotionDraftInput } from "./draft-input.js";
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
  const propertyValues = buildNotionPagePropertyValues({
    draftInput: input.draftInput,
  });
  const hashBlocks = renderNotionBlocks(input.draftInput);
  const contentHash = computeNotionContentHash({
    draftId: input.draftInput.draft.id,
    draftOutputHash: input.draftInput.draft.output_hash,
    sessionId: input.draftInput.session.id,
    targetDataSourceId: input.targetId,
    propertyValues: propertyValues.values,
    renderedBlocks: hashBlocks.map((block) => block.block),
  });
  const blocks = renderNotionBlocks(input.draftInput, { contentHash });
  const properties =
    input.target.kind === "managed"
      ? renderNotionPagePropertiesFromSemanticMappings({
          draftInput: input.draftInput,
          propertiesBySemanticKey: input.target.meetingProperties,
          contentHash,
          status: "draft",
          localStatus: "Notion upload in progress",
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
          localStatus: "Notion upload in progress",
        }).properties;
  const doneProperties =
    input.target.kind === "managed"
      ? renderNotionPagePropertiesFromSemanticMappings({
          draftInput: input.draftInput,
          propertiesBySemanticKey: input.target.meetingProperties,
          contentHash,
          status: "done",
          localStatus: "Notion upload complete",
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
          localStatus: "Notion upload complete",
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
