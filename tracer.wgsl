// ─────────────────────────────────────────────────────────────
// Progressive path tracer · WebGPU compute
// Per-pixel persistent RNG state + running average accumulation.
// ─────────────────────────────────────────────────────────────

struct Camera {
  origin : vec4f,
  top_left : vec4f,   // world position of the top-left pixel sample base
  right : vec4f,      // camera-right axis * (pixel width)
  down : vec4f,       // camera-down axis * (pixel height)
};

struct Params {
  resolution : vec4u,   // xy = width/height, z = frame index, w = reset flag
  target_spp : vec4f,   // x = target samples per pixel, rest unused
};

struct Sphere {
  center : vec4f,       // w = radius
  albedo : vec4f,
  params : vec4f,       // x = metallic, y = roughness, z = emission strength, w = material kind
};

struct Box {
  min_corner : vec4f,
  max_corner : vec4f,
  albedo : vec4f,
  params : vec4f,       // x = metallic, y = roughness, z = emission, w = kind
};

struct Quad {
  origin : vec4f,       // corner point
  edge_u : vec4f,       // w = half width
  edge_v : vec4f,       // w = half height
  normal : vec4f,       // w = light area
  emission : vec4f,     // rgb = radiance, w unused
};

@group(0) @binding(0) var<uniform> camera : Camera;
@group(0) @binding(1) var<uniform> params : Params;
@group(0) @binding(2) var<storage, read> spheres : array<Sphere>;
@group(0) @binding(3) var<storage, read> boxes : array<Box>;
@group(0) @binding(4) var<storage, read> quads : array<Quad>;
@group(0) @binding(5) var<storage, read_write> accum : array<vec4f>;
@group(0) @binding(6) var<storage, read_write> pixel_meta : array<vec4u>;
@group(0) @binding(7) var output_tex : texture_storage_2d<rgba8unorm, write>;

const PI : f32 = 3.141592653589793;
const TWO_PI : f32 = 6.283185307179586;
const MAX_BOUNCES : u32 = 8u;
const EPS : f32 = 1e-4;
const INF : f32 = 1e9;

// Material kinds
const MAT_DIFFUSE : f32 = 0.0;
const MAT_METAL : f32 = 1.0;
const MAT_GLOSSY : f32 = 2.0;

// ── Persistent per-pixel PCG32 RNG ───────────────────────────
// State lives in `pixel_meta.xy` between frames, so the stream is
// reproducible and continues advancing — never re-seeded to the
// same value per frame.
fn pcg_next(state : ptr<function, vec2u>) -> u32 {
  var s = (*state).x;
  s = s * 747796405u + 2891336453u;
  (*state).x = s;
  var w = s;
  w = ((w >> ((w >> 28u) + 4u)) ^ w) * 277803737u;
  w = (w >> 22u) ^ w;
  (*state).y = (*state).y + 0x9E3779B9u;
  return w;
}

fn rand_f32(state : ptr<function, vec2u>) -> f32 {
  return f32(pcg_next(state)) * (1.0 / 4294967296.0);
}

fn rand_range(state : ptr<function, vec2u>, lo : f32, hi : f32) -> f32 {
  return lo + (hi - lo) * rand_f32(state);
}

fn cosine_hemisphere(n : vec3f, state : ptr<function, vec2u>) -> vec3f {
  let r = sqrt(rand_f32(state));
  let a = TWO_PI * rand_f32(state);
  let local = vec3f(r * cos(a), r * sin(a), sqrt(max(0.0, 1.0 - r * r)));
  let w = select(n, -n, n.z < -0.999);
  let t = normalize(cross(vec3f(0.0, 1.0, 0.0), w));
  let b = cross(w, t);
  return normalize(t * local.x + b * local.y + w * local.z);
}

// ── Geometry intersections ───────────────────────────────────
struct Hit {
  t : f32,
  point : vec3f,
  normal : vec3f,
  albedo : vec3f,
  metallic : f32,
  roughness : f32,
  emission : vec3f,
  kind : f32,
  hit : bool,
};

fn no_hit() -> Hit {
  return Hit(INF, vec3f(0.0), vec3f(0.0), vec3f(0.0), 0.0, 0.0, vec3f(0.0), 0.0, false);
}

