// Tab playground: simulate a group chat against the real backend, without iMessage.
// It stands in for the iMessage bridge: messages you type are ingested as fake members,
// and Tab's outbox rows are "delivered" to the page instead of to Messages.
//
//   bun run playground        (needs a local SpacetimeDB and the backend pointed at it)
//
// It connects as the local module owner (SPACETIME_AUTH_TOKEN in the repo-root .env),
// so it never touches Maincloud.
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { Identity, Timestamp } from "spacetimedb";
import { DbConnection, tables } from "../src/module_bindings/index.ts";

const root = resolve(import.meta.dir, "../..");
const rootEnv = Object.fromEntries(
  (existsSync(join(root, ".env")) ? readFileSync(join(root, ".env"), "utf8") : "")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const env = { ...rootEnv, ...process.env } as Record<string, string | undefined>;
const HOST = env.PLAYGROUND_SPACETIME_HOST ?? "http://127.0.0.1:3000";
const DB = env.PLAYGROUND_SPACETIME_DB ?? "tab-local";
const PORT = Number(env.PLAYGROUND_PORT ?? 4400);
const BACKEND_LOG = env.PLAYGROUND_BACKEND_LOG;
const BACKEND_IDENTITY = env.PLAYGROUND_BACKEND_IDENTITY;
if (HOST.includes("maincloud")) throw new Error("The playground is local-only; point it at a local SpacetimeDB.");
if (!env.SPACETIME_AUTH_TOKEN) throw new Error("SPACETIME_AUTH_TOKEN (the local module owner's token) is missing from the repo-root .env.");

const conn = await new Promise<DbConnection>((ok, fail) =>
  DbConnection.builder().withUri(HOST).withDatabaseName(DB).withToken(env.SPACETIME_AUTH_TOKEN!)
    .onConnect((c) => ok(c)).onConnectError((_c, e) => fail(e)).build(),
);
await conn.reducers.claimModuleOwner({}).catch(() => {}); // already ours if this fails
if (BACKEND_IDENTITY) await conn.reducers.grantServiceRole({ identity: Identity.fromString(BACKEND_IDENTITY), role: "backend" });
await new Promise<void>((ok, fail) =>
  conn.subscriptionBuilder().onApplied(() => ok()).onError((c) => fail(new Error(String(c.event)))).subscribe([
    tables.clientOutbox, tables.backendMessages, tables.backendGroups, tables.backendMembers, tables.backendOutbox,
    tables.backendExpenses, tables.backendShares, tables.backendLineItems, tables.backendClaims, tables.backendTransfers,
  ]),
);

// ---- simulated chat ----------------------------------------------------------------
type Member = { phone: string; name: string };
const DEFAULT_MEMBERS: Member[] = [
  { phone: "+15555550111", name: "Alex" },
  { phone: "+15555550112", name: "Sam" },
  { phone: "+15555550113", name: "Priya" },
];
let members: Member[] = [];
let groupId = "";
let seq = 0;
// What you typed, kept here because the backend clears the stored text of messages it ignores (§19).
const typed = new Map<string, string>();
const imgDir = join(root, "client", ".state", "playground-images");
mkdirSync(imgDir, { recursive: true });

const ts = (d = new Date()) => Timestamp.fromDate(d);
const id = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

async function ingest(m: {
  phone: string; kind: "text" | "image" | "reaction" | "system"; text?: string; image_url?: string;
  reply_to_id?: string; reaction?: string; dm?: boolean; message_id?: string;
}) {
  const message_id = m.message_id ?? id(m.kind === "reaction" ? "sim-r" : "sim");
  if (m.text && m.kind !== "system") typed.set(message_id, m.text);
  await conn.reducers.ingestMessage({
    messageId: message_id, groupId: m.dm ? undefined : groupId, groupLedgerId: m.dm ? undefined : `ledger-${groupId}`,
    groupDisplayName: m.dm ? undefined : "Playground", groupTimezone: "America/Detroit", senderPhone: m.phone,
    senderLedgerMemberId: crypto.randomUUID(), isDm: !!m.dm, kind: m.kind, text: m.text, imageUrl: m.image_url,
    replyToId: m.reply_to_id, reaction: m.reaction, receivedAt: ts(),
  });
  return message_id;
}

async function newChat(list: Member[]) {
  members = list;
  groupId = `sim-${Date.now().toString(36)}`;
  // Same as the bridge on "/tab on": one member_joined per participant creates the group.
  for (const m of members) await ingest({ phone: m.phone, kind: "system", text: "member_joined" });
}
await newChat(DEFAULT_MEMBERS);

// Deliver Tab's outbox the way the bridge would, recording a fake message id.
const delivering = new Set<string>();
setInterval(async () => {
  for (const r of conn.db.clientOutbox.iter()) {
    if (r.status !== "queued" || r.sendAfter.toDate() > new Date() || delivering.has(r.actionId)) continue;
    delivering.add(r.actionId);
    await conn.reducers.markOutbox({ actionId: r.actionId, status: "sent", sentPhotonId: `tab-${r.actionId}`, error: undefined })
      .catch((e: unknown) => console.error("mark_outbox", e));
  }
}, 300);

// ---- backend log (for act / clarify / ignore decisions) ------------------------------
type LogEvent = Record<string, unknown> & { event?: string; message_id?: string; at?: string };
let logOffset = 0;
const logEvents: LogEvent[] = [];
function readLog() {
  if (!BACKEND_LOG || !existsSync(BACKEND_LOG)) return;
  const size = statSync(BACKEND_LOG).size;
  if (size < logOffset) logOffset = 0;
  if (size === logOffset) return;
  const chunk = readFileSync(BACKEND_LOG).subarray(logOffset, size).toString("utf8");
  logOffset = size;
  for (const line of chunk.split("\n")) {
    if (!line.startsWith("{")) continue;
    try { logEvents.push(JSON.parse(line)); } catch { /* partial line */ }
  }
  if (logEvents.length > 5000) logEvents.splice(0, logEvents.length - 5000);
}
setInterval(readLog, 500);

// ---- state for the page ---------------------------------------------------------------
const nameOf = (phone: string) =>
  phone === "tab" ? "Tab" : (conn.db.backendMembers.memberId.find(`${groupId}:${phone}`)?.name ?? members.find((m) => m.phone === phone)?.name ?? phone.slice(-4));

function state() {
  const mine = new Set(members.map((m) => m.phone));
  const msgs = [...conn.db.backendMessages.iter()].filter((m) => m.groupId === groupId || (m.isDm && mine.has(m.senderPhone)));
  const out = [...conn.db.backendOutbox.iter()].filter((o) => o.groupId === groupId || (o.toPhone && mine.has(o.toPhone)));
  const events = new Map<string, LogEvent[]>();
  for (const e of logEvents) if (e.message_id) events.set(e.message_id, [...(events.get(e.message_id) ?? []), e]);

  const items = [
    ...msgs.filter((m) => m.kind !== "system").map((m) => ({
      id: m.messageId, from: m.senderPhone, name: m.isDm ? `${nameOf(m.senderPhone)} → Tab (DM)` : nameOf(m.senderPhone),
      dm: m.isDm, kind: m.kind, text: m.text || typed.get(m.messageId) || "", textCleared: !m.text && typed.has(m.messageId), reaction: m.reaction, reply_to: m.replyToId, image_url: m.imageUrl,
      at: m.receivedAt.toDate().getTime(), intent: m.intent, confidence: m.confidence, status: m.status, error: m.error,
      events: events.get(m.messageId) ?? [],
    })),
    ...out.filter((o) => o.kind !== "contact_card").map((o) => ({
      id: o.sentPhotonId ?? `tab-${o.actionId}`, from: "tab", name: o.toPhone ? `Tab → ${nameOf(o.toPhone)} (DM)` : "Tab",
      dm: !!o.toPhone, kind: o.kind === "reaction" ? "reaction" : "text", text: o.text ?? "", reaction: o.reaction,
      reply_to: o.targetMessageId, at: o.createdAt.toDate().getTime(), purpose: o.purpose, status: o.status, error: o.error,
    })),
  ].sort((a, b) => a.at - b.at);

  const expenses = [...conn.db.backendExpenses.iter()].filter((e) => e.groupId === groupId)
    .sort((a, b) => Number(a.createdAt.microsSinceUnixEpoch - b.createdAt.microsSinceUnixEpoch))
    .map((e) => ({
      id: e.expenseId, description: e.description, status: e.status, mode: e.splitMode, total: Number(e.totalCents),
      payer: e.payerPhone ? nameOf(e.payerPhone) : null,
      shares: [...conn.db.backendShares.iter()].filter((s) => s.expenseId === e.expenseId)
        .map((s) => ({ name: nameOf(s.phone), role: s.role, status: s.status, amount: Number(s.amountCents) })),
      items: [...conn.db.backendLineItems.iter()].filter((i) => i.expenseId === e.expenseId).sort((a, b) => a.position - b.position)
        .map((i) => ({ n: i.position, description: i.description, amount: Number(i.amountCents),
          claimedBy: [...conn.db.backendClaims.iter()].filter((c) => c.itemId === i.itemId).map((c) => nameOf(c.phone)) })),
      transfers: [...conn.db.backendTransfers.iter()].filter((t) => t.expenseId === e.expenseId)
        .map((t) => ({ from: nameOf(t.fromPhone), to: nameOf(t.toPhone), amount: Number(t.amountCents), status: t.status })),
    }));
  const group = conn.db.backendGroups.groupId.find(groupId);
  const recentLog = logEvents.filter((e) => !e.message_id || msgs.some((m) => m.messageId === e.message_id)).slice(-40);
  return { groupId, onboarding: group?.onboardingStatus, members: members.map((m) => ({ ...m, name: nameOf(m.phone) })), items, expenses, log: recentLog, backendLog: !!BACKEND_LOG };
}

// ---- http ------------------------------------------------------------------------------
Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/") return new Response(Bun.file(join(import.meta.dir, "index.html")));
      if (url.pathname === "/state") return Response.json(state());
      if (url.pathname.startsWith("/img/")) {
        const f = Bun.file(join(imgDir, url.pathname.slice(5).replace(/[^a-z0-9.-]/gi, "")));
        return (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 });
      }
      if (req.method !== "POST") return new Response("not found", { status: 404 });
      if (url.pathname === "/send") {
        const b = (await req.json()) as { phone: string; text: string; reply_to?: string; dm?: boolean };
        return Response.json({ id: await ingest({ phone: b.phone, kind: "text", text: b.text, reply_to_id: b.reply_to || undefined, dm: b.dm }) });
      }
      if (url.pathname === "/react") {
        const b = (await req.json()) as { phone: string; target: string; reaction: string };
        return Response.json({ id: await ingest({ phone: b.phone, kind: "reaction", reaction: b.reaction, reply_to_id: b.target }) });
      }
      if (url.pathname === "/image") {
        const form = await req.formData();
        const file = form.get("file") as File;
        const name = `${crypto.randomUUID().replaceAll("-", "")}.${(file.name.split(".").pop() ?? "jpg").toLowerCase()}`;
        await Bun.write(join(imgDir, name), file);
        const image_url = `http://localhost:${PORT}/img/${name}`;
        return Response.json({ id: await ingest({ phone: String(form.get("phone")), kind: "image", image_url, text: String(form.get("caption") ?? "") || undefined }) });
      }
      if (url.pathname === "/new-chat") {
        const b = (await req.json().catch(() => ({}))) as { names?: string[] };
        const names = b.names?.map((n) => n.trim()).filter(Boolean).slice(0, 8);
        const list = (names?.length ? names : DEFAULT_MEMBERS.map((m) => m.name)).map((name) => ({
          name, phone: `+1555555${String(Math.floor(Math.random() * 9000) + 1000)}`,
        }));
        await newChat(list);
        return Response.json(state());
      }
      return new Response("not found", { status: 404 });
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 });
    }
  },
});
console.log(`Tab playground on http://localhost:${PORT}  (database ${DB} at ${HOST}${BACKEND_LOG ? `, backend log ${BACKEND_LOG}` : ", no backend log"})`);
