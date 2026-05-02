const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');
const loading = document.getElementById('loading');

// --- FLIP / PIC SIMULATION CONFIGURATION ---
let SPACING = 8;  // Grid cell size (lower = more detail, slower)
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

const FLUID_CELL = 0;
const AIR_CELL = 1;
const SOLID_CELL = 2;

let width, height, fNumX, fNumY, fNumCells;
let pixelRatio;
let imgData, pixelBuffer;

// Pointer state
let pointer =
    {x: -1000, y: -1000, px: -1000, py: -1000, down: false, vx: 0, vy: 0};

// --- MOBILE SHAKE IMPULSE ---
let shake = {vx: 0.0, vy: 0.0, strength: 0.0, lastMs: 0};
const SHAKE_COOLDOWN_MS = 120;
const SHAKE_THRESHOLD_G = 1.35;
const SHAKE_IMPULSE_SCALE = 18.0;
const SHAKE_DECAY = 0.88;

// --- FLIP FLUID SOLVER DATA ---
let fU, fV, prevU, prevV, fDu, fDv, fP, fS, cellType;
let pX, pY, pTX, pTY, pVX, pVY;
let numParticles = 0;

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function init() {
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

  // Fix: Fallbacks and clamp to ensure width/height are never 0
  // (prevents IndexSizeError in iframe environments)
  const winW = window.innerWidth || document.documentElement.clientWidth || 800;
  const winH =
      window.innerHeight || document.documentElement.clientHeight || 600;

  width = Math.max(1, Math.floor(winW * pixelRatio));
  height = Math.max(1, Math.floor(winH * pixelRatio));

  canvas.width = width;
  canvas.height = height;

  // Initialize Grid
  fNumX = Math.floor(width / SPACING) + 1;
  fNumY = Math.floor(height / SPACING) + 1;
  fNumCells = fNumX * fNumY;

  fU = new Float32Array(fNumCells);
  fV = new Float32Array(fNumCells);
  prevU = new Float32Array(fNumCells);
  prevV = new Float32Array(fNumCells);
  fDu = new Float32Array(fNumCells);
  fDv = new Float32Array(fNumCells);
  fP = new Float32Array(fNumCells);
  fS = new Float32Array(fNumCells);  // Solids
  cellType = new Int32Array(fNumCells);

  // Set boundaries as solid
  for (let i = 0; i < fNumX; i++) {
    for (let j = 0; j < fNumY; j++) {
      let s = 1.0;
      if (i === 0 || i === fNumX - 1 || j === 0 || j === fNumY - 1) s = 0.0;
      fS[i * fNumY + j] = s;
    }
  }

  imgData = ctx.createImageData(width, height);
  pixelBuffer = new Uint32Array(imgData.data.buffer);

  createTextParticles();
  loading.style.opacity = '0';
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

  // The UI panel takes up ~300px on the right side.
  // Calculate the left-over space so the text never gets pushed completely off
  // the left edge (-x) on small screens.
  const panelArea =
      Math.min(320, width * 0.4);  // Cap the panel impact on small screens
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

  // First Pass: Find all text pixels on the canvas
  const sampleStep = pixelRatio === 2 ? 3 : 2;
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

  // Second Pass: Uniformly thin out the particles if we exceeded the cap
  // This perfectly preserves the FULL shape of the letters instead of brutally
  // cutting them off halfway down
  const tempX = [];
  const tempY = [];
  const stride = Math.max(1, rawX.length / MAX_PARTICLES);
  const pCount = Math.floor(Math.min(rawX.length, MAX_PARTICLES));

  for (let i = 0; i < pCount; i++) {
    const index = Math.floor(i * stride);
    tempX.push(rawX[index]);
    tempY.push(rawY[index]);
  }

  numParticles = tempX.length;
  pX = new Float32Array(numParticles);
  pY = new Float32Array(numParticles);
  pTX = new Float32Array(numParticles);
  pTY = new Float32Array(numParticles);
  pVX = new Float32Array(numParticles);
  pVY = new Float32Array(numParticles);

  for (let i = 0; i < numParticles; i++) {
    pX[i] = pTX[i] = tempX[i];
    pY[i] = pTY[i] = tempY[i];
    pVX[i] = pVY[i] = 0;
  }
}

