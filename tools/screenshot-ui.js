import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rm } from "node:fs/promises";
import { screenshot } from "./screenshot.js";
import { bundleHTML } from "./bundle-html.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const exportsDir = join(root, "exports");
const bundled = join(exportsDir, "_ui-state-bundle.html");
await bundleHTML(join(root, "ui-state.html"), bundled);
const mainBundle = join(exportsDir, "_ui-main-bundle.html");
await bundleHTML(join(root, "index.html"), mainBundle);

screenshot({
  htmlPath: mainBundle,
  outputPath: join(exportsDir, "ui.png"),
  width: 1440,
  height: 900
});
console.log("exported", join(exportsDir, "ui.png"));

for (const mode of ["shaded", "wireframe"]) {
  const out = screenshot({
    htmlPath: bundled,
    outputPath: join(exportsDir, `ui-local-${mode}.png`),
    width: 1440,
    height: 900,
    query: `?mode=${mode}`
  });
  console.log("exported", out);
}
await rm(bundled, { force: true });
await rm(mainBundle, { force: true });
