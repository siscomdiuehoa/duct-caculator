import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { bounds, edges, flanges, triangles } from '../core/measure';
import type { Panel } from '../core/types';
import type { Model } from '../core/types';

export type Preset = 'iso' | 'front' | 'side' | 'plan';

interface Props {
  model: Model;
  /** Flange width in mm; 0 draws none. */
  flange: number;
  /** Changes when the camera should re-frame the model (fitting change or preset click). */
  frameKey: string;
  preset: Preset;
  showDims: boolean;
  dimText: (label: string, mm: number) => string;
  failText: string;
}

/** AutoCAD colour index values: 4 cyan body, 2 yellow flanges, 3 green dimensions, 7 white edges. */
const ACI = { body: 0x00ffff, flange: 0xffff00, dim: 0x00ff00, edge: 0xffffff };

const DIRS: Record<Preset, [number, number, number]> = {
  iso: [1, -1.25, 0.8],
  front: [0, -1, 0],
  side: [1, 0, 0],
  plan: [0, 0, 1],
};

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  group: THREE.Group;
  render: () => void;
}

export function Viewer3D({ model, flange, frameKey, preset, showDims, dimText, failText }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 1, 1e6);
    camera.up.set(0, 0, 1);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x5a6672, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    camera.add(sun);
    sun.position.set(-0.4, 0.6, 1);
    scene.add(camera);
    const group = new THREE.Group();
    scene.add(group);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;

    const v = new THREE.Vector3();
    const render = () => {
      renderer.render(scene, camera);
      const box = labels.current;
      if (!box) return;
      const { clientWidth: w, clientHeight: h } = el;
      for (const node of Array.from(box.children) as HTMLElement[]) {
        v.set(+node.dataset.x!, +node.dataset.y!, +node.dataset.z!).project(camera);
        node.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
        node.style.visibility = v.z < 1 ? 'visible' : 'hidden';
      }
    };
    controls.addEventListener('change', render);
    const resize = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = el;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    });
    resize.observe(el);
    stage.current = { renderer, scene, camera, controls, group, render };
    return () => {
      resize.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      stage.current = null;
    };
  }, []);

  // Rebuild the mesh whenever the model or the dimension toggle changes.
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    for (const child of [...s.group.children]) {
      s.group.remove(child);
      const m = child as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    const flat = (pts: number[][]) => new THREE.Float32BufferAttribute(pts.flat(), 3);
    const solid = (panels: Panel[], color: number) => {
      if (!panels.length) return;
      const skin = new THREE.BufferGeometry();
      skin.setAttribute('position', flat(triangles(panels).flat()));
      skin.computeVertexNormals();
      s.group.add(
        new THREE.Mesh(
          skin,
          new THREE.MeshStandardMaterial({
            color,
            metalness: 0,
            roughness: 0.7,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          }),
        ),
      );
      const wire = new THREE.BufferGeometry();
      wire.setAttribute('position', flat(edges(panels).flat()));
      s.group.add(new THREE.LineSegments(wire, new THREE.LineBasicMaterial({ color: ACI.edge })));
    };
    solid(model.panels, ACI.body);
    solid(flanges(model, flange), ACI.flange);
    if (showDims) {
      const dim = new THREE.BufferGeometry();
      dim.setAttribute('position', flat(model.dims.flatMap((d) => [d.a, d.b])));
      s.group.add(new THREE.LineSegments(dim, new THREE.LineBasicMaterial({ color: ACI.dim, depthTest: false })));
    }
    s.render();
  }, [model, flange, showDims]);

  // Frame the model when the fitting or the preset changes.
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    const { min, max } = bounds(model);
    const centre = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
    const fov = (s.camera.fov * Math.PI) / 180;
    const fit = radius / Math.sin(Math.min(fov, fov * s.camera.aspect) / 2);
    const dir = new THREE.Vector3(...DIRS[preset]).normalize();
    // Looking straight down needs a different up vector than the Z-up default.
    s.camera.up.set(0, preset === 'plan' ? 1 : 0, preset === 'plan' ? 0 : 1);
    s.camera.position.copy(centre).addScaledVector(dir, fit * 1.15);
    s.camera.near = fit / 100;
    s.camera.far = fit * 100;
    s.camera.updateProjectionMatrix();
    s.controls.target.copy(centre);
    s.controls.update();
    s.render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey, preset]);

  useEffect(() => stage.current?.render());

  if (failed) return <div className="viewer-fail">{failText}</div>;
  return (
    <div className="viewer-canvas" ref={host}>
      <div className="dim-labels" ref={labels}>
        {showDims &&
          model.dims.map((d) => (
            <span
              key={d.label}
              data-x={(d.a[0] + d.b[0]) / 2}
              data-y={(d.a[1] + d.b[1]) / 2}
              data-z={(d.a[2] + d.b[2]) / 2}
            >
              {dimText(d.label, Math.hypot(d.a[0] - d.b[0], d.a[1] - d.b[1], d.a[2] - d.b[2]))}
            </span>
          ))}
      </div>
    </div>
  );
}
