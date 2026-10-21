import { afterAll, expect, test } from "bun:test";
import { backendHub } from "../src/backend-hub.ts";
import { HubUnavailable } from "../src/hub.ts";

// A stand-in for backend/src/hub.ts.
const seen: { path: string; auth: string | null; body: any }[] = [];
let mode: "ok" | "db_down" | "rule" | "unauthorized" = "ok";
const t0 = new Date("2026-10-21T18:00:00Z");
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    seen.push({ path: url.pathname, auth: req.headers.get("authorization"), body: req.method === "POST" ? await req.json() : undefined });
    if (mode === "db_down") return Response.json({ error: "saving failed: neon unreachable" }, { status: 503 });
    if (mode === "rule") return Response.json({ error: "Unknown outbox action" }, { status: 422 });
    if (mode === "unauthorized") return Response.json({ error: "unauthorized" }, { status: 401 });
    if (url.pathname === "/hub/outbox") {
      const row = (id: string, status: string, offset: number) => ({
        action_id: id, kind: "dm", to_phone: "+15550000001", text: "hi", purpose: "other",
        send_after: new Date(t0.getTime() + offset).toISOString(), status,
      });
      return Response.json([row("later", "queued", 60_000), row("b", "queued", 1_000), row("a", "queued", 0), row("busy", "sending", 0)]);
    }
    return Response.json({ ok: true });
  },
});
afterAll(() => server.stop());
const hub = backendHub({ url: `http://127.0.0.1:${server.port}/`, token: "s3cret", timezone: "America/Denver" });

test("sends each message to the backend with what a new group or member needs", async () => {
  mode = "ok";
  await hub.ingest({ message_id: "g1", group_id: "chat1", group_name: "vegas", sender_phone: "+15550000001", is_dm: false, kind: "text", text: "paid 40", received_at: t0 });
  const { path, auth, body } = seen.at(-1)!;
  expect(path).toBe("/hub/ingest");
  expect(auth).toBe("Bearer s3cret");
  expect(body).toMatchObject({ message_id: "g1", group_id: "chat1", group_display_name: "vegas", group_timezone: "America/Denver", text: "paid 40", received_at: t0.toISOString() });
  expect(body.group_ledger_id).toBeString();
  expect(body.sender_ledger_member_id).toBeString();
});

test("hands back rows that are due, queued or marked sending, oldest first", async () => {
  mode = "ok";
  const due = await hub.dueOutbox(new Date(t0.getTime() + 5_000));
  expect(due.map((r) => r.action_id)).toEqual(["a", "busy", "b"]);
  expect(due[0]!.send_after).toEqual(t0);
});

test("marks outbox rows", async () => {
  mode = "ok";
  await hub.markOutbox("a", { status: "sent", sent_photon_id: "p1" });
  expect(seen.at(-1)).toMatchObject({ path: "/hub/mark", body: { action_id: "a", status: "sent", sent_photon_id: "p1" } });
});

test("a backend that can't save, or isn't there, is unavailable; a rule saying no is an error", async () => {
  mode = "db_down";
  expect(hub.markOutbox("a", { status: "sent" })).rejects.toBeInstanceOf(HubUnavailable);
  mode = "unauthorized";
  expect(hub.markOutbox("a", { status: "sent" })).rejects.toBeInstanceOf(HubUnavailable);
  mode = "rule";
  const rule = await hub.markOutbox("a", { status: "sent" }).catch((e) => e);
  expect(rule).not.toBeInstanceOf(HubUnavailable);
  expect(String(rule)).toContain("Unknown outbox action");
  const gone = backendHub({ url: "http://127.0.0.1:1", timezone: "UTC" });
  expect(gone.dueOutbox(t0)).rejects.toBeInstanceOf(HubUnavailable);
});
