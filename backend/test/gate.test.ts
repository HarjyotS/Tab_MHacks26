import { describe, expect, it, vi } from "vitest";
import type { ClassifyInput, GateMessage } from "@tab/gate";
import { createClassify, route, withTab } from "../src/gate/index.js";
import { PHONES } from "../scripts/extraction-cases.js";

const members = [
  { phone: PHONES.Joe, name: "Joe" },
  { phone: PHONES.Kian, name: "Kian" },
];
const text = (t: string): GateMessage => ({
  sender_phone: PHONES.Kian,
  is_dm: false,
  kind: "text",
  text: t,
});
const input = (
  message: GateMessage,
  open_items: ClassifyInput["open_items"] = [],
): ClassifyInput => ({
  members,
  context: [],
  open_items,
  message,
});
const settle: ClassifyInput["open_items"] = [
  {
    expense_id: "e1",
    description: "Frita Batidos",
    expense_status: "finalized",
    my_share_status: "locked",
  },
];

describe("createClassify", () => {
  it("uses the stub when there is no TypeSafe key", () => {
    expect(createClassify({}).kind).toBe("stub");
  });

  it("uses Jev when TYPESAFE_API_KEY is set", () => {
    expect(createClassify({ TYPESAFE_API_KEY: "k" }).kind).toBe("jev");
  });

  it("gives every Jev request a deadline", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            answers: {
              intent: { choice: "expense", probabilities: { expense: 0.97 } },
            },
          }),
        ),
      );
    const { classify } = createClassify({ TYPESAFE_API_KEY: "k" });
    await expect(classify(input(text("got groceries, $63")))).resolves.toEqual({
      intent: "expense",
      confidence: 0.97,
    });
    expect(spy.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
    spy.mockRestore();
  });
});

describe("the pre-filter in front of Jev", () => {
  const jevSays = () =>
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ answers: { intent: { choice: "ignore", probabilities: { ignore: 0.99 } } } })),
    );

  it("is on by default: chatter never reaches Jev and comes back marked", async () => {
    const spy = jevSays();
    const made = createClassify({ TYPESAFE_API_KEY: "k" });
    expect(made.prefilter).toBe(true);
    await expect(made.classify(input(text("who's driving")))).resolves.toEqual({
      intent: "ignore",
      confidence: 1,
      prefiltered: true,
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("sends everything to Jev when GATE_PREFILTER is off", async () => {
    const spy = jevSays();
    const made = createClassify({ TYPESAFE_API_KEY: "k", GATE_PREFILTER: "off" });
    expect(made.prefilter).toBe(false);
    await expect(made.classify(input(text("who's driving")))).resolves.toEqual({ intent: "ignore", confidence: 0.99 });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("is not used with the stub, which is free", () => {
    expect(createClassify({}).prefilter).toBe(false);
  });
});

describe("route with the stub gate", () => {
  const { classify } = createClassify({});

  it("acts on a clear text expense", async () => {
    await expect(
      route(classify, input(text("got groceries, $63"))),
    ).resolves.toMatchObject({
      intent: "expense",
      decision: "act",
    });
  });

  it("acts on a text approval only when the sender has a settle request", async () => {
    await expect(
      route(classify, input(text("yes"), settle)),
    ).resolves.toMatchObject({ intent: "approval", decision: "act" });
    // The stub reads a lone "yes" as a possible name; what matters is that it never approves.
    const plain = await route(classify, input(text("yes")));
    expect(plain.intent === "approval" && plain.decision === "act").toBe(false);
  });

  it("never acts on reactions, which route deterministically per SPEC 6.2", async () => {
    const reaction: GateMessage = {
      sender_phone: PHONES.Kian,
      is_dm: false,
      kind: "reaction",
      reply_to_id: "m1",
    };
    await expect(
      route(classify, input(reaction, settle)),
    ).resolves.toMatchObject({ decision: "ignore" });
  });
});

describe("withTab", () => {
  it("adds Tab to the members once", () => {
    const once = withTab(input(text("hi")));
    expect(once.members[0]).toEqual({ phone: "tab", name: "Tab" });
    expect(withTab(once).members.filter((m) => m.phone === "tab")).toHaveLength(
      1,
    );
  });
});
