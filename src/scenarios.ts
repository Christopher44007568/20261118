import type { RenderGraph } from "./types.ts";

export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly graph: RenderGraph;
}

export const textureChain: Scenario = {
  id: "normal-texture-chain",
  title: "Reordered texture chain with RAW barriers",
  graph: {
    resources: [
      { id: "scene-color", kind: "texture", transient: true, layout: "rgba16f:256x256" },
      { id: "bloom", kind: "texture", transient: true, layout: "rgba16f:256x256" },
      { id: "final-color", kind: "texture", transient: true, layout: "rgba8:256x256" },
    ],
    passes: [
      {
        id: "present",
        kind: "present",
        dependsOn: ["tone-map"],
        accesses: [{ resource: "final-color", mode: "read", usage: "sampled" }],
      },
      {
        id: "tone-map",
        kind: "compute",
        dependsOn: ["composite"],
        accesses: [{ resource: "final-color", mode: "readwrite", usage: "storage" }],
      },
      {
        id: "composite",
        kind: "render",
        dependsOn: ["blur"],
        accesses: [
          { resource: "scene-color", mode: "read", usage: "sampled" },
          { resource: "bloom", mode: "read", usage: "sampled" },
          { resource: "final-color", mode: "write", usage: "render-attachment" },
        ],
      },
      {
        id: "blur",
        kind: "compute",
        dependsOn: ["render-scene"],
        accesses: [
          { resource: "scene-color", mode: "read", usage: "sampled" },
          { resource: "bloom", mode: "write", usage: "render-attachment" },
        ],
      },
      {
        id: "render-scene",
        kind: "render",
        accesses: [
          { resource: "scene-color", mode: "write", usage: "render-attachment" },
        ],
      },
    ],
  },
};

export const bufferFanInChain: Scenario = {
  id: "normal-buffer-fan-in",
  title: "Parallel buffer fills followed by compute reduction and copy-out",
  graph: {
    resources: [
      {
        id: "camera-uniform",
        kind: "buffer",
        initialized: true,
        initialUsage: "uniform",
        layout: "buffer:256",
      },
      { id: "particles-a", kind: "buffer", transient: true, layout: "buffer:4096" },
      { id: "particles-b", kind: "buffer", transient: true, layout: "buffer:4096" },
      { id: "reduced", kind: "buffer", transient: true, layout: "buffer:4096" },
      { id: "readback", kind: "buffer", layout: "buffer:4096" },
    ],
    passes: [
      {
        id: "copy-out",
        kind: "copy",
        dependsOn: ["reduce"],
        accesses: [
          { resource: "reduced", mode: "read", usage: "storage" },
          { resource: "readback", mode: "write", usage: "copy-dst" },
        ],
      },
      {
        id: "reduce",
        kind: "compute",
        dependsOn: ["fill-a", "fill-b"],
        accesses: [
          { resource: "particles-a", mode: "read", usage: "storage" },
          { resource: "particles-b", mode: "read", usage: "storage" },
          { resource: "reduced", mode: "write", usage: "storage" },
        ],
      },
      {
        id: "fill-b",
        kind: "compute",
        accesses: [
          { resource: "camera-uniform", mode: "read", usage: "uniform" },
          { resource: "particles-b", mode: "write", usage: "storage" },
        ],
      },
      {
        id: "fill-a",
        kind: "compute",
        accesses: [
          { resource: "camera-uniform", mode: "read", usage: "uniform" },
          { resource: "particles-a", mode: "write", usage: "storage" },
        ],
      },
    ],
  },
};

