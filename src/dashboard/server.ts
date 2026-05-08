import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import type { AiCleanupAutomationSnapshot } from "../ai/cleanup/automation-service.js";
import type { AiProviderRuntimeReadinessSnapshot } from "../ai/cleanup/provider-lifecycle.js";
import type { Phase1Config } from "../config.js";
import type { AloneFinalizeSnapshot } from "../recording/alone-finalize-service.js";
import type { RecordingProducer } from "../recording/recording-producer.js";
import type { SessionStore } from "../storage/session-store.js";
import type { SttAutomationSnapshot } from "../stt/automation-service.js";
import type {
  NotionDashboardActionResult,
  NotionDashboardCustomPropertyActionResult,
  NotionDashboardSchemaActionResult,
  NotionDashboardSnapshot,
} from "../notion/dashboard-service.js";
import type { NotionCustomPropertyRuleInput } from "../notion/property-rules.js";
import type { NotionSchemaApplyOptions } from "../notion/schema-manager.js";
import type { NotionAutomationSnapshot } from "../notion/automation-service.js";

export type DashboardAiReadinessSource = {
  getSnapshot(): AiProviderRuntimeReadinessSnapshot;
};

export type DashboardAiCleanupAutomationSource = {
  getSnapshot(): AiCleanupAutomationSnapshot;
};

export type DashboardAloneFinalizeSource = {
  getSnapshot(): AloneFinalizeSnapshot;
};

export type DashboardSttAutomationSource = {
  getSnapshot(): SttAutomationSnapshot;
};

export type DashboardNotionSource = {
  getSnapshot(): NotionDashboardSnapshot;
  runManualUpload(input: {
    sessionId: string | null;
    draftId: string | null;
    force: boolean;
  }): Promise<NotionDashboardActionResult>;
  syncCustomProperties(): Promise<NotionDashboardCustomPropertyActionResult>;
  saveCustomPropertyRules(
    rules: readonly NotionCustomPropertyRuleInput[],
  ): NotionDashboardCustomPropertyActionResult;
  inspectSchema(): Promise<NotionDashboardSchemaActionResult>;
  applySchema(input: NotionSchemaApplyOptions): Promise<NotionDashboardSchemaActionResult>;
};

export type DashboardNotionAutomationSource = {
  getSnapshot(): NotionAutomationSnapshot;
};

export type DashboardRuntimeSources = {
  aiReadiness?: DashboardAiReadinessSource;
  aiCleanupAutomation?: DashboardAiCleanupAutomationSource;
  aloneFinalize?: DashboardAloneFinalizeSource;
  notion?: DashboardNotionSource;
  notionAutomation?: DashboardNotionAutomationSource;
  sttAutomation?: DashboardSttAutomationSource;
};

export class DashboardServer {
  private server: Server | null = null;
  private url: string | null = null;

  constructor(
    private readonly config: Phase1Config,
    private readonly store: SessionStore,
    private readonly producer: RecordingProducer,
    private readonly runtimeSources: DashboardRuntimeSources = {},
  ) {}

  async start(): Promise<string> {
    if (this.server && this.url) {
      return this.url;
    }

    this.server = createServer((request, response) => {
      void this.route(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.server?.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        this.server?.off("error", onError);
        resolve();
      };
      this.server?.once("error", onError);
      this.server?.once("listening", onListening);
      this.server?.listen(this.config.dashboardPort, this.config.dashboardHost);
    });

    this.url = `http://${this.config.dashboardHost}:${this.config.dashboardPort}/`;
    return this.url;
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    this.server = null;
    this.url = null;
  }

  getUrl(): string {
    return this.url ?? `http://${this.config.dashboardHost}:${this.config.dashboardPort}/`;
  }

  private async route(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", this.getUrl());

    if (request.method === "POST" && url.pathname === "/api/notion/send") {
      await this.handleNotionAction(request, response, false);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/notion/retry") {
      await this.handleNotionAction(request, response, true);
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/notion/properties/sync"
    ) {
      await this.handleNotionPropertiesSync(response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/notion/properties") {
      await this.handleNotionPropertiesSave(request, response);
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/notion/schema/inspect"
    ) {
      await this.handleNotionSchemaInspect(response);
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/notion/schema/apply"
    ) {
      await this.handleNotionSchemaApply(request, response);
      return;
    }

    if (request.method !== "GET") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }

    if (url.pathname === "/") {
      sendHtml(response, DASHBOARD_INDEX_HTML);
      return;
    }

    if (url.pathname === "/api/state") {
      const state = this.store.getDashboardState(this.producer.getRuntimeState());
      sendJson(response, appendDashboardRuntimeSnapshots(state, this.runtimeSources));
      return;
    }

    const audioMatch = /^\/audio\/([^/]+)\/(raw|stt)$/.exec(url.pathname);
    if (audioMatch) {
      const chunkId = decodeURIComponent(audioMatch[1] ?? "");
      const kind = (audioMatch[2] ?? "raw") as "raw" | "stt";
      this.serveAudio(request, response, chunkId, kind);
      return;
    }

    sendText(response, 404, "Not Found");
  }