// --- CORE FLIP MECHANICS (Adapted from user's WebGL implementation) ---

function transferVelocities(toGrid) {
  const n = fNumY;
  const h = SPACING;
  const h1 = 1.0 / h;
  const h2 = 0.5 * h;

  if (toGrid) {
    prevU.set(fU);
    prevV.set(fV);
    fDu.fill(0.0);
    fDv.fill(0.0);
    fU.fill(0.0);
    fV.fill(0.0);

    // Treat the entire canvas as fluid so swiping empty space creates
    // pressure waves that perfectly carry the text particles!
    for (let i = 0; i < fNumCells; i++)
      cellType[i] = fS[i] === 0.0 ? SOLID_CELL : FLUID_CELL;
  }

  for (let component = 0; component < 2; component++) {
    const dx = component === 0 ? 0.0 : h2;
    const dy = component === 0 ? h2 : 0.0;

    const f = component === 0 ? fU : fV;
    const prevF = component === 0 ? prevU : prevV;
    const d = component === 0 ? fDu : fDv;

    for (let i = 0; i < numParticles; i++) {
      let x = pX[i];
      let y = pY[i];
      x = clamp(x, h, (fNumX - 1) * h);
      y = clamp(y, h, (fNumY - 1) * h);

      const x0 = Math.min((x - dx) * h1 | 0, fNumX - 2);
      const tx = ((x - dx) - x0 * h) * h1;
      const x1 = Math.min(x0 + 1, fNumX - 2);

      const y0 = Math.min((y - dy) * h1 | 0, fNumY - 2);
      const ty = ((y - dy) - y0 * h) * h1;
      const y1 = Math.min(y0 + 1, fNumY - 2);

      const sx = 1.0 - tx;
      const sy = 1.0 - ty;
      const d0 = sx * sy;
      const d1 = tx * sy;
      const d2 = tx * ty;
      const d3 = sx * ty;

      const nr0 = x0 * n + y0;
      const nr1 = x1 * n + y0;
      const nr2 = x1 * n + y1;
      const nr3 = x0 * n + y1;

      if (toGrid) {
        // Scatter particle velocity to grid (P2G)
        const pv = component === 0 ? pVX[i] : pVY[i];
        f[nr0] += pv * d0;
        d[nr0] += d0;
        f[nr1] += pv * d1;
        d[nr1] += d1;
        f[nr2] += pv * d2;
        d[nr2] += d2;
        f[nr3] += pv * d3;
        d[nr3] += d3;
      } else {
        // Gather velocity from grid to particle (G2P)
        const offset = component === 0 ? n : 1;
        const valid0 =
            cellType[nr0] !== AIR_CELL || cellType[nr0 - offset] !== AIR_CELL ?
            1.0 :
            0.0;
        const valid1 =
            cellType[nr1] !== AIR_CELL || cellType[nr1 - offset] !== AIR_CELL ?
            1.0 :
            0.0;
        const valid2 =
            cellType[nr2] !== AIR_CELL || cellType[nr2 - offset] !== AIR_CELL ?
            1.0 :
            0.0;
        const valid3 =
            cellType[nr3] !== AIR_CELL || cellType[nr3 - offset] !== AIR_CELL ?
            1.0 :
            0.0;

        const v = component === 0 ? pVX[i] : pVY[i];
        const dWeight = valid0 * d0 + valid1 * d1 + valid2 * d2 + valid3 * d3;

        if (dWeight > 0.0) {
          // PIC Velocity (Smooth interpolation)
          const picV = (valid0 * d0 * f[nr0] + valid1 * d1 * f[nr1] +
                        valid2 * d2 * f[nr2] + valid3 * d3 * f[nr3]) /
              dWeight;
          // FLIP Velocity (Current + Difference)
          const corr = (valid0 * d0 * (f[nr0] - prevF[nr0]) +
                        valid1 * d1 * (f[nr1] - prevF[nr1]) +
                        valid2 * d2 * (f[nr2] - prevF[nr2]) +
                        valid3 * d3 * (f[nr3] - prevF[nr3])) /
              dWeight;
          const flipV = v + corr;

          if (component === 0)
            pVX[i] = (1.0 - FLIP_RATIO) * picV + FLIP_RATIO * flipV;
          else
            pVY[i] = (1.0 - FLIP_RATIO) * picV + FLIP_RATIO * flipV;
        }
      }
    }

    if (toGrid) {
      for (let i = 0; i < f.length; i++) {
        if (d[i] > 0.0) f[i] /= d[i];
      }
      // Restore solid cells
      for (let i = 0; i < fNumX; i++) {
        for (let j = 0; j < fNumY; j++) {
          const solid = cellType[i * n + j] === SOLID_CELL;
          if (solid || (i > 0 && cellType[(i - 1) * n + j] === SOLID_CELL))
            fU[i * n + j] = prevU[i * n + j];
          if (solid || (j > 0 && cellType[i * n + j - 1] === SOLID_CELL))
            fV[i * n + j] = prevV[i * n + j];
        }
      }
    }
  }
}

