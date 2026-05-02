// gpu_script.js
const canvas = document.getElementById('simCanvas');
const gl = canvas.getContext('webgl2', {antialias: false});
const loading = document.getElementById('loading');

if (!gl) {
  alert(
      'WebGL2 is not supported by your browser. Please switch back to script.js.');
}

gl.getExtension('EXT_color_buffer_float');
gl.getExtension('OES_texture_float_linear');

// --- SIMULATION CONFIGURATION ---
let SPACING = 8;
let FLIP_RATIO = 0.95;
let PRESSURE_ITERS = 30;
let DRAG = 0.96;
let MAX_PARTICLES = 120000;
let customText = 'FLIP\\nFLUID';
let cursorForceMult = 1.0;
let returnPullMultiplier = 4.0;
let cursorRadiusSize = 40;
let yieldRadiusMult = 3.75;
let springDecel = 70;

// -- ADVANCED CONFIG --
let USE_WATERCOLOR = false;
let USE_METABALLS = false;
let METABALL_THRESH = 0.5;
let VORTICITY = 0.0;
let USE_OBSTACLE = false;
let OBS_RADIUS = 80;
let USE_PRESSURE_COLOR = false;

// -- GRAVITY & RESTITUTION --
let gravityMag = 0.0;
let gravityAngle = Math.PI * 0.5;  // default: pointing down (positive screen Y)
let GRAVITY_X = 0.0;
let GRAVITY_Y = 0.0;
let RESTITUTION = 0.5;
let _gravTilt = {x: 0.0, y: -9.81};  // low-pass filtered accelerometer for tilt
let FREE_FLUID = false;

function updateGravityVec() {
  GRAVITY_X = Math.cos(gravityAngle) * gravityMag;
  GRAVITY_Y = Math.sin(gravityAngle) * gravityMag;
}

function drawGravityWheel() {
  const sw = document.getElementById('gravity-wheel');
  if (!sw) return;
  const ctx = sw.getContext('2d');
  const w = sw.width, h = sw.height;
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) / 2 - 3;

  ctx.clearRect(0, 0, w, h);

  // Background disc
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Crosshairs
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();

  if (gravityMag > 0.001) {
    const dx = Math.cos(gravityAngle);
    const dy = Math.sin(gravityAngle);
    const len = r * 0.72;

    // Arrow line
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + dx * len, cy + dy * len);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Arrow head dot
    ctx.beginPath();
    ctx.arc(cx + dx * len, cy + dy * len, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();

    // Center pivot dot
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill();
  } else {
    // Idle center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fill();
  }
}

// -- VISUAL POLISH --
let COLOR_THEME = 'neon';

function getThemeColor(t, py) {
  switch (COLOR_THEME) {
    case 'neon': {
      let r = Math.sin(t * 3.14) * 0.5 + 0.5;
      let g = Math.cos(t * 3.14 + py / height * 2.0) * 0.5 + 0.5;
      let b = Math.sin(t * 3.14 + 1.5) * 0.5 + 0.5;
      r = r * 0.8 + 0.2;
      g = g * 0.8 + 0.2;
      b = b * 0.8 + 0.2;
      if (t < 0.3) {
        r = 0.0;
        g = 1.0;
        b = 1.0;
      } else if (t > 0.7) {
        r = 1.0;
        g = 0.0;
        b = 0.8;
      }
      return [r, g, b];
    }
    case 'pastel': {
      // Mint green -> soft lavender -> warm peach
      let r, g, b;
      if (t < 0.5) {
        const s = t * 2;
        r = 0.55 + s * 0.25;
        g = 0.85 - s * 0.15;
        b = 0.75 + s * 0.15;
      } else {
        const s = (t - 0.5) * 2;
        r = 0.80 + s * 0.15;
        g = 0.70 - s * 0.25;
        b = 0.90 - s * 0.55;
      }
      return [r, g, b];
    }
    case 'mono': {
      // Cool white with subtle warm-cool horizontal shift
      const v = 0.72 + t * 0.28;
      const tint = Math.sin(t * Math.PI) * 0.06;
      return [v + tint, v, v + 0.04 - tint];
    }
    case 'fire': {
      // Deep red -> orange -> bright yellow
      const r = Math.min(1.0, 0.45 + t * 1.1);
      const g = Math.max(0.0, Math.min(1.0, t * 1.6 - 0.1));
      const b = 0.0;
      return [r, g, b];
    }
    default:
      return [1, 1, 1];
  }
}

// -- FLUID PRESETS --
const PRESETS = {
  water: {
    flip: 0.95,
    drag: 0.97,
    vorticity: 0.0,
    return: 4.0,
    decel: 70,
    metaballs: false,
    threshold: 0.5
  },
  honey: {
    flip: 0.30,
    drag: 0.87,
    vorticity: 0.0,
    return: 1.5,
    decel: 200,
    metaballs: true,
    threshold: 0.55
  },
  sand: {
    flip: 1.00,
    drag: 0.83,
    vorticity: 0.0,
    return: 5.0,
    decel: 40,
    metaballs: false,
    threshold: 0.5
  },
  smoke: {
    flip: 0.06,
    drag: 0.99,
    vorticity: 2.8,
    return: 0.4,
    decel: 180,
    metaballs: false,
    threshold: 0.5
  },
};

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;

  FLIP_RATIO = p.flip;
  DRAG = p.drag;
  VORTICITY = p.vorticity;
  returnPullMultiplier = p.return;
  springDecel = p.decel;
  USE_METABALLS = p.metaballs;
  METABALL_THRESH = p.threshold;

  // Sync every affected slider + display span
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };
  const disp = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  set('slider-flip', p.flip);
  disp('val-flip', p.flip.toFixed(2));
  set('slider-drag', p.drag);
  disp('val-drag', p.drag.toFixed(2));
  set('slider-vorticity', p.vorticity);
  disp('val-vorticity', p.vorticity.toFixed(1));
  set('slider-return', p.return);
  disp('val-return', p.return.toFixed(1));
  set('slider-decel', p.decel);
  disp('val-decel', p.decel);
  set('slider-metaball', p.threshold);
  disp('val-metaball', p.threshold.toFixed(2));

  const mbCheck = document.getElementById('check-metaball');
  if (mbCheck) mbCheck.checked = p.metaballs;

  // Highlight the clicked preset and clear others
  document.querySelectorAll('.preset-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.preset === name);
  });
}

