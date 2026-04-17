import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// ─── Body geometry helpers ───────────────────────────────────────────────────

function buildBody(gender: "male" | "female" | "both"): THREE.Group {
  const isFem = gender === "female";
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xc8956a, roughness: 0.8, metalness: 0 });
  const cloth = new THREE.MeshStandardMaterial({ color: isFem ? 0xd4a0b0 : 0x7a8fa6, roughness: 0.9 });
  const clothLower = new THREE.MeshStandardMaterial({ color: isFem ? 0x8b7090 : 0x3a4a5a, roughness: 0.9 });

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x=0, y=0, z=0, sx=1, sy=1, sz=1) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    group.add(m);
    return m;
  };

  // ── Head ──
  add(new THREE.SphereGeometry(0.13, 16, 16), skin, 0, 1.72, 0);

  // ── Neck ──
  add(new THREE.CylinderGeometry(0.055, 0.06, 0.12, 12), skin, 0, 1.57, 0);

  // ── Torso ──
  const torsoW = isFem ? 0.21 : 0.24;
  const hipW   = isFem ? 0.235 : 0.21;
  const waistW = isFem ? 0.175 : 0.195;

  // Chest
  add(new THREE.CylinderGeometry(torsoW, waistW, 0.32, 16), cloth, 0, 1.3, 0);
  // Waist
  add(new THREE.CylinderGeometry(waistW, hipW, 0.18, 16), cloth, 0, 1.07, 0);
  // Hips
  add(new THREE.CylinderGeometry(hipW, hipW * 0.92, 0.22, 16), clothLower, 0, 0.89, 0);

  // ── Bust (female only) ──
  if (isFem) {
    const bustGeo = new THREE.SphereGeometry(0.065, 12, 12);
    add(bustGeo, cloth, -0.085, 1.38, 0.13);
    add(bustGeo, cloth,  0.085, 1.38, 0.13);
  }

  // ── Shoulders ──
  const shoulderW = isFem ? 0.19 : 0.225;
  add(new THREE.SphereGeometry(0.07, 12, 12), cloth, -shoulderW,  1.48, 0);
  add(new THREE.SphereGeometry(0.07, 12, 12), cloth,  shoulderW, 1.48, 0);

  // ── Arms ──
  const armLen  = isFem ? 0.26 : 0.28;
  const armRad  = isFem ? 0.04 : 0.048;
  const foreLen = isFem ? 0.22 : 0.24;
  const foreRad = isFem ? 0.033 : 0.038;

  // Upper arms — slight outward angle
  const uaGeo = new THREE.CylinderGeometry(armRad, armRad * 0.9, armLen, 10);
  [-1, 1].forEach(side => {
    const ua = add(uaGeo, cloth, side * (shoulderW + 0.07), 1.34, 0);
    ua.rotation.z = side * 0.18;
    // Forearm
    const fa = add(new THREE.CylinderGeometry(foreRad, foreRad * 0.85, foreLen, 10), skin,
      side * (shoulderW + 0.125), 1.06, 0);
    fa.rotation.z = side * 0.12;
    // Hand
    add(new THREE.SphereGeometry(0.038, 10, 10), skin, side * (shoulderW + 0.155), 0.88, 0);
  });

  // ── Legs ──
  const thighW = isFem ? 0.085 : 0.09;
  const calfW  = isFem ? 0.055 : 0.06;
  const thighLen = 0.38;
  const calfLen  = 0.34;

  [-1, 1].forEach(side => {
    // Thigh
    const th = add(new THREE.CylinderGeometry(thighW, thighW * 0.85, thighLen, 12), clothLower,
      side * 0.1, 0.59, 0);
    th.rotation.z = side * 0.04;
    // Calf
    const ca = add(new THREE.CylinderGeometry(calfW, calfW * 0.75, calfLen, 12), skin,
      side * 0.11, 0.21, 0);
    ca.rotation.z = side * 0.02;
    // Foot
    const foot = add(new THREE.BoxGeometry(0.09, 0.055, 0.19), skin, side * 0.115, 0.03, 0.04);
    foot.rotation.z = side * 0.02;
  });

  // ── Hair ──
  const hairColor = isFem ? 0x3a2010 : 0x2a1a08;
  const hair = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 1 });
  add(new THREE.SphereGeometry(0.135, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, 0, 1.77, -0.01);
  if (isFem) {
    // Longer hair
    add(new THREE.CylinderGeometry(0.09, 0.06, 0.22, 12), hair, 0, 1.63, -0.06);
  }

  return group;
}

// ─── Tape measure geometry ────────────────────────────────────────────────────

