export type Vec3 = [number, number, number];
export type Mat4 = Float32Array;

export const EPSILON = 1e-6;

export const vec3 = {
  add(a: Vec3, b: Vec3): Vec3 {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  },
  sub(a: Vec3, b: Vec3): Vec3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  },
  scale(a: Vec3, s: number): Vec3 {
    return [a[0] * s, a[1] * s, a[2] * s];
  },
  addScaled(a: Vec3, b: Vec3, s: number): Vec3 {
    return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
  },
  dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  },
  cross(a: Vec3, b: Vec3): Vec3 {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  },
  length(a: Vec3): number {
    return Math.hypot(a[0], a[1], a[2]);
  },
  lengthSq(a: Vec3): number {
    return a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
  },
  normalize(a: Vec3): Vec3 {
    const length = Math.hypot(a[0], a[1], a[2]);
    return length > EPSILON ? [a[0] / length, a[1] / length, a[2] / length] : [0, 0, 0];
  },
  lerp(a: Vec3, b: Vec3, t: number): Vec3 {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  },
};

export function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return vec3.normalize(vec3.cross(vec3.sub(b, a), vec3.sub(c, a)));
}

export function triangleCentroid(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
}

export function mat4Perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function mat4LookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = vec3.normalize(vec3.sub(eye, target));
  const x = vec3.normalize(vec3.cross(up, z));
  const y = vec3.cross(z, x);
  const out = new Float32Array(16);
  out[0] = x[0];
  out[1] = y[0];
  out[2] = z[0];
  out[4] = x[1];
  out[5] = y[1];
  out[6] = z[1];
  out[8] = x[2];
  out[9] = y[2];
  out[10] = z[2];
  out[12] = -vec3.dot(x, eye);
  out[13] = -vec3.dot(y, eye);
  out[14] = -vec3.dot(z, eye);
  out[15] = 1;
  return out;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[row]! * b[column * 4]! +
        a[4 + row]! * b[column * 4 + 1]! +
        a[8 + row]! * b[column * 4 + 2]! +
        a[12 + row]! * b[column * 4 + 3]!;
    }
  }
  return out;
}

export interface CameraBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  tanHalfFov: number;
}

export function cameraBasis(eye: Vec3, target: Vec3, up: Vec3, fovY: number): CameraBasis {
  const forward = vec3.normalize(vec3.sub(target, eye));
  const right = vec3.normalize(vec3.cross(forward, up));
  return {
    forward,
    right,
    up: vec3.cross(right, forward),
    tanHalfFov: Math.tan(fovY / 2),
  };
}

export function rayThroughPixel(
  basis: CameraBasis,
  pixelX: number,
  pixelY: number,
  width: number,
  height: number,
): Vec3 {
  const nx = (2 * (pixelX + 0.5)) / width - 1;
  const ny = 1 - (2 * (pixelY + 0.5)) / height;
  const scale = basis.tanHalfFov;
  return vec3.normalize(
    vec3.add(
      basis.forward,
      vec3.add(vec3.scale(basis.right, nx * scale * (width / height)), vec3.scale(basis.up, ny * scale)),
    ),
  );
}

export function rayTriangle(
  origin: Vec3,
  direction: Vec3,
  a: Vec3,
  b: Vec3,
  c: Vec3,
): number | null {
  const edge1 = vec3.sub(b, a);
  const edge2 = vec3.sub(c, a);
  const p = vec3.cross(direction, edge2);
  const determinant = vec3.dot(edge1, p);
  if (Math.abs(determinant) < 1e-8) return null;
  const inverse = 1 / determinant;
  const t = vec3.sub(origin, a);
  const u = vec3.dot(t, p) * inverse;
  if (u < -1e-7 || u > 1 + 1e-7) return null;
  const q = vec3.cross(t, edge1);
  const v = vec3.dot(direction, q) * inverse;
  if (v < -1e-7 || u + v > 1 + 1e-7) return null;
  const distance = vec3.dot(edge2, q) * inverse;
  return distance > 1e-7 ? distance : null;
}