// -- THEME SWATCH --
function drawThemeSwatch() {
  const sw = document.getElementById('theme-swatch');
  if (!sw) return;
  const ctx = sw.getContext('2d');
  const w = sw.width;
  const h = sw.height;

  if (USE_PRESSURE_COLOR) {
    // Mirror the pressureRamp() GLSL stops exactly
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0.00, 'rgb(0,51,255)');
    g.addColorStop(0.25, 'rgb(0,230,255)');
    g.addColorStop(0.50, 'rgb(38,255,77)');
    g.addColorStop(0.75, 'rgb(255,217,0)');
    g.addColorStop(1.00, 'rgb(255,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else {
    const midPy = (height || 400) * 0.5;
    const img = ctx.createImageData(w, h);
    for (let x = 0; x < w; x++) {
      const t = x / (w - 1);
      const [r, g, b] = getThemeColor(t, midPy);
      const ri = Math.round(r * 255);
      const gi = Math.round(g * 255);
      const bi = Math.round(b * 255);
      for (let y = 0; y < h; y++) {
        const idx = (y * w + x) * 4;
        img.data[idx] = ri;
        img.data[idx + 1] = gi;
        img.data[idx + 2] = bi;
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
}

// -- FPS HUD --
let _fpsCount = 0;
let _fpsLast = 0;
let _fpsValue = 0;

function updateHUD() {
  const el = document.getElementById('hud-fps');
  const ep = document.getElementById('hud-particles');
  if (el) el.textContent = `${_fpsValue} FPS`;
  if (ep) ep.textContent = `${Math.round(numParticles / 1000)}k particles`;
}

// -- DEMO MODE --
let _demoMode = false;
function toggleDemoMode() {
  _demoMode = !_demoMode;
  document.body.classList.toggle('demo-mode', _demoMode);
  if (_demoMode) document.getElementById('ui-panel').classList.add('hidden');
}

let width, height, pixelRatio;
let pointer = {x: -1000, y: -1000, px: -1000, py: -1000, down: false};
let obstacleNode = {x: -1000, y: -1000, px: -1000, py: -1000, down: false};

// --- MOBILE SHAKE IMPULSE ---
let shake = {vx: 0.0, vy: 0.0, strength: 0.0, lastMs: 0};
const SHAKE_COOLDOWN_MS = 120;
const SHAKE_THRESHOLD_G = 1.35;    // larger = harder shake required
const SHAKE_IMPULSE_SCALE = 18.0;  // overall intensity
const SHAKE_DECAY = 0.88;          // per-frame decay

// --- MOBILE GESTURE STATE ---
// Pinch-to-explode / implode
let _pinch = { active: false, lastDist: 0 };
// Long-press whirlpool — injects a vortex via the vorticity confinement path
let _longPress = { active: false, x: -1000, y: -1000, strength: 0, timerId: null, startX: -1000, startY: -1000 };
// Two-finger shockwave
let _twoFingerSwipe = { active: false, prevMidX: -1000, prevMidY: -1000 };
// Double-tap burst
let _doubleTap = { lastTapMs: 0, lastX: -1000, lastY: -1000 };
// Ripple feedback rings (purely visual, rendered on a 2D overlay canvas)
let _ripples = []; // { x, y, r, maxR, alpha, born }

let particleVAOA, particleVAOB;
let particleBufferA, particleBufferB;
let transformFeedbackA, transformFeedbackB;
let numParticles = 0;
let isBufferA = true;

let updateProgram, renderProgram;

// --- GRID FBOs ---
let gridWidth, gridHeight;
let velocityGridTex, velocityGridFBO;
let prevVelocityGridTex, prevVelocityGridFBO;
let divergenceTex, divergenceFBO;
let curlTex, curlFBO;
let pressurePingTex, pressurePingFBO;
let pressurePongTex, pressurePongFBO;
let densityTex, densityFBO;
let blurTex, blurFBO;

let mgLevels = [];

// --- SHADERS ---

const renderVS = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_vel;
layout(location = 3) in vec3 a_color;

uniform vec2 u_resolution;
uniform bool u_useMetaballs;
uniform bool u_usePressureColor;
uniform sampler2D u_pressureTex;
uniform vec2 u_gridRes;
uniform float u_spacing;

out vec3 v_color;

vec3 pressureRamp(float t) {
    t = clamp(t, 0.0, 1.0);
    if (t < 0.25) return mix(vec3(0.0, 0.2, 1.0), vec3(0.0, 0.9, 1.0), t * 4.0);
    if (t < 0.5)  return mix(vec3(0.0, 0.9, 1.0), vec3(0.15, 1.0, 0.3), (t - 0.25) * 4.0);
    if (t < 0.75) return mix(vec3(0.15, 1.0, 0.3), vec3(1.0, 0.85, 0.0), (t - 0.5) * 4.0);
                  return mix(vec3(1.0, 0.85, 0.0), vec3(1.0, 0.08, 0.0), (t - 0.75) * 4.0);
}

void main() {
    vec2 clipSpace = (a_pos / u_resolution) * 2.0 - 1.0;
    gl_Position = vec4(clipSpace * vec2(1, -1), 0.0, 1.0);
    gl_PointSize = u_useMetaballs ? clamp(a_vel.x*a_vel.x + a_vel.y*a_vel.y, 2.0, 5.0) : 2.0;

    if (u_usePressureColor) {
        vec2 uv = (a_pos / u_spacing) / u_gridRes;
        float p = texture(u_pressureTex, uv).x;
        // tanh compresses any pressure magnitude into -1..1, then remap to 0..1
        v_color = pressureRamp(tanh(p) * 0.5 + 0.5);
    } else {
        v_color = a_color;
    }
}
`;

const renderFS = `#version 300 es
precision mediump float;
in vec3 v_color;
uniform bool u_useMetaballs;

out vec4 outColor;
void main() {
    float w = 1.0;
    float z = 0.0;
    if (u_useMetaballs) {
        vec2 pCoord = gl_PointCoord * 2.0 - 1.0;
        float d2 = dot(pCoord, pCoord);
        if (d2 > 1.0) discard;
        z = sqrt(1.0 - d2);
        w = max(0.0, 1.0 - d2); // Soft brush
    }

    outColor = u_useMetaballs ? vec4(v_color * w, z) : vec4(v_color, 1.0);
}
`;

const blurFS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_densityTex;
uniform vec2 u_resolution;
uniform float u_blurRadius;

out vec4 outColor;

void main() {
    vec4 sum = vec4(0.0);
    float totalWeight = 0.0;
    
    for(int x = -2; x <= 2; x++) {
        for(int y = -2; y <= 2; y++) {
            vec2 offset = vec2(float(x), float(y)) / u_resolution * u_blurRadius * 3.0;
            vec4 sampleCol = texture(u_densityTex, v_uv + offset);
            
            float weight = exp(-(float(x*x + y*y)) / 4.0);
            sum += sampleCol * weight;
            totalWeight += weight;
        }
    }
    outColor = sum / totalWeight;
}
`;

const ssfrFS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_densityTex;
uniform float u_threshold;
uniform vec2 u_resolution;

out vec4 outColor;

void main() {
    vec4 data = texture(u_densityTex, v_uv);
    float thickness = data.a;
    if (thickness < 0.1) discard; // very thin parts are discarded
    
    vec3 color = data.a > 0.0001 ? data.rgb / data.a : data.rgb;
    
    // Normal reconstruction
    vec2 offset = 1.0 / u_resolution;
    float t_dx = texture(u_densityTex, v_uv + vec2(offset.x, 0.0)).a - texture(u_densityTex, v_uv - vec2(offset.x, 0.0)).a;
    float t_dy = texture(u_densityTex, v_uv + vec2(0.0, offset.y)).a - texture(u_densityTex, v_uv - vec2(0.0, offset.y)).a;
    
    // Scale normal Z based on thickness to make it look rounder
    vec3 normal = normalize(vec3(-t_dx, -t_dy, 0.3 + thickness * 0.2));
    
    // Lighting
    vec3 lightDir = normalize(vec3(0.5, 0.8, 1.0));
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 halfVector = normalize(lightDir + viewDir);
    
    float diffuse = max(0.0, dot(normal, lightDir));
    float specular = pow(max(0.0, dot(normal, halfVector)), 64.0);
    float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 3.0);
    
    // Fake refraction by sampling color slightly offset
    vec2 refrUV = v_uv - normal.xy * 0.05 * u_threshold;
    vec4 refrData = texture(u_densityTex, refrUV);
    vec3 refrColor = refrData.a > 0.0001 ? refrData.rgb / refrData.a : color;
    
    vec3 finalColor = mix(color, refrColor, 0.5) * (0.6 + 0.4 * diffuse) + specular * 0.8 + fresnel * 0.4 * vec3(1.0);
    
    outColor = vec4(finalColor, 1.0);
}
`;

const scatterVS = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_vel;
layout(location = 4) in vec4 a_B;

uniform vec2 u_gridRes;
uniform float u_spacing;

out vec2 v_pos;
out vec2 v_vel;
out vec4 v_B;

void main() {
    vec2 gridPos = a_pos / u_spacing;
    vec2 centerPos = floor(gridPos - 0.5) + 1.0;
    vec2 clipSpace = (centerPos / u_gridRes) * 2.0 - 1.0;
    
    gl_Position = vec4(clipSpace, 0.0, 1.0);
    gl_PointSize = 2.0; 
    
    v_pos = gridPos;
    v_vel = a_vel;
    v_B = a_B;
}
`;

const scatterFS = `#version 300 es
precision highp float;
in vec2 v_pos;
in vec2 v_vel;
in vec4 v_B;

out vec4 outColor;

void main() {
    vec2 fragCoord = floor(gl_FragCoord.xy);
    vec2 d = fragCoord + 0.5 - v_pos;
    
    float wx = max(0.0, 1.0 - abs(d.x));
    float wy = max(0.0, 1.0 - abs(d.y));
    float w = wx * wy;
    
    if (w <= 0.0) discard;
    
    // APIC affine momentum transfer
    vec2 affineVel = v_vel + vec2(
        v_B.x * d.x + v_B.y * d.y,
        v_B.z * d.x + v_B.w * d.y
    );
    
    outColor = vec4(affineVel * w, 0.0, w);
}
`;

const normalizeVS = `#version 300 es
const vec2 positions[4] = vec2[](
    vec2(-1.0, -1.0), vec2(1.0, -1.0),
    vec2(-1.0,  1.0), vec2(1.0,  1.0)
);
out vec2 v_uv;
void main() {
    vec2 pos = positions[gl_VertexID];
    gl_Position = vec4(pos, 0.0, 1.0);
    v_uv = pos * 0.5 + 0.5;
}
`;

const normalizeFS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_velocityGrid;
uniform vec2 u_gravity;
uniform bool u_isFreeFluid;

out vec4 outColor;

void main() {
    vec4 data = texture(u_velocityGrid, v_uv);
    float weight = data.a;
    vec2 vel = vec2(0.0);
    if (weight > 0.0001) {
        vel = data.xy / weight;
    }
    
    // Write normalized velocity back to Grid, keeping weight for later or resetting
    outColor = vec4(vel, 0.0, weight);
}
`;

const divergenceFS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_velocityGrid;
uniform float u_spacing;
uniform vec2 u_gridRes;
uniform vec2 u_obsCenter;
uniform float u_obsRadius;
uniform bool u_useObs;

out vec4 outColor;

bool isWall(vec2 uv) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return true;
    if (u_useObs) {
        vec2 p = uv * u_gridRes;
        vec2 c = u_obsCenter / u_spacing;
        float r = u_obsRadius / u_spacing;
        if (dot(p - c, p - c) <= r * r) return true;
    }
    return false;
}

void main() {
    float dx = 1.0 / u_gridRes.x;
    float dy = 1.0 / u_gridRes.y;
    
    // Boundary conditions (solid walls)
    float cx = isWall(v_uv + vec2(dx, 0.0)) ? -texture(u_velocityGrid, v_uv).x : texture(u_velocityGrid, v_uv + vec2(dx, 0.0)).x;
    float cx_m = isWall(v_uv - vec2(dx, 0.0)) ? -texture(u_velocityGrid, v_uv).x : texture(u_velocityGrid, v_uv - vec2(dx, 0.0)).x;
    float cy = isWall(v_uv + vec2(0.0, dy)) ? -texture(u_velocityGrid, v_uv).y : texture(u_velocityGrid, v_uv + vec2(0.0, dy)).y;
    float cy_m = isWall(v_uv - vec2(0.0, dy)) ? -texture(u_velocityGrid, v_uv).y : texture(u_velocityGrid, v_uv - vec2(0.0, dy)).y;

    float div = 0.5 * (cx - cx_m + cy - cy_m); 
    
    outColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

const pressureFS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_pressureGrid;
uniform sampler2D u_divergenceGrid;
uniform vec2 u_gridRes;
uniform vec2 u_obsCenter;
uniform float u_obsRadius;
uniform float u_spacing;
uniform bool u_useObs;

out vec4 outColor;

bool isWall(vec2 uv) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return true;
    if (u_useObs) {
        vec2 p = uv * u_gridRes;
        vec2 c = u_obsCenter / u_spacing;
        float r = u_obsRadius / u_spacing;
        if (dot(p - c, p - c) <= r * r) return true;
    }
    return false;
}

void main() {
    float dx = 1.0 / u_gridRes.x;
    float dy = 1.0 / u_gridRes.y;
    
    // Neuman boundary conditions: gradient is 0 at walls
    float px = isWall(v_uv + vec2(dx, 0.0)) ? texture(u_pressureGrid, v_uv).x : texture(u_pressureGrid, v_uv + vec2(dx, 0.0)).x;
    float px_m = isWall(v_uv - vec2(dx, 0.0)) ? texture(u_pressureGrid, v_uv).x : texture(u_pressureGrid, v_uv - vec2(dx, 0.0)).x;
    float py = isWall(v_uv + vec2(0.0, dy)) ? texture(u_pressureGrid, v_uv).x : texture(u_pressureGrid, v_uv + vec2(0.0, dy)).x;
    float py_m = isWall(v_uv - vec2(0.0, dy)) ? texture(u_pressureGrid, v_uv).x : texture(u_pressureGrid, v_uv - vec2(0.0, dy)).x;

    float div = texture(u_divergenceGrid, v_uv).x;

    float p = (px + px_m + py + py_m - div) * 0.25;
    
    outColor = vec4(p, 0.0, 0.0, 1.0);
}
`;

const gradSubFS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_velocityGrid;
uniform sampler2D u_pressureGrid;
uniform vec2 u_gridRes;
uniform vec2 u_obsCenter;
uniform float u_obsRadius;
uniform float u_spacing;
uniform bool u_useObs;

out vec4 outColor;

bool isWall(vec2 uv) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return true;
    if (u_useObs) {
        vec2 p = uv * u_gridRes;
        vec2 c = u_obsCenter / u_spacing;
        float r = u_obsRadius / u_spacing;
        if (dot(p - c, p - c) <= r * r) return true;
    }
    return false;
}

void main() {
    float dx = 1.0 / u_gridRes.x;
    float dy = 1.0 / u_gridRes.y;
    
    float px = isWall(v_uv + vec2(dx, 0.0)) ? texture(u_pressureGrid, v_uv).x : texture(u_pressureGrid, v_uv + vec2(dx, 0.0)).x;
    float px_m = isWall(v_uv - vec2(dx, 0.0)) ? texture(u_pressureGrid, v_uv).x : texture(u_pressureGrid, v_uv - vec2(dx, 0.0)).x;
    float py = isWall(v_uv + vec2(0.0, dy)) ? texture(u_pressureGrid, v_uv).x : texture(u_pressureGrid, v_uv + vec2(0.0, dy)).x;
    float py_m = isWall(v_uv - vec2(0.0, dy)) ? texture(u_pressureGrid, v_uv).x : texture(u_pressureGrid, v_uv - vec2(0.0, dy)).x;

    vec2 vel = texture(u_velocityGrid, v_uv).xy;
    
    vel.x -= 0.5 * (px - px_m);
    vel.y -= 0.5 * (py - py_m);
    
    outColor = vec4(vel, 0.0, 1.0);
}
`;

const restrictionFS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_pressureFine;
uniform sampler2D u_divergenceFine;
uniform vec2 u_fineRes;
out vec4 outColor;
void main() {
    float dx = 1.0 / u_fineRes.x;
    float dy = 1.0 / u_fineRes.y;
    float p0 = texture(u_pressureFine, v_uv).x;
    float px = texture(u_pressureFine, v_uv + vec2(dx, 0.0)).x;
    float px_m = texture(u_pressureFine, v_uv - vec2(dx, 0.0)).x;
    float py = texture(u_pressureFine, v_uv + vec2(0.0, dy)).x;
    float py_m = texture(u_pressureFine, v_uv - vec2(0.0, dy)).x;
    float div = texture(u_divergenceFine, v_uv).x;
    // Residual on fine grid r = b - A*x = div - (px + px_m + py + py_m - 4.0 * p0)
    // Wait, the Jacobi eq is p = (px+px_m+py+py_m - div)/4. So 4p - (px+px_m+py+py_m) = -div
    // So A p = 4p - px - px_m - py - py_m
    // b = -div. So r = -div - (4p - px - px_m - py - py_m)
    float r = -div - (4.0 * p0 - px - px_m - py - py_m);
    outColor = vec4(-r, 0.0, 0.0, 1.0); // We output -r because our solver expects RHS to be subtracted
}
`;

const prolongationFS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_pressureCoarse;
uniform sampler2D u_pressureFine;
out vec4 outColor;
void main() {
    float pCoarse = texture(u_pressureCoarse, v_uv).x;
    float pFine = texture(u_pressureFine, v_uv).x;
    outColor = vec4(pFine + pCoarse, 0.0, 0.0, 1.0);
}
`;
;

const curlFS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_velocityGrid;
uniform vec2 u_gridRes;
out vec4 outColor;

void main() {
    float dx = 1.0 / u_gridRes.x;
    float dy = 1.0 / u_gridRes.y;
    
    float u_top = texture(u_velocityGrid, v_uv + vec2(0.0, dy)).x;
    float u_bottom = texture(u_velocityGrid, v_uv - vec2(0.0, dy)).x;
    float v_right = texture(u_velocityGrid, v_uv + vec2(dx, 0.0)).y;
    float v_left = texture(u_velocityGrid, v_uv - vec2(dx, 0.0)).y;
    
    // 2D Curl = dv/dx - du/dy
    float curl = 0.5 * (v_right - v_left - u_top + u_bottom);
    outColor = vec4(curl, 0.0, 0.0, 1.0);
}
`;

const vorticityFS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_velocityGrid;
uniform sampler2D u_curlGrid;
uniform vec2 u_gridRes;
uniform float u_vorticity;
out vec4 outColor;

void main() {
    float dx = 1.0 / u_gridRes.x;
    float dy = 1.0 / u_gridRes.y;
    
    float c_right = abs(texture(u_curlGrid, v_uv + vec2(dx, 0.0)).x);
    float c_left = abs(texture(u_curlGrid, v_uv - vec2(dx, 0.0)).x);
    float c_top = abs(texture(u_curlGrid, v_uv + vec2(0.0, dy)).x);
    float c_bottom = abs(texture(u_curlGrid, v_uv - vec2(0.0, dy)).x);
    float c_center = texture(u_curlGrid, v_uv).x;

    vec2 force = vec2(c_right - c_left, c_top - c_bottom) * 0.5;
    force = normalize(force + vec2(0.0001, 0.0001));
    
    // Cross product with curl: rotates force by 90 degrees and scales
    vec2 vForce = vec2(force.y, -force.x) * c_center * u_vorticity;

    vec4 vel = texture(u_velocityGrid, v_uv);
    outColor = vec4(vel.xy + vForce, vel.z, vel.w);
}
`;

const updateVS = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_vel;
layout(location = 2) in vec2 a_target;
layout(location = 3) in vec3 a_color;
layout(location = 4) in vec4 a_B;

out vec2 v_pos;
out vec2 v_vel;
out vec2 v_target;
out vec3 v_color;
out vec4 v_B;

uniform sampler2D u_velocityGrid;
uniform vec2 u_gridRes;
uniform float u_spacing;

uniform vec2 u_resolution;
uniform vec2 u_pointer;
uniform vec2 u_pointerPrev;
uniform float u_cursorForce;
uniform float u_cursorRadius;
uniform float u_yieldMult;
uniform float u_springPull;
uniform float u_springDecel;
uniform float u_pointerVel; 

uniform vec2 u_shakeVel;
uniform float u_shakeStrength;
uniform vec2 u_shakeCenter;
uniform float u_shakeRadius;

uniform vec2 u_obsCenter;
uniform float u_obsRadius;
uniform bool u_useObs;

uniform vec2 u_gravity;
uniform float u_restitution;
uniform float u_drag;
uniform bool u_isFreeFluid;

void main() {
    vec2 pos = a_pos;
    vec2 vel = a_vel;
    vec2 target = a_target;

    // --- 1. Gather Grid Velocities (APIC) ---
    vec2 gridPos = pos / u_spacing;
    vec2 baseNode = floor(gridPos - 0.5);

    vec2 v_new = vec2(0.0);
    vec4 B_new = vec4(0.0);

    for(int j=0; j<=1; j++){
        for(int i=0; i<=1; i++){
            vec2 node = baseNode + vec2(float(i), float(j));
            vec2 d = (node + 0.5) - gridPos;
            
            float wx = max(0.0, 1.0 - abs(d.x));
            float wy = max(0.0, 1.0 - abs(d.y));
            float w = wx * wy;
            
            vec2 uv = (node + 0.5) / u_gridRes;
            vec2 v_node = texture(u_velocityGrid, uv).xy;
            
            v_new += v_node * w;
            
            B_new.x += w * v_node.x * d.x;
            B_new.y += w * v_node.x * d.y;
            B_new.z += w * v_node.y * d.x;
            B_new.w += w * v_node.y * d.y;
        }
    }

    vel = v_new;
    v_B = B_new * 4.0; // APIC scale factor
    // --- 2. Apply Custom Forces (Text Spring & Mouse) ---
    float springMod = 1.0;
    if (u_pointer.x != -1000.0) {
        vec2 cDir = u_pointer - pos;
        float cDist = length(cDir);

        if (u_isFreeFluid) {
            // Free Fluid: Cursor acts as a solid wave pusher
            float sweepRadius = u_cursorRadius * 1.5;
            if (cDist < sweepRadius) {
                float falloff = exp(-(cDist * cDist) / (sweepRadius * sweepRadius * 0.3));
                if (u_pointerVel > 0.0) {
                    vec2 swipeDir = normalize(u_pointer - u_pointerPrev);
                    float ptrSpd = min(u_pointerVel, 40.0);
                    vel += swipeDir * ptrSpd * u_cursorForce * falloff * 0.6;
                } else {
                    // Radial push away if cursor is still
                    vel -= normalize(cDir) * u_cursorForce * falloff * 2.0;
                }
            }
        } else {
            // Text Spring Mode: Cursor breaks the spring
            float interactRadius = u_cursorRadius * u_yieldMult;
            if (cDist < interactRadius) {
                springMod = max(0.0, cDist / interactRadius);
                springMod = springMod * springMod * springMod;
            }

            if (u_pointerVel > 0.0) {
                float sweepRadius = u_cursorRadius;
                if (cDist < sweepRadius) {
                    float falloff = exp(-(cDist * cDist) / (sweepRadius * sweepRadius * 0.5));
                    vec2 swipeDir = normalize(u_pointer - u_pointerPrev);
                    float ptrSpd = min(u_pointerVel, 35.0);
                    vel += swipeDir * ptrSpd * u_cursorForce * falloff;
                }
            }
        }
    }

    if (!u_isFreeFluid) {
        vec2 returnDir = target - pos;
        float dist = length(returnDir);
        if (dist > 0.0) {
            float ease = dist / (dist + u_springDecel);
            float pull = ease * u_springPull * springMod;
            vel += (returnDir / dist) * pull;
        }
    } else {
        // Free Fluid: Density-based volume preservation (Pseudo-SPH)
        vec2 uvCenter = pos / (u_gridRes * u_spacing);
        vec2 dx = vec2(1.0 / u_gridRes.x, 0.0);
        vec2 dy = vec2(0.0, 1.0 / u_gridRes.y);
        
        float d_c = texture(u_velocityGrid, uvCenter).w;
        float restDensity = 2.0; // target particles per cell
        
        if (d_c > restDensity) {
            float d_r = texture(u_velocityGrid, uvCenter + dx).w;
            float d_l = texture(u_velocityGrid, uvCenter - dx).w;
            float d_t = texture(u_velocityGrid, uvCenter + dy).w;
            float d_b = texture(u_velocityGrid, uvCenter - dy).w;
            
            vec2 grad = vec2(d_r - d_l, d_t - d_b);
            // push particles away from high density areas
            vel -= grad * 0.4;
        }
        
        // slight surface tension cohesion based on APIC density proxy
        vec2 gridCenter = (baseNode + 0.5) * u_spacing;
        vec2 cDir = gridCenter - pos;
        vel += cDir * 0.005; 
    }

    // --- 2b. Apply Shake Impulse (mobile) ---
    if (u_shakeStrength > 0.0001) {
        vec2 sDir = pos - u_shakeCenter;
        float sDist = length(sDir);
        if (sDist < u_shakeRadius) {
            float t = 1.0 - (sDist / u_shakeRadius);
            float falloff = t * t; // smooth, localized blast
            vel += u_shakeVel * (u_shakeStrength * falloff);
        }
    }
    
    // Add drag to stabilize FLIP noise
    vel *= u_drag;

    // --- 2c. Gravity ---
    vel += u_gravity;

    // --- 3. Obstacle Collision ---
    if (u_useObs) {
        vec2 cDir = pos - u_obsCenter;
        float distSq = dot(cDir, cDir);
        float r2 = u_obsRadius * u_obsRadius;
        if (distSq < r2 && distSq > 0.0001) {
            float d = sqrt(distSq);
            vec2 n = cDir / d;
            pos = u_obsCenter + n * u_obsRadius;
            vel = reflect(vel, n) * u_restitution;
        }
    }

    // --- 4. Advect (Apply Velocity) ---
    pos += vel;

    // Bounds — clamp slightly inwards so they do not exit the FBO raster clip-space
    float maxX = u_resolution.x - 1.0;
    float maxY = u_resolution.y - 1.0;
    if(pos.x < 0.0) { pos.x = 0.0; vel.x *= -u_restitution; }
    if(pos.x > maxX) { pos.x = maxX; vel.x *= -u_restitution; }
    if(pos.y < 0.0) { pos.y = 0.0; vel.y *= -u_restitution; }
    if(pos.y > maxY) { pos.y = maxY; vel.y *= -u_restitution; }

    v_pos = pos;
    v_vel = vel;
    v_target = target;
    v_color = a_color;
}
`;

const updateFS = `#version 300 es
precision mediump float;
void main() {
    // Transform feedback requires fragment shader even if unused
}
`;

// --- COMPILER HELPERS ---
function createShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(vsSource, fsSource, varyings) {
  const vs = createShader(gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl.FRAGMENT_SHADER, fsSource);

  if (!vs || !fs) {
    console.error('Critical: Shader failed compilation. Program aborted.');
    return null;
  }

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  if (varyings) {
    gl.transformFeedbackVaryings(program, varyings, gl.INTERLEAVED_ATTRIBS);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

function makeBuffer(data, usage) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  return buf;
}

function makeVAO(buffer) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  // [x, y, vx, vy, tx, ty, r, g, b, Bxx, Bxy, Byx, Byy] - 13 floats per particle, 52 bytes stride
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 52, 0);  // Pos
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 52, 8);  // Vel
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 52, 16);  // Target
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 52, 24);  // Color
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 52, 36);  // B Matrix
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return vao;
}

