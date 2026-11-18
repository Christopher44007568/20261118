import { variantKey } from './variantKey.js';
import {
  buildWarmupSet,
  requiredVariantKeys,
  visibleMaterials,
  variantFor,
} from './scene.js';

// 职责：
// 1. 首次进入场景：按实际可见材质预热（不预编不可见变体）
// 2. 测量首次可见延迟（FVD）：从发起到所有可见材质拿到可用管线的耗时
// 3. 切换相机：仅对新出现的材质发起按需编译，缓存命中零编译

export class WarmupController {
  constructor(cache, { now } = {}) {
    this.cache = cache;
    this.now = now || (() => (typeof performance !== 'undefined'
      ? performance.now()
      : Number(process.hrtime.bigint() / 1000000n)));
    this.visitedCameras = new Set();
    this.lastWarmup = null;
    this.eventLog = [];
  }

  log(message, extra = {}) {
    const record = { at: Math.round(this.now() * 100) / 10, message, ...extra };
    this.eventLog.push(record);
    return record;
  }

  // 进入某个相机视角；firstEntry 时记录完整首可见延迟
  async enterCamera(cameraId, renderSettings, { firstEntry = false } = {}) {
    const startedAt = this.now();
    const materials = visibleMaterials(cameraId);
    const neededKeys = requiredVariantKeys(cameraId, renderSettings);
    const isFirstVisit = !this.visitedCameras.has(cameraId);

    // 预热集合只包含本视角实际可见的变体
    const warmupVariants = buildWarmupSet(cameraId, renderSettings);
    const cachedBefore = neededKeys.filter((key) => this.cache.has(key));

    if (isFirstVisit) {
      this.log(`预热 ${cameraId}: ${warmupVariants.length} 个可见变体，其中 ${cachedBefore.length} 个已在缓存`, {
        camera: cameraId,
        warmupKeys: neededKeys,
        alreadyCached: cachedBefore,
      });
    } else {
      this.log(`重返 ${cameraId}: ${neededKeys.length} 个变体应全部命中缓存`, { camera: cameraId });
    }

    // 并发提交；getOrCompile 内部保证同键去重，命中直接返回
    const perMaterial = await Promise.all(
      materials.map(async (material) => {
        const variant = variantFor(material, renderSettings);
        const key = variantKey(variant);
        const materialStart = this.now();
        const pipeline = await this.cache.getOrCompile(variant);
        return {
          materialId: material.id,
          key,
          readyAt: this.now(),
          waitMs: this.now() - materialStart,
          waitSinceEnterMs: this.now() - startedAt,
          pipeline,
        };
      }),
    );

    const firstVisibleDelayMs = Math.max(...perMaterial.map((r) => r.waitSinceEnterMs));
    this.visitedCameras.add(cameraId);

    const report = {
      camera: cameraId,
      firstEntry: firstEntry && isFirstVisit,
      enteredAt: startedAt,
      firstVisibleDelayMs: Math.round(firstVisibleDelayMs * 100) / 100,
      perMaterial,
      warmupSet: neededKeys,
      cacheSnapshot: this.cache.snapshot(),
    };
    this.lastWarmup = report;
    this.log(`${cameraId} 全部可见，FVD=${report.firstVisibleDelayMs}ms`, {
      camera: cameraId,
      fvdMs: report.firstVisibleDelayMs,
    });
    return report;
  }

  // 全局渲染设置变化（光照/阴影开关）：重新解析当前视角需要的变体
  async applyRenderSettings(cameraId, renderSettings) {
    return this.enterCamera(cameraId, renderSettings);
  }
}
