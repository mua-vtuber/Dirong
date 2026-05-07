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

export type DashboardRuntimeSources = {
  aiReadiness?: DashboardAiReadinessSource;
  aiCleanupAutomation?: DashboardAiCleanupAutomationSource;
  aloneFinalize?: DashboardAloneFinalizeSource;
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
