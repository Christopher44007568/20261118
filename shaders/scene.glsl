// Shared scene description and shading helpers for all compute passes.
#ifndef SCENE_GLSL
#define SCENE_GLSL

#define PI 3.14159265359

struct Params {
    vec4  camPos;          // xyz
    vec4  camRight;        // xyz, + halfWidth (w)
    vec4  camUp;           // xyz, + halfHeight (w)
    vec4  camForward;      // xyz, + nearPlane (w)
    vec4  lightPos;        // xyz, + range (w)
    vec4  lightDir;        // xyz normalized, + cosInner (w)
    vec4  lightColor;      // rgb, + cosOuter (w)
    vec4  medium;          // x=baseDensity y=noiseDensity z=scatter w=absorption
    vec4  controls;        // x=scatterScale y=stepCount z=noiseSeed w=flags
    vec4  targetSize;      // xy = full resolution, zw = volume target resolution
    vec4  timing;          // x=jitterOffset (frame index), yzw unused
};

// SDF primitives -----------------------------------------------------------
float sdSphere(vec3 p, float r) { return length(p) - r; }
float sdPlane(vec3 p, float h) { return p.y - h; }

float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdEllipsoid(vec3 p, vec3 r) {
    float k0 = length(p / r);
    float k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / max(k1, 1e-5);
}

float opSmin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// Hash / value noise driven by the user seed -------------------------------
float hash31(vec3 p, float seed) {
    p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.23) + seed);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float vnoise(vec3 p, float seed) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float n000 = hash31(i + vec3(0, 0, 0), seed);
    float n100 = hash31(i + vec3(1, 0, 0), seed);
    float n010 = hash31(i + vec3(0, 1, 0), seed);
    float n110 = hash31(i + vec3(1, 1, 0), seed);
    float n001 = hash31(i + vec3(0, 0, 1), seed);
    float n101 = hash31(i + vec3(1, 0, 1), seed);
    float n011 = hash31(i + vec3(0, 1, 1), seed);
    float n111 = hash31(i + vec3(1, 1, 1), seed);
    return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
               mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

// Scene SDF.
// Material id packed into the distance via a global on hit.
float g_hitId;

float mapScene(vec3 p) {
    // Ground plane at y = -1.2.
    float d = sdPlane(p, -1.2);
    g_hitId = 1.0;

    // Slit wall at z = -6: two slabs leave a clean vertical opening of
    // |x| < 0.75 and y < 2.2 so the spot beam can pass through the gap.
    vec3 q = p - vec3(0.0, 0.0, -6.0);
    float slabL = sdBox(q - vec3(-2.05, 0.0, 0.0), vec3(1.3, 4.0, 0.9));
    float slabR = sdBox(q - vec3( 2.05, 0.0, 0.0), vec3(1.3, 4.0, 0.9));
    float top   = sdBox(q - vec3(0.0, 3.3, 0.0), vec3(3.4, 1.1, 0.9));
    float slit = min(min(slabL, slabR), top);
    if (slit < d) { d = slit; g_hitId = 2.0; }

    // Rock cluster that cuts into the right half of the beam path, giving a
    // clear natural truncation edge. Kept away from the beam axis (x ~ 0).
    float rocks = 1e9;
    rocks = opSmin(rocks, sdEllipsoid(p - vec3( 1.35, -0.55, -2.4), vec3(0.95, 0.85, 0.95)), 0.35);
    rocks = opSmin(rocks, sdEllipsoid(p - vec3( 2.15, -0.25, -1.6), vec3(0.75, 0.9, 0.75)), 0.3);
    rocks = opSmin(rocks, sdEllipsoid(p - vec3( 1.0, -0.85, -1.4), vec3(0.6, 0.55, 0.65)), 0.3);
    // Distant left cluster, well outside the beam.
    rocks = opSmin(rocks, sdEllipsoid(p - vec3(-2.6, -0.7, -3.4), vec3(0.85, 0.7, 0.85)), 0.3);
    rocks = opSmin(rocks, sdEllipsoid(p - vec3(-3.2, -0.35, -2.6), vec3(0.6, 0.75, 0.6)), 0.25);
    if (rocks < d) { d = rocks; g_hitId = 3.0; }
    return d;
}

vec3 calcNormal(vec3 p) {
    const vec2 e = vec2(1.0, -1.0) * 0.0015;
    return normalize(
        e.xyy * mapScene(p + e.xyy) +
        e.yyx * mapScene(p + e.yyx) +
        e.yxy * mapScene(p + e.yxy) +
        e.xxx * mapScene(p + e.xxx));
}

// Participating medium density: uniform haze + low frequency variation.
float mediumDensity(vec3 p, Params P) {
    float n = vnoise(p * 0.55, P.controls.z);
    float n2 = vnoise(p * 1.7 + 11.3, P.controls.z + 7.0);
    float d = P.medium.x + P.medium.y * (0.65 * n + 0.35 * n2);
    return max(d, 0.0);
}

// Spotlight factor with angular falloff and distance attenuation.
vec3 lightRadiance(vec3 p, Params P) {
    // Direction FROM the light toward the sample: this is the light's
    // propagation direction, so it aligns with P.lightDir.
    vec3 fromL = p - P.lightPos.xyz;
    float dist = length(fromL);
    vec3 dir = fromL / max(dist, 1e-5);
    float cosA = dot(dir, P.lightDir.xyz);
    float inner = P.lightDir.w;
    float outer = P.lightColor.w;
    float ang = smoothstep(outer, inner, cosA);
    float range = P.lightPos.w;
    float atten = 1.0 / (1.0 + 1.2 * (dist / range) + 6.0 * (dist * dist) / (range * range));
    float cutoff = 1.0 - smoothstep(range * 0.85, range, dist);
    return P.lightColor.rgb * (ang * atten * cutoff);
}

// Hard shadow ray toward the light, marching the SDF with cone-safe steps.
// Returns 0..1 visibility. This is the "shadow depth" used by every sample.
float shadowVisibility(vec3 p, Params P) {
    vec3 toL = P.lightPos.xyz - p;
    float maxT = length(toL);
    if (maxT < 1e-4) return 1.0;
    vec3 rd = toL / maxT;
    float t = 0.12;
    float vis = 1.0;
    for (int i = 0; i < 48; i++) {
        if (t >= maxT) break;
        vec3 sp = p + rd * t;
        float d = mapScene(sp);
        if (d < 0.0025) return 0.0;
        // Kelemen-style penumbra: only dims when the ray grazes a surface.
        vis = min(vis, 6.0 * d / t);
        t += clamp(d * 0.9, 0.03, 0.4);
    }
    return clamp(vis, 0.0, 1.0);
}

// Ray march the camera ray; returns hit distance (negative on miss).
float traceScene(vec3 ro, vec3 rd, out float hitId) {
    float t = 0.05;
    for (int i = 0; i < 160; i++) {
        vec3 p = ro + rd * t;
        float d = mapScene(p);
        if (d < 0.002) { hitId = g_hitId; return t; }
        t += clamp(d, 0.008, 0.5);
        if (t > 40.0) break;
    }
    hitId = -1.0;
    return -1.0;
}

vec3 surfaceAlbedo(float id, vec3 p) {
    if (id < 1.5) return vec3(0.32, 0.30, 0.28);            // ground
    if (id < 2.5) return vec3(0.22, 0.23, 0.26);            // slit rock
    float n = vnoise(p * 2.3, 3.0);
    return mix(vec3(0.28, 0.24, 0.20), vec3(0.42, 0.36, 0.30), n); // boulders
}

#endif
