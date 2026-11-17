import ManifoldModule from 'manifold-3d';
import { serializeOBJ, parseOBJ } from './obj.js';
import { inspectTopology } from './topology.js';

function copyMeshData(mesh) {
  return {
    positions: new Float32Array(mesh.vertProperties.slice(0, mesh.numVert * 3)),
    indices: new Uint32Array(mesh.triVerts),
  };
}

export class BooleanEngine {
  constructor(wasm) {
    this.wasm = wasm;
    this.backend = 'WebAssembly / Manifold';
  }

  toManifold(mesh) {
    if (mesh.positions.length === 0 || mesh.indices.length === 0) {
      throw new Error('输入网格为空');
    }
    const meshGL = new this.wasm.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(mesh.positions),
      triVerts: new Uint32Array(mesh.indices),
    });
    return new this.wasm.Manifold(meshGL);
  }

  execute(meshA, meshB, operation) {
    const a = this.toManifold(meshA);
    const b = this.toManifold(meshB);
    let result;
    const started = performance.now();
    try {
      if (operation === 'union') result = a.add(b);
      else if (operation === 'difference') result = a.subtract(b);
      else if (operation === 'intersection') result = a.intersect(b);
      else throw new Error(`未知布尔运算：${operation}`);

      const status = result.status();
      if (status !== 'NoError') {
        throw new Error(`WASM 布尔运算失败：${status}`);
      }
      const raw = result.getMesh();
      const mesh = copyMeshData(raw);
      const topology = inspectTopology(mesh);
      return {
        mesh,
        topology,
        status,
        volume: topology.empty ? 0 : result.volume(),
        elapsedMs: performance.now() - started,
      };
    } finally {
      a.delete();
      b.delete();
      result?.delete();
    }
  }

  verifyOBJRoundTrip(mesh, title = 'mesh-boolean-result') {
    const objText = serializeOBJ(mesh, title);
    const reloadedMesh = parseOBJ(objText);
    const reloadedTopology = inspectTopology(reloadedMesh);
    let reloadedStatus = 'Empty';
    if (reloadedMesh.indices.length > 0) {
      const manifold = this.toManifold(reloadedMesh);
      try {
        reloadedStatus = manifold.status();
        if (reloadedStatus !== 'NoError') {
          throw new Error(`重新加载 OBJ 后不是流形：${reloadedStatus}`);
        }
      } finally {
        manifold.delete();
      }
    }
    return {
      objText,
      reloadedMesh,
      reloadedTopology,
      reloadedStatus,
      verticesMatch:
        reloadedTopology.vertexCount === mesh.positions.length / 3,
      trianglesMatch:
        reloadedTopology.triangleCount === mesh.indices.length / 3,
      passed:
        reloadedTopology.closed &&
        reloadedTopology.outward &&
        reloadedTopology.vertexCount === mesh.positions.length / 3 &&
        reloadedTopology.triangleCount === mesh.indices.length / 3,
    };
  }
}

let enginePromise;

export function loadBooleanEngine({ wasmUrl } = {}) {
  if (!enginePromise) {
    enginePromise = ManifoldModule(
      wasmUrl ? { locateFile: () => wasmUrl } : {},
    ).then((wasm) => {
      wasm.setup();
      return new BooleanEngine(wasm);
    });
  }
  return enginePromise;
}
