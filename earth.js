// 3D Earth - pure WebGL (no Three.js)
// 공개 자료: NASA Blue Marble / Black Marble / 고도(topology) 영상 (three-globe 예제 이미지, jsDelivr CDN)
const IMG_BASE = "https://cdn.jsdelivr.net/npm/three-globe@2.31.0/example/img/";
const LON_SEG = 360, LAT_SEG = 180;          // 1° 간격 위/경도 격자 -> 361*181 = 65,341 정점 (Uint16 인덱스 한도 내)
const EVEREST_RATIO = 8848 / 6371000;        // 최고 고도 / 지구 반지름
const AXIAL_TILT = 23.44 * Math.PI / 180;

// ---------- 행렬 유틸 (column-major, WebGL 규약) ----------
const mat4 = {
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  },
  perspective(fovy, aspect, n, f) {
    const t = 1 / Math.tan(fovy / 2);
    return new Float32Array([t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]);
  },
  translate(x, y, z) { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]); },
  rotX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
  rotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
  rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
};

// ---------- 셰이더 ----------
const VS = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec2 aUV;
uniform mat4 uProj, uMV;
varying vec3 vN, vS, vP;
varying vec2 vUV;
void main() {
  vec4 p = uMV * vec4(aPos, 1.0);
  vP  = p.xyz;
  vN  = (uMV * vec4(aNormal, 0.0)).xyz;          // 지형 법선 (조명용)
  vS  = (uMV * vec4(normalize(aPos), 0.0)).xyz;  // 구 법선 (낮/밤 경계용)
  vUV = aUV;
  gl_Position = uProj * p;
}`;

const FS = `
precision mediump float;
uniform sampler2D uDay, uNight, uTopo;
uniform vec3 uLight;      // view space 태양 방향
uniform vec3 uLightAmbient, uLightDiffuse, uLightSpecular;  // 광원 속성
uniform float uShininess;                                    // 물질 반짝임 계수
uniform int uMode;        // 0: 위성 영상, 1: 고도 색상
uniform bool uNightOn;
varying vec3 vN, vS, vP;
varying vec2 vUV;

vec3 hypso(float h) {
  if (h < 0.01) return vec3(0.05, 0.18, 0.45);
  vec3 c = mix(vec3(0.15, 0.45, 0.15), vec3(0.55, 0.45, 0.25), smoothstep(0.0, 0.35, h));
  c = mix(c, vec3(0.45, 0.35, 0.3), smoothstep(0.35, 0.6, h));
  return mix(c, vec3(1.0), smoothstep(0.6, 0.9, h));
}

