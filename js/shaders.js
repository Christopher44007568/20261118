// ANISO/LAB — 各向异性 GGX(单镜面瓣) + 物体锁定切线场
const VERT_SRC = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG_SRC = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2  uRes;
uniform float uTime;
uniform float uRough;      // 基础粗糙度
uniform float uAniso;      // 各向异性 0..0.9
uniform float uRoll;       // 样品滚转(度),切线随物体
uniform float uAzimuth;    // 光源方位角(度)
uniform bool  uSingleLobe; // 单镜面瓣锁定:各向异性项替代普通粗糙度瓣
uniform bool  uDebugTangent;

const vec3 CAM_POS = vec3(0.0, 0.35, 5.8);
const vec3 LIGHT_COLOR = vec3(1.0, 0.86, 0.66) * 8.0;
const vec3 F0 = vec3(0.62, 0.60, 0.57);   // 钢基底

struct Sphere { vec3 c; float r; float axis; }; // axis: 0=水平拉丝 T≈X, 1=垂直拉丝 T≈Y

mat3 rotZ(float deg){
  float s = sin(radians(deg)), c = cos(radians(deg));
  return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0);
}

float hitSphere(vec3 ro, vec3 rd, vec3 c, float r){
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float h = b*b - (dot(oc,oc) - r*r);
  if(h < 0.0) return -1.0;
  float t = -b - sqrt(h);
  return t > 0.0 ? t : -1.0;
}

// 各向异性 GGX (Heitz): αT 沿切线拉伸,αB 垂直切线收紧
float D_aniso(vec3 h, vec3 n, vec3 t, vec3 b, float at, float ab){
  float th = dot(h,t)/at, bh = dot(h,b)/ab, nh = dot(h,n);
  float d = th*th + bh*bh + nh*nh;
  return 1.0 / (3.14159265 * at * ab * d * d);
}
float D_iso(vec3 h, vec3 n, float a){
  float nh = dot(h,n);
  float d = nh*nh*(a*a - 1.0) + 1.0;
  return a*a / (3.14159265 * d * d);
}
float lambdaSmith(vec3 v, vec3 n, vec3 t, vec3 b, float at, float ab){
  float vt = dot(v,t)*at, vb = dot(v,b)*ab, vn = dot(v,n);
  return 0.5 * (-1.0 + sqrt(1.0 + (vt*vt + vb*vb) / max(vn*vn, 1e-7)));
}

// 拉丝纹理:沿切线 T 的沟槽,相位沿 B 变化 → 只调制 αT,不产生冲突斑块
float brushNoise(vec3 pObj, float axis){
  float coord = axis < 0.5 ? pObj.y : pObj.x;   // 垂直于拉丝方向
  float s = sin(coord*140.0)*0.5 + sin(coord*57.0+1.7)*0.35 + sin(coord*233.0+4.1)*0.15;
  return 1.0 + 0.10*s;
}

vec3 shade(vec3 P, vec3 N, vec3 V, vec3 L, vec3 T, vec3 B, float at, float ab, float alpha){
  vec3 H = normalize(V + L);
  float NoL = max(dot(N,L), 0.0);
  float NoV = max(dot(N,V), 1e-4);
  if(NoL <= 0.0) return vec3(0.0);
  float D = D_aniso(H, N, T, B, at, ab);
  if(!uSingleLobe){
    // 对照组:额外叠加普通各向同性粗糙度瓣 → 同一区域出现方向冲突的斑块
    D += D_iso(H, N, alpha) * 0.6;
  }
  float G2 = 1.0 / (1.0 + lambdaSmith(V,N,T,B,at,ab) + lambdaSmith(L,N,T,B,at,ab));
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - max(dot(H,V),0.0), 5.0);
  vec3 spec = D * G2 * F / (4.0 * NoV);
  return spec * LIGHT_COLOR * NoL;
}

vec3 envFill(vec3 N, vec3 V){
  // 微弱环境填充,仅勾出轮廓,不引入第二高光瓣
  float rim = pow(1.0 - max(dot(N,V),0.0), 3.0);
  float hemi = 0.5 + 0.5*N.y;
  return F0 * (0.015*hemi + 0.10*rim);
}

void main(){
  vec2 uv = (2.0*gl_FragCoord.xy - uRes) / uRes.y;
  vec3 ro = CAM_POS;
  vec3 rd = normalize(vec3(uv, 0.0) - vec3(0.0, 0.0, 3.2));

  Sphere spheres[2];
  spheres[0] = Sphere(vec3(-1.18, 0.0, 0.0), 1.0, 0.0);
  spheres[1] = Sphere(vec3( 1.18, 0.0, 0.0), 1.0, 1.0);

  // 光源:固定相机,光源绕 Y 轴轨道旋转
  float az = radians(uAzimuth);
  vec3 Lpos = vec3(sin(az)*3.6, 2.6, cos(az)*3.6);

  float bestT = 1e9; int bestI = -1;
  for(int i=0;i<2;i++){
    float t = hitSphere(ro, rd, spheres[i].c, spheres[i].r);
    if(t > 0.0 && t < bestT){ bestT = t; bestI = i; }
  }

  vec3 col;
  if(bestI < 0){
    // 背景:暗色渐变 + 微弱同心环(舞台参考线)
    float r = length(uv);
    col = mix(vec3(0.020,0.026,0.034), vec3(0.008,0.010,0.014), smoothstep(0.2,1.6,r));
    float ring = smoothstep(0.012,0.0,abs(fract(r*2.2)-0.5)/2.2 - 0.004) * 0.05;
    col += vec3(0.10,0.085,0.06) * ring * smoothstep(1.6,0.6,r);
    // 光源辉光标记
    vec3 ldir = normalize(Lpos - ro);
    float g = pow(max(dot(ldir, rd),0.0), 900.0);
    col += LIGHT_COLOR * g * 0.05;
  } else {
    Sphere s = spheres[bestI];
    vec3 P = ro + rd*bestT;
    vec3 N = normalize(P - s.c);
    vec3 V = normalize(ro - P);
    vec3 L = normalize(Lpos - P);

    // 物体锁定切线:滚转矩阵作用于物体空间切线,再对法线正交化
    mat3 R = rotZ(uRoll);
    vec3 Tobj = s.axis < 0.5 ? vec3(1,0,0) : vec3(0,1,0);
    vec3 Tw = R * Tobj;
    vec3 T = normalize(Tw - N*dot(N,Tw));
    vec3 B = normalize(cross(N, T));

    if(uDebugTangent){
      col = T*0.5 + 0.5;   // 世界空间切线 → RGB 调试色
    } else {
      float alpha = max(uRough*uRough, 1e-3);
      float at = max(alpha*(1.0+uAniso), 1e-3);
      float ab = max(alpha*(1.0-uAniso), 1e-3);
      // 拉丝沟槽只调制切向粗糙度,保持单瓣一致性
      vec3 pObj = (P - s.c);
      at *= brushNoise(pObj, s.axis);
      col = shade(P, N, V, L, T, B, at, ab, alpha) + envFill(N, V);
    }
  }

  // 简单色调映射 + 暗角
  col = col / (col + 1.0);
  col = pow(col, vec3(1.0/2.2));
  float vig = 1.0 - 0.18*dot(uv*0.55, uv*0.55);
  outColor = vec4(col*vig, 1.0);
}
`;
