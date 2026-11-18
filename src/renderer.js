'use strict';

const SCENE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
uniform mat4 uVP;
uniform mat4 uModel;
out vec3 vNormal;
out vec3 vColor;
out vec3 vWorld;
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = mat3(uModel) * aNormal;
  vColor = aColor;
  gl_Position = uVP * w;
}`;

const SCENE_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in vec3 vWorld;
uniform vec3 uEye;
uniform vec3 uFogColor;
uniform vec3 uLightDir;
out vec4 frag;
void main(){
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, normalize(uLightDir)), 0.0);
  float hemi = n.y * 0.12 + 0.88;
  vec3 col = vColor * (0.32 + diff * 0.75) * hemi;
  float dist = length(vWorld - uEye);
  float fog = smoothstep(38.0, 105.0, dist);
  col = mix(col, uFogColor, fog * 0.85);
  frag = vec4(col, 1.0);
}`;

const SKY_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main(){
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.9999, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform vec3 uTop;
uniform vec3 uBottom;
out vec4 frag;
void main(){
  float t = pow(clamp(vUV.y, 0.0, 1.0), 0.85);
  vec3 col = mix(uBottom, uTop, t);
  // warm haze band near the horizon
  float haze = exp(-pow((vUV.y - 0.42) * 5.0, 2.0)) * 0.08;
  col += vec3(0.28, 0.24, 0.15) * haze;
  frag = vec4(col, 1.0);
}`;

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: true, alpha: false, powerPreference: 'high-performance'
    });
    if (!gl) throw new Error('WebGL 2 unavailable');
    this.gl = gl;
    this.gpuLabel = String(gl.getParameter(gl.RENDERER));

    this.sceneProg = GLU.createProgram(gl, SCENE_VS, SCENE_FS);
    this.waterProg = GLU.createProgram(gl, WATER_VS, WATER_FS);
    this.skyProg = GLU.createProgram(gl, SKY_VS, SKY_FS);

    // fullscreen triangle for the sky
    this.skyMesh = GLU.mesh(gl, {
      verts: [-1, -1, 3, -1, -1, 3], stride: 2,
      attribs: [{ loc: 0, size: 2, offset: 0 }]
    });

    this.reflectTarget = null;
    this.rtScale = 0.72;
    this.stats = {
      mirrorMs: 0, draws: 0, tris: 0, frame: 0, fps: 0,
      rtW: 0, rtH: 0, leak: 0
    };
    this._frames = [];
    this.debug = { noDistortion: false, noGlint: false, bodyOnly: false };
  }

  uploadScene(scene) {
    const gl = this.gl;
    this.scene = scene;
    this.gpuGroups = scene.groups.map((g) => ({
      name: g.name,
      tris: g.tris,
      mesh: GLU.mesh(gl, {
        verts: g.verts, indices: g.indices, stride: 9,
        attribs: [
          { loc: 0, size: 3, offset: 0 },
          { loc: 1, size: 3, offset: 3 },
          { loc: 2, size: 3, offset: 6 }
        ]
      })
    }));
    this.waterMesh = buildWaterMesh(gl);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const rw = Math.max(2, Math.floor(w * this.rtScale));
    const rh = Math.max(2, Math.floor(h * this.rtScale));
    this.reflectTarget = GLU.resizeTarget(this.gl, this.reflectTarget, rw, rh);
    this.stats.rtW = rw;
    this.stats.rtH = rh;
  }

  _drawSky(prog, vp) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(prog.prog);
    gl.bindVertexArray(this.skyMesh.vao);
    GLU.setUniforms(gl, prog.uniforms, {
      uTop: [0.2, 0.24, 0.18],
      uBottom: [0.4, 0.4, 0.3]
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
  }

  _drawScene(vp, eye) {
    const gl = this.gl;
    gl.useProgram(this.sceneProg.prog);
    GLU.setUniforms(gl, this.sceneProg.uniforms, {
      uVP: vp,
      uModel: M4.identity(),
      uEye: eye,
      uFogColor: [0.47, 0.46, 0.35],
      uLightDir: [-0.35, 0.75, 0.45]
    });
    for (const g of this.gpuGroups) {
      gl.bindVertexArray(g.mesh.vao);
      gl.drawElements(gl.TRIANGLES, g.mesh.count, gl.UNSIGNED_SHORT, 0);
      this._passDraws++;
      this._passTris += g.tris;
    }
  }

  _drawWater(camera, mirror, regime, time) {
    const gl = this.gl;
    const vp = M4.multiply(camera.proj, camera.view);
    gl.useProgram(this.waterProg.prog);
    gl.bindVertexArray(this.waterMesh.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.reflectTarget.tex);
    GLU.setUniforms(gl, this.waterProg.uniforms, {
      uViewProj: vp,
      uMirrorVP: mirror.viewProj,
      uReflection: 0,
      uTime: time,
      uEye: camera.eye,
      uSpeed: regime.speed,
      uDistortion: regime.distortion,
      uWavelength: regime.wavelength,
      uMix: regime.mix,
      uChoppy: regime.choppy,
      uNoDistortion: this.debug.noDistortion ? 1 : 0,
      uNoGlint: this.debug.pureReflection ? 2 : (this.debug.noGlint ? 1 : 0)
    });
    const tris = this.waterMesh.count / 3;
    gl.drawElements(gl.TRIANGLES, this.waterMesh.count, gl.UNSIGNED_SHORT, 0);
    this._passDraws++;
    this._passTris += tris;
  }

  render(camera, mirror, regime, time) {
    const gl = this.gl;
    this.stats.frame++;
    this.resize();
    const t0 = performance.now();

    /* ---- mirror pass: reflected eye + oblique near clip ---- */
    this._passDraws = 0;
    this._passTris = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.reflectTarget.fbo);
    gl.viewport(0, 0, this.reflectTarget.w, this.reflectTarget.h);
    gl.clearColor(0.08, 0.1, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    // Reflection flips winding; keep both faces in the mirror pass so no
    // above-water geometry is accidentally dropped (depth handles overlap).
    gl.disable(gl.CULL_FACE);
    this._drawSky(this.skyProg, mirror.viewProj);
    this._drawScene(mirror.viewProj, mirror.eye);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    const t1 = performance.now();
    const mirrorMs = t1 - t0;

    /* ---- main pass ---- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.1, 0.12, 0.09, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this._drawSky(this.skyProg, null);
    this._drawScene(M4.multiply(camera.proj, camera.view), camera.eye);
    if (!this.debug.bodyOnly) this._drawWater(camera, mirror, regime, time);

    /* ---- rolling stats ---- */
    this.stats.mirrorMs = this.stats.mirrorMs * 0.92 + mirrorMs * 0.08;
    this.stats.draws = this._passDraws;
    this.stats.tris = this._passTris;
    this._frames.push(performance.now());
    if (this._frames.length > 40) this._frames.shift();
    if (this._frames.length >= 2) {
      const span = this._frames[this._frames.length - 1] - this._frames[0];
      this.stats.fps = Math.round(1000 * (this._frames.length - 1) / Math.max(span, 1));
    }
    this.stats.clipRow = Array.from(mirror.clipRow);
    this.stats.mirrorEye = Array.from(mirror.eye);
  }

  /* Read back a small mirror-view thumbnail for the on-screen RT panel. */
  blitReflectionPreview(thumbCanvas) {
    const gl = this.gl;
    const ctx = thumbCanvas.getContext('2d');
    const w = thumbCanvas.width, h = thumbCanvas.height;
    const pixels = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.reflectTarget.fbo);
    // RT is stored bottom-up; draw in flipped rows so the preview reads upright.
    gl.readPixels(0, 0, this.reflectTarget.w, this.reflectTarget.h, gl.RGBA, gl.UNSIGNED_BYTE,
      this._readScratch = this._readScratch ||
        new Uint8Array(this.reflectTarget.w * this.reflectTarget.h * 4));
    const src = this._readScratch;
    const sw = this.reflectTarget.w, sh = this.reflectTarget.h;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(sh - 1, Math.floor((1 - (y + 0.5) / h) * sh));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(sw - 1, Math.floor((x + 0.5) / w * sw));
        const si = (sy * sw + sx) * 4, di = (y * w + x) * 4;
        img.data[di] = src[si]; img.data[di + 1] = src[si + 1];
        img.data[di + 2] = src[si + 2]; img.data[di + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

window.Renderer = Renderer;
