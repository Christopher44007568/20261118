import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExecutionPlan,
  bufferFanInChain,
  concurrentWriteChain,
  dependencyCycleChain,
  readBeforeWriteChain,
  temporaryReuseChain,
  textureChain,
} from "../src/index.ts";
import type {
  AccessTrace,
  AnalysisResult,
  ExecutionPlan,
  PlanStep,
} from "../src/types.ts";

function expectPlan(result: AnalysisResult): ExecutionPlan {
  if (!result.ok) {
    assert.fail(`Expected a valid plan, got ${JSON.stringify(result.diagnostics)}`);
  }
  return result.plan;
}

function passStep(plan: ExecutionPlan, passId: string): Extract<PlanStep, { type: "pass" }> {
  const step = plan.steps.find(
    (candidate): candidate is Extract<PlanStep, { type: "pass" }> =>
      candidate.type === "pass" && candidate.passId === passId,
  );
  assert.ok(step, `Missing pass step for ${passId}`);
  return step;
}

function access(plan: ExecutionPlan, passId: string, resourceId: string): AccessTrace {
  const found = passStep(plan, passId).accesses.find(
    (candidate) => candidate.resourceId === resourceId,
  );
  assert.ok(found, `Missing ${resourceId} access in ${passId}`);
  return found;
}

test("normal chain 1: reorders a reverse-declared texture chain and inserts texture barriers", () => {
  const plan = expectPlan(buildExecutionPlan(textureChain.graph));

  assert.deepEqual(plan.order, [
    "render-scene",
    "blur",
    "composite",
    "tone-map",
    "present",
  ]);
  assert.deepEqual(plan.waves, [
    ["render-scene"],
    ["blur"],
    ["composite"],
    ["tone-map"],
    ["present"],
  ]);
  assert.ok(plan.barriers.every((barrier) => barrier.type === "textureBarrier"));

  const raw = plan.barriers.find(
    (barrier) =>
      barrier.beforePass === "present" &&
      barrier.resourceId === "final-color" &&
      barrier.reason === "RAW",
  );
  assert.ok(raw);
  assert.equal(raw.from, "storage");
  assert.equal(raw.to, "sampled");

  assert.deepEqual(access(plan, "render-scene", "scene-color"), {
    resourceId: "scene-color",
    mode: "write",
    state: "render-attachment",
    readVersion: null,
    writeVersion: 1,
  });
  assert.equal(access(plan, "tone-map", "final-color").readVersion, 1);
  assert.equal(access(plan, "tone-map", "final-color").writeVersion, 2);
  assert.equal(access(plan, "present", "final-color").readVersion, 2);
});

test("normal chain 2: reorders fan-in work and inserts buffer barriers", () => {
  const plan = expectPlan(buildExecutionPlan(bufferFanInChain.graph));

  assert.deepEqual(plan.order, ["fill-b", "fill-a", "reduce", "copy-out"]);
  assert.deepEqual(plan.waves, [["fill-b", "fill-a"], ["reduce"], ["copy-out"]]);
  assert.ok(plan.barriers.every((barrier) => barrier.type === "bufferBarrier"));

  const rawInputs = plan.barriers.filter(
    (barrier) => barrier.beforePass === "reduce" && barrier.reason === "RAW",
  );
  assert.deepEqual(
    rawInputs.map((barrier) => barrier.resourceId).sort(),
    ["particles-a", "particles-b"],
  );

  assert.equal(access(plan, "fill-b", "camera-uniform").readVersion, 0);
  assert.equal(access(plan, "reduce", "particles-b").readVersion, 1);
  assert.equal(access(plan, "copy-out", "reduced").readVersion, 1);
});

