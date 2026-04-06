import { handleAgentRequest } from "@/lib/agentRunner";
import type { AgentRequest } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request): Promise<Response> {
  let body: AgentRequest;
  try {
    body = (await req.json()) as AgentRequest;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.messages || !Array.isArray(body.messages)) {
    return Response.json({ error: "invalid_body", message: "messages array required" }, { status: 400 });
  }
  return handleAgentRequest(body);
}
