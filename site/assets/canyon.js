// AMC sol palette adapted from Mission Control Site.
import { createCanyonStars, createCanyonSun } from './canyon-sky.js';

  const root = document.body;
  const landscape = root.querySelector('.canyon-landscape');
  const canvas = root.querySelector('.canyon-frame');
  const poster = root.querySelector('.canyon-poster');
  const skyCanvas = document.createElement('canvas');
  const ctx = skyCanvas.getContext('2d', { alpha:false });
  const coarsePointer = matchMedia('(pointer: coarse)');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const forcedColors = matchMedia('(forced-colors: active)');
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  let started = Date.now();
  try {
    const saved = Number(sessionStorage.getItem('field-notes-sol-start'));
    if (saved > 0 && saved <= started) started = saved;
    sessionStorage.setItem('field-notes-sol-start', String(started));
  } catch {}
  const isStill = () => reduceMotion.matches || forcedColors.matches;
  const isDark = () => document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : darkQuery.matches;
  let paletteBlend = Number(isDark());
  let paletteChange;
  const phase = () => phaseSince(Date.now() - started);
  let W = 0;
  let H = 0;
  let displayedPath = location.pathname;
  const FEED_ANGLE = 4;
  const ASCENT_ANGLE = 44;
  const SCROLL_FRAME_MS = 1000 / 60;
  const SCROLL_RETENTION = .9;
  const SCROLL_SETTLE_PX = .5;
  const AUTOPLAY_PX_PER_MS = .062;
  const STAR_FRAME_MS = 1000 / 30;
  const STATE_KEY = 'field-notes-camera-v1';
  const FRAME_KEY = STATE_KEY + '-frame-v4';
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null'); } catch {}
  const restoreNumber = value => Number.isFinite(value) ? Math.max(0, value) : 0;
  const initialArticle = root.dataset.fieldView === 'article';
  const samePath = saved?.pathname === location.pathname;
  let feedScroll = restoreNumber(saved?.feedScroll);
  let cameraScroll = restoreNumber(saved?.cameraScroll ?? feedScroll);
  let autoplayDistance = restoreNumber(saved?.autoplayDistance);
  let autoplay = false;
  if (!samePath && !initialArticle) {
    feedScroll = 0;
    cameraScroll = 0;
    autoplayDistance = 0;
  }
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
        pathname:location.pathname, scroll:Math.max(0, window.scrollY), feedScroll, cameraScroll, lift, autoplayDistance
      }));
    } catch {}
  }

  let captureFrame;

  function saveVisibleFrame() {
    savePosition();
    if (!captureFrame || isStill() || root.dataset.terrain !== 'live') return;
    try {
      // Read back once for reload continuity, never during an on-screen frame.
      captureFrame();
      const thumbnail = document.createElement('canvas');
      thumbnail.width = Math.min(900, canvas.width);
      thumbnail.height = Math.round(canvas.height * thumbnail.width / canvas.width);
      thumbnail.getContext('2d').drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
      sessionStorage.setItem(FRAME_KEY, JSON.stringify({
        image:thumbnail.toDataURL('image/webp', .83), width:W, height:H, pathname:location.pathname, lift, cameraScroll
      }));
    } catch {}
  }

  async function restoreVisibleFrame() {
    if (!samePath || !ctx || isStill() || typeof createImageBitmap !== 'function') return;
    try {
      const cached = JSON.parse(sessionStorage.getItem(FRAME_KEY) || 'null');
      if (!cached || cached.pathname !== saved.pathname || cached.lift !== saved.lift
        || (cached.cameraScroll ?? cached.feedScroll) !== (saved.cameraScroll ?? saved.feedScroll)) return;
      if (cached.width !== landscape.clientWidth || cached.height !== landscape.clientHeight) return;
      const [header, encoded] = cached.image.split(',');
      const type = header.slice(5, header.indexOf(';'));
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type }));
      if (root.dataset.terrain !== 'live' && !isStill()) {
        const posterContext = poster.getContext('2d');
        if (posterContext) {
          poster.width = image.width;
          poster.height = image.height;
          posterContext.drawImage(image, 0, 0);
          root.dataset.terrain = 'cached';
        }
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
function drawSky(colors) {
    const [zenith, midSky, horizon] = colors;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(zenith));
    g.addColorStop(0.55, rgb(midSky));
    g.addColorStop(1, rgb(horizon));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
}
  let renderTerrain;
  let resizeTerrain;
  let frame = 0;
  let needsResize = true;
  let previousSkyPhase;
  let nextSkyUpdate = 0;
  let nextStarFrame = 0;
  let previousScrollFrame;
  let previousPaletteBlend;

  function paint(now) {
    frame = 0;
    if (isStill()) {
      if (root.dataset.terrain) refreshMotion();
      return;
    }
    if (!renderTerrain || !W || !H || document.hidden) return;
    const p = phase();
    const night = nightAt(p);
    const elapsed = previousScrollFrame === undefined ? SCROLL_FRAME_MS : now - previousScrollFrame;
    if (autoplay) autoplayDistance += Math.min(elapsed, 80) * AUTOPLAY_PX_PER_MS;
    const target = feedScroll + autoplayDistance;
    const distance = target - cameraScroll;
    // Draw the restored position first, then ease at the same rate across refresh rates.
    const scroll = previousLift === undefined ? cameraScroll
      : Math.abs(distance) <= SCROLL_SETTLE_PX ? target
      : cameraScroll + distance * (1 - SCROLL_RETENTION ** (elapsed / SCROLL_FRAME_MS));
    previousScrollFrame = !autoplay && scroll === target ? undefined : now;
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
    if (needsResize) {
      resizeTerrain();
      needsResize = false;
      previousSkyPhase = undefined;
    }
    const skyPhase = Math.round(p * 1200);
    const skyChanged = previousSkyPhase === undefined || paletteBlend !== previousPaletteBlend
      || (now >= nextSkyUpdate && skyPhase !== previousSkyPhase);
    let horizonColor;
    let skyEdgeColor;
    if (skyChanged) {
      const colors = scenePalette(p);
      drawSky(colors);
      // At the feed camera's shallow pitch, distant terrain meets the middle sky.
      horizonColor = colors[1];
      skyEdgeColor = colors[2];
      previousSkyPhase = skyPhase;
      nextSkyUpdate = now + 250;
      previousPaletteBlend = paletteBlend;
    }
    if (skyChanged || scroll !== cameraScroll || lift !== previousLift || now >= nextStarFrame) {
      renderTerrain(scroll, night, lift, horizonColor, skyEdgeColor, now, p);
      nextStarFrame = now + STAR_FRAME_MS - 1;
      previousLift = lift;
      cameraScroll = scroll;
      if (root.dataset.terrain !== 'live') {
        root.dataset.terrain = 'live';
        updatePlayButton();
      }
    }

    if (previousScrollFrame !== undefined || travelAnimation || paletteChange) schedule();
  }

  function schedule() {
    if (renderTerrain && !frame) frame = requestAnimationFrame(paint);
  }

  function resize() {
    const width = landscape.clientWidth;
    const height = landscape.clientHeight;
    if (!width || !height || (width === W && height === H)) return;
    W = width;
    H = height;
    needsResize = true;
    schedule();
  }

  function refreshTheme() {
    previousSkyPhase = undefined;
    schedule();
  }

  let timer;
  let loadingTerrain = false;

  function setAutoplay(mode) {
    autoplay = Boolean(mode);
    if (mode) root.dataset.canyonAutoplay = mode;
    else delete root.dataset.canyonAutoplay;
    playButton.setAttribute('aria-pressed', String(autoplay));
    playButton.title = autoplay ? 'Pause canyon ride' : 'Play canyon ride with sound';
    syncRideAudio();
    if (autoplay) schedule();
  }

  function stopAutoplay() {
    if (autoplay) setAutoplay();
  }

  function showStill() {
    stopAutoplay();
    delete root.dataset.terrain;
    updatePlayButton();
    document.documentElement.style.removeProperty('--canyon-live-edge');
  }

  function refreshMotion() {
    clearInterval(timer);
    timer = undefined;
    previousScrollFrame = undefined;
    if (isStill()) {
      paletteBlend = Number(isDark());
      paletteChange = undefined;
      showStill();
    } else {
      if (!document.hidden) timer = setInterval(schedule, STAR_FRAME_MS);
      enableTerrain();
    }
    refreshTheme();
  }

  const menu = root.querySelector('.explore');
  const menuButton = menu.querySelector('summary');
  const menuPanel = menu.querySelector('.explore-panel');
  const playButton = root.querySelector('.canyon-play');
  let rideAudioContext;
  let rideAudioLoading;
  let rideSoundEnabled = false;

  async function startRideLoop(context) {
    const response = await fetch(new URL('./ride-d-minor-swells.wav', import.meta.url));
    if (!response.ok) throw new Error('Ride soundtrack unavailable');
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(context.destination);
    source.start();
  }

  function pauseRideAudio() {
    rideAudioContext?.suspend().catch(() => {});
  }

  function syncRideAudio() {
    if (!autoplay || !rideSoundEnabled || document.hidden) {
      pauseRideAudio();
      return;
    }
    if (!window.AudioContext) return;
    rideAudioContext ??= new AudioContext({ sampleRate: 48000 });
    void rideAudioContext.resume().catch(() => {});
    rideAudioLoading ??= startRideLoop(rideAudioContext).catch(error => {
      rideAudioLoading = undefined;
      console.warn(error);
    });
  }

  window.addEventListener('pagehide', pauseRideAudio);
  window.addEventListener('pageshow', syncRideAudio);
  document.addEventListener('visibilitychange', syncRideAudio);
  const home = root.querySelector('.site-title');
  const homeURL = new URL(home.href);
  const main = root.querySelector('main');
  const isFeed = () => main.dataset.fieldView === 'feed';
  let menuAnimation;
  let menuClosing = false;

  function syncMenu(open) {
    menuPanel.inert = !open;
    menuButton.setAttribute('aria-expanded', String(open));
  }

  function setMenuOpen(open) {
    const current = menuAnimation && getComputedStyle(menuPanel);
    const from = current ? { transform:current.transform, opacity:current.opacity }
      : { transform:open ? 'translateY(-12px)' : 'translateY(0)', opacity:open ? 0 : 1 };
    menuAnimation?.cancel();
    menuAnimation = undefined;
    menuClosing = !open;
    syncMenu(open);
    if (reduceMotion.matches || !menuPanel.animate) {
      menu.open = open;
      menuClosing = false;
      return;
    }

    // Keep the native details open until the exit motion has finished.
    if (open) menu.open = true;
    const animation = menuPanel.animate([
      from, { transform:open ? 'translateY(0)' : 'translateY(-12px)', opacity:open ? 1 : 0 }
    ], {
      duration:open ? 320 : 280,
      easing:open ? 'cubic-bezier(.2,1.5,.42,1)' : 'cubic-bezier(.44,-.28,.68,1)',
      fill:'both'
    });
    menuAnimation = animation;
    animation.onfinish = () => {
      if (menuAnimation !== animation) return;
      menu.open = open;
      menuClosing = false;
      menuAnimation = undefined;
      animation.cancel();
    };
  }

  syncMenu(menu.open);
  menuButton.addEventListener('click', event => {
    event.preventDefault();
    setMenuOpen(!menu.open || menuClosing);
  });
  menu.addEventListener('toggle', () => {
    if (!menuAnimation) syncMenu(menu.open);
  });
  reduceMotion.addEventListener('change', () => {
    if (reduceMotion.matches && menuAnimation) setMenuOpen(!menuClosing);
  });

  function updatePlayButton() {
    playButton.hidden = !isFeed() || root.dataset.terrain !== 'live' || isStill();
  }
  playButton.addEventListener('click', () => {
    if (autoplay) stopAutoplay();
    else if (!playButton.hidden) {
      if (menu.open && !menuClosing) setMenuOpen(false);
      rideSoundEnabled = true;
      setAutoplay('manual');
    }
  });

  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open && !menuClosing) {
      event.preventDefault();
      setMenuOpen(false);
      menuButton.focus();
    }
  });
  root.addEventListener('click', event => {
    if (menu.open && !menuClosing && (!menu.contains(event.target) || event.target.closest('.explore-panel a'))) {
      const returnFocus = menu.contains(document.activeElement);
      setMenuOpen(false);
      if (returnFocus) menuButton.focus();
    }
  });
  menu.addEventListener('focusout', event => {
    if (menu.open && !menuClosing && event.relatedTarget && !menu.contains(event.relatedTarget)) setMenuOpen(false);
  });

  let pendingPage;
  let entrySerial = 0;
  const newEntry = () => `${performance.timeOrigin}:${++entrySerial}`;
  const entryScroll = new Map();
  let displayedEntry = history.state?.fieldEntry ?? newEntry();
  history.replaceState({ ...history.state, fieldEntry:displayedEntry }, '');
  const isFieldNotesURL = url => url.origin === homeURL.origin
    && (url.pathname === homeURL.pathname
      || url.pathname === homeURL.pathname + 'tags/'
      || url.pathname.startsWith(homeURL.pathname + 'posts/'));

  async function openPage(url, { push, offset }) {
    stopAutoplay();
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
        history.replaceState({ ...history.state, fieldScroll:window.scrollY }, '');
        history.pushState({ fieldEntry:newEntry(), fieldScroll:offset }, '', url);
        history.scrollRestoration = 'manual';
      }
      const wasFeed = isFeed();
      main.dataset.fieldView = nextMain.dataset.fieldView;
      displayedPath = location.pathname;
      displayedEntry = history.state?.fieldEntry ?? newEntry();
      if (!history.state?.fieldEntry) history.replaceState({ ...history.state, fieldEntry:displayedEntry }, '');
      main.replaceChildren(...Array.from(nextMain.childNodes, node => document.importNode(node, true)));
      document.title = page.title;
      for (const selector of ['link[rel="canonical"]', 'meta[name="description"]']) {
        const replacement = page.querySelector(selector);
        if (replacement) document.querySelector(selector)?.replaceWith(document.importNode(replacement, true));
      }
      root.dataset.fieldView = main.dataset.fieldView;
      updatePlayButton();
      window.scrollTo(0, offset);
      entryScroll.set(displayedEntry, window.scrollY);
      main.focus({ preventScroll:true });
      if (isFeed()) feedScroll = Math.max(0, window.scrollY);
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
    // The old content is still mounted, even if its last scroll event is queued.
    entryScroll.set(displayedEntry, window.scrollY);
    const offset = entryScroll.get(event.state?.fieldEntry) ?? restoreNumber(event.state?.fieldScroll);
    void openPage(url, { push:false, offset });
  });

  new ResizeObserver(resize).observe(landscape);
  window.addEventListener('scroll', () => {
    if (location.pathname !== displayedPath) return;
    entryScroll.set(displayedEntry, window.scrollY);
    if (isFeed()) {
      const scroller = document.scrollingElement;
      const end = scroller.scrollHeight - scroller.clientHeight;
      // Clamp iOS rubber-banding so it cannot start or interrupt the ride.
      const nextScroll = Math.min(end, Math.max(0, window.scrollY));
      if (nextScroll < feedScroll) stopAutoplay();
      const remaining = coarsePointer.matches ? 120 : 24;
      if (!autoplay && end - nextScroll <= remaining && nextScroll > feedScroll
        && root.dataset.terrain === 'live' && !isStill()
        && !document.activeElement?.matches(':focus-visible')) {
        setAutoplay('scroll');
      }
      feedScroll = nextScroll;
      schedule();
    }
  }, { passive:true });
  window.addEventListener('wheel', event => {
    if (event.deltaY < 0) stopAutoplay();
  }, { passive:true });
  root.addEventListener('focusin', event => {
    if (event.target !== playButton || root.dataset.canyonAutoplay !== 'manual') stopAutoplay();
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') stopAutoplay();
  });
  window.addEventListener('pagehide', () => {
    if (location.pathname !== displayedPath) return;
    saveVisibleFrame();
    try { history.replaceState({ ...history.state, fieldScroll:window.scrollY }, ''); } catch {}
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && location.pathname === displayedPath) saveVisibleFrame();
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
    const renderer = new THREE.WebGLRenderer({ canvas, antialias:!coarsePointer.matches });
    const scene = new THREE.Scene();
    const sun = createCanyonSun(THREE);
    const sunUniforms = sun.material.uniforms;
    const starMesh = createCanyonStars(THREE, coarsePointer.matches ? 90 : 155);
    const starUniforms = starMesh.material.uniforms;
    scene.add(sun, starMesh);
    let lastStarScroll = feedScroll;
    let lastStarFrame;
    let starSpeed = 0;
    let skyTexture;
    const fog = new THREE.FogExp2('#6c7496', .027);
    scene.fog = fog;
    const canyon = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(61, 1, .1, 195);
    scene.add(canyon);

    const rockDay = new THREE.Color('#ffffff');
    const rockNight = new THREE.Color('#8b91ce');
    const horizonTint = new THREE.Color();
    const rock = new THREE.MeshBasicMaterial({ vertexColors:true, side:THREE.DoubleSide });
    const groundDay = new THREE.Color('#9b6452');
    const groundNight = new THREE.Color('#59403f');
    const skyEdge = new THREE.Color();
    const edgeTint = new THREE.Color();

    const strata = [0, .19, .28, .45, .51, .64, .79, .89, 1, 1.02];
    const bands = strata.length - 1;
    const palette = ['#694036','#7d483c','#9b5a47','#79453c','#a9604e','#8c4e43','#aa6655','#8e5047','#b67762'].map(value => new THREE.Color(value));
    const segments = 53;
    const spacing = 2.45;
    const lookBehind = 5;
    const cellsPerUpdate = 10;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(36, segments * spacing), new THREE.MeshBasicMaterial());
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = (lookBehind - segments / 2) * spacing;
    canyon.add(ground);
    const centerAt = distance => 1.65 * Math.sin(distance * .073) + .63 * Math.sin(distance * .031);
    const trackGeometry = new THREE.BufferGeometry();
    const trackPositions = new THREE.BufferAttribute(new Float32Array(2 * segments * 18), 3).setUsage(THREE.DynamicDrawUsage);
    trackGeometry.setAttribute('position', trackPositions);
    const tracks = new THREE.Mesh(trackGeometry, new THREE.MeshBasicMaterial({
      polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1
    }));
    tracks.frustumCulled = false;
    canyon.add(tracks);

    const stoneGeometry = new THREE.IcosahedronGeometry(1, 0);
    const normals = stoneGeometry.getAttribute('normal');
    const facets = new Float32Array(normals.count * 3);
    for (let vertex = 0; vertex < normals.count; vertex++) {
      const shade = .83 + normals.getY(vertex) * .14 - normals.getX(vertex) * .08;
      facets.fill(shade, vertex * 3, vertex * 3 + 3);
    }
    stoneGeometry.setAttribute('color', new THREE.BufferAttribute(facets, 3));
    const stones = new THREE.InstancedMesh(stoneGeometry, new THREE.MeshBasicMaterial({ vertexColors:true }), segments);
    stones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    stones.frustumCulled = false;
    canyon.add(stones);
    const stonePose = new THREE.Object3D();
    const detailNoise = (index, salt) => {
      const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
      return value - Math.floor(value);
    };

    // Use world cells for the detail too, so it never shifts when the strip is recycled.
    function updateFloorDetails(cell) {
      const start = cell - lookBehind;
      const trackEdges = (index, side) => {
        const distance = index * spacing;
        const center = centerAt(distance) + .18 * Math.sin(distance * .24) + side * .79;
        const halfWidth = .095 + .035 * detailNoise(index, side);
        return [center - halfWidth, center + halfWidth];
      };
      let vertex = 0;
      for (const side of [-1, 1]) {
        let [left, right] = trackEdges(start, side);
        for (let local = 0; local < segments; local++) {
          const z = (lookBehind - local) * spacing;
          const [nextLeft, nextRight] = trackEdges(start + local + 1, side);
          trackPositions.setXYZ(vertex++, left, 0, z);
          trackPositions.setXYZ(vertex++, right, 0, z);
          trackPositions.setXYZ(vertex++, nextLeft, 0, z - spacing);
          trackPositions.setXYZ(vertex++, right, 0, z);
          trackPositions.setXYZ(vertex++, nextRight, 0, z - spacing);
          trackPositions.setXYZ(vertex++, nextLeft, 0, z - spacing);
          left = nextLeft;
          right = nextRight;
        }
      }
      trackPositions.needsUpdate = true;

      let count = 0;
      for (let local = 0; local < segments; local++) {
        const index = start + local;
        if (detailNoise(index, 2) > .66) continue;
        const offset = detailNoise(index, 3) * spacing;
        const side = detailNoise(index, 4) < .5 ? -1 : 1;
        const x = centerAt(index * spacing + offset) + side * (1.3 + detailNoise(index, 5) * 1.65);
        const size = .10 + .45 * detailNoise(index, 6) ** 2;
        stonePose.position.set(x, size * .24, (lookBehind - local) * spacing - offset);
        stonePose.rotation.y = detailNoise(index, 7) * Math.PI * 2;
        stonePose.scale.set(size, size * .52, size * (.65 + detailNoise(index, 8) * .6));
        stonePose.updateMatrix();
        stones.setMatrixAt(count++, stonePose.matrix);
      }
      stones.count = count;
      stones.instanceMatrix.needsUpdate = true;
    }

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
    // Keep ten cells per upload so small scroll steps only move the camera.
    function updateWalls(cell) {
      if (cell === previousCell) return;
      previousCell = cell;
      updateFloorDetails(cell);
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
      renderer.setDrawingBufferSize(W, H, coarsePointer.matches ? 1 : Math.min(devicePixelRatio, 1.35));
      const skyScale = Math.min(1, 512 / W, 768 / H);
      const skyWidth = Math.max(1, Math.round(W * skyScale));
      const skyHeight = Math.max(1, Math.round(H * skyScale));
      if (!skyTexture || skyCanvas.width !== skyWidth || skyCanvas.height !== skyHeight) {
        skyTexture?.dispose();
        skyCanvas.width = skyWidth;
        skyCanvas.height = skyHeight;
        // The GPU storage for an uploaded texture has fixed dimensions.
        skyTexture = new THREE.CanvasTexture(skyCanvas);
        skyTexture.colorSpace = THREE.SRGBColorSpace;
        skyTexture.generateMipmaps = false;
        skyTexture.minFilter = THREE.LinearFilter;
        scene.background = skyTexture;
      }
      ctx.setTransform(skyCanvas.width / W, 0, 0, skyCanvas.height / H, 0, 0);
      starUniforms.viewport.value.set(W, H);
      starUniforms.trailLimit.value = coarsePointer.matches ? 24 : 90;
      sunUniforms.viewport.value.set(W, H);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      canyon.scale.x = THREE.MathUtils.clamp(camera.aspect * .84, .55, 1.2);
    };

    const drawTerrain = (scroll, night, elevation, horizonColor, skyEdgeColor, now, p) => {
      const travel = Math.max(0, scroll) * .0355;
      const cell = Math.floor(travel / (spacing * cellsPerUpdate)) * cellsPerUpdate;
      const z = cell * spacing - travel;
      updateWalls(cell);
      const x = centerAt(travel) * canyon.scale.x;
      const height = 2.58 + elevation * 36;
      const angle = THREE.MathUtils.lerp(FEED_ANGLE, ASCENT_ANGLE, elevation);
      camera.position.set(x, height, z);
      camera.lookAt(THREE.MathUtils.lerp(x, centerAt(travel + 14) * canyon.scale.x, .62), height + Math.tan(angle * Math.PI / 180) * 14, z - 14);
      if (horizonColor) {
        const [red, green, blue] = horizonColor;
        fog.color.setRGB(red / 255, green / 255, blue / 255, THREE.SRGBColorSpace);
        horizonTint.copy(fog.color);
        rock.color.copy(rockDay).lerp(rockNight, night).lerp(horizonTint, .25);
        ground.material.color.copy(groundDay).lerp(groundNight, night).lerp(horizonTint, .25);
        tracks.material.color.copy(ground.material.color).multiplyScalar(.72);
        stones.material.color.copy(ground.material.color).lerp(rock.color, .09);
        const [edgeRed, edgeGreen, edgeBlue] = skyEdgeColor;
        skyEdge.setRGB(edgeRed / 255, edgeGreen / 255, edgeBlue / 255, THREE.SRGBColorSpace);
        skyTexture.needsUpdate = true;
      }
      // Safari can use the page color for the native scroll edge instead of the canvas.
      if (coarsePointer.matches && (horizonColor || elevation !== previousLift)) {
        edgeTint.copy(ground.material.color).lerp(skyEdge, elevation);
        document.documentElement.style.setProperty('--canyon-live-edge', '#' + edgeTint.getHexString());
      }
      const frames = Math.max(1, now - (lastStarFrame ?? now - SCROLL_FRAME_MS)) / SCROLL_FRAME_MS;
      const change = feedScroll - lastStarScroll;
      starSpeed = change ? starSpeed + (change / frames - starSpeed) * .5 : starSpeed * .955 ** frames;
      lastStarScroll = feedScroll;
      lastStarFrame = now;
      starUniforms.clock.value = (Date.now() - started) / 1000;
      starUniforms.scroll.value = feedScroll;
      starUniforms.speed.value = starSpeed;
      starUniforms.night.value = night;

      // The sun follows the unquantized sol phase on every rendered frame.
      const alt = altitude(p);
      sun.visible = alt > -.18;
      if (sun.visible) {
        const theta = 2 * Math.PI * (p - .5);
        sunUniforms.center.value.set(W * (.5 + .46 * Math.sin(theta)), H * (.97 - .81 * Math.max(alt, -.1)));
        sunUniforms.radii.value.set(
          Math.max(W, H) * (.24 + .12 * (1 - Math.max(0, alt))),
          Math.max(4, Math.min(W, H) * .009)
        );
        const glow = mix([70, 150, 255], [255, 226, 190], smooth(.08, .38, alt));
        sunUniforms.glowColor.value.set(glow[0] / 255, glow[1] / 255, glow[2] / 255);
        sunUniforms.strength.value.set(
          (.6 - .05 * paletteBlend) * smooth(-.18, .02, alt) * (1 - .5 * smooth(.05, .4, alt)),
          .92 * smooth(-.02, .04, alt)
        );
      }
      renderer.render(scene, camera);
    };

    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      renderTerrain = undefined;
      captureFrame = undefined;
      showStill();
    });
    function activateRenderer() {
      renderTerrain = drawTerrain;
      captureFrame = () => renderer.render(scene, camera);
      needsResize = true;
      previousScrollFrame = undefined;
      refreshTheme();
    }
    canvas.addEventListener('webglcontextrestored', activateRenderer);
    activateRenderer();
  }

  async function enableTerrain() {
    if (!ctx || loadingTerrain) return;
    loadingTerrain = true;
    try {
      const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.179.1/build/three.module.min.js');
      startTerrain(THREE);
    } catch {
      // The CSS sky remains visible if WebGL or the module is unavailable.
    }
  }

  restoreVisibleFrame();
  refreshMotion();