test("normal chain 3: reuses a transient slot only across an ordered lifetime boundary", () => {
  const plan = expectPlan(buildExecutionPlan(temporaryReuseChain.graph));
  const scratchA = plan.allocations.find(
    (allocation) => allocation.resourceId === "scratch-a",
  );
  const scratchB = plan.allocations.find(
    (allocation) => allocation.resourceId === "scratch-b",
  );

  assert.ok(scratchA);
  assert.ok(scratchB);
  assert.equal(scratchB.physicalSlot, scratchA.physicalSlot);
  assert.equal(scratchA.generation, 1);
  assert.equal(scratchB.generation, 2);
  assert.equal(scratchB.aliasOf, "scratch-a");

  const reuseBarrier = plan.barriers.find(
    (barrier) =>
      barrier.beforePass === "write-b" &&
      barrier.reason === "TEMPORARY_REUSE",
  );
  assert.ok(reuseBarrier);
  assert.equal(reuseBarrier.physicalSlot, scratchA.physicalSlot);
  assert.equal(reuseBarrier.generation, 2);
  assert.equal(reuseBarrier.aliasOf, "scratch-a");
  assert.equal(reuseBarrier.discardOldData, true);

  assert.equal(access(plan, "write-a", "scratch-a").writeVersion, 1);
  assert.equal(access(plan, "read-a", "scratch-a").readVersion, 1);
  assert.equal(access(plan, "write-b", "scratch-b").writeVersion, 1);
  assert.equal(access(plan, "read-b", "scratch-b").readVersion, 1);
});

test("ordered write-read-write-read versions produce RAW, WAR and RAW transitions", () => {
  const result = buildExecutionPlan({
    resources: [
      { id: "history", kind: "buffer", transient: true, layout: "buffer:128" },
    ],
    passes: [
      {
        id: "write-1",
        accesses: [{ resource: "history", mode: "write", usage: "storage" }],
      },
      {
        id: "read-1",
        dependsOn: ["write-1"],
        accesses: [{ resource: "history", mode: "read", usage: "storage" }],
      },
      {
        id: "write-2",
        dependsOn: ["read-1"],
        accesses: [{ resource: "history", mode: "write", usage: "storage" }],
      },
      {
        id: "read-2",
        dependsOn: ["write-2"],
        accesses: [{ resource: "history", mode: "read", usage: "storage" }],
      },
    ],
  });
  const plan = expectPlan(result);

  assert.deepEqual(
    plan.barriers.map((barrier) => barrier.reason),
    ["INITIALIZE", "RAW", "WAR", "RAW"],
  );
  assert.equal(access(plan, "read-1", "history").readVersion, 1);
  assert.equal(access(plan, "write-2", "history").writeVersion, 2);
  assert.equal(access(plan, "read-2", "history").readVersion, 2);
});

test("conflict chain 1: rejects two unordered writers with their node pair", () => {
  const result = buildExecutionPlan(concurrentWriteChain.graph);

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.deepEqual(
    result.diagnostics.map((item) => ({
      code: item.code,
      nodePath: item.nodePath,
      resourceId: item.resourceId,
      relation: item.relation,
    })),
    [
      {
        code: "CONCURRENT_WRITE",
        nodePath: ["writer-a", "writer-b"],
        resourceId: "shared-buffer",
        relation: "unordered",
      },
    ],
  );
});

test("conflict chain 2: rejects a read ordered before its writer and reports the reverse path", () => {
  const result = buildExecutionPlan(readBeforeWriteChain.graph);

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.deepEqual(
    result.diagnostics.map((item) => ({
      code: item.code,
      nodePath: item.nodePath,
      resourceId: item.resourceId,
      relation: item.relation,
    })),
    [
      {
        code: "READ_BEFORE_WRITE",
        nodePath: ["read-target", "write-target"],
        resourceId: "generated-color",
        relation: "ordered",
      },
    ],
  );
});

test("conflict chain 3: rejects a dependency cycle and reports the closed node path", () => {
  const result = buildExecutionPlan(dependencyCycleChain.graph);

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0], {
    code: "DEPENDENCY_CYCLE",
    message: "Dependency cycle rejected: pass-a -> pass-b -> pass-c -> pass-a.",
    nodePath: ["pass-a", "pass-b", "pass-c", "pass-a"],
    relation: "cycle",
  });
});
