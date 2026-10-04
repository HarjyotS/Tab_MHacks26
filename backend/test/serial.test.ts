import { describe, expect, it } from "vitest";
import { serial } from "../src/serial.js";

const tick = () => new Promise((r) => setTimeout(r, 1));

describe("serial", () => {
  it("never interleaves jobs, even when they await", async () => {
    const exclusive = serial();
    const order: string[] = [];
    const job = (name: string) => async () => {
      order.push(`${name} start`);
      await tick();
      order.push(`${name} end`);
    };
    await Promise.all([exclusive(job("a")), exclusive(job("b"))]);
    expect(order).toEqual(["a start", "a end", "b start", "b end"]);
  });

  it("keeps running jobs after one fails, and still reports the failure", async () => {
    const exclusive = serial();
    const failed = exclusive(async () => {
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");
    await expect(exclusive(async () => 2)).resolves.toBe(2);
  });
});
