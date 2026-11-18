// Motion-blur pipeline: G-buffer (color/depth/velocity/id), occlusion test,
// directional blur, temporal resolve, debug blit.
import { createProgram, createTarget, createFbo, M4 } from './gl.js';
import { GBUFFER_VS, GBUFFER_FS, QUAD_VS, OCCLUSION_FS, BLUR_FS, RESOLVE_FS, BLIT_FS }
  from './shaders.js';

const MAX_BLUR_PX = 24;

export class Pipeline {
  constructor(gl, width, height) {
    this.gl = gl;
    this.w = width;
    this.h = height;
    gl.getExtension('EXT_color_buffer_float');
    this.floatReadOK = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE) === gl.FLOAT;

    this.pGBuffer = createProgram(gl, GBUFFER_VS, GBUFFER_FS);
    this.pOcclusion = createProgram(gl, QUAD_VS, OCCLUSION_FS);
    this.pBlur = createProgram(gl, QUAD_VS, BLUR_FS);
    this.pResolve = createProgram(gl, QUAD_VS, RESOLVE_FS);
    this.pBlit = createProgram(gl, QUAD_VS, BLIT_FS);

    const T = (o) => createTarget(gl, width, height, o);
    this.texColor = T({ internal: gl.RGBA8, filter: gl.LINEAR });
    this.texVel = T({ internal: gl.RGBA16F, filter: gl.NEAREST });
    this.texId = T({ internal: gl.R8, filter: gl.NEAREST });
    this.texDepth = T({ internal: gl.DEPTH_COMPONENT24, filter: gl.NEAREST });
    this.texDepthPrev = T({ internal: gl.DEPTH_COMPONENT24, filter: gl.NEAREST });
    this.texVis = T({ internal: gl.R8, filter: gl.NEAREST });
    this.texBlur = T({ internal: gl.RGBA16F, filter: gl.LINEAR });
    this.texResolve = T({ internal: gl.RGBA16F, filter: gl.LINEAR });
    this.texHistory = T({ internal: gl.RGBA16F, filter: gl.LINEAR });

    this.fboG = createFbo(gl, [this.texColor, this.texVel, this.texId], this.texDepth);
    this.fboVis = createFbo(gl, [this.texVis], null);
    this.fboBlur = createFbo(gl, [this.texBlur], null);
    this.fboResolve = createFbo(gl, [this.texResolve], null);
    this.fboHistory = createFbo(gl, [this.texHistory], null);
    this.fboDepthPrev = createFbo(gl, [], this.texDepthPrev);

    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.hasPrev = false;
    this.prevViewProj = M4.ident();
    this.viewMode = 0;
    this.frameIndex = 0;
  }

  reset() {
    this.hasPrev = false;
    this.frameIndex = 0;
  }

  bindTex(unit, tex) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    return unit;
  }

  drawQuad() {
    const gl = this.gl;
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  renderFrame(scene, scenario) {
    const gl = this.gl, w = this.w, h = this.h;
    scene.tick(scenario, this.frameIndex);
    const cam = scene.camera(scenario, this.frameIndex);
    const proj = M4.perspective(Math.PI / 3.2, w / h, 0.1, 100);
    const view = M4.lookAt(cam.eye, cam.at, cam.up);
    const viewProj = M4.mul(proj, view);
    const invViewProj = M4.invert(viewProj);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboG);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.05, 0.07, 0.1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 2, [0, 0, 0, 0]);
    const pg = this.pGBuffer;
    gl.useProgram(pg.prog);
    gl.uniformMatrix4fv(pg.u.uViewProj, false, viewProj);
    gl.uniformMatrix4fv(pg.u.uPrevViewProj, false, this.prevViewProj);
    gl.uniform2f(pg.u.uResolution, w, h);
    gl.uniform3f(pg.u.uLightDir, 0.4, 0.8, 0.45);
    for (const obj of scene.objects) {
      const model = obj.modelFn();
      gl.uniformMatrix4fv(pg.u.uModel, false, model);
      gl.uniformMatrix4fv(pg.u.uPrevModel, false, this.hasPrev ? obj.prevModel : model);
      gl.uniform1f(pg.u.uObjectId, obj.id);
      gl.bindVertexArray(obj.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, obj.mesh.count);
      obj.prevModel = model;
    }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboVis);
    gl.useProgram(this.pOcclusion.prog);
    gl.uniform1i(this.pOcclusion.u.uDepthCurr, this.bindTex(0, this.texDepth));
    gl.uniform1i(this.pOcclusion.u.uDepthPrev, this.bindTex(1, this.texDepthPrev));
    gl.uniformMatrix4fv(this.pOcclusion.u.uInvViewProj, false, invViewProj);
    gl.uniformMatrix4fv(this.pOcclusion.u.uPrevViewProj, false, this.prevViewProj);
    gl.uniform1f(this.pOcclusion.u.uHasPrev, this.hasPrev ? 1 : 0);
    this.drawQuad();

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboBlur);
    gl.useProgram(this.pBlur.prog);
    gl.uniform1i(this.pBlur.u.uColor, this.bindTex(0, this.texColor));
    gl.uniform1i(this.pBlur.u.uVel, this.bindTex(1, this.texVel));
    gl.uniform1i(this.pBlur.u.uVis, this.bindTex(2, this.texVis));
    gl.uniform2f(this.pBlur.u.uResolution, w, h);
    gl.uniform1f(this.pBlur.u.uMaxBlur, MAX_BLUR_PX);
    this.drawQuad();

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboResolve);
    gl.useProgram(this.pResolve.prog);
    gl.uniform1i(this.pResolve.u.uBlur, this.bindTex(0, this.texBlur));
    gl.uniform1i(this.pResolve.u.uHistory, this.bindTex(1, this.texHistory));
    gl.uniform1i(this.pResolve.u.uVel, this.bindTex(2, this.texVel));
    gl.uniform1i(this.pResolve.u.uVis, this.bindTex(3, this.texVis));
    gl.uniform1f(this.pResolve.u.uHasHistory, this.hasPrev ? 1 : 0);
    this.drawQuad();

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fboResolve);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fboHistory);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

    // carry depth to next frame for the occlusion test
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fboG);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fboDepthPrev);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

    this.prevViewProj = viewProj;
    this.hasPrev = true;
    this.frameIndex++;
  }

  present() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.pBlit.prog);
    gl.uniform1i(this.pBlit.u.uResolve, this.bindTex(0, this.texResolve));
    gl.uniform1i(this.pBlit.u.uVel, this.bindTex(1, this.texVel));
    gl.uniform1i(this.pBlit.u.uBlur, this.bindTex(2, this.texBlur));
    gl.uniform1i(this.pBlit.u.uMode, this.viewMode);
    gl.uniform1f(this.pBlit.u.uVelScale, 1 / 20);
    this.drawQuad();
  }
}
