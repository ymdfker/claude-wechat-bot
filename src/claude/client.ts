import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool, MessageStreamEvent } from "@anthropic-ai/sdk/resources/messages";
import { loadConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaudeCallOptions {
  systemPrompt?: string;
  messages: MessageParam[];
  tools?: Tool[];
  maxTokens?: number;
  fast?: boolean;
  signal?: AbortSignal;
}

export interface ThinkingBlock {
  thinking: string;
  signature: string;
}

export interface ClaudeStreamResult {
  text: string;
  thinking: ThinkingBlock | null;
  toolCalls: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  stopReason: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) {
    const cfg = loadConfig();
    if (_client.baseURL !== cfg.baseUrl || _client.apiKey !== cfg.authToken) {
      _client = new Anthropic({ baseURL: cfg.baseUrl, apiKey: cfg.authToken });
    }
    return _client;
  }
  const cfg = loadConfig();
  _client = new Anthropic({ baseURL: cfg.baseUrl, apiKey: cfg.authToken });
  return _client;
}

export function resetClient(): void {
  _client = null;
}

// ---------------------------------------------------------------------------
// Non-streaming call
// ---------------------------------------------------------------------------

export async function callClaude(opts: ClaudeCallOptions): Promise<ClaudeStreamResult> {
  const cfg = loadConfig();
  const client = getClient();

  const response = await client.messages.create({
    model: opts.fast ? cfg.fastModel : cfg.model,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.systemPrompt ?? cfg.systemPrompt,
    messages: opts.messages,
    tools: opts.tools as any,
  });

  const textBlocks = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text);

  const thinkingBlocks = response.content
    .filter((c): c is Anthropic.ThinkingBlock => c.type === "thinking");

  const toolCalls = response.content
    .filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use")
    .map((c) => ({
      id: c.id,
      name: c.name,
      input: c.input as Record<string, unknown>,
    }));

  // Combine thinking blocks (only preserve the last one for simplicity — the API
  // requires all of them, but for storage we'll capture all)
  const thinking: ThinkingBlock | null = thinkingBlocks.length > 0
    ? {
        thinking: thinkingBlocks.map((t) => t.thinking).join("\n"),
        signature: thinkingBlocks[thinkingBlocks.length - 1]!.signature,
      }
    : null;

  return {
    text: textBlocks.join("\n"),
    thinking,
    toolCalls,
    stopReason: response.stop_reason ?? "unknown",
  };
}

// ---------------------------------------------------------------------------
// Streaming call
// ---------------------------------------------------------------------------

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking"; thinking: ThinkingBlock }
  | { type: "tool_use"; toolCall: { id: string; name: string; input: Record<string, unknown> } }
  | { type: "message_stop"; stopReason: string };

export async function* streamClaude(opts: ClaudeCallOptions): AsyncGenerator<StreamEvent> {
  const cfg = loadConfig();
  const client = getClient();

  const stream = client.messages.stream({
    model: opts.fast ? cfg.fastModel : cfg.model,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.systemPrompt ?? cfg.systemPrompt,
    messages: opts.messages,
    tools: opts.tools as any,
  });

  // Track active block being accumulated
  type PendingBlock =
    | { kind: "tool_use"; id: string; name: string; inputJson: string }
    | { kind: "thinking"; thinking: string; signature: string };

  let pending: PendingBlock | null = null;

  for await (const event of stream) {
    if (event.type === "content_block_start") {
      const block = event.content_block;
      if (block.type === "tool_use") {
        pending = { kind: "tool_use", id: block.id, name: block.name, inputJson: "" };
      } else if (block.type === "thinking") {
        pending = { kind: "thinking", thinking: block.thinking ?? "", signature: block.signature ?? "" };
      }
    } else if (event.type === "content_block_delta") {
      const delta = event.delta;
      if (delta.type === "text_delta") {
        yield { type: "text_delta", text: delta.text };
      } else if (delta.type === "input_json_delta" && pending?.kind === "tool_use") {
        pending.inputJson += delta.partial_json;
      } else if (delta.type === "thinking_delta" && pending?.kind === "thinking") {
        pending.thinking += delta.thinking;
      } else if (delta.type === "signature_delta" && pending?.kind === "thinking") {
        pending.signature += delta.signature;
      }
    } else if (event.type === "content_block_stop") {
      if (pending?.kind === "tool_use") {
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(pending.inputJson) as Record<string, unknown>; } catch { /* keep {} */ }
        yield { type: "tool_use", toolCall: { id: pending.id, name: pending.name, input } };
        pending = null;
      } else if (pending?.kind === "thinking") {
        yield { type: "thinking", thinking: { thinking: pending.thinking, signature: pending.signature } };
        pending = null;
      }
    } else if (event.type === "message_stop") {
      // Flush any incomplete block
      if (pending?.kind === "tool_use") {
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(pending.inputJson) as Record<string, unknown>; } catch { /* keep {} */ }
        yield { type: "tool_use", toolCall: { id: pending.id, name: pending.name, input } };
      } else if (pending?.kind === "thinking") {
        yield { type: "thinking", thinking: { thinking: pending.thinking, signature: pending.signature } };
      }
      pending = null;
      yield { type: "message_stop", stopReason: "end_turn" };
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

export function userMessage(text: string): MessageParam {
  return { role: "user", content: text };
}

export function assistantMessage(text: string, thinking?: ThinkingBlock): MessageParam {
  const content: any[] = [];
  if (thinking) {
    content.push({ type: "thinking", thinking: thinking.thinking, signature: thinking.signature });
  }
  content.push({ type: "text", text });
  return { role: "assistant", content };
}

export function toolResultMessage(toolUseId: string, content: string): MessageParam {
  return {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: toolUseId, content }],
  };
}
