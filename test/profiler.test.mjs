import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PassStats, FrameStats } from '../src/stats.js';
import { GpuProfiler } from '../src/profiler.js';
import { PASS_NAMES } from '../src/renderer.js';
import { installGpuGlobals, MockDevice } from './mock-device.mjs';

installGpuGlobals();

const MS_TO_NS = 1_000_000n;
// Long post-process, tiny empty pass: the attribution scenario.
const BASE_DURATIONS_NS = [1_000_000n, 2_000_000n, 8_000_000n, 200_000n, 0n];

function makeGpuProfiler(durations = BASE_DURATIONS_NS.slice()) {
  const device = new MockDevice(durations);
  const profiler = new GpuProfiler({ device, passNames: PASS_NAMES, gpuTimestamps: true });
  return { device, profiler };
}

// Encodes one frame exactly like Renderer.frame does (pass order matters).
function encodeFrame(profiler, device) {
  if (!profiler.beginFrame()) return false;
  const encoder = device.createCommandEncoder();
  for (const name of PASS_NAMES) {
    const pass = encoder.beginRenderPass(profiler.wrapPassDescriptor(name, { label: name }));
    pass.end();
    profiler.endPass(name);
  }
  profiler.finishFrame(encoder);
  device.queue.submit([encoder.finish()]);
  return true;
}

test('PassStats keeps a 120-frame window with correct mean and percentiles', () => {
  const stats = new PassStats(120);
  for (let i = 0; i < 150; i += 1) stats.push(1);
  assert.equal(stats.size, 120);
  assert.equal(stats.mean(), 1);
  // overwrite the newest 12 samples with 10 -> exactly 10% spikes
  for (let i = 0; i < 12; i += 1) stats.push(10);
  assert.equal(stats.mean(), (108 * 1 + 12 * 10) / 120);
  assert.equal(stats.percentile(0.95), 10);
  assert.equal(stats.percentile(0.99), 10);
  assert.equal(stats.percentile(0.5), 1);
});

test('FrameStats only records passes present in the sample map', () => {
  const stats = new FrameStats(['a', 'b']);
  stats.recordFrame({ a: 2 });
  assert.equal(stats.snapshot().a.n, 1);
  assert.equal(stats.snapshot().b.n, 0);
});

test('GPU mode attributes per-pass times, empty pass is ~0, post dominates', async () => {
  const { device, profiler } = makeGpuProfiler();
  assert.equal(profiler.mode, 'gpu');
  assert.match(profiler.capabilityNote, /timestamp-query supported/);

  for (let f = 0; f < 130; f += 1) {
    assert.equal(encodeFrame(profiler, device), true);
    await profiler.drain();
  }

  const snap = profiler.snapshot().passes;
  for (const name of PASS_NAMES) assert.equal(snap[name].n, 120, `${name} window`);
  assert.ok(Math.abs(snap.shadow.mean - 1) < 1e-9);
  assert.ok(Math.abs(snap.scene.mean - 2) < 1e-9);
  assert.ok(Math.abs(snap.post.mean - 8) < 1e-9);
  assert.ok(Math.abs(snap.ui.mean - 0.2) < 1e-9);
  assert.equal(snap.empty.mean, 0);
  assert.equal(snap.empty.p95, 0);
  // attribution: ordering matches the injected GPU durations
  assert.ok(snap.post.mean > snap.scene.mean);
  assert.ok(snap.scene.mean > snap.shadow.mean);
  assert.ok(snap.shadow.mean > snap.ui.mean);
  assert.ok(snap.ui.mean > snap.empty.mean);
});

test('GPU mode p95 reflects a spike burst in the last 120 frames', async () => {
  const durations = BASE_DURATIONS_NS.slice();
  const { device, profiler } = makeGpuProfiler(durations);
  for (let f = 0; f < 130; f += 1) {
    // frames 100..111: post-process spikes from 8ms to 20ms (12 of 120 kept)
    durations[2] = f >= 100 && f < 112 ? 20n * MS_TO_NS : 8n * MS_TO_NS;
    encodeFrame(profiler, device);
    await profiler.drain();
  }
  const post = profiler.snapshot().passes.post;
  assert.equal(post.n, 120);
  assert.equal(post.p95, 20);
  assert.ok(Math.abs(post.mean - (108 * 8 + 12 * 20) / 120) < 1e-9);
});

test('timestampWrites indices are wired one slot pair per pass', () => {
  const { device, profiler } = makeGpuProfiler();
  encodeFrame(profiler, device);
  const passes = device.queue.submissions[0][0].passes;
  assert.equal(passes.length, PASS_NAMES.length);
  passes.forEach((p, i) => {
    assert.equal(p.timestampWrites.beginningOfPassWriteIndex, i * 2);
    assert.equal(p.timestampWrites.endOfPassWriteIndex, i * 2 + 1);
  });
});

test('CPU fallback records encode intervals and reports capability gap', () => {
  let t = 0;
  const profiler = new GpuProfiler({
    device: new MockDevice([]),
    passNames: PASS_NAMES,
    gpuTimestamps: false,
    now: () => t,
  });
  assert.equal(profiler.mode, 'cpu');
  assert.match(profiler.capabilityNote, /NOT supported/);
  assert.match(profiler.capabilityNote, /CPU encode-interval/);

  const deltas = { shadow: 0.1, scene: 0.3, post: 0.5, ui: 0.05, empty: 0.0 };
  for (let f = 0; f < 130; f += 1) {
    assert.equal(profiler.beginFrame(), true);
    for (const name of PASS_NAMES) {
      profiler.wrapPassDescriptor(name, {});
      t += deltas[name]; // simulated CPU encode cost in ms
      profiler.endPass(name);
    }
    profiler.finishFrame(null);
  }
  const snap = profiler.snapshot().passes;
  assert.equal(snap.post.n, 120);
  assert.ok(Math.abs(snap.post.mean - 0.5) < 1e-9);
  assert.ok(Math.abs(snap.empty.mean - 0) < 1e-9);
  assert.ok(snap.post.mean > snap.scene.mean);
});

test('paused frames never accumulate or duplicate samples', async () => {
  const { device, profiler } = makeGpuProfiler();
  for (let f = 0; f < 10; f += 1) {
    encodeFrame(profiler, device);
    await profiler.drain();
  }
  assert.equal(profiler.snapshot().passes.post.n, 10);

  profiler.setPaused(true);
  for (let f = 0; f < 50; f += 1) {
    // renderer skips submission when beginFrame rejects the frame
    assert.equal(encodeFrame(profiler, device), false);
  }
  await profiler.drain();
  assert.equal(profiler.snapshot().passes.post.n, 10);

  // stray finishFrame/poll without an active frame must be no-ops
  profiler.finishFrame(null);
  assert.equal(await profiler.poll(), false);
  assert.equal(profiler.snapshot().passes.post.n, 10);

  profiler.setPaused(false);
  encodeFrame(profiler, device);
  await profiler.drain();
  assert.equal(profiler.snapshot().passes.post.n, 11);
});

test('readback pool exhaustion drops frames instead of double counting', async () => {
  const { device, profiler } = makeGpuProfiler();
  let encoded = 0;
  for (let f = 0; f < 10; f += 1) {
    if (encodeFrame(profiler, device)) encoded += 1; // never polls: pool of 4
  }
  assert.equal(encoded, 4);
  await profiler.drain();
  assert.equal(profiler.snapshot().passes.post.n, 4);
  // buffers returned to the pool: encoding works again
  assert.equal(encodeFrame(profiler, device), true);
  await profiler.drain();
  assert.equal(profiler.snapshot().passes.post.n, 5);
});