function makeTransformFeedback(buffer) {
  const tf = gl.createTransformFeedback();
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buffer);
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
  return tf;
}

function createTexture(w, h, data = null) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function createFBO(tex) {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    console.error(
        'FBO Incomplete. EXT_color_buffer_float might not be fully supported.');
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return fbo;
}

// --- INITIALIZATION ---

let scatterProgram, normalizeProgram, divergenceProgram, pressureProgram,
    gradSubProgram, curlProgram, vorticityProgram, metaballProgram,
    restrictionProgram, prolongationProgram, blurProgram;

function initRender() {
  renderProgram = createProgram(renderVS, renderFS);
  scatterProgram = createProgram(scatterVS, scatterFS);
  normalizeProgram = createProgram(normalizeVS, normalizeFS);
  curlProgram = createProgram(normalizeVS, curlFS);
  vorticityProgram = createProgram(normalizeVS, vorticityFS);
  divergenceProgram = createProgram(normalizeVS, divergenceFS);
  pressureProgram = createProgram(normalizeVS, pressureFS);
  restrictionProgram = createProgram(normalizeVS, restrictionFS);
  prolongationProgram = createProgram(normalizeVS, prolongationFS);
  gradSubProgram = createProgram(normalizeVS, gradSubFS);
  blurProgram = createProgram(normalizeVS, blurFS);
  metaballProgram = createProgram(normalizeVS, ssfrFS);
  updateProgram = createProgram(
      updateVS, updateFS, ['v_pos', 'v_vel', 'v_target', 'v_color', 'v_B']);
}

