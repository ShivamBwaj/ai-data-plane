import { sqlReadonly } from "../db";
import { templateById } from "./metrics";

export async function computeExpectedValue(templateId: string, params: Record<string, string>): Promise<number> {
  const t = templateById(templateId);
  const sql = t.sql(params);
  const rows = (await sqlReadonly.unsafe(sql)) as unknown as Record<string, unknown>[];
  const raw = rows[0]?.value;
  const n = typeof raw === "string" ? Number(raw) : (raw as number);
  if (typeof n !== "number" || Number.isNaN(n)) {
    throw new Error(`Ground truth query for ${templateId} returned no numeric value: ${JSON.stringify(rows[0])}`);
  }
  return n;
}