// Returns a tube that forms an arc/loop at a given body height and radius
function buildTapeMesh(cx: number, cy: number, cz: number, radius: number, axis: "y" | "x" | "z"): THREE.Mesh {
  const segments = 80;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    if (axis === "y") {
      points.push(new THREE.Vector3(cx + Math.cos(t) * radius, cy, cz + Math.sin(t) * radius));
    } else if (axis === "x") {
      points.push(new THREE.Vector3(cx, cy + Math.cos(t) * radius, cz + Math.sin(t) * radius));
    } else {
      points.push(new THREE.Vector3(cx + Math.cos(t) * radius, cy + Math.sin(t) * radius, cz));
    }
  }
  const curve = new THREE.CatmullRomCurve3(points, true);
  const geo = new THREE.TubeGeometry(curve, 120, 0.008, 8, true);
  const mat = new THREE.MeshStandardMaterial({ color: 0xf5e6c0, roughness: 0.5, metalness: 0.1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

// Vertical line for height
function buildVerticalTape(x: number, y0: number, y1: number, z: number): THREE.Mesh {
  const points = [new THREE.Vector3(x, y0, z), new THREE.Vector3(x, y1, z)];
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, 20, 0.008, 8, false);
  const mat = new THREE.MeshStandardMaterial({ color: 0xf5e6c0, roughness: 0.5, metalness: 0.1 });
  return new THREE.Mesh(geo, mat);
}

// ─── Measurement configs ──────────────────────────────────────────────────────
// Each entry: what tape to show and where camera should look
type TapeConfig = {
  type: "loop";
  cx: number; cy: number; cz: number; radius: number; axis: "y" | "x" | "z";
  camPos: [number, number, number]; camTarget: [number, number, number];
} | {
  type: "vertical";
  x: number; y0: number; y1: number; z: number;
  camPos: [number, number, number]; camTarget: [number, number, number];
};

const TAPE_CONFIGS: Record<string, TapeConfig> = {
  height:    { type: "vertical", x: 0.45, y0: 0, y1: 1.85, z: 0,      camPos: [2.5, 1.0, 2.0], camTarget: [0.3, 0.9, 0] },
  chest:     { type: "loop",     cx: 0, cy: 1.36, cz: 0, radius: 0.26, axis: "y", camPos: [2.0, 1.4, 1.5], camTarget: [0, 1.36, 0] },
  bust:      { type: "loop",     cx: 0, cy: 1.38, cz: 0, radius: 0.27, axis: "y", camPos: [2.0, 1.4, 1.5], camTarget: [0, 1.38, 0] },
  waist:     { type: "loop",     cx: 0, cy: 1.07, cz: 0, radius: 0.20, axis: "y", camPos: [2.0, 1.1, 1.5], camTarget: [0, 1.07, 0] },
  hips:      { type: "loop",     cx: 0, cy: 0.87, cz: 0, radius: 0.245, axis: "y", camPos: [2.0, 0.9, 1.5], camTarget: [0, 0.87, 0] },
  shoulders: { type: "loop",     cx: 0, cy: 1.48, cz: 0, radius: 0.30, axis: "y", camPos: [0, 2.0, 2.5], camTarget: [0, 1.48, 0] },
  sleeve:    { type: "vertical", x: -0.42, y0: 0.88, y1: 1.48, z: 0,   camPos: [-2.0, 1.3, 1.5], camTarget: [-0.3, 1.2, 0] },
  inseam:    { type: "vertical", x: -0.28, y0: 0.0,  y1: 0.78, z: 0,   camPos: [2.0, 0.5, 2.0], camTarget: [0, 0.4, 0] },
  thigh:     { type: "loop",     cx: -0.1, cy: 0.62, cz: 0, radius: 0.1, axis: "y", camPos: [2.0, 0.7, 1.8], camTarget: [-0.1, 0.62, 0] },
  weight:    { type: "loop",     cx: 0, cy: 0.9, cz: 0, radius: 0.23, axis: "y", camPos: [2.0, 1.0, 2.0], camTarget: [0, 0.9, 0] },
};

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  activeField: string | null;
  gender: "male" | "female" | "both";
}

