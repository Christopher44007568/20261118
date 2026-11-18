export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("无法创建着色器");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "未知着色器错误";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error("无法创建着色器程序");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "未知链接错误";
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

export function bufferFloatArray(
  gl: WebGL2RenderingContext,
  data: Float32Array,
): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error("无法创建顶点缓冲");
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
}

export interface PositionVao {
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  count: number;
}

export function createPositionVao(
  gl: WebGL2RenderingContext,
  positions: number[] | Float32Array,
): PositionVao {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("无法创建 VAO");
  gl.bindVertexArray(vao);
  const buffer = bufferFloatArray(gl, positions instanceof Float32Array ? positions : new Float32Array(positions));
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vao, buffer, count: positions.length / 3 };
}

export interface MeshVao {
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  count: number;
}

export function createMeshVao(
  gl: WebGL2RenderingContext,
  interleaved: Float32Array,
): MeshVao {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("无法创建 VAO");
  gl.bindVertexArray(vao);
  const buffer = bufferFloatArray(gl, interleaved);
  const stride = 6 * Float32Array.BYTES_PER_ELEMENT;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * Float32Array.BYTES_PER_ELEMENT);
  gl.bindVertexArray(null);
  return { vao, buffer, count: interleaved.length / 6 };
}

export function deletePositionVao(gl: WebGL2RenderingContext, value: PositionVao): void {
  gl.deleteBuffer(value.buffer);
  gl.deleteVertexArray(value.vao);
}

export function deleteMeshVao(gl: WebGL2RenderingContext, value: MeshVao): void {
  gl.deleteBuffer(value.buffer);
  gl.deleteVertexArray(value.vao);
}
