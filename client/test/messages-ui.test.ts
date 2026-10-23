import { expect, test } from "bun:test";
import { NotNewestError, NotSentError, titleFits, twoStep, withChatTitle } from "../src/messages-ui.ts";

const VEGAS = { name: "Vegas Trip 26", handles: ["+14083103927", "+16692612230", "+14436367028", "+16692610502"] };

test("a chat's own name fits", () => {
  expect(titleFits("Vegas Trip 26", VEGAS)).toBe(true);
});

test("Messages listing the members fits, names and numbers mixed (Tab's Mac, macOS 26)", () => {
  expect(titleFits("Maybe: Harjyot Sahni, +1 (408) 310-3927, +1 (669) 261-2230 & +1 (443) 636-7028", VEGAS)).toBe(true);
  expect(titleFits("+1 (408) 310-3927, +1 (669) 261-2230, +1 (443) 636-7028 & +1 (669) 261-0502", VEGAS)).toBe(true);
});

test("someone else's number, or the wrong count, doesn't fit", () => {
  expect(titleFits("Maybe: Harjyot Sahni, +1 (408) 310-9999, +1 (669) 261-2230 & +1 (443) 636-7028", VEGAS)).toBe(false);
  expect(titleFits("Harjyot Sahni & +1 (408) 310-3927", VEGAS)).toBe(false);
  expect(titleFits("Messages", VEGAS)).toBe(false);
  expect(titleFits("", VEGAS)).toBe(false);
});

test("a DM fits by its one number, email, or a name for it", () => {
  const dm = { name: null, handles: ["+16692610502"] };
  expect(titleFits("+1 (669) 261-0502", dm)).toBe(true);
  expect(titleFits("Maybe: Harjyot Sahni", dm)).toBe(true);
  expect(titleFits("+1 (669) 261-2230", dm)).toBe(false);
  expect(titleFits("a@b.com", { name: null, handles: ["a@b.com"] })).toBe(true);
  expect(titleFits("c@d.com", { name: null, handles: ["a@b.com"] })).toBe(false);
  expect(titleFits("the house", dm)).toBe(false); // another chat's name
  expect(titleFits("Sam Lee & Joe Park", { name: null, handles: ["+15555550101", "+15555550102"] })).toBe(false);
});

test("a chat's title is read once, then reused while it fits, and read again when it's stale", async () => {
  const fits = (t: string) => titleFits(t, VEGAS);
  const seen: string[] = [];
  let peeks = 0;
  let window = "Maybe: Harjyot Sahni, +1 (408) 310-3927, +1 (669) 261-2230 & +1 (443) 636-7028";
  const peek = async () => (peeks++, window);
  const act = async (title: string) => {
    if (title !== window) throw new NotSentError("NOT_SENT: title changed");
    seen.push(title);
  };
  await withChatTitle("g1", fits, act, peek);
  await withChatTitle("g2", fits, act, peek);
  expect(peeks).toBe(1);
  window = "Vegas Trip 26"; // someone saved the group's name
  await withChatTitle("g3", fits, act, peek);
  expect(peeks).toBe(2);
  expect(seen).toEqual([seen[0]!, seen[0]!, "Vegas Trip 26"]);
  // A title for another chat is never used for this one.
  await expect(withChatTitle("x", (t) => t === "the house", act, async () => "Vegas Trip 26")).rejects.toBeInstanceOf(NotSentError);
});

test("a message that arrives while the picker opens cancels the action, and nothing is pressed", async () => {
  const ran: string[] = [];
  let dismissed = 0;
  const run = async (lines: string[]) => void ran.push(lines === steps.open ? "open" : "finish");
  const steps = { open: ["-e", "open"], finish: ["-e", "finish"] };
  const dismiss = async () => void dismissed++;
  await twoStep(steps, { guid: "g", title: "Vegas Trip 26" }, () => true, run, dismiss);
  expect(ran).toEqual(["open", "finish"]);
  ran.length = 0;
  const err = await twoStep(steps, { guid: "g", title: "Vegas Trip 26", text: "who rode?" }, () => false, run, dismiss).catch((e) => e);
  expect(err).toBeInstanceOf(NotNewestError);
  expect(err).toBeInstanceOf(NotSentError); // the bridge falls back to a normal send
  expect(ran).toEqual(["open"]);
  expect(dismissed).toBe(1);
});

test("a newer message doesn't make the title be read again", async () => {
  let peeks = 0;
  const fits = (t: string) => t === "Vegas Trip 26";
  const peek = async () => (peeks++, "Vegas Trip 26");
  await withChatTitle("g", fits, async () => {}, peek); // remember the title
  peeks = 0;
  const err = await withChatTitle("g", fits, async () => { throw new NotNewestError("newer"); }, peek).catch((e) => e);
  expect(err).toBeInstanceOf(NotNewestError);
  expect(peeks).toBe(0);
});