function createTextParticles() {
  const offscreen = document.createElement('canvas');
  offscreen.width = width;
  offscreen.height = height;
  const octx = offscreen.getContext('2d', {willReadFrequently: true});

  octx.fillStyle = 'black';
  octx.fillRect(0, 0, width, height);

  const textLines = customText.split('\\n');
  let baseFontSize = 100;
  octx.font = `900 ${baseFontSize}px Arial, sans-serif`;

  let maxWidth = 0;
  textLines.forEach(line => {
    maxWidth = Math.max(maxWidth, octx.measureText(line).width);
  });

  const panelArea = Math.min(320, width * 0.4);
  const availableWidth = width - panelArea;
  const centerX = availableWidth / 2;

  const widthScale = (availableWidth * 0.9) / maxWidth;
  const heightScale = (height * 0.8) / (baseFontSize * 0.9 * textLines.length);
  const finalScale = Math.min(widthScale, heightScale);
  const fontSize = baseFontSize * finalScale;

  octx.fillStyle = 'white';
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.font = `900 ${fontSize}px Arial, sans-serif`;

  const lineHeight = fontSize * 0.9;
  const totalHeight = lineHeight * textLines.length;
  const startY = (height / 2) - (totalHeight / 2) + (lineHeight / 2);

  textLines.forEach((line, index) => {
    octx.fillText(line, centerX, startY + index * lineHeight);
  });

  const data = octx.getImageData(0, 0, width, height).data;

  // Pass 1: Gather pixels — step adapts so we always collect ~3× MAX_PARTICLES candidates
  const sampleStep = Math.max(1, Math.floor(Math.sqrt((width * height) / (MAX_PARTICLES * 3))));
  const rawX = [];
  const rawY = [];
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const idx = (y * width + x) * 4;
      if (data[idx] > 128) {
        rawX.push(x + (Math.random() - 0.5));
        rawY.push(y + (Math.random() - 0.5));
      }
    }
  }

  // Pass 2: Thin out mathematically
  const stride = Math.max(1, rawX.length / MAX_PARTICLES);
  numParticles = Math.floor(Math.min(rawX.length, MAX_PARTICLES));

  // Array Layout: [x,y, vx,vy, tx,ty, r,g,b, Bxx,Bxy,Byx,Byy]
  const initialData = new Float32Array(numParticles * 13);

  for (let i = 0; i < numParticles; i++) {
    const index = Math.floor(i * stride);
    const px = rawX[index];
    const py = rawY[index];
    const base = i * 13;

    const t = px / width;
    const [r, g, b] = getThemeColor(t, py);

    initialData[base + 0] = px;   // x
    initialData[base + 1] = py;   // y
    initialData[base + 2] = 0.0;  // vx
    initialData[base + 3] = 0.0;  // vy
    initialData[base + 4] = px;   // tx
    initialData[base + 5] = py;   // ty
    initialData[base + 6] = r;    // r
    initialData[base + 7] = g;    // g
    initialData[base + 8] = b;    // b
    initialData[base + 9] = 0.0;  // Bxx
    initialData[base + 10] = 0.0; // Bxy
    initialData[base + 11] = 0.0; // Byx
    initialData[base + 12] = 0.0; // Byy
  }

  // Create GPU buffers
  if (particleBufferA) gl.deleteBuffer(particleBufferA);
  if (particleBufferB) gl.deleteBuffer(particleBufferB);

  particleBufferA = makeBuffer(initialData, gl.DYNAMIC_DRAW);
  particleBufferB = makeBuffer(initialData, gl.DYNAMIC_DRAW);

  particleVAOA = makeVAO(particleBufferA);
  particleVAOB = makeVAO(particleBufferB);

  transformFeedbackA = makeTransformFeedback(particleBufferA);
  transformFeedbackB = makeTransformFeedback(particleBufferB);

  // Unbind any dangling buffers from global state to prevent Transform Feedback
  // write conflicts
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindVertexArray(null);
}

// Reinitializes GPU particle buffers with a hex-packed dam-break layout.
// Does NOT recreate VAOs or TF objects — they remain valid since buffer
// object IDs don't change, only the contents.
function initFreeFluidParticles() {
  const w = canvas.width;
  const h = canvas.height;

  // Mirror reference: r = 0.3 * grid cell, hex-packed dx/dy
  const r  = SPACING * 0.3;
  const dx = 2.0 * r;
  const dy = (Math.sqrt(3.0) / 2.0) * dx;

  // Bottom pool: full width, bottom 40% of height
  const margin  = SPACING + r;
  const fillW   = w - margin;
  const startY  = h * 0.6; // lower 40%
  const endY    = h - margin;

  const posX = [];
  const posY = [];
  let row = 0;
  for (let py = startY; py < endY && posX.length < MAX_PARTICLES; py += dy, row++) {
    const xOffset = (row % 2 === 0) ? 0 : r;
    for (let px = margin + xOffset; px < fillW && posX.length < MAX_PARTICLES; px += dx) {
      posX.push(px);
      posY.push(py);
    }
  }

  numParticles = posX.length;
  const data = new Float32Array(numParticles * 13);
  for (let i = 0; i < numParticles; i++) {
    const px = posX[i], py = posY[i];
    const [cr, cg, cb] = getThemeColor(px / w, py / h);
    const b = i * 13;
    data[b]     = px;  data[b + 1] = py;  // pos
    data[b + 2] = 0;   data[b + 3] = 0;   // vel
    data[b + 4] = px;  data[b + 5] = py;  // target (unused in free fluid)
    data[b + 6] = cr;  data[b + 7] = cg;  data[b + 8] = cb;
    data[b + 9] = 0;   data[b + 10] = 0;  // Bxx, Bxy
    data[b + 11] = 0;  data[b + 12] = 0;  // Byx, Byy
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, particleBufferA);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, particleBufferB);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  isBufferA = true;
  updateHUD();
}

