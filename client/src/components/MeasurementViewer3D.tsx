import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// ─── Materials ────────────────────────────────────────────────────────────────
const MAT_TAPE  = () => new THREE.MeshStandardMaterial({ color: 0xf0c060, roughness: 0.4, metalness: 0.15, emissive: new THREE.Color(0x201000) });
const MAT_FLOOR = () => new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 1.0 });
const MAT_WALL  = () => new THREE.MeshStandardMaterial({ color: 0xfafaf6, roughness: 1.0 });
const MAT_EDGE  = () => new THREE.MeshStandardMaterial({ color: 0xd8d2c8, roughness: 1.0 });

// Silhouette material — warm matte skin tone matching Stitch design system
const MAT_SILHOUETTE = () => new THREE.MeshStandardMaterial({
  color: new THREE.Color(0xd4c4b4),  // warm beige/stone
  roughness: 0.85,
  metalness: 0.0,
});

// Meshes to SHOW (everything else is hidden — removes clothes, hair, glasses, etc.)
const SHOW_MESHES = new Set(["Wolf3D_Body", "Wolf3D_Head"]);

// ─── Pose definitions ────────────────────────────────────────────────────────
// RPM avatars use bare bone names (no mixamorig: prefix)
// A-pose: arms ~50° down  |  T-pose: arms fully horizontal
type PoseAngles = { leftArm: number; rightArm: number };

const POSE_A: PoseAngles = { leftArm:  Math.PI * 0.28, rightArm: -Math.PI * 0.28 };
const POSE_T: PoseAngles = { leftArm:  Math.PI * 0.50, rightArm: -Math.PI * 0.50 };

// Measurements that need T-pose (arms out for tape to fit cleanly)
const T_POSE_FIELDS = new Set(["chest", "bust", "shoulders", "sleeve"]);

// ─── Smooth pose animation ────────────────────────────────────────────────────
function animatePose(scene: THREE.Scene, target: PoseAngles, duration = 400): void {
  const leftArm  = scene.getObjectByName("LeftArm");
  const rightArm = scene.getObjectByName("RightArm");
  if (!leftArm || !rightArm) return;

  const startL = leftArm.rotation.z;
  const startR = rightArm.rotation.z;
  const t0 = performance.now();

  const step = (now: number) => {
    const t = Math.min((now - t0) / duration, 1);
    const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    leftArm.rotation.z  = startL + (target.leftArm  - startL) * e;
    rightArm.rotation.z = startR + (target.rightArm - startR) * e;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ─── Tape measure builders ────────────────────────────────────────────────────
function buildLoopTape(cx: number, cy: number, cz: number, rx: number, rz: number): THREE.Mesh {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 100; i++) {
    const t = (i / 100) * Math.PI * 2;
    pts.push(new THREE.Vector3(cx + Math.cos(t) * rx, cy, cz + Math.sin(t) * rz));
  }
  return new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 140, 0.007, 8, true),
    MAT_TAPE()
  );
}

function buildVertTape(x: number, y0: number, y1: number, z: number): THREE.Mesh {
  const pts = [
    new THREE.Vector3(x, y0, z),
    new THREE.Vector3(x + 0.02, (y0 + y1) / 2, z),
    new THREE.Vector3(x, y1, z),
  ];
  return new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.007, 8, false),
    MAT_TAPE()
  );
}

function buildTickMarks(cx: number, cy: number, cz: number, rx: number, rz: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a6020 });
  for (let i = 0; i < 24; i++) {
    const t = (i / 24) * Math.PI * 2;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.003, i % 6 === 0 ? 0.022 : 0.013, 0.003),
      mat
    );
    m.position.set(cx + Math.cos(t) * rx, cy, cz + Math.sin(t) * rz);
    m.rotation.y = -t;
    g.add(m);
  }
  return g;
}

// ─── Measurement configs ──────────────────────────────────────────────────────
// Calibrated to RPM avatar Y range: male 0→1.856, female 0→1.765
type LoopCfg = { type: "loop"; cx: number; cy: number; cz: number; rx: number; rz: number; camPos: [number,number,number]; camTarget: [number,number,number] };
type VertCfg = { type: "vert"; x: number; y0: number; y1: number; z: number; camPos: [number,number,number]; camTarget: [number,number,number] };
type TapeCfg = LoopCfg | VertCfg;

