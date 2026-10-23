#!/usr/bin/env bun
// Stands in for `imsg rpc` in tests: answers status, tapback and send.rich,
// and logs every request to $FAKE_IMSG_LOG.
import { appendFileSync } from "node:fs";
const logPath = process.env.FAKE_IMSG_LOG!;
const decoder = new TextDecoder();
let buffer = "";
for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk);
  let nl: number;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const req = JSON.parse(buffer.slice(0, nl));
    buffer = buffer.slice(nl + 1);
    appendFileSync(logPath, JSON.stringify(req) + "\n");
    const reply = (body: object) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, ...body }) + "\n");
    if (req.method === "status") reply({ result: { bridge: { ready: process.env.FAKE_IMSG_READY !== "0" }, methods: ["status", "tapback", "send.rich"] } });
    else if (req.method === "send.rich" && req.params.reply_to === "gone")
      reply({ error: { code: -32603, message: "parent not found", data: { disposition: "not_started", retry_safe: true } } });
    else if (req.method === "send.rich" && req.params.reply_to === "unsure")
      reply({ error: { code: -32001, message: "may have completed", data: { disposition: "unknown", retry_safe: false } } });
    else reply({ result: { ok: true, guid: "OUT-1" } });
  }
}
