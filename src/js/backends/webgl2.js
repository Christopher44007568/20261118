// WebGL2 decoding backend.
// Preferred path: upload BC bytes through compressedTexImage2D using the
// WEBGL_compressed_texture_s3tc extension, then sample + readPixels so the
// hardware decoder produces the RGBA result. Fallback path: CPU-decoded
// RGBA uploaded through texImage2D when the extension is unavailable.

import { FORMATS, blockDimensions } from '../codec.js';
import { decodeImage } from '../codec.js';

export function isAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!canvas.getContext('webgl2');
  } catch {
    return false;
  }
}

export function capabilities() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return { available: false, nativeBC: false, formats: [], timerQuery: false };
  const s3tc = gl.getExtension('WEBGL_compressed_texture_s3tc');
  const timerQuery = !!gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const formats = [];
  if (s3tc) {
    for (const name of Object.keys(FORMATS)) {
      formats.push({ name, native: true });
    }
  }
  return {
    available: true,
    nativeBC: !!s3tc,
    formats,
    timerQuery,
    renderer: gl.getParameter(gl.RENDERER),
  };
}

const VERT_SRC = `#version 300 es
in vec2 aPosition;
out vec2 vPixel;
void main() {
  vPixel = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAG_SRC = `#version 300 es
precision highp float;
uniform sampler2D uTexture;
uniform vec2 uTextureSize;
in vec2 vPixel;
out vec4 outColor;
void main() {
  // Integer texel coordinate -> texel-center UV. Computing the coordinate per
  // fragment avoids float drift that otherwise duplicates block-border texels.
  vec2 texel = floor(vPixel * uTextureSize);
  vec2 uv = (texel + 0.5) / uTextureSize;
  outColor = texture(uTexture, uv);
}`;

function createProgram(gl) {
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  }
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT_SRC));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG_SRC));
  gl.linkProgram(program);
  return program;
}

export function decodeWebGL2(blocks, width, height, format) {
  try {
    return decodeWebGL2Native(blocks, width, height, format);
  } catch (nativeError) {
    // Driver advertises S3TC but rejects the upload (e.g. software rasterizer):
    // decode on the CPU and upload RGBA so the rest of the pipeline still works.
    const start = performance.now();
    const rgba = decodeImage(blocks, width, height, format);
    const elapsedMs = performance.now() - start;
    return {
      data: rgba,
      width,
      height,
      elapsedMs,
      mode: 'cpu-fallback',
      fallbackReason: nativeError.message,
      uploadBytes: rgba.byteLength,
      compressedBytes: blocks.byteLength,
      backend: 'WebGL2',
    };
  }
}

function decodeWebGL2Native(blocks, width, height, format) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: false });
  if (!gl) throw new Error('WebGL2 上下文创建失败');
  const s3tc = gl.getExtension('WEBGL_compressed_texture_s3tc');
  const useNative = !!s3tc;
  const { paddedWidth, paddedHeight } = blockDimensions(width, height);

  const startTime = performance.now();
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  let uploadBytes;
  if (useNative) {
    const internalFormat = s3tc[format === 'BC1' ? 'COMPRESSED_RGB_S3TC_DXT1_EXT' : 'COMPRESSED_RGBA_S3TC_DXT5_EXT'];
    // S3TC requires width/height to be multiples of 4; the block data already
    // covers the clamped, padded image so we upload the padded dimensions.
    gl.compressedTexImage2D(
      gl.TEXTURE_2D, 0, internalFormat, paddedWidth, paddedHeight, 0, blocks,
    );
    uploadBytes = blocks.byteLength;
  } else {
    const rgba = decodeImage(blocks, width, height, format);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, paddedWidth, paddedHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    uploadBytes = rgba.byteLength;
  }
  if (gl.getError() !== gl.NO_ERROR) {
    throw new Error('压缩纹理上传失败（驱动不支持该格式）');
  }

  const program = createProgram(gl);
  gl.useProgram(program);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const location = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1i(gl.getUniformLocation(program, 'uTexture'), 0);
  gl.uniform2f(
    gl.getUniformLocation(program, 'uTextureSize'),
    paddedWidth,
    paddedHeight,
  );

  // Compressed textures cannot be color-renderable, so draw into a separate
  // RGBA8 target at the padded size, then read back only the original region.
  const targetTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, targetTexture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, paddedWidth, paddedHeight);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, targetTexture, 0);
  // Rebind the compressed source texture to the active unit for sampling.
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.viewport(0, 0, paddedWidth, paddedHeight);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  const pixels = new Uint8Array(paddedWidth * paddedHeight * 4);
  gl.readPixels(0, 0, paddedWidth, paddedHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.finish();
  const elapsedMs = performance.now() - startTime;

  // The fragment shader uses gl_FragCoord-style UVs that already land on
  // texel centers, and the half-texel correction keeps the readback in image
  // order. Only crop the padded columns; no Y flip is required.
  const flipped = new Uint8ClampedArray(width * height * 4);
  const paddedRowBytes = paddedWidth * 4;
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const sourceRow = y * paddedRowBytes;
    flipped.set(pixels.subarray(sourceRow, sourceRow + rowBytes), y * rowBytes);
  }

  const error = gl.getError();
  if (error !== gl.NO_ERROR) throw new Error(`WebGL2 错误码 0x${error.toString(16)}`);

  return {
    data: flipped,
    width,
    height,
    elapsedMs,
    mode: useNative ? 'gpu-native' : 'cpu-fallback',
    uploadBytes,
    compressedBytes: blocks.byteLength,
    backend: 'WebGL2',
  };
}
