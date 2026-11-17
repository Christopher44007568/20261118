// Smoke test: run src/main.js against a stubbed DOM + WebGL2 context to
// catch runtime errors (shader source, buffer setup, frame loop) in Node.
const glStub = new Proxy({}, {
  get(t, prop) {
    if (prop === 'getShaderParameter' || prop === 'getProgramParameter') return () => true;
    if (prop === 'getUniformLocation') return () => ({});
    if (prop.startsWith('create')) return () => ({});
    if (prop === 'getContext') return () => glStub;
    if (typeof prop === 'string' && prop === prop.toUpperCase()) return 1;
    return () => {};
  },
});

const elements = new Map();
const makeEl = () => ({
  style: {},
  value: '-1',
  checked: true,
  textContent: '',
  clientWidth: 800,
  clientHeight: 600,
  getContext: () => glStub,
  addEventListener: () => {},
  appendChild: () => {},
  click: () => {},
  set onclick(fn) {},
});

globalThis.document = {
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, makeEl());
    return elements.get(id);
  },
  createElement: () => makeEl(),
  body: { innerHTML: '' },
};
globalThis.window = globalThis;
globalThis.URL.createObjectURL = () => 'blob:stub';
globalThis.URL.revokeObjectURL = () => {};
globalThis.Blob = class {};

let rafCount = 0;
globalThis.requestAnimationFrame = (fn) => {
  if (rafCount++ < 5) setImmediate(() => fn(performance.now()));
};

await import('../src/main.js');
await new Promise((r) => setTimeout(r, 100));
console.log(`smoke OK: main.js ran ${rafCount} frames without exceptions`);