function init() {
  pixelRatio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  width = Math.floor(rect.width * pixelRatio);
  height = Math.floor(rect.height * pixelRatio);
  canvas.width = width;
  canvas.height = height;

  gridWidth = Math.ceil(width / SPACING);
  gridHeight = Math.ceil(height / SPACING);

  gl.viewport(0, 0, width, height);

  // Rebuild FBOs
  if (velocityGridTex) gl.deleteTexture(velocityGridTex);
  if (prevVelocityGridTex) gl.deleteTexture(prevVelocityGridTex);
  if (divergenceTex) gl.deleteTexture(divergenceTex);
  if (curlTex) gl.deleteTexture(curlTex);
  if (pressurePingTex) gl.deleteTexture(pressurePingTex);
  if (pressurePongTex) gl.deleteTexture(pressurePongTex);
  if (densityTex) gl.deleteTexture(densityTex);

  if (velocityGridFBO) gl.deleteFramebuffer(velocityGridFBO);
  if (prevVelocityGridFBO) gl.deleteFramebuffer(prevVelocityGridFBO);
  if (curlFBO) gl.deleteFramebuffer(curlFBO);
  if (densityFBO) gl.deleteFramebuffer(densityFBO);

  for(let lvl of mgLevels) {
    if(lvl.pTex) gl.deleteTexture(lvl.pTex);
    if(lvl.pTexPong) gl.deleteTexture(lvl.pTexPong);
    if(lvl.divTex) gl.deleteTexture(lvl.divTex);
    if(lvl.pFBO) gl.deleteFramebuffer(lvl.pFBO);
    if(lvl.pFBOPong) gl.deleteFramebuffer(lvl.pFBOPong);
    if(lvl.divFBO) gl.deleteFramebuffer(lvl.divFBO);
  }
  mgLevels = [];

  velocityGridTex = createTexture(gridWidth, gridHeight);
  velocityGridFBO = createFBO(velocityGridTex);

  prevVelocityGridTex = createTexture(gridWidth, gridHeight);
  prevVelocityGridFBO = createFBO(prevVelocityGridTex);

  curlTex = createTexture(gridWidth, gridHeight);
  curlFBO = createFBO(curlTex);

  let cw = gridWidth, ch = gridHeight;
  for(let i=0; i<4; i++) {
    let lvl = {
      w: cw, h: ch,
      pTex: createTexture(cw, ch),
      pTexPong: createTexture(cw, ch),
      divTex: createTexture(cw, ch)
    };
    lvl.pFBO = createFBO(lvl.pTex);
    lvl.pFBOPong = createFBO(lvl.pTexPong);
    lvl.divFBO = createFBO(lvl.divTex);
    mgLevels.push(lvl);
    
    cw = Math.max(1, Math.floor(cw / 2));
    ch = Math.max(1, Math.floor(ch / 2));
    if (cw < 2 || ch < 2) break;
  }
  
  // Aliases for compatibility
  divergenceTex = mgLevels[0].divTex;
  divergenceFBO = mgLevels[0].divFBO;
  pressurePingTex = mgLevels[0].pTex;
  pressurePongTex = mgLevels[0].pTexPong;
  pressurePingFBO = mgLevels[0].pFBO;
  pressurePongFBO = mgLevels[0].pFBOPong;

  densityTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, densityTex);
  // Use half float for density map, screen size
  gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT,
      null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  densityFBO = createFBO(densityTex);

  if(blurTex) gl.deleteTexture(blurTex);
  if(blurFBO) gl.deleteFramebuffer(blurFBO);
  blurTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, blurTex);
  gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT,
      null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  blurFBO = createFBO(blurTex);

  initRender();
  createTextParticles();

  loading.style.opacity = '0';
}

