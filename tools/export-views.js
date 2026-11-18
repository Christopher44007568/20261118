import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rm } from "node:fs/promises";
import { screenshot } from "./screenshot.js";
import { bundleHTML } from "./bundle-html.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const exportsDir = join(root, "exports");
const bundled = join(exportsDir, "_export-bundle.html");
await bundleHTML(join(root, "export-view.html"), bundled);

const jobs = [
  { name: "shaded.png", query: "?mode=shaded" },
  { name: "wireframe.png", query: "?mode=wireframe" },
  { name: "shaded-local.png", query: "?mode=shaded&moved=1" },
  { name: "wireframe-local.png", query: "?mode=wireframe&moved=1" }
];

try {
  for (const job of jobs) {
    const out = screenshot({
      htmlPath: bundled,
      outputPath: join(exportsDir, job.name),
      width: 1400,
      height: 900,
      query: job.query
    });
    console.log("exported", out);
  }
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await rm(bundled, { force: true });
}
