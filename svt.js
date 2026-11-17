// Sparse Virtual Texture core: page table, physical page pool, async streaming.
// Environment-agnostic (no DOM). Tile pixel data is provided by an injected
// tileFactory(tex, tx, ty) -> opaque payload stored in the physical slot.

export const TILE_SIZE = 128;          // pixels per tile edge
export const TILES_PER_AXIS = 32;      // virtual texture is 32x32 tiles (4096px)
export const NUM_TEXTURES = 2;         // two large texture pages
export const POOL_SLOTS = 160;         // physical page pool size
export const PREFETCH_RING = 1;        // extra ring of tiles around viewport

export const TILE_MISSING = -1;        // page table entry: not resident
export const TILE_PENDING = -2;        // page table entry: upload in flight

// Deterministic fallback color (mip-tail style average) for a virtual tile.
// Used when the tile is not resident so we never show a stale neighbor page.
export function fallbackColor(tex, tx, ty) {
  const h = (tex * 97 + tx * 37 + ty * 17) % 360;
  const l = 22 + ((tx * 13 + ty * 29 + tex * 7) % 20);
  return `hsl(${h}, 45%, ${l}%)`;
}

export class SVTSystem {
  constructor({ tileFactory, poolSlots = POOL_SLOTS, uploadTicks = 3 } = {}) {
    if (!tileFactory) throw new Error('tileFactory required');
    this.tileFactory = tileFactory;
    this.uploadTicks = uploadTicks; // simulated async latency per tile upload

    // Page tables: one per virtual texture, entry = slot | MISSING | PENDING
    this.pageTable = [];
    for (let t = 0; t < NUM_TEXTURES; t++) {
      const table = new Int16Array(TILES_PER_AXIS * TILES_PER_AXIS);
      table.fill(TILE_MISSING);
      this.pageTable.push(table);
    }

    // Physical page pool (fixed size, LRU eviction)
    this.slots = new Array(poolSlots);
    for (let i = 0; i < poolSlots; i++) {
      this.slots[i] = { tex: -1, tx: -1, ty: -1, data: null, lastUsed: 0, free: true };
    }

    this.queue = [];           // pending upload requests {tex, tx, ty}
    this.inFlight = new Map(); // key -> {tex,tx,ty,slot,progress}
    this.needed = new Set();   // keys required by current frame (eviction-protected)
    this.frame = 0;

    this.stats = { uploads: 0, evictions: 0, hits: 0, misses: 0 };
  }

  static key(tex, tx, ty) { return (tex << 16) | (ty << 8) | tx; }

  entry(tex, tx, ty) { return this.pageTable[tex][ty * TILES_PER_AXIS + tx]; }

  // Mark the visible tile set for this frame; enqueue anything not resident.
  requestVisible(visible) {
    this.frame++;
    this.needed.clear();
    for (const { tex, tx, ty } of visible) {
      if (tex < 0 || tex >= NUM_TEXTURES) continue;
      if (tx < 0 || ty < 0 || tx >= TILES_PER_AXIS || ty >= TILES_PER_AXIS) continue;
      const key = SVTSystem.key(tex, tx, ty);
      this.needed.add(key);
      const e = this.entry(tex, tx, ty);
      if (e >= 0) {
        this.slots[e].lastUsed = this.frame;
        this.stats.hits++;
      } else {
        this.stats.misses++;
        if (e === TILE_MISSING && !this.inFlight.has(key) &&
            !this.queue.some(q => SVTSystem.key(q.tex, q.tx, q.ty) === key)) {
          this.queue.push({ tex, tx, ty });
        }
      }
    }
  }

  // Advance the async streamer. budget = max uploads started this tick.
  update(budget = 8) {
    // Drop queued requests the camera has already moved away from.
    if (this.queue.length > 0) {
      this.queue = this.queue.filter(q =>
        this.needed.has(SVTSystem.key(q.tex, q.tx, q.ty)));
    }
    while (budget > 0 && this.queue.length > 0) {
      const { tex, tx, ty } = this.queue.shift();
      const key = SVTSystem.key(tex, tx, ty);
      if (this.entry(tex, tx, ty) !== TILE_MISSING) continue;
      const slot = this.allocateSlot();
      if (slot < 0) break; // pool exhausted by protected tiles; retry next tick
      // Reserve the slot immediately under the new owner's identity so no
      // other request can grab it and the LRU pass protects it via inFlight.
      const rs = this.slots[slot];
      rs.tex = tex; rs.tx = tx; rs.ty = ty;
      rs.data = null; rs.free = false; rs.lastUsed = this.frame;
      this.pageTable[tex][ty * TILES_PER_AXIS + tx] = TILE_PENDING;
      this.inFlight.set(key, { tex, tx, ty, slot, progress: 0 });
      budget--;
    }
    for (const [key, job] of this.inFlight) {
      job.progress++;
      if (job.progress >= this.uploadTicks) {
        const s = this.slots[job.slot];
        s.data = this.tileFactory(job.tex, job.tx, job.ty);
        s.lastUsed = this.frame;
        this.pageTable[job.tex][job.ty * TILES_PER_AXIS + job.tx] = job.slot;
        this.stats.uploads++;
        this.inFlight.delete(key);
      }
    }
  }

  // Find a free slot or evict the least-recently-used slot not needed now.
  allocateSlot() {
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i].free) return i;
    }
    let victim = -1, oldest = Infinity;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const key = SVTSystem.key(s.tex, s.tx, s.ty);
      if (this.needed.has(key)) continue;   // never evict visible tiles
      if (this.inFlight.has(key)) continue; // never evict in-flight uploads
      if (s.lastUsed < oldest) { oldest = s.lastUsed; victim = i; }
    }
    if (victim >= 0) {
      const s = this.slots[victim];
      // Invalidate the page table entry so the evicted virtual tile can never
      // resolve to a physical page now owned by a different virtual tile.
      this.pageTable[s.tex][s.ty * TILES_PER_AXIS + s.tx] = TILE_MISSING;
      s.tex = -1; s.tx = -1; s.ty = -1; s.data = null; s.free = true;
      this.stats.evictions++;
    }
    return victim;
  }

  // Resolve a virtual tile to its physical slot, or null if not resident.
  lookup(tex, tx, ty) {
    const e = this.entry(tex, tx, ty);
    if (e < 0) return null;
    return this.slots[e];
  }

  poolUsage() {
    let used = 0;
    for (const s of this.slots) if (!s.free) used++;
    return used;
  }
}
