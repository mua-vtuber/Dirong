import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createNotionClient, NotionApiError } from "./client.js";

const apiKey = "ntn_test_secret_1234567890";
const apiVersion = "2026-03-11";

test("Notion client sends required headers and JSON bodies", async () => {
  await withFakeNotionServer(async ({ baseUrl, requests }) => {
    const client = createNotionClient({ apiKey, apiVersion, baseUrl });

    const response = await client.createPage({
      parent: { data_source_id: "target" },
      properties: { Name: { title: [] } },
    });

    assert.equal(response.id, "page-1");
    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request?.method, "POST");
    assert.equal(request?.url, "/v1/pages");
    assert.equal(request?.headers.authorization, `Bearer ${apiKey}`);
    assert.equal(request?.headers["notion-version"], apiVersion);
    assert.match(request?.headers["content-type"] ?? "", /application\/json/);
    assert.deepEqual(request?.body, {
      parent: { data_source_id: "target" },
      properties: { Name: { title: [] } },
    });
  });
});

test("Notion client supports data source query and block children retrieval", async () => {
  await withFakeNotionServer(async ({ baseUrl, requests }) => {
    const client = createNotionClient({ apiKey, apiVersion, baseUrl });

    await client.queryDataSource("data source/id", { page_size: 1 });
    await client.retrieveBlockChildren("page/id", "cursor/id");

    assert.equal(
      requests[0]?.url,
      "/v1/data_sources/data%20source%2Fid/query",
    );
    assert.equal(
      requests[1]?.url,
      "/v1/blocks/page%2Fid/children?page_size=100&start_cursor=cursor%2Fid",
    );
  });
});

test("Notion client supports page, database, and data source creation APIs", async () => {
  await withFakeNotionServer(async ({ baseUrl, requests }) => {
    const client = createNotionClient({ apiKey, apiVersion, baseUrl });

    await client.retrievePage("page/id");
    await client.createDatabase({
      parent: { type: "page_id", page_id: "parent" },
      title: [{ type: "text", text: { content: "회의록" } }],
      initial_data_source: { properties: { 회의록: { title: {} } } },
    });
    await client.createDataSource({
      parent: { type: "database_id", database_id: "database" },
      properties: { Name: { title: {} } },
    });

    assert.equal(requests[0]?.method, "GET");
    assert.equal(requests[0]?.url, "/v1/pages/page%2Fid");
    assert.equal(requests[1]?.method, "POST");
    assert.equal(requests[1]?.url, "/v1/databases");
    assert.deepEqual(requests[1]?.body, {
      parent: { type: "page_id", page_id: "parent" },
      title: [{ type: "text", text: { content: "회의록" } }],
      initial_data_source: { properties: { 회의록: { title: {} } } },
    });
    assert.equal(requests[2]?.method, "POST");
    assert.equal(requests[2]?.url, "/v1/data_sources");
    assert.deepEqual(requests[2]?.body, {
      parent: { type: "database_id", database_id: "database" },
      properties: { Name: { title: {} } },
    });
  });
});

test("Notion client updates data source properties", async () => {
  await withFakeNotionServer(async ({ baseUrl, requests }) => {
    const client = createNotionClient({ apiKey, apiVersion, baseUrl });

    await client.updateDataSource("data source/id", {
      properties: {
        Discussion: { rich_text: {} },
        Old: null,
      },
    });

    assert.equal(requests[0]?.method, "PATCH");
    assert.equal(requests[0]?.url, "/v1/data_sources/data%20source%2Fid");
    assert.deepEqual(requests[0]?.body, {
      properties: {
        Discussion: { rich_text: {} },
        Old: null,
      },
    });
  });
});

test("Notion client classifies auth, not found, conflict, and rate limit errors", async () => {
  for (const entry of [
    { path: "/401", kind: "auth", status: 401, retriable: false },
    { path: "/403", kind: "auth", status: 403, retriable: false },
    { path: "/404", kind: "not_found", status: 404, retriable: false },
    { path: "/409", kind: "conflict", status: 409, retriable: false },
    { path: "/429", kind: "rate_limited", status: 429, retriable: true },
  ] as const) {
    await withFakeNotionServer(async ({ baseUrl }) => {
      const client = createNotionClient({
        apiKey,
        apiVersion,
        baseUrl: `${baseUrl}${entry.path}`,
      });

      await assert.rejects(
        client.retrieveDataSource("target"),
        (error: unknown) => {
          assert.equal(error instanceof NotionApiError, true);
          const notionError = error as NotionApiError;
          assert.equal(notionError.kind, entry.kind);
          assert.equal(notionError.status, entry.status);
          assert.equal(notionError.retriable, entry.retriable);
          assert.match(notionError.userAction, /Notion|자동/);
          if (entry.kind === "rate_limited") {
            assert.equal(notionError.retryAfterSeconds, 7);
          }
          return true;
        },
      );
    });
  }
});