function render() {
  // FPS tracking
  _fpsCount++;
  const _now = performance.now();
  if (_fpsLast === 0) _fpsLast = _now;
  if (_now - _fpsLast >= 1000) {
    _fpsValue = _fpsCount;
    _fpsCount = 0;
    _fpsLast = _now;
    updateHUD();
  }

  const vaoRead = isBufferA ? particleVAOA : particleVAOB;
  const tfWrite = isBufferA ? transformFeedbackB : transformFeedbackA;

  // Decay shake impulse over time (prevents constant jitter)
  shake.vx *= SHAKE_DECAY;
  shake.vy *= SHAKE_DECAY;
  shake.strength *= SHAKE_DECAY;
  if (Math.abs(shake.vx) + Math.abs(shake.vy) < 0.0005) {
    shake.vx = 0.0;
    shake.vy = 0.0;
  }
  if (shake.strength < 0.0005) shake.strength = 0.0;

  // ==========================================
  // 0. EULERIAN FLUID GRID PASSES
  // ==========================================
  gl.viewport(0, 0, gridWidth, gridHeight);

  // 0a: Scatter Particles to Grid
  gl.bindFramebuffer(gl.FRAMEBUFFER, velocityGridFBO);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);  // Additive accumulate

  gl.useProgram(scatterProgram);
  gl.uniform2f(
      gl.getUniformLocation(scatterProgram, 'u_gridRes'), gridWidth,
      gridHeight);
  gl.uniform1f(gl.getUniformLocation(scatterProgram, 'u_spacing'), SPACING);

  gl.bindVertexArray(vaoRead);
  gl.drawArrays(gl.POINTS, 0, numParticles);

  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);

  // 0b: Normalize Grid Velocities
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevVelocityGridFBO);
  gl.useProgram(normalizeProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, velocityGridTex);
  gl.uniform1i(gl.getUniformLocation(normalizeProgram, 'u_velocityGrid'), 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  if (VORTICITY > 0.0) {
    // Compute curl
    gl.bindFramebuffer(gl.FRAMEBUFFER, curlFBO);
    gl.useProgram(curlProgram);
    gl.bindTexture(gl.TEXTURE_2D, prevVelocityGridTex);
    gl.uniform1i(gl.getUniformLocation(curlProgram, 'u_velocityGrid'), 0);
    gl.uniform2f(
        gl.getUniformLocation(curlProgram, 'u_gridRes'), gridWidth, gridHeight);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Compute vorticity force
    gl.bindFramebuffer(gl.FRAMEBUFFER, velocityGridFBO);
    gl.useProgram(vorticityProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prevVelocityGridTex);
    gl.uniform1i(gl.getUniformLocation(vorticityProgram, 'u_velocityGrid'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, curlTex);
    gl.uniform1i(gl.getUniformLocation(vorticityProgram, 'u_curlGrid'), 1);
    gl.uniform2f(
        gl.getUniformLocation(vorticityProgram, 'u_gridRes'), gridWidth,
        gridHeight);
    gl.uniform1f(
        gl.getUniformLocation(vorticityProgram, 'u_vorticity'), VORTICITY);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Swap so prevVelocityGridFBO holds the new vorticity-injected base
    // velocities
    let tmpTx = velocityGridTex;
    velocityGridTex = prevVelocityGridTex;
    prevVelocityGridTex = tmpTx;
    let tmpFb = velocityGridFBO;
    velocityGridFBO = prevVelocityGridFBO;
    prevVelocityGridFBO = tmpFb;
  }

  const applyObstacleUniforms = (prog) => {
    gl.uniform1i(
        gl.getUniformLocation(prog, 'u_useObs'),
        USE_OBSTACLE && obstacleNode.down ? 1 : 0);
    gl.uniform2f(
        gl.getUniformLocation(prog, 'u_obsCenter'), obstacleNode.x,
        obstacleNode.y);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_obsRadius'), OBS_RADIUS);
  };

  // 0c: Divergence
  gl.bindFramebuffer(gl.FRAMEBUFFER, divergenceFBO);
  gl.useProgram(divergenceProgram);
  gl.bindTexture(gl.TEXTURE_2D, prevVelocityGridTex);
  gl.uniform1i(gl.getUniformLocation(divergenceProgram, 'u_velocityGrid'), 0);
  gl.uniform2f(
      gl.getUniformLocation(divergenceProgram, 'u_gridRes'), gridWidth,
      gridHeight);
  gl.uniform1f(gl.getUniformLocation(divergenceProgram, 'u_spacing'), SPACING);
  applyObstacleUniforms(divergenceProgram);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // 0d: GPU Multigrid V-Cycle
  
  // Clear all pressure levels
  for(let l=0; l<mgLevels.length; l++){
      gl.bindFramebuffer(gl.FRAMEBUFFER, mgLevels[l].pFBO);
      gl.clearColor(0,0,0,0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, mgLevels[l].pFBOPong);
      gl.clearColor(0,0,0,0);
      gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // Pre-smooth and Restrict down to coarsest
  for(let l=0; l<mgLevels.length-1; l++){
      let fine = mgLevels[l];
      let coarse = mgLevels[l+1];
      
      gl.viewport(0, 0, fine.w, fine.h);
      
      // Smooth
      gl.useProgram(pressureProgram);
      gl.uniform1i(gl.getUniformLocation(pressureProgram, 'u_pressureGrid'), 0);
      gl.uniform1i(gl.getUniformLocation(pressureProgram, 'u_divergenceGrid'), 1);
      gl.uniform2f(gl.getUniformLocation(pressureProgram, 'u_gridRes'), fine.w, fine.h);
      gl.uniform1f(gl.getUniformLocation(pressureProgram, 'u_spacing'), SPACING);
      applyObstacleUniforms(pressureProgram);
      
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, fine.divTex);
      gl.activeTexture(gl.TEXTURE0);
      
      let pPing = fine.pFBO;
      let pPong = fine.pFBOPong;
      let tPing = fine.pTex;
      let tPong = fine.pTexPong;
      
      for(let i=0; i<4; i++){
          gl.bindFramebuffer(gl.FRAMEBUFFER, pPong);
          gl.bindTexture(gl.TEXTURE_2D, tPing);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          let temp = pPing; pPing = pPong; pPong = temp;
          let tempT = tPing; tPing = tPong; tPong = tempT;
      }
      
      // Restrict
      gl.viewport(0, 0, coarse.w, coarse.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, coarse.divFBO);
      gl.useProgram(restrictionProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tPing);
      gl.uniform1i(gl.getUniformLocation(restrictionProgram, 'u_pressureFine'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, fine.divTex);
      gl.uniform1i(gl.getUniformLocation(restrictionProgram, 'u_divergenceFine'), 1);
      gl.uniform2f(gl.getUniformLocation(restrictionProgram, 'u_fineRes'), fine.w, fine.h);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      
      fine.currentTex = tPing;
  }
  
  // Solve on coarsest
  let cl = mgLevels.length - 1;
  let cLvl = mgLevels[cl];
  gl.viewport(0, 0, cLvl.w, cLvl.h);
  gl.useProgram(pressureProgram);
  gl.uniform1i(gl.getUniformLocation(pressureProgram, 'u_pressureGrid'), 0);
  gl.uniform1i(gl.getUniformLocation(pressureProgram, 'u_divergenceGrid'), 1);
  gl.uniform2f(gl.getUniformLocation(pressureProgram, 'u_gridRes'), cLvl.w, cLvl.h);
  gl.uniform1f(gl.getUniformLocation(pressureProgram, 'u_spacing'), SPACING);
  applyObstacleUniforms(pressureProgram);
  
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, cLvl.divTex);
  gl.activeTexture(gl.TEXTURE0);
  
  let pPing = cLvl.pFBO, pPong = cLvl.pFBOPong;
  let tPing = cLvl.pTex, tPong = cLvl.pTexPong;
  for(let i=0; i<20; i++){
      gl.bindFramebuffer(gl.FRAMEBUFFER, pPong);
      gl.bindTexture(gl.TEXTURE_2D, tPing);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      let temp = pPing; pPing = pPong; pPong = temp;
      let tempT = tPing; tPing = tPong; tPong = tempT;
  }
  cLvl.currentTex = tPing;
  
  // Prolongate and Post-smooth
  for(let l=mgLevels.length-2; l>=0; l--){
      let fine = mgLevels[l];
      let coarse = mgLevels[l+1];
      
      gl.viewport(0, 0, fine.w, fine.h);
      
      // Prolongate
      gl.bindFramebuffer(gl.FRAMEBUFFER, fine.pFBOPong);
      gl.useProgram(prolongationProgram);
      
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, coarse.currentTex);
      gl.uniform1i(gl.getUniformLocation(prolongationProgram, 'u_pressureCoarse'), 0);
      
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, fine.currentTex);
      gl.uniform1i(gl.getUniformLocation(prolongationProgram, 'u_pressureFine'), 1);
      
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      
      fine.currentTex = fine.pTexPong;
      
      // We need fine.currentTex (which is pTexPong) to be the source for the next smoothing pass.
      pPing = fine.pFBOPong; 
      pPong = fine.pFBO;
      tPing = fine.pTexPong; 
      tPong = fine.pTex;
      
      // Smooth
      gl.useProgram(pressureProgram);
      gl.uniform1i(gl.getUniformLocation(pressureProgram, 'u_pressureGrid'), 0);
      gl.uniform1i(gl.getUniformLocation(pressureProgram, 'u_divergenceGrid'), 1);
      gl.uniform2f(gl.getUniformLocation(pressureProgram, 'u_gridRes'), fine.w, fine.h);
      gl.uniform1f(gl.getUniformLocation(pressureProgram, 'u_spacing'), SPACING);
      applyObstacleUniforms(pressureProgram);
      
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, fine.divTex);
      gl.activeTexture(gl.TEXTURE0);
      
      for(let i=0; i<4; i++){
          gl.bindFramebuffer(gl.FRAMEBUFFER, pPong);
          gl.bindTexture(gl.TEXTURE_2D, tPing);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          let temp = pPing; pPing = pPong; pPong = temp;
          let tempT = tPing; tPing = tPong; tPong = tempT;
      }
      fine.currentTex = tPing;
  }
  
  let finalPressureTex = mgLevels[0].currentTex;
  gl.viewport(0, 0, gridWidth, gridHeight);

  // 0e: Gradient Subtraction (Divergence-Free Projection)
  gl.bindFramebuffer(gl.FRAMEBUFFER, velocityGridFBO);
  gl.useProgram(gradSubProgram);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, prevVelocityGridTex);
  gl.uniform1i(gl.getUniformLocation(gradSubProgram, 'u_velocityGrid'), 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, finalPressureTex);
  gl.uniform1i(gl.getUniformLocation(gradSubProgram, 'u_pressureGrid'), 1);
  gl.uniform2f(
      gl.getUniformLocation(gradSubProgram, 'u_gridRes'), gridWidth,
      gridHeight);
  gl.uniform1f(gl.getUniformLocation(gradSubProgram, 'u_spacing'), SPACING);
  applyObstacleUniforms(gradSubProgram);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Clean up
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, null);

  // ==========================================
  // 1. UPDATE PARTICLES (COMPUTE)
  // ==========================================
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, width, height);

  gl.useProgram(updateProgram);

  // Bind uniforms
  gl.uniform2f(
      gl.getUniformLocation(updateProgram, 'u_resolution'), width, height);
  gl.uniform2f(
      gl.getUniformLocation(updateProgram, 'u_pointer'), pointer.x, pointer.y);
  gl.uniform2f(
      gl.getUniformLocation(updateProgram, 'u_pointerPrev'), pointer.px,
      pointer.py);

  // Swipe dynamics
  let ptrVel = 0.0;
  if (pointer.x !== -1000) {
    let dx = pointer.x - pointer.px;
    let dy = pointer.y - pointer.py;
    ptrVel = Math.sqrt(dx * dx + dy * dy);
  }
  gl.uniform1f(gl.getUniformLocation(updateProgram, 'u_pointerVel'), ptrVel);

  // Grid Bindings for FLIP/PIC execution
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, velocityGridTex);
  gl.uniform1i(gl.getUniformLocation(updateProgram, 'u_velocityGrid'), 0);

  gl.uniform2f(
      gl.getUniformLocation(updateProgram, 'u_gridRes'), gridWidth, gridHeight);
  gl.uniform1f(gl.getUniformLocation(updateProgram, 'u_spacing'), SPACING);

  // Params
  gl.uniform1f(
      gl.getUniformLocation(updateProgram, 'u_cursorForce'), cursorForceMult);
  gl.uniform1f(
      gl.getUniformLocation(updateProgram, 'u_cursorRadius'),
      cursorRadiusSize * pixelRatio);
  gl.uniform1f(
      gl.getUniformLocation(updateProgram, 'u_yieldMult'), yieldRadiusMult);
  gl.uniform1f(
      gl.getUniformLocation(updateProgram, 'u_springPull'),
      FREE_FLUID ? 0.0 : returnPullMultiplier);
  gl.uniform1f(
      gl.getUniformLocation(updateProgram, 'u_springDecel'), springDecel);

  // Shake impulse uniforms
  gl.uniform2f(
      gl.getUniformLocation(updateProgram, 'u_shakeVel'), shake.vx, shake.vy);
  gl.uniform1f(
      gl.getUniformLocation(updateProgram, 'u_shakeStrength'), shake.strength);
  gl.uniform2f(
      gl.getUniformLocation(updateProgram, 'u_shakeCenter'), width * 0.5,
      height * 0.5);
  gl.uniform1f(
      gl.getUniformLocation(updateProgram, 'u_shakeRadius'),
      Math.max(width, height) * 0.65);
  applyObstacleUniforms(updateProgram);

  // Gravity & restitution
  gl.uniform2f(
      gl.getUniformLocation(updateProgram, 'u_gravity'), GRAVITY_X, GRAVITY_Y);
  gl.uniform1f(
      gl.getUniformLocation(updateProgram, 'u_restitution'), RESTITUTION);
  gl.uniform1f(gl.getUniformLocation(updateProgram, 'u_drag'), DRAG);
  gl.uniform1i(gl.getUniformLocation(updateProgram, 'u_isFreeFluid'), FREE_FLUID ? 1 : 0);

  // Disable rasterization since we are just doing math
  gl.enable(gl.RASTERIZER_DISCARD);
  gl.bindVertexArray(vaoRead);
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tfWrite);
  gl.beginTransformFeedback(gl.POINTS);
  gl.drawArrays(gl.POINTS, 0, numParticles);
  gl.endTransformFeedback();
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
  gl.disable(gl.RASTERIZER_DISCARD);

  // --- 2. DRAW PARTICLES ---
  if (USE_METABALLS) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, densityFBO);
    gl.clearColor(0, 0, 0, 0);
  } else {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 1);
  }
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(renderProgram);

  const vaoRender = isBufferA ? particleVAOB : particleVAOA;
  gl.uniform2f(
      gl.getUniformLocation(renderProgram, 'u_resolution'), width, height);
  gl.uniform1i(
      gl.getUniformLocation(renderProgram, 'u_useMetaballs'),
      USE_METABALLS ? 1 : 0);
  gl.uniform1i(
      gl.getUniformLocation(renderProgram, 'u_usePressureColor'),
      USE_PRESSURE_COLOR ? 1 : 0);
  gl.uniform2f(
      gl.getUniformLocation(renderProgram, 'u_gridRes'), gridWidth, gridHeight);
  gl.uniform1f(gl.getUniformLocation(renderProgram, 'u_spacing'), SPACING);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, finalPressureTex);
  gl.uniform1i(gl.getUniformLocation(renderProgram, 'u_pressureTex'), 2);

  gl.bindVertexArray(vaoRender);

  if (USE_METABALLS) {
    // Additive blending for liquid density mapping
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
  } else {
    // Standard Alpha blending for points
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
  gl.drawArrays(gl.POINTS, 0, numParticles);

  // SSFR Post-process
  if (USE_METABALLS) {
    // 2a. Blur Depth
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurFBO);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(blurProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, densityTex);
    gl.uniform1i(gl.getUniformLocation(blurProgram, 'u_densityTex'), 0);
    gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_resolution'), width, height);
    
    let blurRad = 0.5;
    let s_blur = document.getElementById('slider-metaball');
    if (s_blur) blurRad = parseFloat(s_blur.value);
    gl.uniform1f(gl.getUniformLocation(blurProgram, 'u_blurRadius'), blurRad);
    
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 2b. Reconstruct Normals and Shade
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(metaballProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, blurTex);
    gl.uniform1i(gl.getUniformLocation(metaballProgram, 'u_densityTex'), 0);
    gl.uniform2f(gl.getUniformLocation(metaballProgram, 'u_resolution'), width, height);
    
    let refIdx = 1.33;
    let s_ref = document.getElementById('slider-refraction');
    if (s_ref) refIdx = parseFloat(s_ref.value);
    gl.uniform1f(gl.getUniformLocation(metaballProgram, 'u_threshold'), refIdx);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  isBufferA = !isBufferA;

  // Mobile: animate 2D ripple rings over the WebGL canvas
  updateRipples();

  // Mobile: long-press whirlpool — ramp VORTICITY up while held, decay when released
  if (_longPress.active) {
    VORTICITY = Math.min(3.5, VORTICITY + 0.15);
  } else if (VORTICITY > 0.001 && _longPress.strength === 0) {
    // Only decay the whirlpool vorticity, not user-set vorticity from the slider
    const sliderVal = parseFloat((document.getElementById('slider-vorticity') || {value: '0'}).value) || 0;
    if (VORTICITY > sliderVal) VORTICITY = Math.max(sliderVal, VORTICITY * 0.92);
  }

  requestAnimationFrame(render);
}

