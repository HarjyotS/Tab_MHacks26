import type { InboundMessage, OutboxRow, OutboxUpdate } from "./types.ts";

/**
 * The client's side of the SpacetimeDB contract (SPEC 5.5): it calls
 * `ingest_message` and `mark_outbox`, and reads queued outbox rows from its
 * subscription. A SpacetimeDB implementation slots in here once the module's
 * TypeScript bindings are generated.
 */
export interface Hub {
  ingest(message: InboundMessage): Promise<void>;
  markOutbox(actionId: string, update: OutboxUpdate): Promise<void>;
  /** Queued rows whose send_after has passed, oldest first. */
  dueOutbox(now: Date): OutboxRow[];
}

type NewOutbox = Omit<OutboxRow, "action_id" | "status" | "send_after" | "purpose"> &
  Partial<Pick<OutboxRow, "send_after" | "purpose">>;

/**
 * Stand-in for SpacetimeDB so the bridge can be tested end to end on its own.
 * It logs everything ingested and, with echo on, answers a few test commands
 * typed into an enabled group:
 *
 *   @tab ping   Tab replies "pong" in the group
 *   @tab dm     Tab DMs the sender
 *   @tab card   Tab sends its contact card
 *   @tab like   Tab tapbacks 👍 on that message
 *
 * Tapping a reaction on one of those replies logs whether it was routed back
 * to the right message, which is the sent_photon_id round trip.
 */
export class DevHub implements Hub {
  readonly ingested: InboundMessage[] = [];
  private readonly outbox = new Map<string, OutboxRow & { sent_photon_id?: string }>();
  private nextId = 1;

  constructor(
    private readonly echo: boolean,
    private readonly log: (line: string) => void = console.log,
  ) {}

  async ingest(m: InboundMessage): Promise<void> {
    this.ingested.push(m);
    const where = m.is_dm ? "dm" : m.group_id;
    this.log(`[ingest] ${m.kind} from ${m.sender_phone} in ${where}: ${m.text ?? m.reaction ?? m.image_url ?? ""}`);

    if (m.kind === "reaction") {
      const target = [...this.outbox.values()].find((r) => r.sent_photon_id && r.sent_photon_id === m.reply_to_id);
      this.log(
        target
          ? `[ingest] ${m.reaction} is on Tab's ${target.purpose} "${target.text ?? target.kind}"`
          : `[ingest] ${m.reaction} is on ${m.reply_to_id} (not one of Tab's messages)`,
      );
      return;
    }
    if (!this.echo || m.kind !== "text" || m.is_dm || !m.group_id) return;
    const command = m.text?.trim().toLowerCase();
    if (command === "@tab ping") this.enqueue({ kind: "group_message", group_id: m.group_id, text: "pong" });
    if (command === "@tab dm") this.enqueue({ kind: "dm", to_phone: m.sender_phone, text: "pong, privately" });
    if (command === "@tab card") this.enqueue({ kind: "contact_card", group_id: m.group_id });
    if (command === "@tab like") {
      this.enqueue({ kind: "reaction", group_id: m.group_id, target_message_id: m.message_id, reaction: "like" });
    }
  }

  enqueue(row: NewOutbox): OutboxRow {
    const full: OutboxRow = {
      ...row,
      purpose: row.purpose ?? "other",
      send_after: row.send_after ?? new Date(),
      action_id: `dev-${this.nextId++}`,
      status: "queued",
    };
    this.outbox.set(full.action_id, full);
    return full;
  }

  async markOutbox(actionId: string, update: OutboxUpdate): Promise<void> {
    const row = this.outbox.get(actionId);
    if (!row) return;
    Object.assign(row, update);
    if (update.status !== "sending") {
      this.log(`[outbox] ${actionId} ${update.status}${update.sent_photon_id ? ` as ${update.sent_photon_id}` : ""}${update.error ? `: ${update.error}` : ""}`);
    }
  }

  dueOutbox(now: Date): OutboxRow[] {
    return [...this.outbox.values()].filter((r) => r.status === "queued" && r.send_after <= now);
  }

  row(actionId: string): (OutboxRow & { sent_photon_id?: string; error?: string }) | undefined {
    return this.outbox.get(actionId);
  }

  /** POST /dev/outbox with an outbox row as JSON queues it, so teammates can test sends with curl. */
  async handle(req: Request, url: URL): Promise<Response | null> {
    if (url.pathname !== "/dev/outbox") return null;
    if (req.method === "GET") return Response.json(this.dueOutbox(new Date(8.64e15)));
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const body = (await req.json()) as NewOutbox;
    if (body.send_after) body.send_after = new Date(body.send_after);
    return Response.json(this.enqueue(body));
  }
}
