import * as THREE from 'three';
import { NOISE_GLSL } from './uniforms';

export interface PostParams {
  radial: number; // 0..1 speed blur strength
  whiteout: number; // 0..1 inside cloud
  whiteColor: THREE.Color;
  fade: number; // 0..1 fade to fadeColor
  fadeColor: THREE.Color;
  exposure: number;
  saturation: number;
  tint: THREE.Color;
  vignette: number;
  outline: number;
  bloom: number;
}

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** HDR scene target → outline/bloom/radial blur/grade composite. */
export class PostPipeline {
  readonly renderer: THREE.WebGLRenderer;
  private sceneRT: THREE.WebGLRenderTarget;
  private bloomA: THREE.WebGLRenderTarget;
  private bloomB: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private brightMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;
  bloomEnabled = true;
  radialSamples = 6;
  params: PostParams = {
    radial: 0,
    whiteout: 0,
    whiteColor: new THREE.Color(1, 1, 1),
    fade: 0,
    fadeColor: new THREE.Color(0, 0, 0),
    exposure: 1,
    saturation: 1,
    tint: new THREE.Color(1, 1, 1),
    vignette: 0.35,
    outline: 1,
    bloom: 0.35,
  };

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    const depth = new THREE.DepthTexture(4, 4);
    depth.type = THREE.UnsignedIntType;
    this.sceneRT = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      depthTexture: depth,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.bloomA = new THREE.WebGLRenderTarget(4, 4, opts);
    this.bloomB = new THREE.WebGLRenderTarget(4, 4, opts);

    this.brightMat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, uThreshold: { value: 1.0 } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform float uThreshold; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tColor, vUv).rgb;
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold * 1.8, l), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform vec2 uDir; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tColor, vUv).rgb * 0.227027;
          c += texture2D(tColor, vUv + uDir * 1.3846).rgb * 0.316216;
          c += texture2D(tColor, vUv - uDir * 1.3846).rgb * 0.316216;
          c += texture2D(tColor, vUv + uDir * 3.2308).rgb * 0.070270;
          c += texture2D(tColor, vUv - uDir * 3.2308).rgb * 0.070270;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.sceneRT.texture },
        tDepth: { value: depth },
        tBloom: { value: this.bloomB.texture },
        uRes: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.5 },
        uFar: { value: 30000 },
        uRadial: { value: 0 },
        uWhiteout: { value: 0 },
        uWhiteColor: { value: new THREE.Color(1, 1, 1) },
        uFade: { value: 0 },
        uFadeColor: { value: new THREE.Color() },
        uExposure: { value: 1 },
        uSaturation: { value: 1 },
        uTint: { value: new THREE.Color(1, 1, 1) },
        uVignette: { value: 0.35 },
        uOutline: { value: 1 },
        uBloom: { value: 0.35 },
        uTime: { value: 0 },
      },
      vertexShader: FS_VERT,
      fragmentShader: '',
      depthTest: false,
      depthWrite: false,
    });
    this.setRadialSamples(6);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setRadialSamples(n: number): void {
    this.radialSamples = n;
    this.compMat.fragmentShader = compositeFrag(n, this.bloomEnabled);
    this.compMat.needsUpdate = true;
  }

  setBloom(on: boolean): void {
    this.bloomEnabled = on;
    this.setRadialSamples(this.radialSamples);
  }

  setSize(w: number, h: number, pr: number): void {
    const W = Math.max(1, Math.floor(w * pr));
    const H = Math.max(1, Math.floor(h * pr));
    this.sceneRT.setSize(W, H);
    this.bloomA.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2));
    this.bloomB.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2));
    (this.compMat.uniforms.uRes.value as THREE.Vector2).set(W, H);
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number): void {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    if (this.bloomEnabled) {
      this.brightMat.uniforms.tColor.value = this.sceneRT.texture;
      this.pass(this.brightMat, this.bloomA);
      const w = this.bloomA.width, h = this.bloomA.height;
      this.blurMat.uniforms.tColor.value = this.bloomA.texture;
      (this.blurMat.uniforms.uDir.value as THREE.Vector2).set(1.5 / w, 0);
      this.pass(this.blurMat, this.bloomB);
      this.blurMat.uniforms.tColor.value = this.bloomB.texture;
      (this.blurMat.uniforms.uDir.value as THREE.Vector2).set(0, 1.5 / h);
      this.pass(this.blurMat, this.bloomA);
      this.blurMat.uniforms.tColor.value = this.bloomA.texture;
      (this.blurMat.uniforms.uDir.value as THREE.Vector2).set(3 / w, 0);
      this.pass(this.blurMat, this.bloomB);
      this.blurMat.uniforms.tColor.value = this.bloomB.texture;
      (this.blurMat.uniforms.uDir.value as THREE.Vector2).set(0, 3 / h);
      this.pass(this.blurMat, this.bloomA);
      this.compMat.uniforms.tBloom.value = this.bloomA.texture;
    }

    const u = this.compMat.uniforms;
    const p = this.params;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uRadial.value = p.radial;
    u.uWhiteout.value = p.whiteout;
    (u.uWhiteColor.value as THREE.Color).copy(p.whiteColor);
    u.uFade.value = p.fade;
    (u.uFadeColor.value as THREE.Color).copy(p.fadeColor);
    u.uExposure.value = p.exposure;
    u.uSaturation.value = p.saturation;
    (u.uTint.value as THREE.Color).copy(p.tint);
    u.uVignette.value = p.vignette;
    u.uOutline.value = p.outline;
    u.uBloom.value = p.bloom;
    u.uTime.value = time;
    this.pass(this.compMat, null);
  }
}

