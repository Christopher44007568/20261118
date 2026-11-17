// Film grain applied AFTER tone mapping.
// Reference GLSL port of grain_pipeline/grain.py + noise.py.
//
// The noise hashes integer lattice coordinates directly (no modulo wrap), so
// the pattern is aperiodic: it cannot repeat at screen edges or over time.
// Time is a third noise dimension, which keeps the grain stable on screen and
// slowly evolving instead of re-randomising every frame.

#ifndef FILM_GRAIN_GLSL
#define FILM_GRAIN_GLSL

struct GrainParams {
    float strength;       // 0 = off, ~0.06 light, ~0.18 heavy
    float scale;          // flake size in pixels (small = fine)
    float shadowGain;     // amplitude toward black (e.g. 2.2)
    float highlightGain;  // amplitude toward white (e.g. 0.6)
    float temporalRate;   // evolution speed per frame (e.g. 0.18)
    float chroma;         // per-channel decorrelation, 0..1
    uint  seed;
};

uint hash3i(ivec3 p, uint seed) {
    uint h = uint(p.x) * 374761393u + seed;
    h = (h ^ (h >> 13u)) * 1274126177u;
    h += uint(p.y) * 668265263u;
    h = (h ^ (h >> 16u)) * 2246822519u;
    h += uint(p.z) * 3266489917u;
    h = (h ^ (h >> 13u)) * 1597334677u;
    h ^= h >> 16u;
    return h;
}

float hash01(ivec3 p, uint seed) {
    return float(hash3i(p, seed)) / 4294967296.0;
}

float sm(float t) { return t * t * (3.0 - 2.0 * t); }

// Smooth 3-D value noise, output roughly in [-1, 1].
float valueNoise3D(vec3 p, uint seed) {
    ivec3 i0 = ivec3(floor(p));
    vec3 f = fract(p);
    vec3 t = vec3(sm(f.x), sm(f.y), sm(f.z));

    float c000 = hash01(i0 + ivec3(0, 0, 0), seed);
    float c100 = hash01(i0 + ivec3(1, 0, 0), seed);
    float c010 = hash01(i0 + ivec3(0, 1, 0), seed);
    float c110 = hash01(i0 + ivec3(1, 1, 0), seed);
    float c001 = hash01(i0 + ivec3(0, 0, 1), seed);
    float c101 = hash01(i0 + ivec3(1, 0, 1), seed);
    float c011 = hash01(i0 + ivec3(0, 1, 1), seed);
    float c111 = hash01(i0 + ivec3(1, 1, 1), seed);

    float nx00 = mix(c000, c100, t.x);
    float nx10 = mix(c010, c110, t.x);
    float nx01 = mix(c001, c101, t.x);
    float nx11 = mix(c011, c111, t.x);
    float nxy0 = mix(nx00, nx10, t.y);
    float nxy1 = mix(nx01, nx11, t.y);
    return (mix(nxy0, nxy1, t.z) - 0.5) * 2.0;
}

// Per-pixel amplitude: high in shadows, low in highlights, exactly 0 at black.
float grainWeight(float luma, const GrainParams gp) {
    float t = clamp(luma, 0.0, 1.0);
    float w = gp.highlightGain
            + (gp.shadowGain - gp.highlightGain) * sqrt(max(t, 0.0))
              * (1.0 - t);
    return t > 0.0 ? w : 0.0;
}

// Call with the post-tonemap sRGB colour and a monotonically increasing frame
// index. screenUV is the full-resolution pixel position (not normalised UV),
// which keeps the grain locked to the screen under camera motion.
vec3 applyFilmGrain(vec3 colorSrgb, vec2 pixelCoord, float frameIndex,
                    const GrainParams gp) {
    if (gp.strength <= 0.0) return colorSrgb;

    float luma = dot(colorSrgb, vec3(0.2126, 0.7152, 0.0722));
    float mask = grainWeight(luma, gp);
    vec3 p = vec3(pixelCoord / gp.scale, frameIndex * gp.temporalRate);

    float nLum = valueNoise3D(p, gp.seed);
    vec3 delta = vec3(0.0);
    for (int c = 0; c < 3; ++c) {
        float n = nLum;
        if (c > 0 && gp.chroma > 0.0) {
            float nChr = valueNoise3D(p, gp.seed + uint(101 * (c + 1)));
            n = mix(nLum, nChr, gp.chroma);
        }
        delta[c] = gp.strength * mask * n;
    }

    // Hard black guard: pure black pixels never receive any grain / lift.
    if (luma <= 0.0) delta = vec3(0.0);
    return clamp(colorSrgb + delta, 0.0, 1.0);
}

#endif // FILM_GRAIN_GLSL
