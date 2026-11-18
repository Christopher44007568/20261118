import assert from 'node:assert/strict';
import { SimulatedShaderCompiler } from '../src/shaderCompiler.js';
import { PipelineCache } from '../src/pipelineCache.js';
import { WarmupController } from '../src/warmupController.js';
import { makeVariant, variantKey, fallbackVariant } from '../src/variantKey.js';
import {
  MATERIALS,
  CAMERAS,
  DEFAULT_RENDER_SETTINGS,
  requiredVariantKeys,
  visibleMaterials,
} from '../src/scene.js';

// 用虚拟时钟 + 立即兑现的编译，保证测试快速且确定
function makeManualEnv() {
  let t = 0;
  const now = () => t;
  const tick = (ms = 1) => { t += ms; };
  return { now, tick };
}

// 让 delay 立即完成：编译延迟不推进真实时间，统计只看调用次数
const originalSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn) => originalSetTimeout(fn, 0);

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  \u2717 ${name}`);
    console.log(`    ${error.message}`);
  }
}

const flush = () => new Promise((resolve) => originalSetTimeout(resolve, 0));

console.log('\n[1/5] 变体键与预热集合');
await test('变体键包含光照/阴影/贴花/透明四个维度且稳定', () => {
  const variant = makeVariant({
    program: 'pbrStandard', lighting: 'lit', shadow: 'on',
    decal: 'decaled', transparent: 'blend',
  });
  assert.equal(
    variantKey(variant),
    'pg=pbrStandard|L=lit|S=on|D=decaled|T=blend',
  );
  assert.equal(variantKey(variant), variantKey(makeVariant({ ...variant })));
  assert.throws(() => makeVariant({ ...variant, lighting: 'bogus' }), TypeError);
});

await test('预热集合只含当前相机实际可见材质', () => {
  for (const camera of CAMERAS) {
    const keys = requiredVariantKeys(camera.id, DEFAULT_RENDER_SETTINGS);
    const expected = visibleMaterials(camera.id);
    assert.equal(keys.length, expected.length, `${camera.id} 数量一致`);
    const allSceneKeys = new Set(requiredVariantKeys('plaza', DEFAULT_RENDER_SETTINGS)
      .concat(requiredVariantKeys('tower', DEFAULT_RENDER_SETTINGS))
      .concat(requiredVariantKeys('westWing', DEFAULT_RENDER_SETTINGS)));
    for (const key of keys) assert.ok(allSceneKeys.has(key));
  }
  const plaza = new Set(requiredVariantKeys('plaza', DEFAULT_RENDER_SETTINGS));
  const towerOnlyHologram = MATERIALS.find((m) => m.id === 'hologram');
  const holoKey = variantKey({
    ...{ program: towerOnlyHologram.program, decal: towerOnlyHologram.decal, transparent: towerOnlyHologram.transparent },
    ...DEFAULT_RENDER_SETTINGS,
  });
  assert.ok(!plaza.has(holoKey), '广场视角不应预热高塔专属全息材质');
});

console.log('\n[2/5] 缓存命中不重复编译');
await test('同变体重复请求只编译一次，并发请求共享 in-flight', async () => {
  const { now } = makeManualEnv();
  const compiler = new SimulatedShaderCompiler({ now, baseLatencyMs: 5, jitterMs: 0 });
  const cache = new PipelineCache(compiler, { capacity: 8, now });
  const variant = makeVariant({
    program: 'pbrStandard', lighting: 'lit', shadow: 'on',
    decal: 'none', transparent: 'opaque',
  });

  const [a, b, c] = await Promise.all([
    cache.getOrCompile(variant),
    cache.getOrCompile(variant),
    cache.getOrCompile(variant),
  ]);
  assert.equal(compiler.totalCompiled, 1, '只发生一次真实编译');
  assert.equal(a.handle, b.handle);
  assert.equal(b.handle, c.handle);
  assert.equal(cache.stats.misses, 1);
  assert.equal(cache.stats.inFlightShared, 2, '另外两个请求共享 in-flight promise');

  await cache.getOrCompile(variant);
  await cache.getOrCompile(variant);
  assert.equal(compiler.totalCompiled, 1, '命中后仍无新增编译');
  assert.equal(cache.stats.hits, 2);
  assert.equal(cache.hitRate, 2 / 3);
});

console.log('\n[3/5] 错误变体回退');
await test('失败变体自动回退到保守管线并被后续请求复用', async () => {
  const { now } = makeManualEnv();
  const compiler = new SimulatedShaderCompiler({ now, baseLatencyMs: 1, jitterMs: 0 });
  const cache = new PipelineCache(compiler, { capacity: 8, now });
  const variant = makeVariant({
    program: 'pbrStandard', lighting: 'lit', shadow: 'on',
    decal: 'decaled', transparent: 'blend',
  });
  const fb = fallbackVariant(variant);
  compiler.markFailing(variant);

  const pipeline = await cache.getOrCompile(variant);
  assert.equal(pipeline.key, variantKey(fb), '返回回退变体管线');
  assert.equal(cache.stats.compileFailures, 1);
  assert.equal(cache.stats.fallbacks, 1);
  const errorEntry = cache.entries.get(variantKey(variant));
  assert.equal(errorEntry.status, 'error');
  assert.equal(errorEntry.fallbackKey, variantKey(fb));

  const beforeCompiles = compiler.totalCompiled;
  const again = await cache.getOrCompile(variant);
  assert.equal(again.key, variantKey(fb));
  assert.equal(compiler.totalCompiled, beforeCompiles, '已知失败变体不再重复编译原变体');
  assert.equal(cache.stats.fallbacks, 1, '回退只计一次');
});

console.log('\n[4/5] 容量淘汰 (LRU)');
await test('超容量时淘汰最久未使用条目，最近访问的保留', async () => {
  const { now } = makeManualEnv();
  const compiler = new SimulatedShaderCompiler({ now, baseLatencyMs: 1, jitterMs: 0 });
  const capacity = 3;
  const cache = new PipelineCache(compiler, { capacity, now });
  const variants = ['pbrStandard', 'foliage', 'cloth', 'hologram'].map((program, index) =>
    makeVariant({
      program, lighting: 'lit', shadow: 'on',
      decal: index % 2 ? 'decaled' : 'none',
      transparent: index % 2 ? 'blend' : 'opaque',
    }));

  for (const variant of variants) await cache.getOrCompile(variant);
  assert.equal(cache.size, capacity);
  assert.ok(!cache.has(variantKey(variants[0])), '最老条目已淘汰');
  assert.ok(cache.has(variantKey(variants[3])), '最新条目保留');
  assert.equal(cache.stats.evictions, 1);

  // 访问一次 variants[1]，再塞入新变体，应淘汰 variants[2]
  await cache.getOrCompile(variants[1]);
  const next = makeVariant({
    program: 'pbrStandard', lighting: 'unlit', shadow: 'off',
    decal: 'none', transparent: 'opaque',
  });
  await cache.getOrCompile(next);
  assert.ok(!cache.has(variantKey(variants[2])), 'LRU 重排后淘汰正确条目');
  assert.ok(cache.has(variantKey(variants[1])), '刚访问的条目保留');
});

console.log('\n[5/5] 相机切换端到端');
await test('切换相机只编译新材质，重返视角零编译且有 FVD 指标', async () => {
  const { now } = makeManualEnv();
  const compiler = new SimulatedShaderCompiler({ now, baseLatencyMs: 10, jitterMs: 0, maxConcurrent: 2 });
  const cache = new PipelineCache(compiler, { capacity: 32, now });
  const controller = new WarmupController(cache, { now });

  const plazaReport = await controller.enterCamera('plaza', DEFAULT_RENDER_SETTINGS, { firstEntry: true });
  const plazaCompiles = compiler.totalCompiled;
  assert.ok(plazaReport.firstEntry);
  assert.ok(plazaReport.firstVisibleDelayMs >= 0);
  assert.equal(plazaReport.perMaterial.length, visibleMaterials('plaza').length);
  assert.ok(plazaReport.warmupSet.every((key) => cache.has(key)));

  const towerReport = await controller.enterCamera('tower', DEFAULT_RENDER_SETTINGS);
  const newMaterials = visibleMaterials('tower')
    .filter((m) => !m.groups.includes('plaza'));
  assert.ok(newMaterials.length > 0, '高塔视角确实引入新材质');
  const sharedMaterials = visibleMaterials('tower')
    .filter((m) => m.groups.includes('plaza'));
  const sharedHits = towerReport.perMaterial
    .filter((r) => sharedMaterials.some((m) => m.id === r.materialId));
  assert.ok(sharedHits.length > 0);

  const towerCompiles = compiler.totalCompiled - plazaCompiles;
  assert.ok(towerCompiles <= newMaterials.length, '只为新出现材质编译');

  const beforeReturn = compiler.totalCompiled;
  const returnReport = await controller.enterCamera('plaza', DEFAULT_RENDER_SETTINGS);
  assert.equal(compiler.totalCompiled, beforeReturn, '重返广场零编译');
  assert.equal(returnReport.firstVisibleDelayMs, 0, '全命中时 FVD 趋近 0');
  assert.ok(cache.hitRate > 0.3);
});

await flush();

console.log(`\n结果: ${passed} 通过, ${failures.length} 失败`);
if (failures.length) {
  for (const { name, error } of failures) {
    console.log(`\n失败用例: ${name}`);
    console.log(error.stack);
  }
  process.exit(1);
}
