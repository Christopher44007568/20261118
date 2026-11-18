'use strict';

const GLU = {
  createProgram(gl, vsSrc, fsSrc) {
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error('Shader compile error: ' + log + '\n' + src);
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Program link error: ' + gl.getProgramInfoLog(prog));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    const uniforms = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      uniforms[info.name.replace('[0]', '')] = {
        loc: gl.getUniformLocation(prog, info.name),
        type: info.type, size: info.size
      };
    }
    return { prog, uniforms, attribs: {} };
  },

  mesh(gl, data) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.verts), gl.STATIC_DRAW);
    const stride = data.stride * 4;
    for (const a of data.attribs) {
      gl.enableVertexAttribArray(a.loc);
      gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, stride, a.offset * 4);
    }
    let ibo = null;
    if (data.indices) {
      ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(data.indices), gl.STATIC_DRAW);
    }
    gl.bindVertexArray(null);
    return {
      vao, vbo, ibo,
      count: data.indices ? data.indices.length : data.verts.length / data.stride,
      indexed: !!data.indices
    };
  },

  createTarget(gl, w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('FBO incomplete: ' + status);
    return { fbo, tex, depth, w, h };
  },

  resizeTarget(gl, target, w, h) {
    if (target && target.w === w && target.h === h) return target;
    if (target) {
      gl.deleteFramebuffer(target.fbo);
      gl.deleteTexture(target.tex);
      gl.deleteRenderbuffer(target.depth);
    }
    return GLU.createTarget(gl, w, h);
  },

  setUniforms(gl, locs, values) {
    for (const key of Object.keys(values)) {
      const slot = locs[key];
      if (!slot || !slot.loc) continue;
      const loc = slot.loc;
      const v = values[key];
      switch (slot.type) {
        case gl.FLOAT:
          gl.uniform1f(loc, v); break;
        case gl.INT:
        case gl.BOOL:
        case gl.SAMPLER_2D:
          gl.uniform1i(loc, v | 0); break;
        case gl.FLOAT_VEC2:
          gl.uniform2fv(loc, v); break;
        case gl.FLOAT_VEC3:
          gl.uniform3fv(loc, v); break;
        case gl.FLOAT_VEC4:
          gl.uniform4fv(loc, v); break;
        case gl.FLOAT_MAT4:
          gl.uniformMatrix4fv(loc, false, v); break;
        default:
          gl.uniform1f(loc, v);
      }
    }
  }
};
