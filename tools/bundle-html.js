import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Minimal bundler for headless Chrome on file:// (module CORS is blocked
// there). Inlines the local relative-import graph as IIFE modules.

export async function bundleHTML(htmlPath, outPath) {
  const root = dirname(htmlPath);
  let html = await readFile(htmlPath, "utf8");
  // Inline local stylesheets so the bundle is self-contained on file://.
  const styleRefs = [...html.matchAll(
    /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*>/g)];
  for (const ref of styleRefs) {
    const cssPath = resolve(root, ref[1]);
    const css = await readFile(cssPath, "utf8");
    html = html.replace(ref[0], `<style>\n${css}\n</style>`);
  }
  const inline = html.match(/<script\s+type="module">([\s\S]*?)<\/script>/);
  const external = html.match(/<script\s+type="module"\s+src="([^"]+)"><\/script>/);
  if (!inline && !external) throw new Error("no module script found");
  const entrySrc = inline ? inline[1] : "";
  const entryPath = external ? resolve(root, external[1]) : null;

  const modules = new Map();
  let nextId = 0;
  async function load(absPath) {
    if (modules.has(absPath)) return modules.get(absPath);
    const record = { absPath, imports: [], exports: [], id: nextId++ };
    modules.set(absPath, record);
    let src = await readFile(absPath, "utf8");
    const depSpecs = [...src.matchAll(
      /import\s*\{([^}]+)\}\s*from\s*"([^"]+)";?/g)];
    for (const m of depSpecs) {
      const depPath = resolve(dirname(absPath), m[2]);
      const dep = await load(depPath);
      record.imports.push({ id: dep.id, names: splitNames(m[1]) });
    }
    const importBlocks = [];
    for (const imp of record.imports) {
      const alias = (n) => `${n}: __imp_${imp.id}_${n}`;
      importBlocks.push(
        `const {${imp.names.map(alias).join(", ")}} = __m${imp.id};
${imp.names.map((n) => `const ${n} = __imp_${imp.id}_${n};`).join("\n")}`);
    }
    src = src.replace(/import\s*\{[^}]+\}\s*from\s*"[^"]+";?/g, () => importBlocks.shift());
    src = src.replace(/export\s+(const|function|class)\s+([A-Za-z0-9_$]+)/g,
      (_, kind, name) => {
        record.exports.push(name);
        return `${kind} ${name}`;
      });
    record.src = src;
    return record;
  }

  const entryImports = [...entrySrc
    .matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)";?/g)];
  const entryRecords = [];
  const importSpecs = [...entryImports];
  if (entryPath) {
    const entryMod = await load(entryPath);
    entryRecords.push(entryMod);
    importSpecs.push([null, "*", entryPath]);
  }
  for (const m of entryImports) {
    entryRecords.push(await load(resolve(root, m[2])));
  }
  const ordered = topoSort([...modules.values()]);
  const blocks = ordered.map((mod) => {
    const ret = `return { ${mod.exports.join(", ")} };`;
    return `const __m${mod.id} = (() => {\n${mod.src}\n${ret}\n})();`;
  });

  let entryBody = entrySrc
    .replace(/import\s*\{[^}]+\}\s*from\s*"[^"]+";?/g, "")
    .trim();
  const entryBindings = entryPath
    ? ""
    : entryRecords.map((r, k) =>
      splitNames(entryImports[k][1]).map((n) =>
        `const ${n} = __m${r.id}.${n};`).join("\n")).join("\n");

  const script = `<script>
"use strict";
${blocks.join("\n\n")}
${entryBindings}
${entryBody}
</script>`;
  html = html.replace(inline ? inline[0] : external[0], script);
  await writeFile(outPath, html);
  return outPath;
}

function topoSort(mods) {
  const byId = new Map(mods.map((m) => [m.id, m]));
  const seen = new Set();
  const out = [];
  const visit = (mod) => {
    if (seen.has(mod.id)) return;
    seen.add(mod.id);
    for (const imp of mod.imports) visit(byId.get(imp.id));
    out.push(mod);
  };
  mods.forEach(visit);
  return out;
}

function splitNames(text) {
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , input, output] = process.argv;
  await bundleHTML(resolve(input), resolve(output));
  console.log("bundled ->", output);
}