void main() {
  float h = texture2D(uTopo, vUV).r;
  vec3 base = uMode == 0 ? texture2D(uDay, vUV).rgb : hypso(h);
  vec3 N = normalize(vN), L = normalize(uLight), E = normalize(-vP);
  vec3 H = normalize(L + E);                                   // 중간 벡터 (수정 Phong)

  // 물질: ka = kd = 지표 색상, ks = 바다에서만 0.6
  vec3 ks = vec3(0.6 * (1.0 - step(0.01, h)));
  float day = smoothstep(-0.1, 0.15, dot(normalize(vS), L));   // 부드러운 터미네이터

  vec3 ambient = uLightAmbient * base;
  float Kd = max(dot(L, N), 0.0);
  vec3 diffuse = Kd * uLightDiffuse * base;
  float Ks = pow(max(dot(N, H), 0.0), uShininess);
  if (dot(L, N) < 0.0) Ks = 0.0;
  vec3 specular = Ks * uLightSpecular * ks;

  vec3 color = ambient + (diffuse + specular) * day;
  if (uNightOn) color += texture2D(uNight, vUV).rgb * (1.0 - day) * 0.9;
  gl_FragColor = vec4(color, 1.0);
}`;

// ---------- WebGL 초기화 ----------
const canvas = document.getElementById("glcanvas");
const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true });
const $ = (id) => document.getElementById(id);
if (!gl) throw $("status").textContent = "WebGL 미지원 브라우저";

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);
const loc = (n) => gl.getUniformLocation(prog, n);
const U = { proj: loc("uProj"), mv: loc("uMV"), light: loc("uLight"), shininess: loc("uShininess"),
  mode: loc("uMode"), nightOn: loc("uNightOn") };
gl.uniform3fv(loc("uLightDiffuse"), [1, 1, 1]);
gl.uniform3fv(loc("uLightSpecular"), [1, 1, 1]);

// ---------- 위/경도 격자 생성 ----------
// 정점 (i: 경도 인덱스, j: 위도 인덱스). 경도 360° 지점은 텍스처 이음매를 위해 중복 정점.
const VCOUNT = (LON_SEG + 1) * (LAT_SEG + 1);
const uvs = new Float32Array(VCOUNT * 2);
const unit = new Float32Array(VCOUNT * 3);  // 단위 구 위의 방향
for (let j = 0; j <= LAT_SEG; j++) {
  const lat = Math.PI / 2 - j * Math.PI / LAT_SEG;          // +90° (북극) -> -90° (남극)
  for (let i = 0; i <= LON_SEG; i++) {
    const lon = -Math.PI + i * 2 * Math.PI / LON_SEG;       // -180° -> +180°
    const k = j * (LON_SEG + 1) + i;
    unit[k * 3]     = Math.cos(lat) * Math.sin(lon);
    unit[k * 3 + 1] = Math.sin(lat);
    unit[k * 3 + 2] = Math.cos(lat) * Math.cos(lon);
    uvs[k * 2] = i / LON_SEG;                                // 등장방형(equirectangular) 매핑
    uvs[k * 2 + 1] = j / LAT_SEG;
  }
}
const indices = new Uint16Array(LON_SEG * LAT_SEG * 6);
for (let j = 0, n = 0; j < LAT_SEG; j++) for (let i = 0; i < LON_SEG; i++) {
  const a = j * (LON_SEG + 1) + i, b = a + LON_SEG + 1;
  indices.set([a, b, a + 1, a + 1, b, b + 1], n); n += 6;
}
$("grid").textContent = `${LON_SEG} × ${LAT_SEG} (1° 간격)`;
$("counts").textContent = `${VCOUNT.toLocaleString()} / ${(indices.length / 3).toLocaleString()}`;

function makeBuffer(data, attr, size) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const l = gl.getAttribLocation(prog, attr);
  gl.enableVertexAttribArray(l);
  gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0);
  return buf;
}
makeBuffer(uvs, "aUV", 2);
const posBuf = makeBuffer(new Float32Array(VCOUNT * 3), "aPos", 3);
const nrmBuf = makeBuffer(new Float32Array(VCOUNT * 3), "aNormal", 3);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

// ---------- 고도 샘플링 & 변위 ----------
let heights = new Float32Array(VCOUNT);  // 0~1 정규화 고도 (자료 로딩 전에는 0 = 매끈한 구)

// 위/경도(도) -> 고도맵 픽셀에서 정규화 고도 읽기
function sampleHeight(img, latDeg, lonDeg) {
  const x = Math.min(img.width - 1, Math.floor((lonDeg + 180) / 360 * img.width));
  const y = Math.min(img.height - 1, Math.floor((90 - latDeg) / 180 * img.height));
  return img.data[(y * img.width + x) * 4] / 255;
}

function buildTerrain() {
  const exag = +$("exag").value;
  const pos = new Float32Array(VCOUNT * 3), nrm = new Float32Array(VCOUNT * 3);
  for (let k = 0; k < VCOUNT; k++) {
    const r = 1 + heights[k] * EVEREST_RATIO * exag;        // 반지름 방향 변위
    for (let c = 0; c < 3; c++) pos[k * 3 + c] = unit[k * 3 + c] * r;
  }
  // 법선: 격자 이웃(중심 차분)의 접선 벡터 외적. 경도는 순환, 위도는 경계에서 clamp.
  const P = (i, j) => (j * (LON_SEG + 1) + i) * 3;
  for (let j = 0; j <= LAT_SEG; j++) for (let i = 0; i <= LON_SEG; i++) {
    const k = P(i, j);
    const e = P(i === LON_SEG ? 1 : i + 1, j), w = P(i === 0 ? LON_SEG - 1 : i - 1, j);
    const s = P(i, Math.min(j + 1, LAT_SEG)), n = P(i, Math.max(j - 1, 0));
    const tx = [pos[e] - pos[w], pos[e + 1] - pos[w + 1], pos[e + 2] - pos[w + 2]];
    const ty = [pos[n] - pos[s], pos[n + 1] - pos[s + 1], pos[n + 2] - pos[s + 2]];
    let nx = tx[1] * ty[2] - tx[2] * ty[1], ny = tx[2] * ty[0] - tx[0] * ty[2], nz = tx[0] * ty[1] - tx[1] * ty[0];
    let len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) { nx = unit[k]; ny = unit[k + 1]; nz = unit[k + 2]; len = 1; }  // 극점: 동서 접선이 0
    nrm[k] = nx / len; nrm[k + 1] = ny / len; nrm[k + 2] = nz / len;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf); gl.bufferData(gl.ARRAY_BUFFER, nrm, gl.STATIC_DRAW);
}
buildTerrain();

// ---------- 텍스처 ----------
function loadImage(name) {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.crossOrigin = "anonymous";  // getImageData / 텍스처 업로드를 위해 CORS 필요
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error(name));
    img.src = IMG_BASE + name;
  });
}
function makeTexture(img, unitIdx, uniform) {
  gl.activeTexture(gl.TEXTURE0 + unitIdx);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
  // NPOT 텍스처 (WebGL1): mipmap 불가, CLAMP 필수
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(loc(uniform), unitIdx);
}
let ready = false;
Promise.all(["earth-blue-marble.jpg", "earth-night.jpg", "earth-topology.png"].map(loadImage)).then(([day, night, topo]) => {
  makeTexture(day, 0, "uDay");
  makeTexture(night, 1, "uNight");
  makeTexture(topo, 2, "uTopo");
  // 고도맵 픽셀을 CPU로 읽어 각 격자점의 위/경도로 고도 샘플링
  const c = document.createElement("canvas");
  c.width = topo.width; c.height = topo.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(topo, 0, 0);
  const data = { width: c.width, height: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
  for (let j = 0; j <= LAT_SEG; j++) for (let i = 0; i <= LON_SEG; i++)
    heights[j * (LON_SEG + 1) + i] = sampleHeight(data, 90 - j, -180 + i);
  // self-check: 에베레스트(27.99N, 86.93E)는 높고, 태평양(0N, -150E)은 0이어야 함
  console.assert(sampleHeight(data, 27.99, 86.93) > 0.5 && sampleHeight(data, 0, -150) === 0, "고도 샘플링 좌표 오류");
  buildTerrain();
  ready = true;
  $("status").textContent = `완료 (고도맵 ${topo.width}×${topo.height})`;
}).catch((e) => { $("status").textContent = "텍스처 로딩 실패: " + e.message; });

// ---------- UI ----------
// URL 쿼리로 컨트롤 초기값 지정 가능 (예: ?exag=60&sunAngle=90&spinSpeed=0) - 보고서 캡처용
for (const [k, v] of new URLSearchParams(location.search)) {
  const el = $(k);
  if (el) el.type === "checkbox" ? (el.checked = v === "1") : (el.value = v);
}
for (const id of ["spinSpeed", "sunAngle", "exag", "ambient", "shininess", "spin"]) {
  const show = () => ($(id + "Value").textContent = $(id).value);
  $(id).addEventListener("input", show); show();
}
$("exag").addEventListener("input", buildTerrain);
if ($("exag").value !== "30") buildTerrain();

// 마우스 드래그: 카메라 회전, 휠: 줌
let yaw = 0, pitch = 0.3, dist = 3.2, drag = null;
canvas.addEventListener("pointerdown", (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointerup", () => (drag = null));
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  yaw += (e.clientX - drag[0]) * 0.01;
  pitch = Math.max(-1.5, Math.min(1.5, pitch + (e.clientY - drag[1]) * 0.01));
  drag = [e.clientX, e.clientY];
});
canvas.addEventListener("wheel", (e) => { e.preventDefault(); dist = Math.max(1.5, Math.min(8, dist * (1 + e.deltaY * 0.001))); }, { passive: false });

// ---------- 렌더 루프 ----------
gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);
gl.clearColor(0, 0, 0, 1);
let spinAngle = 0, last = performance.now(), frames = 0, fpsT = last;

function frame(now) {
  const dt = (now - last) / 1000; last = now;
  spinAngle += +$("spinSpeed").value * dt * Math.PI / 180;      // 자전
  if ($("sunAuto").checked) {                                    // 공전 (태양 방향 이동)
    $("sunAngle").value = (+$("sunAngle").value + dt * 20) % 360;
    $("sunAngleValue").textContent = Math.round($("sunAngle").value);
  }

  const proj = mat4.perspective(Math.PI / 4, canvas.width / canvas.height, 0.1, 100);
  const view = mat4.mul(mat4.translate(0, 0, -dist), mat4.mul(mat4.rotX(pitch), mat4.rotY(yaw)));
  // 모델: 자전축 23.44° 기울임 * 자전(y축)
  const model = mat4.mul(mat4.rotZ(AXIAL_TILT), mat4.rotY(spinAngle + +$("spin").value * Math.PI / 180));
  const mv = mat4.mul(view, model);

  // 태양: 월드 공간 xz 평면에서 공전 각도만큼 회전 -> view 공간으로 변환
  const a = +$("sunAngle").value * Math.PI / 180;
  const L = [Math.sin(a), 0, Math.cos(a)];
  const Lv = [0, 1, 2].map((r) => view[r] * L[0] + view[4 + r] * L[1] + view[8 + r] * L[2]);

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniformMatrix4fv(U.proj, false, proj);
  gl.uniformMatrix4fv(U.mv, false, mv);
  gl.uniform3fv(U.light, Lv);
  const amb = +$("ambient").value;
  gl.uniform3fv(loc("uLightAmbient"), [amb, amb, amb]);
  gl.uniform1f(U.shininess, +$("shininess").value);
  gl.uniform1i(U.mode, ready ? +$("mode").value : 1);   // 위성 텍스처 로딩 전에는 고도 색상
  gl.uniform1i(U.nightOn, ready && $("nightLights").checked);
  gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);

  if (++frames, now - fpsT > 500) { $("fps").textContent = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
