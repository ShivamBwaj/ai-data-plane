import { config } from "dotenv";
config({ path: ".env.local" });
import { writeFileSync, mkdirSync } from "fs";
import path from "path";

const TARGET_N = Number(process.argv[2] ?? 500);

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cartesian(params: { name: string; values: readonly string[] }[]): Record<string, string>[] {
  return params.reduce<Record<string, string>[]>(
    (acc, p) => acc.flatMap((combo) => p.values.map((v) => ({ ...combo, [p.name]: v }))),
    [{}]
  );
}

async function main() {
  const { METRIC_TEMPLATES } = await import("../src/lib/semantic/metrics");
  const { computeExpectedValue } = await import("../src/lib/semantic/ground-truth");
  const { sqlReadonly } = await import("../src/lib/db");

  const pools = METRIC_TEMPLATES.map((t) => ({
    template: t,
    combos: shuffle(cartesian(t.params)),
    taken: 0,
  }));

  const selected: { templateId: string; params: Record<string, string> }[] = [];
  let progressed = true;
  while (selected.length < TARGET_N && progressed) {
    progressed = false;
    for (const pool of pools) {
      if (selected.length >= TARGET_N) break;
      if (pool.taken < pool.combos.length) {
        selected.push({ templateId: pool.template.id, params: pool.combos[pool.taken] });
        pool.taken++;
        progressed = true;
      }
    }
  }

  console.log(`Selected ${selected.length} (template, params) combinations across ${METRIC_TEMPLATES.length} templates.`);
  console.log("Computing ground-truth expected values against the database...");

  const questions = [];
  let i = 0;
  for (const s of selected) {
    i++;
    const t = METRIC_TEMPLATES.find((t) => t.id === s.templateId)!;
    const expectedValue = await computeExpectedValue(s.templateId, s.params);
    questions.push({
      id: `q${i}`,
      templateId: s.templateId,
      metricName: t.metricName,
      params: s.params,
      question: t.question(s.params),
      expectedValue,
      requiredTables: t.requiredTables,
    });
    if (i % 50 === 0) console.log(`  ${i}/${selected.length}`);
  }

  const outDir = path.join(process.cwd(), "benchmark");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "questions.json");
  writeFileSync(outPath, JSON.stringify(questions, null, 2));
  console.log(`Wrote ${questions.length} questions to ${outPath}`);

  await sqlReadonly.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
