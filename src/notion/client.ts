import { redactSensitiveText } from "../errors.js";
import { DEFAULT_NOTION_REQUEST_TIMEOUT_MS } from "./settings.js";

export type JsonObject = Record<string, unknown>;

export type NotionDatabaseResponse = JsonObject;
export type NotionDataSourceResponse = JsonObject;
export type NotionCreateDatabaseBody = JsonObject;
export type NotionCreateDataSourceBody = JsonObject;
export type NotionUpdateDataSourceBody = JsonObject;
export type NotionQueryBody = JsonObject;
export type NotionQueryResponse = JsonObject;
export type NotionCreatePageBody = JsonObject;
export type NotionUpdatePageBody = JsonObject;
export type NotionPageResponse = JsonObject;
export type NotionAppendChildrenBody = JsonObject;
export type NotionAppendChildrenResponse = JsonObject;
export type NotionBlockChildrenResponse = JsonObject;
export type NotionRequestOptions = {
  signal?: AbortSignal;
};

export type NotionClient = {
  retrievePage(
    pageId: string,
    options?: NotionRequestOptions,
  ): Promise<NotionPageResponse>;
  retrieveDatabase(
    databaseId: string,
    options?: NotionRequestOptions,
  ): Promise<NotionDatabaseResponse>;
  createDatabase(
    body: NotionCreateDatabaseBody,
    options?: NotionRequestOptions,
  ): Promise<NotionDatabaseResponse>;
  createDataSource(
    body: NotionCreateDataSourceBody,
    options?: NotionRequestOptions,
  ): Promise<NotionDataSourceResponse>;
  retrieveDataSource(
    dataSourceId: string,
    options?: NotionRequestOptions,
  ): Promise<NotionDataSourceResponse>;
  updateDataSource(
    dataSourceId: string,
    body: NotionUpdateDataSourceBody,
    options?: NotionRequestOptions,
  ): Promise<NotionDataSourceResponse>;
  queryDataSource(
    dataSourceId: string,
    body: NotionQueryBody,
    options?: NotionRequestOptions,
  ): Promise<NotionQueryResponse>;
  createPage(
    body: NotionCreatePageBody,
    options?: NotionRequestOptions,
  ): Promise<NotionPageResponse>;
  updatePage(
    pageId: string,
    body: NotionUpdatePageBody,
    options?: NotionRequestOptions,
  ): Promise<NotionPageResponse>;
  appendBlockChildren(
    blockId: string,
    body: NotionAppendChildrenBody,
    options?: NotionRequestOptions,
  ): Promise<NotionAppendChildrenResponse>;
  retrieveBlockChildren(
    blockId: string,
    cursor?: string | null,
    options?: NotionRequestOptions,
  ): Promise<NotionBlockChildrenResponse>;
};

export type NotionClientOptions = {
  apiKey: string;
  apiVersion: string;
  baseUrl: string;
  requestTimeoutMs?: number;
  fetchFn?: typeof fetch;
};

export type NotionApiErrorKind =
  | "auth"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "validation"
  | "server"
  | "network"
  | "timeout"
  | "invalid_json"
  | "unknown";

export class NotionApiError extends Error {
  constructor(
    public readonly kind: NotionApiErrorKind,
    message: string,
    public readonly details: {
      status: number | null;
      code: string | null;
      retryAfterSeconds: number | null;
      retriable: boolean;
      userAction: string;
      technicalDetail: string;
    },
  ) {
    super(message);
    this.name = "NotionApiError";
  }

  get status(): number | null {
    return this.details.status;
  }

  get code(): string | null {
    return this.details.code;
  }

  get retryAfterSeconds(): number | null {
    return this.details.retryAfterSeconds;
  }

  get retriable(): boolean {
    return this.details.retriable;
  }

  get userAction(): string {
    return this.details.userAction;
  }

  get technicalDetail(): string {
    return this.details.technicalDetail;
  }
}

export function createNotionClient(options: NotionClientOptions): NotionClient {
  return new FetchNotionClient(options);
}

class FetchNotionClient implements NotionClient {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: NotionClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_NOTION_REQUEST_TIMEOUT_MS;
    if (!Number.isInteger(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
      throw new Error("Notion client requestTimeoutMs must be a positive integer.");
    }
  }

  retrievePage(
    pageId: string,
    options?: NotionRequestOptions,
  ): Promise<NotionPageResponse> {
    return this.request(
      "GET",
      `/v1/pages/${encodeURIComponent(pageId)}`,
      undefined,
      options,
    );
  }

