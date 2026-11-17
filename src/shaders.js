// WGSL sources for the four real passes. The heavy post-process shader is
// intentionally expensive so its GPU time dominates and can be attributed
// by the profiler; the empty pass in renderer.js draws nothing at all.

const instanceTransform = /* wgsl */`
fn instanceTransform(instance: u32, time: f32) -> mat4x4f {
  let grid = 8u;
  let ix = f32(instance % grid) - f32(grid - 1u) * 0.5;
  let iz = f32(instance / grid) - f32(grid - 1u) * 0.5;
  let angle = time * (0.4 + 0.05 * f32(instance % 7u)) + f32(instance);
  let c = cos(angle);
  let s = sin(angle);
  let lift = 0.8 + 0.4 * sin(time * 0.9 + f32(instance) * 1.7);
  // rotationY * translation, column-major
  return mat4x4f(
    vec4f(c, 0.0, -s, 0.0),
    vec4f(0.0, 1.0, 0.0, 0.0),
    vec4f(s, 0.0, c, 0.0),
    vec4f(ix * 2.4, lift, iz * 2.4, 1.0),
  );
}
`;

export const shadowShader = /* wgsl */`
struct Uniforms { cameraVP: mat4x4f, lightVP: mat4x4f, time: f32, pad: vec3f }
@group(0) @binding(0) var<uniform> u: Uniforms;
@vertex fn vs(@location(0) pos: vec3f, @builtin(instance_index) inst: u32) -> @builtin(position) vec4f {
  ${instanceTransform}
  return u.lightVP * instanceTransform(inst, u.time) * vec4f(pos, 1.0);
}
`;

export const sceneShader = /* wgsl */`
struct Uniforms { cameraVP: mat4x4f, lightVP: mat4x4f, time: f32, pad: vec3f }
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(1) @binding(0) var shadowMap: texture_depth_2d;
@group(1) @binding(1) var shadowSampler: sampler_comparison;

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) normal: vec3f,
  @location(1) world: vec3f,
  @location(2) @interpolate(flat) inst: u32,
}

@vertex fn vs(@location(0) pos: vec3f, @location(1) normal: vec3f,
              @builtin(instance_index) inst: u32) -> VsOut {
  ${instanceTransform}
  let model = instanceTransform(inst, u.time);
  let world = model * vec4f(pos, 1.0);
  var out: VsOut;
  out.clip = u.cameraVP * world;
  out.normal = (model * vec4f(normal, 0.0)).xyz;
  out.world = world.xyz;
  out.inst = inst;
  return out;
}

@fragment fn fs(in: VsOut) -> @location(0) vec4f {
  let lightPos = vec3f(6.0, 10.0, 4.0);
  let l = normalize(lightPos - in.world);
  let n = normalize(in.normal);
  let diffuse = max(dot(n, l), 0.0);
  var shadow = 1.0;
  let lp = u.lightVP * vec4f(in.world, 1.0);
  let proj = lp.xyz / lp.w;
  let uv = proj.xy * vec2f(0.5, -0.5) + vec2f(0.5);
  if (all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))) {
    shadow = textureSampleCompare(shadowMap, shadowSampler, uv, proj.z - 0.003);
  }
  let hue = f32(in.inst % 8u) / 8.0;
  let base = 0.5 + 0.5 * cos(6.2831 * (hue + vec3f(0.0, 0.33, 0.67)));
  let ambient = 0.15;
  return vec4f(base * (ambient + diffuse * shadow * 0.9), 1.0);
}
`;

// Deliberately long-running post-process: a wide jittered blur with a
// data-dependent inner loop so the compiler cannot collapse the taps.
// Expect this pass to dominate the frame time.
export const POST_BLUR_RADIUS = 12;

export const postShader = /* wgsl */`
@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var sceneSampler: sampler;

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
}

@fragment fn fs(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
  let radius = ${POST_BLUR_RADIUS};
  let texel = 1.0 / vec2f(textureDimensions(sceneTex));
  let uv = fragCoord.xy * texel;
  var acc = vec3f(0.0);
  var weightSum = 0.0;
  for (var y = -radius; y <= radius; y += 1) {
    for (var x = -radius; x <= radius; x += 1) {
      let offset = vec2f(f32(x), f32(y));
      let jitter = hash(fragCoord.xy + offset) - 0.5;
      let tapUv = uv + (offset + jitter) * texel * 1.5;
      let w = 1.0 / (1.0 + dot(offset, offset) * 0.02);
      acc += textureSample(sceneTex, sceneSampler, tapUv).rgb * w;
      weightSum += w;
    }
  }
  let blurred = acc / weightSum;
  // vignette + mild tonemap so the blur is visible
  let d = distance(uv, vec2f(0.5));
  let vig = 1.0 - d * d * 0.9;
  return vec4f(pow(blurred * vig, vec3f(0.9)), 1.0);
}
`;

// Instanced overlay bars, one per profiled pass, alpha-blended over the canvas.
export const uiShader = /* wgsl */`
struct BarInstance {
  origin: vec2f, // ndc, bottom-left of bar
  size: vec2f,   // ndc width/height
  color: vec4f,
}
@group(0) @binding(0) var<storage, read> bars: array<BarInstance>;

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) color: vec4f,
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) inst: u32) -> VsOut {
  let corner = vec2f(f32(vi & 1u), f32(vi >> 1u));
  let bar = bars[inst];
  var out: VsOut;
  out.clip = vec4f(bar.origin + corner * bar.size, 0.0, 1.0);
  out.color = bar.color;
  return out;
}

@fragment fn fs(in: VsOut) -> @location(0) vec4f {
  return in.color;
}
`;
