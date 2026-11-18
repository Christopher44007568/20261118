/*
 * WebGL2 渲染器：
 * - 为 depth24 / depth32f / reverse-z 分别创建对应格式的深度纹理 FBO；
 * - 同一几何场景渲染两次（基准帧 + 相机微抖动帧）；
 * - 分析 pass 比较两帧量化后的深度，原子计数器输出 z-fighting / 闪烁像素；
 * - 可选深度分层条纹可视化。
 */
(function (root) {
  const VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aColor;
uniform mat4 uProj;
uniform mat4 uModel;
uniform mat4 uView;
uniform vec3 uEyeOffset;
out vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uProj * uView * uModel * vec4(aPos + uEyeOffset, 1.0);
}`;

  const FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor, 1.0); }`;

  const FULLSCREEN_VERT = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  const ANALYSIS_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uDepthWall0;
uniform sampler2D uDepthDecal0;
uniform sampler2D uDepthWall1;
uniform sampler2D uDepthDecal1;
uniform sampler2D uColorScene;
uniform float uTiltScale;
uniform int uShowStripes;
uniform int uReverse;
layout(location = 0) out vec4 outColor;
layout(location = 1) out uint outTag;

float stripe(vec3 c, float d) {
  float band = fract(d * uTiltScale);
  return mix(0.72, 1.18, band);
}

void main() {
  float wall0 = texture(uDepthWall0, vUv).r;
  float decal0 = texture(uDepthDecal0, vUv).r;
  float wall1 = texture(uDepthWall1, vUv).r;
  float decal1 = texture(uDepthDecal1, vUv).r;
  vec3 sceneColor = texture(uColorScene, vUv).rgb;
  // 仅在贴片覆盖区域统计：标准 Z 清空值为 1，反向 Z 清空值为 0
  bool covered0 = uReverse == 1 ? decal0 > 0.0 : decal0 < 1.0;
  bool covered1 = uReverse == 1 ? decal1 > 0.0 : decal1 < 1.0;
  bool overlap = covered0 && covered1;
  // 同帧同像素：墙面与贴片量化后的存储深度完全相同 => z-fighting
  bool sameDepth0 = wall0 == decal0;
  bool sameDepth1 = wall1 == decal1;
  // 抖动前后，深度比较结果翻转 => 接触闪烁
  bool ownerChanged = sameDepth0 != sameDepth1;

  uint tag = 0u;
  if (covered0 && sameDepth0) tag = tag | 1u;
  if (overlap && ownerChanged) tag = tag | 2u;
  outTag = tag;

  vec3 base = sceneColor;
  if (uShowStripes == 1) {
    base *= stripe(base, decal0);
  }
  if (covered0 && sameDepth0) {
    base = mix(base, vec3(1.0, 0.35, 0.35), 0.55);
  } else if (overlap && ownerChanged) {
    base = mix(base, vec3(1.0, 0.85, 0.3), 0.45);
  }
  outColor = vec4(base, 1.0);
}`;

  function compile(gl, type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`着色器编译失败: ${log}`);
    }
    return shader;
  }

  function program(gl, vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`程序链接失败: ${gl.getProgramInfoLog(p)}`);
    }
    return p;
  }

  class DepthRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext("webgl2", {
        antialias: false,
        alpha: false,
        preserveDrawingBuffer: false,
      });
      if (!gl) throw new Error("WEBGL2_UNAVAILABLE");
      this.gl = gl;
      this.extFloat = gl.getExtension("EXT_color_buffer_float");
      this.sceneProgram = program(gl, VERT, FRAG);
      this.analysisProgram = program(gl, FULLSCREEN_VERT, ANALYSIS_FRAG);
      this.uniScene = {
        proj: gl.getUniformLocation(this.sceneProgram, "uProj"),
        model: gl.getUniformLocation(this.sceneProgram, "uModel"),
        view: gl.getUniformLocation(this.sceneProgram, "uView"),
        eyeOffset: gl.getUniformLocation(this.sceneProgram, "uEyeOffset"),
      };
      this.uniAnalysis = {
        depthWall0: gl.getUniformLocation(this.analysisProgram, "uDepthWall0"),
        depthDecal0: gl.getUniformLocation(this.analysisProgram, "uDepthDecal0"),
        depthWall1: gl.getUniformLocation(this.analysisProgram, "uDepthWall1"),
        depthDecal1: gl.getUniformLocation(this.analysisProgram, "uDepthDecal1"),
        colorScene: gl.getUniformLocation(this.analysisProgram, "uColorScene"),
        reverse: gl.getUniformLocation(this.analysisProgram, "uReverse"),
        tiltScale: gl.getUniformLocation(this.analysisProgram, "uTiltScale"),
        showStripes: gl.getUniformLocation(this.analysisProgram, "uShowStripes"),
      };
      this.width = canvas.width;
      this.height = canvas.height;
      this.frame = null;
      this.meshes = this.buildMeshes();
      this.fullscreenVao = this.buildFullscreenVao();
      this.outputTarget = this.createOutputTarget();
    }

    createOutputTarget() {
      const gl = this.gl;
      const color = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, color);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      // 每像素分类标记：bit0 = 深度冲突，bit1 = 所有权闪烁
      const tag = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tag);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32UI, this.width, this.height, 0,
        gl.RED_INTEGER, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, tag, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`分析 FBO 不完整: 0x${status.toString(16)}`);
      }
      return { fbo, color, tag };
    }

    createDepthFrame(mode) {
      const gl = this.gl;
      const depthFormat =
        mode === "depth24" ? gl.DEPTH_COMPONENT24 : gl.DEPTH_COMPONENT32F;
      const depthType =
        mode === "depth24" ? gl.UNSIGNED_INT : gl.FLOAT;
      const depth = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, depth);
      gl.texImage2D(gl.TEXTURE_2D, 0, depthFormat, this.width, this.height, 0,
        gl.DEPTH_COMPONENT, depthType, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const color = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, color);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D, color, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
        gl.TEXTURE_2D, depth, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`深度 FBO 不完整: 0x${status.toString(16)}（${mode}）`);
      }
      return { fbo, color, depth };
    }

    ensureFrame(mode) {
      if (this.frame && this.frame.mode === mode) return this.frame;
      if (this.frame) {
        const gl = this.gl;
        Object.values(this.frame.targets).forEach((target) => {
          gl.deleteFramebuffer(target.fbo);
          gl.deleteTexture(target.color);
          gl.deleteTexture(target.depth);
        });
      }
      this.frame = {
        mode,
        targets: {
          wall0: this.createDepthFrame(mode),
          decal0: this.createDepthFrame(mode),
          scene0: this.createDepthFrame(mode),
          wall1: this.createDepthFrame(mode),
          decal1: this.createDepthFrame(mode),
          scene1: this.createDepthFrame(mode),
        },
      };
      return this.frame;
    }

    makeVao(vertices, indices) {
      const gl = this.gl;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
      const ebo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
      gl.bindVertexArray(null);
      return { vao, count: indices.length };
    }

    // 以中心为原点的薄盒（沿 +Z 很薄），6 个面 24 顶点，顶点数据 pos+color
    boxMesh(hx, hy, hz, colorFront, colorSide) {
      const c = colorFront;
      const s = colorSide;
      const faces = [
        // 法线 +Z（朝向相机）
        [[-hx, -hy, hz, ...c], [hx, -hy, hz, ...c], [hx, hy, hz, ...c], [-hx, hy, hz, ...c]],
        // 法线 -Z
        [[-hx, -hy, -hz, ...s], [hx, -hy, -hz, ...s], [hx, hy, -hz, ...s], [-hx, hy, -hz, ...s]],
        // +X
        [[hx, -hy, -hz, ...s], [hx, -hy, hz, ...s], [hx, hy, hz, ...s], [hx, hy, -hz, ...s]],
        // -X
        [[-hx, -hy, hz, ...s], [-hx, -hy, -hz, ...s], [-hx, hy, -hz, ...s], [-hx, hy, hz, ...s]],
        // +Y
        [[-hx, hy, -hz, ...s], [hx, hy, -hz, ...s], [hx, hy, hz, ...s], [-hx, hy, hz, ...s]],
        // -Y
        [[-hx, -hy, hz, ...s], [hx, -hy, hz, ...s], [hx, -hy, -hz, ...s], [-hx, -hy, -hz, ...s]],
      ];
      const vertices = [];
      const indices = [];
      faces.forEach((quad, faceIndex) => {
        quad.forEach((v) => vertices.push(...v));
        const base = faceIndex * 4;
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      });
      return this.makeVao(vertices, indices);
    }

    buildMeshes() {
      // 颜色编码各表面归属，分析 pass 用它判断闪烁时的所有权切换
      return {
        wall: this.boxMesh(3.2, 2.2, 0.05, [0.32, 0.46, 0.62], [0.2, 0.3, 0.42]),
        decal: this.boxMesh(1.15, 1.15, 0.004, [0.92, 0.44, 0.28], [0.6, 0.26, 0.16]),
        sheet: this.boxMesh(0.55, 0.75, 0.012, [0.36, 0.82, 0.62], [0.22, 0.55, 0.42]),
      };
    }

    buildFullscreenVao() {
      const gl = this.gl;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1,
      ]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      return vao;
    }

    translation(tx, ty, tz) {
      return new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        tx, ty, tz, 1,
      ]);
    }

    // 沿 X 轴微倾斜的贴片模型，让同一表面在屏幕上扫过多个量化桶，形成可见条纹
    tiltedDecal(tz, slope) {
      const m = new Float32Array(16);
      m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
      m[8] = slope;   // 世界 Z = slope * 局部 X + tz
      m[14] = tz;
      return m;
    }

    preparePass(frameTarget, scene) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, frameTarget.fbo);
      gl.viewport(0, 0, this.width, this.height);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(scene.reverse ? gl.GREATER : gl.LEQUAL);
      gl.clearDepth(scene.reverse ? 0 : 1);
      gl.clearColor(0.05, 0.07, 0.1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.sceneProgram);
    }

    drawMesh(mesh, model, proj, jitterZ) {
      const gl = this.gl;
      gl.uniformMatrix4fv(this.uniScene.proj, false, proj);
      gl.uniformMatrix4fv(this.uniScene.view, false, this.viewMatrix);
      gl.uniform3f(this.uniScene.eyeOffset, 0, 0, jitterZ || 0);
      gl.bindVertexArray(mesh.vao);
      gl.uniformMatrix4fv(this.uniScene.model, false, model);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
      gl.bindVertexArray(null);
    }

    renderAllPasses(frame, proj, scene) {
      const t = frame.targets;
      // 基准帧（jitter = 0）：墙、贴片、完整合成场景
      this.preparePass(t.wall0, scene);
      this.drawMesh(this.meshes.wall,
        this.translation(0.35, 0, -scene.wallZ), proj, 0);
      this.preparePass(t.decal0, scene);
      this.drawMesh(this.meshes.decal,
        this.tiltedDecal(-(scene.wallZ - scene.gap), scene.slope), proj, 0);
      this.preparePass(t.scene0, scene);
      this.drawMesh(this.meshes.sheet,
        this.translation(-1.45, 0.35, -scene.sheetZ), proj, 0);
      this.drawMesh(this.meshes.wall,
        this.translation(0.35, 0, -scene.wallZ), proj, 0);
      this.drawMesh(this.meshes.decal,
        this.tiltedDecal(-(scene.wallZ - scene.gap), scene.slope), proj, 0);

      // 抖动帧：沿 +Z 平移几何，等价于相机靠近 jitter
      const j = scene.jitter;
      this.preparePass(t.wall1, scene);
      this.drawMesh(this.meshes.wall,
        this.translation(0.35, 0, -scene.wallZ), proj, j);
      this.preparePass(t.decal1, scene);
      this.drawMesh(this.meshes.decal,
        this.tiltedDecal(-(scene.wallZ - scene.gap), scene.slope), proj, j);
      this.preparePass(t.scene1, scene);
      this.drawMesh(this.meshes.sheet,
        this.translation(-1.45, 0.35, -scene.sheetZ), proj, j);
      this.drawMesh(this.meshes.wall,
        this.translation(0.35, 0, -scene.wallZ), proj, j);
      this.drawMesh(this.meshes.decal,
        this.tiltedDecal(-(scene.wallZ - scene.gap), scene.slope), proj, j);
    }

    runAnalysis(frame, scene) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.outputTarget.fbo);
      gl.viewport(0, 0, this.width, this.height);
      gl.disable(gl.DEPTH_TEST);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.useProgram(this.analysisProgram);
      const t = frame.targets;
      const bind = (unit, uniform, texture) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(uniform, unit);
      };
      bind(0, this.uniAnalysis.depthWall0, t.wall0.depth);
      bind(1, this.uniAnalysis.depthDecal0, t.decal0.depth);
      bind(2, this.uniAnalysis.depthWall1, t.wall1.depth);
      bind(3, this.uniAnalysis.depthDecal1, t.decal1.depth);
      bind(4, this.uniAnalysis.colorScene, t.scene0.color);
      gl.uniform1i(this.uniAnalysis.reverse, scene.reverse ? 1 : 0);
      gl.uniform1f(this.uniAnalysis.tiltScale, scene.stripeScale);
      gl.uniform1i(this.uniAnalysis.showStripes, scene.showStripes ? 1 : 0);
      gl.bindVertexArray(this.fullscreenVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      const pixels = new Uint32Array(this.width * this.height);
      gl.readBuffer(gl.COLOR_ATTACHMENT1);
      gl.readPixels(0, 0, this.width, this.height,
        gl.RED_INTEGER, gl.UNSIGNED_INT, pixels);
      let zFightPixels = 0;
      let flickerPixels = 0;
      for (let i = 0; i < pixels.length; i += 1) {
        if (pixels[i] & 1) zFightPixels += 1;
        if (pixels[i] & 2) flickerPixels += 1;
      }
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      return { zFightPixels, flickerPixels };
    }

    blitToScreen() {
      const gl = this.gl;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.outputTarget.fbo);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, this.width, this.height,
        0, 0, this.width, this.height,
        gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    render(scene) {
      const frame = this.ensureFrame(scene.depthMode);
      const reverse = scene.depthMode === "reverse";
      const proj = root.DepthMath.perspective(
        scene.fovy, this.width / this.height, scene.near, scene.far, reverse
      );
      // 相机位于原点看向 -Z：视图矩阵为单位阵，几何直接以眼空间坐标放置
      this.viewMatrix = new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]);
      this.renderAllPasses(frame, proj, scene);
      const counters = this.runAnalysis(frame, scene);
      this.blitToScreen();
      return counters;
    }
  }

  root.DepthRenderer = DepthRenderer;
})(typeof self !== "undefined" ? self : globalThis);