export default function MeasurementViewer3D({ activeField, gender }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    body: THREE.Group;
    tapeMesh: THREE.Mesh | null;
    animFrame: number;
    tapeProgress: number;
    tapeTarget: number;
  } | null>(null);

  // ── Init scene once ──
  useEffect(() => {
    if (!mountRef.current) return;
    const el = mountRef.current;
    const W = el.clientWidth;
    const H = el.clientHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x00000000, 0);
    el.appendChild(renderer.domElement);

    // Scene
    const scene = new THREE.Scene();

    // Camera
    const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 50);
    camera.position.set(2.2, 1.4, 2.2);
    camera.lookAt(0, 0.9, 0);

    // Controls — orbit only, no pan, limited range
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.9, 0);
    controls.enablePan = false;
    controls.minDistance = 1.2;
    controls.maxDistance = 4.5;
    controls.minPolarAngle = Math.PI * 0.1;
    controls.maxPolarAngle = Math.PI * 0.88;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    // ── Lighting ──
    const ambient = new THREE.AmbientLight(0xfff8f0, 0.7);
    scene.add(ambient);

    const key = new THREE.DirectionalLight(0xfff5e8, 1.4);
    key.position.set(3, 5, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 15;
    key.shadow.camera.left = -2;
    key.shadow.camera.right = 2;
    key.shadow.camera.top = 3;
    key.shadow.camera.bottom = -1;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xe8f0ff, 0.4);
    fill.position.set(-2, 3, -1);
    scene.add(fill);

    // ── Floor ──
    const floorGeo = new THREE.PlaneGeometry(5, 5);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 1 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // ── Back wall ──
    const wallGeo = new THREE.PlaneGeometry(5, 4);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xfafaf8, roughness: 1 });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(0, 2, -1.5);
    wall.receiveShadow = true;
    scene.add(wall);

    // Subtle wall/floor edge line
    const edgeGeo = new THREE.BoxGeometry(5, 0.015, 0.015);
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xd8d0c4 });
    const edge = new THREE.Mesh(edgeGeo, edgeMat);
    edge.position.set(0, 0.007, -1.5);
    scene.add(edge);

    // ── Body ──
    const body = buildBody(gender === "both" ? "male" : gender);
    scene.add(body);

    // Render loop
    let animFrame = 0;
    const render = () => {
      animFrame = requestAnimationFrame(render);
      controls.update();
      renderer.render(scene, camera);
    };
    render();

    // Resize
    const onResize = () => {
      if (!mountRef.current) return;
      const W2 = mountRef.current.clientWidth;
      const H2 = mountRef.current.clientHeight;
      camera.aspect = W2 / H2;
      camera.updateProjectionMatrix();
      renderer.setSize(W2, H2);
    };
    window.addEventListener("resize", onResize);

    sceneRef.current = { renderer, scene, camera, controls, body, tapeMesh: null, animFrame, tapeProgress: 0, tapeTarget: 0 };

    return () => {
      cancelAnimationFrame(animFrame);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [gender]); // reinit if gender changes

  // ── React to active field: animate tape measure ──
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;

    // Remove existing tape
    if (s.tapeMesh) {
      s.scene.remove(s.tapeMesh);
      s.tapeMesh.geometry.dispose();
      s.tapeMesh = null;
    }

    if (!activeField || !TAPE_CONFIGS[activeField]) return;

    const cfg = TAPE_CONFIGS[activeField];

    // Build the final tape mesh
    let finalMesh: THREE.Mesh;
    if (cfg.type === "loop") {
      finalMesh = buildTapeMesh(cfg.cx, cfg.cy, cfg.cz, cfg.radius, cfg.axis);
    } else {
      finalMesh = buildVerticalTape(cfg.x, cfg.y0, cfg.y1, cfg.z);
    }

    // Animate camera to measurement position
    const startPos = s.camera.position.clone();
    const startTarget = s.controls.target.clone();
    const endPos = new THREE.Vector3(...cfg.camPos);
    const endTarget = new THREE.Vector3(...cfg.camTarget);
    const DURATION = 600; // ms
    const startTime = performance.now();

    // Tape draw-on animation using a clipping plane approach:
    // we'll scale the tape's opacity from 0→1 and add tick marks
    finalMesh.material = new THREE.MeshStandardMaterial({
      color: 0xf5e6c0, roughness: 0.5, metalness: 0.1,
      transparent: true, opacity: 0,
    });
    s.scene.add(finalMesh);
    s.tapeMesh = finalMesh;

    let done = false;
    const animateTape = (now: number) => {
      if (done) return;
      const t = Math.min((now - startTime) / DURATION, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease in-out quad

      // Camera lerp
      s.camera.position.lerpVectors(startPos, endPos, ease);
      s.controls.target.lerpVectors(startTarget, endTarget, ease);
      s.controls.update();

      // Tape fade in
      (finalMesh.material as THREE.MeshStandardMaterial).opacity = ease;

      if (t < 1) {
        requestAnimationFrame(animateTape);
      } else {
        done = true;
        (finalMesh.material as THREE.MeshStandardMaterial).opacity = 1;
        (finalMesh.material as THREE.MeshStandardMaterial).transparent = false;
      }
    };
    requestAnimationFrame(animateTape);

    // Gentle tape pulse after arrival
    let pulseFrame = 0;
    const pulse = (now: number) => {
      if (s.tapeMesh !== finalMesh) return; // replaced
      const mat = finalMesh.material as THREE.MeshStandardMaterial;
      if (!mat.transparent) {
        // Add subtle emissive pulse
        const p = (Math.sin(now * 0.003) + 1) * 0.5;
        mat.emissive.setRGB(p * 0.15, p * 0.1, 0);
      }
      pulseFrame = requestAnimationFrame(pulse);
    };
    setTimeout(() => { pulseFrame = requestAnimationFrame(pulse); }, DURATION);

    return () => { cancelAnimationFrame(pulseFrame); };
  }, [activeField]);

  return (
    <div
      ref={mountRef}
      className="w-full rounded-xl overflow-hidden border border-border bg-card"
      style={{ height: 340, touchAction: "none" }}
    />
  );
}
