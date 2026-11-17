export function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('着色器编译失败: ' + log);
  }
  return shader;
}

export function createProgram(gl, vsSource, fsSource) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error('程序链接失败: ' + log);
  }
  return program;
}

// 返回采样数 -> 实际支持的采样数（0 表示不支持）。
export function querySampleSupport(gl) {
  const result = { 1: 1, 2: 0, 4: 0 };
  const supported = gl.getInternalformatParameter(
    gl.RENDERBUFFER, gl.RGBA8, gl.SAMPLES
  );
  for (const samples of [2, 4]) {
    if (supported && supported.indexOf(samples) !== -1) {
      result[samples] = samples;
    } else if (supported && supported.length > 0) {
      // 设备不支持请求的采样数时，驱动会把 renderbuffer 提升到最接近的更高档。
      const higher = supported
        .slice()
        .sort((a, b) => a - b)
        .filter((value) => value >= samples);
      result[samples] = higher.length ? higher[0] : 0;
    }
  }
  result.max = gl.getParameter(gl.MAX_SAMPLES);
  result.rawSupported = supported ? Array.from(supported) : [];
  return result;
}

export function fboStatusString(gl, status) {
  const map = {
    [gl.FRAMEBUFFER_COMPLETE]: 'FRAMEBUFFER_COMPLETE',
    [gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT]: 'INCOMPLETE_ATTACHMENT',
    [gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT]: 'INCOMPLETE_MISSING_ATTACHMENT',
    [gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS]: 'INCOMPLETE_DIMENSIONS',
    [gl.FRAMEBUFFER_UNSUPPORTED]: 'UNSUPPORTED',
    [gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE]: 'INCOMPLETE_MULTISAMPLE',
  };
  return map[status] || ('UNKNOWN(0x' + status.toString(16) + ')');
}

export class Logger {
  constructor(el, max = 60) {
    this.el = el;
    this.max = max;
  }

  log(msg, level = 'info') {
    const li = document.createElement('li');
    if (level !== 'info') li.className = level;
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    li.innerHTML = '<span class="t">' + time + '</span>' + msg;
    this.el.prepend(li);
    while (this.el.children.length > this.max) {
      this.el.removeChild(this.el.lastChild);
    }
  }
}
