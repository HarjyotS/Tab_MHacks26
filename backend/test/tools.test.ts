import { describe, expect, it, vi } from "vitest";
import { runTools, withFeedback, type Tool } from "../src/grok/tools.js";
import { toolClient } from "./support/harness.js";

const echo: Tool = {
  name: "echo",
  description: "returns its args",
  parameters: { type: "object", properties: { x: { type: "string" } } },
  run: vi.fn((a) => ({ got: a })),
};
const start = [{ role: "system" as const, content: "s" }, { role: "user" as const, content: "q" }];

describe("tool loop", () => {
  it("runs the tool calls, feeds results back, and returns the reply", async () => {
    const { client, requests } = toolClient([{ call: [{ name: "echo", args: { x: "a" } }, { name: "echo", args: { x: "b" } }] }, { reply: "done" }]);
    const r = await runTools({ client, model: "m", messages: start, tools: [echo], deadline: Date.now() + 10_000 });
    expect(r).toMatchObject({ text: "done", outcome: "replied", rounds: 1 });
    expect(r.calls.map((c) => c.output)).toEqual(['{"got":{"x":"a"}}', '{"got":{"x":"b"}}']);
    expect(requests[0]!.tools).toEqual(["echo", "reply"]);
    expect(requests[0]!.tool_choice).toBe("auto");
    expect(requests[1]!.messages.filter((m) => m.role === "tool")).toHaveLength(2);
  });

  it("accepts a plain-text answer", async () => {
    const { client } = toolClient([{ text: " hi " }]);
    expect(await runTools({ client, model: "m", messages: start, tools: [echo], deadline: Date.now() + 10_000 })).toMatchObject({ text: "hi", outcome: "replied" });
  });

  it("forces a reply after the round limit, offering only the reply tool", async () => {
    const steps = Array.from({ length: 5 }, () => ({ call: [{ name: "echo" }] }));
    const { client, requests } = toolClient([...steps, { reply: "forced answer" }]);
    const r = await runTools({ client, model: "m", messages: start, tools: [echo], deadline: Date.now() + 10_000 });
    expect(r).toMatchObject({ text: "forced answer", outcome: "forced", rounds: 5 });
    expect(requests).toHaveLength(6);
    expect(requests[5]).toMatchObject({ tools: ["reply"], tool_choice: { type: "function", function: { name: "reply" } } });
  });

  it("gives up when forced and still no reply", async () => {
    const { client } = toolClient([{ call: [{ name: "echo" }] }, { call: [{ name: "echo" }] }]);
    expect(await runTools({ client, model: "m", messages: start, tools: [echo], deadline: Date.now() + 10_000, maxRounds: 1 })).toMatchObject({ text: null, outcome: "error" });
  });

  it("stops at the deadline without another call", async () => {
    const clock = { now: 0 };
    const { client, requests } = toolClient([{ call: [{ name: "echo" }], advance: 30_000 }, { reply: "late" }], clock);
    const r = await runTools({ client, model: "m", messages: start, tools: [echo], deadline: 25_000, clock: () => clock.now });
    expect(r).toMatchObject({ text: null, outcome: "timeout" });
    expect(requests).toHaveLength(1);
  });

  it("reports an API failure as an error, and a timeout as a timeout", async () => {
    const failing = toolClient([{ fail: "500 server error" }]);
    expect(await runTools({ client: failing.client, model: "m", messages: start, tools: [], deadline: Date.now() + 10_000 })).toMatchObject({ outcome: "error" });
    const slow = toolClient([{ fail: "Request timed out." }]);
    expect(await runTools({ client: slow.client, model: "m", messages: start, tools: [], deadline: Date.now() + 10_000 })).toMatchObject({ outcome: "timeout" });
  });

  it("passes the remaining budget as the request timeout, with no SDK retries", async () => {
    const clock = { now: 1_000 };
    const { client, create } = toolClient([{ reply: "ok" }], clock);
    await runTools({ client, model: "m", messages: start, tools: [], deadline: 26_000, clock: () => clock.now });
    expect(create.mock.calls[0]![1]).toEqual({ timeout: 25_000, maxRetries: 0 });
  });

  it("turns unknown tools, bad arguments, and throwing tools into error results", async () => {
    const boom: Tool = { ...echo, name: "boom", run: () => { throw new Error("kaput"); } };
    const { client, requests } = toolClient([{ call: [{ name: "nope" }, { name: "boom" }] }, { reply: "ok" }]);
    await runTools({ client, model: "m", messages: start, tools: [boom], deadline: Date.now() + 10_000 });
    const results = requests[1]!.messages.filter((m) => m.role === "tool").map((m) => String(m.content));
    expect(results[0]).toMatch(/No tool named nope/);
    expect(results[1]).toMatch(/kaput/);
  });

  it("continues a conversation with feedback on a rejected reply", async () => {
    const { client } = toolClient([{ reply: "bad" }]);
    const r = await runTools({ client, model: "m", messages: start, tools: [], deadline: Date.now() + 10_000 });
    const next = withFeedback(r, "fix it");
    expect(next.at(-1)).toMatchObject({ role: "tool", tool_call_id: r.reply_call_id, content: "fix it" });
  });
});
