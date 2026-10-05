import * as THREE from 'three';

// Общие юниформы: меняются слайдерами сразу у всех материалов.
export const ps1 = {
  uRes: { value: new THREE.Vector2(320, 240) }, // внутреннее разрешение рендера
  uSnap: { value: 1 },   // размер ячейки "прилипания" вершин в пикселях (0 = выкл)
  uAffine: { value: 1 }, // 0..1 — аффинное (кривое) текстурирование как на PS1
};

/** Превращает обычный материал three.js в «PS1-материал»: дрожание вершин + аффинные текстуры. */
export function patch(material) {
  if (material.userData.ps1) return material;
  material.userData.ps1 = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRes = ps1.uRes;
    shader.uniforms.uSnap = ps1.uSnap;
    shader.uniforms.uAffine = ps1.uAffine;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform vec2 uRes;
        uniform float uSnap;
        varying vec3 vAff;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        if (uSnap > 0.0 && gl_Position.w > 0.0) {
          vec2 g = uRes * 0.5 / uSnap;
          gl_Position.xy = floor(gl_Position.xy / gl_Position.w * g + 0.5) / g * gl_Position.w;
        }
        #ifdef USE_MAP
          vAff = vec3(vMapUv * gl_Position.w, gl_Position.w);
        #else
          vAff = vec3(0.0, 0.0, 1.0);
        #endif`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uAffine;
        varying vec3 vAff;`)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec2 psUv = mix(vMapUv, vAff.xy / vAff.z, uAffine);
          diffuseColor *= texture2D(map, psUv);
        #endif`);
  };
  material.customProgramCacheKey = () => 'ps1';
  return material;
}

export const lambert = (o) => patch(new THREE.MeshLambertMaterial(o));
export const basic = (o) => patch(new THREE.MeshBasicMaterial(o));
