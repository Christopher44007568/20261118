const HEAT_STOPS = [
  [0.0, [24, 55, 68]],
  [0.28, [28, 109, 117]],
  [0.5, [69, 230, 223]],
  [0.75, [255, 193, 92]],
  [1.0, [255, 109, 125]]
];

function mixColor(a, b, amount) {
  return a.map((channel, index) => Math.round(channel + (b[index] - channel) * amount));
}

export function heatColor(normalized) {
  const value = Math.min(1, Math.max(0, normalized));
  for (let index = 1; index < HEAT_STOPS.length; index += 1) {
    const [end, endColor] = HEAT_STOPS[index];
    if (value <= end) {
      const [start, startColor] = HEAT_STOPS[index - 1];
      return mixColor(startColor, endColor, (value - start) / (end - start));
    }
  }
  return HEAT_STOPS[HEAT_STOPS.length - 1][1];
}

export function drawHeatmap(context, tiles, intensity = 1) {
  const { columns, rows, tileSize, counts, maxLoad } = tiles;
  const scale = context.canvas.width / (columns * tileSize);
  const cellWidth = tileSize * scale;
  const cellHeight = (context.canvas.height / rows) * scale;
  const denominator = Math.max(1, maxLoad);

  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.save();
  context.lineWidth = Math.max(1, scale);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const count = counts[row * columns + column];
      const x = column * cellWidth;
      const y = row * cellHeight;
      const normalized = count / denominator;
      const [red, green, blue] = heatColor(normalized);

      if (count > 0) {
        context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${
          (0.065 + normalized * 0.19) * intensity
        })`;
        context.fillRect(x, y, cellWidth, cellHeight);
      }

      context.strokeStyle =
        count === maxLoad && count > 0
          ? `rgba(255, 132, 145, ${0.65 * intensity})`
          : `rgba(117, 201, 208, ${(0.14 + normalized * 0.2) * intensity})`;
      context.strokeRect(
        x + context.lineWidth * 0.5,
        y + context.lineWidth * 0.5,
        cellWidth - context.lineWidth,
        cellHeight - context.lineWidth
      );

      context.font = `600 ${Math.round(18 * scale)}px "SFMono-Regular", "Cascadia Mono", monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.shadowColor = "rgba(0, 0, 0, 0.8)";
      context.shadowBlur = 4 * scale;
      context.fillStyle =
        count === 0
          ? `rgba(169, 205, 212, ${0.27 * intensity})`
          : normalized > 0.62
            ? `rgba(255, 249, 235, ${0.9 * intensity})`
            : `rgba(208, 244, 245, ${(0.6 + normalized * 0.3) * intensity})`;
      context.fillText(
        String(count),
        x + cellWidth * 0.5,
        y + cellHeight * 0.5 + scale
      );
      context.shadowBlur = 0;
    }
  }

  const gradient = context.createLinearGradient(0, 0, 0, context.canvas.height);
  gradient.addColorStop(0, "rgba(4, 9, 14, 0.05)");
  gradient.addColorStop(0.72, "rgba(4, 9, 14, 0.0)");
  gradient.addColorStop(1, "rgba(4, 9, 14, 0.18)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  context.restore();
}

export function createHistogram(container, tiles) {
  const peak = Math.max(1, ...Array.from(tiles.counts));
  const buckets = new Array(peak + 1).fill(0);
  for (const count of tiles.counts) {
    buckets[count] += 1;
  }
  const tallest = Math.max(1, ...buckets);

  container.replaceChildren();
  buckets.forEach((count, load) => {
    const wrap = document.createElement("div");
    wrap.className = "bar-wrap";
    wrap.title = `${count} tiles contain ${load} lights`;
    const bar = document.createElement("div");
    bar.className = "bar";
    const normalized = load / Math.max(1, peak);
    const [red, green, blue] = heatColor(normalized);
    bar.style.height = `${Math.max(count > 0 ? 4 : 0, (count / tallest) * 91)}%`;
    bar.style.background = `linear-gradient(to top, rgba(${red}, ${green}, ${blue}, 0.2), rgba(${red}, ${green}, ${blue}, 0.92))`;
    wrap.append(bar);
    if (load % 2 === 0 || load === peak) {
      const label = document.createElement("span");
      label.className = "bar-label";
      label.textContent = String(load);
      wrap.append(label);
    }
    container.append(wrap);
  });
  return { buckets, peak };
}
