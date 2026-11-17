export const RENDER_WIDTH = 832;
export const RENDER_HEIGHT = 576;
export const TILE_SIZE = 64;
export const MAX_LIGHTS = 48;

const TAU = Math.PI * 2;
const PALETTE = [
  [0.22, 0.92, 0.93],
  [0.97, 0.35, 0.48],
  [1.0, 0.67, 0.25],
  [0.58, 0.43, 1.0],
  [0.35, 1.0, 0.63],
  [0.34, 0.58, 1.0]
];

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createLights() {
  const lights = [];

  for (let cluster = 0; cluster < 4; cluster += 1) {
    const centers = [
      [0.27, 0.28],
      [0.73, 0.3],
      [0.3, 0.73],
      [0.72, 0.7]
    ][cluster];
    for (let member = 0; member < 6; member += 1) {
      const index = lights.length;
      lights.push({
        x: centers[0],
        y: centers[1],
        radius: 0.14 + ((index * 7) % 5) * 0.011,
        intensity: 1.2 + (index % 4) * 0.18,
        color: PALETTE[(cluster + member) % PALETTE.length],
        mode: "orbit",
        cluster,
        centerX: centers[0],
        centerY: centers[1],
        orbitX: 0.055 + (member % 3) * 0.027,
        orbitY: 0.045 + ((member + 1) % 3) * 0.03,
        phase: (member / 6) * TAU + cluster * 0.42,
        speed: 0.2 + (cluster % 2) * 0.045,
        pulse: 0.1 + (index % 3) * 0.06
      });
    }
  }

  for (let lane = 0; lane < 10; lane += 1) {
    const index = lights.length;
    lights.push({
      x: 0.5,
      y: 0.08 + lane * 0.092,
      radius: 0.135 + (lane % 4) * 0.012,
      intensity: 1.18 + (lane % 3) * 0.2,
      color: PALETTE[(lane + 2) % PALETTE.length],
      mode: "sweep",
      phase: lane * 0.71,
      speed: 0.17 + (lane % 3) * 0.025,
      amplitude: 0.37 - (lane % 3) * 0.035,
      wave: lane % 2 === 0 ? 1 : -1,
      pulse: 0.08 + (lane % 2) * 0.07
    });
  }

  for (let index = 0; index < 6; index += 1) {
    lights.push({
      x: 0.5,
      y: 0.5,
      radius: 0.165 + index * 0.009,
      intensity: 1.35 + index * 0.09,
      color: PALETTE[(index + 4) % PALETTE.length],
      mode: "comet",
      phase: (index / 6) * TAU,
      speed: 0.13 + index * 0.007,
      pulse: 0.12
    });
  }

  lights.push({
    x: 0.46,
    y: 0.444,
    radius: 0.19,
    intensity: 2.4,
    color: [1.0, 0.83, 0.48],
    mode: "probe",
    phase: 0,
    speed: 0.62,
    pulse: 0.1,
    isProbe: true
  });

  return lights;
}

export function animateLights(lights, time, stress = false) {
  for (let index = 0; index < lights.length; index += 1) {
    const light = lights[index];
    const t = time;
    let x = light.x;
    let y = light.y;

    if (light.mode === "orbit") {
      const angle = t * light.speed + light.phase;
      x = light.centerX + Math.cos(angle) * light.orbitX;
      y = light.centerY + Math.sin(angle * 0.83) * light.orbitY;
    } else if (light.mode === "sweep") {
      x = 0.5 + Math.sin(t * light.speed + light.phase) * light.amplitude;
      y = light.y + Math.sin(t * 0.14 + light.phase * 1.7) * 0.022;
    } else if (light.mode === "comet") {
      const angle = t * light.speed + light.phase;
      const radiusX = 0.17 + 0.045 * Math.sin(t * 0.11 + light.phase);
      const radiusY = 0.12 + 0.03 * Math.cos(t * 0.09 + light.phase);
      x = 0.5 + Math.cos(angle) * radiusX;
      y = 0.5 + Math.sin(angle * 1.17) * radiusY;
    } else if (light.mode === "probe") {
      const rate = stress ? 2.15 : 0.7;
      x = 0.5 + Math.sin(t * rate) * 0.315;
      y = 0.444 + Math.sin(t * rate * 0.73) * 0.13;
    }

    light.x = clamp(x, 0.015, 0.985);
    light.y = clamp(y, 0.015, 0.985);
    light.currentRadius = light.radius * (1 + Math.sin(t * 0.4 + index) * 0.035);
    light.currentIntensity = light.intensity * (1 + Math.sin(t * 0.9 + index * 1.3) * 0.08);
  }
  return lights;
}

