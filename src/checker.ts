import type {
  AccessMode,
  AccessTrace,
  AnalysisResult,
  Barrier,
  BarrierReason,
  Diagnostic,
  ExecutionPlan,
  PassNode,
  PlanStep,
  RenderGraph,
  ResourceAllocation,
  ResourceDecl,
  ResourceState,
} from "./types.ts";

interface GraphIndex {
  readonly resourceById: ReadonlyMap<string, ResourceDecl>;
  readonly passById: ReadonlyMap<string, PassNode>;
  readonly passOrder: ReadonlyMap<string, number>;
  readonly adjacency: ReadonlyMap<string, readonly string[]>;
  readonly indegree: ReadonlyMap<string, number>;
}

interface ResourceUse {
  readonly passId: string;
  readonly mode: AccessMode;
  readonly order: number;
}

interface PreviousAccess {
  readonly passId: string;
  readonly mode: AccessMode;
  readonly state: ResourceState;
}

interface SlotCandidate {
  readonly physicalSlot: string;
  readonly kind: ResourceDecl["kind"];
  readonly layout: string;
  generation: number;
  lastUseIndex: number;
  lastUsePass: string;
  lastResourceId: string;
}

function hasRead(mode: AccessMode): boolean {
  return mode === "read" || mode === "readwrite";
}

function hasWrite(mode: AccessMode): boolean {
  return mode === "write" || mode === "readwrite";
}

function defaultReadState(kind: ResourceDecl["kind"]): ResourceState {
  return kind === "texture" ? "sampled" : "uniform";
}

function defaultState(kind: ResourceDecl["kind"], mode: AccessMode): ResourceState {
  if (mode === "read") {
    return defaultReadState(kind);
  }
  if (mode === "readwrite") {
    return "storage";
  }
  return kind === "texture" ? "render-attachment" : "storage";
}

function reject(diagnostics: readonly Diagnostic[]): AnalysisResult {
  return { ok: false, diagnostics };
}

function diagnostic(
  code: Diagnostic["code"],
  message: string,
  nodePath: readonly string[],
  extra: Pick<Diagnostic, "resourceId" | "relation"> = {},
): Diagnostic {
  return {
    code,
    message,
    nodePath,
    ...(extra.resourceId === undefined ? {} : { resourceId: extra.resourceId }),
    ...(extra.relation === undefined ? {} : { relation: extra.relation }),
  };
}

function indexGraph(graph: RenderGraph): {
  index: GraphIndex | null;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const resourceById = new Map<string, ResourceDecl>();
  const passById = new Map<string, PassNode>();
  const passOrder = new Map<string, number>();

  for (const resource of graph.resources) {
    if (resourceById.has(resource.id)) {
      diagnostics.push(
        diagnostic(
          "DUPLICATE_RESOURCE",
          `Resource "${resource.id}" is declared more than once.`,
          [],
          { resourceId: resource.id },
        ),
      );
      continue;
    }
    resourceById.set(resource.id, resource);
  }

  graph.passes.forEach((pass, order) => {
    if (passById.has(pass.id)) {
      diagnostics.push(
        diagnostic(
          "DUPLICATE_PASS",
          `Pass "${pass.id}" is declared more than once.`,
          [pass.id],
        ),
      );
      return;
    }
    passById.set(pass.id, pass);
    passOrder.set(pass.id, order);
  });

  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const pass of passById.values()) {
    adjacency.set(pass.id, []);
    indegree.set(pass.id, 0);
  }

  for (const pass of passById.values()) {
    const uniqueDependencies = new Set(pass.dependsOn ?? []);
    const outgoing = adjacency.get(pass.id);
    if (outgoing === undefined) {
      continue;
    }
    for (const dependency of uniqueDependencies) {
      if (!passById.has(dependency)) {
        diagnostics.push(
          diagnostic(
            "UNKNOWN_DEPENDENCY",
            `Pass "${pass.id}" depends on unknown pass "${dependency}".`,
            [dependency, pass.id],
          ),
        );
        continue;
      }
      outgoing.push(dependency);
      indegree.set(pass.id, (indegree.get(pass.id) ?? 0) + 1);
    }

    const seenResources = new Set<string>();
    for (const access of pass.accesses) {
      if (!resourceById.has(access.resource)) {
        diagnostics.push(
          diagnostic(
            "UNKNOWN_RESOURCE",
            `Pass "${pass.id}" accesses unknown resource "${access.resource}".`,
            [pass.id],
            { resourceId: access.resource },
          ),
        );
      }
      if (seenResources.has(access.resource)) {
        diagnostics.push(
          diagnostic(
            "DUPLICATE_ACCESS",
            `Pass "${pass.id}" declares resource "${access.resource}" more than once.`,
            [pass.id],
            { resourceId: access.resource },
          ),
        );
      }
      seenResources.add(access.resource);
    }
  }

  if (diagnostics.length > 0) {
    return { index: null, diagnostics };
  }

  // Edge direction is dependency -> dependent. This is also execution order.
  const forward = new Map<string, string[]>();
  for (const id of passById.keys()) {
    forward.set(id, []);
  }
  for (const [passId, dependencies] of adjacency) {
    for (const dependency of dependencies) {
      forward.get(dependency)?.push(passId);
    }
  }

  return {
    index: { resourceById, passById, passOrder, adjacency: forward, indegree },
    diagnostics,
  };
}

