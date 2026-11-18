/* 界面绑定、实时渲染、批量测试与 CSV 导出。 */
(function () {
  const M = window.DepthMath;
  const canvas = document.getElementById("glcanvas");
  const errorBox = document.getElementById("webgl-error");

  const PRESETS = {
    mild: { near: 0.1, far: 100 },
    wide: { near: 0.1, far: 1000 },
    extreme: { near: 0.01, far: 10000 },
  };
  const MODES = [
    { id: "depth24", label: "depth24", reverse: false },
    { id: "depth32f", label: "depth32", reverse: false },
    { id: "reverse", label: "reverse-z", reverse: true },
  ];

  let renderer = null;
  let batchRows = [];
  let frameToken = 0;

  const $ = (id) => document.getElementById(id);
  const controls = {
    depthMode: $("depthMode"),
    rangePreset: $("rangePreset"),
    near: $("nearInput"),
    far: $("farInput"),
    gap: $("gapInput"),
    jitter: $("jitterInput"),
    animate: $("animateJitter"),
    stripes: $("showStripes"),
  };

  function readConfig() {
    const near = Math.pow(10, parseFloat(controls.near.value));
    const far = Math.pow(10, parseFloat(controls.far.value));
    const gap = Math.pow(10, parseFloat(controls.gap.value));
    const depthMode = controls.depthMode.value;
    const reverse = depthMode === "reverse";
    const wallZ = far * 0.9;
    const worldStep = M.worldStep(wallZ, near, far, depthMode, reverse);
      // 抖动幅度 = 滑块系数 × 该配置远端一个量化步长，保证恰好能触发桶边界翻转
    const jitterFactor = Math.pow(10, parseFloat(controls.jitter.value));
      const jitter = Math.max(worldStep * jitterFactor, 1e-12);
    return {
      depthMode,
      reverse,
      near,
      far,
      gap,
      jitter,
      fovy: Math.PI / 4,
      wallZ,
      sheetZ: near * 5,
      // 贴片位于墙前 gap 处（眼空间深度 wallZ - gap），避免被远平面裁剪
      // 贴片倾斜：左右边缘深度差取 8 个量化步长，标准 Z 条纹宽、反向 Z 几乎无痕
      slope: Math.max(worldStep * 8 / 2.3, 1e-12),
      // 条纹频率：让整个贴片表面大致覆盖 24 个量化桶
      stripeScale: 24 / Math.max(worldStep * 8, 1e-12),
      showStripes: controls.stripes.checked,
    };
  }

  function syncLabels(cfg) {
    $("nearLabel").textContent = M.formatSci(cfg.near, 2);
    $("farLabel").textContent = M.formatSci(cfg.far, 2);
    $("gapLabel").textContent = M.formatSci(cfg.gap);
    $("jitterLabel").textContent =
      Math.pow(10, parseFloat(controls.jitter.value)).toFixed(2) +
      `（实际 ${M.formatSci(cfg.jitter)}）`;
  }

  function analyticStats(cfg) {
    const delta = M.depthDeltaAt(
      cfg.wallZ, cfg.gap, cfg.near, cfg.far, cfg.depthMode, cfg.reverse
    );
    const step = M.worldStep(
      cfg.wallZ, cfg.near, cfg.far, cfg.depthMode, cfg.reverse
    );
    return { delta, step };
  }

  function renderLive() {
    const cfg = readConfig();
    syncLabels(cfg);
    const counters = renderer.render(cfg);
    const { delta, step } = analyticStats(cfg);
    const stats = [
      ["裁剪面比例 f/n", M.formatSci(cfg.far / cfg.near, 2)],
      ["墙面距离 d", M.formatSci(cfg.wallZ)],
      ["理想存储深度差 Δs", M.formatSci(delta.idealDelta)],
      ["量化后深度差", M.formatSci(delta.quantizedDelta)],
      ["该深度处 LSB", M.formatSci(delta.lsb)],
      ["Δs / LSB", delta.lsbCount.toFixed(2)],
      ["世界空间最小可分辨距离", M.formatSci(step)],
      ["Z-fighting 像素", String(counters.zFightPixels)],
      ["接触闪烁像素", String(counters.flickerPixels)],
    ];
    $("liveStats").innerHTML = stats
      .map(([k, v]) => {
        const bad = (k.startsWith("Z-fighting") || k.startsWith("接触闪烁")) &&
          parseFloat(v) > 0;
        const good = (k.startsWith("Z-fighting") || k.startsWith("接触闪烁")) &&
          parseFloat(v) === 0;
        return `<dt>${k}</dt><dd class="${bad ? "bad" : good ? "good" : ""}">${v}</dd>`;
      })
      .join("");
    return { cfg, counters, delta, step };
  }

  function scheduleRender() {
    const token = ++frameToken;
    requestAnimationFrame(() => {
      if (token !== frameToken) return;
      renderLive();
    });
  }

  function renderTable() {
    const tbody = $("batchTable").querySelector("tbody");
    tbody.innerHTML = batchRows.map((row) => {
      const cls = row.zFightPixels > 0 ? "row-bad" : "row-good";
      return `<tr class="${cls}">
        <td>${row.modeLabel}</td>
        <td>1:${M.formatSci(row.ratio, 0)}</td>
        <td>${M.formatSci(row.idealDelta)}</td>
        <td>${M.formatSci(row.lsb)}</td>
        <td>${row.lsbCount.toFixed(2)}</td>
        <td>${row.zFightPixels}</td>
        <td>${row.flickerPixels}</td>
      </tr>`;
    }).join("");
  }

  function runBatch() {
    const currentMode = controls.depthMode.value;
    const currentPreset = controls.rangePreset.value;
    const rows = [];
    MODES.forEach((mode) => {
      Object.entries(PRESETS).forEach(([presetName, range]) => {
        controls.depthMode.value = mode.id;
        const cfg = readConfig();
        cfg.near = range.near;
        cfg.far = range.far;
        cfg.wallZ = range.far * 0.9;
        cfg.sheetZ = range.near * 5;
        const step = M.worldStep(cfg.wallZ, cfg.near, cfg.far, cfg.depthMode, cfg.reverse);
        const jitterFactor = Math.pow(10, parseFloat(controls.jitter.value));
        cfg.jitter = Math.max(step * jitterFactor, 1e-12);
        cfg.slope = Math.max(step * 8 / 2.3, 1e-12);
        cfg.stripeScale = 24 / Math.max(step * 8, 1e-12);
        const counters = renderer.render(cfg);
        const delta = M.depthDeltaAt(
          cfg.wallZ, cfg.gap, cfg.near, cfg.far, cfg.depthMode, cfg.reverse
        );
        rows.push({
          modeLabel: mode.label,
          preset: presetName,
          ratio: cfg.far / cfg.near,
          idealDelta: delta.idealDelta,
          quantizedDelta: delta.quantizedDelta,
          lsb: delta.lsb,
          lsbCount: delta.lsbCount,
          worldStep: step,
          zFightPixels: counters.zFightPixels,
          flickerPixels: counters.flickerPixels,
        });
      });
    });
    controls.depthMode.value = currentMode;
    controls.rangePreset.value = currentPreset;
    batchRows = rows;
    renderTable();
    scheduleRender();
  }

  function exportCsv() {
    if (batchRows.length === 0) runBatch();
    const header = [
      "mode", "preset", "near", "far", "ratio", "gap",
      "ideal_stored_delta", "quantized_delta", "lsb", "lsb_count",
      "world_step", "zfight_pixels", "flicker_pixels",
    ];
    const lines = batchRows.map((r) => [
      r.modeLabel, r.preset,
      PRESETS[r.preset].near, PRESETS[r.preset].far, r.ratio,
      Math.pow(10, parseFloat(controls.gap.value)),
      r.idealDelta, r.quantizedDelta, r.lsb, r.lsbCount,
      r.worldStep, r.zFightPixels, r.flickerPixels,
    ].join(","));
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "depth-precision-results.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function applyPreset() {
    const preset = PRESETS[controls.rangePreset.value];
    controls.near.value = Math.log10(preset.near);
    controls.far.value = Math.log10(preset.far);
    scheduleRender();
  }

  function init() {
    let backend = "GPU";
    try {
      renderer = new window.DepthRenderer(canvas);
      window.__renderer = renderer;
      const gl = renderer.gl;
      // 用临时 RGBA8 FBO 探测离屏渲染能力（部分容器内 SwiftShader 此步失败）
      const probeTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, probeTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 32, 32, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const probeFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, probeFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D, probeTex, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      // 某些驱动（如容器内 SwiftShader）clear 有效但 drawArrays 光栅化无效，
      // 因此用真实着色器绘制一个三角形并读回，而非仅检查 FBO 状态或 clear。
      let rasterWorks = false;
      if (status === gl.FRAMEBUFFER_COMPLETE) {
        const probeVs = "#version 300 es\nlayout(location=0) in vec2 p;" +
          "void main(){gl_Position=vec4(p,0,1);}";
        const probeFs = "#version 300 es\nprecision highp float;out vec4 c;" +
          "void main(){c=vec4(1,0,0,1);}";
        const compile = (type, src) => {
          const shader = gl.createShader(type);
          gl.shaderSource(shader, src);
          gl.compileShader(shader);
          return shader;
        };
        const probeProgram = gl.createProgram();
        gl.attachShader(probeProgram, compile(gl.VERTEX_SHADER, probeVs));
        gl.attachShader(probeProgram, compile(gl.FRAGMENT_SHADER, probeFs));
        gl.linkProgram(probeProgram);
        const probeVao = gl.createVertexArray();
        gl.bindVertexArray(probeVao);
        const probeVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, probeVbo);
        gl.bufferData(gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.viewport(0, 0, 32, 32);
        gl.disable(gl.DEPTH_TEST);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(probeProgram);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.finish();
        const sample = new Uint8Array(4);
        gl.readPixels(16, 16, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sample);
        rasterWorks = sample[0] > 200 && sample[1] < 50;
        gl.deleteProgram(probeProgram);
        gl.deleteVertexArray(probeVao);
        gl.deleteBuffer(probeVbo);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(probeFbo);
      gl.deleteTexture(probeTex);
      if (status !== gl.FRAMEBUFFER_COMPLETE || !rasterWorks) {
        throw new Error(`离屏渲染不可用(status=0x${status.toString(16)},raster=${rasterWorks})`);
      }
    } catch (err) {
      try {
        renderer = new window.CpuDepthView(canvas);
        backend = renderer.backendName;
        errorBox.classList.remove("hidden");
        errorBox.style.color = "var(--warn)";
        errorBox.textContent =
          `GPU 离屏渲染不可用（${err.message}），已切换 CPU 模拟后端，数值与真实深度量化规则一致。`;
      } catch (cpuErr) {
        errorBox.classList.remove("hidden");
        errorBox.textContent = `渲染初始化失败：${cpuErr.message}`;
        return;
      }
    }
    window.__renderer = renderer;
    window.__backend = backend;
    ["depthMode", "nearInput", "farInput", "gapInput", "jitterInput",
      "showStripes"].forEach((name) => {
      const el = controls[name] || $(name);
      el.addEventListener("input", scheduleRender);
      el.addEventListener("change", scheduleRender);
    });
    controls.rangePreset.addEventListener("change", applyPreset);
    controls.animate.addEventListener("change", () => {});
    $("stepBtn").addEventListener("click", renderLive);
    $("batchBtn").addEventListener("click", runBatch);
    $("exportBtn").addEventListener("click", exportCsv);

    applyPreset();
    renderLive();

    function loop() {
      if (controls.animate.checked) renderLive();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  init();
})();
