"use strict";

const { test, expect } = require("@playwright/test");
const path = require("path");

const pageUrl = "file://" + path.resolve(__dirname, "..", "index.html");

async function readLab(page) {
  return page.evaluate(() => {
    const lab = window.__hdrLab;
    const text = (id) => document.getElementById(id).textContent;
    return {
      ready: lab.ready,
      state: lab.state,
      metrics: lab.metrics,
      ui: {
        peakLinear: text("peak-linear"),
        bufferClipped: text("buffer-clipped"),
        roMode: text("ro-mode"),
        roSize: text("ro-size"),
        roPeak: text("ro-peak"),
        roClipped: text("ro-clipped"),
        roHex: text("ro-hex"),
        roRgb: text("ro-rgb"),
        roDisplayClip: text("ro-display-clip"),
        footer: text("footer-meta"),
      },
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await page.goto(pageUrl);
  await page.waitForFunction(() => window.__hdrLab && window.__hdrLab.ready);
  await page.waitForFunction(() => window.__hdrLab.metrics && window.__hdrLab.metrics.peak > 1);
});

test("RGBA16F intermediate buffer keeps HDR values above 1.0 with zero clipping", async ({ page }) => {
  const lab = await readLab(page);
  expect(lab.metrics.peak).toBeGreaterThan(10);
  expect(lab.metrics.bufferClipped).toBe(0);
  expect(lab.ui.peakLinear).toMatch(/×$/);
  expect(lab.ui.bufferClipped).toContain("0");
});

test("SDR preview reports 8-bit display clip and a 100 nit highlight", async ({ page }) => {
  const lab = await readLab(page);
  expect(lab.state.mode).toBe("sdr");
  expect(lab.metrics.displayClip).toBeGreaterThan(0);
  expect(lab.metrics.highlight.nits).toBeGreaterThan(95);
  expect(lab.metrics.highlight.nits).toBeLessThanOrEqual(100);
  expect(lab.ui.roHex).toMatch(/^#[0-9a-f]{6}$/);
  expect(lab.ui.roMode).toContain("SDR");
});

test("HDR/PQ preview shares exposure baseline and avoids 8-bit clip", async ({ page }) => {
  const sdr = await readLab(page);
  await page.evaluate(() => window.__hdrLab.setMode("hdr"));
  await page.waitForFunction(() => window.__hdrLab.state.mode === "hdr");
  const hdr = await readLab(page);

  expect(hdr.state.evStops).toBe(sdr.state.evStops);
  expect(Math.abs(hdr.metrics.peak - sdr.metrics.peak)).toBeLessThan(0.25);
  expect(hdr.metrics.bufferClipped).toBe(0);
  expect(hdr.metrics.displayClip).toBe(0);
  expect(hdr.metrics.highlight.nits).toBeGreaterThan(700);
  expect(hdr.metrics.highlight.nits).toBeLessThan(1000);
  expect(hdr.ui.roMode).toContain("HDR");
});

test("shared EV changes both previews while keeping the float buffer untouched", async ({ page }) => {
  const baseline = await readLab(page);
  await page.evaluate(() => window.__hdrLab.setEv(1.5));
  await page.waitForFunction(() => Math.abs(window.__hdrLab.state.evStops - 1.5) < 1e-6);
  const brighter = await readLab(page);

  expect(Math.abs(brighter.metrics.peak - baseline.metrics.peak)).toBeLessThan(0.25);
  expect(brighter.metrics.displayClip).toBeGreaterThan(baseline.metrics.displayClip);
  expect(brighter.ui.footer).toContain("+1.5 EV shared");

  await page.evaluate(() => window.__hdrLab.setMode("hdr"));
  await page.waitForFunction(() => window.__hdrLab.state.mode === "hdr");
  const hdr = await readLab(page);
  expect(hdr.state.evStops).toBeCloseTo(1.5, 1e-6);
});

test("window resize rebuilds the buffers and keeps metrics valid", async ({ page }) => {
  const desktop = await readLab(page);
  expect(desktop.ui.roSize).toBe("1200 × 760");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => window.__hdrLab.metrics && window.__hdrLab.metrics.cssWidth === 390
  );
  const mobile = await readLab(page);
  expect(mobile.metrics.cssWidth).toBe(390);
  expect(mobile.metrics.cssHeight).toBe(844);
  expect(mobile.metrics.peak).toBeGreaterThan(10);
  expect(mobile.metrics.bufferClipped).toBe(0);
  expect(mobile.metrics.width).toBeLessThan(desktop.metrics.width);
  expect(Math.abs(mobile.metrics.peak - desktop.metrics.peak)).toBeLessThan(1.0);
  expect(mobile.metrics.highlight.byte.slice(0, 3)).toEqual(
    desktop.metrics.highlight.byte.slice(0, 3)
  );

  await page.setViewportSize({ width: 900, height: 600 });
  await page.waitForFunction(
    () => window.__hdrLab.metrics && window.__hdrLab.metrics.cssWidth === 900
  );
  const mid = await readLab(page);
  expect(mid.metrics.cssWidth).toBe(900);
  expect(mid.metrics.bufferClipped).toBe(0);
  expect(mid.ui.roSize).toBe("900 × 600");
  expect(Math.abs(mid.metrics.peak - desktop.metrics.peak)).toBeLessThan(1.0);
});
