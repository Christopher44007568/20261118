export function meshToObj(mesh, name = "isosurface") {
  const lines = [
    `# ${name} · ${mesh.kind}`,
    `# vertices ${mesh.vertexCount} · faces ${mesh.faceCount}`,
    `# iso ${mesh.iso} · resolution ${mesh.resolution}`,
  ];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    lines.push(
      `v ${format(mesh.positions[i])} ${format(mesh.positions[i + 1])} ${format(mesh.positions[i + 2])}`,
    );
  }
  for (let i = 0; i < mesh.normals.length; i += 3) {
    lines.push(
      `vn ${format(mesh.normals[i])} ${format(mesh.normals[i + 1])} ${format(mesh.normals[i + 2])}`,
    );
  }
  const faceSize = mesh.kind === "surface-nets" ? 4 : 3;
  const faces = mesh.faces ?? mesh.indices;
  for (let offset = 0; offset < faces.length; offset += faceSize) {
    const face = [];
    for (let i = 0; i < faceSize; i += 1) {
      const index = faces[offset + i] + 1;
      face.push(`${index}//${index}`);
    }
    lines.push(`f ${face.join(" ")}`);
  }
  return `${lines.join("\n")}\n`;
}

export function meshToJson(mesh, validation) {
  return JSON.stringify({
    kind: mesh.kind,
    iso: mesh.iso,
    resolution: mesh.resolution,
    extent: mesh.extent,
    vertexCount: mesh.vertexCount,
    faceCount: mesh.faceCount,
    triangleCount: mesh.triangleCount,
    positions: Array.from(mesh.positions),
    normals: Array.from(mesh.normals),
    faces: Array.from(mesh.faces ?? mesh.indices),
    validation,
  }, null, 2);
}

function format(value) {
  return Number(value).toFixed(7);
}
