// 深度安全检查：
// 1. resolve FBO 不含深度附件（深度不会随纹理流入后续阶段）
// 2. 行为测试：同一 FBO 渲染两帧，第二帧“不清除深度 + 拉近几何”，
//    比较清除/不清除两条路径的像素，证明残留深度会错误遮挡下一帧。
export class DepthGuard {
  constructor(gl, logger) {
    this.gl = gl;
    this.logger = logger;
  }

  structuralChecks(target) {
    const gl = this.gl;
    const resolveHasDepth = target.resolveFboHasDepth(gl);
    // MSAA 模式 resolve FBO 必须无深度；1x 模式几何与 resolve 共用同一 FBO，深度是必需的。
    const depthLeakRisk = target.samples > 1 ? resolveHasDepth : false;
    const fboOk =
      target.geometryStatus === gl.FRAMEBUFFER_COMPLETE &&
      target.resolveStatus === gl.FRAMEBUFFER_COMPLETE;
    return {
      resolveHasDepth,
      depthLeakRisk,
      fboOk,
      geometryStatus: target.geometryStatusString,
      resolveStatus: target.resolveStatusString,
    };
  }

  // 在独立的小 FBO 中做受控对比，不干扰主场景。
  runBehaviorTest(programInfo) {
    const gl = this.gl;
    const size = 64;
    const fbo = gl.createFramebuffer();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, size, size);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER, depth);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW);

    const draw = (z, r, g, b) => {
      gl.useProgram(programInfo.program);
      gl.uniform4f(programInfo.uColor, r, g, b, 1);
      gl.uniform1f(programInfo.uDepth, z);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(programInfo.aPos);
      gl.vertexAttribPointer(programInfo.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    const runPath = (clearDepthOnFrame2) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, size, size);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      // 第 1 帧：近处红色 (z=0.2)，深度缓冲写入 0.2
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      draw(0.2, 1, 0, 0);
      // 第 2 帧：远处绿色 (z=0.8)。若深度被正确清除，绿色可见；
      // 若残留 0.2，0.8 <= 0.2 失败，绿色被错误遮挡，画面仍是红色。
      gl.clearColor(0, 0, 0, 1);
      if (clearDepthOnFrame2) gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      else gl.clear(gl.COLOR_BUFFER_BIT);
      draw(0.8, 0, 1, 0);
      const out = new Uint8Array(4);
      gl.readPixels(size >> 1, size >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return out;
    };

    const correct = runPath(true);
    const leaked = runPath(false);

    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    gl.deleteRenderbuffer(depth);
    gl.deleteBuffer(vbo);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return {
      correct: Array.from(correct),
      leaked: Array.from(leaked),
      correctVisible: correct[1] > 200 && correct[0] < 50,
      // 残留深度使第二帧绘制全部失败：颜色缓冲停留在 clear 后的黑色（或被旧内容占据），
      // 判定标准是“本应可见的绿色没有出现”，不依赖具体残留颜色。
      leakedWrong: !(leaked[1] > 200 && leaked[0] < 50),
    };
  }
}

export function createDepthTestProgram(gl) {
  const vs = `#version 300 es
    in vec2 aPos; uniform float uDepth;
    void main() { gl_Position = vec4(aPos, uDepth, 1.0); }`;
  const fs = `#version 300 es
    precision mediump float; uniform vec4 uColor; out vec4 frag;
    void main() { frag = uColor; }`;
  const vsShader = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vsShader, vs);
  gl.compileShader(vsShader);
  const fsShader = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fsShader, fs);
  gl.compileShader(fsShader);
  const program = gl.createProgram();
  gl.attachShader(program, vsShader);
  gl.attachShader(program, fsShader);
  gl.linkProgram(program);
  gl.deleteShader(vsShader);
  gl.deleteShader(fsShader);
  return {
    program,
    aPos: gl.getAttribLocation(program, 'aPos'),
    uColor: gl.getUniformLocation(program, 'uColor'),
    uDepth: gl.getUniformLocation(program, 'uDepth'),
  };
}
