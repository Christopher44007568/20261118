export type ResourceKind = "texture" | "buffer";

export type AccessMode = "read" | "write" | "readwrite";

export type ResourceState =
  | "uninitialized"
  | "sampled"
  | "render-attachment"
  | "storage"
  | "uniform"
  | "vertex"
  | "index"
  | "indirect"
  | "copy-src"
  | "copy-dst";

export interface ResourceDecl {
  readonly id: string;
  readonly kind: ResourceKind;
  /**
   * Only transient resources may share a physical slot. Reuse additionally
   * requires that the previous lifetime is ordered before the next lifetime.
   */
  readonly transient?: boolean;
  /**
   * An initialized resource already contains valid data at graph entry.
   * Reads without a writer are rejected unless this is true.
   */
  readonly initialized?: boolean;
  readonly initialUsage?: ResourceState;
  /**
   * A stable compatibility key. Resources with the same kind and layout may
   * share a slot, for example "rgba8:256x256" or "buffer:4096".
   */
  readonly layout?: string;
}

export interface ResourceAccess {
  readonly resource: string;
  readonly mode: AccessMode;
  /** Explicit WebGPU usage state; otherwise a mode-specific default is used. */
  readonly usage?: ResourceState;
}

export interface PassNode {
  readonly id: string;
  readonly kind?: "render" | "compute" | "copy" | "present";
  /** Every entry must finish before this pass starts. */
  readonly dependsOn?: readonly string[];
  readonly accesses: readonly ResourceAccess[];
}

export interface RenderGraph {
  readonly resources: readonly ResourceDecl[];
  readonly passes: readonly PassNode[];
}

export type DiagnosticCode =
  | "DUPLICATE_RESOURCE"
  | "DUPLICATE_PASS"
  | "DUPLICATE_ACCESS"
  | "UNKNOWN_RESOURCE"
  | "UNKNOWN_DEPENDENCY"
  | "DEPENDENCY_CYCLE"
  | "CONCURRENT_WRITE"
  | "READ_BEFORE_WRITE"
  | "UNINITIALIZED_READ";

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly message: string;
  /**
   * Nodes involved in the rejection. For cycles and ordered hazards this is a
   * real graph path; for an unordered writer pair it is [writerA, writerB].
   */
  readonly nodePath: readonly string[];
  readonly resourceId?: string;
  readonly relation?: "cycle" | "ordered" | "unordered" | "missing-writer";
}

export type BarrierReason =
  | "INITIALIZE"
  | "STATE_TRANSITION"
  | "RAW"
  | "WAR"
  | "WAW"
  | "TEMPORARY_REUSE";

export interface Barrier {
  readonly type: "textureBarrier" | "bufferBarrier";
  readonly resourceId: string;
  readonly physicalSlot: string;
  readonly generation: number;
  readonly from: ResourceState;
  readonly to: ResourceState;
  readonly reason: BarrierReason;
  readonly beforePass: string;
  readonly afterPass?: string;
  /** The previous logical resource that occupied this slot, if any. */
  readonly aliasOf?: string;
  /** A reused slot must never expose the previous generation's contents. */
  readonly discardOldData: boolean;
}

export interface AccessTrace {
  readonly resourceId: string;
  readonly mode: AccessMode;
  readonly state: ResourceState;
  readonly readVersion: number | null;
  readonly writeVersion: number | null;
}

export type PlanStep =
  | { readonly type: "barrier"; readonly barrier: Barrier }
  | {
      readonly type: "pass";
      readonly passId: string;
      readonly accesses: readonly AccessTrace[];
    };

export interface ResourceAllocation {
  readonly resourceId: string;
  readonly kind: ResourceKind;
  readonly physicalSlot: string;
  readonly generation: number;
  readonly aliasOf?: string;
  readonly firstUse: number;
  readonly lastUse: number;
}

export interface ExecutionPlan {
  /** A deterministic topological order. */
  readonly order: readonly string[];
  /** Dependency levels; passes in one wave have no ordering constraint. */
  readonly waves: readonly (readonly string[])[];
  readonly steps: readonly PlanStep[];
  readonly barriers: readonly Barrier[];
  readonly allocations: readonly ResourceAllocation[];
}

export type AnalysisResult =
  | {
      readonly ok: true;
      readonly plan: ExecutionPlan;
      readonly diagnostics: readonly [];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly Diagnostic[];
    };
