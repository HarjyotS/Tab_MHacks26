import { expect, test } from "bun:test";
import { titleFits } from "../src/messages-ui.ts";

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
