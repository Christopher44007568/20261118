const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function roundRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawCover(context, image, x, y, width, height) {
  const sourceWidth = image.width * Math.min(1, width / height);
  const sourceX = (image.width - sourceWidth) / 2;
  context.drawImage(image, sourceX, 0, sourceWidth, image.height, x, y, width, height);
}

export class SceneRenderer {
  constructor(canvas, { streamer, specs, onCameraChange = null }) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: true });
    this.streamer = streamer;
    this.specs = specs;
    this.onCameraChange = onCameraChange;
    this.camera = { yaw: 0.44, pitch: 0.07, radius: 8.5 };
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.dragging = false;
    this.pointer = { x: 0, y: 0 };
    this.distances = new Map();
    this.visible = [];
    this.stars = Array.from({ length: 150 }, (_, index) => {
      const a = Math.sin(index * 91.73 + 3.17) * 43758.5453;
      const b = Math.sin(index * 57.21 + 8.41) * 24634.6345;
      return {
        x: a - Math.floor(a),
        y: b - Math.floor(b),
        size: 0.4 + ((index * 7) % 10) / 9,
        phase: (index * 0.91) % TAU
      };
    });
    this.assets = specs.map((spec, index) => {
      const angle = (index / specs.length) * TAU + 0.18;
      const radius = 3.72 + (index % 3) * 0.27;
      return {
        id: spec.id,
        spec,
        angle,
        radius,
        y: -0.12 + Math.sin(index * 1.83) * 0.72,
        worldWidth: 1.3 + (index % 3) * 0.08,
        worldHeight: 1.72
      };
    });
    this._bindControls();
    this.resize();
    this._observer = new ResizeObserver(() => this.resize());
    this._observer.observe(canvas);
  }

  _bindControls() {
    this.canvas.addEventListener("pointerdown", (event) => {
      this.dragging = true;
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
      this.canvas.setPointerCapture(event.pointerId);
      this.canvas.classList.add("is-dragging");
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging) return;
      const dx = event.clientX - this.pointer.x;
      const dy = event.clientY - this.pointer.y;
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
      this.setCamera({
        yaw: this.camera.yaw - dx * 0.0062,
        pitch: clamp(this.camera.pitch + dy * 0.0022, -0.18, 0.28)
      });
    });
    const endDrag = (event) => {
      this.dragging = false;
      this.canvas.classList.remove("is-dragging");
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    };
    this.canvas.addEventListener("pointerup", endDrag);
    this.canvas.addEventListener("pointercancel", endDrag);
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.setCamera({ radius: clamp(this.camera.radius + event.deltaY * 0.0032, 6.15, 11.4) });
    }, { passive: false });
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setCamera(next, notify = true) {
    Object.assign(this.camera, next);
    if (notify) this.onCameraChange?.(this.camera);
  }

  resetCamera() {
    this.setCamera({ yaw: 0.44, pitch: 0.07, radius: 8.5 });
  }

  _cameraBasis() {
    const { yaw, pitch, radius } = this.camera;
    const position = {
      x: Math.sin(yaw) * radius,
      y: 2.0 + pitch * radius * 0.6,
      z: Math.cos(yaw) * radius
    };
    const target = { x: 0, y: 0.2, z: 0 };
    let fx = target.x - position.x;
    let fy = target.y - position.y;
    let fz = target.z - position.z;
    const forwardLength = Math.hypot(fx, fy, fz);
    fx /= forwardLength;
    fy /= forwardLength;
    fz /= forwardLength;

    let rx = -fz;
    let rz = fx;
    const rightLength = Math.hypot(rx, rz) || 1;
    rx /= rightLength;
    rz /= rightLength;

    const ux = -rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy;
    return {
      position,
      forward: { x: fx, y: fy, z: fz },
      right: { x: rx, y: 0, z: rz },
      up: { x: ux, y: uy, z: uz }
    };
  }

  project(point, basis = this._cameraBasis()) {
    const vx = point.x - basis.position.x;
    const vy = point.y - basis.position.y;
    const vz = point.z - basis.position.z;
    const depth = vx * basis.forward.x + vy * basis.forward.y + vz * basis.forward.z;
    if (depth <= 0.12) return null;
    const horizontal = vx * basis.right.x + vz * basis.right.z;
    const vertical = vx * basis.up.x + vy * basis.up.y + vz * basis.up.z;
    const focal = Math.min(this.width, this.height) * 1.06;
    return {
      x: this.width * 0.5 + horizontal * focal / depth,
      y: this.height * 0.51 - vertical * focal / depth,
      depth,
      scale: focal / depth
    };
  }

  updateDistances() {
    const basis = this._cameraBasis();
    const distances = new Map();
    for (const asset of this.assets) {
      const x = Math.sin(asset.angle) * asset.radius;
      const z = Math.cos(asset.angle) * asset.radius;
      distances.set(asset.id, Math.hypot(
        x - basis.position.x,
        asset.y - basis.position.y,
        z - basis.position.z
      ));
    }
    this.distances = distances;
    return distances;
  }

  suggestedLevels() {
    const distances = this.updateDistances();
    return Object.fromEntries(this.assets.map((asset) => {
      const distance = distances.get(asset.id);
      const level = distance < 6.0 ? 3 : distance < 8.0 ? 2 : distance < 10.15 ? 1 : 0;
      return [asset.id, level];
    }));
  }

  render(now = performance.now()) {
    const context = this.context;
    const basis = this._cameraBasis();
    context.clearRect(0, 0, this.width, this.height);
    this._drawAtmosphere(context, basis, now);
    this._drawFloor(context, basis);

    const projected = [];
    for (const asset of this.assets) {
      const point = {
        x: Math.sin(asset.angle) * asset.radius,
        y: asset.y,
        z: Math.cos(asset.angle) * asset.radius
      };
      const screen = this.project(point, basis);
      if (!screen) continue;
      const distance = Math.hypot(
        point.x - basis.position.x,
        point.y - basis.position.y,
        point.z - basis.position.z
      );
      projected.push({ asset, screen, distance });
    }
    projected.sort((a, b) => b.screen.depth - a.screen.depth);
    this.visible = projected;
    for (const item of projected) this._drawAsset(context, item, now);
    this._drawReticle(context);
  }

  _drawAtmosphere(context, basis, now) {
    const cx = this.width * 0.5;
    const cy = this.height * 0.5;
    const glow = context.createRadialGradient(cx, cy, 0, cx, cy, Math.max(this.width, this.height) * 0.52);
    glow.addColorStop(0, "rgba(31, 72, 104, 0.2)");
    glow.addColorStop(0.42, "rgba(12, 25, 45, 0.08)");
    glow.addColorStop(1, "rgba(3, 6, 12, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, this.width, this.height);

    for (const star of this.stars) {
      const x = ((star.x - this.camera.yaw / TAU * 0.15) % 1 + 1) % 1 * this.width;
      const y = star.y * this.height * 0.82;
      const flicker = 0.35 + 0.35 * Math.sin(now * 0.0012 + star.phase);
      context.fillStyle = `rgba(182, 223, 255, ${flicker * 0.55})`;
      context.fillRect(x, y, star.size, star.size);
    }
  }

  _drawFloor(context, basis) {
    context.save();
    context.lineWidth = 1;
    for (let ring = 1; ring <= 5; ring += 1) {
      const radius = ring * 1.28;
      context.beginPath();
      let started = false;
      for (let step = 0; step <= 96; step += 1) {
        const angle = step / 96 * TAU;
        const projected = this.project({
          x: Math.sin(angle) * radius,
          y: -1.08,
          z: Math.cos(angle) * radius
        }, basis);
        if (!projected) {
          started = false;
          continue;
        }
        if (!started) {
          context.moveTo(projected.x, projected.y);
          started = true;
        } else {
          context.lineTo(projected.x, projected.y);
        }
      }
      context.strokeStyle = `rgba(102, 215, 228, ${0.075 - ring * 0.009})`;
      context.stroke();
    }
    const center = this.project({ x: 0, y: -1.08, z: 0 }, basis);
    if (center) {
      context.fillStyle = "rgba(89, 237, 255, 0.12)";
      context.beginPath();
      context.ellipse(center.x, center.y, this.width * 0.22, this.height * 0.055, 0, 0, TAU);
      context.fill();
    }
    context.restore();
  }

  _drawAsset(context, { asset, screen, distance }, now) {
    const state = this.streamer.getAsset(asset.id);
    const current = state?.current || null;
    const accent = asset.spec.accent;
    const width = asset.worldWidth * screen.scale;
    const height = asset.worldHeight * screen.scale;
    if (width < 18 || screen.x + width / 2 < -40 || screen.x - width / 2 > this.width + 40) return;
    const bob = Math.sin(now * 0.0007 + asset.angle * 3) * 2.2;
    const x = screen.x - width / 2;
    const y = screen.y - height / 2 + bob;
    const radius = clamp(width * 0.025, 3, 12);
    const level = state?.currentLevel ?? -1;
    const levelColors = ["#86a0ad", "#67ddff", "#b8ff72", "#ff78c5"];
    const levelColor = level >= 0 ? levelColors[level] : "#65717e";
    const queued = this.streamer.queue.some((task) => task.assetId === asset.id);
    const active = [...this.streamer.inFlight.values()].find((task) => task.assetId === asset.id);
    const failed = state?.failed.size > 0;
    const complete = level >= 0 && level === state.targetLevel;
    const status = active ? `FETCH L${active.level}` : queued ? "QUEUED" : failed ? "MIP HELD" : complete ? "RESIDENT" : "BASE MIP";

    context.save();
    context.shadowColor = `rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, ${0.15 + (level + 1) * 0.035})`;
    context.shadowBlur = clamp(width * 0.16, 4, 42);
    context.fillStyle = "rgba(6, 10, 19, 0.9)";
    roundRect(context, x, y, width, height, radius);
    context.fill();
    context.restore();

    context.save();
    roundRect(context, x, y, width, height, radius);
    context.clip();
    if (state?.previous) drawCover(context, state.previous.canvas, x, y, width, height);
    if (current) {
      const blend = state.previous
        ? clamp((now - state.swapAt) / this.streamer.fadeMs, 0, 1)
        : 1;
      const eased = blend * blend * (3 - 2 * blend);
      context.globalAlpha = eased;
      drawCover(context, current.canvas, x, y, width, height);
      context.globalAlpha = 1;
    } else {
      const placeholder = context.createLinearGradient(x, y, x + width, y + height);
      placeholder.addColorStop(0, "rgba(22, 37, 58, 0.96)");
      placeholder.addColorStop(0.55, "rgba(8, 17, 30, 0.98)");
      placeholder.addColorStop(1, "rgba(32, 49, 66, 0.96)");
      context.fillStyle = placeholder;
      context.fillRect(x, y, width, height);
      const sweepX = x + ((now * 0.06) % (width + 120)) - 60;
      const sweep = context.createLinearGradient(sweepX - 40, 0, sweepX + 40, 0);
      sweep.addColorStop(0, "rgba(91, 229, 255, 0)");
      sweep.addColorStop(0.5, "rgba(91, 229, 255, 0.12)");
      sweep.addColorStop(1, "rgba(91, 229, 255, 0)");
      context.fillStyle = sweep;
      context.fillRect(x, y, width, height);
    }

    const shade = context.createLinearGradient(0, y + height * 0.35, 0, y + height);
    shade.addColorStop(0, "rgba(3, 7, 13, 0)");
    shade.addColorStop(0.72, "rgba(3, 7, 13, 0.4)");
    shade.addColorStop(1, "rgba(3, 7, 13, 0.9)");
    context.fillStyle = shade;
    context.fillRect(x, y, width, height);

    context.strokeStyle = "rgba(188, 235, 255, 0.045)";
    context.lineWidth = 1;
    const scanGap = clamp(height / 38, 2, 5);
    for (let sy = y; sy < y + height; sy += scanGap) {
      context.beginPath();
      context.moveTo(x, sy);
      context.lineTo(x + width, sy);
      context.stroke();
    }
    context.restore();

    context.save();
    roundRect(context, x + 0.5, y + 0.5, width - 1, height - 1, radius);
    context.strokeStyle = `rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, ${0.22 + level * 0.07})`;
    context.lineWidth = 1;
    context.stroke();

    const corner = clamp(width * 0.08, 6, 17);
    context.strokeStyle = `rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, 0.8)`;
    context.lineWidth = clamp(width * 0.004, 1, 2);
    const corners = [
      [x, y, 1, 1],
      [x + width, y, -1, 1],
      [x, y + height, 1, -1],
      [x + width, y + height, -1, -1]
    ];
    for (const [px, py, sx, sy] of corners) {
      context.beginPath();
      context.moveTo(px + sx * corner, py);
      context.lineTo(px, py);
      context.lineTo(px, py + sy * corner);
      context.stroke();
    }

    const padding = clamp(width * 0.055, 4, 15);
    const fontSize = clamp(width * 0.043, 6.5, 11);
    const labelSize = clamp(width * 0.054, 8, 14);
    context.textBaseline = "top";
    context.font = `600 ${fontSize}px "IBM Plex Mono", "SFMono-Regular", Consolas, monospace`;
    context.fillStyle = "rgba(214, 241, 250, 0.72)";
    context.fillText(asset.spec.code, x + padding, y + padding);
    context.textAlign = "right";
    context.fillStyle = levelColor;
    context.fillText(level >= 0 ? `L${level}` : "L-", x + width - padding, y + padding);
    context.textAlign = "left";

    context.textBaseline = "bottom";
    context.font = `700 ${labelSize}px "Space Grotesk", "Avenir Next", sans-serif`;
    context.fillStyle = "rgba(240, 248, 252, 0.94)";
    context.fillText(asset.spec.name, x + padding, y + height - padding * 1.85);
    context.font = `500 ${Math.max(6, fontSize * 0.86)}px "IBM Plex Mono", "SFMono-Regular", Consolas, monospace`;
    context.fillStyle = "rgba(174, 207, 222, 0.68)";
    context.fillText(`${distance.toFixed(1)}m  /  ${status}`, x + padding, y + height - padding * 0.65);
    context.restore();
  }

  _drawReticle(context) {
    const cx = this.width * 0.5;
    const cy = this.height * 0.51;
    context.save();
    context.strokeStyle = "rgba(137, 231, 247, 0.22)";
    context.lineWidth = 1;
    context.beginPath();
    context.arc(cx, cy, 18, 0, TAU);
    context.stroke();
    context.beginPath();
    context.moveTo(cx - 31, cy);
    context.lineTo(cx - 11, cy);
    context.moveTo(cx + 11, cy);
    context.lineTo(cx + 31, cy);
    context.moveTo(cx, cy - 31);
    context.lineTo(cx, cy - 11);
    context.moveTo(cx, cy + 11);
    context.lineTo(cx, cy + 31);
    context.stroke();
    context.fillStyle = "rgba(153, 236, 250, 0.75)";
    context.fillRect(cx - 1, cy - 1, 2, 2);
    context.restore();
  }

  dispose() {
    this._observer?.disconnect();
  }
}