export const temporaryReuseChain: Scenario = {
  id: "normal-temporary-reuse",
  title: "Disjoint scratch lifetimes share one physical texture slot",
  graph: {
    resources: [
      {
        id: "scratch-a",
        kind: "texture",
        transient: true,
        layout: "rgba16f:512x512",
      },
      {
        id: "scratch-b",
        kind: "texture",
        transient: true,
        layout: "rgba16f:512x512",
      },
      { id: "output-a", kind: "buffer", layout: "buffer:1024" },
      { id: "output-b", kind: "buffer", layout: "buffer:1024" },
    ],
    passes: [
      {
        id: "write-a",
        kind: "compute",
        accesses: [
          { resource: "scratch-a", mode: "write", usage: "render-attachment" },
        ],
      },
      {
        id: "read-a",
        kind: "compute",
        dependsOn: ["write-a"],
        accesses: [
          { resource: "scratch-a", mode: "read", usage: "sampled" },
          { resource: "output-a", mode: "write", usage: "storage" },
        ],
      },
      {
        id: "write-b",
        kind: "compute",
        dependsOn: ["read-a"],
        accesses: [
          { resource: "scratch-b", mode: "write", usage: "render-attachment" },
        ],
      },
      {
        id: "read-b",
        kind: "compute",
        dependsOn: ["write-b"],
        accesses: [
          { resource: "scratch-b", mode: "read", usage: "sampled" },
          { resource: "output-b", mode: "write", usage: "storage" },
        ],
      },
    ],
  },
};

export const normalChains: readonly Scenario[] = [
  textureChain,
  bufferFanInChain,
  temporaryReuseChain,
];

export const concurrentWriteChain: Scenario = {
  id: "conflict-concurrent-write",
  title: "Two unordered passes write the same buffer",
  graph: {
    resources: [
      { id: "shared-buffer", kind: "buffer", transient: true, layout: "buffer:1024" },
    ],
    passes: [
      {
        id: "writer-a",
        kind: "compute",
        accesses: [{ resource: "shared-buffer", mode: "write", usage: "storage" }],
      },
      {
        id: "writer-b",
        kind: "compute",
        accesses: [{ resource: "shared-buffer", mode: "write", usage: "storage" }],
      },
    ],
  },
};

export const readBeforeWriteChain: Scenario = {
  id: "conflict-read-before-write",
  title: "A reader is ordered before the pass that produces its texture",
  graph: {
    resources: [
      {
        id: "generated-color",
        kind: "texture",
        transient: true,
        layout: "rgba8:128x128",
      },
    ],
    passes: [
      {
        id: "read-target",
        kind: "compute",
        accesses: [{ resource: "generated-color", mode: "read", usage: "sampled" }],
      },
      {
        id: "write-target",
        kind: "render",
        dependsOn: ["read-target"],
        accesses: [
          { resource: "generated-color", mode: "write", usage: "render-attachment" },
        ],
      },
    ],
  },
};

export const dependencyCycleChain: Scenario = {
  id: "conflict-dependency-cycle",
  title: "Three passes form a render dependency cycle",
  graph: {
    resources: [
      { id: "ring-a", kind: "texture", transient: true, layout: "rgba8:64x64" },
      { id: "ring-b", kind: "texture", transient: true, layout: "rgba8:64x64" },
      { id: "ring-c", kind: "texture", transient: true, layout: "rgba8:64x64" },
    ],
    passes: [
      {
        id: "pass-a",
        kind: "render",
        dependsOn: ["pass-c"],
        accesses: [{ resource: "ring-a", mode: "write", usage: "render-attachment" }],
      },
      {
        id: "pass-b",
        kind: "render",
        dependsOn: ["pass-a"],
        accesses: [{ resource: "ring-b", mode: "write", usage: "render-attachment" }],
      },
      {
        id: "pass-c",
        kind: "render",
        dependsOn: ["pass-b"],
        accesses: [{ resource: "ring-c", mode: "write", usage: "render-attachment" }],
      },
    ],
  },
};

export const conflictChains: readonly Scenario[] = [
  concurrentWriteChain,
  readBeforeWriteChain,
  dependencyCycleChain,
];

export const allScenarios: readonly Scenario[] = [
  ...normalChains,
  ...conflictChains,
];