function compositeFrag(radialSamples: number, bloom: boolean): string {
  return /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform vec2 uRes;
uniform float uNear, uFar, uRadial, uWhiteout, uFade, uExposure, uSaturation, uVignette, uOutline, uBloom, uTime;
uniform vec3 uWhiteColor, uFadeColor, uTint;
varying vec2 vUv;
${NOISE_GLSL}
float invDepth(float d) {
  float z = d * 2.0 - 1.0;
  float lin = (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  return 1.0 / lin;
}
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main() {
  vec2 px = 1.0 / uRes;
  vec3 col = texture2D(tColor, vUv).rgb;
  ${radialSamples > 0 ? `
  if (uRadial > 0.001) {
    vec2 dir = (vUv - 0.5);
    float m = smoothstep(0.08, 0.6, length(dir));
    vec3 acc = col;
    for (int i = 1; i <= ${radialSamples}; i++) {
      float t = float(i) / float(${radialSamples});
      acc += texture2D(tColor, vUv - dir * t * uRadial * 0.09 * m).rgb;
    }
    col = acc / float(${radialSamples + 1});
  }` : ''}

  // Screen-space ink outline from depth Laplacian (planes have zero Laplacian in 1/z).
  float dc = texture2D(tDepth, vUv).r;
  if (dc < 0.99999 && uOutline > 0.0) {
    float w = 1.25;
    float d1 = texture2D(tDepth, vUv + vec2(px.x * w, 0.0)).r;
    float d2 = texture2D(tDepth, vUv - vec2(px.x * w, 0.0)).r;
    float d3 = texture2D(tDepth, vUv + vec2(0.0, px.y * w)).r;
    float d4 = texture2D(tDepth, vUv - vec2(0.0, px.y * w)).r;
    float wc = invDepth(dc);
    float lap = abs(invDepth(d1) + invDepth(d2) + invDepth(d3) + invDepth(d4) - 4.0 * wc) / wc;
    float sil = max(max(wc - invDepth(d1), wc - invDepth(d2)), max(wc - invDepth(d3), wc - invDepth(d4))) / wc;
    float e = max(smoothstep(0.012, 0.05, lap), smoothstep(0.08, 0.3, sil));
    float dist = 1.0 / wc;
    e *= 1.0 - smoothstep(250.0, 2200.0, dist);
    vec3 ink = col * vec3(0.32, 0.3, 0.38);
    col = mix(col, ink, e * 0.8 * uOutline);
  }

  ${bloom ? 'col += texture2D(tBloom, vUv).rgb * uBloom;' : ''}

  col = mix(col, uWhiteColor * 1.05, uWhiteout);
  col *= uExposure * uTint;
  col = aces(col * 1.05);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSaturation);
  // Watercolor: lifted pastel shadows + paper grain.
  col = mix(col, vec3(0.97, 0.95, 0.92), 0.035);
  vec2 sp = vUv * uRes / 2.0;
  float paper = fbm2(vUv * vec2(uRes.x / uRes.y, 1.0) * 9.0) - 0.5;
  float grain = hash12(floor(sp) + floor(uTime * 12.0)) - 0.5;
  col *= 1.0 + paper * 0.045 + grain * 0.018;
  vec2 vc = vUv - 0.5;
  float vig = 1.0 - dot(vc, vc) * uVignette * 2.2;
  col *= clamp(vig, 0.0, 1.0);
  col = mix(col, uFadeColor, uFade);
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}`;
}