fn intersect_sphere(ro : vec3f, rd : vec3f, s : Sphere, tmax : f32) -> Hit {
  let center = s.center.xyz;
  let radius = s.center.w;
  let oc = ro - center;
  let b = dot(oc, rd);
  let c = dot(oc, oc) - radius * radius;
  let disc = b * b - c;
  if (disc < 0.0) { return no_hit(); }
  let sq = sqrt(disc);
  var t = -b - sq;
  if (t < EPS) { t = -b + sq; }
  if (t < EPS || t > tmax) { return no_hit(); }
  let p = ro + rd * t;
  var n = (p - center) / radius;
  if (dot(n, rd) > 0.0) { n = -n; }
  return Hit(t, p, n, s.albedo.rgb, s.params.x, s.params.y,
             s.albedo.rgb * s.params.z, s.params.w, true);
}

fn intersect_box(ro : vec3f, rd : vec3f, bx : Box, tmax : f32) -> Hit {
  let inv = 1.0 / rd;
  let t1 = (bx.min_corner.xyz - ro) * inv;
  let t2 = (bx.max_corner.xyz - ro) * inv;
  let tmin_v = min(t1, t2);
  let tmax_v = max(t1, t2);
  var tnear = max(tmin_v.x, max(tmin_v.y, tmin_v.z));
  let tfar = min(tmax_v.x, min(tmax_v.y, tmax_v.z));
  if (tfar < max(tnear, EPS)) { return no_hit(); }
  if (tnear < EPS) { tnear = tfar; }
  if (tnear < EPS || tnear > tmax) { return no_hit(); }
  let p = ro + rd * tnear;
  var n = vec3f(0.0);
  let center = (bx.min_corner.xyz + bx.max_corner.xyz) * 0.5;
  let half = (bx.max_corner.xyz - bx.min_corner.xyz) * 0.5;
  let lp = (p - center) / half;
  let ax = abs(lp.x);
  let ay = abs(lp.y);
  let az = abs(lp.z);
  if (ax > ay && ax > az) { n = vec3f(sign(lp.x), 0.0, 0.0); }
  else if (ay > az) { n = vec3f(0.0, sign(lp.y), 0.0); }
  else { n = vec3f(0.0, 0.0, sign(lp.z)); }
  if (dot(n, rd) > 0.0) { n = -n; }
  return Hit(tnear, p, n, bx.albedo.rgb, bx.params.x, bx.params.y,
             bx.albedo.rgb * bx.params.z, bx.params.w, true);
}

fn intersect_quad(ro : vec3f, rd : vec3f, q : Quad, tmax : f32) -> Hit {
  let n = q.normal.xyz;
  let denom = dot(n, rd);
  if (abs(denom) < 1e-8) { return no_hit(); }
  let t = dot(q.origin.xyz - ro, n) / denom;
  if (t < EPS || t > tmax) { return no_hit(); }
  let p = ro + rd * t;
  let planar = p - q.origin.xyz;
  let u = q.edge_u.xyz;
  let v = q.edge_v.xyz;
  let uu = dot(u, u);
  let vv = dot(v, v);
  let su = dot(planar, u) / uu;
  let sv = dot(planar, v) / vv;
  if (su < 0.0 || su > 1.0 || sv < 0.0 || sv > 1.0) { return no_hit(); }
  var nn = n;
  if (dot(nn, rd) > 0.0) { nn = -nn; }
  return Hit(t, p, nn, vec3f(0.0), 0.0, 1.0, q.emission.rgb, MAT_DIFFUSE, true);
}

fn trace(ro : vec3f, rd : vec3f) -> Hit {
  var best = no_hit();
  for (var i : u32 = 0u; i < arrayLength(&spheres); i++) {
    let h = intersect_sphere(ro, rd, spheres[i], best.t);
    if (h.hit) { best = h; }
  }
  for (var i : u32 = 0u; i < arrayLength(&boxes); i++) {
    let h = intersect_box(ro, rd, boxes[i], best.t);
    if (h.hit) { best = h; }
  }
  for (var i : u32 = 0u; i < arrayLength(&quads); i++) {
    let h = intersect_quad(ro, rd, quads[i], best.t);
    if (h.hit) { best = h; }
  }
  return best;
}