export function buildTileLights(
  lights,
  width = RENDER_WIDTH,
  height = RENDER_HEIGHT,
  tileSize = TILE_SIZE,
  maxLightsPerTile = MAX_LIGHTS
) {
  const columns = Math.ceil(width / tileSize);
  const rows = Math.ceil(height / tileSize);
  const counts = new Uint32Array(columns * rows);
  const indices = new Uint32Array(columns * rows * maxLightsPerTile);
  const bounds = new Array(lights.length);
  let totalEntries = 0;
  let maxLoad = 0;
  let overflow = 0;

  for (let lightIndex = 0; lightIndex < lights.length; lightIndex += 1) {
    const light = lights[lightIndex];
    const radius = (light.currentRadius ?? light.radius) * height;
    const px = light.x * width;
    const py = light.y * height;
    const minColumn = clamp(Math.floor((px - radius) / tileSize), 0, columns - 1);
    const maxColumn = clamp(Math.floor((px + radius) / tileSize), 0, columns - 1);
    const minRow = clamp(Math.floor((py - radius) / tileSize), 0, rows - 1);
    const maxRow = clamp(Math.floor((py + radius) / tileSize), 0, rows - 1);

    bounds[lightIndex] = {
      minColumn,
      maxColumn,
      minRow,
      maxRow,
      centerTile: Math.floor(py / tileSize) * columns + Math.floor(px / tileSize)
    };

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const left = column * tileSize;
        const top = row * tileSize;
        const intersects =
          px + radius >= left &&
          px - radius <= Math.min(left + tileSize, width) &&
          py + radius >= top &&
          py - radius <= Math.min(top + tileSize, height);
        if (!intersects) {
          continue;
        }

        const tile = row * columns + column;
        const count = counts[tile];
        if (count >= maxLightsPerTile) {
          overflow += 1;
          continue;
        }
        indices[tile * maxLightsPerTile + count] = lightIndex;
        counts[tile] = count + 1;
        totalEntries += 1;
        maxLoad = Math.max(maxLoad, count + 1);
      }
    }
  }

  return {
    width,
    height,
    tileSize,
    columns,
    rows,
    maxLightsPerTile,
    counts,
    indices,
    bounds,
    totalEntries,
    maxLoad,
    overflow
  };
}

export function tileIndexOf(x, y, tiles) {
  const column = clamp(Math.floor(x / tiles.tileSize), 0, tiles.columns - 1);
  const row = clamp(Math.floor(y / tiles.tileSize), 0, tiles.rows - 1);
  return { column, row, index: row * tiles.columns + column };
}

export function makeTileTextureData(tiles, lightCount) {
  const textureWidth = tiles.columns * tiles.maxLightsPerTile;
  const textureData = new Uint32Array(textureWidth * tiles.rows);
  for (let row = 0; row < tiles.rows; row += 1) {
    for (let column = 0; column < tiles.columns; column += 1) {
      const tile = row * tiles.columns + column;
      const count = Math.min(tiles.counts[tile], lightCount);
      const target = row * textureWidth + column * tiles.maxLightsPerTile;
      for (let entry = 0; entry < count; entry += 1) {
        textureData[target + entry] =
          tiles.indices[tile * tiles.maxLightsPerTile + entry];
      }
    }
  }
  return { data: textureData, width: textureWidth, height: tiles.rows };
}

export function countCenterCrossings(previous, next) {
  if (!previous) {
    return 0;
  }
  let crossings = 0;
  for (let index = 0; index < next.length; index += 1) {
    if (previous[index] !== next[index].centerTile) {
      crossings += 1;
    }
  }
  return crossings;
}

export function centerTiles(tiles) {
  return tiles.bounds.map((bound) => bound.centerTile);
}

export function lightContribution(px, py, light, width, height) {
  const dx = light.x * width - px;
  const dy = light.y * height - py;
  const distance = Math.hypot(dx, dy);
  const radius = (light.currentRadius ?? light.radius) * height;
  if (distance >= radius) {
    return 0;
  }
  const radial = 1 - distance / radius;
  return (light.currentIntensity ?? light.intensity) * radial * radial;
}

export function evaluateReference(px, py, lights, width, height) {
  let sum = 0;
  for (let index = 0; index < lights.length; index += 1) {
    sum += lightContribution(px, py, lights[index], width, height);
  }
  return sum;
}

export function evaluateTiled(px, py, lights, tiles) {
  const tile = tileIndexOf(px, py, tiles).index;
  const start = tile * tiles.maxLightsPerTile;
  const count = tiles.counts[tile];
  let sum = 0;
  for (let entry = 0; entry < count; entry += 1) {
    sum += lightContribution(
      px,
      py,
      lights[tiles.indices[start + entry]],
      tiles.width,
      tiles.height
    );
  }
  return sum;
}
