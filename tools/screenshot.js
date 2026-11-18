import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";

export function wslToWindows(path) {
  return execSync(`wslpath -w "${path}"`).toString().trim();
}

export function screenshot({ htmlPath, httpUrl, outputPath, width, height, query = "" }) {
  if (!existsSync(CHROME)) {
    throw new Error(`Chrome not found at ${CHROME}`);
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  const winOut = wslToWindows(outputPath);
  const url = httpUrl
    ? `${httpUrl}${query}`
    : `file:///${wslToWindows(htmlPath).replace(/\\/g, "/")}${query}`;
  const args = [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--virtual-time-budget=3000",
    `--screenshot=${winOut}`,
    `--window-size=${width},${height}`,
    "--default-background-color=0d1622ff",
    url
  ];
  execFileSync(CHROME, args, { stdio: "pipe" });
  return outputPath;
}

if (process.argv[1] && process.argv[1].endsWith("screenshot.js") && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { bundleHTML } = await import("./bundle-html.js");
  const { rm } = await import("node:fs/promises");
  const out = join(root, "exports", "_probe.png");
  const bundled = join(root, "exports", "_probe-bundle.html");
  await bundleHTML(join(root, "export-view.html"), bundled);
  screenshot({
    htmlPath: bundled,
    outputPath: out,
    width: 1400,
    height: 900,
    query: "?mode=shaded"
  });
  await rm(bundled, { force: true });
  console.log("probe ->", out);
}