fn occluded(ro : vec3f, rd : vec3f, dist : f32) -> bool {
  for (var i : u32 = 0u; i < arrayLength(&spheres); i++) {
    let h = intersect_sphere(ro, rd, spheres[i], dist);
    if (h.hit) { return true; }
  }
  for (var i : u32 = 0u; i < arrayLength(&boxes); i++) {
    let h = intersect_box(ro, rd, boxes[i], dist);
    if (h.hit) { return true; }
  }
  return false;
}

// ── GGX microfacet BRDF ──────────────────────────────────────
fn fresnel_schlick(cos_theta : f32, f0 : vec3f) -> vec3f {
  let t = clamp(1.0 - cos_theta, 0.0, 1.0);
  return f0 + (vec3f(1.0) - f0) * t * t * t * t * t;
}

fn ggx_ndf(n_dot_h : f32, alpha : f32) -> f32 {
  let a2 = alpha * alpha;
  let d = n_dot_h * n_dot_h * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, 1e-7);
}

fn ggx_g1(n_dot_v : f32, alpha : f32) -> f32 {
  let a2 = alpha * alpha;
  return 2.0 * n_dot_v / (n_dot_v + sqrt(a2 + (1.0 - a2) * n_dot_v * n_dot_v));
}

fn smith_g(n_dot_v : f32, n_dot_l : f32, alpha : f32) -> f32 {
  return ggx_g1(n_dot_v, alpha) * ggx_g1(n_dot_l, alpha);
}

// Importance-sample a GGX half vector in the local hemisphere.
fn ggx_sample_half(n : vec3f, alpha : f32, state : ptr<function, vec2u>) -> vec3f {
  let xi1 = rand_f32(state);
  let xi2 = rand_f32(state);
  let a2 = alpha * alpha;
  let cos_theta = sqrt((1.0 - xi1) / (1.0 + (a2 - 1.0) * xi1));
  let sin_theta = sqrt(max(0.0, 1.0 - cos_theta * cos_theta));
  let phi = TWO_PI * xi2;
  let local = vec3f(sin_theta * cos(phi), sin_theta * sin(phi), cos_theta);
  let w = select(n, -n, n.z < -0.999);
  let t = normalize(cross(vec3f(0.0, 1.0, 0.0), w));
  let b = cross(w, t);
  return normalize(t * local.x + b * local.y + w * local.z);
}

fn f0_for(albedo : vec3f, metallic : f32) -> vec3f {
  return mix(vec3f(0.04), albedo, metallic);
}

// Evaluate the full BRDF (diffuse Lambert + GGX specular) for a
// given view / light direction. Returns brdf and pdf via pointers.
fn eval_brdf(hit : Hit, wo : vec3f, wi : vec3f) -> vec3f {
  let n = hit.normal;
  let n_dot_l = max(dot(n, wi), 0.0);
  let n_dot_v = max(dot(n, wo), 0.0);
  if (n_dot_l <= 0.0 || n_dot_v <= 0.0) { return vec3f(0.0); }
  let alpha = max(hit.roughness * hit.roughness, 1e-3);
  let h = normalize(wi + wo);
  let n_dot_h = max(dot(n, h), 0.0);
  let v_dot_h = max(dot(wo, h), 0.0);
  let f0 = f0_for(hit.albedo, hit.metallic);
  let f = fresnel_schlick(v_dot_h, f0);
  let d = ggx_ndf(n_dot_h, alpha);
  let g = smith_g(n_dot_v, n_dot_l, alpha);
  let spec = (d * g * f) / max(4.0 * n_dot_v * n_dot_l, 1e-7);
  let kd = (vec3f(1.0) - f) * (1.0 - hit.metallic);
  let diffuse = kd * hit.albedo / PI;
  return (diffuse + spec) * n_dot_l;
}

