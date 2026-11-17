import * as THREE from 'three';

// 反光球材质：按权重混合最多 4 个探针 cubemap。
// 每个探针带曝光值 expo（平均亮度），先在各自曝光归一的空间混合，
// 再乘回加权曝光 —— 不同曝光的探针之间插值不会出现亮度断层。
export function createProbeSphereMaterial(tint) {
  const uniforms = {
    cube0: { value: null },
    cube1: { value: null },
    cube2: { value: null },
    cube3: { value: null },
    weights: { value: new THREE.Vector4(1, 0, 0, 0) },
    expos: { value: new THREE.Vector4(1, 1, 1, 1) },
    tint: { value: new THREE.Color(tint) },
  };

  const vertexShader = /* glsl */ `
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  const fragmentShader = /* glsl */ `
    uniform samplerCube cube0;
    uniform samplerCube cube1;
    uniform samplerCube cube2;
    uniform samplerCube cube3;
    uniform vec4 weights;
    uniform vec4 expos;
    uniform vec3 tint;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;

    void main() {
      vec3 V = normalize(vWorldPos - cameraPosition);
      vec3 R = reflect(V, normalize(vWorldNormal));
      vec3 c0 = textureCube(cube0, R).rgb;
      vec3 c1 = textureCube(cube1, R).rgb;
      vec3 c2 = textureCube(cube2, R).rgb;
      vec3 c3 = textureCube(cube3, R).rgb;
      // 曝光归一化混合：sum(w_i * c_i / e_i) * sum(w_i * e_i)
      vec3 nrm =
        weights.x * c0 / expos.x +
        weights.y * c1 / expos.y +
        weights.z * c2 / expos.z +
        weights.w * c3 / expos.w;
      float e = dot(weights, expos);
      vec3 color = nrm * e * tint;
      gl_FragColor = vec4(pow(max(color, 0.0), vec3(1.0 / 2.2)), 1.0);
    }
  `;

  return new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
}

// 把一组 (探针索引, 权重) 写入材质 uniform
export function setMaterialProbes(material, probes, indices, weights) {
  const w = material.uniforms.weights.value;
  const e = material.uniforms.expos.value;
  const cubes = [
    material.uniforms.cube0,
    material.uniforms.cube1,
    material.uniforms.cube2,
    material.uniforms.cube3,
  ];
  for (let k = 0; k < 4; k++) {
    const probe = probes[indices[k]];
    cubes[k].value = probe ? probe.texture : null;
    w.setComponent(k, probe ? weights[k] : 0);
    e.setComponent(k, probe ? probe.exposure : 1);
  }
}
