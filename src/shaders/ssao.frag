#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outAo;

uniform sampler2D uDepth;        // R32F linear view depth, positive in front of camera
uniform sampler2D uNormal;       // RGB encoded view normal
uniform sampler2D uNoise;        // RG16F 4x4 rotation vectors
uniform mat4 uProj;              // project sample points to screen
uniform vec3 uSamples[64];       // hemisphere sample kernel (max 64)
uniform int uKernelSize;
uniform float uRadius;           // kernel radius in world units
uniform float uDepthBias;        // bias in world units
uniform float uIntensity;        // AO strength multiplier
uniform float uRangeCheck;       // smooth range cutoff (world units)

vec3 decodeNormal(vec3 c) { return normalize(c * 2.0 - 1.0); }

// View-space position; z is negative for visible geometry (OpenGL convention).
vec3 viewPosition(vec2 uv) {
  float z = texture(uDepth, uv).r;
  // Build a unit-depth view ray (z = -1) from NDC x/y using projection
  // coefficients, then scale by linear depth. This avoids the near-plane
  // scaling baked into the inverse-projection unproject.
  vec2 ndc = uv * 2.0 - 1.0;
  vec3 ray = vec3(ndc.x / uProj[0][0], ndc.y / uProj[1][1], -1.0);
  return ray * z;
}

vec2 projectToScreen(vec3 viewPos) {
  vec4 clip = uProj * vec4(viewPos, 1.0);
  vec3 ndc = clip.xyz / clip.w;
  return ndc.xy * 0.5 + 0.5;
}

void main() {
  float centerDepth = texture(uDepth, vUv).r;
  if (centerDepth <= 0.0) {            // background: no surface, full AO
    outAo = vec4(1.0, 0.0, 0.0, 1.0);
    return;
  }

  vec3 origin = viewPosition(vUv);
  vec3 normal = decodeNormal(texture(uNormal, vUv).rgb);
  // Tile the small rotation texture per screen pixel (REPEAT wrap), so the
  // random rotation changes every pixel instead of every 4x4 block.
  ivec2 noiseSize = textureSize(uNoise, 0);
  vec2 rand2 = texelFetch(uNoise,
    ivec2(int(gl_FragCoord.x) % noiseSize.x, int(gl_FragCoord.y) % noiseSize.y), 0).xy;
  // Stable orthonormal basis (Frisvad-style), rotated by the noise angle.
  vec3 helper = abs(normal.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 tangent = normalize(cross(helper, normal));
  vec3 bitangent = cross(normal, tangent);
  float angle = rand2.x * 6.28318530718;
  float cs = cos(angle), sn = sin(angle);
  vec3 rotTangent = tangent * cs + bitangent * sn;
  vec3 rotBitangent = bitangent * cs - tangent * sn;
  mat3 tbn = mat3(rotTangent, rotBitangent, normal);

  float occlusion = 0.0;
  int skipped = 0;
  for (int i = 0; i < 64; i++) {
    if (i >= uKernelSize) break;
    vec3 sampleView = origin + tbn * uSamples[i] * uRadius;
    vec2 suv = projectToScreen(sampleView);
    vec3 sampleDir = normalize(sampleView - origin);
    // Grazing-angle weight: samples nearly tangent to a sloped plane must not
    // count as occlusion (prevents flat-wall self-occlusion in perspective).
    // Squaring makes the falloff steeper so only front-facing samples matter.
    float facing = pow(max(dot(sampleDir, normal), 0.0), 2.0);

    // Boundary pixels must never consume off-screen data: reject instead
    // of texture-repeat/clamp sampling.
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) {
      skipped++;
      continue;
    }

    float sampleDepth = texture(uDepth, suv).r; // positive linear depth
    if (sampleDepth <= 0.0) {                    // projects onto background
      skipped++;
      continue;
    }

    // Positive linear depth of the sample point itself.
    float samplePointDepth = -sampleView.z;
    // Range attenuation: ignore geometry far from the center.
    float range = smoothstep(uRangeCheck, uRangeCheck * 0.25,
                             abs(centerDepth - sampleDepth));
    // dz > 0 means geometry is in front of the sample point (occluded).
    float dz = samplePointDepth - sampleDepth;
    // Depth-proportional bias rejects coplanar self-samples on flat surfaces
    // while preserving real contact occlusion at close range.
    float scaledBias = uDepthBias + centerDepth * 0.01;
    if (dz > scaledBias) {
      occlusion += range * facing;
    }
  }

  float ao = 1.0 - (occlusion / float(uKernelSize)) * uIntensity;
  ao = clamp(ao, 0.0, 1.0);
  // G channel records the fraction of samples skipped (boundary debug).
  float skipFraction = float(skipped) / float(uKernelSize);
  outAo = vec4(ao, skipFraction, 0.0, 1.0);
}
