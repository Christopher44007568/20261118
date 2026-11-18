export function validateMesh(mesh) {
  const faceSize = mesh.kind === "surface-nets" ? 4 : 3;
  const faces = mesh.faces ?? mesh.indices;
  const edgeIncidence = new Map();
  const directedEdges = new Map();
  const indexFaces = new Set();
  const geometricFaces = new Set();
  const parent = new Int32Array(mesh.vertexCount);
  const referenced = new Uint8Array(mesh.vertexCount);
  for (let i = 0; i < parent.length; i += 1) parent[i] = i;

  let duplicateFaces = 0;
  let duplicateGeometricFaces = 0;
  let degenerateFaces = 0;

  for (let offset = 0; offset < faces.length; offset += faceSize) {
    const vertices = [];
    for (let i = 0; i < faceSize; i += 1) vertices.push(faces[offset + i]);
    let degenerate = new Set(vertices).size !== faceSize;
    for (let i = 0; i < faceSize; i += 1) {
      if (!Number.isFinite(vertices[i]) || vertices[i] < 0 || vertices[i] >= mesh.vertexCount) {
        degenerate = true;
      }
      referenced[vertices[i]] = 1;
    }
    if (faceArea(mesh.positions, vertices) < 1e-12) degenerate = true;
    if (degenerate) degenerateFaces += 1;

    const indexKey = [...vertices].sort((a, b) => a - b).join(":");
    if (indexFaces.has(indexKey)) duplicateFaces += 1;
    indexFaces.add(indexKey);

    const positionKey = vertices
      .map((vertex) => positionSignature(mesh.positions, vertex))
      .sort()
      .join(":");
    if (geometricFaces.has(positionKey)) duplicateGeometricFaces += 1;
    geometricFaces.add(positionKey);

    for (let i = 0; i < faceSize; i += 1) {
      const a = vertices[i];
      const b = vertices[(i + 1) % faceSize];
      if (a === b) continue;
      const edgeKey = a < b ? `${a}:${b}` : `${b}:${a}`;
      edgeIncidence.set(edgeKey, (edgeIncidence.get(edgeKey) ?? 0) + 1);
      directedEdges.set(`${a}:${b}`, (directedEdges.get(`${a}:${b}`) ?? 0) + 1);
      union(parent, a, b);
    }
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let inconsistentEdges = 0;
  for (const [key, count] of edgeIncidence) {
    if (count === 1) boundaryEdges += 1;
    else if (count > 2) nonManifoldEdges += 1;
    if (count === 2) {
      const [a, b] = key.split(":").map(Number);
      const forward = directedEdges.get(`${a}:${b}`) ?? 0;
      const backward = directedEdges.get(`${b}:${a}`) ?? 0;
      if (forward !== 1 || backward !== 1) inconsistentEdges += 1;
    }
  }

  const components = new Set();
  for (let i = 0; i < mesh.vertexCount; i += 1) {
    if (referenced[i]) components.add(find(parent, i));
  }

  let invalidNormals = 0;
  let maxNormalLengthError = 0;
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const x = mesh.normals[i];
    const y = mesh.normals[i + 1];
    const z = mesh.normals[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      invalidNormals += 1;
      continue;
    }
    const error = Math.abs(Math.hypot(x, y, z) - 1);
    maxNormalLengthError = Math.max(maxNormalLengthError, error);
    if (error > 1e-4) invalidNormals += 1;
  }

  const isClosed = boundaryEdges === 0;
  const isManifold = nonManifoldEdges === 0;
  const noDuplicateFaces = duplicateFaces === 0 && duplicateGeometricFaces === 0;
  const normalsValid = invalidNormals === 0 && mesh.normals.length === mesh.vertexCount * 3;
  const continuous =
    isClosed &&
    isManifold &&
    noDuplicateFaces &&
    inconsistentEdges === 0 &&
    components.size === 1;

  return {
    faceCount: faces.length / faceSize,
    duplicateFaces,
    duplicateGeometricFaces,
    degenerateFaces,
    boundaryEdges,
    nonManifoldEdges,
    inconsistentEdges,
    connectedComponents: components.size,
    invalidNormals,
    maxNormalLengthError,
    isClosed,
    isManifold,
    noDuplicateFaces,
    normalsValid,
    continuous,
    passed:
      continuous &&
      degenerateFaces === 0 &&
      normalsValid,
  };
}

export function formatValidationLine(validation) {
  const state = validation.passed ? "PASS" : "CHECK";
  return `${state} · 重复面 ${validation.duplicateFaces} · 边界边 ${validation.boundaryEdges}`
    + ` · 非流形边 ${validation.nonManifoldEdges} · 连通分量 ${validation.connectedComponents}`;
}

function faceArea(positions, vertices) {
  if (vertices.length < 3) return 0;
  const [a, b, c] = vertices;
  const ax = positions[a * 3];
  const ay = positions[a * 3 + 1];
  const az = positions[a * 3 + 2];
  const ux = positions[b * 3] - ax;
  const uy = positions[b * 3 + 1] - ay;
  const uz = positions[b * 3 + 2] - az;
  const vx = positions[c * 3] - ax;
  const vy = positions[c * 3 + 1] - ay;
  const vz = positions[c * 3 + 2] - az;
  return Math.hypot(
    uy * vz - uz * vy,
    uz * vx - ux * vz,
    ux * vy - uy * vx,
  ) * 0.5;
}

function positionSignature(positions, vertex) {
  return [
    positions[vertex * 3],
    positions[vertex * 3 + 1],
    positions[vertex * 3 + 2],
  ].map((value) => Math.round(value * 1e7)).join(",");
}

function find(parent, value) {
  let root = value;
  while (parent[root] !== root) root = parent[root];
  while (parent[value] !== value) {
    const next = parent[value];
    parent[value] = root;
    value = next;
  }
  return root;
}

function union(parent, a, b) {
  const rootA = find(parent, a);
  const rootB = find(parent, b);
  if (rootA !== rootB) parent[rootB] = rootA;
}
