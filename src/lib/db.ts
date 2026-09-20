import postgres from "postgres";

declare global {
  var __sqlReadonly: ReturnType<typeof postgres> | undefined;
  var __sqlWriter: ReturnType<typeof postgres> | undefined;
}

function client(url: string, statementTimeoutMs = 8000) {
  return postgres(url, {
    ssl: "require",
    max: 5,
    idle_timeout: 20,
    connection: { statement_timeout: statementTimeoutMs },
  });
}

// app_readonly role: the ONLY connection ever used to execute LLM-generated SQL.
// Grants SELECT on the five business tables and nothing else - a hard backstop
// beneath the semantic/permission layers in case they miss something.
export const sqlReadonly =
  globalThis.__sqlReadonly ?? (globalThis.__sqlReadonly = client(process.env.DATABASE_URL!));

// app_writer role: used only by our own code to log benchmark runs and maintain
// the semantic layer tables. Never used to run model-generated SQL.
export const sqlWriter =
  globalThis.__sqlWriter ?? (globalThis.__sqlWriter = client(process.env.DATABASE_WRITER_URL!));
