// A gust is a short burst of low, overlapping billboards anchored in canyon space.
export function createCanyonDust(THREE, count, centerAt, floorHeight) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0
  ], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.instanceCount = count;
  const particles = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('puff', particles);

  const tint = new THREE.Color();
  const dustLight = new THREE.Color('#d9a582');
  const material = new THREE.ShaderMaterial({
    transparent:true,
    depthWrite:false,
    fog:true,
    uniforms:{
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      tint:{ value:tint },
      opacity:{ value:0 },
      time:{ value:0 },
      wind:{ value:1 }
    },
    vertexShader:`
      #include <fog_pars_vertex>
      attribute vec4 puff;
      uniform float wind;
      varying vec2 shape;
      varying float seed;

      void main() {
        shape = position.xy * 2.0;
        seed = puff.w * 11.0;
        vec4 mvPosition = modelViewMatrix * vec4(puff.xyz, 1.0);
        mvPosition.xy += vec2(position.x * 2.8 + wind * position.y * 0.55, position.y * 0.87) * puff.w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader:`
      #include <fog_pars_fragment>
      uniform vec3 tint;
      uniform float opacity, time, wind;
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
        vec2 drift = shape * vec2(2.9, 2.1) + vec2(seed - wind * time * 0.53, time * 0.17);
        float density = smoothstep(0.15, 0.78, noise(drift) * 0.72 + noise(drift * 2.2) * 0.28);
        gl_FragColor = vec4(tint, opacity * edge * density);
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
  let nextGust = 3600;
  let gust;

  function update({ now, travel, stripOrigin, elevation, night, groundColor }) {
    // Ignore elapsed wall time while the tab or renderer is paused.
    elapsed += Math.min(100, now - (previousFrame ?? now));
    previousFrame = now;
    if (elapsed >= nextGust) {
      const duration = 3800 + Math.random() * 1900;
      gust = {
        start:elapsed, duration, origin:travel + 10,
        direction:Math.random() < .5 ? -1 : 1,
        puffs:Array.from({ length:count }, (_, i) => ({
          along:(i / count) * 31 + Math.random() * 3,
          cross:(Math.random() - .5) * 3,
          height:.22 + Math.random() * .85,
          size:.58 + Math.random() * .8
        }))
      };
      nextGust = elapsed + duration + 12500 + Math.random() * 12500;
    }
    const age = gust ? elapsed - gust.start : 0;
    mesh.visible = Boolean(gust && age < gust.duration && elevation < .9);
    if (!mesh.visible) return;

    const progress = age / gust.duration;
    const wind = gust.direction;
    const { smoothstep } = THREE.MathUtils;
    const envelope = smoothstep(progress, 0, .23) * (1 - smoothstep(progress, .44, 1));
    tint.copy(groundColor).lerp(dustLight, .46 - night * .19);
    material.uniforms.opacity.value = envelope * .34 * (1 - smoothstep(elevation, .18, .9));
    material.uniforms.time.value = age / 1000;
    material.uniforms.wind.value = wind;

    gust.puffs.forEach(({ along, cross, height, size }, i) => {
      const distance = gust.origin + along + progress * (5 + .11 * along);
      const offset = wind * (-3.4 + progress * 6.8 + cross);
      particles.setXYZW(i, centerAt(distance) + offset,
        floorHeight(offset, distance) + height + progress * .36,
        stripOrigin - distance, size * (1 + progress * .55));
    });
    particles.needsUpdate = true;
  }

  return { mesh, update };
}
