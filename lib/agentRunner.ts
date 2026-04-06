import type { AgentJsonError, AgentRequest, ConversationMessage } from "@/types";
import {
  createAnthropicClient,
  queryAgentLlmNonStreaming,
  queryAgentLlmStreaming,
} from "@/lib/llm";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

/** Strip non-text blocks from assistant history if stored as JSON block array. */
export function sanitizeMessagesForApi(
  messages: ConversationMessage[],
): ConversationMessage[] {
  return messages.map((m) => {
    if (m.role !== "assistant") return m;
    const raw = m.content.trim();
    if (!raw.startsWith("[")) return m;
    try {
      const blocks = JSON.parse(raw) as unknown;
      if (!Array.isArray(blocks)) return m;
      const textOnly = blocks
        .filter(
          (b) =>
            b &&
            typeof b === "object" &&
            (b as { type?: string }).type === "text",
        )
        .map((b) => String((b as { text?: string }).text ?? ""))
        .join("");
      return { role: "assistant", content: textOnly };
    } catch {
      return m;
    }
  });
}

function toMessageParams(messages: ConversationMessage[]): MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

/** Readable stream that emits UTF-8 chunks (word-ish) for a smooth client UX. */
export function createChunkedTextStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const parts = text.split(/(\s+)/).filter(Boolean);
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= parts.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(parts[i]));
      i += 1;
    },
  });
}

export async function handleAgentRequest(body: AgentRequest): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "configuration", message: "ANTHROPIC_API_KEY is not set" },
      { status: 500 },
    );
  }

  const client = createAnthropicClient(apiKey);
  const messages = toMessageParams(sanitizeMessagesForApi(body.messages ?? []));

  let result = await queryAgentLlmStreaming(client, messages);

  if (result.outcome === "malformed") {
    result = await queryAgentLlmNonStreaming(client, messages);
  }

  if (process.env.AGENT_DEBUG === "1") {
    if (result.outcome === "strategy") {
      console.log(
        "[agent:strategy]",
        JSON.stringify({
          rationale: result.strategy.rationale,
          conditions_query: result.strategy.conditions_query,
        }),
      );
    } else if (result.outcome === "text") {
      console.log("[agent:text]", result.text);
    } else {
      console.log("[agent:malformed]", result.raw);
    }
  }

  if (result.outcome === "malformed") {
    const err: AgentJsonError = {
      error: "agent_malformed_json",
      message: "The agent returned output that could not be parsed as a search strategy.",
      rawOutput: result.raw,
    };
    return Response.json(err, { status: 422 });
  }

  if (result.outcome === "strategy") {
    return Response.json(result.strategy, {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(createChunkedTextStream(result.text), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