  private serveAudio(
    request: IncomingMessage,
    response: ServerResponse,
    chunkId: string,
    kind: "raw" | "stt",
  ): void {
    const audio = this.store.getAudioPathForChunk(chunkId, kind);
    if (!audio || !existsSync(audio.path)) {
      sendText(response, 404, "Audio Not Found");
      return;
    }

    const fileStat = statSync(audio.path);
    const range = request.headers.range;
    const contentType = contentTypeForAudio(audio.format, audio.path);
    const baseHeaders = {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
    };

    if (range) {
      const parsed = /^bytes=(\d*)-(\d*)$/.exec(range);
      const start = parsed?.[1] ? Number(parsed[1]) : 0;
      const end = parsed?.[2] ? Number(parsed[2]) : fileStat.size - 1;

      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end >= fileStat.size ||
        start > end
      ) {
        response.writeHead(416, {
          ...baseHeaders,
          "Content-Range": `bytes */${fileStat.size}`,
        });
        response.end();
        return;
      }

      response.writeHead(206, {
        ...baseHeaders,
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
      });
      createReadStream(audio.path, { start, end }).pipe(response);
      return;
    }

    response.writeHead(200, {
      ...baseHeaders,
      "Content-Length": fileStat.size,
    });
    createReadStream(audio.path).pipe(response);
  }

  private async handleNotionAction(
    request: IncomingMessage,
    response: ServerResponse,
    force: boolean,
  ): Promise<void> {
    if (!this.runtimeSources.notion) {
      sendJson(response, {
        ok: false,
        status: "not_configured",
        message: "Notion dashboard action source is not configured.",
        userAction: "Notion 설정을 확인해 주세요.",
        pageUrl: null,
      });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const result = await this.runtimeSources.notion.runManualUpload({
        sessionId: readOptionalBodyString(body, "sessionId"),
        draftId: readOptionalBodyString(body, "draftId"),
        force,
      });
      sendJson(response, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(`${JSON.stringify({
        ok: false,
        status: "failed",
        message,
        userAction: "요청을 다시 시도해 주세요.",
        pageUrl: null,
      })}\n`);
    }
  }

  private async handleNotionPropertiesSync(
    response: ServerResponse,
  ): Promise<void> {
    if (!this.runtimeSources.notion) {
      sendJson(response, {
        ok: false,
        status: "not_configured",
        message: "Notion dashboard action source is not configured.",
        userAction: "Notion 설정을 확인해 주세요.",
        warnings: [],
        customProperties: null,
      });
      return;
    }

    const result = await this.runtimeSources.notion.syncCustomProperties();
    sendJson(response, result);
  }

  private async handleNotionPropertiesSave(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!this.runtimeSources.notion) {
      sendJson(response, {
        ok: false,
        status: "not_configured",
        message: "Notion dashboard action source is not configured.",
        userAction: "Notion 설정을 확인해 주세요.",
        warnings: [],
        customProperties: null,
      });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const result = this.runtimeSources.notion.saveCustomPropertyRules(
        readCustomPropertyRuleInputs(body),
      );
      sendJson(response, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(`${JSON.stringify({
        ok: false,
        status: "failed",
        message,
        userAction: "요청을 다시 시도해 주세요.",
        warnings: [],
        customProperties: null,
      })}\n`);
    }
  }

  private async handleNotionSchemaInspect(
    response: ServerResponse,
  ): Promise<void> {
    if (!this.runtimeSources.notion) {
      sendJson(response, {
        ok: false,
        status: "not_configured",
        message: "Notion dashboard action source is not configured.",
        userAction: "Notion 설정을 확인해 주세요.",
        warnings: [],
        diff: null,
        operations: null,
      });
      return;
    }

    const result = await this.runtimeSources.notion.inspectSchema();
    sendJson(response, result);
  }

  private async handleNotionSchemaApply(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!this.runtimeSources.notion) {
      sendJson(response, {
        ok: false,
        status: "not_configured",
        message: "Notion dashboard action source is not configured.",
        userAction: "Notion 설정을 확인해 주세요.",
        warnings: [],
        diff: null,
        operations: null,
      });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const result = await this.runtimeSources.notion.applySchema(
        readNotionSchemaApplyOptions(body),
      );
      sendJson(response, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(`${JSON.stringify({
        ok: false,
        status: "failed",
        message,
        userAction: "요청을 다시 시도해 주세요.",
        warnings: [],
        diff: null,
        operations: null,
      })}\n`);
    }
  }
}

