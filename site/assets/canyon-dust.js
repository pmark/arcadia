const maxAcceleration = .24;
const headings = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];

// Two overlapping batches share a draw call. Positions stay anchored in canyon space.
export function createCanyonDust(THREE, count, centerAt, floorHeight) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0
  ], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const wispCount = Math.ceil(count * .5);
  const ambientCount = wispCount;
  const ambientSpacing = 4.8;
  const capacity = count + wispCount + ambientCount;
  geometry.instanceCount = 0;
  const particles = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const currents = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('puff', particles);
  geometry.setAttribute('current', currents);
  const pigments = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('pigment', pigments);

  const tint = new THREE.Color();
  const haze = new THREE.Color();
  const deepTint = new THREE.Color();
  const rust = new THREE.Color('#ae6045');
  const umber = new THREE.Color('#754335');
  const material = new THREE.ShaderMaterial({
    transparent:true,
    depthWrite:false,
    fog:true,
    uniforms:{
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      tint:{ value:tint },
      deepTint:{ value:deepTint },
      haze:{ value:haze }
    },
    vertexShader:`
      #include <fog_pars_vertex>
      attribute vec4 puff;
      attribute vec4 current;
      attribute float pigment;
      varying vec4 flow;
      varying vec2 shape;
      varying float grain;

      void main() {
        flow = current;
        shape = position.xy * 2.0;
        grain = pigment;
        vec4 mvPosition = modelViewMatrix * vec4(puff.xyz, 1.0);
        mvPosition.xy += vec2(position.x * 2.8 + current.z * position.y * 0.55, position.y * 0.87) * puff.w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader:`
      #include <fog_pars_fragment>
      uniform vec3 tint, deepTint, haze;
      varying vec4 flow;
      varying vec2 shape;
      varying float grain;

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
        vec2 drift = shape * vec2(2.9, 2.1) + vec2(grain * 17.0 - flow.z * flow.y * 0.53, (0.17 + flow.w * 0.32) * flow.y);
        float density = smoothstep(0.07, 0.72, noise(drift) * 0.72 + noise(drift * 2.2) * 0.28);
        vec3 color = mix(tint, deepTint, grain);
        if (flow.x < 0.0) color = mix(color, haze, .55);
        float opacity = abs(flow.x) * edge * density;
        // Let distant dust dissolve into the fog without coloring it like the sky.
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            opacity *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          #else
            opacity *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
          #endif
        #endif
        gl_FragColor = vec4(color, opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;

  let previousFrame;
  let elapsed = 0;
  let nextBatch = 1000 + Math.random() * 2600;
  let heading;
  let remaining = 0;
  let availableHeadings = [];
  const batches = [];

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
    const duration = 7200 + Math.random() * 5100;
    const speed = lead ? .88 + Math.random() * .2 : 1.22 + Math.random() * .26;
    const size = lead ? count : wispCount;
    const origin = travel + (alongwind < -.5 ? 20 : 9);
    batches.push({
      start:elapsed, duration, speed, lead, origin, crosswind, alongwind, drift:0, velocity:.27 * speed,
      peaks:[.15 + Math.random() * .2, .48 + Math.random() * .2, .72 + Math.random() * .17],
      pulseWidth:.04 + Math.random() * .08,
      puffs:Array.from({ length:size }, (_, i) => ({
        along:(i / size) * 28 + Math.random() * 3,
        cross:(Math.random() - .5) * (Math.abs(alongwind) > .5 ? 4.2 : 3),
        height:.22 + Math.random() * .85,
        size:.65 + Math.random() * .8,
        pigment:Math.random()
      }))
    });
    remaining--;
    const waveEnd = Math.max(...batches.map(batch => batch.start + batch.duration));
    nextBatch = remaining ? elapsed + 2200 + Math.random() ** 2 * 5700
      : waveEnd + 250 + Math.random() ** 2 * 3800;
  }

  function update({ now, travel, stripOrigin, elevation, night, groundColor }) {
    // Ignore elapsed wall time while the tab or renderer is paused.
    const step = Math.min(100, now - (previousFrame ?? now));
    elapsed += step;
    previousFrame = now;
    for (let i = batches.length - 1; i >= 0; i--) {
      if (elapsed - batches[i].start >= batches[i].duration) batches.splice(i, 1);
    }
    if (elapsed >= nextBatch && batches.length < 2) launchBatch(travel);
    const { clamp, smoothstep } = THREE.MathUtils;
    for (const batch of batches) {
      const age = elapsed - batch.start;
      const progress = age / batch.duration;
      let power = .27;
      for (const peak of batch.peaks) {
        const away = (progress - peak) / batch.pulseWidth;
        power += .82 * Math.exp(-away * away);
      }
      const seconds = Math.min(step, age) / 1000;
      const limit = maxAcceleration * seconds;
      const previousVelocity = batch.velocity;
      const requestedChange = (batch.speed * power - previousVelocity) * -Math.expm1(-seconds / 1.2);
      batch.velocity += clamp(requestedChange, -limit, limit);
      batch.drift += (previousVelocity + batch.velocity) * .5 * seconds;
    }

    mesh.visible = elevation < .9;
    if (!mesh.visible) return;

    const aerialFade = 1 - smoothstep(elevation, .18, .9);
    const paletteWeight = .52 - night * .34;
    tint.copy(groundColor).lerp(rust, paletteWeight);
    deepTint.copy(groundColor).lerp(umber, paletteWeight);
    haze.copy(groundColor).lerp(tint, .38);
    const time = elapsed / 1000;
    const firstCell = Math.floor(travel / ambientSpacing);
    // Recycle in world space. New and retired wisps are beyond the fade edges.
    for (let index = 0; index < ambientCount; index++) {
      const cell = firstCell + index;
      const phase = cell * 2.39996;
      const distance = cell * ambientSpacing + 2.4 + 1.3 * Math.sin(phase + time * .20);
      const ahead = distance - travel;
      const offset = 1.65 * Math.sin(phase + time * .23) + .58 * Math.sin(phase * .7 + time * .09);
      const edge = smoothstep(ahead, 2, 8) * (1 - smoothstep(ahead, (ambientCount - 2) * ambientSpacing, (ambientCount - 1) * ambientSpacing));
      const density = .125 + .045 * Math.sin(phase + time * .28);
      particles.setXYZW(index, centerAt(distance) + offset,
        floorHeight(offset, distance) + .55, stripOrigin - distance, 1.8 + .4 * Math.sin(phase));
      currents.setXYZW(index, -density * edge * aerialFade, time * .18, .4, .28);
      pigments.setX(index, .5 + .5 * Math.sin(phase * 1.7));
    }

    let index = ambientCount;
    for (const batch of batches) {
      const progress = (elapsed - batch.start) / batch.duration;
      const envelope = smoothstep(progress, 0, .14) * (1 - smoothstep(progress, .72, 1));
      const opacity = envelope * (.56 + .44 * Math.min(1, batch.velocity / batch.speed))
        * aerialFade * (batch.lead ? .30 : -.23);
      const drift = batch.drift;
      const { alongwind, crosswind } = batch;
      for (const { along, cross, height, size, pigment } of batch.puffs) {
        const distance = batch.origin + along + alongwind * (drift * 3.5 - 4);
        const offset = cross + crosswind * (drift * 1.15 - 3);
        particles.setXYZW(index, centerAt(distance) + offset,
          floorHeight(offset, distance) + height + progress * .34,
          stripOrigin - distance, size * (1 + progress * .52));
        pigments.setX(index, pigment);
        currents.setXYZW(index++, opacity, drift, crosswind, alongwind);
      }
    }
    geometry.instanceCount = index;
    particles.needsUpdate = true;
    currents.needsUpdate = true;
    pigments.needsUpdate = true;
  }

  return { mesh, update };
}
