const lines = [];
lines.push('gpu=' + !!navigator.gpu);
try {
  const a1 = await navigator.gpu.requestAdapter();
  lines.push('default adapter=' + !!a1);
  if (a1) lines.push('default info=' + JSON.stringify(a1.info) + ' fallback=' + a1.isFallbackAdapter);
  const a2 = await navigator.gpu.requestAdapter({ forceFallbackAdapter: true });
  lines.push('fallback adapter=' + !!a2);
  if (a2) lines.push('fallback info=' + JSON.stringify(a2.info));
} catch (e) {
  lines.push('error=' + e.message);
}
document.getElementById('out').textContent = lines.join('\n');
document.body.dataset.done = '1';
