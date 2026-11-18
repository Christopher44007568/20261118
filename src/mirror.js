'use strict';

/*
 * Planar reflection camera.
 * The eye is reflected across y = waterLevel; an oblique near plane on the
 * water surface clips every below-water fragment out of the mirror pass.
 */
class MirrorCamera {
  constructor(waterLevel = 0, clipBias = 0.002) {
    this.waterLevel = waterLevel;
    this.clipBias = clipBias;
    this.eye = new Float32Array(3);
    this.target = new Float32Array(3);
    this.up = new Float32Array([0, 1, 0]);
    this.view = M4.identity();
    this.proj = M4.identity();
    this.viewProj = M4.identity();
    this.clipRow = new Float32Array(4);
    this.finite = true;
  }

  update(mainEye, mainTarget, mainUp, baseProj) {
    const reflect = M4.reflectY(this.waterLevel);
    this.eye = M4.transformPoint(reflect, mainEye);
    this.target = M4.transformPoint(reflect, mainTarget);
    this.up = [
      mainUp[0] * reflect[0] + mainUp[1] * reflect[1] + mainUp[2] * reflect[2],
      mainUp[0] * reflect[4] + mainUp[1] * reflect[5] + mainUp[2] * reflect[6],
      mainUp[0] * reflect[8] + mainUp[1] * reflect[9] + mainUp[2] * reflect[10]
    ];
    this.view = M4.lookAt(this.eye, this.target, this.up);

    // World-space water plane, oriented so above-water geometry yields a
    // positive eye-space distance (the half-space the oblique frustum keeps).
    // Clip bias nudges the plane slightly above the surface to kill seams.
    const worldPlane = [0, 1, 0, -(this.waterLevel + this.clipBias)];
    const invView = M4.invert(this.view);
    const t = M4.transpose(invView);
    const eyePlane = [
      t[0] * worldPlane[0] + t[4] * worldPlane[1] + t[8] * worldPlane[2] + t[12] * worldPlane[3],
      t[1] * worldPlane[0] + t[5] * worldPlane[1] + t[9] * worldPlane[2] + t[13] * worldPlane[3],
      t[2] * worldPlane[0] + t[6] * worldPlane[1] + t[10] * worldPlane[2] + t[14] * worldPlane[3],
      t[3] * worldPlane[0] + t[7] * worldPlane[1] + t[11] * worldPlane[2] + t[15] * worldPlane[3]
    ];
    this.clipRow = new Float32Array(eyePlane);
    this.proj = M4.obliqueNearPlane(baseProj, eyePlane);
    this.viewProj = M4.multiply(this.proj, this.view);
  }

  /*
   * Project a world point through the mirror camera into reflection UV.
   * A water fragment samples the mirror texture with these coordinates;
   * normal perturbation is applied by the caller on top.
   */
  projectUV(worldPoint) {
    const clip = M4.transformPoint(this.viewProj, [worldPoint[0], worldPoint[1], worldPoint[2]]);
    // transformPoint already divides by w; map NDC [-1,1] -> [0,1].
    return [clip[0] * 0.5 + 0.5, clip[1] * 0.5 + 0.5, clip[2] * 0.5 + 0.5];
  }
}

window.MirrorCamera = MirrorCamera;
