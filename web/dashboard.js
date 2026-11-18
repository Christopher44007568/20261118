import { describeKey, variantKey } from '../src/variantKey.js';

export function el(id) {
  return document.getElementById(id);
}

export function renderMetrics(cache, report) {
  const snap = cache.snapshot();
  const { stats } = snap;
  el('mQueueDepth').textContent = snap.queueDepth;
  el('mHitRate').textContent = snap.hitRate === null ? '—' : `${(snap.hitRate * 100).toFixed(1)}%`;
  el('mHitMiss').textContent = `命中 ${stats.hits} / 未命中 ${stats.misses}`;
  el('mFvd').textContent = report ? `${report.firstVisibleDelayMs.toFixed(1)}` : '—';
  el('mSize').textContent = `${snap.size} / ${snap.capacity}`;
  el('mEvictions').textContent = `淘汰 ${stats.evictions}`;
  el('mCompiles').textContent = stats.compiles;
  el('mFails').textContent = `${stats.compileFailures} / ${stats.fallbacks}`;
}

export function renderWarmupProgress(ready, total) {
  el('warmupProgressText').textContent = `${ready} / ${total}`;
  el('warmupProgress').style.width = total === 0 ? '0' : `${(ready / total) * 100}%`;
}

export function renderCacheList(cache) {
  const container = el('cacheList');
  const snap = cache.snapshot();
  if (snap.entries.length === 0) {
    container.innerHTML = '<p style="color:var(--muted);font-size:12px">缓存为空，进入视角后开始预热</p>';
    return;
  }
  container.innerHTML = snap.entries
    .map((entry) => {
      const fallbackNote = entry.fallbackKey
        ? `<div style="color:var(--purple)">↳ 回退: ${entry.fallbackKey.split('|')[0]}</div>`
        : '';
      return `
        <div class="cache-chip ${entry.status}">
          <span class="chip-status">${entry.status}</span>
          <div>#${entry.lruIndex} ${describeKey(entry.key)}</div>
          ${fallbackNote}
        </div>`;
    })
    .join('');
}

export function renderEventLog(controller) {
  const list = el('eventLog');
  list.innerHTML = controller.eventLog
    .slice(-40)
    .reverse()
    .map((record) => {
      const cls = record.message.includes('命中') ? 'hit'
        : record.message.includes('失败') || record.message.includes('回退') ? 'warn' : '';
      return `<li class="${cls}">[${record.at}ms] ${record.message}</li>`;
    })
    .join('');
}

export function renderMaterialGrid(materials, currentCamera, cache, variantResolver) {
  const container = el('materialGrid');
  container.innerHTML = materials
    .map((material) => {
      const visible = material.groups.includes(currentCamera);
      const variant = variantResolver(material);
      const entry = cache.entries.get(variantKey(variant));
      const status = !visible ? 'hidden' : entry ? entry.status : 'compiling';
      const label = {
        hidden: '不可见',
        ready: '已缓存',
        compiling: '编译中',
        error: '回退中',
      }[status];
      return `
        <div class="mat-row">
          <span><span class="dot ${status}"></span> ${material.label}</span>
          <span style="color:var(--muted)">${label}</span>
        </div>`;
    })
    .join('');
}
