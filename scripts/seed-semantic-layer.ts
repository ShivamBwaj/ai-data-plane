import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { sqlWriter } = await import("../src/lib/db");
  const { seedSemanticLayer } = await import("../src/lib/semantic/retrieval");
  const { ROLES } = await import("../src/lib/permissions");
  const { METRIC_TEMPLATES } = await import("../src/lib/semantic/metrics");

  const n = await seedSemanticLayer();
  console.log(`Embedded and stored ${n} semantic_entries rows.`);

  await sqlWriter`delete from access_roles`;
  for (const role of Object.values(ROLES)) {
    await sqlWriter`
      insert into access_roles (role, description, table_policy)
      values (${role.id}, ${role.description}, ${sqlWriter.json(JSON.parse(JSON.stringify(role)))})
    `;
  }
  console.log(`Stored ${Object.keys(ROLES).length} access_roles rows.`);

  await sqlWriter`delete from metric_templates`;
  for (const t of METRIC_TEMPLATES) {
    const sampleParams = Object.fromEntries(t.params.map((p) => [p.name, p.values[0]]));
    await sqlWriter`
      insert into metric_templates (metric_name, question_template, sql_template, params)
      values (${t.metricName}, ${t.question(sampleParams)}, ${t.sql(sampleParams)}, ${sqlWriter.json(t.params)})
    `;
  }
  console.log(`Stored ${METRIC_TEMPLATES.length} metric_templates rows.`);

  await sqlWriter.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
