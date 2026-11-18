import { mul4, perspective, lookAt, transformPoint } from "./math.js";

export class Camera {
  constructor({ width, height, eye, center, fovy = 42 * Math.PI / 180, near = 0.1, far = 100 }) {
    this.width = width;
    this.height = height;
    this.eye = eye;
    this.center = center;
    this.fovy = fovy;
    this.near = near;
    this.far = far;
    this._update();
  }

  setViewport(width, height) {
    this.width = width;
    this.height = height;
    this._update();
  }

  setEye(eye, center = this.center) {
    this.eye = eye;
    this.center = center;
    this._update();
  }

  _update() {
    const aspect = this.width / this.height;
    const proj = perspective(this.fovy, aspect, this.near, this.far);
    const view = lookAt(this.eye, this.center, [0, 1, 0]);
    this.viewProj = mul4(proj, view);
  }

  // Returns screen-space [xPx, yPx, depth] with y measured downward.
  project(point) {
    const clip = transformPoint(this.viewProj, point);
    return [
      (clip[0] * 0.5 + 0.5) * this.width,
      (1 - (clip[1] * 0.5 + 0.5)) * this.height,
      clip[2]
    ];
  }
}
