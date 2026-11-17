import { bytesPerPixel } from './gpu-device.js';

export class ResourceAllocator {
  constructor(device) {
    this.device = device;
    this.textures = new Map();
    this.currentBytes = 0;
    this.peakBytes = 0;
    this.peakTextureCount = 0;
  }

  ensure(resourceName, descriptor) {
    const existing = this.textures.get(resourceName);
    if (existing) {
      assertSameDescriptor(resourceName, existing.descriptor, descriptor);
      return existing;
    }

    const texture = this.device.createTexture({
      ...descriptor,
      label: descriptor.label ?? resourceName
    });
    this.textures.set(resourceName, texture);
    this.currentBytes += getDescriptorBytes(descriptor);
    this.peakBytes = Math.max(this.peakBytes, this.currentBytes);
    this.peakTextureCount = Math.max(this.peakTextureCount, this.textures.size);
    return texture;
  }

  get(resourceName) {
    const texture = this.textures.get(resourceName);
    if (!texture) {
      throw new Error(`Resource is not allocated: ${resourceName}`);
    }
    return texture;
  }

  has(resourceName) {
    return this.textures.has(resourceName);
  }

  release(resourceName) {
    const texture = this.textures.get(resourceName);
    if (!texture) {
      return false;
    }
    texture.destroy();
    this.currentBytes -= getDescriptorBytes(texture.descriptor);
    this.textures.delete(resourceName);
    return true;
  }

  releaseAll() {
    for (const texture of this.textures.values()) {
      texture.destroy();
    }
    this.textures.clear();
    this.currentBytes = 0;
    this.peakBytes = 0;
    this.peakTextureCount = 0;
  }

  beginFrame() {
    this.device.peakBytes = this.device.currentBytes;
    this.device.peakTextureCount = this.device.liveTextureCount;
    this.peakBytes = this.currentBytes;
    this.peakTextureCount = this.textures.size;
  }
}

function getDescriptorBytes(descriptor) {
  const [width, height, depthOrArrayLayers = 1] = descriptor.size;
  return (
    width *
    height *
    depthOrArrayLayers *
    bytesPerPixel(descriptor.format)
  );
}

function assertSameDescriptor(resourceName, actual, expected) {
  const actualKey = descriptorKey(actual);
  const expectedKey = descriptorKey(expected);
  if (actualKey !== expectedKey) {
    throw new Error(
      `Resource ${resourceName} was requested with incompatible descriptors: ` +
        `${actualKey} !== ${expectedKey}`
    );
  }
}

function descriptorKey(descriptor) {
  return JSON.stringify({
    size: descriptor.size,
    format: descriptor.format,
    usage: descriptor.usage ?? 0
  });
}
