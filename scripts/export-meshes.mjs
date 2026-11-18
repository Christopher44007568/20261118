import { mkdir, writeFile } from "node:fs/promises";
import { buildScenarios } from "../src/meshes.js";

const scenarios = buildScenarios(40);
const summary = {
  low: {
    vertices: scenarios.low.vertexCount,
    triangles: scenarios.low.triangleCount,
    uvIslands: 6,
  },
  hard: {
    vertices: scenarios.hard.high.vertexCount,
    triangles: scenarios.hard.high.triangleCount,
  },
  rounded: {
    vertices: scenarios.rounded.high.vertexCount,
    triangles: scenarios.rounded.high.triangleCount,
    segmentsPerSide: 40,
  },
};

await mkdir("public", { recursive: true });
await writeFile("public/scene-stats.json", `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary));