export function appendAiReadinessToDashboardState(
  state: unknown,
  aiReadinessSource?: DashboardAiReadinessSource,
): unknown {
  return appendDashboardRuntimeSnapshots(state, {
    aiReadiness: aiReadinessSource,
  });
}

export function appendDashboardRuntimeSnapshots(
  state: unknown,
  sources: DashboardRuntimeSources = {},
): unknown {
  if (!isRecord(state)) {
    return state;
  }
  if (
    !sources.aiReadiness &&
    !sources.aiCleanupAutomation &&
    !sources.aloneFinalize &&
    !sources.notion &&
    !sources.notionAutomation &&
    !sources.sttAutomation
  ) {
    return state;
  }

  return {
    ...state,
    ...(sources.aiReadiness
      ? { aiReadiness: sources.aiReadiness.getSnapshot() }
      : {}),
    ...(sources.aiCleanupAutomation
      ? { aiCleanupAutomation: sources.aiCleanupAutomation.getSnapshot() }
      : {}),
    ...(sources.aloneFinalize
      ? { aloneFinalize: sources.aloneFinalize.getSnapshot() }
      : {}),
    ...(sources.notion
      ? { notion: sources.notion.getSnapshot() }
      : {}),
    ...(sources.notionAutomation
      ? { notionAutomation: sources.notionAutomation.getSnapshot() }
      : {}),
    ...(sources.sttAutomation
      ? { sttAutomation: sources.sttAutomation.getSnapshot() }
      : {}),
  };
}

const DASHBOARD_INDEX_HTML = readFileSync(new URL("./public/index.html", import.meta.url), "utf8");

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(html);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 65536) {
      throw new Error("Dashboard request body is too large.");
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }
  return JSON.parse(text);
}

function readOptionalBodyString(body: unknown, key: string): string | null {
  if (!isRecord(body)) {
    return null;
  }
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readCustomPropertyRuleInputs(
  body: unknown,
): NotionCustomPropertyRuleInput[] {
  if (!isRecord(body) || !Array.isArray(body.rules)) {
    return [];
  }

  const rules: NotionCustomPropertyRuleInput[] = [];
  for (const entry of body.rules) {
    if (!isRecord(entry) || typeof entry.propertyName !== "string") {
      continue;
    }
    rules.push({
      originalPropertyName:
        typeof entry.originalPropertyName === "string"
          ? entry.originalPropertyName
          : null,
      propertyName: entry.propertyName,
      propertyType:
        typeof entry.propertyType === "string" ? entry.propertyType : null,
      enabled: entry.enabled === true,
      promptDescription:
        typeof entry.promptDescription === "string"
          ? entry.promptDescription
          : "",
      maxLength:
        typeof entry.maxLength === "number" && Number.isFinite(entry.maxLength)
          ? entry.maxLength
          : null,
      relationTargetUrl:
        typeof entry.relationTargetUrl === "string"
          ? entry.relationTargetUrl
          : null,
      relationDataSourceId:
        typeof entry.relationDataSourceId === "string"
          ? entry.relationDataSourceId
          : null,
      relationMatchPropertyName:
        typeof entry.relationMatchPropertyName === "string"
          ? entry.relationMatchPropertyName
          : null,
      relationAutoCreate: entry.relationAutoCreate === true,
      deleted: entry.deleted === true,
    });
  }
  return rules;
}

function readNotionSchemaApplyOptions(body: unknown): NotionSchemaApplyOptions {
  const record = isRecord(body) ? body : {};
  return {
    createMissing: record.createMissing !== false,
    updateTypes: record.updateTypes === true,
    deleteExtra: record.deleteExtra === true,
    confirmDeleteExtra: record.confirmDeleteExtra === true,
  };
}

function sendText(response: ServerResponse, statusCode: number, text: string): void {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(text);
}

function contentTypeForAudio(format: string, filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (format.includes("wav") || ext === ".wav") {
    return "audio/wav";
  }
  if (format.includes("webm") || ext === ".webm") {
    return "audio/webm";
  }
  return "audio/ogg";
}
