import {
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendText } from "./http.js";
import type { DashboardAudioKind } from "./security.js";
import type { DashboardStore } from "./storage-port.js";

export const DASHBOARD_INDEX_HTML = readFileSync(
  new URL("./public/index.html", import.meta.url),
  "utf8",
);

const DASHBOARD_PUBLIC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "public",
);

const DASHBOARD_ASSET_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../assets",
);

export function serveDashboardPublicAsset(
  response: ServerResponse,
  pathname: string,
): void {
  serveStaticFile({
    response,
    root: DASHBOARD_PUBLIC_ROOT,
    relativePath: pathname.replace(/^\/dashboard\//, ""),
    notFoundMessage: "Asset Not Found",
    cacheControl: "no-store",
  });
}

export function serveProjectAsset(
  response: ServerResponse,
  pathname: string,
): void {
  serveStaticFile({
    response,
    root: DASHBOARD_ASSET_ROOT,
    relativePath: pathname.replace(/^\/assets\//, ""),
    notFoundMessage: "Asset Not Found",
    cacheControl: "public, max-age=3600",
  });
}

export function serveAudio(
  input: {
    request: IncomingMessage;
    response: ServerResponse;
    store: DashboardStore;
    chunkId: string;
    kind: DashboardAudioKind;
  },
): void {
  const audio = input.store.getAudioPathForChunk(input.chunkId, input.kind);
  if (!audio || !existsSync(audio.path)) {
    sendText(input.response, 404, "Audio Not Found");
    return;
  }

  const fileStat = statSync(audio.path);
  const range = input.request.headers.range;
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
      input.response.writeHead(416, {
        ...baseHeaders,
        "Content-Range": `bytes */${fileStat.size}`,
      });
      input.response.end();
      return;
    }

    input.response.writeHead(206, {
      ...baseHeaders,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
    });
    createReadStream(audio.path, { start, end }).pipe(input.response);
    return;
  }

  input.response.writeHead(200, {
    ...baseHeaders,
    "Content-Length": fileStat.size,
  });
  createReadStream(audio.path).pipe(input.response);
}

function serveStaticFile(input: {
  response: ServerResponse;
  root: string;
  relativePath: string;
  notFoundMessage: string;
  cacheControl: string;
}): void {
  const relativePath = decodeURIComponent(input.relativePath);
  if (!relativePath || relativePath.includes("\0")) {
    sendText(input.response, 404, input.notFoundMessage);
    return;
  }

  const targetPath = path.resolve(input.root, relativePath);
  const rootPrefix = `${input.root}${path.sep}`;
  if (targetPath !== input.root && !targetPath.startsWith(rootPrefix)) {
    sendText(input.response, 404, input.notFoundMessage);
    return;
  }
  if (!existsSync(targetPath) || statSync(targetPath).isDirectory()) {
    sendText(input.response, 404, input.notFoundMessage);
    return;
  }

  input.response.writeHead(200, {
    "Content-Type": contentTypeForAsset(targetPath),
    "Cache-Control": input.cacheControl,
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(targetPath).pipe(input.response);
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

function contentTypeForAsset(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".js") {
    return "text/javascript; charset=utf-8";
  }
  if (ext === ".css") {
    return "text/css; charset=utf-8";
  }
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  if (ext === ".svg") {
    return "image/svg+xml";
  }
  return "application/octet-stream";
}