fn brdf_pdf(hit : Hit, wo : vec3f, wi : vec3f) -> f32 {
  let n = hit.normal;
  let n_dot_l = max(dot(n, wi), 0.0);
  if (n_dot_l <= 0.0) { return 0.0; }
  let alpha = max(hit.roughness * hit.roughness, 1e-3);
  let h = normalize(wi + wo);
  let n_dot_h = max(dot(n, h), 0.0);
  let v_dot_h = max(dot(wo, h), 0.0);
  let a2 = alpha * alpha;
  let d = ggx_ndf(n_dot_h, alpha);
  let f0 = f0_for(hit.albedo, hit.metallic);
  let f = fresnel_schlick(v_dot_h, f0);
  let spec_weight = clamp(max(max(f.x, f.y), f.z), 0.04, 1.0);
  let spec_pdf = d * n_dot_h / max(4.0 * v_dot_h, 1e-7);
  let diff_pdf = n_dot_l / PI;
  return spec_pdf * spec_weight + diff_pdf * (1.0 - spec_weight);
}

// Sample one outgoing direction following the BRDF.
fn sample_brdf(hit : Hit, wo : vec3f, state : ptr<function, vec2u>) -> vec3f {
  let f0 = f0_for(hit.albedo, hit.metallic);
  let f = fresnel_schlick(max(dot(hit.normal, wo), 0.0), f0);
  let spec_weight = clamp(max(max(f.x, f.y), f.z), 0.04, 1.0);
  if (rand_f32(state) < spec_weight) {
    let alpha = max(hit.roughness * hit.roughness, 1e-3);
    let h = ggx_sample_half(hit.normal, alpha, state);
    let wi = reflect(-wo, h);
    if (dot(wi, hit.normal) <= 0.0) {
      return cosine_hemisphere(hit.normal, state);
    }
    return wi;
  }
  return cosine_hemisphere(hit.normal, state);
}

// ── Next-event estimation: explicit area-light sampling ──────
fn sample_light_point(q : Quad, state : ptr<function, vec2u>) -> vec3f {
  let su = rand_f32(state);
  let sv = rand_f32(state);
  return q.origin.xyz + q.edge_u.xyz * su + q.edge_v.xyz * sv;
}

// PDF of direction `wi` (from surface point `p`) under uniform
// area-light sampling, summed over every quad light.
fn light_pdf(p : vec3f, wi : vec3f) -> f32 {
  var pdf = 0.0;
  let count = arrayLength(&quads);
  for (var i : u32 = 0u; i < count; i++) {
    let q = quads[i];
    let denom = dot(q.normal.xyz, wi);
    if (abs(denom) < 1e-8) { continue; }
    let t = dot(q.origin.xyz - p, q.normal.xyz) / denom;
    if (t <= EPS) { continue; }
    let hit_p = p + wi * t;
    let planar = hit_p - q.origin.xyz;
    let su = dot(planar, q.edge_u.xyz) / dot(q.edge_u.xyz, q.edge_u.xyz);
    let sv = dot(planar, q.edge_v.xyz) / dot(q.edge_v.xyz, q.edge_v.xyz);
    if (su < 0.0 || su > 1.0 || sv < 0.0 || sv > 1.0) { continue; }
    let l_n = select(q.normal.xyz, -q.normal.xyz, dot(q.normal.xyz, wi) > 0.0);
    let l_cos = max(dot(l_n, -wi), 0.0);
    pdf += (t * t) / (q.normal.w * max(l_cos, 1e-7));
  }
  return pdf / f32(count);
}

fn direct_lighting(hit : Hit, wo : vec3f, state : ptr<function, vec2u>) -> vec3f {
  var radiance = vec3f(0.0);
  let light_count = arrayLength(&quads);
  if (light_count == 0u) { return radiance; }
  for (var li : u32 = 0u; li < light_count; li++) {
    let q = quads[li];
    let light_point = sample_light_point(q, state);
    var to_light = light_point - hit.point;
    let dist = length(to_light);
    let wi = to_light / dist;
    let n_dot_l = dot(hit.normal, wi);
    if (n_dot_l <= 0.0) { continue; }
    let l_n = select(q.normal.xyz, -q.normal.xyz, dot(q.normal.xyz, wi) > 0.0);
    let l_cos = max(dot(l_n, -wi), 0.0);
    if (l_cos <= 0.0) { continue; }
    let shadow_o = hit.point + hit.normal * EPS;
    if (occluded(shadow_o, wi, dist - EPS * 2.0)) { continue; }
    let brdf = eval_brdf(hit, wo, wi);
    let light_pdf = (dist * dist) / (q.normal.w * l_cos);
    // Balance-heuristic MIS: the same direction can also be drawn
    // from the BRDF sampler, so weight the light sample accordingly.
    let bsdf_p = brdf_pdf(hit, wo, wi);
    let mis = light_pdf / max(light_pdf + bsdf_p, 1e-7);
    radiance += brdf * q.emission.rgb * mis / light_pdf / f32(light_count);
  }
  return radiance;
}

