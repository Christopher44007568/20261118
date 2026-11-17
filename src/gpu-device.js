const FORMAT_BYTES_PER_PIXEL = {
  depth24plus: 4,
  r8unorm: 1,
  rg8unorm: 2,
  rgba8unorm: 4,
  rgba16float: 8,
  rgba32float: 16
};

export class MockGPUTexture {
  constructor(device, descriptor) {
    this.device = device;
    this.descriptor = descriptor;
    this.id = device.nextTextureId++;
    this.label = descriptor.label ?? `texture-${this.id}`;
    this.format = descriptor.format;
    this.width = descriptor.size[0];
    this.height = descriptor.size[1];
    this.depthOrArrayLayers = descriptor.size[2] ?? 1;
    this.destroyed = false;
  }

  destroy() {
    if (!this.destroyed) {
      this.device.destroyTexture(this);
      this.destroyed = true;
    }
  }
}

export class MockGPUDevice {
  constructor() {
    this.nextTextureId = 1;
    this.textures = new Map();
    this.currentBytes = 0;
    this.peakBytes = 0;
    this.peakTextureCount = 0;
  }

  createTexture(descriptor) {
    const texture = new MockGPUTexture(this, descriptor);
    this.textures.set(texture.id, texture);
    this.currentBytes += this.getTextureByteSize(texture);
    this.peakBytes = Math.max(this.peakBytes, this.currentBytes);
    this.peakTextureCount = Math.max(this.peakTextureCount, this.textures.size);
    return texture;
  }

  destroyTexture(texture) {
    if (!this.textures.has(texture.id)) {
      return;
    }
    this.currentBytes -= this.getTextureByteSize(texture);
    this.textures.delete(texture.id);
  }

  getTextureByteSize(texture) {
    const bytesPerPixel = FORMAT_BYTES_PER_PIXEL[texture.format];
    if (bytesPerPixel === undefined) {
      throw new Error(`Unsupported texture format: ${texture.format}`);
    }
    return (
      texture.width *
      texture.height *
      texture.depthOrArrayLayers *
      bytesPerPixel
    );
  }

  get liveTextureCount() {
    return this.textures.size;
  }
}

export function bytesPerPixel(format) {
  const bytes = FORMAT_BYTES_PER_PIXEL[format];
  if (bytes === undefined) {
    throw new Error(`Unsupported texture format: ${format}`);
  }
  return bytes;
}
