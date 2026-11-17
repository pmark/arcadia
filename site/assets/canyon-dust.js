const headings = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];

// Two overlapping batches share a draw call. Positions stay anchored in canyon space.
export function createCanyonDust(THREE, count, centerAt, floorHeight) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0
  ], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const wispCount = Math.ceil(count * .5);
  const capacity = count + wispCount;
  geometry.instanceCount = 0;
  const particles = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const currents = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('puff', particles);
  geometry.setAttribute('current', currents);

  const tint = new THREE.Color();
  const haze = new THREE.Color();
  const dustLight = new THREE.Color('#d9a582');
  const material = new THREE.ShaderMaterial({
    transparent:true,
    depthWrite:false,
    fog:true,
    uniforms:{
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      tint:{ value:tint },
      haze:{ value:haze }
    },
    vertexShader:`
      #include <fog_pars_vertex>
      attribute vec4 puff;
      attribute vec4 current;
      varying vec4 flow;
      varying vec2 shape;
      varying float seed;

      void main() {
        flow = current;
        shape = position.xy * 2.0;
        seed = puff.w * 11.0;
        vec4 mvPosition = modelViewMatrix * vec4(puff.xyz, 1.0);
        mvPosition.xy += vec2(position.x * 2.8 + current.z * position.y * 0.55, position.y * 0.87) * puff.w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader:`
      #include <fog_pars_fragment>
      uniform vec3 tint, haze;
      varying vec4 flow;
      varying vec2 shape;
      varying float seed;

      float hash(vec2 cell) {
        vec3 p = fract(vec3(cell.xyx) * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }

      float noise(vec2 point) {
        vec2 cell = floor(point);
        vec2 f = fract(point);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
          mix(hash(cell + vec2(0.0, 1.0)), hash(cell + 1.0), f.x), f.y);
      }

      void main() {
        float edge = 1.0 - smoothstep(0.22, 1.0, length(shape));
        vec2 drift = shape * vec2(2.9, 2.1) + vec2(seed - flow.z * flow.y * 0.53, (0.17 + flow.w * 0.32) * flow.y);
        float density = smoothstep(0.15, 0.78, noise(drift) * 0.72 + noise(drift * 2.2) * 0.28);
        // The lighter batches carry a negative envelope to select the softer tint.
        vec3 color = flow.x < 0.0 ? haze : tint;
        gl_FragColor = vec4(color, abs(flow.x) * edge * density);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;

  let previousFrame;
  let elapsed = 0;
  let nextBatch = 1650;
  let heading;
  let remaining = 0;
  let availableHeadings = [];
  let batches = [];

  function launchBatch(travel) {
    const lead = remaining === 0;
    if (lead) {
      if (!availableHeadings.length) availableHeadings = headings.slice();
      const pick = Math.floor(Math.random() * availableHeadings.length);
      [heading] = availableHeadings.splice(pick, 1);
      remaining = Math.random() < .5 ? 2 : 3;
    }

    const angle = heading + (Math.random() - .5) * .32;
    const crosswind = Math.cos(angle);
    const alongwind = Math.sin(angle);
    const duration = 3550 + Math.random() * 1100;
    const speed = lead ? .88 + Math.random() * .2 : 1.22 + Math.random() * .26;
    const size = lead ? count : wispCount;
    const origin = travel + (alongwind < -.5 ? 20 : 9);
    batches.push({
      start:elapsed, duration, speed, lead, origin, crosswind, alongwind,
      puffs:Array.from({ length:size }, (_, i) => ({
        along:(i / size) * 28 + Math.random() * 3,
        cross:(Math.random() - .5) * (Math.abs(alongwind) > .5 ? 4.2 : 3),
        height:.22 + Math.random() * .85,
        size:.65 + Math.random() * .8
      }))
    });
    remaining--;
    // 2.4 seconds is more than half the longest batch lifetime. A third
    // batch can start as the first expires, with at most two alive at once.
    nextBatch = elapsed + (remaining ? 2400 + Math.random() * 500 : duration + 650 + Math.random() * 1550);
  }

  function update({ now, travel, stripOrigin, elevation, night, groundColor }) {
    // Ignore elapsed wall time while the tab or renderer is paused.
    elapsed += Math.min(100, now - (previousFrame ?? now));
    previousFrame = now;
    while (batches.length && elapsed - batches[0].start >= batches[0].duration) batches.shift();
    if (elapsed >= nextBatch) launchBatch(travel);
    mesh.visible = batches.length > 0 && elevation < .9;
    if (!mesh.visible) return;

    const { smoothstep } = THREE.MathUtils;
    const aerialFade = 1 - smoothstep(elevation, .18, .9);
    haze.copy(groundColor).lerp(dustLight, .23 - night * .09);
    tint.copy(groundColor).lerp(dustLight, .46 - night * .19);
    let index = 0;
    for (const batch of batches) {
      const age = (elapsed - batch.start) / 1000;
      const progress = age * 1000 / batch.duration;
      const envelope = smoothstep(progress, 0, .22) * (1 - smoothstep(progress, .47, 1));
      const opacity = envelope * aerialFade * (batch.lead ? .34 : -.27);
      const drift = age * batch.speed;
      const { alongwind, crosswind } = batch;
      for (const { along, cross, height, size } of batch.puffs) {
        const distance = batch.origin + along + alongwind * (drift * 4.3 - 4);
        const offset = cross + crosswind * (drift * 1.65 - 3);
        particles.setXYZW(index, centerAt(distance) + offset,
          floorHeight(offset, distance) + height + progress * .34,
          stripOrigin - distance, size * (1 + progress * .52));
        currents.setXYZW(index++, opacity, drift, crosswind, alongwind);
      }
    }
    geometry.instanceCount = index;
    particles.needsUpdate = true;
    currents.needsUpdate = true;
  }

  return { mesh, update };
}