function detectCycle(index: GraphIndex): readonly string[] | null {
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  for (const id of index.passById.keys()) {
    state.set(id, 0);
  }

  const visit = (id: string): readonly string[] | null => {
    state.set(id, 1);
    stack.push(id);
    for (const next of index.adjacency.get(id) ?? []) {
      const nextState = state.get(next) ?? 0;
      if (nextState === 0) {
        const cycle = visit(next);
        if (cycle !== null) {
          return cycle;
        }
      } else if (nextState === 1) {
        const start = stack.indexOf(next);
        return [...stack.slice(start), next];
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };

  for (const id of index.passById.keys()) {
    if ((state.get(id) ?? 0) === 0) {
      const cycle = visit(id);
      if (cycle !== null) {
        return cycle;
      }
    }
  }
  return null;
}

function buildReachability(index: GraphIndex): ReadonlyMap<string, ReadonlySet<string>> {
  const reachable = new Map<string, Set<string>>();

  const collect = (start: string): Set<string> => {
    const existing = reachable.get(start);
    if (existing !== undefined) {
      return existing;
    }
    const result = new Set<string>();
    reachable.set(start, result);
    for (const next of index.adjacency.get(start) ?? []) {
      result.add(next);
      for (const descendant of collect(next)) {
        result.add(descendant);
      }
    }
    return result;
  };

  for (const id of index.passById.keys()) {
    collect(id);
  }
  return reachable;
}

function isReachable(
  reachable: ReadonlyMap<string, ReadonlySet<string>>,
  from: string,
  to: string,
): boolean {
  return reachable.get(from)?.has(to) ?? false;
}

function findPath(index: GraphIndex, from: string, to: string): readonly string[] | null {
  if (from === to) {
    return [from];
  }
  const queue: string[] = [from];
  const previous = new Map<string, string | null>([[from, null]]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    for (const next of index.adjacency.get(current) ?? []) {
      if (previous.has(next)) {
        continue;
      }
      previous.set(next, current);
      if (next === to) {
        const path: string[] = [to];
        let cursor: string | null = current;
        while (cursor !== null) {
          path.push(cursor);
          cursor = previous.get(cursor) ?? null;
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

function topologicalOrder(index: GraphIndex): readonly string[] {
  const indegree = new Map(index.indegree);
  const ready: string[] = [];
  for (const [id, degree] of indegree) {
    if (degree === 0) {
      ready.push(id);
    }
  }
  ready.sort((a, b) => (index.passOrder.get(a) ?? 0) - (index.passOrder.get(b) ?? 0));

  const order: string[] = [];
  while (ready.length > 0) {
    const current = ready.shift();
    if (current === undefined) {
      break;
    }
    order.push(current);
    for (const next of index.adjacency.get(current) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) {
        const insertion = ready.findIndex(
          (id) => (index.passOrder.get(id) ?? 0) > (index.passOrder.get(next) ?? 0),
        );
        if (insertion === -1) {
          ready.push(next);
        } else {
          ready.splice(insertion, 0, next);
        }
      }
    }
  }
  return order;
}

function buildWaves(
  index: GraphIndex,
  order: readonly string[],
): readonly (readonly string[])[] {
  const level = new Map<string, number>();
  for (const id of order) {
    let nextLevel = 0;
    for (const dependency of index.passById.get(id)?.dependsOn ?? []) {
      nextLevel = Math.max(nextLevel, (level.get(dependency) ?? -1) + 1);
    }
    level.set(id, nextLevel);
  }

  const waves: string[][] = [];
  for (const id of order) {
    const depth = level.get(id) ?? 0;
    while (waves.length <= depth) {
      waves.push([]);
    }
    waves[depth]?.push(id);
  }
  return waves;
}

function collectResourceUses(index: GraphIndex): ReadonlyMap<string, readonly ResourceUse[]> {
  const uses = new Map<string, ResourceUse[]>();
  for (const pass of index.passById.values()) {
    const order = index.passOrder.get(pass.id) ?? 0;
    for (const access of pass.accesses) {
      const list = uses.get(access.resource) ?? [];
      list.push({ passId: pass.id, mode: access.mode, order });
      uses.set(access.resource, list);
    }
  }
  return uses;
}

function validateHazards(
  index: GraphIndex,
  reachable: ReadonlyMap<string, ReadonlySet<string>>,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const usesByResource = collectResourceUses(index);

  const add = (item: Diagnostic): void => {
    const key = `${item.code}\u0000${item.resourceId ?? ""}\u0000${item.nodePath.join("\u0000")}`;
    if (!seen.has(key)) {
      seen.add(key);
      diagnostics.push(item);
    }
  };

  for (const [resourceId, uses] of usesByResource) {
    const resource = index.resourceById.get(resourceId);
    if (resource === undefined) {
      continue;
    }
    const writers = uses.filter((use) => hasWrite(use.mode));
    const readers = uses.filter((use) => hasRead(use.mode));

    for (let left = 0; left < writers.length; left += 1) {
      const writerA = writers[left];
      if (writerA === undefined) {
        continue;
      }
      for (let right = left + 1; right < writers.length; right += 1) {
        const writerB = writers[right];
        if (writerB === undefined) {
          continue;
        }
        const aBeforeB = isReachable(reachable, writerA.passId, writerB.passId);
        const bBeforeA = isReachable(reachable, writerB.passId, writerA.passId);
        if (!aBeforeB && !bBeforeA) {
          add(
            diagnostic(
              "CONCURRENT_WRITE",
              `Passes "${writerA.passId}" and "${writerB.passId}" both write "${resourceId}" but have no ordering path.`,
              [writerA.passId, writerB.passId],
              { resourceId, relation: "unordered" },
            ),
          );
        }
      }
    }

    for (const reader of readers) {
      const competingWriters = writers.filter((writer) => writer.passId !== reader.passId);
      if (competingWriters.length === 0) {
        if (resource.initialized !== true) {
          add(
            diagnostic(
              "UNINITIALIZED_READ",
              `Pass "${reader.passId}" reads "${resourceId}" before any pass writes it.`,
              [reader.passId],
              { resourceId, relation: "missing-writer" },
            ),
          );
        }
        continue;
      }

      const hasPriorWrite =
        resource.initialized === true ||
        competingWriters.some((writer) =>
          isReachable(reachable, writer.passId, reader.passId),
        );

      for (const writer of competingWriters) {
        if (isReachable(reachable, writer.passId, reader.passId)) {
          continue;
        }
        const reversePath = findPath(index, reader.passId, writer.passId);
        if (reversePath !== null) {
          if (hasPriorWrite) {
            // The read runs first and a later version overwrites the resource:
            // this is an ordered WAR dependency, not a read-before-write error.
            continue;
          }
          add(
            diagnostic(
              "READ_BEFORE_WRITE",
              `Pass "${reader.passId}" reads "${resourceId}" before writer "${writer.passId}" completes and has no prior value.`,
              reversePath,
              { resourceId, relation: "ordered" },
            ),
          );
        } else {
          add(
            diagnostic(
              "READ_BEFORE_WRITE",
              `Pass "${reader.passId}" reads "${resourceId}", but writer "${writer.passId}" is unordered and may run first.`,
              [reader.passId, writer.passId],
              { resourceId, relation: "unordered" },
            ),
          );
        }
      }
    }
  }
  return diagnostics;
}

interface UseBounds {
  readonly firstUse: number;
  readonly lastUse: number;
  readonly firstPass: string;
  readonly lastPass: string;
}

function collectUseBounds(
  index: GraphIndex,
  order: readonly string[],
): ReadonlyMap<string, UseBounds> {
  const bounds = new Map<string, UseBounds>();
  order.forEach((passId, position) => {
    const pass = index.passById.get(passId);
    for (const access of pass?.accesses ?? []) {
      const existing = bounds.get(access.resource);
      if (existing === undefined) {
        bounds.set(access.resource, {
          firstUse: position,
          lastUse: position,
          firstPass: passId,
          lastPass: passId,
        });
      } else if (position > existing.lastUse) {
        bounds.set(access.resource, {
          firstUse: existing.firstUse,
          lastUse: position,
          firstPass: existing.firstPass,
          lastPass: passId,
        });
      }
    }
  });
  return bounds;
}

function allocateResources(
  index: GraphIndex,
  order: readonly string[],
  reachable: ReadonlyMap<string, ReadonlySet<string>>,
): readonly ResourceAllocation[] {
  const bounds = collectUseBounds(index, order);
  const slots = new Map<string, SlotCandidate[]>();
  const allocations: ResourceAllocation[] = [];
  let freshSlotCounter = 0;

  const resources = [...index.resourceById.values()]
    .filter((resource) => bounds.has(resource.id))
    .sort((left, right) => {
      const leftBound = bounds.get(left.id);
      const rightBound = bounds.get(right.id);
      const byUse = (leftBound?.firstUse ?? 0) - (rightBound?.firstUse ?? 0);
      if (byUse !== 0) {
        return byUse;
      }
      return 0;
    });

  for (const resource of resources) {
    const use = bounds.get(resource.id);
    if (use === undefined) {
      continue;
    }
    const reusable = resource.transient === true && resource.initialized !== true;
    const layout = resource.layout ?? "default";
    const key = `${resource.kind}\u0000${layout}`;

    if (reusable) {
      const candidates = slots.get(key) ?? [];
      const candidate = candidates.find(
        (slot) =>
          slot.lastUseIndex < use.firstUse &&
          isReachable(reachable, slot.lastUsePass, use.firstPass),
      );
      if (candidate !== undefined) {
        candidate.generation += 1;
        candidate.lastUseIndex = use.lastUse;
        candidate.lastUsePass = use.lastPass;
        const aliasOf = candidate.lastResourceId;
        candidate.lastResourceId = resource.id;
        allocations.push({
          resourceId: resource.id,
          kind: resource.kind,
          physicalSlot: candidate.physicalSlot,
          generation: candidate.generation,
          aliasOf,
          firstUse: use.firstUse,
          lastUse: use.lastUse,
        });
        continue;
      }
    }

    freshSlotCounter += 1;
    const physicalSlot = reusable
      ? `transient-${resource.kind}-${freshSlotCounter}`
      : `persistent-${resource.kind}-${freshSlotCounter}`;
    const allocation: ResourceAllocation = {
      resourceId: resource.id,
      kind: resource.kind,
      physicalSlot,
      generation: 1,
      firstUse: use.firstUse,
      lastUse: use.lastUse,
    };
    allocations.push(allocation);

    if (reusable) {
      const list = slots.get(key) ?? [];
      list.push({
        physicalSlot,
        kind: resource.kind,
        layout,
        generation: 1,
        lastUseIndex: use.lastUse,
        lastUsePass: use.lastPass,
        lastResourceId: resource.id,
      });
      slots.set(key, list);
    }
  }

  return allocations;
}

function transitionReason(previous: AccessMode, current: AccessMode): BarrierReason {
  if (hasWrite(previous) && hasWrite(current)) {
    return "WAW";
  }
  if (hasWrite(previous) && hasRead(current)) {
    return "RAW";
  }
  if (hasRead(previous) && hasWrite(current)) {
    return "WAR";
  }
  return "STATE_TRANSITION";
}

function compilePlan(
  index: GraphIndex,
  order: readonly string[],
  allocations: readonly ResourceAllocation[],
): ExecutionPlan {
  const allocationByResource = new Map(
    allocations.map((allocation) => [allocation.resourceId, allocation]),
  );
  const lastByResource = new Map<string, PreviousAccess>();
  const slotState = new Map<string, ResourceState>();
  const versionByResource = new Map<string, number>();
  const steps: PlanStep[] = [];
  const barriers: Barrier[] = [];

  for (const passId of order) {
    const pass = index.passById.get(passId);
    if (pass === undefined) {
      continue;
    }
    const accessTraces: AccessTrace[] = [];

    for (const access of pass.accesses) {
      const resource = index.resourceById.get(access.resource);
      const allocation = allocationByResource.get(access.resource);
      if (resource === undefined || allocation === undefined) {
        continue;
      }

      const target = access.usage ?? defaultState(resource.kind, access.mode);
      const previous = lastByResource.get(resource.id);
      const barrierType =
        resource.kind === "texture" ? "textureBarrier" : "bufferBarrier";

      if (previous === undefined) {
        if (allocation.generation > 1) {
          const barrier: Barrier = {
            type: barrierType,
            resourceId: resource.id,
            physicalSlot: allocation.physicalSlot,
            generation: allocation.generation,
            from: slotState.get(allocation.physicalSlot) ?? "uninitialized",
            to: target,
            reason: "TEMPORARY_REUSE",
            beforePass: passId,
            ...(allocation.aliasOf === undefined ? {} : { aliasOf: allocation.aliasOf }),
            discardOldData: true,
          };
          barriers.push(barrier);
          steps.push({ type: "barrier", barrier });
        } else {
          const initial = resource.initialized === true
            ? resource.initialUsage ?? defaultReadState(resource.kind)
            : "uninitialized";
          if (initial !== target) {
            const reason: BarrierReason =
              initial === "uninitialized" ? "INITIALIZE" : "STATE_TRANSITION";
            const barrier: Barrier = {
              type: barrierType,
              resourceId: resource.id,
              physicalSlot: allocation.physicalSlot,
              generation: allocation.generation,
              from: initial,
              to: target,
              reason,
              beforePass: passId,
              discardOldData: false,
            };
            barriers.push(barrier);
            steps.push({ type: "barrier", barrier });
          }
        }
      } else if (
        !(
          previous.mode === "read" &&
          access.mode === "read" &&
          previous.state === target
        )
      ) {
        const barrier: Barrier = {
          type: barrierType,
          resourceId: resource.id,
          physicalSlot: allocation.physicalSlot,
          generation: allocation.generation,
          from: previous.state,
          to: target,
          reason: transitionReason(previous.mode, access.mode),
          beforePass: passId,
          afterPass: previous.passId,
          ...(allocation.aliasOf === undefined ? {} : { aliasOf: allocation.aliasOf }),
          discardOldData: false,
        };
        barriers.push(barrier);
        steps.push({ type: "barrier", barrier });
      }

      const oldVersion = versionByResource.get(resource.id) ?? 0;
      let readVersion: number | null = null;
      let writeVersion: number | null = null;
      if (hasRead(access.mode)) {
        readVersion = oldVersion;
      }
      if (hasWrite(access.mode)) {
        writeVersion = oldVersion + 1;
        versionByResource.set(resource.id, writeVersion);
      }

      accessTraces.push({
        resourceId: resource.id,
        mode: access.mode,
        state: target,
        readVersion,
        writeVersion,
      });
      lastByResource.set(resource.id, {
        passId,
        mode: access.mode,
        state: target,
      });
      slotState.set(allocation.physicalSlot, target);
    }

    steps.push({ type: "pass", passId, accesses: accessTraces });
  }

  return {
    order,
    waves: buildWaves(index, order),
    steps,
    barriers,
    allocations,
  };
}

export function buildExecutionPlan(graph: RenderGraph): AnalysisResult {
  const indexed = indexGraph(graph);
  if (indexed.index === null) {
    return reject(indexed.diagnostics);
  }
  const index = indexed.index;

  const cycle = detectCycle(index);
  if (cycle !== null) {
    return reject([
      diagnostic(
        "DEPENDENCY_CYCLE",
        `Dependency cycle rejected: ${cycle.join(" -> ")}.`,
        cycle,
        { relation: "cycle" },
      ),
    ]);
  }

  const reachable = buildReachability(index);
  const hazards = validateHazards(index, reachable);
  if (hazards.length > 0) {
    return reject(hazards);
  }

  const order = topologicalOrder(index);
  if (order.length !== index.passById.size) {
    return reject([
      diagnostic(
        "DEPENDENCY_CYCLE",
        "The dependency graph cannot be fully ordered.",
        [],
        { relation: "cycle" },
      ),
    ]);
  }

  const allocations = allocateResources(index, order, reachable);
  return {
    ok: true,
    plan: compilePlan(index, order, allocations),
    diagnostics: [],
  };
}
