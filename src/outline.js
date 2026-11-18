import * as THREE from 'three';

// Fullscreen outline pass.
// Edge cues:
//  - view-space depth step (Roberts cross on linear depth, single-sided so
//    only the nearer side of a step fires -> 1px lines). The threshold is
//    relative to local depth and scaled by 1/|n.v|, so smooth surfaces seen
//    at grazing angles (ground plane, sphere rims) never false-trigger
//    while true occluding contours always do.
//  - view-space normal discontinuity (angle between diagonal neighbours)
// Texture/detail colour never feeds the edge detector, so interior texture
// edges cannot become outlines. Kernel offsets are exactly 1 texel, which
// keeps the line width stable in pixels at any viewport size.

export const OutlineShader = {
  uniforms: {
    tDepth: { value: null },
    tNormal: { value: null },
    tDiffuse: { value: null },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 1000.0 },
    invProjectionMatrix: { value: new THREE.Matrix4() },
    resolution: { value: new THREE.Vector2(1, 1) },
    depthThreshold: { value: 0.1 },    // relative to local view depth
    normalThreshold: { value: 0.2 },   // min dot() of neighbouring normals
    outlineColor: { value: new THREE.Color(0x000000) },
    mode: { value: 0 },                // 0 composite, 1 scene only, 2 outline only
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    #include <packing>
    varying vec2 vUv;
    uniform sampler2D tDepth;
    uniform sampler2D tNormal;
    uniform sampler2D tDiffuse;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform mat4 invProjectionMatrix;
    uniform vec2 resolution;
    uniform float depthThreshold;
    uniform float normalThreshold;
    uniform vec3 outlineColor;
    uniform int mode;

    float viewDepth(vec2 uv) {
      float z = texture2D(tDepth, uv).x;
      return -perspectiveDepthToViewZ(z, cameraNear, cameraFar);
    }

    vec3 viewPos(vec2 uv) {
      float z = texture2D(tDepth, uv).x;
      vec4 clip = vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
      vec4 p = invProjectionMatrix * clip;
      return p.xyz / p.w;
    }

    vec3 viewNormal(vec2 uv) {
      return texture2D(tNormal, uv).xyz * 2.0 - 1.0;
    }

    bool isBackground(vec2 uv) {
      return texture2D(tDepth, uv).x > 0.9999;
    }

    // 1.0 when the pair straddles a depth step and the centre pixel belongs
    // to the nearer side of it (robust on sloping surfaces).
    float pairEdge(float a, float b, float c, float tauEff) {
      float m = min(a, b), M = max(a, b);
      if (M - m < tauEff * m) return 0.0;
      return abs(c - m) <= abs(c - M) ? 1.0 : 0.0;
    }

    bool depthStep(float a, float b, float tauEff) {
      float m = min(a, b);
      return max(a, b) - m >= tauEff * m;
    }

    float depthEdge(vec2 uv, vec2 texel, float tauEff) {
      if (isBackground(uv)) return 0.0; // background never originates an edge
      float c = viewDepth(uv);
      float e = pairEdge(viewDepth(uv + texel), viewDepth(uv - texel), c, tauEff);
      vec2 t2 = vec2(texel.x, -texel.y);
      e = max(e, pairEdge(viewDepth(uv + t2), viewDepth(uv - t2), c, tauEff));
      return e;
    }

    // Normal discontinuities are only reported where depth is continuous:
    // creases and contact lines have no depth step, while silhouette rims
    // (already handled by the depth channel) do.
    float normalPairEdge(vec3 a, vec3 b, vec3 vdir) {
      if (abs(dot(a, vdir)) < 0.35 && abs(dot(b, vdir)) < 0.35) return 0.0;
      return step(dot(normalize(a), normalize(b)), normalThreshold);
    }

    float normalEdge(vec2 uv, vec2 texel, vec3 vdir) {
      vec2 uv0 = uv + vec2(texel.x, texel.y);
      vec2 uv1 = uv - vec2(texel.x, texel.y);
      vec2 uv2 = uv + vec2(texel.x, -texel.y);
      vec2 uv3 = uv - vec2(texel.x, -texel.y);
      float e = 0.0;
      if (!isBackground(uv0) && !isBackground(uv1) &&
          !depthStep(viewDepth(uv0), viewDepth(uv1), 0.15))
        e = max(e, normalPairEdge(viewNormal(uv0), viewNormal(uv1), vdir));
      if (!isBackground(uv2) && !isBackground(uv3) &&
          !depthStep(viewDepth(uv2), viewDepth(uv3), 0.15))
        e = max(e, normalPairEdge(viewNormal(uv2), viewNormal(uv3), vdir));
      return e;
    }

    void main() {
      vec2 texel = 1.0 / resolution;
      vec3 vdir = normalize(viewPos(vUv));
      float grazing = abs(dot(normalize(viewNormal(vUv)), vdir));
      float tauEff = depthThreshold / clamp(grazing, 0.1, 1.0);
      float edge = max(depthEdge(vUv, texel, tauEff), normalEdge(vUv, texel, vdir));

      vec4 scene = texture2D(tDiffuse, vUv);
      if (mode == 1) { gl_FragColor = scene; return; }
      if (mode == 2) { gl_FragColor = vec4(vec3(edge), 1.0); return; }
      if (mode == 3) { gl_FragColor = texture2D(tNormal, vUv); return; }
      if (mode == 4) { gl_FragColor = vec4(vec3(viewDepth(vUv) / 200.0), 1.0); return; }
      gl_FragColor = vec4(mix(scene.rgb, outlineColor, edge), 1.0);
    }
  `,
};

// Renders view-space *face* normals (encoded to [0,1]) for the normal buffer
// pass. Face normals are piecewise constant, so smooth curved surfaces
// (sphere rims) produce no normal gradient, while true creases (90 deg
// jumps) and contact lines are detected cleanly.
export const NormalPassMaterial = new THREE.ShaderMaterial({
  vertexShader: /* glsl */ `
    varying vec3 vViewPos;
    void main() {
      vec4 vp = modelViewMatrix * vec4(position, 1.0);
      vViewPos = vp.xyz;
      gl_Position = projectionMatrix * vp;
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vViewPos;
    void main() {
      vec3 n = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
      gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
    }
  `,
});