  retrieveDatabase(
    databaseId: string,
    options?: NotionRequestOptions,
  ): Promise<NotionDatabaseResponse> {
    return this.request(
      "GET",
      `/v1/databases/${encodeURIComponent(databaseId)}`,
      undefined,
      options,
    );
  }

  createDatabase(
    body: NotionCreateDatabaseBody,
    options?: NotionRequestOptions,
  ): Promise<NotionDatabaseResponse> {
    return this.request("POST", "/v1/databases", body, options);
  }

  createDataSource(
    body: NotionCreateDataSourceBody,
    options?: NotionRequestOptions,
  ): Promise<NotionDataSourceResponse> {
    return this.request("POST", "/v1/data_sources", body, options);
  }

  retrieveDataSource(
    dataSourceId: string,
    options?: NotionRequestOptions,
  ): Promise<NotionDataSourceResponse> {
    return this.request(
      "GET",
      `/v1/data_sources/${encodeURIComponent(dataSourceId)}`,
      undefined,
      options,
    );
  }

  updateDataSource(
    dataSourceId: string,
    body: NotionUpdateDataSourceBody,
    options?: NotionRequestOptions,
  ): Promise<NotionDataSourceResponse> {
    return this.request(
      "PATCH",
      `/v1/data_sources/${encodeURIComponent(dataSourceId)}`,
      body,
      options,
    );
  }

  queryDataSource(
    dataSourceId: string,
    body: NotionQueryBody,
    options?: NotionRequestOptions,
  ): Promise<NotionQueryResponse> {
    return this.request(
      "POST",
      `/v1/data_sources/${encodeURIComponent(dataSourceId)}/query`,
      body,
      options,
    );
  }

  createPage(
    body: NotionCreatePageBody,
    options?: NotionRequestOptions,
  ): Promise<NotionPageResponse> {
    return this.request("POST", "/v1/pages", body, options);
  }

  updatePage(
    pageId: string,
    body: NotionUpdatePageBody,
    options?: NotionRequestOptions,
  ): Promise<NotionPageResponse> {
    return this.request(
      "PATCH",
      `/v1/pages/${encodeURIComponent(pageId)}`,
      body,
      options,
    );
  }

  appendBlockChildren(
    blockId: string,
    body: NotionAppendChildrenBody,
    options?: NotionRequestOptions,
  ): Promise<NotionAppendChildrenResponse> {
    return this.request(
      "PATCH",
      `/v1/blocks/${encodeURIComponent(blockId)}/children`,
      body,
      options,
    );
  }

  retrieveBlockChildren(
    blockId: string,
    cursor: string | null = null,
    options?: NotionRequestOptions,
  ): Promise<NotionBlockChildrenResponse> {
    const url = new URL(
      `${this.baseUrl}/v1/blocks/${encodeURIComponent(blockId)}/children`,
    );
    url.searchParams.set("page_size", "100");
    if (cursor) {
      url.searchParams.set("start_cursor", cursor);
    }
    return this.request("GET", url, undefined, options);
  }

