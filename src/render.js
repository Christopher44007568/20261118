import { v3 } from "./math.js";
import { FrameBuffer } from "./raster.js";

const COLORS = {
  bg: "#0d1622",
  iso: "#2dd4bf",
  seam: "#f5b042",
  controlNet: "rgba(148, 163, 184, 0.35)",
  controlPoint: "#e2e8f0",
  selected: "#f5b042"
};

// Painter-algorithm Canvas2D renderer shared by the interactive page and the
// headless export. All geometry is already projected in the mesh records.
export function drawShaded(ctx, meshes, camera, width, height) {
  const fb = new FrameBuffer(width, height);
  const faces = collectFaces(meshes);
  const keyLight = v3.norm([-5, -6, 10]);
  const fillLight = v3.norm([7, 3, 6]);
  for (const f of faces) {
    const colors = f.vertexNormals.map((n, k) => {
      const viewDir = v3.norm(v3.sub(camera.eye, f.centers[k]));
      const normal = v3.dot(n, viewDir) < 0 ? v3.scale(n, -1) : n;
      const key = Math.max(0, v3.dot(normal, keyLight));
      const fill = Math.max(0, v3.dot(normal, fillLight)) * 0.45;
      const facing = Math.max(0, v3.dot(normal, viewDir));
      const rim = Math.pow(1 - facing, 2) * 0.35;
      // Subtle warm crest, localised to the strongest key-light hits.
      const crest = Math.max(0, key - 0.72) * 0.9;
      const t = Math.min(1, 0.06 + key * 0.55 + fill * 0.4 + rim * 0.7 + crest);
      return shadeRGB(t);
    });
    fb.triangle(f.points[0], colors[0], f.points[1], colors[1], f.points[2], colors[2]);
  }
  dither(fb);
  ctx.putImageData(fb.image, 0, 0);
}

// Ordered 2x2 Bayer dither breaks up 8-bit colour banding on the smooth
// gradients without blurring geometry or introducing noise in flat areas.
function dither(fb) {
  const bayer = [[-0.75, 0.25], [0.5, -0.25]];
  const d = fb.image.data;
  for (let y = 0; y < fb.height; y++) {
    for (let x = 0; x < fb.width; x++) {
      const idx = (y * fb.width + x) * 4;
      if (!isFinite(fb.depth[y * fb.width + x])) continue;
      const q = bayer[y & 1][x & 1] * 2.2;
      d[idx] = clampByte(d[idx] + q);
      d[idx + 1] = clampByte(d[idx + 1] + q);
      d[idx + 2] = clampByte(d[idx + 2] + q);
    }
  }
}

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function shadeRGB(t) {
  // Cyan-teal base (blue dominant over green); red stays low until the top
  // of the range so only genuine highlights read as amber.
  const r = 12 + Math.pow(t, 4.2) * (238 - 12);
  const g = 60 + t * (150 - 60);
  const b = 102 + (1 - t) * (168 - 102);
  return [r, g, b];
}

export function drawWireframe(ctx, meshes, camera, width, height, surface = null, selected = null) {
  drawShaded(ctx, meshes, camera, width, height);
  ctx.lineWidth = 1;
  for (const mesh of meshes) {
    const { nu, nv, screen } = mesh;
    ctx.strokeStyle = COLORS.iso;
    ctx.beginPath();
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i < nu; i++) {
        line(ctx, screen[j * (nu + 1) + i], screen[j * (nu + 1) + i + 1]);
      }
    }
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j < nv; j++) {
        line(ctx, screen[j * (nu + 1) + i], screen[(j + 1) * (nu + 1) + i]);
      }
    }
    ctx.stroke();
    // Patch boundary / seam edges in amber.
    ctx.strokeStyle = COLORS.seam;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    const at = (i, j) => screen[j * (nu + 1) + i];
    for (let i = 0; i < nu; i++) {
      line(ctx, at(i, 0), at(i + 1, 0));
      line(ctx, at(i, nv), at(i + 1, nv));
    }
    for (let j = 0; j < nv; j++) {
      line(ctx, at(0, j), at(0, j + 1));
      line(ctx, at(nu, j), at(nu, j + 1));
    }
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  if (surface) drawControlNet(ctx, surface, camera, selected);
}

export function drawControlNet(ctx, surface, camera, selected = null) {
  ctx.strokeStyle = COLORS.controlNet;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const pts = surface.nodes.map((row) => row.map((p) => camera.project(p)));
  for (let j = 0; j < pts.length; j++) {
    for (let i = 0; i < pts[j].length - 1; i++) line(ctx, pts[j][i], pts[j][i + 1]);
  }
  for (let i = 0; i < pts[0].length; i++) {
    for (let j = 0; j < pts.length - 1; j++) line(ctx, pts[j][i], pts[j + 1][i]);
  }
  ctx.stroke();
  for (let j = 0; j < pts.length; j++) {
    for (let i = 0; i < pts[j].length; i++) {
      const isSel = selected && selected[0] === i && selected[1] === j;
      ctx.fillStyle = isSel ? COLORS.selected : COLORS.controlPoint;
      ctx.beginPath();
      ctx.arc(pts[j][i][0], pts[j][i][1], isSel ? 7 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      if (isSel) {
        ctx.strokeStyle = "rgba(245,176,66,0.4)";
        ctx.beginPath();
        ctx.arc(pts[j][i][0], pts[j][i][1], 11, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}

function collectFaces(meshes) {
  const faces = [];
  for (const mesh of meshes) {
    for (const tri of mesh.triangles) {
      const p0 = mesh.positions[tri[0]];
      const p1 = mesh.positions[tri[1]];
      const p2 = mesh.positions[tri[2]];
      const normal = v3.norm(v3.cross(v3.sub(p1, p0), v3.sub(p2, p0)));
      const center = [
        (p0[0] + p1[0] + p2[0]) / 3,
        (p0[1] + p1[1] + p2[1]) / 3,
        (p0[2] + p1[2] + p2[2]) / 3
      ];
      const s0 = mesh.screen[tri[0]];
      const s1 = mesh.screen[tri[1]];
      const s2 = mesh.screen[tri[2]];
      faces.push({
        normal,
        center,
        depth: (s0[2] + s1[2] + s2[2]) / 3,
        points: [s0, s1, s2],
        centers: [p0, p1, p2],
        vertexNormals: [mesh.normals[tri[0]], mesh.normals[tri[1]], mesh.normals[tri[2]]]
      });
    }
  }
  return faces;
}

function line(ctx, a, b) {
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
}
