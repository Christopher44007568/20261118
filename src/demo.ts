import { buildExecutionPlan } from "./checker.ts";
import { allScenarios } from "./scenarios.ts";

for (const scenario of allScenarios) {
  const result = buildExecutionPlan(scenario.graph);
  console.log(`\n[${scenario.id}] ${scenario.title}`);

  if (!result.ok) {
    console.log("REJECTED");
    for (const item of result.diagnostics) {
      console.log(`  ${item.code}: ${item.nodePath.join(" -> ")}`);
      console.log(`  ${item.message}`);
    }
    continue;
  }

  const { plan } = result;
  console.log(`order: ${plan.order.join(" -> ")}`);
  console.log(
    `waves: ${plan.waves.map((wave) => `{${wave.join(", ")}}`).join(" -> ")}`,
  );

  const textureBarriers = plan.barriers.filter(
    (barrier) => barrier.type === "textureBarrier",
  ).length;
  const bufferBarriers = plan.barriers.length - textureBarriers;
  console.log(
    `barriers: ${textureBarriers} texture, ${bufferBarriers} buffer`,
  );
  for (const barrier of plan.barriers) {
    console.log(
      `  ${barrier.type} ${barrier.resourceId} ${barrier.from} -> ${barrier.to} [${barrier.reason}] before ${barrier.beforePass}`,
    );
  }

  const reused = plan.allocations.filter(
    (allocation) => allocation.aliasOf !== undefined,
  );
  if (reused.length === 0) {
    console.log("reuse: none");
  } else {
    for (const allocation of reused) {
      console.log(
        `reuse: ${allocation.resourceId} -> ${allocation.physicalSlot} generation ${allocation.generation} (after ${allocation.aliasOf})`,
      );
    }
  }
}
