import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// ─── Materials ────────────────────────────────────────────────────────────────
const MAT_TAPE  = () => new THREE.MeshStandardMaterial({ color: 0xf0c060, roughness: 0.4, metalness: 0.15, emissive: new THREE.Color(0x201000) });
const MAT_FLOOR = () => new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 1.0 });
const MAT_WALL  = () => new THREE.MeshStandardMaterial({ color: 0xfafaf6, roughness: 1.0 });
const MAT_EDGE  = () => new THREE.MeshStandardMaterial({ color: 0xd8d2c8, roughness: 1.0 });

// ─── Pose definitions ────────────────────────────────────────────────────────
// Both Xbot (male) and Michelle (female) use the same Mixamo rig.
// We define two poses and smoothly interpolate between them.

// A-pose: arms ~45° down from horizontal (natural standing pose)
// T-pose: arms fully horizontal (good for chest / shoulder / sleeve measurements)

type PoseAngles = { leftArm: number; rightArm: number };  // rotation.z on upper arm bone

const POSE_A: PoseAngles = { leftArm:  Math.PI * 0.30,  rightArm: -Math.PI * 0.30 };  // ~54° down
const POSE_T: PoseAngles = { leftArm:  Math.PI * 0.50,  rightArm: -Math.PI * 0.50 };  // fully out

// Which measurements need T-pose (arms out)
const T_POSE_FIELDS = new Set(["chest", "bust", "shoulders", "sleeve"]);

// ─── Tape measure builders ────────────────────────────────────────────────────
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

function buildTickMarks(cx: number, cy: number, cz: number, rx: number, rz: number): THREE.Group {
  const g = new THREE.Group();
  const tickMat = new THREE.MeshStandardMaterial({ color: 0x8a6020 });
  for (let i = 0; i < 24; i++) {
    const t = (i / 24) * Math.PI * 2;
    const x = cx + Math.cos(t) * rx;
    const z = cz + Math.sin(t) * rz;
    const isMain = i % 6 === 0;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.003, isMain ? 0.022 : 0.013, 0.003),
      tickMat
    );
    m.position.set(x, cy, z);
    m.rotation.y = -t;
    g.add(m);
  }
  return g;
}

// ─── Measurement configs ──────────────────────────────────────────────────────
// Xbot Y range: 0–1.806  |  Michelle Y range: 0–1.662
// Tape coords are calibrated for Xbot (male); female model is same relative scale.
// T-POSE configs: arms out for chest/bust/shoulders/sleeve
// A-POSE configs: arms down for everything else

type LoopCfg = { type: "loop"; cx: number; cy: number; cz: number; rx: number; rz: number; camPos: [number,number,number]; camTarget: [number,number,number]; };
type VertCfg = { type: "vert"; x: number; y0: number; y1: number; z: number; camPos: [number,number,number]; camTarget: [number,number,number]; };
type TapeCfg = LoopCfg | VertCfg;

const TAPE: Record<string, TapeCfg> = {
  // T-pose measurements (arms out)
  height:    { type:"vert", x: 0.50,  y0:0.01, y1:1.80, z:0,          camPos:[2.8, 1.0, 2.0],  camTarget:[0.4,  0.9,  0] },
  chest:     { type:"loop", cx:0, cy:1.32, cz:0, rx:0.23, rz:0.15,     camPos:[1.8, 1.35, 1.6], camTarget:[0,    1.32, 0] },
  bust:      { type:"loop", cx:0, cy:1.26, cz:0, rx:0.23, rz:0.16,     camPos:[1.8, 1.3,  1.6], camTarget:[0,    1.26, 0] },
  shoulders: { type:"loop", cx:0, cy:1.44, cz:0, rx:0.28, rz:0.15,     camPos:[0,   2.2,  2.2], camTarget:[0,    1.44, 0] },
  sleeve:    { type:"vert", x:-0.50,  y0:0.90, y1:1.44, z:0,           camPos:[-2.4,1.35, 1.8], camTarget:[-0.2, 1.2,  0] },
  // A-pose measurements (arms down)
  waist:     { type:"loop", cx:0, cy:1.06, cz:0, rx:0.17, rz:0.13,     camPos:[1.8, 1.1,  1.6], camTarget:[0,    1.06, 0] },
  hips:      { type:"loop", cx:0, cy:0.90, cz:0, rx:0.22, rz:0.17,     camPos:[1.8, 0.9,  1.6], camTarget:[0,    0.90, 0] },
  inseam:    { type:"vert", x:-0.18, y0:0.01, y1:0.80, z:0,            camPos:[2.0, 0.5,  2.2], camTarget:[0,    0.4,  0] },
  thigh:     { type:"loop", cx:-0.11, cy:0.73, cz:0, rx:0.10, rz:0.09, camPos:[1.8, 0.75, 1.8], camTarget:[-0.1, 0.73, 0] },
  weight:    { type:"loop", cx:0, cy:0.95, cz:0, rx:0.22, rz:0.17,     camPos:[1.8, 1.0,  2.0], camTarget:[0,    0.95, 0] },
};

