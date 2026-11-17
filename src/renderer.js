import { MAX_LIGHTS } from "./lighting.js";
import { fullscreenVertex, lightingFragment } from "./shaders.js";

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, fullscreenVertex);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, lightingFragment);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  return program;
}

function requiredUniform(gl, program, name) {
  const location = gl.getUniformLocation(program, name);
  if (location === null) {
    throw new Error(`Missing shader uniform: ${name}`);
  }
  return location;
}

function createTileTexture(gl) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

export class LightingRenderer {
  constructor(canvas, mode) {
    this.canvas = canvas;
    this.mode = mode;
    this.gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance"
    });
    if (!this.gl) {
      throw new Error("WebGL2 is not available");
    }
    this.initialize();
  }

  initialize() {
    const gl = this.gl;
    this.program = createProgram(gl);
    this.vertexArray = gl.createVertexArray();
    gl.bindVertexArray(this.vertexArray);
    this.locations = {
      resolution: requiredUniform(gl, this.program, "uResolution"),
      tileSize: requiredUniform(gl, this.program, "uTileSize"),
      mode: requiredUniform(gl, this.program, "uMode"),
      lightCount: requiredUniform(gl, this.program, "uLightCount"),
      lightPositionRadius: requiredUniform(gl, this.program, "uLightPositionRadius[0]"),
      lightColorIntensity: requiredUniform(gl, this.program, "uLightColorIntensity[0]"),
      tileCounts: requiredUniform(gl, this.program, "uTileCounts"),
      tileIndices: requiredUniform(gl, this.program, "uTileIndices")
    };
    this.countsTexture = createTileTexture(gl);
    this.indicesTexture = createTileTexture(gl);
    this.positionRadiusData = new Float32Array(MAX_LIGHTS * 4);
    this.colorIntensityData = new Float32Array(MAX_LIGHTS * 4);
    this.pixels = new Uint8Array(this.canvas.width * this.canvas.height * 4);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
  }

  updateTiles(tiles) {
    const gl = this.gl;
    const countData = new Float32Array(tiles.counts.length);
    for (let index = 0; index < tiles.counts.length; index += 1) {
      countData[index] = tiles.counts[index];
    }
    gl.bindTexture(gl.TEXTURE_2D, this.countsTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R32F,
      tiles.columns,
      tiles.rows,
      0,
      gl.RED,
      gl.FLOAT,
      countData
    );

    const textureWidth = tiles.columns * tiles.maxLightsPerTile;
    const indexData = new Uint32Array(textureWidth * tiles.rows);
    for (let row = 0; row < tiles.rows; row += 1) {
      for (let column = 0; column < tiles.columns; column += 1) {
        const tile = row * tiles.columns + column;
        const target = row * textureWidth + column * tiles.maxLightsPerTile;
        for (let entry = 0; entry < tiles.counts[tile]; entry += 1) {
          indexData[target + entry] =
            tiles.indices[tile * tiles.maxLightsPerTile + entry];
        }
      }
    }

    gl.bindTexture(gl.TEXTURE_2D, this.indicesTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R32UI,
      textureWidth,
      tiles.rows,
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_INT,
      indexData
    );
  }

  updateLights(lights) {
    for (let index = 0; index < lights.length; index += 1) {
      const offset = index * 4;
      const light = lights[index];
      this.positionRadiusData[offset] = light.x;
      this.positionRadiusData[offset + 1] = light.y;
      this.positionRadiusData[offset + 2] = light.currentRadius ?? light.radius;
      this.positionRadiusData[offset + 3] = 0;
      this.colorIntensityData[offset] = light.color[0];
      this.colorIntensityData[offset + 1] = light.color[1];
      this.colorIntensityData[offset + 2] = light.color[2];
      this.colorIntensityData[offset + 3] =
        light.currentIntensity ?? light.intensity;
    }
  }

  render(tiles, lights) {
    const gl = this.gl;
    this.updateTiles(tiles);
    this.updateLights(lights);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertexArray);
    gl.uniform2f(this.locations.resolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.locations.tileSize, tiles.tileSize);
    gl.uniform1i(this.locations.mode, this.mode);
    gl.uniform1i(this.locations.lightCount, lights.length);
    gl.uniform4fv(this.locations.lightPositionRadius, this.positionRadiusData);
    gl.uniform4fv(this.locations.lightColorIntensity, this.colorIntensityData);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.countsTexture);
    gl.uniform1i(this.locations.tileCounts, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.indicesTexture);
    gl.uniform1i(this.locations.tileIndices, 1);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  readPixels() {
    const gl = this.gl;
    gl.readPixels(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.pixels
    );
    return this.pixels;
  }

  dispose() {
    const gl = this.gl;
    gl.deleteTexture(this.countsTexture);
    gl.deleteTexture(this.indicesTexture);
    gl.deleteVertexArray(this.vertexArray);
    gl.deleteProgram(this.program);
  }
}
