import {
  createMeshVao,
  createPositionVao,
  createProgram,
  deleteMeshVao,
  deletePositionVao,
  type MeshVao,
  type PositionVao,
} from "./gl-utils";
import {
  backgroundFragment,
  colorFragment,
  colorVertex,
  fullscreenVertex,
  meshFragment,
  meshVertex,
  solidFragment,
  volumeFragment,
} from "./shaders";
import { buildShadowVolume, type ShadowVolume, type VolumeBuildResult } from "./volume";
import type { CameraPose, DemoScene } from "./scenes";
import type { PreparedMesh } from "./mesh";
import { mat4LookAt, mat4Multiply, mat4Perspective, type Vec3 } from "./math";

export interface CameraView extends CameraPose {
  fovY: number;
}

export interface DebugState {
  showVolume: boolean;
  showStencil: boolean;
  showSilhouette: boolean;
}

export interface SceneRenderMetrics {
  validMeshes: number;
  rejectedMeshes: number;
  silhouetteEdges: number;
  volumeTriangles: number;
  violations: number;
}

interface GpuMesh {
  source: PreparedMesh;
  triangles: MeshVao;
  lines: PositionVao;
}

interface GpuVolume {
  volume: ShadowVolume;
  fill: PositionVao;
  wire: PositionVao;
  nearEdges: PositionVao;
}

interface BoundScene {
  source: DemoScene;
  ground: GpuMesh;
  casters: GpuMesh[];
  invalid: GpuMesh[];
  receivers: GpuMesh[];
  volumes: GpuVolume[];
  markers: PositionVao | null;
  metrics: SceneRenderMetrics;
}

interface MaskTarget {
  width: number;
  height: number;
  framebuffer: WebGLFramebuffer;
  color: WebGLTexture;
  depthStencil: WebGLRenderbuffer;
}

function flattenTriangles(volume: ShadowVolume): Float32Array {
  const values: number[] = [];
  for (const triangle of volume.triangles) {
    for (const point of triangle) values.push(point[0], point[1], point[2]);
  }
  return new Float32Array(values);
}

