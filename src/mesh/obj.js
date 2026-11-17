function formatCoordinate(value) {
  if (Math.abs(value) < 1e-15) return '0';
  return value.toPrecision(9);
}

export function serializeOBJ(mesh, title = 'mesh-boolean-result') {
  const lines = [`# ${title}`, `# vertices: ${mesh.positions.length / 3}`, `# triangles: ${mesh.indices.length / 3}`];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    lines.push(
      `v ${formatCoordinate(mesh.positions[i])} ` +
      `${formatCoordinate(mesh.positions[i + 1])} ` +
      `${formatCoordinate(mesh.positions[i + 2])}`,
    );
  }
  for (let i = 0; i < mesh.indices.length; i += 3) {
    lines.push(
      `f ${mesh.indices[i] + 1} ${mesh.indices[i + 1] + 1} ${mesh.indices[i + 2] + 1}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function resolveIndex(token, vertexCount) {
  const value = Number.parseInt(token.split('/')[0], 10);
  if (!Number.isInteger(value) || value === 0) return -1;
  const index = value < 0 ? vertexCount + value : value - 1;
  return index >= 0 && index < vertexCount ? index : -1;
}

export function parseOBJ(text) {
  const positions = [];
  const triangles = [];
  const lines = text.replace(/\r/g, '').split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const fields = line.split(/\s+/);
    if (fields[0] === 'v') {
      const x = Number(fields[1]);
      const y = Number(fields[2]);
      const z = Number(fields[3]);
      if (![x, y, z].every(Number.isFinite)) {
        throw new Error(`OBJ 顶点格式无效：${line}`);
      }
      positions.push(x, y, z);
    } else if (fields[0] === 'f') {
      const vertexCount = positions.length / 3;
      const polygon = fields.slice(1).map((token) => resolveIndex(token, vertexCount));
      if (polygon.some((index) => index < 0)) {
        throw new Error(`OBJ 面索引无效：${line}`);
      }
      for (let i = 1; i + 1 < polygon.length; i += 1) {
        triangles.push(polygon[0], polygon[i], polygon[i + 1]);
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(triangles),
  };
}

export function downloadOBJ(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