function solveIncompressibility() {
  fP.fill(0.0);
  prevU.set(fU);
  prevV.set(fV);

  const n = fNumY;
  const cp = 1000 * SPACING / (1.0 / 60.0);  // density * h / dt

  for (let iter = 0; iter < PRESSURE_ITERS; iter++) {
    for (let i = 1; i < fNumX - 1; i++) {
      const rowOffset = i * n;
      const leftRowOffset = (i - 1) * n;
      const rightRowOffset = (i + 1) * n;

      for (let j = 1; j < fNumY - 1; j++) {
        const center = rowOffset + j;
        if (cellType[center] !== FLUID_CELL) continue;

        const left = leftRowOffset + j;
        const right = rightRowOffset + j;
        const bottom = center - 1;
        const top = center + 1;

        const s = fS[center];
        const sx0 = fS[left];
        const sx1 = fS[right];
        const sy0 = fS[bottom];
        const sy1 = fS[top];
        const sTot = sx0 + sx1 + sy0 + sy1;

        if (sTot === 0.0) continue;

        const div = fU[right] - fU[center] + fV[top] - fV[center];

        let p = -div / sTot;
        p *= 1.9;  // OverRelaxation
        fP[center] += cp * p;

        fU[center] -= sx0 * p;
        fU[right] += sx1 * p;
        fV[center] -= sy0 * p;
        fV[top] += sy1 * p;
      }
    }
  }
}

function injectCursorForceToGrid() {
  if (pointer.px === -1000) return;

  const dx = pointer.x - pointer.px;
  const dy = pointer.y - pointer.py;
  const speed = Math.sqrt(dx * dx + dy * dy);

  if (speed > 0.0) {
    // Clamp speed to prevent physics explosions on fast swipes
    const maxSpeed = 35.0;  // Increased so particles trace wider, longer trails
    let vx = dx;
    let vy = dy;
    if (speed > maxSpeed) {
      vx = (dx / speed) * maxSpeed;
      vy = (dy / speed) * maxSpeed;
    }

    const radius = Math.max(
        3,
        Math.floor(
            cursorRadiusSize * pixelRatio / SPACING));  // Grid cell radius
    const activeForceMult = cursorForceMult;            // Dynamically editable

    // Fix: Interpolate mouse movement to catch fast swipes
    // This creates a solid "wall" of water being pushed, making it follow the
    // cursor perfectly
    const steps = Math.max(1, Math.floor(speed / (SPACING / 2)));

    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      const curX = pointer.px + dx * t;
      const curY = pointer.py + dy * t;

      const cx = Math.floor(curX / SPACING);
      const cy = Math.floor(curY / SPACING);

      for (let i = -radius; i <= radius; i++) {
        for (let j = -radius; j <= radius; j++) {
          const idxX = cx + i;
          const idxY = cy + j;

          // Bounds check
          if (idxX > 0 && idxX < fNumX - 1 && idxY > 0 && idxY < fNumY - 1) {
            const dist = Math.hypot(i, j);
            if (dist < radius) {
              // Smooth bell-curve falloff for elegant stirring
              const falloff =
                  Math.exp(-(dist * dist) / (radius * radius * 0.5));
              const idx = idxX * fNumY + idxY;

              // Inject velocity directly into the fluid grid!
              fU[idx] += vx * activeForceMult * falloff;
              fV[idx] += vy * activeForceMult * falloff;
            }
          }
        }
      }
    }
  }

  pointer.px = pointer.x;
  pointer.py = pointer.y;
}