test("Notion client reports invalid JSON and redacts token-like details", async () => {
  await withFakeNotionServer(async ({ baseUrl }) => {
    const client = createNotionClient({
      apiKey,
      apiVersion,
      baseUrl: `${baseUrl}/invalid-json`,
    });

    await assert.rejects(
      client.retrieveDatabase("target"),
      (error: unknown) => {
        assert.equal(error instanceof NotionApiError, true);
        const notionError = error as NotionApiError;
        assert.equal(notionError.kind, "invalid_json");
        assert.doesNotMatch(notionError.technicalDetail, new RegExp(apiKey));
        assert.match(notionError.technicalDetail, /\[REDACTED/);
        return true;
      },
    );
  });
});

test("Notion client surfaces network failures as retryable typed errors", async () => {
  const client = createNotionClient({
    apiKey,
    apiVersion,
    baseUrl: "http://127.0.0.1:1",
  });

  await assert.rejects(
    client.retrieveDataSource("target"),
    (error: unknown) => {
      assert.equal(error instanceof NotionApiError, true);
      const notionError = error as NotionApiError;
      assert.equal(notionError.kind, "network");
      assert.equal(notionError.retriable, true);
      return true;
    },
  );
});

test("Notion client reports request timeouts as retryable typed errors", async () => {
  const client = createNotionClient({
    apiKey,
    apiVersion,
    baseUrl: "https://notion.example.test",
    requestTimeoutMs: 5,
    fetchFn: async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener(
          "abort",
          () => reject(signal.reason),
          { once: true },
        );
      }),
  });

  await assert.rejects(
    client.retrieveDataSource("target"),
    (error: unknown) => {
      assert.equal(error instanceof NotionApiError, true);
      const notionError = error as NotionApiError;
      assert.equal(notionError.kind, "timeout");
      assert.equal(notionError.status, null);
      assert.equal(notionError.retriable, true);
      assert.match(notionError.message, /초과/);
      assert.match(notionError.userAction, /NOTION_REQUEST_TIMEOUT_MS/);
      return true;
    },
  );
});

test("Notion client forwards caller abort signals to fetch", async () => {
  let observedSignal: AbortSignal | undefined;
  const client = createNotionClient({
    apiKey,
    apiVersion,
    baseUrl: "https://notion.example.test",
    fetchFn: async (_input, init) => {
      observedSignal = init?.signal ?? undefined;
      return new Response(JSON.stringify({ object: "ok" }), { status: 200 });
    },
  });
  const controller = new AbortController();

  await client.retrievePage("page-id", { signal: controller.signal });

  assert.ok(observedSignal);
  assert.equal(observedSignal.aborted, false);
});

type CapturedRequest = {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: unknown;
};

async function withFakeNotionServer(
  fn: (context: {
    baseUrl: string;
    requests: CapturedRequest[];
  }) => Promise<void>,
): Promise<void> {
  const requests: CapturedRequest[] = [];
  const server = createServer((request, response) => {
    void handleFakeRequest(request, response, requests);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  assert.equal(typeof address, "object");
  assert.notEqual(address, null);
  const port = (address as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await fn({ baseUrl, requests });
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

async function handleFakeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requests: CapturedRequest[],
): Promise<void> {
  const rawBody = await readRequestBody(request);
  requests.push({
    method: request.method ?? "GET",
    url: request.url ?? "/",
    headers: request.headers,
    body: rawBody ? JSON.parse(rawBody) : null,
  });

  if (request.url?.includes("/invalid-json")) {
    sendRaw(response, 502, `bad token ${apiKey}`);
    return;
  }

  const statusMatch = /^\/(\d{3})\//.exec(request.url ?? "");
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    response.setHeader("Retry-After", "7");
    sendJson(response, status, {
      object: "error",
      code: status === 400 ? "validation_error" : "test_error",
      message: `failed with ${apiKey}`,
    });
    return;
  }

  sendJson(response, 200, {
    object: "ok",
    id: request.url === "/v1/pages" ? "page-1" : "ok-1",
  });
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function sendRaw(
  response: ServerResponse,
  statusCode: number,
  body: string,
): void {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(body);
}