// ── One full path for this pixel ─────────────────────────────
fn trace_path(ro_in : vec3f, rd_in : vec3f, state : ptr<function, vec2u>) -> vec3f {
  var ro = ro_in;
  var rd = rd_in;
  var throughput = vec3f(1.0);
  var radiance = vec3f(0.0);

  for (var bounce : u32 = 0u; bounce < MAX_BOUNCES; bounce++) {
    let hit = trace(ro, rd);
    if (!hit.hit) { break; }

    // Emissive surfaces contribute only on the first segment
    // (NEE handles light transport on later bounces).
    if (bounce == 0u) {
      radiance += throughput * hit.emission;
    }

    let wo = -rd;
    radiance += throughput * direct_lighting(hit, wo, state);

    let wi = sample_brdf(hit, wo, state);
    let pdf = brdf_pdf(hit, wo, wi);
    if (pdf <= 1e-6) { break; }
    let lp = light_pdf(hit.point, wi);
    let mis = pdf / max(pdf + lp, 1e-7);
    let weight = eval_brdf(hit, wo, wi) / pdf;
    throughput *= weight * mis;

    // Russian roulette after the third bounce keeps deep paths
    // unbiased while cutting work on dark / absorbed paths.
    if (bounce >= 3u) {
      let survive = clamp(max(max(throughput.x, throughput.y), throughput.z), 0.05, 0.95);
      if (rand_f32(state) > survive) { break; }
      throughput /= survive;
    }
    ro = hit.point + hit.normal * EPS;
    rd = wi;
  }
  return radiance;
}

fn aces_tone_map(x : vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

fn to_srgb(c : vec3f) -> vec3f {
  var out = c * 12.92;
  let hi = c > vec3f(0.0031308);
  let curved = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
  out = select(out, curved, hi);
  return out;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let width = params.resolution.x;
  let height = params.resolution.y;
  if (gid.x >= width || gid.y >= height) { return; }
  let idx = gid.y * width + gid.x;

  // Reset: clear running average and seed a unique reproducible
  // stream per pixel. The seed is a function of pixel position,
  // so repeated resets reproduce the same image while every
  // pixel still owns an independent stream.
  if (params.resolution.w == 1u) {
    accum[idx] = vec4f(0.0);
    let h0 = gid.x * 374761393u + gid.y * 668265263u + 1442695041u;
    let h1 = gid.y * 2246822519u + gid.x * 3266489917u + 0x9E3779B9u;
    pixel_meta[idx] = vec4u(h0, h1, 0u, 0u);
  }

  var rng = vec2u(pixel_meta[idx].x, pixel_meta[idx].y);

  // Jittered sub-pixel sample for anti-aliasing.
  let jx = rand_f32(&rng) - 0.5;
  let jy = rand_f32(&rng) - 0.5;
  let sample_pos = camera.top_left.xyz
                 + camera.right.xyz * (f32(gid.x) + 0.5 + jx)
                 + camera.down.xyz * (f32(gid.y) + 0.5 + jy);
  let ro = camera.origin.xyz;
  let rd = normalize(sample_pos - ro);

  let sample_color = trace_path(ro, rd, &rng);

  // Running mean: mean_n = mean_{n-1} + (x - mean_{n-1}) / n
  let prev = accum[idx];
  let n = prev.w + 1.0;
  let mean = prev.xyz + (sample_color - prev.xyz) / n;
  accum[idx] = vec4f(mean, n);

  let spp_limit = params.target_spp.x;
  if (n <= spp_limit) {
    let mapped = to_srgb(aces_tone_map(mean));
    textureStore(output_tex, vec2i(gid.xy), vec4f(mapped, 1.0));
  }

  pixel_meta[idx] = vec4u(rng.x, rng.y, u32(n + 0.5), 0u);
}
