// A small tool-calling loop over the same OpenAI-compatible client the rest
// of the backend uses (xAI). Grok may call read-only tools for a few rounds,
// then must answer through `reply({ text })`. Bounded by rounds and by a
// wall-clock deadline, since the processing loop waits on it.
import type {
  ChatCompletionFunctionTool,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { ChatClient } from "./structured.js";

export type Tool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => unknown;
};

export type ToolCallRecord = { name: string; args: Record<string, unknown>; output: string };

export type LoopResult = {
  text: string | null;
  // replied: Grok answered; forced: it answered when told to; timeout and
  // error: no answer.
  outcome: "replied" | "forced" | "timeout" | "error";
  rounds: number;
  calls: ToolCallRecord[];
  // The conversation so far, to continue it (a retry with feedback).
  messages: ChatCompletionMessageParam[];
  reply_call_id?: string;
  error?: string;
};

export const REPLY_TOOL = "reply";
export const MAX_ROUNDS = 5;
const MAX_OUTPUT_CHARS = 8_000;

const REPLY: ChatCompletionFunctionTool = {
  type: "function",
  function: {
    name: REPLY_TOOL,
    description: "Send your final answer to the chat. Call this exactly once, when you're done looking things up.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["text"],
      properties: { text: { type: "string", description: "The message to send, as plain text." } },
    },
  },
};

const asTool = (t: Tool): ChatCompletionFunctionTool => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.parameters },
});

function parseArgs(raw: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export async function runTools(opts: {
  client: ChatClient;
  model: string;
  messages: ChatCompletionMessageParam[];
  tools: Tool[];
  deadline: number; // epoch ms
  clock?: () => number;
  maxRounds?: number;
}): Promise<LoopResult> {
  const clock = opts.clock ?? Date.now;
  const maxRounds = opts.maxRounds ?? MAX_ROUNDS;
  const messages = [...opts.messages];
  const calls: ToolCallRecord[] = [];
  const done = (r: Omit<LoopResult, "calls" | "messages">): LoopResult => ({ ...r, calls, messages });

  for (let round = 0; ; round++) {
    // Out of rounds: one last call that can only answer.
    const force = round >= maxRounds;
    const remaining = opts.deadline - clock();
    if (remaining <= 0) return done({ text: null, outcome: "timeout", rounds: round });
    let message;
    try {
      const res = await opts.client.chat.completions.create(
        {
          model: opts.model,
          temperature: 0,
          messages,
          tools: force ? [REPLY] : [...opts.tools.map(asTool), REPLY],
          tool_choice: force ? { type: "function", function: { name: REPLY_TOOL } } : "auto",
        },
        { timeout: remaining, maxRetries: 0 },
      );
      message = res.choices[0]?.message;
    } catch (err) {
      const timedOut = clock() >= opts.deadline || /timed? ?out|abort/i.test(String(err));
      return done({ text: null, outcome: timedOut ? "timeout" : "error", rounds: round, error: String(err).slice(0, 300) });
    }
    if (!message) return done({ text: null, outcome: "error", rounds: round, error: "empty response" });

    const toolCalls = (message.tool_calls ?? []).filter(
      (c): c is ChatCompletionMessageFunctionToolCall => c.type === "function",
    );
    // Plain text instead of a reply call is still an answer.
    if (toolCalls.length === 0) {
      messages.push({ role: "assistant", content: message.content ?? "" });
      const text = message.content?.trim() || null;
      return done({ text, outcome: text ? (force ? "forced" : "replied") : "error", rounds: round, ...(text ? {} : { error: "no answer" }) });
    }
    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: toolCalls });

    const reply = toolCalls.find((c) => c.function.name === REPLY_TOOL);
    if (reply) {
      // Every tool call needs a result before the conversation can go on
      // (a retry with feedback): the ones sent alongside reply aren't run.
      for (const c of toolCalls)
        if (c !== reply) messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify({ error: "Not run: you already replied." }) });
      const text = parseArgs(reply.function.arguments)?.text;
      const ok = typeof text === "string" && text.trim() !== "";
      return done({
        text: ok ? text.trim() : null,
        outcome: ok ? (force ? "forced" : "replied") : "error",
        rounds: round,
        reply_call_id: reply.id,
        ...(ok ? {} : { error: "reply without text" }),
      });
    }
    if (force) return done({ text: null, outcome: "error", rounds: round, error: "no reply when forced" });

    for (const c of toolCalls) {
      const tool = opts.tools.find((t) => t.name === c.function.name);
      const args = parseArgs(c.function.arguments);
      let output: string;
      if (!tool) output = JSON.stringify({ error: `No tool named ${c.function.name}` });
      else if (!args) output = JSON.stringify({ error: "Arguments must be a JSON object" });
      else {
        try {
          output = JSON.stringify((await tool.run(args)) ?? null);
        } catch (err) {
          output = JSON.stringify({ error: String(err).slice(0, 200) });
        }
      }
      if (output.length > MAX_OUTPUT_CHARS) output = `${output.slice(0, MAX_OUTPUT_CHARS)}…(cut)`;
      if (tool && args) calls.push({ name: tool.name, args, output });
      messages.push({ role: "tool", tool_call_id: c.id, content: output });
    }
  }
}

// The conversation with a rejected answer and why, ready for another try.
export function withFeedback(r: LoopResult, feedback: string): ChatCompletionMessageParam[] {
  return r.reply_call_id
    ? [...r.messages, { role: "tool", tool_call_id: r.reply_call_id, content: feedback }]
    : [...r.messages, { role: "user", content: feedback }];
}
