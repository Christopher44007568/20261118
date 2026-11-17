// 轻量 WebGL2 mock：只实现演示代码用到的调用，记录资源与调用序列。

function id(prefix, n) { return { __id: `${prefix}${n}` }; }

export function createMockGL() {
  let counter = 0;
  const calls = [];
  const textures = new Map();
  const renderbuffers = new Map();
  const framebuffers = new Map();
  const attachments = new Map();
  let currentFbo = null;

  const gl = {
    // 常量
    VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
    RENDERBUFFER: 0x8d41, RGBA8: 0x8058, SAMPLES: 0x80a9,
    MAX_SAMPLES: 0x8d57,
    FRAMEBUFFER: 0x8d40, READ_FRAMEBUFFER: 0x8ca8, DRAW_FRAMEBUFFER: 0x8ca9,
    COLOR_ATTACHMENT0: 0x8ce0, DEPTH_ATTACHMENT: 0x8d00,
    FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE: 0x8cd0, NONE: 0,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    FRAMEBUFFER_INCOMPLETE_MULTISAMPLE: 0x8d56,
    TEXTURE_2D: 0xde1, TEXTURE0: 0x84c0,
    TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
    LINEAR: 0x2601, CLAMP_TO_EDGE: 0x812f,
    RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, DEPTH_COMPONENT24: 0x81a6,
    COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x100,
    NEAREST: 0x2600, ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406, TRIANGLES: 4, DEPTH_TEST: 0x0b71, LEQUAL: 0x0203,
    QUERY_RESULT_AVAILABLE: 0x8867, QUERY_RESULT: 0x8866,

    createShader: () => id('shader', ++counter),
    shaderSource() {}, compileShader() {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    deleteShader() {},
    createProgram: () => { const p = id('program', ++counter); return p; },
    attachShader() {}, linkProgram() {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    deleteProgram() {},
    getAttribLocation: () => 0,
    getUniformLocation: () => id('uniform', ++counter),
    useProgram() {}, uniformMatrix3fv() {}, uniform1i() {},
    uniform1f() {}, uniform4f() {},

    createTexture: () => {
      const t = id('tex', ++counter);
      textures.set(t, { storage: null });
      return t;
    },
    deleteTexture: (t) => textures.delete(t),
    bindTexture() {},
    texImage2D(target, level, ifmt, w, h) {
      calls.push(['texImage2D', w, h]);
    },
    texParameteri() {},

    createRenderbuffer: () => {
      const r = id('rb', ++counter);
      renderbuffers.set(r, { samples: 0, format: 0, w: 0, h: 0 });
      return r;
    },
    deleteRenderbuffer: (r) => renderbuffers.delete(r),
    bindRenderbuffer() {},
    renderbufferStorage(target, format, w, h) {
      calls.push(['renderbufferStorage', format, w, h]);
    },
    renderbufferStorageMultisample(target, samples, format, w, h) {
      calls.push(['renderbufferStorageMultisample', samples, format, w, h]);
    },

    createFramebuffer: () => {
      const f = id('fbo', ++counter);
      framebuffers.set(f, true);
      attachments.set(f, {});
      return f;
    },
    deleteFramebuffer: (f) => { framebuffers.delete(f); attachments.delete(f); },
    bindFramebuffer(target, fbo) {
      if (target === gl.FRAMEBUFFER) currentFbo = fbo;
      calls.push(['bindFramebuffer', target, fbo && fbo.__id]);
    },
    framebufferTexture2D(target, attachment, texTarget, tex) {
      if (attachments.has(currentFbo)) {
        attachments.get(currentFbo)[attachment] = { kind: 'texture', obj: tex };
      }
      calls.push(['framebufferTexture2D', attachment]);
    },
    framebufferRenderbuffer(target, attachment, rbTarget, rb) {
      if (attachments.has(currentFbo)) {
        attachments.get(currentFbo)[attachment] = { kind: 'renderbuffer', obj: rb };
      }
      calls.push(['framebufferRenderbuffer', attachment]);
    },
    checkFramebufferStatus: () => gl.FRAMEBUFFER_COMPLETE,
    getFramebufferAttachmentParameter(target, attachment) {
      const att = attachments.get(currentFbo) || {};
      return att[attachment] ? 1 : gl.NONE;
    },
    blitFramebuffer(sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1, mask, filter) {
      calls.push(['blitFramebuffer', mask, filter]);
    },

    createBuffer: () => id('buf', ++counter),
    deleteBuffer() {}, bindBuffer() {}, bufferData() {},
    enableVertexAttribArray() {}, vertexAttribPointer() {},
    drawArrays() {},

    enable() {}, disable() {}, depthFunc() {},
    clearColor() {}, clear(mask) { calls.push(['clear', mask]); },
    viewport() {}, activeTexture() {},
    readPixels(x, y, w, h, format, type, dest) {
      calls.push(['readPixels', w, h]);
      // 填充确定性的测试图案：左半背景色(10,14,24)，右半前景色(200,80,80)
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const i = (py * w + px) * 4;
          const fg = px >= w / 2;
          dest[i] = fg ? 250 : 10;
          dest[i + 1] = fg ? 77 : 14;
          dest[i + 2] = fg ? 77 : 24;
          dest[i + 3] = 255;
        }
      }
    },
    getInternalformatParameter: () => [0, 2, 4, 8],
    getParameter: (p) => (p === gl.MAX_SAMPLES ? 8 : 0),
    getExtension: () => null,

    _calls: calls,
    _attachments: attachments,
    _framebuffers: framebuffers,
  };
  return gl;
}

// 浏览器全局桩，供依赖 document 的模块在 Node 中加载。
globalThis.performance = { now: () => Date.now() };
