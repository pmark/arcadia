// AMC sol palette and sky/star field adapted from Mission Control Site.
  const root = document.body;
  const landscape = root.querySelector('.canyon-landscape');
  const pause = root.querySelector('.motion-control');
  const canvas = root.querySelector('.canyon-frame');
  const ctx = canvas.getContext('2d', { alpha:false });
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const forcedColors = matchMedia('(forced-colors: active)');
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  let started = Date.now();
  let paused = false;
  try {
    const saved = Number(sessionStorage.getItem('field-notes-sol-start'));
    if (saved > 0 && saved <= started) started = saved;
    sessionStorage.setItem('field-notes-sol-start', String(started));
    paused = sessionStorage.getItem('field-notes-motion-paused') === 'true';
  } catch {}
  const isStill = () => paused || reduceMotion.matches || forcedColors.matches;
  const isDark = () => darkQuery.matches;
  const phase = () => phaseSince(Date.now() - started);
  let W = 0;
  let H = 0;

  const SOL_MS = 600_000;
const OPENING_PHASE = 0;
const MORNING_PHASE = 0.34;
const OPENING_MS = 60_000;
function phaseSince(ms) {
    if (ms < OPENING_MS)
        return OPENING_PHASE + (MORNING_PHASE - OPENING_PHASE) * smooth(0, OPENING_MS, ms);
    return (MORNING_PHASE + (ms - OPENING_MS) / SOL_MS) % 1;
}
const SKY = {
    light: [
        [0.0, '#27304f', '#3d4a72', '#6c7496'],
        [0.2, '#2c3a62', '#4a5f8e', '#8e8fa8'],
        [0.25, '#2b5aa8', '#5d9ae0', '#c98a64'],
        [0.32, '#9c5634', '#b26c44', '#c4875c'],
        [0.5, '#a45c36', '#ba7448', '#cc9064'],
        [0.68, '#9c5634', '#b26c44', '#c4875c'],
        [0.74, '#8a4c34', '#a8684a', '#bf8660'],
        [0.775, '#1f3f80', '#3f7fd0', '#6fa6d8'],
        [0.83, '#26305a', '#3a4a78', '#6c7496'],
        [1.0, '#27304f', '#3d4a72', '#6c7496'],
    ],
    dark: [
        [0.0, '#07080f', '#0c0f1d', '#171a2b'],
        [0.2, '#080b18', '#101732', '#22223a'],
        [0.25, '#0c1a3c', '#1b3a78', '#7a4a38'],
        [0.32, '#1c1210', '#3a1e14', '#7a3a1c'],
        [0.5, '#24140f', '#4a2412', '#8e4518'],
        [0.68, '#20120e', '#432010', '#843f18'],
        [0.74, '#150f14', '#2e1a1c', '#6e3a24'],
        [0.775, '#081230', '#123a80', '#2f7fd0'],
        [0.83, '#07080f', '#0d1022', '#1a1b30'],
        [1.0, '#07080f', '#0c0f1d', '#171a2b'],
    ],
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c, a = 1) => `rgb(${c[0]} ${c[1]} ${c[2]} / ${a})`;
const smooth = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
};
function skyAt(p, dark) {
    const table = SKY[dark ? 'dark' : 'light'];
    for (let i = 0; i < table.length - 1; i++) {
        const [p0, ...a] = table[i];
        const [p1, ...b] = table[i + 1];
        if (p >= p0 && p <= p1) {
            const t = smooth(0, 1, (p - p0) / (p1 - p0));
            return a.map((c, j) => mix(hex(c), hex(b[j]), t));
        }
    }
    return table[0].slice(1).map((c) => hex(c));
}
const altitude = (p) => Math.cos(2 * Math.PI * (p - 0.5));
const nightAt = (p) => smooth(0.1, -0.12, altitude(p));
function drawSky(p) {
    const dark = isDark();
    const [zenith, midSky, horizon] = skyAt(p, dark);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(zenith));
    g.addColorStop(0.55, rgb(midSky));
    g.addColorStop(1, rgb(horizon));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const alt = altitude(p);
    if (alt <= -0.18)
        return;
    const theta = 2 * Math.PI * (p - 0.5);
    const sx = W / 2 + W * 0.46 * Math.sin(theta);
    const sy = H * 0.97 - H * 0.81 * Math.max(alt, -0.1);
    const breath = 1 + 0.06 * Math.sin((Date.now() / 1000) * ((2 * Math.PI) / 90));
    const R = Math.max(W, H) * (0.24 + 0.12 * (1 - Math.max(0, alt))) * breath;
    const glow = mix([70, 150, 255], [255, 226, 190], smooth(0.08, 0.38, alt));
    const strength = (dark ? 0.55 : 0.6) * smooth(-0.18, 0.02, alt) * (1 - 0.5 * smooth(0.05, 0.4, alt));
    const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, R);
    rg.addColorStop(0, rgb(glow, strength));
    rg.addColorStop(0.3, rgb(glow, strength * 0.4));
    rg.addColorStop(1, rgb(glow, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
    if (alt > -0.02) {
        ctx.globalAlpha = 0.92 * smooth(-0.02, 0.04, alt);
        ctx.fillStyle = '#fffaf0';
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(4, Math.min(W, H) * 0.009), 0, 7);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}
const LAYERS = [
    [0.12, 0.5, 0.85, 0.6, 0.55],
    [0.3, 0.75, 1.15, 0.75, 0.85],
    [0.6, 1.05, 1.55, 0.9, 1],
];
const WARM = [255, 246, 236];
const TINTS = [WARM, WARM, WARM, WARM, [200, 220, 255], [255, 222, 184]];
let stars = [];
function seedStars() {
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const count = Math.round(Math.min(240, Math.max(80, (W * H) / 6000)));
    stars = Array.from({ length: count }, () => {
        const roll = rand();
        const [z, lo, hi, alpha] = LAYERS.find((l) => roll < l[4]);
        return {
            z,
            alpha,
            px: lo + rand() * (hi - lo),
            u: rand(),
            v: rand(),
            period: 3 + rand() * 6,
            tw: rand() * Math.PI * 2,
            tint: TINTS[Math.floor(rand() * TINTS.length)],
        };
    });
}
const scrolled = () => window.scrollY;
let lastY = scrolled();
let lastT = performance.now();
let vel = 0;
function drawStars(p, night) {
    const y0 = scrolled();
    const dy = y0 - lastY;
    const ms = performance.now();
    const k = Math.max(1, ms - lastT) / (1000 / 60);
    lastY = y0;
    lastT = ms;
    vel = dy ? vel + (dy / k - vel) * 0.5 : vel * 0.955 ** k;
    if (Math.abs(vel) < 0.02)
        vel = 0;
    const pad = 40;
    const P = H * 1.2;
    const cx = W / 2;
    const cy = H + P;
    const band = H + 2 * pad;
    const now = Date.now() / 1000;
    const omega = W / 100 / (P + H / 2);
    const seen = 0.92 + 0.08 * night;
    for (const s of stars) {
        const radius = P - pad + s.v * band;
        const half = Math.asin(Math.min(1, (W / 2 + pad) / radius));
        const span = 2 * half;
        const a = -half + ((((s.u * span + omega * (1 + 0.3 * s.z) * now) % span) + span) % span);
        const x = cx + radius * Math.sin(a);
        let y = cy - radius * Math.cos(a) - y0 * s.z * 0.35;
        y = ((((y + pad) % band) + band) % band) - pad;
        const twinkle = 0.6 + 0.4 * Math.sin(now * ((2 * Math.PI) / s.period) + s.tw);
        const { tint } = s;
        const alpha = s.alpha * seen * twinkle;
        const len = Math.min(90, Math.abs(vel) * s.z * 5);
        if (len > 1.5) {
            const tail = y + Math.sign(vel) * len;
            const streak = ctx.createLinearGradient(x, y, x, tail);
            streak.addColorStop(0, rgb(tint, alpha * 0.6));
            streak.addColorStop(1, rgb(tint, 0));
            ctx.strokeStyle = streak;
            ctx.lineWidth = s.px;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x, tail);
            ctx.stroke();
        }
        ctx.fillStyle = rgb(tint, alpha);
        ctx.beginPath();
        ctx.arc(x, y, s.px, 0, 7);
        ctx.fill();
    }
    const earth = night * smooth(0.77, 0.81, p) * smooth(0.97, 0.9, p);
    if (earth > 0.01) {
        const radius = P + H * 0.35;
        const half = Math.asin(Math.min(1, (W / 2 + pad) / radius));
        const a = -half + 2 * half * (0.45 + (p - 0.77) * 2);
        const ex = cx + radius * Math.sin(a);
        const ey = cy - radius * Math.cos(a) - y0 * 0.042;
        ctx.fillStyle = rgb([184, 214, 255], earth);
        ctx.beginPath();
        ctx.arc(ex, ey, 2, 0, 7);
        ctx.fill();
    }
}


  let terrainFrame;
  let paintTerrain = () => {};
  let resizeTerrain = () => {};
  let frame = 0;
  let previousTerrainPhase;
  let previousTerrainScroll;
  let previousNight = -1;

  function paint() {
    frame = 0;
    if (!ctx || !terrainFrame || !W || !H || isStill() || document.hidden) return;
    const p = phase();
    const night = nightAt(p);
    const scroll = window.scrollY;
    const nightStep = Math.round(night * 100);
    if (nightStep !== previousNight) {
      root.style.setProperty('--night', String(nightStep / 100));
      root.dataset.light = nightStep > 50 ? 'night' : 'day';
      previousNight = nightStep;
    }
    const terrainPhase = Math.round(p * 1200);
    if (terrainPhase !== previousTerrainPhase || scroll !== previousTerrainScroll) {
      paintTerrain(scroll, p, night);
      previousTerrainPhase = terrainPhase;
      previousTerrainScroll = scroll;
    }

    // Present one complete, opaque frame. Resizing an on-screen layer outside
    // this callback would clear it while the other layers were still visible.
    if (canvas.width !== terrainFrame.width || canvas.height !== terrainFrame.height) {
      canvas.width = terrainFrame.width;
      canvas.height = terrainFrame.height;
    }
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    drawSky(p);
    drawStars(p, night);
    ctx.drawImage(terrainFrame, 0, 0, W, H);
    if (root.dataset.terrain !== 'live') root.dataset.terrain = 'live';
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(paint);
  }

  function resize() {
    const width = landscape.clientWidth;
    const height = landscape.clientHeight;
    if (!width || !height || (width === W && height === H)) return;
    W = width;
    H = height;
    seedStars();
    resizeTerrain();
    previousTerrainPhase = undefined;
    schedule();
  }

  function refreshTheme() {
    previousTerrainPhase = undefined;
    schedule();
  }

  let timer;
  let loadingTerrain = false;

  function showStill() {
    delete root.dataset.terrain;
    delete root.dataset.light;
    root.style.removeProperty('--night');
    previousNight = -1;
  }

  function refreshMotion() {
    clearInterval(timer);
    timer = undefined;
    pause.hidden = reduceMotion.matches || forcedColors.matches;
    pause.setAttribute('aria-pressed', String(paused));
    if (isStill()) {
      showStill();
    } else {
      if (!document.hidden) timer = setInterval(schedule, 100);
      enableTerrain();
    }
    refreshTheme();
  }

  pause.addEventListener('click', () => {
    paused = !paused;
    try { sessionStorage.setItem('field-notes-motion-paused', String(paused)); } catch {}
    refreshMotion();
  });
  new ResizeObserver(resize).observe(landscape);
  window.addEventListener('scroll', () => {
    if (!isStill()) schedule();
  }, { passive:true });
  reduceMotion.addEventListener('change', refreshMotion);
  forcedColors.addEventListener('change', refreshMotion);
  darkQuery.addEventListener('change', refreshTheme);
  document.addEventListener('visibilitychange', refreshMotion);

  function startTerrain(THREE) {
    const surface = document.createElement('canvas');
    const snapshot = document.createElement('canvas');
    const snapshotContext = snapshot.getContext('2d');
    if (!snapshotContext) return;
    const renderer = new THREE.WebGLRenderer({ canvas:surface, alpha:true, antialias:true });
    const scene = new THREE.Scene();
    const fog = new THREE.FogExp2('#6c7496', .027);
    scene.fog = fog;
    const canyon = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(61, 1, .1, 195);
    scene.add(canyon);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(380, 340), new THREE.MeshBasicMaterial());
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = -90;
    scene.add(floor);
    const floorDay = new THREE.Color('#905849');
    const floorNight = new THREE.Color('#34324b');
    const rockDay = new THREE.Color('#ffffff');
    const rockNight = new THREE.Color('#8289bf');
    const rock = new THREE.MeshBasicMaterial({ vertexColors:true, side:THREE.DoubleSide });

    const strata = [0, .19, .28, .45, .51, .64, .79, .89, 1, 1.02];
    const bands = strata.length - 1;
    const palette = ['#694036','#7d483c','#9b5a47','#79453c','#a9604e','#8c4e43','#aa6655','#8e5047','#b67762'].map(value => new THREE.Color(value));
    const segments = 53;
    const spacing = 2.45;
    const lookBehind = 5;
    const centerAt = distance => 1.65 * Math.sin(distance * .073) + .63 * Math.sin(distance * .031);
    const walls = [-1, 1].map(side => {
      const geometry = new THREE.BufferGeometry();
      for (const key of ['position','color']) {
        geometry.setAttribute(key, new THREE.BufferAttribute(new Float32Array(segments * bands * 18), 3).setUsage(THREE.DynamicDrawUsage));
      }
      const mesh = new THREE.Mesh(geometry, rock);
      mesh.frustumCulled = false;
      canyon.add(mesh);
      return { side, geometry };
    });
    let previousCell;

    // Recycle the same visible strip around the camera. Sampling by world
    // distance makes crossing a strip boundary or scrolling back seamless.
    function updateWalls(cell) {
      if (cell === previousCell) return;
      previousCell = cell;
      for (const { side, geometry } of walls) {
        const position = geometry.getAttribute('position');
        const color = geometry.getAttribute('color');
        const sections = Array.from({length:segments + 1}, (_, local) => {
          const index = cell + local - lookBehind;
          const distance = index * spacing;
          const z = (lookBehind - local) * spacing;
          const opening = THREE.MathUtils.smoothstep(Math.sin((distance - 16) * .038), .06, .96);
          const wave = Math.sin(index * .69 + side) + .31 * Math.sin(index * 2.35);
          const width = 4.55 + .73 * wave + opening * 10.8;
          const height = (8.3 + wave * 1.42 + .6 * side) * (1 - .59 * opening);
          return strata.map((level, band) => [
            centerAt(distance) + side * (width + level * 1.85 + .42 * Math.sin(band * 1.8 + index * .48) + (band === 9 ? 16 : 0)),
            height * level, z
          ]);
        });

        let vertex = 0;
        for (let local = 0; local < segments; local++) {
          const near = sections[local];
          const far = sections[local + 1];
          for (let band = 0; band < bands; band++) {
            const variation = .91 + .1 * Math.sin((cell + local - lookBehind) * 1.42 + band * .62) + .035 * side;
            const shade = palette[band];
            for (const point of [near[band], far[band], near[band + 1], near[band + 1], far[band], far[band + 1]]) {
              position.setXYZ(vertex, ...point);
              color.setXYZ(vertex++, shade.r * variation, shade.g * variation, shade.b * variation);
            }
          }
        }
        position.needsUpdate = true;
        color.needsUpdate = true;
      }
    }

    resizeTerrain = () => {
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      canyon.scale.x = THREE.MathUtils.clamp(camera.aspect * .72, .39, 1);
    };

    paintTerrain = (scroll, p, night) => {
      const travel = Math.max(0, scroll) * .0355;
      const cell = Math.floor(travel / spacing);
      const z = cell * spacing - travel;
      updateWalls(cell);
      const x = centerAt(travel) * canyon.scale.x;
      camera.position.set(x, 2.58, z);
      camera.lookAt(THREE.MathUtils.lerp(x, centerAt(travel + 14) * canyon.scale.x, .62), 2.18, z - 14);
      const [red, green, blue] = skyAt(p, isDark())[2];
      fog.color.setRGB(red / 255, green / 255, blue / 255, THREE.SRGBColorSpace);
      floor.material.color.copy(floorDay).lerp(floorNight, night);
      rock.color.copy(rockDay).lerp(rockNight, night);
      renderer.render(scene, camera);
      // Copy synchronously while WebGL's non-preserved drawing buffer is valid.
      // The cached terrain also serves frames where only the sky moves.
      if (snapshot.width !== surface.width || snapshot.height !== surface.height) {
        snapshot.width = surface.width;
        snapshot.height = surface.height;
      }
      snapshotContext.globalCompositeOperation = 'copy';
      snapshotContext.drawImage(surface, 0, 0);
    };

    surface.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      terrainFrame = undefined;
      showStill();
    });
    surface.addEventListener('webglcontextrestored', () => {
      terrainFrame = snapshot;
      refreshTheme();
    });
    terrainFrame = snapshot;
    if (W && H) resizeTerrain();
    refreshTheme();
  }

  async function enableTerrain() {
    if (!ctx || loadingTerrain) return;
    loadingTerrain = true;
    try {
      const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.179.1/build/three.module.min.js');
      startTerrain(THREE);
    } catch {
      // The static canyon remains visible if WebGL or the module is unavailable.
    }
  }

  refreshMotion();