function injectShakeForceToGrid() {
  if (shake.strength <= 0.0001) return;

  const cx = Math.floor((width * 0.5) / SPACING);
  const cy = Math.floor((height * 0.5) / SPACING);
  const radius = Math.floor(Math.min(fNumX, fNumY) * 0.28);

  for (let i = -radius; i <= radius; i++) {
    for (let j = -radius; j <= radius; j++) {
      const idxX = cx + i;
      const idxY = cy + j;
      if (idxX <= 0 || idxX >= fNumX - 1 || idxY <= 0 || idxY >= fNumY - 1)
        continue;

      const dist = Math.hypot(i, j);
      if (dist >= radius) continue;

      const t = 1.0 - (dist / radius);
      const falloff = t * t;
      const idx = idxX * fNumY + idxY;
      fU[idx] += shake.vx * shake.strength * falloff;
      fV[idx] += shake.vy * shake.strength * falloff;
    }
  }
}

function animate() {
  // Decay shake impulse over time
  shake.vx *= SHAKE_DECAY;
  shake.vy *= SHAKE_DECAY;
  shake.strength *= SHAKE_DECAY;
  if (Math.abs(shake.vx) + Math.abs(shake.vy) < 0.0005) {
    shake.vx = 0.0;
    shake.vy = 0.0;
  }
  if (shake.strength < 0.0005) shake.strength = 0.0;

  // 1. Map particles to grid (P2G)
  transferVelocities(true);

  // 3. Add cursor interactions directly to the FLUID GRID
  injectCursorForceToGrid();
  injectShakeForceToGrid();

  // 4. Make the fluid incompressible (Swirls!)
  solveIncompressibility();

  // 5. Map grid back to particles (G2P - FLIP/PIC blend)
  transferVelocities(false);

  // 6. Advect and Render
  pixelBuffer.fill(0xFF000000);  // Black background

  for (let i = 0; i < numParticles; i++) {
    // Apply Capped Spring AFTER fluid physics constraints
    const dx = pTX[i] - pX[i];
    const dy = pTY[i] - pY[i];
    const distSq = dx * dx + dy * dy;

    // FREE DRAG FEATURE: Yield the spring force when the cursor is near them!
    let springMod = 1.0;
    if (pointer.x !== -1000) {
      const cdx = pointer.x - pX[i];
      const cdy = pointer.y - pY[i];
      const cursorDistSq = cdx * cdx + cdy * cdy;
      const interactRadius = (cursorRadiusSize * yieldRadiusMult) * pixelRatio;
      const interactRadiusSq = interactRadius * interactRadius;

      if (cursorDistSq < interactRadiusSq) {
        const cursorDist = Math.sqrt(cursorDistSq);
        // Smoothly disable the return spring so they can be dragged freely
        springMod = Math.max(0, cursorDist / interactRadius);
        springMod =
            springMod * springMod * springMod;  // Faster than Math.pow(x, 3)
      }
    }

    if (distSq > 0) {
      const dist = Math.sqrt(distSq);
      // Bezier "Ease-Out" style return curve.
      const easeFactor = dist / (dist + springDecel);
      const pull = easeFactor * returnPullMultiplier * springMod;
      pVX[i] += (dx / dist) * pull;
      pVY[i] += (dy / dist) * pull;
    }

    // Apply drag to maintain smooth, liquid momentum without infinite bouncing
    pVX[i] *= DRAG;
    pVY[i] *= DRAG;

    pX[i] += pVX[i];
    pY[i] += pVY[i];

    // Bounds
    if (pX[i] < SPACING) {
      pX[i] = SPACING;
      pVX[i] *= -0.5;
    }
    if (pX[i] > width - SPACING) {
      pX[i] = width - SPACING;
      pVX[i] *= -0.5;
    }
    if (pY[i] < SPACING) {
      pY[i] = SPACING;
      pVY[i] *= -0.5;
    }
    if (pY[i] > height - SPACING) {
      pY[i] = height - SPACING;
      pVY[i] *= -0.5;
    }

    const pxX = pX[i] | 0;
    const pxY = pY[i] | 0;

    if (pxX >= 0 && pxX < width && pxY >= 0 && pxY < height) {
      pixelBuffer[pxY * width + pxX] = 0xFFFFFFFF;  // White pixel
    }
  }

  ctx.putImageData(imgData, 0, 0);
  requestAnimationFrame(animate);
}

