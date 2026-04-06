import { buildTrialsResponse, fetchAllStudies } from "@/lib/clinicaltrials";
import { isSearchStrategy } from "@/lib/searchStrategy";
import type { TrialsApiError, TrialsRequest } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request): Promise<Response> {
  let body: TrialsRequest;
  try {
    body = (await req.json()) as TrialsRequest;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.strategy || !isSearchStrategy(body.strategy)) {
    return Response.json({ error: "invalid_body", message: "valid strategy required" }, { status: 400 });
  }

  const { studies, capped, fetchError } = await fetchAllStudies(body.strategy);
  if (fetchError) {
    const err: TrialsApiError = {
      error: "clinicaltrials_api",
      status: fetchError.status,
      message: fetchError.message,
    };
    return Response.json(err, { status: 502 });
  }

  const response = buildTrialsResponse(body.strategy, studies, capped);
  return Response.json(response);
}