// --- EVENTS ---
function updatePointer(e) {
  const rect = canvas.getBoundingClientRect();
  const newX = (e.clientX - rect.left) * pixelRatio;
  const newY = (e.clientY - rect.top) * pixelRatio;

  if (obstacleNode.down) {
    if (obstacleNode.px === -1000) {
      obstacleNode.px = newX;
      obstacleNode.py = newY;
    } else {
      obstacleNode.px = obstacleNode.x;
      obstacleNode.py = obstacleNode.y;
    }
    obstacleNode.x = newX;
    obstacleNode.y = newY;
  } else {
    if (pointer.px === -1000) {
      pointer.px = newX;
      pointer.py = newY;
    } else {
      pointer.px = pointer.x;
      pointer.py = pointer.y;
    }
    pointer.x = newX;
    pointer.y = newY;
  }
}

window.addEventListener('pointermove', updatePointer);
window.addEventListener('pointerdown', (e) => {
  if (e.button === 2 && USE_OBSTACLE) {
    obstacleNode.down = true;
    obstacleNode.px = -1000;
    updatePointer(e);
    return;
  }
  pointer.down = true;
  pointer.px = -1000;
  updatePointer(e);
});
window.addEventListener('pointerup', (e) => {
  if (e.button === 2) {
    obstacleNode.down = false;
    obstacleNode.px = -1000;
    obstacleNode.py = -1000;
    return;
  }
  pointer.down = false;
  pointer.px = -1000;
  pointer.py = -1000;
});
window.addEventListener('contextmenu', e => e.preventDefault());

function isProbablyPhone() {
  const ua = navigator.userAgent || '';
  const coarse =
      window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return coarse || /Android|iPhone|iPad|iPod/i.test(ua);
}

function setupShakeControls() {
  if (!isProbablyPhone() || typeof window === 'undefined') return;
  if (typeof DeviceMotionEvent === 'undefined') return;

  const permissionBtn = document.getElementById('motion-permission');

  const start = () => {
    window.addEventListener('devicemotion', (e) => {
      const acc = e.accelerationIncludingGravity || e.acceleration;
      if (!acc) return;

      const ax = acc.x || 0;
      const ay = acc.y || 0;
      const az = acc.z || 0;

      // --- Tilt gravity (low-pass filtered accelerometer) ---
      // accelerationIncludingGravity in device coords: when upright portrait,
      // ax≈0, ay≈-9.81. Low-pass isolates the gravity component.
      const TILT_ALPHA = 0.12;
      _gravTilt.x = TILT_ALPHA * ax + (1 - TILT_ALPHA) * _gravTilt.x;
      _gravTilt.y = TILT_ALPHA * ay + (1 - TILT_ALPHA) * _gravTilt.y;

      if (gravityMag > 0.001) {
        // ax positive = tilted right → fluid should flow right (positive
        // GRAVITY_X) ay negative when upright → flip sign so upright = positive
        // GRAVITY_Y (down)
        const nx = _gravTilt.x / 9.81;
        const ny = -_gravTilt.y / 9.81;
        const tiltLen = Math.hypot(nx, ny) || 1;
        GRAVITY_X = (nx / tiltLen) * gravityMag;
        GRAVITY_Y = (ny / tiltLen) * gravityMag;
        gravityAngle = Math.atan2(GRAVITY_Y, GRAVITY_X);
        drawGravityWheel();
      }

      // --- Shake detection (high-frequency motion) ---
      const mag = Math.sqrt(ax * ax + ay * ay + az * az) / 9.81;
      const now = performance.now();

      if (mag > SHAKE_THRESHOLD_G && (now - shake.lastMs) > SHAKE_COOLDOWN_MS) {
        shake.lastMs = now;

        let sx = ax;
        let sy = -ay;
        const len = Math.hypot(sx, sy) || 1;
        sx /= len;
        sy /= len;

        shake.vx += sx * SHAKE_IMPULSE_SCALE * pixelRatio;
        shake.vy += sy * SHAKE_IMPULSE_SCALE * pixelRatio;
        shake.strength = Math.min(1.0, shake.strength + 0.65);
      }
    }, {passive: true});
  };

  // iOS requires a user gesture to request motion permission.
  if (permissionBtn &&
      typeof DeviceMotionEvent.requestPermission === 'function') {
    permissionBtn.classList.remove('hidden');
    permissionBtn.addEventListener('click', async () => {
      try {
        const res = await DeviceMotionEvent.requestPermission();
        if (res === 'granted') {
          permissionBtn.classList.add('hidden');
          start();
        }
      } catch (_) {
        // Ignore; button remains visible
      }
    });
  } else {
    if (permissionBtn) permissionBtn.classList.add('hidden');
    start();
  }
}

// =============================================================
// MOBILE-ONLY GESTURE INTERACTIONS
// =============================================================
const _rippleCanvas = document.getElementById('rippleCanvas');
const _rippleCtx = _rippleCanvas ? _rippleCanvas.getContext('2d') : null;
const _gestureToast = document.getElementById('gesture-toast');
let _gestureToastTimer = null;

function showToast(msg) {
  if (!_gestureToast) return;
  _gestureToast.textContent = msg;
  _gestureToast.classList.add('show');
  clearTimeout(_gestureToastTimer);
  _gestureToastTimer = setTimeout(() => _gestureToast.classList.remove('show'), 1600);
}

function spawnRipple(x, y, maxR, color) {
  _ripples.push({ x, y, r: 0, maxR: maxR || 120, alpha: 1.0, color: color || '255,255,255' });
}

function updateRipples() {
  if (!_rippleCtx) return;
  _rippleCanvas.width = width;
  _rippleCanvas.height = height;
  _rippleCtx.clearRect(0, 0, width, height);
  _ripples = _ripples.filter(rp => rp.alpha > 0.01);
  for (const rp of _ripples) {
    rp.r += (rp.maxR - rp.r) * 0.12;
    rp.alpha *= 0.88;
    _rippleCtx.beginPath();
    _rippleCtx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
    _rippleCtx.strokeStyle = `rgba(${rp.color},${rp.alpha.toFixed(3)})`;
    _rippleCtx.lineWidth = 2;
    _rippleCtx.stroke();
  }
}

function setupMobileGestures() {
  if (!isProbablyPhone()) return;

  // ---- Resize ripple canvas to match display ----
  function syncRippleSize() {
    if (_rippleCanvas) {
      _rippleCanvas.width = window.innerWidth * (window.devicePixelRatio || 1);
      _rippleCanvas.height = window.innerHeight * (window.devicePixelRatio || 1);
      _rippleCanvas.style.width = window.innerWidth + 'px';
      _rippleCanvas.style.height = window.innerHeight + 'px';
      if (_rippleCtx) _rippleCtx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    }
  }
  syncRippleSize();
  window.addEventListener('resize', syncRippleSize);

  // ----------------------------------------------------------------
  // HELPER: cancel long-press timer safely
  // ----------------------------------------------------------------
  function cancelLongPress() {
    if (_longPress.timerId !== null) {
      clearTimeout(_longPress.timerId);
      _longPress.timerId = null;
    }
    _longPress.active = false;
    _longPress.strength = 0;
  }

  // ----------------------------------------------------------------
  // TOUCH START
  // ----------------------------------------------------------------
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();

    const touches = e.touches;

    // ── DOUBLE-TAP BURST (single touch) ──────────────────────────
    if (touches.length === 1) {
      const tx = touches[0].clientX * pixelRatio;
      const ty = touches[0].clientY * pixelRatio;
      const now = performance.now();
      const dt = now - _doubleTap.lastTapMs;
      const dx = tx - _doubleTap.lastX;
      const dy = ty - _doubleTap.lastY;
      const nearEnough = Math.hypot(dx, dy) < 80 * pixelRatio;

      if (dt < 380 && nearEnough) {
        // Fire burst: use shake impulse outward from tap point
        const angle = Math.random() * Math.PI * 2;
        shake.vx = Math.cos(angle) * SHAKE_IMPULSE_SCALE * 1.4;
        shake.vy = Math.sin(angle) * SHAKE_IMPULSE_SCALE * 1.4;
        shake.strength = 1.0;
        spawnRipple(tx / pixelRatio, ty / pixelRatio, 180, '255,200,80');
        spawnRipple(tx / pixelRatio, ty / pixelRatio, 120, '255,160,40');
        showToast('💥 Burst!');
        _doubleTap.lastTapMs = 0; // reset so triple-tap doesn't chain
        cancelLongPress();
        return;
      }
      _doubleTap.lastTapMs = now;
      _doubleTap.lastX = tx;
      _doubleTap.lastY = ty;

      // ── LONG-PRESS WHIRLPOOL ──────────────────────────────────
      _longPress.startX = tx;
      _longPress.startY = ty;
      _longPress.timerId = setTimeout(() => {
        _longPress.active = true;
        _longPress.x = _longPress.startX;
        _longPress.y = _longPress.startY;
        _longPress.strength = 0;
        spawnRipple(_longPress.x / pixelRatio, _longPress.y / pixelRatio, 80, '120,200,255');
        showToast('🌀 Whirlpool!');
      }, 600);
    }

    // ── TWO-FINGER PINCH / SWIPE ──────────────────────────────────
    if (touches.length === 2) {
      cancelLongPress();
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      _pinch.lastDist = Math.hypot(dx, dy);
      _pinch.active = true;

      const midX = (touches[0].clientX + touches[1].clientX) * 0.5;
      const midY = (touches[0].clientY + touches[1].clientY) * 0.5;
      _twoFingerSwipe.prevMidX = midX * pixelRatio;
      _twoFingerSwipe.prevMidY = midY * pixelRatio;
      _twoFingerSwipe.active = true;
    }
  }, { passive: false });

  // ----------------------------------------------------------------
  // TOUCH MOVE
  // ----------------------------------------------------------------
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touches = e.touches;

    // ── ABORT LONG-PRESS if finger moved too far ──────────────────
    if (touches.length === 1 && _longPress.timerId !== null) {
      const tx = touches[0].clientX * pixelRatio;
      const ty = touches[0].clientY * pixelRatio;
      const moved = Math.hypot(tx - _longPress.startX, ty - _longPress.startY);
      if (moved > 18 * pixelRatio) cancelLongPress();
    }

    // ── LONG-PRESS WHIRLPOOL active — track finger position ───────
    if (touches.length === 1 && _longPress.active) {
      _longPress.x = touches[0].clientX * pixelRatio;
      _longPress.y = touches[0].clientY * pixelRatio;
      _longPress.strength = Math.min(1.0, _longPress.strength + 0.04);
    }

    // ── TWO-FINGER INTERACTIONS ───────────────────────────────────
    if (touches.length === 2) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      const newDist = Math.hypot(dx, dy);
      const midX = (touches[0].clientX + touches[1].clientX) * 0.5 * pixelRatio;
      const midY = (touches[0].clientY + touches[1].clientY) * 0.5 * pixelRatio;

      // PINCH — maps distance delta to a radial shake impulse
      if (_pinch.active && _pinch.lastDist > 0) {
        const delta = newDist - _pinch.lastDist;
        const PINCH_SENSITIVITY = 0.55;

        if (Math.abs(delta) > 1.5) {
          // Spread = explode outward from pinch centre
          // Pinch = implode toward pinch centre
          const force = delta * PINCH_SENSITIVITY;
          // Direction: burst from midpoint outward in 8 directions
          const cx = midX / width  * 2 - 1; // normalized -1..1
          const cy = midY / height * 2 - 1;
          shake.vx = cx * force * SHAKE_IMPULSE_SCALE * 0.08;
          shake.vy = cy * force * SHAKE_IMPULSE_SCALE * 0.08;
          shake.strength = Math.min(1.0, shake.strength + Math.abs(force) * 0.04);

          if (delta > 8) {
            spawnRipple(midX / pixelRatio, midY / pixelRatio, 160, '100,220,255');
            showToast('💨 Explosion!');
          } else if (delta < -8) {
            spawnRipple(midX / pixelRatio, midY / pixelRatio, 80, '200,100,255');
            showToast('🌑 Implosion!');
          }
        }
      }
      _pinch.lastDist = newDist;

      // TWO-FINGER SWIPE — sends a global shockwave in swipe direction
      if (_twoFingerSwipe.active) {
        const svx = midX - _twoFingerSwipe.prevMidX;
        const svy = midY - _twoFingerSwipe.prevMidY;
        const swipeSpeed = Math.hypot(svx, svy);
        if (swipeSpeed > 4 * pixelRatio) {
          shake.vx += (svx / swipeSpeed) * swipeSpeed * 0.7;
          shake.vy += (svy / swipeSpeed) * swipeSpeed * 0.7;
          shake.strength = Math.min(1.0, shake.strength + 0.25);
          spawnRipple(midX / pixelRatio, midY / pixelRatio, 200, '255,255,180');
          showToast('🌊 Shockwave!');
        }
      }
      _twoFingerSwipe.prevMidX = midX;
      _twoFingerSwipe.prevMidY = midY;
    }
  }, { passive: false });

  // ----------------------------------------------------------------
  // TOUCH END / CANCEL
  // ----------------------------------------------------------------
  function onTouchEnd(e) {
    cancelLongPress();
    if (e.touches.length < 2) {
      _pinch.active = false;
      _twoFingerSwipe.active = false;
    }
  }
  canvas.addEventListener('touchend', onTouchEnd, { passive: true });
  canvas.addEventListener('touchcancel', onTouchEnd, { passive: true });

  showToast('👆 Double-tap, Pinch, Long-press to interact!');
}