const TAPE: Record<string, TapeCfg> = {
  // T-pose (arms out)
  height:    { type:"vert", x: 0.50,  y0:0.01, y1:1.82, z:0,           camPos:[2.8, 1.0, 2.0],  camTarget:[0.4,  0.9,  0] },
  chest:     { type:"loop", cx:0, cy:1.32, cz:0, rx:0.22, rz:0.14,      camPos:[1.8, 1.35, 1.6], camTarget:[0,    1.32, 0] },
  bust:      { type:"loop", cx:0, cy:1.25, cz:0, rx:0.22, rz:0.15,      camPos:[1.8, 1.3,  1.6], camTarget:[0,    1.25, 0] },
  shoulders: { type:"loop", cx:0, cy:1.45, cz:0, rx:0.27, rz:0.14,      camPos:[0,   2.2,  2.2], camTarget:[0,    1.45, 0] },
  sleeve:    { type:"vert", x:-0.48, y0:0.90, y1:1.45, z:0,             camPos:[-2.4,1.35, 1.8], camTarget:[-0.2, 1.2,  0] },
  // A-pose (arms down)
  waist:     { type:"loop", cx:0, cy:1.05, cz:0, rx:0.16, rz:0.12,      camPos:[1.8, 1.1,  1.6], camTarget:[0,    1.05, 0] },
  hips:      { type:"loop", cx:0, cy:0.88, cz:0, rx:0.20, rz:0.16,      camPos:[1.8, 0.9,  1.6], camTarget:[0,    0.88, 0] },
  inseam:    { type:"vert", x:-0.17, y0:0.01, y1:0.80, z:0,             camPos:[2.0, 0.5,  2.2], camTarget:[0,    0.4,  0] },
  thigh:     { type:"loop", cx:-0.10, cy:0.72, cz:0, rx:0.09, rz:0.08,  camPos:[1.8, 0.75, 1.8], camTarget:[-0.1, 0.72, 0] },
  weight:    { type:"loop", cx:0, cy:0.94, cz:0, rx:0.21, rz:0.16,      camPos:[1.8, 1.0,  2.0], camTarget:[0,    0.94, 0] },
};

