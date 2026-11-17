import { fboStatusString } from './glutil.js';

// 几何渲染目标：
//  - samples > 1：多重采样颜色/深度 renderbuffer + 独立 resolve FBO（只挂普通纹理，无深度）
//  - samples = 1：普通 FBO，颜色直接写入纹理，深度 renderbuffer 不参与 resolve
export class MsaaTarget {
  constructor(gl, width, height, samples, actualSamples = samples) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.samples = samples;
    this.actualSamples = actualSamples;

    this.msFbo = null;
    this.colorRb = null;
    this.depthRb = null;
    this.resolveFbo = null;
    this.colorTexture = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (samples > 1) {
      this._createMultisampled(gl);
      this.geometryFbo = this.msFbo;
    } else {
      this._createSingleSampled(gl);
      this.geometryFbo = this.resolveFbo;
    }

    this._checkStatus(gl);
  }

  _createMultisampled(gl) {
    const { width, height, samples } = this;

    this.msFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo);

    this.colorRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.colorRb);
    gl.renderbufferStorageMultisample(
      gl.RENDERBUFFER, samples, gl.RGBA8, width, height
    );
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.colorRb
    );

    this.depthRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb);
    gl.renderbufferStorageMultisample(
      gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, width, height
    );
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb
    );

    // resolve FBO：只挂颜色纹理，故意不挂深度 —— 深度留在几何 FBO 中。
    this.resolveFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolveFbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D, this.colorTexture, 0
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  }

  _createSingleSampled(gl) {
    const { width, height } = this;

    this.depthRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);

    this.resolveFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolveFbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D, this.colorTexture, 0
    );
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  }

  _checkStatus(gl) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.geometryFbo);
    const geoStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolveFbo);
    const resolveStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.geometryStatus = geoStatus;
    this.resolveStatus = resolveStatus;
    this.geometryStatusString = fboStatusString(gl, geoStatus);
    this.resolveStatusString = fboStatusString(gl, resolveStatus);
  }

  bindForGeometry(gl) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.geometryFbo);
    gl.viewport(0, 0, this.width, this.height);
  }

  // 将多重采样颜色按样本平均（resolve）到普通纹理；1x 模式下纹理就是渲染目标，无需操作。
  resolve(gl) {
    if (this.samples <= 1) return;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFbo);
    gl.blitFramebuffer(
      0, 0, this.width, this.height,
      0, 0, this.width, this.height,
      gl.COLOR_BUFFER_BIT, gl.NEAREST
    );
    // 恢复默认绑定，避免 READ/DRAW 帧缓冲状态泄漏到后续调用。
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  bindColorTexture(gl, unit = gl.TEXTURE0) {
    gl.activeTexture(unit);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
  }

  // resolve FBO 必须没有深度附件，深度值不应被带进纹理/下一阵。
  resolveFboHasDepth(gl) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolveFbo);
    const type = gl.getFramebufferAttachmentParameter(
      gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return type !== gl.NONE;
  }

  destroy(gl) {
    if (this.msFbo) gl.deleteFramebuffer(this.msFbo);
    if (this.resolveFbo) gl.deleteFramebuffer(this.resolveFbo);
    if (this.colorRb) gl.deleteRenderbuffer(this.colorRb);
    if (this.depthRb) gl.deleteRenderbuffer(this.depthRb);
    if (this.colorTexture) gl.deleteTexture(this.colorTexture);
  }
}
