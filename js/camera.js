import { v3, m4 } from './math3.js';

export class OrbitCamera {
  constructor() {
    this.target = [0, 0, 0];
    this.yaw = 0.8;
    this.pitch = 0.5;
    this.distance = 5;
    this.fovY = Math.PI / 4;
    this.near = 0.05;
    this.far = 100;
  }

  eye() {
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + this.distance * cp * Math.cos(this.yaw),
      this.target[1] + this.distance * Math.sin(this.pitch),
      this.target[2] + this.distance * cp * Math.sin(this.yaw),
    ];
  }

  viewMatrix() {
    return m4.lookAt(this.eye(), this.target, [0, 1, 0]);
  }

  projMatrix(aspect) {
    return m4.perspective(this.fovY, aspect, this.near, this.far);
  }

  viewProj(aspect) {
    return m4.multiply(this.projMatrix(aspect), this.viewMatrix());
  }

  // World-space ray for a canvas pixel coordinate.
  ray(px, py, canvasW, canvasH) {
    const ndcX = (px / canvasW) * 2 - 1;
    const ndcY = 1 - (py / canvasH) * 2;
    const vp = this.viewProj(canvasW / canvasH);
    const inv = m4.invert(vp);
    const pNear = m4.transformPoint(inv, [ndcX, ndcY, -1]);
    const pFar = m4.transformPoint(inv, [ndcX, ndcY, 1]);
    return { origin: pNear, dir: v3.normalize(v3.sub(pFar, pNear)) };
  }

  attach(canvas, onChange) {
    let drag = null;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, button: e.button };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.button === 0) {
        this.yaw += dx * 0.008;
        this.pitch = Math.min(1.5, Math.max(-1.5, this.pitch + dy * 0.008));
      } else if (drag.button === 2) {
        const eye = this.eye();
        const fwd = v3.normalize(v3.sub(this.target, eye));
        const right = v3.normalize(v3.cross(fwd, [0, 1, 0]));
        const up = v3.cross(right, fwd);
        const s = this.distance * 0.0016;
        this.target = v3.add(this.target, v3.add(v3.scale(right, -dx * s), v3.scale(up, dy * s)));
      }
      onChange();
    });
    canvas.addEventListener('pointerup', () => (drag = null));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.distance = Math.min(50, Math.max(0.5, this.distance * (1 + e.deltaY * 0.001)));
      onChange();
    }, { passive: false });
  }
}
