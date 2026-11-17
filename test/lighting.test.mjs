import test from "node:test";
import assert from "node:assert/strict";
import {
  RENDER_HEIGHT,
  RENDER_WIDTH,
  TILE_SIZE,
  animateLights,
  buildTileLights,
  createLights,
  evaluateReference,
  evaluateTiled,
  tileIndexOf
} from "../src/lighting.js";

function assertTileListsAreConservative(lights, tiles) {
  for (let row = 0; row < tiles.rows; row += 1) {
    for (let column = 0; column < tiles.columns; column += 1) {
      const tile = row * tiles.columns + column;
      const left = column * tiles.tileSize;
      const top = row * tiles.tileSize;
      const previous = -1;
      let lastIndex = previous;

      for (let entry = 0; entry < tiles.counts[tile]; entry += 1) {
        const lightIndex =
          tiles.indices[tile * tiles.maxLightsPerTile + entry];
        assert.ok(
          lightIndex > lastIndex,
          "tile light indices must stay in ascending order"
        );
        lastIndex = lightIndex;

        const light = lights[lightIndex];
        const radius = (light.currentRadius ?? light.radius) * tiles.height;
        const px = light.x * tiles.width;
        const py = light.y * tiles.height;
        const intersects =
          px + radius >= left &&
          px - radius <= left + tiles.tileSize &&
          py + radius >= top &&
          py - radius <= top + tiles.tileSize;
        assert.ok(intersects, "a listed light must intersect its tile AABB");
      }
    }
  }
}

test("tile lists are conservative and keep a stable accumulation order", () => {
  const lights = createLights();
  for (const time of [0, 1.7, 4.2, 9.5]) {
    animateLights(lights, time);
    const tiles = buildTileLights(lights);
    assert.equal(tiles.overflow, 0);
    assertTileListsAreConservative(lights, tiles);

    for (let py = 3; py < RENDER_HEIGHT; py += 17) {
      for (let px = 5; px < RENDER_WIDTH; px += 19) {
        const reference = evaluateReference(px, py, lights, RENDER_WIDTH, RENDER_HEIGHT);
        const tiled = evaluateTiled(px, py, lights, tiles);
        assert.equal(tiled, reference);
      }
    }
  }
});

test("a light crossing vertical and horizontal tile edges never disappears", () => {
  const probe = {
    x: 0,
    y: 256 / RENDER_HEIGHT,
    radius: 0.2,
    intensity: 2.4,
    currentRadius: 0.2,
    currentIntensity: 2.4,
    color: [1, 1, 1]
  };
  const lights = [probe];
  const start = (384 - 80) / RENDER_WIDTH;
  const end = (448 + 80) / RENDER_WIDTH;

  for (let step = 0; step <= 96; step += 1) {
    probe.x = start + ((end - start) * step) / 96;
    probe.y = (256 - 28 + Math.sin(step * 0.2) * 56) / RENDER_HEIGHT;
    const tiles = buildTileLights(lights);
    assertTileListsAreConservative(lights, tiles);

    for (let py = 0.5; py < RENDER_HEIGHT; py += 7) {
      for (let px = 0.5; px < RENDER_WIDTH; px += 7) {
        const reference = evaluateReference(px, py, lights, RENDER_WIDTH, RENDER_HEIGHT);
        const tiled = evaluateTiled(px, py, lights, tiles);
        assert.equal(tiled, reference);
      }
    }
  }
});

test("the animated multi-light scene stays exact through repeated crossings", () => {
  const lights = createLights();
  let previousCenters = null;
  let crossings = 0;

  for (let time = 0; time < 20; time += 0.07) {
    animateLights(lights, time);
    const tiles = buildTileLights(lights);
    const centers = tiles.bounds.map((bound) => bound.centerTile);
    if (previousCenters) {
      crossings += centers.reduce(
        (count, center, index) =>
          count + (center !== previousCenters[index] ? 1 : 0),
        0
      );
    }
    previousCenters = centers;

    for (let py = 3.5; py < RENDER_HEIGHT; py += 23) {
      for (let px = 4.5; px < RENDER_WIDTH; px += 23) {
        const reference = evaluateReference(
          px,
          py,
          lights,
          RENDER_WIDTH,
          RENDER_HEIGHT
        );
        const tiled = evaluateTiled(px, py, lights, tiles);
        assert.equal(tiled, reference);
      }
    }
  }

  assert.ok(crossings > 100, `expected sustained boundary motion, got ${crossings}`);
});

test("tile boundary crossing changes residency without dropping contributions", () => {
  const boundaryX = 384;
  const light = {
    x: (boundaryX - 4) / RENDER_WIDTH,
    y: 0.5,
    radius: 0.16,
    intensity: 1,
    currentRadius: 0.16,
    currentIntensity: 1
  };
  const before = buildTileLights([light]);
  light.x = (boundaryX + 4) / RENDER_WIDTH;
  const after = buildTileLights([light]);

  const sampleX = boundaryX - 1;
  const sampleY = 288;
  const tile = tileIndexOf(sampleX, sampleY, after);
  assert.notEqual(
    before.bounds[0].centerTile,
    after.bounds[0].centerTile,
    "the probe must cross a tile boundary"
  );
  assert.ok(
    lightContributionInTile(light, sampleX, sampleY, after, tile.index),
    "the destination tile must retain the light before its center arrives"
  );
});

function lightContributionInTile(light, px, py, tiles, tileIndex) {
  const start = tileIndex * tiles.maxLightsPerTile;
  for (let entry = 0; entry < tiles.counts[tileIndex]; entry += 1) {
    if (tiles.indices[start + entry] === 0) {
      const contribution = evaluateTiled(px, py, [light], tiles);
      return contribution > 0;
    }
  }
  return false;
}
