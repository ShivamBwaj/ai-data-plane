import { NextRequest, NextResponse } from "next/server";
import { runSemanticPipeline } from "@/lib/pipelines/semantic-pipeline";
import { runRawPipeline } from "@/lib/pipelines/raw-pipeline";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const mode: "raw" | "semantic" | "both" = body?.mode ?? "both";
  const role: string = body?.role ?? "admin";

  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  try {
    const [semantic, raw] = await Promise.all([
      mode === "raw" ? null : runSemanticPipeline(question, role),
      mode === "semantic" ? null : runRawPipeline(question),
    ]);

    return NextResponse.json({ question, role, semantic, raw });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