// ─── Smooth pose animation ────────────────────────────────────────────────────
function animatePose(
  scene: THREE.Scene,
  targetPose: PoseAngles,
  duration = 400
): void {
  const leftArm  = scene.getObjectByName("mixamorig:LeftArm");
  const rightArm = scene.getObjectByName("mixamorig:RightArm");
  if (!leftArm || !rightArm) return;

  const startL = leftArm.rotation.z;
  const startR = rightArm.rotation.z;
  const t0 = performance.now();

  const step = (now: number) => {
    const t = Math.min((now - t0) / duration, 1);
    const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease in-out
    leftArm.rotation.z  = startL + (targetPose.leftArm  - startL) * e;
    rightArm.rotation.z = startR + (targetPose.rightArm - startR) * e;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

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
    modelLoaded: boolean;
  } | null>(null);

  // ── Scene init (re-runs when gender changes) ──────────────────────────────
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const W = el.clientWidth, H = el.clientHeight || 360;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
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
    scene.add(new THREE.AmbientLight(0xfff8f2, 1.1));

    const key = new THREE.DirectionalLight(0xfff4e8, 1.6);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 16;
    Object.assign(key.shadow.camera, { left: -2, right: 2, top: 3, bottom: -0.5 });
    scene.add(key);
    scene.add(Object.assign(new THREE.DirectionalLight(0xe4eeff, 0.5), { position: new THREE.Vector3(-3, 2, -2) }));
    scene.add(Object.assign(new THREE.DirectionalLight(0xffffff, 0.25), { position: new THREE.Vector3(0, 3, -4) }));

    // ── Environment ──
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), MAT_FLOOR());
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const wall = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), MAT_WALL());
    wall.position.set(0, 2.5, -1.6);
    wall.receiveShadow = true;
    scene.add(wall);

    scene.add(Object.assign(
      new THREE.Mesh(new THREE.BoxGeometry(6, 0.018, 0.018), MAT_EDGE()),
      { position: new THREE.Vector3(0, 0.009, -1.6) }
    ));

    const grid = new THREE.GridHelper(4, 10, 0xe0dcd4, 0xe0dcd4);
    grid.position.y = 0.001;
    scene.add(grid);

    // ── Load GLB body ──
    const modelPath = gender === "female" ? "/models/body_female.glb" : "/models/body_male.glb";
    const loader = new GLTFLoader();

    // Warm skin tone matching Stitch design system
    const skinColor  = new THREE.Color(0xe8ddd4);  // warm beige
    const accentColor = new THREE.Color(0xc8956a); // terracotta — for joints/secondary parts

    loader.load(
      modelPath,
      (gltf) => {
        const model = gltf.scene;
        model.scale.set(1, 1, 1);
        model.position.set(0, 0, 0);

        // Re-skin with Stitch palette
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            const matName = ((mesh.material as THREE.Material)?.name || "").toLowerCase();
            const useAccent = matName.includes("joint") || matName.includes("beta_joint");
            mesh.material = new THREE.MeshStandardMaterial({
              color: useAccent ? accentColor : skinColor,
              roughness: 0.65,
              metalness: 0.0,
            });
          }
        });

        // Start in A-pose (arms slightly down)
        const leftArm  = model.getObjectByName("mixamorig:LeftArm");
        const rightArm = model.getObjectByName("mixamorig:RightArm");
        if (leftArm)  leftArm.rotation.z  = POSE_A.leftArm;
        if (rightArm) rightArm.rotation.z = POSE_A.rightArm;

        scene.add(model);
        if (refs.current) refs.current.modelLoaded = true;
      },
      undefined,
      () => {
        // Fallback if GLB can't load
        scene.add(buildFallbackBody());
        if (refs.current) refs.current.modelLoaded = true;
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

    refs.current = { renderer, scene, camera, controls, tapeGroup, raf, modelLoaded: false };

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

    // Clear old tape
    r.tapeGroup.clear();

    // Switch pose based on field
    const wantTPose = activeField ? T_POSE_FIELDS.has(activeField) : false;
    animatePose(r.scene, wantTPose ? POSE_T : POSE_A);

    if (!activeField || !TAPE[activeField]) return;
    const cfg = TAPE[activeField];

    // Build tape geometry
    let tapeMesh: THREE.Mesh;
    if (cfg.type === "loop") {
      tapeMesh = buildLoopTape(cfg.cx, cfg.cy, cfg.cz, cfg.rx, cfg.rz);
      r.tapeGroup.add(buildTickMarks(cfg.cx, cfg.cy, cfg.cz, cfg.rx + 0.012, cfg.rz + 0.012));
    } else {
      tapeMesh = buildVertTape(cfg.x, cfg.y0, cfg.y1, cfg.z);
    }
    r.tapeGroup.add(tapeMesh);

    // Animate camera to measurement
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

// ─── Fallback body (if GLB fails to load) ────────────────────────────────────
function buildFallbackBody(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xe8ddd4, roughness: 0.6 });
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
  };
  add(new THREE.SphereGeometry(0.12, 16, 12), 0, 1.72, 0);
  add(new THREE.CapsuleGeometry(0.18, 0.55, 8, 16), 0, 1.2, 0);
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