// UI Event Listeners
document.getElementById('ui-toggle').addEventListener('click', () => {
  if (_demoMode) {
    _demoMode = false;
    document.body.classList.remove('demo-mode');
  }
  document.getElementById('ui-panel').classList.toggle('hidden');
});
document.getElementById('slider-drag').addEventListener('input', (e) => {
  DRAG = parseFloat(e.target.value);
  document.getElementById('val-drag').innerText = DRAG.toFixed(2);
});
document.getElementById('slider-return').addEventListener('input', (e) => {
  returnPullMultiplier = parseFloat(e.target.value);
  document.getElementById('val-return').innerText =
      returnPullMultiplier.toFixed(1);
});
document.getElementById('slider-force').addEventListener('input', (e) => {
  cursorForceMult = parseFloat(e.target.value);
  document.getElementById('val-force').innerText = cursorForceMult.toFixed(1);
});
document.getElementById('slider-radius').addEventListener('input', (e) => {
  cursorRadiusSize = parseInt(e.target.value, 10);
  document.getElementById('val-radius').innerText = cursorRadiusSize;
});
document.getElementById('slider-decel').addEventListener('input', (e) => {
  springDecel = parseInt(e.target.value, 10);
  document.getElementById('val-decel').innerText = springDecel;
});
document.getElementById('slider-gravity').addEventListener('input', (e) => {
  gravityMag = parseFloat(e.target.value);
  document.getElementById('val-gravity').innerText = gravityMag.toFixed(2);
  updateGravityVec();
  drawGravityWheel();
});
document.getElementById('slider-restitution').addEventListener('input', (e) => {
  RESTITUTION = parseFloat(e.target.value);
  document.getElementById('val-restitution').innerText = RESTITUTION.toFixed(2);
});

// Gravity wheel — click or drag to set direction
(function() {
const wheel = document.getElementById('gravity-wheel');
if (!wheel) return;

function setAngleFromEvent(evt) {
  const rect = wheel.getBoundingClientRect();
  const touch = evt.touches ? evt.touches[0] : evt;
  const dx = touch.clientX - rect.left - rect.width / 2;
  const dy = touch.clientY - rect.top - rect.height / 2;
  if (Math.hypot(dx, dy) < 4) return;  // ignore dead-zone clicks at center
  gravityAngle = Math.atan2(dy, dx);
  updateGravityVec();
  drawGravityWheel();
}

wheel.addEventListener('click', setAngleFromEvent);
wheel.addEventListener('mousemove', (e) => {
  if (e.buttons & 1) setAngleFromEvent(e);
});
wheel.addEventListener('touchstart', setAngleFromEvent, {passive: true});
wheel.addEventListener('touchmove', setAngleFromEvent, {passive: true});
})();
document.getElementById('slider-yield').addEventListener('input', (e) => {
  yieldRadiusMult = parseFloat(e.target.value);
  document.getElementById('val-yield').innerText = yieldRadiusMult.toFixed(2);
});
document.getElementById('slider-spacing').addEventListener('input', (e) => {
  document.getElementById('val-spacing').innerText = e.target.value;
});
document.getElementById('slider-iters').addEventListener('input', (e) => {
  document.getElementById('val-iters').innerText = e.target.value;
});
document.getElementById('slider-particles').addEventListener('input', (e) => {
  document.getElementById('val-particles').innerText =
      (parseInt(e.target.value, 10) / 1000) + 'k';
});


// Advanced Feature Bindings
document.getElementById('check-metaball').addEventListener('change', (e) => {
  USE_METABALLS = e.target.checked;
});
document.getElementById('slider-metaball').addEventListener('input', (e) => {
  METABALL_THRESH = parseFloat(e.target.value);
  document.getElementById('val-metaball').innerText =
      METABALL_THRESH.toFixed(2);
});
document.getElementById('slider-vorticity').addEventListener('input', (e) => {
  VORTICITY = parseFloat(e.target.value);
  document.getElementById('val-vorticity').innerText = VORTICITY.toFixed(1);
});
document.getElementById('check-obstacle').addEventListener('change', (e) => {
  USE_OBSTACLE = e.target.checked;
});
document.getElementById('slider-obsradius').addEventListener('input', (e) => {
  OBS_RADIUS = parseInt(e.target.value, 10);
  document.getElementById('val-obsradius').innerText = OBS_RADIUS;
});

document.getElementById('btn-apply').addEventListener('click', () => {
  customText = document.getElementById('input-text').value || 'GPU\\nTEST';
  SPACING = parseInt(document.getElementById('slider-spacing').value, 10);
  MAX_PARTICLES =
      parseInt(document.getElementById('slider-particles').value, 10);
  PRESSURE_ITERS = parseInt(document.getElementById('slider-iters').value, 10);

  FREE_FLUID = false;
  document.getElementById('btn-free-fluid').classList.remove('active');
  loading.style.opacity = '1';
  setTimeout(() => {
    init();
    drawThemeSwatch();
    updateHUD();
  }, 50);
});

let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    init();
    drawThemeSwatch();
  }, 250);
});

// --- ACCORDION ---
document.querySelectorAll('.accordion-header').forEach(header => {
  header.addEventListener('click', () => {
    header.parentElement.classList.toggle('open');
  });
});

// --- THEME BUTTONS ---
document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.theme;
    document.querySelectorAll('.theme-btn')
        .forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (theme === 'pressure') {
      USE_PRESSURE_COLOR = true;
    } else {
      USE_PRESSURE_COLOR = false;
      COLOR_THEME = theme;
      createTextParticles();
    }
    drawThemeSwatch();
    updateHUD();
  });
});

// --- PRESET BUTTONS ---
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
});

// --- FREE FLUID MODE ---
let _ffSavedMetaballs = false;
document.getElementById('btn-free-fluid').addEventListener('click', () => {
  FREE_FLUID = !FREE_FLUID;
  document.getElementById('btn-free-fluid').classList.toggle('active', FREE_FLUID);

  const textOnlyEls = document.querySelectorAll('.text-mode-only');

  if (FREE_FLUID) {
    textOnlyEls.forEach(el => el.classList.add('item-hidden'));

    // Reinitialize particles as hex-packed dam break
    initFreeFluidParticles();

    // Auto-enable metaballs so fluid looks like a connected liquid surface
    _ffSavedMetaballs = USE_METABALLS;
    USE_METABALLS = true;
    document.getElementById('check-metaball').checked = true;

    // Fix the "Honey" problem by enforcing the Water preset's drag/flip ratios
    applyPreset('water');

    // Enable strong downward gravity
    gravityMag   = 0.55;
    gravityAngle = Math.PI * 0.5;
    updateGravityVec();
    drawGravityWheel();
    document.getElementById('slider-gravity').value = gravityMag;
    document.getElementById('val-gravity').innerText = gravityMag.toFixed(2);
  } else {
    textOnlyEls.forEach(el => el.classList.remove('item-hidden'));

    // Restore text particles and settings
    USE_METABALLS = _ffSavedMetaballs;
    document.getElementById('check-metaball').checked = _ffSavedMetaballs;

    gravityMag = 0.0;
    updateGravityVec();
    drawGravityWheel();
    document.getElementById('slider-gravity').value = 0;
    document.getElementById('val-gravity').innerText = '0.00';

    createTextParticles();
  }
});


// --- DEMO / FULLSCREEN ---
document.getElementById('fullscreen-btn')
    .addEventListener('click', toggleDemoMode);
window.addEventListener('keydown', (e) => {
  if ((e.key === 'f' || e.key === 'F') &&
      document.activeElement.tagName !== 'INPUT') {
    toggleDemoMode();
  }
});

// Boot
init();
setupShakeControls();
setupMobileGestures();
drawThemeSwatch();
drawGravityWheel();
updateHUD();
render();
