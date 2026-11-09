// AMC sol palette and sky/star field adapted from Mission Control Site.
// AMC sol palette and sky/star field adapted from Mission Control Site.
  const root = document.body;
  const landscape = root.querySelector('.canyon-landscape');
  const canvas = root.querySelector('.canyon-frame');
  const motionButton = root.querySelector('.motion-control');
  let paused = false;
  const ctx = canvas.getContext('2d', { alpha:false });
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const forcedColors = matchMedia('(forced-colors: active)');
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  let started = Date.now();
  try {
    const saved = Number(sessionStorage.getItem('field-notes-sol-start'));
    if (saved > 0 && saved <= started) started = saved;
    sessionStorage.setItem('field-notes-sol-start', String(started));
    paused = sessionStorage.getItem('field-notes-motion-paused') === 'true';
  } catch {}
  const isStill = () => paused || reduceMotion.matches || forcedColors.matches;
  const isDark = () => document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : darkQuery.matches;
  let paletteBlend = Number(isDark());
  let paletteChange;
  const phase = () => phaseSince(Date.now() - started);
  let W = 0;
  let H = 0;
  let displayedPath = location.pathname;
  const UP_ANGLE = 24;
  const ASCENT_ANGLE = 44;
  const STATE_KEY = 'field-notes-camera-v1';
  const FRAME_KEY = STATE_KEY + '-frame';
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null'); } catch {}
  const restoreNumber = value => Number.isFinite(value) ? Math.max(0, value) : 0;
  const initialArticle = root.dataset.fieldView === 'article';
  const samePath = saved?.pathname === location.pathname;
  let feedScroll = restoreNumber(saved?.feedScroll);
  if (!samePath && !initialArticle) feedScroll = 0;
  let lift = samePath ? Math.min(1, restoreNumber(saved?.lift)) : Number(initialArticle);
  let previousLift;
  let travelAnimation;
  if (lift !== Number(initialArticle)) startAscent(Number(initialArticle));
  history.scrollRestoration = 'manual';
  if (samePath) window.scrollTo(0, restoreNumber(saved.scroll));

  function startAscent(target) {
    travelAnimation = lift === target ? undefined : {
      from:lift, target, duration:Math.max(270, 1050 * Math.abs(target - lift))
    };
  }

  function savePosition() {
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify({
        pathname:location.pathname, scroll:Math.max(0, window.scrollY), feedScroll, lift
      }));
    } catch {}
  }

  function saveVisibleFrame() {
    savePosition();
    if (!ctx || isStill() || root.dataset.terrain !== 'live') return;
    try {
      const thumbnail = document.createElement('canvas');
      thumbnail.width = Math.min(900, canvas.width);
      thumbnail.height = Math.round(canvas.height * thumbnail.width / canvas.width);
      thumbnail.getContext('2d').drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
      sessionStorage.setItem(FRAME_KEY, JSON.stringify({
        image:thumbnail.toDataURL('image/webp', .83), width:W, height:H, pathname:location.pathname, lift, feedScroll
      }));
    } catch {}
  }

  async function restoreVisibleFrame() {
    if (!samePath || !ctx || isStill() || typeof createImageBitmap !== 'function') return;
    try {
      const cached = JSON.parse(sessionStorage.getItem(FRAME_KEY) || 'null');
      if (!cached || cached.pathname !== saved.pathname || cached.lift !== saved.lift || cached.feedScroll !== saved.feedScroll) return;
      if (cached.width !== landscape.clientWidth || cached.height !== landscape.clientHeight) return;
      const [header, encoded] = cached.image.split(',');
      const type = header.slice(5, header.indexOf(';'));
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type }));
      if (root.dataset.terrain !== 'live' && !isStill()) {
        canvas.width = image.width;
        canvas.height = image.height;
        ctx.drawImage(image, 0, 0);
        root.dataset.terrain = 'cached';
      }
      image.close();
    } catch {}
  }

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
function scenePalette(p) {
    if (paletteBlend === 0 || paletteBlend === 1) return skyAt(p, paletteBlend === 1);
    const light = skyAt(p, false);
    const dark = skyAt(p, true);
    return light.map((color, index) => mix(color, dark[index], paletteBlend));
}
function drawSky(colors, p) {
    const [zenith, midSky, horizon] = colors;
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
    const strength = (0.6 - 0.05 * paletteBlend) * smooth(-0.18, 0.02, alt) * (1 - 0.5 * smooth(0.05, 0.4, alt));
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
const scrolled = () => feedScroll;
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
  let previousPaletteBlend;

  function paint(now) {
    frame = 0;
    if (!ctx || !terrainFrame || !W || !H || isStill() || document.hidden) return;
    const p = phase();
    const night = nightAt(p);
    const scroll = feedScroll;
    if (travelAnimation) {
      const move = travelAnimation;
      move.started ??= now;
      const progress = Math.min(1, (now - move.started) / move.duration);
      const eased = progress * progress * (3 - 2 * progress);
      lift = move.from + (move.target - move.from) * eased;
      if (progress === 1) {
        lift = move.target;
        travelAnimation = undefined;
        savePosition();
      }
    }
    if (paletteChange) {
      const change = paletteChange;
      change.started ??= now;
      const progress = Math.min(1, (now - change.started) / 350);
      paletteBlend = change.from + (change.target - change.from) * progress;
      if (progress === 1) paletteChange = undefined;
    }
    const colors = scenePalette(p);
    const terrainPhase = Math.round(p * 1200);
    if (terrainPhase !== previousTerrainPhase || scroll !== previousTerrainScroll || lift !== previousLift || paletteBlend !== previousPaletteBlend) {
      paintTerrain(scroll, night, lift, colors[2]);
      previousPaletteBlend = paletteBlend;
      previousLift = lift;
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
    drawSky(colors, p);
    drawStars(p, night);
    ctx.drawImage(terrainFrame, 0, 0, W, H);
    if (travelAnimation || paletteChange) schedule();
    if (root.dataset.terrain !== 'live') root.dataset.terrain = 'live';
  }

  function schedule() {
    if (ctx && terrainFrame && !frame) frame = requestAnimationFrame(paint);
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
  }

  function refreshMotion() {
    clearInterval(timer);
    timer = undefined;
    motionButton.hidden = reduceMotion.matches || forcedColors.matches;
    motionButton.setAttribute('aria-pressed', String(paused));
    if (isStill()) {
      paletteBlend = Number(isDark());
      paletteChange = undefined;
      showStill();
    } else {
      if (!document.hidden) timer = setInterval(schedule, 100);
      enableTerrain();
    }
    refreshTheme();
  }

  const menu = root.querySelector('.explore');
  const menuButton = menu.querySelector('summary');
  const home = root.querySelector('.site-title');
  const homeURL = new URL(home.href);
  const main = root.querySelector('main');
  const isFeed = () => main.dataset.fieldView === 'feed';

  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      event.preventDefault();
      menu.open = false;
      menuButton.focus();
    }
  });
  root.addEventListener('click', event => {
    if (menu.open && (!menu.contains(event.target) || event.target.closest('.explore-panel a'))) {
      const returnFocus = menu.contains(document.activeElement);
      menu.open = false;
      if (returnFocus) menuButton.focus();
    }
  });
  menu.addEventListener('focusout', event => {
    if (event.relatedTarget && !menu.contains(event.relatedTarget)) menu.open = false;
  });

  let pendingPage;
  const isFieldNotesURL = url => url.origin === homeURL.origin
    && (url.pathname === homeURL.pathname || url.pathname.startsWith(homeURL.pathname + 'posts/'));

  async function openPage(url, { push, offset }) {
    pendingPage?.abort();
    const request = new AbortController();
    pendingPage = request;
    try {
      const response = await fetch(url, { signal:request.signal });
      if (!response.ok) throw new Error('Page unavailable');
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      if (request.signal.aborted) return;
      const nextMain = page.querySelector('main[data-field-view]');
      if (!nextMain || !isFieldNotesURL(new URL(response.url))) throw new Error('Page layout unavailable');

      if (push) {
        history.replaceState({ fieldScroll:window.scrollY }, '');
        history.pushState({ fieldScroll:offset }, '', url);
      }
      const wasFeed = isFeed();
      main.dataset.fieldView = nextMain.dataset.fieldView;
      displayedPath = location.pathname;
      main.replaceChildren(...Array.from(nextMain.childNodes, node => document.importNode(node, true)));
      document.title = page.title;
      for (const selector of ['link[rel="canonical"]', 'meta[name="description"]']) {
        const replacement = page.querySelector(selector);
        if (replacement) document.querySelector(selector)?.replaceWith(document.importNode(replacement, true));
      }
      root.dataset.fieldView = main.dataset.fieldView;
      window.scrollTo(0, offset);
      main.focus({ preventScroll:true });
      if (isFeed()) feedScroll = offset;
      if (isFeed() !== wasFeed) startAscent(Number(!isFeed()));
      savePosition();
      schedule();
    } catch {
      if (!request.signal.aborted) location.assign(url);
    } finally {
      if (pendingPage === request) pendingPage = undefined;
    }
  }

  root.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey ||
        event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
    const url = new URL(link.href);
    if (!isFieldNotesURL(url) || url.hash || url.search || url.pathname === location.pathname) return;
    event.preventDefault();
    void openPage(url, { push:true, offset:url.pathname === homeURL.pathname ? feedScroll : 0 });
  });
  window.addEventListener('popstate', event => {
    const url = new URL(location.href);
    if (!isFieldNotesURL(url)) return;
    // Native fragment changes keep the current document.
    if (url.pathname === displayedPath) {
      pendingPage?.abort();
      return;
    }
    void openPage(url, { push:false, offset:restoreNumber(event.state?.fieldScroll) });
  });

  new ResizeObserver(resize).observe(landscape);
  window.addEventListener('scroll', () => {
    if (isFeed()) {
      feedScroll = Math.max(0, window.scrollY);
      schedule();
    }
  }, { passive:true });
  window.addEventListener('pagehide', saveVisibleFrame);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveVisibleFrame();
  });
  motionButton.addEventListener('click', () => {
    paused = !paused;
    try { sessionStorage.setItem('field-notes-motion-paused', String(paused)); } catch {}
    refreshMotion();
  });
  reduceMotion.addEventListener('change', refreshMotion);
  forcedColors.addEventListener('change', refreshMotion);
  const themeButtons = [...root.querySelectorAll('[data-scheme]')];
  root.querySelector('.theme-switch').hidden = false;
  function reflectTheme() {
    const selected = document.documentElement.dataset.theme || 'system';
    for (const button of themeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.scheme === selected));
    }
    const target = Number(isDark());
    if (isStill()) {
      paletteBlend = target;
      paletteChange = undefined;
    } else if (target !== paletteBlend) {
      paletteChange = { from:paletteBlend, target };
    } else {
      paletteChange = undefined;
    }
    refreshTheme();
  }
  for (const button of themeButtons) {
    button.addEventListener('click', () => {
      const selected = button.dataset.scheme;
      if (selected === 'system') delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = selected;
      try {
        if (selected === 'system') localStorage.removeItem('field-notes-theme');
        else localStorage.setItem('field-notes-theme', selected);
      } catch {}
      reflectTheme();
    });
  }
  darkQuery.addEventListener('change', () => {
    if (!document.documentElement.dataset.theme) reflectTheme();
  });
  reflectTheme();
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

    const rockDay = new THREE.Color('#ffffff');
    const rockNight = new THREE.Color('#8b91ce');
    const horizonTint = new THREE.Color();
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
          const width = 3.9 + .68 * wave + opening * 1.75;
          const height = 13 + wave * 2.05 + .75 * side - 1.55 * opening;
          return strata.map((level, band) => [
            centerAt(distance) + side * (width + level * 1.85 + .42 * Math.sin(band * 1.8 + index * .48) + (band === 9 ? 16 : 0)),
            band === 0 ? -14 : height * level, z
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

    paintTerrain = (scroll, night, elevation, horizonColor) => {
      const travel = Math.max(0, scroll) * .0355;
      const cell = Math.floor(travel / spacing);
      const z = cell * spacing - travel;
      updateWalls(cell);
      const x = centerAt(travel) * canyon.scale.x;
      const height = 2.58 + elevation * 36;
      const angle = THREE.MathUtils.lerp(UP_ANGLE, ASCENT_ANGLE, elevation);
      camera.position.set(x, height, z);
      camera.lookAt(THREE.MathUtils.lerp(x, centerAt(travel + 14) * canyon.scale.x, .62), height + Math.tan(angle * Math.PI / 180) * 14, z - 14);
      const [red, green, blue] = horizonColor;
      fog.color.setRGB(red / 255, green / 255, blue / 255, THREE.SRGBColorSpace);
      horizonTint.copy(fog.color);
      rock.color.copy(rockDay).lerp(rockNight, night).lerp(horizonTint, .25);
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

  restoreVisibleFrame();
  refreshMotion();
