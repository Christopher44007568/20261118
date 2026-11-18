// GLSL sources for the GPU-resident particle system.
// Particle state layout (one slot = one particle, fixed pool):
//   posSize : vec4  xyz = position,        w = base size (world units)
//   velAge  : vec4  xyz = velocity,        w = age (seconds since spawn)
//   color   : vec4  rgb  = color,          a = alpha scale
//   meta    : vec4  x = lifetime, y = seed, z = state (0 dead / 1 alive)

const UPDATE_VS = `#version 300 es
precision highp float;
precision highp int;

layout(location=0) in vec4 a_posSize;
layout(location=1) in vec4 a_velAge;
layout(location=2) in vec4 a_color;
layout(location=3) in vec4 a_meta;

uniform float u_dt;
uniform float u_time;
uniform vec3  u_emitPos;
uniform vec3  u_emitDir;
uniform float u_emitSpread;
uniform float u_emitSpeed;
uniform float u_turbulence;
uniform vec3  u_gravity;
uniform float u_drag;
uniform int   u_spawnStart;   // recycling-window cursor (slot index)
uniform int   u_spawnCount;   // slots to reclaim this frame
uniform sampler2D u_spawnTex; // RGBA32F: (life, seed, hueMix, size) per spawn
uniform vec3  u_paletteA;
uniform vec3  u_paletteB;
uniform vec3  u_paletteC;

out vec4 v_posSize;
out vec4 v_velAge;
out vec4 v_color;
out vec4 v_meta;

uint hash(uint x){
  x ^= x >> 16; x *= 0x7feb352dU;
  x ^= x >> 15; x *= 0x846ca68bU;
  x ^= x >> 16; return x;
}
float hash01(uint x){ return float(hash(x)) * (1.0 / 4294967296.0); }

// Cheap divergence-light turbulence field from layered trig.
vec3 flowField(vec3 p, float t){
  float a = sin(p.y * 1.7 + t * 0.9) + sin(p.z * 2.3 - t * 0.7);
  float b = sin(p.z * 1.9 + t * 0.8) + sin(p.x * 2.1 - t * 0.6);
  float c = sin(p.x * 1.3 + t * 1.1) + sin(p.y * 2.7 - t * 0.5);
  return vec3(a, b, c) * 0.5;
}

void main(){
  vec4 posSize = a_posSize;
  vec4 velAge  = a_velAge;
  vec4 col     = a_color;
  vec4 meta    = a_meta;

  int slot = gl_VertexID;
  bool alive = meta.z > 0.5;

  if(!alive){
    // Recycling queue: dead slots inside the cursor window are reclaimed.
    if(slot >= u_spawnStart && slot < u_spawnStart + u_spawnCount){
      vec4 sp = texelFetch(u_spawnTex, ivec2(slot - u_spawnStart, 0), 0);
      uint seed = uint(sp.y);
      vec3 r = vec3(hash01(seed), hash01(seed ^ 0x9e3779b9U), hash01(seed ^ 0x85ebca6bU));

      vec3 dir = normalize(u_emitDir);
      vec3 up  = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      vec3 o1  = normalize(cross(dir, up));
      vec3 o2  = cross(dir, o1);
      float ang = r.x * 6.2831853;
      float rad = sqrt(r.y) * u_emitSpread;
      vec3 jdir = normalize(dir + (cos(ang) * o1 + sin(ang) * o2) * rad);

      float speed = u_emitSpeed * (0.55 + 0.9 * r.z);
      posSize = vec4(u_emitPos + jdir * (0.06 * r.y), sp.w);
      velAge  = vec4(jdir * speed, 0.0);

      float m = hash01(seed ^ 0x12345678U);
      vec3 c = m < 0.5 ? mix(u_paletteA, u_paletteB, m * 2.0)
                       : mix(u_paletteB, u_paletteC, m * 2.0 - 1.0);
      col  = vec4(c, 1.0);
      meta = vec4(sp.x, sp.y, 1.0, 0.0);
    }
  } else {
    float age = velAge.w + u_dt;
    if(age >= meta.x){
      meta.z = 0.0;          // lifetime over -> slot returns to the free pool
      velAge.w = age;
    } else {
      vec3 p = posSize.xyz;
      vec3 v = velAge.xyz;
      v += (u_gravity + flowField(p * 0.6, u_time) * u_turbulence) * u_dt;
      v *= exp(-u_drag * u_dt);
      p += v * u_dt;
      posSize.xyz = p;
      velAge = vec4(v, age);
    }
  }

  v_posSize = posSize;
  v_velAge  = velAge;
  v_color   = col;
  v_meta    = meta;
}
`;

const UPDATE_FS = `#version 300 es
precision mediump float;
out vec4 o;
void main(){ o = vec4(0.0); }
`;

const RENDER_VS = `#version 300 es
precision highp float;

layout(location=0) in vec4 a_posSize;
layout(location=1) in vec4 a_velAge;
layout(location=2) in vec4 a_color;
layout(location=3) in vec4 a_meta;

uniform mat4  u_proj;
uniform mat4  u_view;
uniform float u_pointScale; // proj[1][1] * viewportHeight * 0.5

out vec4 v_color;

void main(){
  if(a_meta.z < 0.5){
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // clipped away
    gl_PointSize = 0.0;
    v_color = vec4(0.0);
    return;
  }
  vec4 vp = u_view * vec4(a_posSize.xyz, 1.0);
  gl_Position = u_proj * vp;

  float dist = max(length(vp.xyz), 1e-4);
  // Perspective size attenuation, clamped so nearby sprites never fill the screen.
  float px = a_posSize.w * u_pointScale / dist;
  gl_PointSize = clamp(px, 0.0, 72.0);

  float ageN = clamp(a_velAge.w / max(a_meta.x, 1e-4), 0.0, 1.0);
  float lifeFade = smoothstep(0.0, 0.10, ageN) * (1.0 - smoothstep(0.72, 1.0, ageN));
  // Fade sprites the camera is passing through (fly-through safety).
  float nearFade = smoothstep(0.12, 1.4, dist);

  v_color = vec4(a_color.rgb, a_color.a * lifeFade * nearFade);
}
`;

const RENDER_FS = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 o_color;
void main(){
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float d = dot(uv, uv);
  if(d > 1.0) discard;
  float core = exp(-d * 4.0);
  float a = core * v_color.a;
  // Premultiplied additive output: blending is ONE/ONE, so draw order
  // never matters and no depth sorting of translucent sprites is needed.
  o_color = vec4(v_color.rgb * a, 1.0);
}
`;