// ─── Main component ───────────────────────────────────────────────────────────
interface Props { activeField: string | null; gender: "male" | "female" | "both" }

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

  // ── Init scene (re-runs on gender change) ─────────────────────────────────
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const W = el.clientWidth, H = el.clientHeight || 360;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0xfafaf8, 1);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xfafaf8, 6, 14);

    const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 30);
    camera.position.set(2.2, 1.4, 2.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.9, 0);
    controls.enablePan = false;
    controls.minDistance = 1.2;
    controls.maxDistance = 5.5;
    controls.minPolarAngle = 0.1;
    controls.maxPolarAngle = Math.PI * 0.88;
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.update();

    // ── Lighting ──
    scene.add(new THREE.AmbientLight(0xfff8f2, 1.2));

    const key = new THREE.DirectionalLight(0xfff4e8, 1.4);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 16;
    Object.assign(key.shadow.camera, { left: -2, right: 2, top: 3, bottom: -0.5 });
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xe8eeff, 0.6);
    fill.position.set(-3, 2, -2);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.3);
    rim.position.set(0, 4, -4);
    scene.add(rim);

    // ── Environment ──
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), MAT_FLOOR());
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const wall = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), MAT_WALL());
    wall.position.set(0, 2.5, -1.6);
    scene.add(wall);

    const edge = new THREE.Mesh(new THREE.BoxGeometry(6, 0.018, 0.018), MAT_EDGE());
    edge.position.set(0, 0.009, -1.6);
    scene.add(edge);

    const grid = new THREE.GridHelper(4, 10, 0xe0dcd4, 0xe0dcd4);
    grid.position.y = 0.001;
    scene.add(grid);

    // ── Load GLB ──
    const modelPath = gender === "female" ? "/models/body_female.glb" : "/models/body_male.glb";
    const loader = new GLTFLoader();
    const silMat = MAT_SILHOUETTE();

    loader.load(
      modelPath,
      (gltf) => {
        const model = gltf.scene;

        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const meshName = mesh.name;

            if (SHOW_MESHES.has(meshName)) {
              // Show body/head — replace all textures with clean silhouette material
              mesh.material = silMat;
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              mesh.visible = true;
            } else {
              // Hide everything else: clothes, hair, glasses, eyes, teeth
              mesh.visible = false;
            }
          }
        });

        // Start in A-pose
        const la = model.getObjectByName("LeftArm");
        const ra = model.getObjectByName("RightArm");
        if (la) la.rotation.z = POSE_A.leftArm;
        if (ra) ra.rotation.z = POSE_A.rightArm;

        scene.add(model);
      },
      undefined,
      () => {
        // Fallback silhouette body if GLB fails
        scene.add(buildFallback());
      }
    );

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
      const h = mountRef.current.clientHeight || 360;
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

  // ── Active field → tape + pose ────────────────────────────────────────────
  useEffect(() => {
    const r = refs.current;
    if (!r) return;

    r.tapeGroup.clear();

    // Switch pose
    animatePose(r.scene, activeField && T_POSE_FIELDS.has(activeField) ? POSE_T : POSE_A);

    if (!activeField || !TAPE[activeField]) return;
    const cfg = TAPE[activeField];

    let tapeMesh: THREE.Mesh;
    if (cfg.type === "loop") {
      tapeMesh = buildLoopTape(cfg.cx, cfg.cy, cfg.cz, cfg.rx, cfg.rz);
      r.tapeGroup.add(buildTickMarks(cfg.cx, cfg.cy, cfg.cz, cfg.rx + 0.012, cfg.rz + 0.012));
    } else {
      tapeMesh = buildVertTape(cfg.x, cfg.y0, cfg.y1, cfg.z);
    }
    r.tapeGroup.add(tapeMesh);

    // Camera animation
    const startPos    = r.camera.position.clone();
    const startTarget = r.controls.target.clone();
    const endPos      = new THREE.Vector3(...cfg.camPos);
    const endTarget   = new THREE.Vector3(...cfg.camTarget);
    const t0 = performance.now();
    const DURATION = 550;

    const mat = tapeMesh.material as THREE.MeshStandardMaterial;
    mat.transparent = true;
    mat.opacity = 0;

    let animId = 0;
    const anim = (now: number) => {
      const t = Math.min((now - t0) / DURATION, 1);
      const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      r.camera.position.lerpVectors(startPos, endPos, e);
      r.controls.target.lerpVectors(startTarget, endTarget, e);
      r.controls.update();
      mat.opacity = e;
      if (t < 1) { animId = requestAnimationFrame(anim); }
      else { mat.transparent = false; mat.opacity = 1; }
    };
    animId = requestAnimationFrame(anim);

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

// ─── Fallback silhouette (if GLB fails to load) ───────────────────────────────
function buildFallback(): THREE.Group {
  const g = new THREE.Group();
  const mat = MAT_SILHOUETTE();
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
  };
  add(new THREE.SphereGeometry(0.12, 20, 16), 0, 1.72, 0);
  add(new THREE.CapsuleGeometry(0.19, 0.55, 8, 16), 0, 1.20, 0);
  add(new THREE.CapsuleGeometry(0.07, 0.35, 6, 12), -0.28, 1.18, 0);
  add(new THREE.CapsuleGeometry(0.07, 0.35, 6, 12),  0.28, 1.18, 0);
  add(new THREE.CapsuleGeometry(0.05, 0.28, 6, 10), -0.30, 0.82, 0);
  add(new THREE.CapsuleGeometry(0.05, 0.28, 6, 10),  0.30, 0.82, 0);
  add(new THREE.CapsuleGeometry(0.09, 0.38, 6, 14), -0.10, 0.62, 0);
  add(new THREE.CapsuleGeometry(0.09, 0.38, 6, 14),  0.10, 0.62, 0);
  add(new THREE.CapsuleGeometry(0.065, 0.32, 6, 12), -0.12, 0.20, 0);
  add(new THREE.CapsuleGeometry(0.065, 0.32, 6, 12),  0.12, 0.20, 0);
  return g;
}
