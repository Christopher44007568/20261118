import {
  createProgram, uniformLocations, makeTexture, createMesh, createQuad,
} from './gl-utils.js';
import {
  gbufferVert, gbufferFrag, quadVert, deferredFrag, debugFrag,
  forwardFrag, transparentFrag, blitFrag,
} from './shaders.js';
import { meshes, opaqueObjects, transparentObjects, light } from './scene.js';
import { multiply, normalMatrix } from './mat4.js';

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    // Required before rendering into RGBA16F / RGBA32F color targets.
    this.extFloat =
      gl.getExtension('EXT_color_buffer_float')
      || gl.getExtension('EXT_color_buffer_half_float');
    if (!this.extFloat) throw new Error('float color buffers unsupported');
    this.width = canvas.width;
    this.height = canvas.height;
    this.meshGL = {};
    for (const [name, data] of Object.entries(meshes)) {
      this.meshGL[name] = createMesh(gl, data);
    }
    this.quad = createQuad(gl);
    this.progGBuffer = createProgram(gl, gbufferVert, gbufferFrag);
    this.progDeferred = createProgram(gl, quadVert, deferredFrag);
    this.progDebug = createProgram(gl, quadVert, debugFrag);
    this.progBlit = createProgram(gl, quadVert, blitFrag);
    this.progForward = createProgram(gl, gbufferVert, forwardFrag);
    this.progTransparent = createProgram(gl, gbufferVert, transparentFrag);
    this.locGBuffer = uniformLocations(gl, this.progGBuffer,
      ['uModel', 'uView', 'uProj', 'uNormalMat', 'uAlbedo', 'uRoughness']);
    this.locForward = uniformLocations(gl, this.progForward,
      ['uModel', 'uView', 'uProj', 'uNormalMat', 'uAlbedo', 'uRoughness',
       'uCamPos', 'uLightDir', 'uLightColor', 'uLightIntensity', 'uAmbient']);
    this.locTransp = uniformLocations(gl, this.progTransparent,
      ['uModel', 'uView', 'uProj', 'uNormalMat', 'uAlbedo', 'uRoughness',
       'uOpacity', 'uCamPos', 'uLightDir', 'uLightColor',
       'uLightIntensity', 'uAmbient']);
    this.locDeferred = uniformLocations(gl, this.progDeferred,
      ['uPosTex', 'uNormalTex', 'uAlbedoTex', 'uDepth', 'uCamPos',
       'uLightDir', 'uLightColor', 'uLightIntensity', 'uAmbient']);
    this.locDebug = uniformLocations(gl, this.progDebug,
      ['uPosTex', 'uNormalTex', 'uAlbedoTex', 'uDepth', 'uMode']);
    this.locBlit = uniformLocations(gl, this.progBlit, ['uTex']);
    this.initFramebuffers();
  }

  initFramebuffers() {
    const gl = this.gl, w = this.width, h = this.height;
    // Shared depth buffer: G-Buffer and scene-color FBO must agree on depth
    // so the transparent pass is correctly occluded by opaque geometry.
    this.depthTex = makeTexture(gl, w, h, gl.DEPTH_COMPONENT24,
      gl.DEPTH_COMPONENT, gl.UNSIGNED_INT);

    this.gPos = makeTexture(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    this.gNormal = makeTexture(gl, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.gAlbedo = makeTexture(gl, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.gBuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gBuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D, this.gPos, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1,
      gl.TEXTURE_2D, this.gNormal, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2,
      gl.TEXTURE_2D, this.gAlbedo, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
      gl.TEXTURE_2D, this.depthTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1,
      gl.COLOR_ATTACHMENT2]);
    this.checkFB('G-Buffer');

    this.sceneColor = makeTexture(gl, w, h, gl.RGBA16F, gl.RGBA,
      gl.HALF_FLOAT);
    this.sceneFB = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D, this.sceneColor, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
      gl.TEXTURE_2D, this.depthTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    this.checkFB('scene');

    // Lighting pass samples the depth texture, so it must render into an FBO
    // without that depth attachment to avoid a texture feedback loop.
    this.sceneFBNoDepth = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBNoDepth);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D, this.sceneColor, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    this.checkFB('scene-nodepth');

    // Forward reference gets its own depth-only FBO (no G-Buffer).
    this.fwdDepth = makeTexture(gl, w, h, gl.DEPTH_COMPONENT24,
      gl.DEPTH_COMPONENT, gl.UNSIGNED_INT);
    this.fwdColor = makeTexture(gl, w, h, gl.RGBA16F, gl.RGBA,
      gl.HALF_FLOAT);
    this.forwardFB = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.forwardFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D, this.fwdColor, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
      gl.TEXTURE_2D, this.fwdDepth, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    this.checkFB('forward');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  checkFB(name) {
    const s = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
    if (s !== this.gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(name + ' framebuffer incomplete: ' + s);
    }
  }

  setLightUniforms(loc, prog) {
    const gl = this.gl;
    gl.useProgram(prog);
    gl.uniform3fv(loc.uCamPos, this.camera.eye);
    gl.uniform3fv(loc.uLightDir, light.dir);
    gl.uniform3fv(loc.uLightColor, light.color);
    gl.uniform1f(loc.uLightIntensity, light.intensity);
    gl.uniform3fv(loc.uAmbient, light.ambient);
  }

  drawOpaqueGeometry(program, loc, setMaterial) {
    const gl = this.gl;
    gl.useProgram(program);
    gl.uniformMatrix4fv(loc.uView, false, this.camera.view);
    gl.uniformMatrix4fv(loc.uProj, false, this.camera.proj);
    for (const obj of opaqueObjects) {
      const mesh = this.meshGL[obj.mesh];
      const vm = multiply(this.camera.view, obj.model);
      gl.uniformMatrix4fv(loc.uModel, false, obj.model);
      gl.uniformMatrix3fv(loc.uNormalMat, false, normalMatrix(vm));
      setMaterial(obj, loc);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  // Pass 1: opaque objects only -> three MRT G-Buffer targets + depth.
  gbufferPass() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gBuffer);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.colorMask(true, true, true, true);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const loc = this.locGBuffer;
    this.drawOpaqueGeometry(this.progGBuffer, loc, (obj) => {
      gl.uniform3fv(loc.uAlbedo, obj.albedo);
      gl.uniform1f(loc.uRoughness, obj.roughness);
    });
  }

  // Pass 2a: screen-space lighting from G-Buffer textures.
  lightingPass() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBNoDepth);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.progDeferred);
    this.bindGBufferTextures(this.locDeferred);
    this.setLightUniforms(this.locDeferred, this.progDeferred);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  bindGBufferTextures(loc) {
    const gl = this.gl;
    const slots = [
      [this.gPos, loc.uPosTex, 0],
      [this.gNormal, loc.uNormalTex, 1],
      [this.gAlbedo, loc.uAlbedoTex, 2],
      [this.depthTex, loc.uDepth, 3],
    ];
    for (const [tex, uniform, unit] of slots) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(uniform, unit);
    }
  }

  // Pass 2b: transparent objects never touch the G-Buffer. They are sorted
  // back-to-front and alpha-blended over the lit scene, depth-tested against
  // the opaque depth buffer but with depth writes disabled.
  transparentPass(sorted = true) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFB);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, this.width, this.height);
    const loc = this.locTransp;
    gl.useProgram(this.progTransparent);
    gl.uniformMatrix4fv(loc.uView, false, this.camera.view);
    gl.uniformMatrix4fv(loc.uProj, false, this.camera.proj);
    this.setLightUniforms(loc, this.progTransparent);
    const eye = this.camera.eye;
    const list = sorted
      ? [...transparentObjects].sort((a, b) =>
        dist2(b.model, eye) - dist2(a.model, eye))
      : transparentObjects; // submission order = near-to-far in scene.js
    this.drawTransparentList(list, loc);
  }

  drawTransparentList(list, loc) {
    const gl = this.gl;
    for (const obj of list) {
      const mesh = this.meshGL[obj.mesh];
      const vm = multiply(this.camera.view, obj.model);
      gl.uniformMatrix4fv(loc.uModel, false, obj.model);
      gl.uniformMatrix3fv(loc.uNormalMat, false, normalMatrix(vm));
      gl.uniform3fv(loc.uAlbedo, obj.albedo);
      gl.uniform1f(loc.uRoughness, obj.roughness);
      gl.uniform1f(loc.uOpacity, obj.opacity);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  // Forward reference renderer: same scene, same lighting library, own FBO.
  renderForward(sorted = true) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.forwardFB);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0.02, 0.025, 0.04, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const loc = this.locForward;
    this.setLightUniforms(loc, this.progForward);
    this.drawOpaqueGeometry(this.progForward, loc, (obj) => {
      gl.uniform3fv(loc.uAlbedo, obj.albedo);
      gl.uniform1f(loc.uRoughness, obj.roughness);
    });
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const tloc = this.locTransp;
    gl.useProgram(this.progTransparent);
    gl.uniformMatrix4fv(tloc.uView, false, this.camera.view);
    gl.uniformMatrix4fv(tloc.uProj, false, this.camera.proj);
    this.setLightUniforms(tloc, this.progTransparent);
    const eye = this.camera.eye;
    const list = sorted
      ? [...transparentObjects].sort((a, b) =>
        dist2(b.model, eye) - dist2(a.model, eye))
      : transparentObjects;
    this.drawTransparentList(list, tloc);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  blitToScreen(texture) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.progBlit);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.locBlit.uTex, 0);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  renderDebug(mode) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.progDebug);
    this.bindGBufferTextures(this.locDebug);
    gl.uniform1i(this.locDebug.uMode, mode);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  render(camera, mode, sorted = true) {
    this.camera = camera;
    this.gbufferPass();
    if (mode === 'debug') return; // caller picks a channel via renderDebug
    this.lightingPass();
    this.transparentPass(sorted);
  }
}

function dist2(model, eye) {
  const tx = model[12], ty = model[13], tz = model[14];
  const dx = tx - eye[0], dy = ty - eye[1], dz = tz - eye[2];
  return dx * dx + dy * dy + dz * dz;
}
