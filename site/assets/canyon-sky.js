// Star distribution and motion adapted from Mission Control Site's Backdrop.astro.
const layers = [
  [.12, .5, .85, .6, .55],
  [.3, .75, 1.15, .75, .85],
  [.6, 1.05, 1.55, .9, 1]
];
const warm = [255, 246, 236];
const tints = [warm, warm, warm, warm, [200, 220, 255], [255, 222, 184]];
const quad = [0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0];

function skyLayer(THREE, geometry, renderOrder, shader) {
  const material = new THREE.ShaderMaterial({
    ...shader,
    depthTest:false,
    depthWrite:false,
    // Blend in the opaque pass so canyon geometry covers these layers.
    blending:THREE.CustomBlending,
    blendSrc:THREE.SrcAlphaFactor,
    blendDst:THREE.OneMinusSrcAlphaFactor
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  return mesh;
}

export function createCanyonStars(THREE, count) {
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const orbits = new Float32Array(count * 4);
  const pulses = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    const roll = random();
    const [depth, low, high, alpha] = layers.find(layer => roll < layer[4]);
    orbits.set([depth, low + random() * (high - low), random(), random()], index * 4);
    pulses.set([alpha, 3 + random() * 6, random() * Math.PI * 2], index * 3);
    colors.set(tints[Math.floor(random() * tints.length)].map(channel => channel / 255), index * 3);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.instanceCount = count;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(quad, 3));
  geometry.setAttribute('orbit', new THREE.InstancedBufferAttribute(orbits, 4));
  geometry.setAttribute('pulse', new THREE.InstancedBufferAttribute(pulses, 3));
  geometry.setAttribute('tint', new THREE.InstancedBufferAttribute(colors, 3));
  return skyLayer(THREE, geometry, -1, {
    uniforms:{
      viewport:{ value:new THREE.Vector2() },
      clock:{ value:0 },
      scroll:{ value:0 },
      speed:{ value:0 },
      night:{ value:1 },
      trailLimit:{ value:24 }
    },
    vertexShader:`
      attribute vec4 orbit;
      attribute vec3 pulse;
      attribute vec3 tint;
      uniform vec2 viewport;
      uniform float clock, scroll, speed, night, trailLimit;
      varying vec2 pixel, head;
      varying vec3 color;
      varying float radius, tail, opacity;

      void main() {
        float pole = viewport.y * 1.2;
        float band = viewport.y + 80.0;
        float distance = pole - 40.0 + orbit.w * band;
        float halfArc = asin(min(1.0, (viewport.x * 0.5 + 40.0) / distance));
        float drift = viewport.x / (100.0 * (pole + viewport.y * 0.5));
        float angle = -halfArc + mod(orbit.z * 2.0 * halfArc
          + drift * (1.0 + 0.3 * orbit.x) * clock, 2.0 * halfArc);
        float y = viewport.y + pole - distance * cos(angle) - scroll * orbit.x * 0.35;
        head = vec2(viewport.x * 0.5 + distance * sin(angle), mod(y + 40.0, band) - 40.0);
        radius = orbit.y;
        tail = sign(speed) * min(trailLimit, abs(speed) * orbit.x * 5.0);
        opacity = pulse.x * (0.55 + 0.35 * night)
          * (0.6 + 0.4 * sin(clock * 6.2831853 / pulse.y + pulse.z));
        color = tint;
        float edge = radius + 0.6;
        pixel = head + vec2(mix(-edge, edge, position.x),
          mix(min(0.0, tail) - edge, max(0.0, tail) + edge, position.y));
        gl_Position = vec4(pixel / viewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
      }
    `,
    fragmentShader:`
      varying vec2 pixel, head;
      varying vec3 color;
      varying float radius, tail, opacity;

      void main() {
        vec2 offset = pixel - head;
        float star = 1.0 - smoothstep(radius - 0.45, radius + 0.45, length(offset));
        float along = offset.y * sign(tail);
        float trace = (1.0 - smoothstep(0.0, radius * 0.65 + 0.4, abs(offset.x)))
          * (1.0 - clamp(along / max(1.0, abs(tail)), 0.0, 1.0))
          * step(0.0, along) * step(1.5, abs(tail)) * 0.55;
        gl_FragColor = vec4(color, max(star, trace) * opacity);
      }
    `
  });
}

export function createCanyonSun(THREE) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(quad, 3));
  return skyLayer(THREE, geometry, -2, {
    uniforms:{
      viewport:{ value:new THREE.Vector2() },
      center:{ value:new THREE.Vector2() },
      glowColor:{ value:new THREE.Vector3() },
      radii:{ value:new THREE.Vector2() },
      strength:{ value:new THREE.Vector2() }
    },
    vertexShader:`
      uniform vec2 viewport, center, radii;
      varying vec2 offset;

      void main() {
        offset = (position.xy * 2.0 - 1.0) * radii.x;
        gl_Position = vec4((center + offset) / viewport * vec2(2.0, -2.0)
          + vec2(-1.0, 1.0), 0.0, 1.0);
      }
    `,
    fragmentShader:`
      uniform vec3 glowColor;
      uniform vec2 radii, strength;
      varying vec2 offset;

      void main() {
        float distance = length(offset);
        float t = distance / radii.x;
        // Match the original radial gradient's 0%, 30%, and 100% stops.
        float glow = strength.x * max(0.0, max(1.0 - 2.0 * t, 0.4 * (1.0 - t) / 0.7));
        float disc = strength.y * (1.0 - smoothstep(radii.y - 0.5, radii.y + 0.5, distance));
        float background = glow * (1.0 - disc);
        float alpha = disc + background;
        vec3 sunlight = vec3(1.0, 0.980392, 0.941176);
        gl_FragColor = vec4((sunlight * disc + glowColor * background) / max(alpha, 0.0001), alpha);
      }
    `
  });
}
