import { expect, test } from "bun:test";
import { NotSentError } from "../src/messages-ui.ts";
import { attempts, classicFor } from "../src/reactions.ts";
import { axTapbacker, uiTapbacker } from "../src/tapback.ts";

const bubble = { text: "sent you 30", sentAt: new Date(1792789256_000), fromMe: false };
const fits = (title: string) => title === "Vegas Trip 26";

test("tab-ax gets the bubble and every action to try, the stand-ins after the emoji", async () => {
  const calls: string[][] = [];
  const t = axTapbacker(async (args) => (calls.push(args), "💸"), async () => "Vegas Trip 26");
  expect(t.anyMessage).toBe(true);
  await t.react("G1", "🤑", fits, "chat", undefined, bubble);
  expect(calls).toEqual([["react", "G1", "Vegas Trip 26", "sent you 30", "1792789256", "0", "🤑", "💸", "Heart"]]);
  expect(t.attempts?.("🤑")).toEqual(["🤑", "💸", "love"]);
  await t.react("G2", "question", fits, "chat", undefined, { ...bubble, fromMe: true });
  expect(calls[1]!.slice(5)).toEqual(["1", "Question mark"]);
});

test("tab-ax saying nothing happened is NOT_SENT, after one fresh look at the window", async () => {
  let peeks = 0;
  let runs = 0;
  const t = axTapbacker(
    async () => {
      runs++;
      throw new NotSentError("NOT_SENT: 0 bubbles with that text");
    },
    async () => (peeks++, "Vegas Trip 26"),
  );
  await expect(t.react("G3", "👀", fits, "chat", undefined, bubble)).rejects.toBeInstanceOf(NotSentError);
  expect(runs).toBeGreaterThanOrEqual(1);
  expect(peeks).toBeLessThanOrEqual(1);
});

test("without the bubble's text tab-ax can't find it, so nothing goes out", async () => {
  const t = axTapbacker(async () => "Thumbs up", async () => "Vegas Trip 26");
  await expect(t.react("G4", "like", fits, "chat")).rejects.toBeInstanceOf(NotSentError);
});

test("👀 has no stand-in; the others end with a classic tapback", () => {
  expect(attempts("👀")).toEqual(["👀"]);
  expect(attempts("🫡")).toEqual(["🫡", "like"]);
  expect(attempts("like")).toEqual(["like"]);
  expect(classicFor("🎉")).toBe("love");
  expect(classicFor("👀")).toBeUndefined();
});

test("the picker sends an emoji's classic stand-in, and refuses 👀", async () => {
  const t = uiTapbacker();
  expect(t.attempts?.("💸")).toEqual(["love"]);
  expect(t.attempts?.("👀")).toEqual([]);
  await expect(t.react("G5", "👀", fits)).rejects.toBeInstanceOf(NotSentError);
});
