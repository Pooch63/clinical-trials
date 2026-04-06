/**
 * Anthropic Messages API — the only place that calls the LLM (`client.messages.create`).
 * Extended thinking, web search, and `submit_search_strategy` tool are configured here.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages";
import type { RawMessageStreamEvent } from "@anthropic-ai/sdk/resources/messages/messages";
import { AGENT_SYSTEM_PROMPT } from "@/lib/agentPrompt";
import { isSearchStrategy, parseStrategyFromText } from "@/lib/searchStrategy";
import type { SearchStrategy } from "@/types";

export const STRATEGY_TOOL_NAME = "submit_search_strategy";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export function getAnthropicModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

export function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

const searchStrategyTool: Tool = {
  name: STRATEGY_TOOL_NAME,
  description:
    "Submit a complete ClinicalTrials.gov search strategy when you have enough context. Do not call when asking clarifying questions.",
  input_schema: {
    type: "object",
    properties: {
      conditions_query: { type: "string" },
      broader_term_query: {},
      statuses: { type: "array", items: { type: "string" } },
      phases: {},
      intervention_types: {},
      study_types: {},
      priority_scoring_hints: { type: "object" },
      rationale: { type: "string" },
    },
    required: [
      "conditions_query",
      "broader_term_query",
      "statuses",
      "phases",
      "intervention_types",
      "study_types",
      "priority_scoring_hints",
      "rationale",
    ],
  },
};

function agentTools(): Anthropic.ToolUnion[] {
  return [
    { type: "web_search_20250305", name: "web_search", max_uses: 10 },
    searchStrategyTool,
  ];
}

const sharedAgentParams = () => ({
  model: getAnthropicModel(),
  max_tokens: 16384 as const,
  system: AGENT_SYSTEM_PROMPT,
  thinking: { type: "enabled" as const, budget_tokens: 10000 },
  tools: agentTools(),
});

type BlockKind = "thinking" | "text" | "strategy_tool" | "server" | "other";

function classifyBlock(block: unknown): BlockKind {
  const b = block as { type: string; name?: string };
  if (b.type === "thinking" || b.type === "redacted_thinking") return "thinking";
  if (b.type === "server_tool_use") return "server";
  if (b.type === "web_search_tool_result") return "server";
  if (b.type === "tool_use" && b.name === STRATEGY_TOOL_NAME) return "strategy_tool";
  if (b.type === "text") return "text";
  return "other";
}

export type AgentLlmOutcome =
  | { outcome: "strategy"; strategy: SearchStrategy }
  | { outcome: "text"; text: string }
  | { outcome: "malformed"; raw: string };

/**
 * Primary path: streaming Messages request; consumes SSE until completion and
 * returns structured outcome (strategy tool, plain text, or malformed).
 */
export async function queryAgentLlmStreaming(
  client: Anthropic,
  messages: MessageParam[],
): Promise<AgentLlmOutcome> {
  const stream = await client.messages.create({
    ...sharedAgentParams(),
    messages,
    stream: true,
  });

  let mode: "pending" | "text" | "strategy" = "pending";
  const blockKind = new Map<number, BlockKind>();
  let textAccum = "";
  let strategyJsonAccum = "";

  for await (const event of stream as AsyncIterable<RawMessageStreamEvent>) {
    if (event.type === "content_block_start") {
      const kind = classifyBlock(event.content_block);
      blockKind.set(event.index, kind);
      const block = event.content_block as { type: string; name?: string };
      if (block.type === "tool_use" && block.name === STRATEGY_TOOL_NAME) {
        if (mode === "pending") mode = "strategy";
      } else if (block.type === "text") {
        if (mode === "pending") mode = "text";
      }
    } else if (event.type === "content_block_delta") {
      const kind = blockKind.get(event.index);
      if (event.delta.type === "text_delta" && kind === "text" && mode === "text") {
        textAccum += event.delta.text;
      } else if (event.delta.type === "input_json_delta" && kind === "strategy_tool") {
        strategyJsonAccum += event.delta.partial_json;
      }
    }
  }

  if (mode === "strategy") {
    try {
      const parsed = strategyJsonAccum.trim() ? JSON.parse(strategyJsonAccum) : null;
      if (parsed && isSearchStrategy(parsed)) {
        return { outcome: "strategy", strategy: parsed };
      }
    } catch {
      /* fall through */
    }
    return { outcome: "malformed", raw: strategyJsonAccum || textAccum };
  }

  const trimmed = textAccum.trim();
  const fromText = parseStrategyFromText(trimmed);
  if (fromText) return { outcome: "strategy", strategy: fromText };
  if (trimmed) return { outcome: "text", text: textAccum };
  return { outcome: "malformed", raw: textAccum };
}

/**
 * Fallback when streaming parse fails: non-streaming `messages.create` with the same params.
 */
export async function queryAgentLlmNonStreaming(
  client: Anthropic,
  messages: MessageParam[],
): Promise<AgentLlmOutcome> {
  const msg = await client.messages.create({
    ...sharedAgentParams(),
    messages,
  });

  let strategyInput: unknown;
  let textParts = "";

  for (const block of msg.content) {
    if (block.type === "tool_use" && block.name === STRATEGY_TOOL_NAME) {
      strategyInput = block.input;
    } else if (block.type === "text") {
      textParts += block.text;
    }
  }

  if (strategyInput !== undefined && isSearchStrategy(strategyInput)) {
    return { outcome: "strategy", strategy: strategyInput };
  }

  const fromText = parseStrategyFromText(textParts.trim());
  if (fromText) return { outcome: "strategy", strategy: fromText };
  if (textParts.trim()) return { outcome: "text", text: textParts };
  return { outcome: "malformed", raw: textParts };
}
