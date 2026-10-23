import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImsgRpc, imsgReplier, imsgTapbacker } from "../src/imsg.ts";
import { NotSentError } from "../src/messages-ui.ts";

const dir = mkdtempSync(join(tmpdir(), "imsg-"));
const logPath = join(dir, "requests.log");
writeFileSync(logPath, "");
// A wrapper so the rpc child is the fake, run by bun.
const bin = join(dir, "imsg");
writeFileSync(bin, `#!/bin/sh\nFAKE_IMSG_LOG=${logPath} exec ${process.execPath} ${join(import.meta.dir, "fake-imsg.ts")}\n`, { mode: 0o755 });
const rpc = new ImsgRpc(bin, () => {});
afterAll(() => rpc.stop());
const requests = () => readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

const GROUP = "any;+;6f900f3a292b4733b45509b3bb98d7e1";

test("checks the helper is up and offers tapbacks and replies", async () => {
  expect(await rpc.ready(["tapback", "send.rich"])).toEqual({ ok: true });
  expect((await rpc.ready(["typing"])).ok).toBe(false);
});

test("tapbacks a message by guid in its chat, with imsg's reaction names", async () => {
  const t = imsgTapbacker(rpc);
  expect(t.anyMessage).toBe(true);
  await t.react("MSG-1", "emphasize", () => false, GROUP);
  await t.react("MSG-2", "like", () => false, GROUP);
  const sent = requests().filter((r) => r.method === "tapback");
  expect(sent.map((r) => r.params)).toEqual([
    { chat_guid: GROUP, message_guid: "MSG-1", reaction: "emphasis" },
    { chat_guid: GROUP, message_guid: "MSG-2", reaction: "like" },
  ]);
  expect(sent[0].jsonrpc).toBe("2.0");
});

test("replies in the thread of any message", async () => {
  await imsgReplier(rpc).reply("MSG-3", "how much was the uber?", () => false, GROUP);
  expect(requests().filter((r) => r.method === "send.rich").at(-1).params).toEqual({ chat_guid: GROUP, text: "how much was the uber?", reply_to: "MSG-3" });
});

test("a reply imsg never started is NotSent (the bridge sends it normally); an unsure one isn't", async () => {
  const r = imsgReplier(rpc);
  expect(r.reply("gone", "hi", () => false, GROUP)).rejects.toBeInstanceOf(NotSentError);
  const unsure = await r.reply("unsure", "hi", () => false, GROUP).catch((e) => e);
  expect(unsure).not.toBeInstanceOf(NotSentError);
  expect(String(unsure)).toContain("may have completed");
});

test("without the chat's guid nothing is attempted", async () => {
  const before = requests().length;
  expect(imsgTapbacker(rpc).react("MSG", "like", () => false)).rejects.toBeInstanceOf(NotSentError);
  expect(requests().length).toBe(before);
});
