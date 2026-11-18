import { SceneRenderer } from "./scene.js";
import { TextureStreamer } from "./streamer.js";
import { createTextureLoader, TEXTURE_SPECS } from "./textures.js";

const $ = (selector) => document.querySelector(selector);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};
const formatTime = (milliseconds) => `${(milliseconds / 1000).toFixed(1)}s`;

const dom = {
  canvas: $("#scene"),
  networkToggle: $("#network-toggle"),
  networkLabel: $("#network-label"),
  resetView: $("#reset-view"),
  cameraYaw: $("#camera-yaw"),
  cameraOrbit: $("#camera-orbit"),
  cameraNearest: $("#camera-nearest"),
  frameCounter: $("#frame-counter"),
  focusLabel: $("#focus-label"),
  streamStateLabel: $("#stream-state-label"),
  residentCount: $("#resident-count"),
  queueCount: $("#queue-count"),
  activeCount: $("#active-count"),
  replacementCount: $("#replacement-count"),
  cacheHitCount: $("#cache-hit-count"),
  memoryTotal: $("#memory-total"),
  queueDetail: $("#queue-detail"),
  taskList: $("#task-list"),
  colorDrift: $("#color-drift"),
  colorStatus: $("#color-status"),
  stabilityFill: $("#stability-meter-fill"),
  runCacheTest: $("#run-cache-test"),
  cacheResult: $("#cache-result"),
  cacheResultTitle: $("#cache-result-title"),
  cacheResultDetail: $("#cache-result-detail"),
  eventLog: $("#event-log"),
  footerStatus: $("#footer-status")
};

let online = true;
let latestSnapshot = null;
let uiQueued = false;
let frameCount = 0;
let testRunning = false;
const requestCounts = new Map();
const eventLines = [];

const textureLoader = createTextureLoader({
  isOnline: () => online,
  latencyScale: 0.9
});

const codeFor = (assetId) => {
  const state = streamer?.getAsset(assetId);
  return state?.meta?.spec?.code || assetId.toUpperCase();
};

function pushEvent(type, message) {
  eventLines.unshift({
    type,
    message,
    time: new Date().toLocaleTimeString("en-GB", { hour12: false })
  });
  eventLines.splice(7);
  const labels = {
    request: "REQ",
    loaded: "READY",
    applied: "SWAP",
    "cache-hit": "CACHE",
    cancelled: "CANCEL",
    failed: "FAIL",
    info: "INFO"
  };
  dom.eventLog.innerHTML = eventLines.map((line) => `
    <div class="event-line" data-type="${line.type}">
      <time>${line.time}</time>
      <b>${labels[line.type] || line.type.toUpperCase()}</b>
      <span title="${line.message}">${line.message}</span>
    </div>
  `).join("");
}

function handleStreamEvent(event) {
  const asset = streamer?.getAsset(event.assetId);
  const code = asset?.meta?.spec?.code || event.assetId?.toUpperCase() || "SYSTEM";
  if (event.type === "request") {
    const key = `${event.assetId}:${event.level}`;
    requestCounts.set(key, (requestCounts.get(key) || 0) + 1);
    pushEvent("request", `${code} L${event.level} dispatched`);
  } else if (event.type === "loaded") {
    pushEvent("loaded", `${code} L${event.level} decoded · ${formatBytes(event.bytes)}`);
  } else if (event.type === "applied") {
    if (event.previousLevel !== null && event.level > event.previousLevel) {
      pushEvent("applied", `${code} replaced L${event.previousLevel} → L${event.level}`);
    }
  } else if (event.type === "cache-hit") {
    pushEvent("cache-hit", `${code} L${event.level} restored · no fetch`);
  } else if (event.type === "cancelled") {
    pushEvent("cancelled", `${code} L${event.level} cancelled · mip held`);
  } else if (event.type === "failed") {
    pushEvent("failed", `${code} L${event.level} failed · mip held`);
  }
}

const streamer = new TextureStreamer({
  loader: textureLoader,
  concurrency: 3,
  fadeMs: 420,
  onChange: (snapshot) => {
    latestSnapshot = snapshot;
    scheduleUI();
  },
  onEvent: handleStreamEvent
});