function volumeWireframe(volume: ShadowVolume): Float32Array {
  const values: number[] = [];
  for (const triangle of volume.triangles) {
    for (let index = 0; index < 3; index += 1) {
      const a = triangle[index]!;
      const b = triangle[(index + 1) % 3]!;
      values.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
  }
  return new Float32Array(values);
}

function silhouetteLineData(volume: ShadowVolume): Float32Array {
  const values: number[] = [];
  for (const edge of volume.silhouetteEdges) {
    values.push(
      edge.nearA[0], edge.nearA[1], edge.nearA[2],
      edge.nearB[0], edge.nearB[1], edge.nearB[2],
    );
  }
  return new Float32Array(values);
}

function crossMarkerData(scene: DemoScene): Float32Array {
  const values: number[] = [];
  const size = 0.13;
  for (const mesh of scene.invalid) {
    for (const violation of mesh.validation.violations) {
      const [x, y, z] = violation.point;
      values.push(
        x - size, y, z, x + size, y, z,
        x, y - size, z, x, y + size, z,
        x, y, z - size, x, y, z + size,
      );
    }
  }
  return new Float32Array(values);
}

function interleavedMesh(mesh: PreparedMesh): Float32Array {
  const values: number[] = [];
  mesh.faces.forEach((face, faceIndex) => {
    const normal = mesh.validation.faces[faceIndex]?.normal ?? [0, 1, 0];
    for (const index of face) {
      const position = mesh.positions[index];
      if (!position) continue;
      values.push(position[0], position[1], position[2], normal[0], normal[1], normal[2]);
    }
  });
  return new Float32Array(values);
}

function lineData(mesh: PreparedMesh): Float32Array {
  const values: number[] = [];
  for (const edge of mesh.validation.edges) {
    const a = mesh.positions[edge.a];
    const b = mesh.positions[edge.b];
    if (!a || !b) continue;
    values.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
  return new Float32Array(values);
}

export class WebGLRenderer {
  readonly gl: WebGL2RenderingContext;
  private readonly backgroundProgram: WebGLProgram;
  private readonly meshProgram: WebGLProgram;
  private readonly volumeProgram: WebGLProgram;
  private readonly lineProgram: WebGLProgram;
  private readonly solidProgram: WebGLProgram;
  private readonly emptyVao: WebGLVertexArrayObject;
  private boundScene: BoundScene | null = null;
  private maskTarget: MaskTarget | null = null;
  private readonly volumeDistance = 150;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      depth: true,
      stencil: true,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("当前浏览器未提供 WebGL2 上下文");
    if (!gl.getContextAttributes()?.stencil) throw new Error("WebGL2 模板缓冲不可用");
    this.gl = gl;
    this.backgroundProgram = createProgram(gl, fullscreenVertex, backgroundFragment);
    this.meshProgram = createProgram(gl, meshVertex, meshFragment);
    this.volumeProgram = createProgram(gl, colorVertex, volumeFragment);
    this.lineProgram = createProgram(gl, colorVertex, colorFragment);
    this.solidProgram = createProgram(gl, fullscreenVertex, solidFragment);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("无法创建全屏 VAO");
    this.emptyVao = vao;
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);
  }

  get contextAttributes(): WebGLContextAttributes | null {
    return this.gl.getContextAttributes();
  }

  setScene(scene: DemoScene): SceneRenderMetrics {
    this.releaseScene();
    const gl = this.gl;
    const makeMesh = (mesh: PreparedMesh): GpuMesh => ({
      source: mesh,
      triangles: createMeshVao(gl, interleavedMesh(mesh)),
      lines: createPositionVao(gl, lineData(mesh)),
    });
    const ground = makeMesh(scene.ground);
    const casters = scene.casters.map(makeMesh);
    const invalid = scene.invalid.map(makeMesh);
    const volumes: GpuVolume[] = [];
    const results: VolumeBuildResult[] = scene.casters.map((mesh) =>
      buildShadowVolume(mesh, scene.lightPosition, this.volumeDistance),
    );
    for (const result of results) {
      if (!result.ok) continue;
      volumes.push({
        volume: result.volume,
        fill: createPositionVao(gl, flattenTriangles(result.volume)),
        wire: createPositionVao(gl, volumeWireframe(result.volume)),
        nearEdges: createPositionVao(gl, silhouetteLineData(result.volume)),
      });
    }
    const markersData = crossMarkerData(scene);
    const markers =
      markersData.length > 0 ? createPositionVao(gl, markersData) : null;
    const metrics: SceneRenderMetrics = {
      validMeshes: scene.casters.length,
      rejectedMeshes: scene.invalid.length,
      silhouetteEdges: volumes.reduce((sum, item) => sum + item.volume.silhouetteEdges.length, 0),
      volumeTriangles: volumes.reduce((sum, item) => sum + item.volume.triangles.length, 0),
      violations: scene.invalid.reduce(
        (sum, mesh) => sum + mesh.validation.violations.length,
        0,
      ),
    };
    this.boundScene = {
      source: scene,
      ground,
      casters,
      invalid,
      receivers: [ground, ...casters],
      volumes,
      markers,
      metrics,
    };
    return metrics;
  }

  render(camera: CameraView, debug: DebugState): void {
    const scene = this.requireScene();
    const gl = this.gl;
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clearStencil(0);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.stencilMask(0xff);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.DEPTH_TEST);
    this.drawBackground();
    const viewProjection = this.viewProjection(camera, width / height);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    for (const mesh of scene.receivers) {
      this.drawMesh(mesh, viewProjection, camera, scene.source.lightPosition, false);
    }
    for (const mesh of scene.invalid) {
      this.drawMesh(mesh, viewProjection, camera, scene.source.lightPosition, true);
    }
    this.drawShadowVolumes(scene, viewProjection);
    this.applyShadow(scene, viewProjection, camera);
    if (debug.showStencil) {
      this.drawStencilOverlay(scene);
    }
    if (debug.showVolume) {
      this.drawVolumeDebug(scene, viewProjection);
    }
    if (debug.showSilhouette) {
      this.drawSilhouetteEdges(scene, viewProjection);
    }
    this.drawInvalidEdges(scene, viewProjection);
    this.resetState();
  }

  private drawBackground(): void {
    const gl = this.gl;
    gl.useProgram(this.backgroundProgram);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private viewProjection(camera: CameraView, aspect: number): Float32Array {
    return mat4Multiply(
      mat4Perspective(camera.fovY, aspect, camera.near, camera.far),
      mat4LookAt(camera.position, camera.target, [0, 1, 0]),
    );
  }

  private drawMesh(
    mesh: GpuMesh,
    viewProjection: Float32Array,
    camera: CameraView,
    lightPosition: Vec3,
    rejected: boolean,
  ): void {
    const gl = this.gl;
    gl.useProgram(this.meshProgram);
    gl.uniformMatrix4fv(
      gl.getUniformLocation(this.meshProgram, "uViewProjection"),
      false,
      viewProjection,
    );
    gl.uniform3fv(
      gl.getUniformLocation(this.meshProgram, "uLightPosition"),
      lightPosition,
    );
    gl.uniform3fv(
      gl.getUniformLocation(this.meshProgram, "uCameraPosition"),
      camera.position,
    );
    gl.uniform3fv(
      gl.getUniformLocation(this.meshProgram, "uBaseColor"),
      rejected ? [0.65, 0.16, 0.2] : (mesh.source.source.color ?? [0.5, 0.5, 0.5]),
    );
    gl.uniform1f(gl.getUniformLocation(this.meshProgram, "uGround"), mesh.source.source.name === "ground" ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(this.meshProgram, "uLightPower"), 2.2);
    gl.uniform1f(gl.getUniformLocation(this.meshProgram, "uOverlay"), rejected ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(this.meshProgram, "uOpacity"), rejected ? 0.18 : 1);
    if (rejected) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
    }
    gl.bindVertexArray(mesh.triangles.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.triangles.count);
    if (rejected) {
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }

  private stencilVolumePass(scene: BoundScene, viewProjection: Float32Array): void {
    const gl = this.gl;
    gl.useProgram(this.volumeProgram);
    gl.uniformMatrix4fv(
      gl.getUniformLocation(this.volumeProgram, "uViewProjection"),
      false,
      viewProjection,
    );
    gl.uniform4f(gl.getUniformLocation(this.volumeProgram, "uColor"), 0, 0, 0, 0);
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0xff);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.DECR_WRAP, gl.KEEP);
    gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.INCR_WRAP, gl.KEEP);
    gl.colorMask(false, false, false, false);
    gl.depthMask(false);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    for (const volume of scene.volumes) {
      gl.bindVertexArray(volume.fill.vao);
      gl.drawArrays(gl.TRIANGLES, 0, volume.fill.count);
    }
    gl.colorMask(true, true, true, true);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
  }

  private drawShadowVolumes(scene: BoundScene, viewProjection: Float32Array): void {
    if (scene.volumes.length === 0) {
      this.gl.disable(this.gl.STENCIL_TEST);
      return;
    }
    this.stencilVolumePass(scene, viewProjection);
  }

  private applyShadow(
    scene: BoundScene,
    viewProjection: Float32Array,
    camera: CameraView,
  ): void {
    const gl = this.gl;
    if (scene.volumes.length === 0) return;
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0x00);
    gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.useProgram(this.meshProgram);
    gl.uniformMatrix4fv(
      gl.getUniformLocation(this.meshProgram, "uViewProjection"),
      false,
      viewProjection,
    );
    gl.uniform3fv(
      gl.getUniformLocation(this.meshProgram, "uLightPosition"),
      scene.source.lightPosition,
    );
    gl.uniform3fv(
      gl.getUniformLocation(this.meshProgram, "uCameraPosition"),
      camera.position,
    );
    gl.uniform3f(gl.getUniformLocation(this.meshProgram, "uBaseColor"), 0.005, 0.008, 0.016);
    gl.uniform1f(gl.getUniformLocation(this.meshProgram, "uGround"), 0);
    gl.uniform1f(gl.getUniformLocation(this.meshProgram, "uLightPower"), 0);
    gl.uniform1f(gl.getUniformLocation(this.meshProgram, "uOverlay"), 1);
    gl.uniform1f(gl.getUniformLocation(this.meshProgram, "uOpacity"), 0.48);
    for (const mesh of scene.receivers) {
      gl.bindVertexArray(mesh.triangles.vao);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.triangles.count);
    }
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.stencilMask(0xff);
  }

  private drawStencilOverlay(scene: BoundScene): void {
    const gl = this.gl;
    if (scene.volumes.length === 0) return;
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0x00);
    gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.solidProgram);
    gl.uniform4f(gl.getUniformLocation(this.solidProgram, "uColor"), 0.73, 0.19, 0.9, 0.48);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.stencilMask(0xff);
  }

  private drawVolumeDebug(scene: BoundScene, viewProjection: Float32Array): void {
    const gl = this.gl;
    if (scene.volumes.length === 0) return;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.useProgram(this.volumeProgram);
    gl.uniformMatrix4fv(
      gl.getUniformLocation(this.volumeProgram, "uViewProjection"),
      false,
      viewProjection,
    );
    gl.uniform4f(gl.getUniformLocation(this.volumeProgram, "uColor"), 0.16, 0.68, 0.96, 0.065);
    for (const volume of scene.volumes) {
      gl.bindVertexArray(volume.fill.vao);
      gl.drawArrays(gl.TRIANGLES, 0, volume.fill.count);
    }
    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(
      gl.getUniformLocation(this.lineProgram, "uViewProjection"),
      false,
      viewProjection,
    );
    gl.uniform4f(gl.getUniformLocation(this.lineProgram, "uColor"), 0.3, 0.84, 1.0, 0.62);
    for (const volume of scene.volumes) {
      gl.bindVertexArray(volume.wire.vao);
      gl.drawArrays(gl.LINES, 0, volume.wire.count);
    }
    gl.disable(gl.BLEND);
  }

  private drawSilhouetteEdges(scene: BoundScene, viewProjection: Float32Array): void {
    const gl = this.gl;
    if (scene.volumes.length === 0) return;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(
      gl.getUniformLocation(this.lineProgram, "uViewProjection"),
      false,
      viewProjection,
    );
    gl.uniform4f(gl.getUniformLocation(this.lineProgram, "uColor"), 1.0, 0.82, 0.2, 1.0);
    gl.lineWidth(2);
    for (const volume of scene.volumes) {
      gl.bindVertexArray(volume.nearEdges.vao);
      gl.drawArrays(gl.LINES, 0, volume.nearEdges.count);
    }
    gl.lineWidth(1);
    gl.disable(gl.BLEND);
  }

  private drawInvalidEdges(scene: BoundScene, viewProjection: Float32Array): void {
    const gl = this.gl;
    if (scene.invalid.length === 0) return;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(
      gl.getUniformLocation(this.lineProgram, "uViewProjection"),
      false,
      viewProjection,
    );
    gl.uniform4f(gl.getUniformLocation(this.lineProgram, "uColor"), 1.0, 0.15, 0.12, 0.92);
    gl.lineWidth(2);
    for (const mesh of scene.invalid) {
      gl.bindVertexArray(mesh.lines.vao);
      gl.drawArrays(gl.LINES, 0, mesh.lines.count);
    }
    if (scene.markers) {
      gl.bindVertexArray(scene.markers.vao);
      gl.drawArrays(gl.LINES, 0, scene.markers.count);
    }
    gl.lineWidth(1);
    gl.disable(gl.BLEND);
  }

  private resetState(): void {
    const gl = this.gl;
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    gl.stencilMask(0xff);
  }

  private requireScene(): BoundScene {
    if (!this.boundScene) throw new Error("尚未绑定场景");
    return this.boundScene;
  }

  renderShadowMask(camera: CameraView): {
    width: number;
    height: number;
    pixels: Uint8Array;
  } {
    const gl = this.gl;
    const scene = this.requireScene();
    const aspect = Math.max(1, this.canvas.width) / Math.max(1, this.canvas.height);
    const width = 320;
    const height = Math.max(120, Math.min(260, Math.round(width / aspect)));
    const target = this.ensureMaskTarget(width, height);
    const viewProjection = this.viewProjection(camera, width / height);

    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.stencilMask(0xff);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clearStencil(0);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.STENCIL_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.colorMask(false, false, false, false);
    gl.useProgram(this.meshProgram);
    gl.uniformMatrix4fv(
      gl.getUniformLocation(this.meshProgram, "uViewProjection"),
      false,
      viewProjection,
    );
    gl.uniform1f(gl.getUniformLocation(this.meshProgram, "uOverlay"), 1);
    gl.uniform1f(gl.getUniformLocation(this.meshProgram, "uOpacity"), 1);
    gl.uniform3f(gl.getUniformLocation(this.meshProgram, "uBaseColor"), 0, 0, 0);
    gl.uniform1f(gl.getUniformLocation(this.meshProgram, "uGround"), 0);
    gl.uniform1f(gl.getUniformLocation(this.meshProgram, "uLightPower"), 0);
    for (const mesh of scene.receivers) {
      gl.bindVertexArray(mesh.triangles.vao);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.triangles.count);
    }

    this.stencilVolumePass(scene, viewProjection);
    gl.colorMask(true, true, true, true);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0x00);
    gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.useProgram(this.solidProgram);
    gl.uniform4f(gl.getUniformLocation(this.solidProgram, "uColor"), 1, 1, 1, 1);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    this.resetState();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    return { width, height, pixels };
  }

  private ensureMaskTarget(width: number, height: number): MaskTarget {
    if (
      this.maskTarget &&
      this.maskTarget.width === width &&
      this.maskTarget.height === height
    ) {
      return this.maskTarget;
    }
    const gl = this.gl;
    if (this.maskTarget) this.releaseMaskTarget();
    const color = gl.createTexture();
    const depthStencil = gl.createRenderbuffer();
    const framebuffer = gl.createFramebuffer();
    if (!color || !depthStencil || !framebuffer) throw new Error("无法创建验证帧缓冲");
    gl.bindTexture(gl.TEXTURE_2D, color);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthStencil);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      color,
      0,
    );
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_STENCIL_ATTACHMENT,
      gl.RENDERBUFFER,
      depthStencil,
    );
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(color);
      gl.deleteRenderbuffer(depthStencil);
      throw new Error(`验证帧缓冲不完整: 0x${status.toString(16)}`);
    }
    this.maskTarget = { width, height, framebuffer, color, depthStencil };
    return this.maskTarget;
  }

  private releaseMaskTarget(): void {
    if (!this.maskTarget) return;
    const gl = this.gl;
    gl.deleteFramebuffer(this.maskTarget.framebuffer);
    gl.deleteTexture(this.maskTarget.color);
    gl.deleteRenderbuffer(this.maskTarget.depthStencil);
    this.maskTarget = null;
  }

  private releaseMesh(mesh: GpuMesh): void {
    deleteMeshVao(this.gl, mesh.triangles);
    deletePositionVao(this.gl, mesh.lines);
  }

  private releaseScene(): void {
    if (!this.boundScene) return;
    this.releaseMesh(this.boundScene.ground);
    for (const mesh of this.boundScene.casters) this.releaseMesh(mesh);
    for (const mesh of this.boundScene.invalid) this.releaseMesh(mesh);
    for (const volume of this.boundScene.volumes) {
      deletePositionVao(this.gl, volume.fill);
      deletePositionVao(this.gl, volume.wire);
      deletePositionVao(this.gl, volume.nearEdges);
    }
    if (this.boundScene.markers) deletePositionVao(this.gl, this.boundScene.markers);
    this.boundScene = null;
  }

  destroy(): void {
    this.releaseScene();
    this.releaseMaskTarget();
    const gl = this.gl;
    gl.deleteVertexArray(this.emptyVao);
    gl.deleteProgram(this.backgroundProgram);
    gl.deleteProgram(this.meshProgram);
    gl.deleteProgram(this.volumeProgram);
    gl.deleteProgram(this.lineProgram);
    gl.deleteProgram(this.solidProgram);
  }
}
