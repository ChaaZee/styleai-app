import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// ─── Material palette ─────────────────────────────────────────────────────────
const MAT_BODY   = () => new THREE.MeshStandardMaterial({ color: 0xe8ddd4, roughness: 0.55, metalness: 0.02 });
const MAT_TAPE   = () => new THREE.MeshStandardMaterial({ color: 0xf0c060, roughness: 0.4,  metalness: 0.15, emissive: new THREE.Color(0x201000) });
const MAT_FLOOR  = () => new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 1.0 });
const MAT_WALL   = () => new THREE.MeshStandardMaterial({ color: 0xfafaf6, roughness: 1.0 });
const MAT_EDGE   = () => new THREE.MeshStandardMaterial({ color: 0xd8d2c8, roughness: 1.0 });

// ─── Build smooth organic body ────────────────────────────────────────────────
// Uses LatheGeometry for the torso (revolution of a profile curve) +
// SphereGeometry for head + CapsuleGeometry for limbs

function capsule(
  radiusTop: number, radiusBottom: number, height: number,
  radSeg = 12, capSeg = 8
): THREE.BufferGeometry {
  // Build a smooth capsule-like shape via CylinderGeometry with half-sphere caps merged
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radSeg, 1, false);
  return geo;
}

function buildBody(gender: "male" | "female" | "both"): THREE.Group {
  const isFem = gender === "female";
  const g = new THREE.Group();
  const mat = MAT_BODY();

  const mesh = (geo: THREE.BufferGeometry, x=0, y=0, z=0, rx=0, ry=0, rz=0, sx=1, sy=1, sz=1) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  // ── HEAD ─────────────────────────────────────────────────────────────────────
  // Main cranium
  const head = new THREE.SphereGeometry(0.115, 24, 20);
  mesh(head, 0, 1.73, 0);
  // Jaw/chin — slightly flattened sphere offset down
  const jaw = new THREE.SphereGeometry(0.088, 20, 16);
  mesh(jaw, 0, 1.618, 0.01, 0, 0, 0, 1, 0.78, 0.92);
  // Nose bump
  mesh(new THREE.SphereGeometry(0.025, 10, 8), 0, 1.66, 0.115);

  // ── NECK ─────────────────────────────────────────────────────────────────────
  mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.14, 14), 0, 1.535, 0);

  // ── TORSO via LatheGeometry ────────────────────────────────────────────────
  // Profile points [radius, y] from hip to top of torso
  // Male: broader shoulders, slimmer hips
  // Female: narrower shoulders, wider hips, defined waist
  const tPoints = isFem
    ? [
        new THREE.Vector2(0.215, 0.00),   // hip bottom
        new THREE.Vector2(0.225, 0.08),   // hip fullest
        new THREE.Vector2(0.21,  0.16),   // hip upper
        new THREE.Vector2(0.175, 0.26),   // waist
        new THREE.Vector2(0.185, 0.34),   // underbust
        new THREE.Vector2(0.205, 0.42),   // chest mid
        new THREE.Vector2(0.215, 0.50),   // chest fullest
        new THREE.Vector2(0.205, 0.57),   // chest upper
        new THREE.Vector2(0.195, 0.63),   // clavicle
        new THREE.Vector2(0.165, 0.70),   // neck base
      ]
    : [
        new THREE.Vector2(0.195, 0.00),   // hip bottom
        new THREE.Vector2(0.200, 0.08),   // hip
        new THREE.Vector2(0.195, 0.18),   // waist
        new THREE.Vector2(0.205, 0.28),   // mid torso
        new THREE.Vector2(0.225, 0.40),   // chest
        new THREE.Vector2(0.235, 0.50),   // chest fullest
        new THREE.Vector2(0.225, 0.58),   // chest upper
        new THREE.Vector2(0.215, 0.64),   // clavicle
        new THREE.Vector2(0.175, 0.70),   // neck base
      ];

  const torsoGeo = new THREE.LatheGeometry(tPoints, 28);
  mesh(torsoGeo, 0, 0.79, 0);

  // ── SHOULDER CAPS ─────────────────────────────────────────────────────────
  const shW = isFem ? 0.215 : 0.245;
  mesh(new THREE.SphereGeometry(0.072, 14, 12), -shW,  1.44, 0);
  mesh(new THREE.SphereGeometry(0.072, 14, 12),  shW, 1.44, 0);

  // ── BUST (female) ─────────────────────────────────────────────────────────
  if (isFem) {
    mesh(new THREE.SphereGeometry(0.068, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
      -0.083, 1.25, 0.145);
    mesh(new THREE.SphereGeometry(0.068, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
       0.083, 1.25, 0.145);
  }

  // ── UPPER ARMS ────────────────────────────────────────────────────────────
  const uaLen = isFem ? 0.25 : 0.27;
  const uaR   = isFem ? 0.048 : 0.056;
  const uaX   = isFem ? 0.285 : 0.315;

  const uaGeo = new THREE.CapsuleGeometry(uaR, uaLen, 6, 12);
  const la = mesh(uaGeo, -uaX, 1.31, 0, 0, 0, 0.14);
  const ra = mesh(uaGeo,  uaX, 1.31, 0, 0, 0, -0.14);

  // ── FOREARMS ──────────────────────────────────────────────────────────────
  const faLen = isFem ? 0.21 : 0.23;
  const faR   = isFem ? 0.034 : 0.040;
  const faX   = isFem ? 0.315 : 0.345;
  const faY   = 1.04;

  const faGeo = new THREE.CapsuleGeometry(faR, faLen, 5, 10);
  mesh(faGeo, -faX, faY, 0, 0, 0, 0.10);
  mesh(faGeo,  faX, faY, 0, 0, 0, -0.10);

  // ── HANDS ─────────────────────────────────────────────────────────────────
  const hX = isFem ? 0.33 : 0.36;
  mesh(new THREE.SphereGeometry(0.038, 10, 8), -hX, 0.86, 0, 0, 0, 0, 1, 0.75, 0.65);
  mesh(new THREE.SphereGeometry(0.038, 10, 8),  hX, 0.86, 0, 0, 0, 0, 1, 0.75, 0.65);

  // ── PELVIS ────────────────────────────────────────────────────────────────
  const pelW = isFem ? 0.195 : 0.175;
  mesh(new THREE.SphereGeometry(pelW, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    0, 0.78, 0, 0, 0, 0, 1, 0.7, 0.9);

  // ── THIGHS ────────────────────────────────────────────────────────────────
  const thR = isFem ? 0.092 : 0.096;
  const thLen = 0.36;
  const thX = isFem ? 0.105 : 0.095;
  const thGeo = new THREE.CapsuleGeometry(thR, thLen, 6, 14);
  mesh(thGeo, -thX, 0.565, 0, 0, 0,  0.04);
  mesh(thGeo,  thX, 0.565, 0, 0, 0, -0.04);

  // ── CALVES ────────────────────────────────────────────────────────────────
  const caLen = 0.30;
  const caGeo = new THREE.CapsuleGeometry(0.055, caLen, 6, 12);
  mesh(caGeo, -0.115, 0.195, 0, 0, 0,  0.025);
  mesh(caGeo,  0.115, 0.195, 0, 0, 0, -0.025);

  // ── FEET ──────────────────────────────────────────────────────────────────
  mesh(new THREE.CapsuleGeometry(0.038, 0.14, 4, 10), -0.118, 0.025, 0.04, 0, 0, Math.PI/2);
  mesh(new THREE.CapsuleGeometry(0.038, 0.14, 4, 10),  0.118, 0.025, 0.04, 0, 0, Math.PI/2);

  // ── HAIR ──────────────────────────────────────────────────────────────────
  const hairMat = new THREE.MeshStandardMaterial({ color: isFem ? 0xc8a060 : 0x503820, roughness: 0.9 });
  const hairTop = new THREE.SphereGeometry(0.118, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const hm = new THREE.Mesh(hairTop, hairMat);
  hm.position.set(0, 1.755, -0.012);
  hm.castShadow = true;
  g.add(hm);

  if (isFem) {
    // Longer side/back hair
    const sideHair = new THREE.CapsuleGeometry(0.07, 0.2, 4, 10);
    const sh = new THREE.Mesh(sideHair, hairMat);
    sh.position.set(0, 1.60, -0.065);
    sh.scale.set(1.3, 1, 0.7);
    sh.castShadow = true;
    g.add(sh);
  }

  return g;
}

// ─── Tape measure builder ─────────────────────────────────────────────────────

function buildLoopTape(cx: number, cy: number, cz: number, rx: number, rz: number): THREE.Mesh {
  const pts: THREE.Vector3[] = [];
  const N = 100;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    pts.push(new THREE.Vector3(cx + Math.cos(t) * rx, cy, cz + Math.sin(t) * rz));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true);
  const geo = new THREE.TubeGeometry(curve, 140, 0.007, 8, true);
  return new THREE.Mesh(geo, MAT_TAPE());
}

function buildVertTape(x: number, y0: number, y1: number, z: number): THREE.Mesh {
  const pts = [
    new THREE.Vector3(x, y0, z),
    new THREE.Vector3(x + 0.02, (y0 + y1) / 2, z),
    new THREE.Vector3(x, y1, z),
  ];
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, 40, 0.007, 8, false);
  return new THREE.Mesh(geo, MAT_TAPE());
}

function buildEndCaps(mesh: THREE.Mesh): THREE.Group {
  const g = new THREE.Group();
  const capMat = new THREE.MeshStandardMaterial({ color: 0x888060, roughness: 0.5 });
  const cap = new THREE.CylinderGeometry(0.018, 0.018, 0.012, 12);
  const c1 = new THREE.Mesh(cap, capMat);
  const c2 = new THREE.Mesh(cap, capMat);
  // approximate cap placement at start/end of tube
  c1.position.copy((mesh.geometry as THREE.TubeGeometry).parameters?.path?.getPointAt(0) || new THREE.Vector3());
  g.add(c1); g.add(c2);
  return g;
}

// ─── Tick marks on tape ───────────────────────────────────────────────────────
function buildTickMarks(cx: number, cy: number, cz: number, rx: number, rz: number): THREE.Group {
  const g = new THREE.Group();
  const tickMat = new THREE.MeshStandardMaterial({ color: 0x8a6020 });
  for (let i = 0; i < 24; i++) {
    const t = (i / 24) * Math.PI * 2;
    const x = cx + Math.cos(t) * rx;
    const z = cz + Math.sin(t) * rz;
    const isMain = i % 6 === 0;
    const tick = new THREE.BoxGeometry(0.003, isMain ? 0.022 : 0.013, 0.003);
    const m = new THREE.Mesh(tick, tickMat);
    m.position.set(x, cy, z);
    m.rotation.y = -t;
    g.add(m);
  }
  return g;
}

// ─── Measurement configs ──────────────────────────────────────────────────────
type LoopCfg = { type: "loop"; cx: number; cy: number; cz: number; rx: number; rz: number; camPos: [number,number,number]; camTarget: [number,number,number]; };
type VertCfg = { type: "vert"; x: number; y0: number; y1: number; z: number;   camPos: [number,number,number]; camTarget: [number,number,number]; };
type TapeCfg = LoopCfg | VertCfg;

const TAPE: Record<string, TapeCfg> = {
  height:    { type:"vert", x:0.50, y0:0.01, y1:1.85, z:0,       camPos:[2.8,1.0,2.0],  camTarget:[0.4, 0.9,0] },
  chest:     { type:"loop", cx:0, cy:1.32, cz:0, rx:0.225, rz:0.195, camPos:[1.8,1.35,1.6], camTarget:[0,1.32,0] },
  bust:      { type:"loop", cx:0, cy:1.26, cz:0, rx:0.235, rz:0.205, camPos:[1.8,1.3, 1.6], camTarget:[0,1.26,0] },
  waist:     { type:"loop", cx:0, cy:1.06, cz:0, rx:0.185, rz:0.165, camPos:[1.8,1.1, 1.6], camTarget:[0,1.06,0] },
  hips:      { type:"loop", cx:0, cy:0.85, cz:0, rx:0.23,  rz:0.20,  camPos:[1.8,0.9, 1.6], camTarget:[0,0.85,0] },
  shoulders: { type:"loop", cx:0, cy:1.44, cz:0, rx:0.265, rz:0.14,  camPos:[0,  2.2, 2.2], camTarget:[0,1.44,0] },
  sleeve:    { type:"vert", x:-0.38, y0:0.86, y1:1.44, z:0,         camPos:[-2.2,1.3,1.6], camTarget:[-0.2,1.2,0] },
  inseam:    { type:"vert", x:-0.2,  y0:0.01, y1:0.76, z:0,         camPos:[2.0, 0.5,2.2], camTarget:[0,  0.4,0] },
  thigh:     { type:"loop", cx:-0.11, cy:0.63, cz:0, rx:0.105, rz:0.1, camPos:[1.8,0.7,1.8], camTarget:[-0.1,0.63,0] },
  weight:    { type:"loop", cx:0, cy:0.92, cz:0, rx:0.22, rz:0.19,  camPos:[1.8,1.0, 2.0], camTarget:[0,0.92,0] },
};

// ─── Main component ───────────────────────────────────────────────────────────
interface Props { activeField: string | null; gender: "male" | "female" | "both"; }

export default function MeasurementViewer3D({ activeField, gender }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);

  const refs = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    tapeGroup: THREE.Group;
    raf: number;
  } | null>(null);

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const W = el.clientWidth, H = el.clientHeight || 340;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0xfafaf8, 1);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xfafaf8, 6, 14);

    const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 30);
    camera.position.set(2.2, 1.5, 2.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.9, 0);
    controls.enablePan = false;
    controls.minDistance = 1.4;
    controls.maxDistance = 5;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = Math.PI * 0.86;
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.update();

    // ── Lighting ──
    scene.add(new THREE.AmbientLight(0xfff8f2, 0.9));

    const key = new THREE.DirectionalLight(0xfff4e8, 1.8);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 16;
    Object.assign(key.shadow.camera, { left:-2, right:2, top:3, bottom:-0.5 });
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xe4eeff, 0.55);
    fill.position.set(-3, 2, -2);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.3);
    rim.position.set(0, 3, -4);
    scene.add(rim);

    // ── Floor ──
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), MAT_FLOOR());
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // ── Wall ──
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), MAT_WALL());
    wall.position.set(0, 2.5, -1.6);
    wall.receiveShadow = true;
    scene.add(wall);

    // Wall/floor baseboard
    const edge = new THREE.Mesh(new THREE.BoxGeometry(6, 0.018, 0.018), MAT_EDGE());
    edge.position.set(0, 0.009, -1.6);
    scene.add(edge);

    // Subtle floor grid lines (thin)
    const gridHelper = new THREE.GridHelper(4, 10, 0xe0dcd4, 0xe0dcd4);
    gridHelper.position.y = 0.001;
    scene.add(gridHelper);

    // ── Body ──
    const body = buildBody(gender === "both" ? "male" : gender);
    scene.add(body);

    // ── Tape group ──
    const tapeGroup = new THREE.Group();
    scene.add(tapeGroup);

    // ── Render loop ──
    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      controls.update();
      renderer.render(scene, camera);
    };
    render();

    // ── Resize ──
    const onResize = () => {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight || 340;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    refs.current = { renderer, scene, camera, controls, tapeGroup, raf };

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [gender]);

  // ── Active field → tape measure ───────────────────────────────────────────
  useEffect(() => {
    const r = refs.current;
    if (!r) return;

    // Clear old tape
    r.tapeGroup.clear();

    if (!activeField || !TAPE[activeField]) return;
    const cfg = TAPE[activeField];

    // Build tape + tick marks
    let tapeMesh: THREE.Mesh;
    if (cfg.type === "loop") {
      tapeMesh = buildLoopTape(cfg.cx, cfg.cy, cfg.cz, cfg.rx, cfg.rz);
      const ticks = buildTickMarks(cfg.cx, cfg.cy, cfg.cz, cfg.rx + 0.012, cfg.rz + 0.012);
      r.tapeGroup.add(ticks);
    } else {
      tapeMesh = buildVertTape(cfg.x, cfg.y0, cfg.y1, cfg.z);
    }
    r.tapeGroup.add(tapeMesh);

    // Animate camera + tape fade-in
    const startPos = r.camera.position.clone();
    const startTarget = r.controls.target.clone();
    const endPos = new THREE.Vector3(...cfg.camPos);
    const endTarget = new THREE.Vector3(...cfg.camTarget);
    const t0 = performance.now();
    const DURATION = 550;

    const mat = tapeMesh.material as THREE.MeshStandardMaterial;
    mat.transparent = true;
    mat.opacity = 0;

    let animId = 0;
    const anim = (now: number) => {
      const t = Math.min((now - t0) / DURATION, 1);
      const e = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
      r.camera.position.lerpVectors(startPos, endPos, e);
      r.controls.target.lerpVectors(startTarget, endTarget, e);
      r.controls.update();
      mat.opacity = e;
      if (t < 1) { animId = requestAnimationFrame(anim); }
      else { mat.transparent = false; mat.opacity = 1; }
    };
    animId = requestAnimationFrame(anim);

    // Pulse glow after arrival
    let pulseId = 0;
    const pulse = (now: number) => {
      const p = (Math.sin(now * 0.0025) + 1) * 0.5;
      mat.emissive.setRGB(p * 0.18, p * 0.10, 0);
      pulseId = requestAnimationFrame(pulse);
    };
    const pulseTimeout = setTimeout(() => { pulseId = requestAnimationFrame(pulse); }, DURATION + 50);

    return () => {
      cancelAnimationFrame(animId);
      cancelAnimationFrame(pulseId);
      clearTimeout(pulseTimeout);
    };
  }, [activeField]);

  return (
    <div
      ref={mountRef}
      className="w-full rounded-xl overflow-hidden border border-border"
      style={{ height: 360, touchAction: "none", background: "#fafaf8" }}
    />
  );
}