const renderer = new SceneRenderer(dom.canvas, {
  streamer,
  specs: TEXTURE_SPECS,
  onCameraChange: () => {
    syncTargets();
    updateCameraReadout();
  }
});

function syncTargets(reason = "camera") {
  const targets = renderer.suggestedLevels();
  if (streamer.assets.size) streamer.setTargets(targets, reason);
  return targets;
}

function updateCameraReadout() {
  const { yaw, radius } = renderer.camera;
  const degrees = ((yaw * 180 / Math.PI) % 360 + 360) % 360;
  const distances = [...renderer.distances.values()];
  dom.cameraYaw.textContent = `${degrees.toFixed(0).padStart(3, "0")}°`;
  dom.cameraOrbit.textContent = `${radius.toFixed(1)}m`;
  dom.cameraNearest.textContent = distances.length ? `${Math.min(...distances).toFixed(1)}m` : "—";

  let nearest = null;
  for (const asset of renderer.assets) {
    const distance = renderer.distances.get(asset.id);
    if (distance !== undefined && (!nearest || distance < nearest.distance)) nearest = { asset, distance };
  }
  if (nearest) {
    const state = streamer.getAsset(nearest.asset.id);
    const level = state?.currentLevel;
    dom.focusLabel.innerHTML = `
      <span>${nearest.asset.spec.code} · ${nearest.distance.toFixed(1)}M</span>
      <strong>${level === null || level === undefined ? "ACQUIRING" : `RESIDENT L${level}`}</strong>
    `;
  }
}

function renderUI(snapshot) {
  const resident = snapshot.levels.reduce((total, level) => total + level.count, 0);
  dom.residentCount.textContent = String(resident).padStart(2, "0");
  dom.queueCount.textContent = String(snapshot.queue);
  dom.activeCount.textContent = String(snapshot.active);
  dom.replacementCount.textContent = String(snapshot.replacements);
  dom.cacheHitCount.textContent = String(snapshot.cacheHits);
  dom.memoryTotal.textContent = formatBytes(snapshot.bytes);

  for (const level of snapshot.levels) {
    const key = `level-l${level.level}`;
    const count = $(`#${key}-count`);
    const bytes = $(`#${key}-bytes`);
    const queue = $(`#${key}-queue`);
    const bar = $(`#${key}-bar`);
    count.textContent = `${level.count}/${streamer.assets.size}`;
    bytes.textContent = formatBytes(level.bytes);
    queue.textContent = String(level.queued);
    bar.style.width = `${level.count / Math.max(1, streamer.assets.size) * 100}%`;
  }

  const taskItems = [
    ...snapshot.activeTasks.map((task) => ({ ...task, active: true })),
    ...snapshot.queuedTasks.slice(0, 4).map((task) => ({ ...task, active: false }))
  ].slice(0, 5);
  dom.taskList.innerHTML = taskItems.length
    ? taskItems.map((task) => `
      <span class="task-chip ${task.active ? "is-active" : ""}">
        <b>${codeFor(task.assetId)}</b> L${task.level}${task.active ? " ↻" : ""}
      </span>
    `).join("")
    : '<div class="task-empty">NO PENDING REQUESTS</div>';
  dom.queueDetail.textContent = snapshot.queue || snapshot.active
    ? `${snapshot.queue} WAIT / ${snapshot.active} ACTIVE`
    : "IDLE";

  const drift = Math.max(snapshot.colorDriftMax, snapshot.swapDriftMax);
  dom.colorDrift.textContent = drift.toFixed(2);
  dom.stabilityFill.style.width = `${clamp(5 + drift * 13, 5, 100)}%`;
  dom.stabilityFill.style.background = drift < 3 ? "var(--lime)" : drift < 6 ? "var(--orange)" : "var(--red)";
  dom.colorStatus.textContent = drift < 3 ? "NORMALIZED / STABLE" : drift < 6 ? "WATCH / CHROMATIC DRIFT" : "UNSTABLE COLOR SHIFT";

  if (!online) {
    dom.streamStateLabel.textContent = "NETWORK OFFLINE";
    dom.footerStatus.textContent = "MIP FALLBACK ACTIVE · REQUESTS CANCELLED";
    dom.footerStatus.className = "statusbar-right is-warning";
  } else if (snapshot.heldFailures > 0) {
    dom.streamStateLabel.textContent = "DEGRADED / MIP HELD";
    dom.footerStatus.textContent = `${snapshot.heldFailures} MIP${snapshot.heldFailures === 1 ? "" : "S"} HELD · FALLBACK SERVING`;
    dom.footerStatus.className = "statusbar-right is-warning";
  } else if (snapshot.idle) {
    dom.streamStateLabel.textContent = "RESIDENT / IDLE";
    dom.footerStatus.textContent = "ALL SYSTEMS NOMINAL";
    dom.footerStatus.className = "statusbar-right";
  } else {
    dom.streamStateLabel.textContent = "STREAMING / PRIORITY QUEUE";
    dom.footerStatus.textContent = "BASE-FIRST PIPELINE ACTIVE";
    dom.footerStatus.className = "statusbar-right";
  }
}

