export interface PipelineResult {
  pipeline: "raw" | "semantic";
  answer: string;
  sql: string | null;
  metrics_used: string[];
  source_tables: string[];
  rows_scanned: number;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  sql_success: boolean;
  sql_error: string | null;
  schema_hallucination: boolean;
  permission_violation: boolean;
  returned_value: number | null;
  rows: Record<string, unknown>[];
}