// --- EVENTS ---
function updatePointer(e) {
  const rect = canvas.getBoundingClientRect();
  const newX = (e.clientX - rect.left) * pixelRatio;
  const newY = (e.clientY - rect.top) * pixelRatio;

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

window.addEventListener('pointermove', updatePointer);
window.addEventListener('pointerdown', (e) => {
  pointer.down = true;
  pointer.px = -1000;
  updatePointer(e);
});
window.addEventListener('pointerup', () => {
  pointer.down = false;
  pointer.px = -1000;
  pointer.py = -1000;
});

function isProbablyPhone() {
  const ua = navigator.userAgent || '';
  const coarse =
      window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return coarse || /Android|iPhone|iPad|iPod/i.test(ua);
}

function setupShakeControls() {
  if (!isProbablyPhone()) return;
  if (typeof DeviceMotionEvent === 'undefined') return;

  const start = () => {
    window.addEventListener('devicemotion', (e) => {
      const acc = e.accelerationIncludingGravity || e.acceleration;
      if (!acc) return;

      const ax = acc.x || 0;
      const ay = acc.y || 0;
      const az = acc.z || 0;
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

  // Permission button lives in index.html; if absent, just start.
  const permissionBtn = document.getElementById('motion-permission');
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
      }
    });
  } else {
    if (permissionBtn) permissionBtn.classList.add('hidden');
    start();
  }
}

// Bootstrap
init();
setupShakeControls();
animate();

let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    init();
  }, 250);
});

// UI Event Listeners
document.getElementById('slider-flip').addEventListener('input', (e) => {
  FLIP_RATIO = parseFloat(e.target.value);
  document.getElementById('val-flip').innerText = FLIP_RATIO.toFixed(2);
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

document.getElementById('slider-yield').addEventListener('input', (e) => {
  yieldRadiusMult = parseFloat(e.target.value);
  document.getElementById('val-yield').innerText = yieldRadiusMult.toFixed(2);
});

document.getElementById('slider-spacing').addEventListener('input', (e) => {
  document.getElementById('val-spacing').innerText = e.target.value;
});

document.getElementById('ui-toggle').addEventListener('click', () => {
  document.getElementById('ui-panel').classList.toggle('hidden');
});

document.getElementById('slider-iters').addEventListener('input', (e) => {
  document.getElementById('val-iters').innerText = e.target.value;
});

document.getElementById('slider-particles').addEventListener('input', (e) => {
  document.getElementById('val-particles').innerText =
      (parseInt(e.target.value, 10) / 1000) + 'k';
});

document.getElementById('btn-apply').addEventListener('click', () => {
  customText = document.getElementById('input-text').value || 'FLIP\\nFLUID';
  SPACING = parseInt(document.getElementById('slider-spacing').value, 10);
  MAX_PARTICLES =
      parseInt(document.getElementById('slider-particles').value, 10);
  PRESSURE_ITERS = parseInt(document.getElementById('slider-iters').value, 10);

  // Flash loading screen during recompilation
  loading.style.opacity = '1';

  // Yield to the browser render thread before blocking physics compilation
  setTimeout(() => {
    init();
  }, 50);
});
