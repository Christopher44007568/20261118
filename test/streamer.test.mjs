import assert from "node:assert/strict";
import { test } from "node:test";
import { TextureStreamer } from "../src/streamer.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function payload(level, average = [24, 28, 44]) {
  const size = 64 << level;
  return {
    width: size,
    height: size,
    bytes: size * size * 4,
    average,
    token: `L${level}`
  };
}

function createHarness(options = {}) {
  const requests = [];
  const events = [];
  const loader = ({ asset, level, signal }) => new Promise((resolve, reject) => {
    const request = { assetId: asset.id, level, resolve, reject, settled: false };
    requests.push(request);
    signal.addEventListener("abort", () => {
      request.aborted = true;
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  const streamer = new TextureStreamer({
    loader,
    concurrency: options.concurrency ?? 1,
    now: () => Date.now(),
    onEvent: (event) => events.push(event)
  });
  streamer.addAsset({
    id: "art",
    name: "Art",
    targetLevel: options.targetLevel ?? 3,
    referenceAverage: [24, 28, 44]
  });
  return { streamer, requests, events };
}

async function settle(harness, level, average) {
  const request = [...harness.requests].reverse().find(
    (item) => item.level === level && !item.settled
  );
  assert.ok(request, `expected an in-flight L${level} request`);
  request.settled = true;
  request.resolve(payload(level, average));
  await tick();
  await tick();
  return request;
}

async function reject(harness, level) {
  const request = [...harness.requests].reverse().find(
    (item) => item.level === level && !item.settled
  );
  assert.ok(request, `expected an in-flight L${level} request`);
  request.settled = true;
  request.reject(new Error("socket reset"));
  await tick();
  await tick();
}

test("loads missing mips in base-first order and applies each upgrade", async () => {
  const harness = createHarness({ targetLevel: 3 });
  harness.streamer.kick();
  await tick();
  assert.deepEqual(harness.requests.map((request) => request.level), [0]);

  await settle(harness, 0);
  assert.equal(harness.requests.at(-1).level, 1);
  await settle(harness, 1);
  assert.equal(harness.requests.at(-1).level, 2);
  await settle(harness, 2);
  assert.equal(harness.requests.at(-1).level, 3);
  await settle(harness, 3);

  const snapshot = harness.streamer.getSnapshot();
  assert.equal(snapshot.assets[0].currentLevel, 3);
  assert.deepEqual(snapshot.assets[0].residentLevels, [0, 1, 2, 3]);
  assert.equal(snapshot.replacements, 3);
  assert.deepEqual(snapshot.levels.map((level) => level.count), [1, 1, 1, 1]);
  assert.equal(snapshot.idle, true);
});

test("rapid turn and return reuses resident mips without refetching", async () => {
  const harness = createHarness({ targetLevel: 3 });
  harness.streamer.kick();
  await tick();
  for (let level = 0; level <= 3; level += 1) {
    await settle(harness, level);
  }
  const requestsBefore = harness.streamer.getSnapshot().requests;

  harness.streamer.setTargets({ art: 0 });
  assert.equal(harness.streamer.getAsset("art").currentLevel, 0);
  harness.streamer.setTargets({ art: 3 });
  await tick();

  const snapshot = harness.streamer.getSnapshot();
  assert.equal(snapshot.requests, requestsBefore);
  assert.equal(snapshot.assets[0].currentLevel, 3);
  assert.ok(snapshot.cacheHits >= 1);
  assert.equal(snapshot.cancellations, 0);
  assert.deepEqual(snapshot.assets[0].residentLevels, [0, 1, 2, 3]);
});

test("cancelling a detail request keeps the current mip available", async () => {
  const harness = createHarness({ targetLevel: 3 });
  harness.streamer.kick();
  await tick();
  await settle(harness, 0);
  await settle(harness, 1);
  await settle(harness, 2);
  assert.equal(harness.requests.at(-1).level, 3);

  const cancelled = harness.streamer.abortInFlight("test-cancel");
  await tick();

  const state = harness.streamer.getAsset("art");
  const snapshot = harness.streamer.getSnapshot();
  assert.equal(cancelled, 1);
  assert.equal(state.currentLevel, 2);
  assert.equal(state.current.token, "L2");
  assert.deepEqual([...state.levels.keys()], [0, 1, 2]);
  assert.equal(snapshot.cancellations, 1);
  assert.equal(snapshot.failures, 0);
});

test("a failed detail request preserves the last good mip", async () => {
  const harness = createHarness({ targetLevel: 3 });
  harness.streamer.kick();
  await tick();
  await settle(harness, 0);
  await settle(harness, 1);
  await settle(harness, 2);
  await reject(harness, 3);

  const state = harness.streamer.getAsset("art");
  const snapshot = harness.streamer.getSnapshot();
  assert.equal(state.currentLevel, 2);
  assert.equal(state.current.token, "L2");
  assert.deepEqual([...state.failed], [3]);
  assert.equal(snapshot.failures, 1);
  assert.equal(snapshot.idle, true);
});

test("lowering the camera LOD cancels stale work but pins high mips in cache", async () => {
  const harness = createHarness({ targetLevel: 3 });
  harness.streamer.kick();
  await tick();
  await settle(harness, 0);
  await settle(harness, 1);
  await settle(harness, 2);
  assert.equal(harness.requests.at(-1).level, 3);

  harness.streamer.setTargets({ art: 0 });
  await tick();
  const state = harness.streamer.getAsset("art");
  const snapshot = harness.streamer.getSnapshot();

  assert.equal(state.currentLevel, 0);
  assert.deepEqual([...state.levels.keys()], [0, 1, 2]);
  assert.equal(snapshot.cancellations, 1);
  assert.equal(snapshot.cacheHits, 0);
});

test("color means stay stable across progressively decoded levels", async () => {
  const harness = createHarness({ targetLevel: 3 });
  harness.streamer.kick();
  await tick();
  await settle(harness, 0, [24.0, 28.0, 44.0]);
  await settle(harness, 1, [24.4, 27.8, 44.2]);
  await settle(harness, 2, [23.8, 28.2, 43.9]);
  await settle(harness, 3, [24.1, 28.1, 44.1]);

  const snapshot = harness.streamer.getSnapshot();
  assert.ok(snapshot.colorDriftMax < 0.5);
  assert.ok(snapshot.swapDriftMax < 1.0);
  assert.ok(snapshot.colorDriftMean < 0.3);
});

test("retry after a transient failure hydrates the previously held mip", async () => {
  const harness = createHarness({ targetLevel: 2 });
  harness.streamer.kick();
  await tick();
  await settle(harness, 0);
  await settle(harness, 1);
  await reject(harness, 2);
  assert.equal(harness.streamer.getAsset("art").currentLevel, 1);

  assert.equal(harness.streamer.retryFailures(), 1);
  await tick();
  assert.equal(harness.requests.at(-1).level, 2);
  await settle(harness, 2);
  assert.equal(harness.streamer.getAsset("art").currentLevel, 2);
});
