// The bridge's way in when Postgres keeps the data (HUB=backend in
// client/.env). Both run on the Tab Mac, so this listens on localhost only:
//   POST /hub/ingest  a message the bridge read (the module's ingest_message)
//   POST /hub/mark    what happened to an outbox row (mark_outbox)
//   GET  /hub/outbox  rows to send: queued, or sending when the bridge stopped
import { createServer, type IncomingMessage, type Server } from "node:http";
import { SaveError, type Engine, type IngestInput, type MarkOutboxInput } from "./store/engine.js";

const MAX_BODY = 1_000_000;

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "body is not JSON");
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Postgres text can't hold a NUL byte, and nobody means one.
const str = (v: unknown) => (typeof v === "string" ? v.replaceAll("\u0000", "") : undefined);

function ingestInput(b: Record<string, unknown>): IngestInput {
  const received = new Date(String(b.received_at));
  if (!str(b.message_id) || !str(b.sender_phone) || !str(b.kind) || Number.isNaN(received.getTime())) {
    throw new HttpError(400, "message_id, sender_phone, kind and received_at are required");
  }
  return {
    message_id: b.message_id as string,
    group_id: str(b.group_id),
    group_ledger_id: str(b.group_ledger_id),
    group_display_name: str(b.group_display_name),
    group_timezone: str(b.group_timezone) ?? "America/Detroit",
    sender_phone: b.sender_phone as string,
    sender_ledger_member_id: str(b.sender_ledger_member_id),
    is_dm: b.is_dm === true,
    kind: b.kind as string,
    text: str(b.text),
    image_url: str(b.image_url),
    reply_to_id: str(b.reply_to_id),
    reaction: str(b.reaction),
    received_at: received,
  };
}

function markInput(b: Record<string, unknown>): MarkOutboxInput {
  if (!str(b.action_id) || !str(b.status)) throw new HttpError(400, "action_id and status are required");
  return { action_id: b.action_id as string, status: b.status as string, sent_photon_id: str(b.sent_photon_id), error: str(b.error) };
}

export function startHub(
  engine: Engine,
  opts: { port: number; token?: string; log: (event: string, fields?: Record<string, unknown>) => void },
): Promise<Server> {
  const server = createServer((req, res) => {
    void (async () => {
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname === "/health") return send(200, { ok: true });
        // Only the bridge, never a web page open on this Mac: browsers send
        // Origin (and can't send JSON without asking first), and a rebound
        // DNS name shows up in Host.
        if (req.headers.origin) throw new HttpError(403, "no browsers");
        if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? "")) throw new HttpError(403, "localhost only");
        if (opts.token && req.headers.authorization !== `Bearer ${opts.token}`) throw new HttpError(401, "unauthorized");
        if (req.method === "POST" && !req.headers["content-type"]?.startsWith("application/json")) throw new HttpError(415, "JSON only");
        if (req.method === "POST" && url.pathname === "/hub/ingest") {
          await engine.ingestMessage(ingestInput((await body(req)) as Record<string, unknown>));
          return send(200, { ok: true });
        }
        if (req.method === "POST" && url.pathname === "/hub/mark") {
          await engine.markOutbox(markInput((await body(req)) as Record<string, unknown>));
          return send(200, { ok: true });
        }
        if (req.method === "GET" && url.pathname === "/hub/outbox") return send(200, await engine.clientOutbox());
        throw new HttpError(404, "not found");
      } catch (err) {
        // 503: the database is unreachable, so the bridge keeps the message
        // and tries again. 422: a rule said no.
        const status = err instanceof HttpError ? err.status : err instanceof SaveError ? 503 : 422;
        // Ids only: message text stays out of logs.
        if (!(err instanceof HttpError)) opts.log("hub_error", { path: req.url, error: String(err).slice(0, 200) });
        send(status, { error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", () => resolve(server));
  });
}