  private async request<T extends JsonObject>(
    method: string,
    pathOrUrl: string | URL,
    body?: JsonObject,
    options: NotionRequestOptions = {},
  ): Promise<T> {
    const url =
      pathOrUrl instanceof URL ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.apiKey}`,
      "Notion-Version": this.options.apiVersion,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    let text: string;
    const requestAbort = createRequestAbortSignal(
      options.signal,
      this.requestTimeoutMs,
    );
    try {
      response = await this.fetchFn(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: requestAbort.signal,
      });
      text = await response.text();
    } catch (error) {
      if (requestAbort.timedOut()) {
        throw createTimeoutError(this.requestTimeoutMs, this.options.apiKey);
      }
      throw createNetworkError(error, this.options.apiKey);
    } finally {
      requestAbort.cleanup();
    }

    const parsed = parseJsonResponse(text, this.options.apiKey);
    if (!parsed.ok) {
      throw createInvalidJsonError(response.status, parsed.detail);
    }

    if (!response.ok) {
      throw classifyNotionHttpError({
        status: response.status,
        body: parsed.value,
        retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
        apiKey: this.options.apiKey,
      });
    }

    return parsed.value as T;
  }
}

function createRequestAbortSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  timedOut: () => boolean;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("Notion request timed out."));
  }, timeoutMs);
  timer.unref?.();

  const abortFromCaller = (): void => {
    controller.abort(signal?.reason);
  };
  if (signal?.aborted) {
    abortFromCaller();
  } else {
    signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

export function classifyNotionHttpError(input: {
  status: number;
  body: unknown;
  retryAfterSeconds: number | null;
  apiKey: string;
}): NotionApiError {
  const body = isRecord(input.body) ? input.body : {};
  const code = typeof body.code === "string" ? body.code : null;
  const message =
    typeof body.message === "string"
      ? body.message
      : `Notion API HTTP ${input.status}`;
  const technicalDetail = redactWithApiKey(message, input.apiKey);
  const kind = classifyStatus(input.status, code);
  const detail = buildErrorDetail(kind, input.status, code);

  return new NotionApiError(kind, detail.message, {
    status: input.status,
    code,
    retryAfterSeconds: input.retryAfterSeconds,
    retriable: detail.retriable,
    userAction: detail.userAction,
    technicalDetail,
  });
}

function parseJsonResponse(
  text: string,
  apiKey: string,
): { ok: true; value: unknown } | { ok: false; detail: string } {
  if (text.trim().length === 0) {
    return { ok: true, value: {} };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      detail: redactWithApiKey(text.slice(0, 500), apiKey),
    };
  }
}

function createInvalidJsonError(
  status: number,
  technicalDetail: string,
): NotionApiError {
  return new NotionApiError(
    "invalid_json",
    "Notion API 응답을 JSON으로 해석하지 못했습니다.",
    {
      status,
      code: null,
      retryAfterSeconds: null,
      retriable: status >= 500,
      userAction:
        "잠시 후 다시 시도해 주세요. 계속 실패하면 Notion 상태와 네트워크를 확인해 주세요.",
      technicalDetail,
    },
  );
}

function createNetworkError(error: unknown, apiKey: string): NotionApiError {
  const message = error instanceof Error ? error.message : String(error);
  return new NotionApiError(
    "network",
    "Notion API에 연결하지 못했습니다.",
    {
      status: null,
      code: null,
      retryAfterSeconds: null,
      retriable: true,
      userAction: "네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
      technicalDetail: redactWithApiKey(message, apiKey),
    },
  );
}

function createTimeoutError(timeoutMs: number, apiKey: string): NotionApiError {
  return new NotionApiError(
    "timeout",
    "Notion API 요청 시간이 초과되었습니다.",
    {
      status: null,
      code: null,
      retryAfterSeconds: null,
      retriable: true,
      userAction:
        "네트워크 상태를 확인하거나 NOTION_REQUEST_TIMEOUT_MS 값을 늘린 뒤 다시 시도해 주세요.",
      technicalDetail: redactWithApiKey(
        `Notion request timed out after ${timeoutMs}ms.`,
        apiKey,
      ),
    },
  );
}

function classifyStatus(
  status: number,
  code: string | null,
): NotionApiErrorKind {
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status === 404) {
    return "not_found";
  }
  if (status === 409) {
    return "conflict";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status === 400 || code === "validation_error") {
    return "validation";
  }
  if (status >= 500) {
    return "server";
  }
  return "unknown";
}

function buildErrorDetail(
  kind: NotionApiErrorKind,
  status: number,
  code: string | null,
): { message: string; userAction: string; retriable: boolean } {
  if (kind === "auth") {
    return {
      message: "Notion 인증 또는 공유 권한이 부족합니다.",
      userAction:
        "Notion integration token이 올바른지, 대상 데이터베이스에서 Add connections로 Dirong integration을 공유했는지 확인해 주세요.",
      retriable: false,
    };
  }
  if (kind === "not_found") {
    return {
      message: "Notion target에 접근하지 못했습니다.",
      userAction:
        "Notion URL이 올바른지 확인하고 대상 데이터베이스에 Dirong integration을 공유해 주세요.",
      retriable: false,
    };
  }
  if (kind === "conflict" || kind === "validation") {
    return {
      message: "Notion 요청이 데이터베이스 schema와 맞지 않습니다.",
      userAction:
        "Dirong에 필요한 Notion 속성 이름과 타입을 확인한 뒤 연결 테스트를 다시 실행해 주세요.",
      retriable: false,
    };
  }
  if (kind === "rate_limited") {
    return {
      message: "Notion API 사용량 제한으로 잠시 대기합니다.",
      userAction: "잠시 후 자동 재시도됩니다.",
      retriable: true,
    };
  }
  if (kind === "server") {
    return {
      message: "Notion API 서버 오류가 발생했습니다.",
      userAction: "잠시 후 다시 시도해 주세요.",
      retriable: true,
    };
  }
  return {
    message: `Notion API 오류가 발생했습니다. HTTP ${status}${
      code ? ` (${code})` : ""
    }`,
    userAction: "오류 내용을 확인한 뒤 다시 시도해 주세요.",
    retriable: false,
  };
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function redactWithApiKey(value: string, apiKey: string): string {
  return redactSensitiveText(value.split(apiKey).join("[REDACTED_NOTION_API_KEY]"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