function scheduleUI() {
  if (uiQueued || !latestSnapshot) return;
  uiQueued = true;
  requestAnimationFrame(() => {
    uiQueued = false;
    renderUI(latestSnapshot);
  });
}

function setOnline(nextOnline) {
  online = nextOnline;
  dom.networkToggle.classList.toggle("is-online", online);
  dom.networkToggle.classList.toggle("is-offline", !online);
  dom.networkToggle.setAttribute("aria-pressed", String(online));
  dom.networkLabel.textContent = online ? "NETWORK ONLINE" : "NETWORK OFFLINE";
  if (!online) {
    const cancelled = streamer.abortInFlight("network-offline");
    pushEvent("cancelled", `NETWORK OFFLINE · ${cancelled} request${cancelled === 1 ? "" : "s"} cancelled`);
  } else {
    const retried = streamer.retryFailures();
    pushEvent("info", `NETWORK RESTORED · ${retried} failed mip${retried === 1 ? "" : "s"} retried`);
  }
  scheduleUI();
  syncTargets(online ? "network-online" : "network-offline");
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function animateYaw(targetYaw, duration) {
  return new Promise((resolve) => {
    const startYaw = renderer.camera.yaw;
    const start = performance.now();
    const step = (now) => {
      const progress = clamp((now - start) / duration, 0, 1);
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - (-2 * progress + 2) ** 2 / 2;
      renderer.setCamera({ yaw: startYaw + (targetYaw - startYaw) * eased });
      if (progress < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

function setCacheResult(status, title, detail) {
  dom.cacheResult.dataset.status = status;
  dom.cacheResultTitle.textContent = title;
  dom.cacheResultDetail.textContent = detail;
}

async function runCacheTest() {
  if (testRunning) return null;
  if (!online) {
    setCacheResult("fail", "NETWORK OFFLINE", "Reconnect before validating cache reuse.");
    return { pass: false, reason: "offline" };
  }

  testRunning = true;
  dom.runCacheTest.disabled = true;
  dom.runCacheTest.querySelector("span").textContent = "RUNNING ROUND-TRIP…";
  setCacheResult("running", "TURNING 180°", "Warming cache and recording resident mip keys.");
  pushEvent("info", "CACHE TEST · waiting for resident view");

  try {
    const warmed = await streamer.waitForIdle(5500);
    const before = streamer.getSnapshot();
    const originalTargets = renderer.suggestedLevels();
    const missing = Object.entries(originalTargets).filter(([id, level]) => {
      const asset = streamer.getAsset(id);
      return !asset?.levels.has(level);
    });
    if (!warmed || missing.length) {
      setCacheResult("fail", "CACHE NOT WARM", `${missing.length} target mip${missing.length === 1 ? "" : "s"} still unavailable.`);
      return { pass: false, reason: "not-warm", missing: missing.map(([id]) => id) };
    }

    const originalYaw = renderer.camera.yaw;
    const baselineHits = before.cacheHits;
    const baselineRequests = new Map();
    const keys = Object.entries(originalTargets).map(([id, level]) => `${id}:${level}`);
    for (const key of keys) baselineRequests.set(key, requestCounts.get(key) || 0);

    const startedAt = performance.now();
    setCacheResult("running", "RAPID TURN / CANCEL WINDOW", "High-detail requests are now stale; resident mips are pinned.");
    await animateYaw(originalYaw + Math.PI, 260);
    await sleep(150);
    setCacheResult("running", "SNAP BACK / CACHE LOOKUP", "Returning to the original camera with zero refetches expected.");
    await animateYaw(originalYaw, 260);
    await sleep(620);

    const after = streamer.getSnapshot();
    const restored = Object.entries(originalTargets).filter(([id, level]) => {
      const asset = after.assets.find((item) => item.id === id);
      return asset?.currentLevel === level && asset.residentLevels.includes(level);
    });
    const refetched = keys.filter((key) => (requestCounts.get(key) || 0) > (baselineRequests.get(key) || 0));
    const cacheDelta = after.cacheHits - baselineHits;
    const duration = performance.now() - startedAt;
    const pass = restored.length === keys.length && refetched.length === 0 && cacheDelta > 0;

    if (pass) {
      setCacheResult(
        "pass",
        "PASS · ZERO REFETCH",
        `${restored.length}/${keys.length} target mips restored · ${cacheDelta} cache hits · ${formatTime(duration)}`
      );
      pushEvent("cache-hit", `CACHE TEST PASS · ${keys.length}/${keys.length} restored, 0 refetched`);
    } else {
      setCacheResult(
        "fail",
        "CACHE TEST FAILED",
        `${restored.length}/${keys.length} restored · ${cacheDelta} hits · ${refetched.length} refetches`
      );
      pushEvent("failed", `CACHE TEST FAIL · ${refetched.length} refetched keys`);
    }
    return {
      pass,
      restored: restored.length,
      total: keys.length,
      cacheHits: cacheDelta,
      refetched,
      duration
    };
  } finally {
    testRunning = false;
    dom.runCacheTest.disabled = false;
    dom.runCacheTest.querySelector("span").textContent = "RUN CACHE TEST";
    scheduleUI();
  }
}

dom.networkToggle.addEventListener("click", () => setOnline(!online));
dom.resetView.addEventListener("click", () => {
  renderer.resetCamera();
  syncTargets("reset");
  updateCameraReadout();
});
dom.runCacheTest.addEventListener("click", runCacheTest);

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLButtonElement) return;
  const step = event.shiftKey ? 0.18 : 0.07;
  if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") {
    renderer.setCamera({ yaw: renderer.camera.yaw - step });
  } else if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") {
    renderer.setCamera({ yaw: renderer.camera.yaw + step });
  } else if (event.key === "+" || event.key === "=") {
    renderer.setCamera({ radius: clamp(renderer.camera.radius - 0.35, 6.15, 11.4) });
  } else if (event.key === "-" || event.key === "_") {
    renderer.setCamera({ radius: clamp(renderer.camera.radius + 0.35, 6.15, 11.4) });
  }
});

const bootTargets = renderer.suggestedLevels();
for (const spec of TEXTURE_SPECS) {
  streamer.addAsset({
    id: spec.id,
    name: spec.name,
    targetLevel: bootTargets[spec.id],
    referenceAverage: spec.targetAverage,
    meta: { spec, seed: spec.seed }
  });
}

pushEvent("info", "PIPELINE ARMED · BASE-FIRST QUEUE");
streamer.kick("boot");
updateCameraReadout();
scheduleUI();

let lastTargetSync = 0;
let lastReadout = 0;
function frame(now) {
  renderer.render(now);
  frameCount += 1;
  dom.frameCounter.textContent = String(frameCount).padStart(6, "0");
  if (!testRunning && now - lastTargetSync > 90) {
    syncTargets();
    lastTargetSync = now;
  }
  if (now - lastReadout > 180) {
    updateCameraReadout();
    lastReadout = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__MIPSTREAM__ = {
  streamer,
  renderer,
  runCacheTest,
  setOnline,
  setYaw(yaw) {
    renderer.setCamera({ yaw });
    syncTargets("debug");
    updateCameraReadout();
  },
  waitForIdle: (timeout = 10000) => streamer.waitForIdle(timeout),
  snapshot: () => streamer.getSnapshot(),
  requestCounts: () => Object.fromEntries(requestCounts)
};
