import type { Subprocess } from "bun";
import { NotSentError } from "./messages-ui.ts";
import type { Replier } from "./reply.ts";
import type { Tapbacker } from "./tapback.ts";
import { isTabEmoji } from "./reactions.ts";
import type { ClassicReaction } from "./types.ts";

/**
 * imsg (github.com/openclaw/imsg) talks to Messages through a helper injected
 * into Messages.app (`imsg launch`, SIP off), so tapbacks and threaded replies
 * target a message by its guid: any message, not just the newest, and no
 * window clicking. One long-running `imsg rpc` child speaks JSON-RPC 2.0, one
 * object per line.
 */
export class ImsgRpc {
  private child: Subprocess<"pipe", "pipe", "pipe"> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(
    private readonly path: string,
    private readonly log: (line: string) => void,
  ) {}

  private start(): Subprocess<"pipe", "pipe", "pipe"> {
    if (this.child && this.child.exitCode === null) return this.child;
    const child = Bun.spawn([this.path, "rpc"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    this.child = child;
    void this.read(child);
    void child.exited.then((code) => {
      if (this.child === child) this.child = null;
      for (const [, p] of this.pending) p.reject(new Error(`imsg rpc exited (${code})`));
      this.pending.clear();
    });
    return child;
  }

  private async read(child: Subprocess<"pipe", "pipe", "pipe">) {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of child.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let msg: { id?: number; result?: unknown; error?: ImsgError };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (typeof msg.id !== "number") continue; // notifications: not used
        const p = this.pending.get(msg.id);
        if (!p) continue;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new ImsgCallError(msg.error));
        else p.resolve(msg.result);
      }
    }
  }

  request<T = unknown>(method: string, params: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
    const child = this.start();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`imsg ${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      child.stdin.flush();
    });
  }

  /** Whether the injected helper is up and offers these methods. */
  async ready(methods: string[]): Promise<{ ok: boolean; why?: string }> {
    try {
      const s = await this.request<{ bridge?: { ready?: boolean; error?: string }; methods?: string[] }>("status", {}, 10_000);
      if (!s.bridge?.ready) return { ok: false, why: s.bridge?.error ?? "the imsg bridge isn't running (imsg launch)" };
      const missing = methods.filter((m) => !s.methods?.includes(m));
      return missing.length ? { ok: false, why: `imsg can't ${missing.join(", ")} on this Mac` } : { ok: true };
    } catch (err) {
      return { ok: false, why: String(err) };
    }
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
  }
}

type ImsgError = { code: number; message: string; data?: { disposition?: string; retry_safe?: boolean } | string };

export class ImsgCallError extends Error {
  constructor(readonly error: ImsgError) {
    super(`imsg error ${error.code}: ${error.message}`);
  }

  /** imsg proves nothing went out: safe to fall back or retry. */
  get notStarted(): boolean {
    const data = this.error.data;
    if (typeof data === "object" && data) return data.disposition === "not_started" || data.retry_safe === true;
    // Bad params and unknown methods never dispatch.
    return [-32600, -32601, -32602, -32003].includes(this.error.code);
  }
}

// imsg's classic reaction names. An emoji goes as itself (a custom emoji tapback).
const KIND: Record<ClassicReaction, string> = {
  love: "love",
  like: "like",
  dislike: "dislike",
  laugh: "laugh",
  emphasize: "emphasis",
  question: "question",
};

const notSent = (err: unknown) => (err instanceof ImsgCallError && err.notStarted ? new NotSentError(err.message) : err);

/** Tapbacks through the imsg helper: by guid, on any message in the chat. */
export function imsgTapbacker(rpc: ImsgRpc): Tapbacker {
  return {
    anyMessage: true,
    async react(targetGuid, reaction, _fits, chatGuid) {
      if (!chatGuid) throw new NotSentError("NOT_SENT: imsg needs the chat's guid");
      await rpc.request("tapback", { chat_guid: chatGuid, message_guid: targetGuid, reaction: isTabEmoji(reaction) ? reaction : KIND[reaction] }).catch((err) => {
        throw notSent(err);
      });
    },
  };
}

/** Threaded replies through the imsg helper: onto any message, by guid. */
export function imsgReplier(rpc: ImsgRpc): Replier {
  return {
    anyMessage: true,
    async reply(targetGuid, text, _fits, chatGuid) {
      if (!chatGuid) throw new NotSentError("NOT_SENT: imsg needs the chat's guid");
      // imsg refuses (not_started) rather than sending outside the thread when
      // it can't find the parent, so the bridge can fall back to a normal send.
      await rpc.request("send.rich", { chat_guid: chatGuid, text, reply_to: targetGuid }, 30_000).catch((err) => {
        throw notSent(err);
      });
    },
  };
}
