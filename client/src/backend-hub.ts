import { HubUnavailable, type Hub } from "./hub.ts";
import type { InboundMessage, OutboxRow, OutboxUpdate } from "./types.ts";

export interface BackendHubOptions {
  /** The backend's hub, on this Mac: http://127.0.0.1:4100 unless HUB_PORT moved it. */
  url: string;
  /** TAB_HUB_TOKEN, when the backend asks for one. */
  token?: string;
  /** Timezone for groups created by this client (SPEC 11.3 GROUP_TIMEZONE). */
  timezone: string;
}

/**
 * The hub when Postgres keeps Tab's data (HUB=backend): the backend holds the
 * rows and the bridge talks to it over localhost (backend/src/hub.ts). If the
 * backend is down or can't reach the database, calls throw HubUnavailable and
 * the bridge keeps the message for later instead of dropping it.
 */
export function backendHub(opts: BackendHubOptions): Hub {
  const base = opts.url.replace(/\/$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;

  async function call(path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new HubUnavailable(`backend unreachable at ${base}: ${err instanceof Error ? err.message : err}`);
    }
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.ok) return payload;
    // Only these mean this request itself is wrong (a bad field, a rule
    // saying no). Anything else, like a 503 (database down) or a 401 (token
    // mismatch), says nothing about the message: keep it and try again.
    if ([400, 413, 422].includes(res.status)) throw new Error(`${path} failed (${res.status}): ${payload.error ?? "no reason given"}`);
    throw new HubUnavailable(`${path}: backend answered ${res.status}: ${payload.error ?? "no reason given"}`);
  }

  return {
    async ingest(m: InboundMessage) {
      await call("/hub/ingest", {
        message_id: m.message_id,
        group_id: m.group_id,
        // Opaque ids for the web ledger, used only when this message creates the group or member.
        group_ledger_id: m.group_id ? crypto.randomUUID() : undefined,
        // Sets the name on a new group and keeps it current when the chat is renamed.
        group_display_name: m.group_name,
        group_timezone: opts.timezone,
        sender_phone: m.sender_phone,
        sender_ledger_member_id: crypto.randomUUID(),
        is_dm: m.is_dm,
        kind: m.kind,
        text: m.text,
        image_url: m.image_url,
        reply_to_id: m.reply_to_id,
        reaction: m.reaction,
        received_at: m.received_at.toISOString(),
      });
    },
    async markOutbox(actionId: string, update: OutboxUpdate) {
      await call("/hub/mark", {
        action_id: actionId,
        status: update.status,
        sent_photon_id: update.sent_photon_id,
        error: update.error,
      });
    },
    // Queued rows that are due, and rows marked sending: the bridge resends
    // only the ones it knows never went out.
    async dueOutbox(now: Date): Promise<OutboxRow[]> {
      const rows = (await call("/hub/outbox")) as (Omit<OutboxRow, "send_after"> & { send_after: string })[];
      return rows
        .map((r) => ({ ...r, send_after: new Date(r.send_after) }))
        .filter((r) => (r.status === "queued" || r.status === "sending") && r.send_after <= now)
        .sort((a, b) => a.send_after.getTime() - b.send_after.getTime());
    },
  };
}
