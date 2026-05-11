import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const DASHBOARD_TOKEN_HEADER = "x-dirong-dashboard-token";

const AUDIO_TOKEN_TTL_MS = 5 * 60 * 1000;
const SAFE_FETCH_SITES = new Set(["same-origin", "none"]);

export type DashboardMutationSecurityResult =
  | { ok: true }
  | { ok: false; statusCode: 403 | 415; message: string };

export type DashboardAudioKind = "raw" | "stt";

export function createDashboardToken(): string {
  return randomBytes(32).toString("base64url");
}

export function requireJsonMutationRequest(input: {
  request: IncomingMessage;
  expectedOrigin: string;
  dashboardToken: string;
}): DashboardMutationSecurityResult {
  const contentType = mediaType(input.request.headers["content-type"]);
  if (contentType !== "application/json") {
    return {
      ok: false,
      statusCode: 415,
      message: "Unsupported Media Type",
    };
  }

  const expected = new URL(input.expectedOrigin);
  const host = firstHeaderValue(input.request.headers.host);
  if (host !== expected.host) {
    return {
      ok: false,
      statusCode: 403,
      message: "Forbidden",
    };
  }

  const origin = firstHeaderValue(input.request.headers.origin);
  if (origin && origin !== expected.origin) {
    return {
      ok: false,
      statusCode: 403,
      message: "Forbidden",
    };
  }

  const secFetchSite = firstHeaderValue(input.request.headers["sec-fetch-site"]);
  if (secFetchSite && !SAFE_FETCH_SITES.has(secFetchSite.toLowerCase())) {
    return {
      ok: false,
      statusCode: 403,
      message: "Forbidden",
    };
  }

  const token = firstHeaderValue(input.request.headers[DASHBOARD_TOKEN_HEADER]);
  if (!constantTimeEqual(token, input.dashboardToken)) {
    return {
      ok: false,
      statusCode: 403,
      message: "Forbidden",
    };
  }

  return { ok: true };
}

export function buildDashboardHtml(
  html: string,
  dashboardToken: string,
): string {
  const script = `<script>window.__DIRONG_DASHBOARD_TOKEN__=${JSON.stringify(
    dashboardToken,
  )};</script>`;
  return html.includes("</head>")
    ? html.replace("</head>", `${script}\n</head>`)
    : `${script}\n${html}`;
}

export function createSignedAudioPath(input: {
  chunkId: string;
  kind: DashboardAudioKind;
  secret: string;
  nowMs?: number;
}): string {
  const expiresAtMs = Math.floor(
    (input.nowMs ?? Date.now()) + AUDIO_TOKEN_TTL_MS,
  );
  const token = signAudioToken({
    chunkId: input.chunkId,
    kind: input.kind,
    expiresAtMs,
    secret: input.secret,
  });
  // Keep the server-visible query name as "token" without tripping JSON redaction.
  return `/audio/${encodeURIComponent(input.chunkId)}/${input.kind}?tok%65n=${encodeURIComponent(
    token,
  )}`;
}

export function verifySignedAudioToken(input: {
  chunkId: string;
  kind: DashboardAudioKind;
  secret: string;
  token: string | null;
  nowMs?: number;
}): boolean {
  if (!input.token) {
    return false;
  }

  const [expiresRaw, signature] = input.token.split(".");
  if (!expiresRaw || !signature) {
    return false;
  }

  const expiresAtMs = Number(expiresRaw);
  if (
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs < (input.nowMs ?? Date.now())
  ) {
    return false;
  }

  const expected = signAudioToken({
    chunkId: input.chunkId,
    kind: input.kind,
    expiresAtMs,
    secret: input.secret,
  });
  return constantTimeEqual(input.token, expected);
}

function signAudioToken(input: {
  chunkId: string;
  kind: DashboardAudioKind;
  expiresAtMs: number;
  secret: string;
}): string {
  const payload = `${input.chunkId}\n${input.kind}\n${input.expiresAtMs}`;
  const signature = createHmac("sha256", input.secret)
    .update(payload)
    .digest("base64url");
  return `${input.expiresAtMs}.${signature}`;
}

function mediaType(value: string | string[] | undefined): string {
  const raw = firstHeaderValue(value);
  return raw.split(";")[0]?.trim().toLowerCase() ?? "";
}

function firstHeaderValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function constantTimeEqual(
  actual: string | null | undefined,
  expected: string,
): boolean {
  if (!actual) {
    return false;
  }
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
