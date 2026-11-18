import { makeCagePositions } from "./meshes.js";

function writeArray(instance, pointer, source) {
  const exports = instance.exports;
  const target = source instanceof Float32Array
    ? new Float32Array(exports.memory.buffer, pointer >>> 0, source.length)
    : new Uint32Array(exports.memory.buffer, pointer >>> 0, source.length);
  target.set(source);
}

export async function createBaker(wasmSource) {
  const module = await WebAssembly.compile(wasmSource);
  const instance = await WebAssembly.instantiate(module, {
    env: {
      abort(_message, _file, line, column) {
        throw new Error(`WASM abort at ${line}:${column}`);
      },
    },
  });
  const exports = instance.exports;
  let meshSignature = "";
  let textureSize = 0;

  function ensureMeshes(highMesh, lowMesh) {
    const signature = [
      highMesh.vertexCount,
      highMesh.triangleCount,
      lowMesh.vertexCount,
      lowMesh.triangleCount,
    ].join(":");
    if (signature === meshSignature) return;
    exports.resizeMeshes(
      highMesh.vertexCount,
      highMesh.triangleCount,
      lowMesh.vertexCount,
      lowMesh.triangleCount,
    );
    meshSignature = signature;
  }

  function ensureTexture(resolution) {
    if (textureSize === resolution) return;
    exports.resizeTexture(resolution, resolution);
    textureSize = resolution;
  }

  function upload(highMesh, lowMesh, cagePositions) {
    writeArray(instance, exports.highPosPtr(), highMesh.positions);
    writeArray(instance, exports.highNrmPtr(), highMesh.normals);
    writeArray(instance, exports.highIdxPtr(), highMesh.indices);
    writeArray(instance, exports.lowPosPtr(), lowMesh.positions);
    writeArray(instance, exports.lowNrmPtr(), lowMesh.normals);
    writeArray(instance, exports.lowTanPtr(), lowMesh.tangents);
    writeArray(instance, exports.lowBitPtr(), lowMesh.bitangents);
    writeArray(instance, exports.lowUvPtr(), lowMesh.uvs);
    writeArray(instance, exports.lowIdxPtr(), lowMesh.indices);
    writeArray(instance, exports.cagePosPtr(), cagePositions);
  }

  return {
    bake({
      highMesh,
      lowMesh,
      cagePositions: suppliedCage,
      resolution,
      projection,
      cageOffset,
      rayDistance,
      weightScale,
      maxHits,
    }) {
      ensureMeshes(highMesh, lowMesh);
      ensureTexture(resolution);
      const cagePositions = suppliedCage ?? makeCagePositions(lowMesh, cageOffset);
      upload(highMesh, lowMesh, cagePositions);
      exports.configure(projection === "cage" ? 0 : 1, rayDistance, weightScale, maxHits);
      const start = globalThis.performance?.now?.() ?? Date.now();
      const pointer = exports.bake() >>> 0;
      const durationMs = (globalThis.performance?.now?.() ?? Date.now()) - start;
      const texture = new Float32Array(exports.memory.buffer, pointer, resolution * resolution * 4).slice();
      const pixels = resolution * resolution;
      return {
        texture,
        width: resolution,
        height: resolution,
        durationMs,
        stats: {
          hitPixels: exports.getHitPixels(),
          zeroPixels: exports.getZeroPixels(),
          totalHits: exports.getTotalHits(),
          maxHits: exports.getMaxHits(),
          avgDistance: exports.getAvgDistance(),
          coverage: exports.getHitPixels() / pixels,
          avgHitsPerPixel: exports.getHitPixels() > 0
            ? exports.getTotalHits() / exports.getHitPixels()
            : 0,
          boxTests: Number(exports.getBoxTests()),
          triangleTests: Number(exports.getTriangleTests()),
        },
      };
    },
  };
}

export async function loadBaker(url = "/baker.wasm") {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法加载 ${url}: ${response.status}`);
  return createBaker(await response.arrayBuffer());
}
