import { createProgram, Target, MultiTarget, createDepthTexture } from './gl-utils.js';
import { buildHemisphereKernel, buildNoiseTexture } from './sampling.js';
import { mat4 } from './math.js';

const VERT = {
  fullscreen: null,
  gbuffer: null
};

export class Renderer {
  constructor(canvas, shaderSources) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      preserveDrawingBuffer: true,
      depth: true
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.ext = {
      timer: gl.getExtension('EXT_disjoint_timer_query_webgl2'),
      colorBufferFloat: gl.getExtension('EXT_color_buffer_float')
    };
    if (!this.ext.colorBufferFloat) {
      throw new Error('EXT_color_buffer_float is required for float render targets');
    }
    this.shaderSources = shaderSources;
    this.params = {
      kernelSize: 32,
      radius: 0.85,
      depthBias: 0.025,
      intensity: 1.6,
      rangeCheck: 1.0,
      blur: true,
      viewMode: 0
    };
    this.kernel = buildHemisphereKernel(64);
    this._initPrograms();
    this._initQuad();
    this.noiseTex = buildNoiseTexture(gl);
    this.timers = [];
  }

  _initPrograms() {
    const s = this.shaderSources;
    this.programs = {
      gbuffer: createProgram(this.gl, s.gbufferVert, s.gbufferFrag),
      normal: createProgram(this.gl, s.fullscreenVert, s.normalFrag),
      ssao: createProgram(this.gl, s.fullscreenVert, s.ssaoFrag),
      blur: createProgram(this.gl, s.fullscreenVert, s.blurFrag),
      composite: createProgram(this.gl, s.fullscreenVert, s.compositeFrag)
    };
    this.locations = {};
    for (const [name, prog] of Object.entries(this.programs)) {
      const count = this.gl.getProgramParameter(prog, this.gl.ACTIVE_UNIFORMS);
      const locs = {};
      for (let i = 0; i < count; i++) {
        const info = this.gl.getActiveUniform(prog, i);
        const base = info.name.replace('[0]', '');
        locs[base] = this.gl.getUniformLocation(prog, info.name);
      }
      this.locations[name] = locs;
    }
  }

  _initQuad() {
    // Dummy VAO for fullscreen-triangle passes (positions come from gl_VertexID).
    this.quadVao = this.gl.createVertexArray();
  }

  uploadMeshes(objects) {
    const gl = this.gl;
    this.meshes = objects.map((obj) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, obj.mesh.positions, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      const nrmBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf);
      gl.bufferData(gl.ARRAY_BUFFER, obj.mesh.normals, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      const indexBuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, obj.mesh.indices, gl.STATIC_DRAW);
      return {
        vao,
        count: obj.mesh.indices.length,
        model: obj.model,
        albedo: obj.albedo
      };
    });
    gl.bindVertexArray(null);
  }

  resize(width, height) {
    const gl = this.gl;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    // G-buffer: albedo RGBA8 + linear depth R32F, plus hardware depth.
    this.gbuffer = new MultiTarget(gl, width, height, [
      { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE },
      { internal: gl.R32F, format: gl.RED, type: gl.FLOAT }
    ]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gbuffer.fbo);
    this.depthTex = createDepthTexture(gl, width, height);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTex, 0);

    this.normalTarget = new Target(gl, width, height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    this.aoTarget = new Target(gl, width, height, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.NEAREST);
    this.aoBlurTarget = new Target(gl, width, height, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.LINEAR);
  }

  setCamera(view, proj) {
    this.view = view;
    this.proj = proj;
    this.viewProj = mat4.multiply(proj, view);
  }

  _use(name) {
    const gl = this.gl;
    gl.useProgram(this.programs[name]);
    return this.locations[name];
  }

  _bindTex(unit, texture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  _drawQuad() {
    const gl = this.gl;
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _startGpuTimer() {
    const ext = this.ext.timer;
    if (!ext) return null;
    const query = this.gl.createQuery();
    this.gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    return query;
  }

  _endGpuTimer(query) {
    if (!query) return;
    this.gl.endQuery(this.ext.timer.TIME_ELAPSED_EXT);
    this.timers.push(query);
  }

  // Reclaim finished timer queries; returns GPU ms available so far.
  collectGpuTimings() {
    const gl = this.gl;
    const ext = this.ext.timer;
    const values = [];
    if (!ext) return values;
    this.timers = this.timers.filter((q) => {
      const available = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE);
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      if (available && !disjoint) {
        values.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
        return false;
      }
      return !available;
    });
    return values;
  }

  renderGbuffer() {
    const gl = this.gl;
    const loc = this._use('gbuffer');
    this.gbuffer.bind();
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(loc.uViewProj, false, this.viewProj);
    gl.uniformMatrix4fv(loc.uView, false, this.view);
    for (const mesh of this.meshes) {
      gl.bindVertexArray(mesh.vao);
      gl.uniformMatrix4fv(loc.uModel, false, mesh.model);
      gl.uniform3fv(loc.uAlbedo, mesh.albedo);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    }
    gl.disable(gl.DEPTH_TEST);
  }

  renderNormals() {
    const gl = this.gl;
    const loc = this._use('normal');
    this.normalTarget.bind();
    this._bindTex(0, this.gbuffer.textures[1]);
    gl.uniform1i(loc.uDepth, 0);
    gl.uniform2f(loc.uTexelSize, 1 / this.width, 1 / this.height);
    gl.uniformMatrix4fv(loc.uProj, false, this.proj);
    gl.uniform1f(loc.uDepthEdge, 0.05);
    this._drawQuad();
  }

  renderSsao() {
    const gl = this.gl;
    const loc = this._use('ssao');
    this.aoTarget.bind();
    this._bindTex(0, this.gbuffer.textures[1]);
    this._bindTex(1, this.normalTarget.texture);
    this._bindTex(2, this.noiseTex);
    gl.uniform1i(loc.uDepth, 0);
    gl.uniform1i(loc.uNormal, 1);
    gl.uniform1i(loc.uNoise, 2);
    gl.uniformMatrix4fv(loc.uProj, false, this.proj);
    gl.uniform3fv(loc.uSamples, this.kernel);
    gl.uniform1i(loc.uKernelSize, this.params.kernelSize);
    gl.uniform1f(loc.uRadius, this.params.radius);
    gl.uniform1f(loc.uDepthBias, this.params.depthBias);
    gl.uniform1f(loc.uIntensity, this.params.intensity);
    gl.uniform1f(loc.uRangeCheck, this.params.rangeCheck);
    this._drawQuad();
  }

  renderBlur() {
    const gl = this.gl;
    const loc = this._use('blur');
    this.aoBlurTarget.bind();
    this._bindTex(0, this.aoTarget.texture);
    this._bindTex(1, this.gbuffer.textures[1]);
    gl.uniform1i(loc.uAo, 0);
    gl.uniform1i(loc.uDepth, 1);
    gl.uniform2f(loc.uTexelSize, 1 / this.width, 1 / this.height);
    gl.uniform1f(loc.uDepthEdge, 0.05);
    this._drawQuad();
  }

  renderComposite() {
    const gl = this.gl;
    const loc = this._use('composite');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    const aoTex = this.params.blur ? this.aoBlurTarget.texture : this.aoTarget.texture;
    this._bindTex(0, this.gbuffer.textures[0]);
    this._bindTex(1, aoTex);
    this._bindTex(2, this.normalTarget.texture);
    this._bindTex(3, this.gbuffer.textures[1]);
    gl.uniform1i(loc.uColor, 0);
    gl.uniform1i(loc.uAo, 1);
    gl.uniform1i(loc.uNormal, 2);
    gl.uniform1i(loc.uDepth, 3);
    gl.uniform1i(loc.uViewMode, this.params.viewMode);
    const lightView = [0.4, 0.7, 0.55];
    gl.uniform3fv(loc.uLightDirView, lightView);
    this._drawQuad();
  }

  frame() {
    const q = this._startGpuTimer();
    this.renderGbuffer();
    this.renderNormals();
    this.renderSsao();
    if (this.params.blur) this.renderBlur();
    this.renderComposite();
    this.gl.flush();
    this._endGpuTimer(q);
  }

  readPixels(target) {
    const gl = this.gl;
    target.bind();
    const pixels = new Uint8Array(this.width * this.height * 4);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }

  // Reads the canvas (default framebuffer). Call after composite so the
  // 8-bit result reflects the currently selected view mode.
  readCanvas() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    const pixels = new Uint8Array(this.width * this.height * 4);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }

  // Renders one view mode into the canvas and returns its pixels (y-up).
  captureView(viewMode, restore = true) {
    const previous = this.params.viewMode;
    this.params.viewMode = viewMode;
    this.renderComposite();
    const pixels = this.readCanvas();
    if (restore) {
      this.params.viewMode = previous;
      this.renderComposite();
    }
    return pixels;
  }
}
