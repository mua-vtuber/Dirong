import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import type { Phase1Config } from "../config.js";
import type { RecordingProducer } from "../recording/recording-producer.js";
import { relativeDisplayPath, type SessionStore } from "../storage/session-store.js";

export class DashboardServer {
  private server: Server | null = null;
  private url: string | null = null;

  constructor(
    private readonly config: Phase1Config,
    private readonly store: SessionStore,
    private readonly producer: RecordingProducer,
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
      sendHtml(response, renderDashboardHtml());
      return;
    }

    if (url.pathname === "/api/state") {
      const state = this.store.getDashboardState(this.producer.getRuntimeState());
      sendJson(response, state);
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

function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dirong Phase 1 Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f7f4;
      --panel: #ffffff;
      --ink: #1f2328;
      --muted: #646b75;
      --line: #d9dfe7;
      --accent: #0f766e;
      --warn: #a15c00;
      --error: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, "Malgun Gothic", sans-serif;
      background: var(--bg);
      color: var(--ink);
      letter-spacing: 0;
    }
    header {
      padding: 18px 24px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    h1 { margin: 0; font-size: 22px; }
    main { max-width: 1240px; margin: 0 auto; padding: 20px; }
    section { margin: 0 0 22px; }
    h2 { font-size: 16px; margin: 0 0 10px; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .metric {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      min-height: 74px;
    }
    .label { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
    .value { font-size: 15px; overflow-wrap: anywhere; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    th, td {
      padding: 8px 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    th { color: var(--muted); font-weight: 600; background: #fbfbf9; }
    tr:last-child td { border-bottom: 0; }
    code { font-family: Consolas, monospace; font-size: 12px; }
    audio { width: 220px; max-width: 100%; height: 32px; }
    .status { color: var(--accent); font-weight: 700; }
    .warn { color: var(--warn); }
    .error { color: var(--error); }
    .muted { color: var(--muted); }
    @media (max-width: 860px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      main { padding: 14px; }
      th, td { font-size: 12px; padding: 7px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Dirong Phase 1 Dashboard</h1>
    <div class="muted" id="generatedAt">loading</div>
  </header>
  <main>
    <section class="grid" id="metrics"></section>
    <section>
      <h2>Speakers</h2>
      <div id="speakers"></div>
    </section>
    <section>
      <h2>Recent Chunks</h2>
      <div id="chunks"></div>
    </section>
    <section>
      <h2>STT Queue</h2>
      <div id="sttJobs"></div>
    </section>
    <section>
      <h2>Transcript Segments</h2>
      <div id="transcripts"></div>
    </section>
    <section>
      <h2>Connection / Errors</h2>
      <div id="events"></div>
    </section>
    <section>
      <h2>Repair Items</h2>
      <div id="repairs"></div>
    </section>
  </main>
  <script>
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[ch]));
    const sectionCache = new Map();
    const rel = (value) => {
      if (!value) return "";
      const text = String(value).replaceAll("\\\\", "/");
      const idx = text.lastIndexOf("/data/");
      return idx >= 0 ? text.slice(idx + 1) : text;
    };
    const table = (headers, rows) => {
      if (!rows.length) return '<div class="muted">없음</div>';
      return '<table><thead><tr>' + headers.map((h) => '<th>' + escapeHtml(h) + '</th>').join('') +
        '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
    };
    async function refresh() {
      const res = await fetch('/api/state', { cache: 'no-store' });
      const state = await res.json();
      document.getElementById('generatedAt').textContent = state.generatedAt;
      const session = state.currentSession;
      const runtime = state.runtime;
      setHtml('metrics', [
        metric('Recording', runtime.isRecording ? 'recording' : 'idle'),
        metric('Session', session?.id ?? '-'),
        metric('Voice Channel', runtime.voiceChannelName ?? session?.voice_channel_name ?? '-'),
        metric('Open Chunks', runtime.openChunks ?? 0),
        metric('Session Status', session?.status ?? '-'),
        metric('DB', rel(state.dbPath)),
        metric('Queue', queueSummary(state.queueStats ?? [])),
        metric('Repair Open', (state.recentRepairItems ?? []).filter((row) => row.status === 'open').length)
      ].join(''));

      setHtml('speakers', table(
        ['display name', 'userId', 'bot', 'chunks', 'first seen ms'],
        (state.speakers ?? []).map((s) => '<tr><td>' + escapeHtml(s.display_name_snapshot) +
          '</td><td><code>' + escapeHtml(s.user_id) + '</code></td><td>' +
          escapeHtml(Boolean(s.is_bot)) + '</td><td>' + escapeHtml(s.chunk_count) +
          '</td><td>' + escapeHtml(s.first_seen_at_ms) + '</td></tr>')
      ));

      setHtml('chunks', table(
        ['chunk', 'speaker', 'status', 'duration', 'raw', 'stt job', 'playback'],
        (state.recentChunks ?? []).map((c) => '<tr><td><code>' + escapeHtml(c.id) +
          '</code></td><td>' + escapeHtml(c.display_name_snapshot) +
          '</td><td>' + escapeHtml(c.status) + ' / ' + escapeHtml(c.transcode_status) +
          '</td><td>' + escapeHtml(c.duration_ms ?? '-') +
          '</td><td>' + escapeHtml(rel(c.raw_audio_path)) + '<br>' + escapeHtml(c.raw_byte_size ?? '-') + ' bytes' +
          '</td><td>' + escapeHtml(c.stt_job_id ? c.stt_job_status : 'missing') +
          '</td><td>' + renderAudioControls(c) + '</td></tr>')
      ));

      setHtml('sttJobs', table(
        ['job', 'status', 'chunk', 'attempts', 'input', 'sha256'],
        (state.recentSttJobs ?? []).map((j) => '<tr><td><code>' + escapeHtml(j.id) +
          '</code></td><td>' + escapeHtml(j.status) +
          '</td><td><code>' + escapeHtml(j.chunk_id) + '</code><br>' +
          escapeHtml(j.duration_ms ?? '-') + ' ms / ' + escapeHtml(j.stt_byte_size ?? '-') + ' bytes' +
          '</td><td>' + escapeHtml(j.attempts) + ' / ' + escapeHtml(j.max_attempts) +
          '</td><td>' + escapeHtml(rel(j.input_audio_path)) +
          '</td><td><code>' + escapeHtml(shortHash(j.input_audio_sha256)) + '</code></td></tr>')
      ));

      setHtml('transcripts', table(
        ['time', 'speaker', 'source/provider/model', 'chunk', 'text'],
        (state.recentTranscriptSegments ?? []).map((t) => '<tr><td>' +
          escapeHtml(t.start_ms) + '-' + escapeHtml(t.end_ms) +
          '</td><td>' + escapeHtml(t.display_name_snapshot) +
          '</td><td>' + escapeHtml(t.source) + ' / ' + escapeHtml(t.provider) +
          '<br><code>' + escapeHtml(t.model) + '</code>' +
          '</td><td><code>' + escapeHtml(t.chunk_id) + '</code></td><td>' +
          escapeHtml(t.text) + '</td></tr>')
      ));

      setHtml('events', table(
        ['time', 'level', 'event', 'details'],
        (state.recentConnectionEvents ?? []).map((e) => '<tr><td>' + escapeHtml(e.created_at) +
          '</td><td class="' + escapeHtml(e.level) + '">' + escapeHtml(e.level) +
          '</td><td>' + escapeHtml(e.event_type) +
          '</td><td><code>' + escapeHtml(e.details_json ?? '') + '</code></td></tr>')
      ));

      setHtml('repairs', table(
        ['updated', 'severity', 'type', 'status', 'path'],
        (state.recentRepairItems ?? []).map((r) => '<tr><td>' + escapeHtml(r.updated_at) +
          '</td><td class="' + escapeHtml(r.severity) + '">' + escapeHtml(r.severity) +
          '</td><td>' + escapeHtml(r.item_type) +
          '</td><td>' + escapeHtml(r.status) +
          '</td><td>' + escapeHtml(rel(r.path)) + '</td></tr>')
      ));
    }
    function setHtml(id, html) {
      if (sectionCache.get(id) === html) {
        return;
      }
      sectionCache.set(id, html);
      document.getElementById(id).innerHTML = html;
    }
    function metric(label, value) {
      return '<div class="metric"><div class="label">' + escapeHtml(label) +
        '</div><div class="value">' + escapeHtml(value) + '</div></div>';
    }
    function renderAudioControls(c) {
      if (!(c.raw_byte_size > 0) || c.status === 'writing') {
        return '<span class="muted">pending</span>';
      }
      const encoded = encodeURIComponent(c.id);
      const stt = c.stt_audio_path && c.stt_byte_size > 0
        ? '<div class="label">STT-safe</div><audio controls preload="metadata" src="/audio/' + encoded + '/stt"></audio>'
        : '';
      return stt + '<div class="label">Raw</div><audio controls preload="metadata" src="/audio/' + encoded + '/raw"></audio>';
    }
    function shortHash(value) {
      if (!value) return '';
      return String(value).slice(0, 12);
    }
    function queueSummary(rows) {
      const counts = new Map(rows.map((row) => [row.status, row.count]));
      return ['queued', 'processing', 'done', 'failed', 'failed_missing_file']
        .map((status) => status + ':' + (counts.get(status) ?? 0))
        .join(' / ');
    }
    refresh();
    setInterval(refresh, 3000);
  </script>
</body>
</html>`;
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(html);
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
