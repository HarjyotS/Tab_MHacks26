import { describe, expect, test } from "bun:test";
import {
  appleDate,
  cleanText,
  decodeAttributedBody,
  messageText,
  normalizeHandle,
  reactionTarget,
  tapback,
} from "../src/decode.ts";
import { appleNs, ATTRIBUTED_BODIES } from "./helpers.ts";

describe("decodeAttributedBody", () => {
  test("reads a short body", () => {
    expect(decodeAttributedBody(ATTRIBUTED_BODIES[0]!)).toBe("got groceries, $63");
  });

  test("reads a body over 127 bytes with emoji (uint16 length)", () => {
    expect(decodeAttributedBody(ATTRIBUTED_BODIES[1]!)).toBe(`Frita Batidos 🍔 split it — ${"long text ".repeat(20)}`);
  });

  test("reads a uint32 length", () => {
    const text = "y".repeat(70_000);
    const len = Buffer.alloc(4);
    len.writeUInt32LE(text.length);
    const blob = Buffer.concat([Buffer.from("\x04\x0bstreamtyped NSString\x01\x95\x84\x01+\x82", "latin1"), len, Buffer.from(text)]);
    expect(decodeAttributedBody(blob)).toBe(text);
  });

  test("returns null for missing or malformed blobs", () => {
    expect(decodeAttributedBody(null)).toBeNull();
    expect(decodeAttributedBody(Buffer.from("no string class here"))).toBeNull();
    expect(decodeAttributedBody(Buffer.from("NSString\x01\x95\x84\x01+\x40short", "latin1"))).toBeNull();
  });
});

test("messageText prefers text, falls back to attributedBody, and strips attachment markers", () => {
  expect(messageText({ text: "hi", attributedBody: ATTRIBUTED_BODIES[0]! })).toBe("hi");
  expect(messageText({ text: null, attributedBody: ATTRIBUTED_BODIES[0]! })).toBe("got groceries, $63");
  expect(cleanText("￼ receipt\r\n")).toBe("receipt");
});

test("tapback maps only classic tapback adds", () => {
  expect(tapback(2001)).toBe("like");
  expect(tapback(2002)).toBe("dislike");
  expect(tapback(2005)).toBe("question");
  expect(tapback(3001)).toBeNull(); // removed like
  expect(tapback(2006)).toBeNull(); // emoji tapback
  expect(tapback(0)).toBeNull();
});

test("reactionTarget strips part prefixes", () => {
  expect(reactionTarget("p:0/ABC-123")).toBe("ABC-123");
  expect(reactionTarget("bp:ABC-123")).toBe("ABC-123");
  expect(reactionTarget(null)).toBeNull();
});

test("appleDate converts nanoseconds since 2001", () => {
  const when = new Date("2026-10-03T19:30:00Z");
  expect(appleDate(appleNs(when)).toISOString()).toBe(when.toISOString());
});

test("normalizeHandle produces E.164 for US numbers and lowercases emails", () => {
  expect(normalizeHandle("+17345550123")).toBe("+17345550123");
  expect(normalizeHandle("(734) 555-0123")).toBe("+17345550123");
  expect(normalizeHandle("17345550123")).toBe("+17345550123");
  expect(normalizeHandle("Jake@Example.com")).toBe("jake@example.com");
});
