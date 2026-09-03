import "./style.css";
import "@voxelize/core/styles.css";

import * as VOXELIZE from "@voxelize/core";
import * as THREE from "three";

import { FORGE_PALETTE, PALETTE_NAMES } from "./forge/palette";
import { setupForgeTextures } from "./forge/textures";

const WORLD_SERVICE_URL = "https://web-mcp-forge.onrender.com";
const WORLD_NAME = "flat";
const NETWORK_SECRET = "sadaddsdsadsadsadsadsadsadsadsadsaadsdsd212321sadghfhhey54t34dfsfsdfs";

const canvas = document.querySelector<HTMLCanvasElement>("#main")!;
const loading = document.querySelector<HTMLDivElement>("#loading")!;
const loadingMessage = document.querySelector<HTMLParagraphElement>("#loading-message")!;
const status = document.querySelector<HTMLParagraphElement>("#world-status")!;
const errorMessage = document.querySelector<HTMLParagraphElement>("#error-message")!;
const paletteElement = document.querySelector<HTMLDivElement>("#palette")!;

if (!canvas || !loading || !loadingMessage || !status || !errorMessage || !paletteElement) {
  throw new Error("Forge client shell is incomplete.");
}

const world = new VOXELIZE.World({ textureUnitDimension: 16 });
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  2000,
);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const inputs = new VOXELIZE.Inputs<"menu" | "in-game">();
const controls = new VOXELIZE.RigidControls(camera, renderer.domElement, world, {
  initialPosition: [0, 82, 0],
  flyForce: 400,
});
controls.connect(inputs, "in-game");

const voxelInteract = new VOXELIZE.VoxelInteract(controls.object, world, {
  highlightType: "outline",
  highlightColor: new THREE.Color("#f7d794"),
  highlightOpacity: 0.65,
  inverseDirection: true,
});
world.add(voxelInteract);

const network = new VOXELIZE.Network();
network.register(world).register(controls);

let selectedBlockId = 0;
let isReady = false;

function setStatus(message: string, state: "loading" | "ready" | "error" = "loading") {
  status.textContent = message;
  status.dataset.state = state;
}

function showError(message: string) {
  loadingMessage.textContent = "Forge World unavailable";
  errorMessage.textContent = message;
  errorMessage.hidden = false;
  setStatus(message, "error");
}

function createPalette() {
  FORGE_PALETTE.forEach((entry, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "palette-button";
    button.dataset.block = entry.name;
    button.innerHTML = `<span class="palette-index">${index + 1}</span><span>${entry.name}</span>`;
    button.addEventListener("click", () => selectPaletteEntry(entry.name));
    paletteElement.appendChild(button);
  });
}

function selectPaletteEntry(name: string) {
  const block = world.getBlockByName(name);
  selectedBlockId = block.id;
  paletteElement.querySelectorAll<HTMLButtonElement>(".palette-button").forEach((button) => {
    button.dataset.selected = String(button.dataset.block === name);
  });
  setStatus(`Ready · ${name} selected`, "ready");
}

function focusedPlace() {
  if (!isReady || !voxelInteract.potential || !voxelInteract.target) return;
  const [vx, vy, vz] = voxelInteract.potential.voxel;
  world.updateVoxels([{ vx, vy, vz, type: selectedBlockId }]);
}

function focusedRemove() {
  if (!isReady || !voxelInteract.target) return;
  const [vx, vy, vz] = voxelInteract.target;
  world.updateVoxels([{ vx, vy, vz, type: 0 }]);
}

inputs.click("left", focusedRemove, "in-game");
inputs.click("right", focusedPlace, "in-game");
inputs.bind("KeyF", controls.toggleFly, "in-game");

for (let index = 0; index < PALETTE_NAMES.length; index += 1) {
  inputs.bind(`Digit${index + 1}`, () => selectPaletteEntry(PALETTE_NAMES[index]), "in-game");
}

network.onConnect = () => setStatus("Connected · joining flat", "loading");
network.onDisconnect = () => {
  if (!isReady) {
    showError("World Service disconnected before the world was ready.");
    return;
  }
  setStatus("Disconnected · reconnecting…", "error");
};

world.addBlockUpdateListener(() => {
  if (isReady) {
    setStatus("Synced · authoritative world update", "ready");
  }
});

createPalette();

async function start() {
  try {
    setStatus("Connecting to World Service…");
    loadingMessage.textContent = "Connecting to Forge World…";
    await network.connect(WORLD_SERVICE_URL, { secret: NETWORK_SECRET });

    setStatus("Joining flat…");
    await network.join(WORLD_NAME);

    setStatus("Loading Registry…");
    await world.initialize();

    const registryNames = Array.from(world.registry.blocksByName.values()).map((block) => block.name);
    const expectedNames = ["Air", ...PALETTE_NAMES];
    if (registryNames.some((name) => !expectedNames.includes(name)) || registryNames.length !== expectedNames.length) {
      throw new Error("World Service returned a registry outside the Forge MVP palette.");
    }

    setStatus("Loading Pixel Perfection textures…");
    await setupForgeTextures(world);

    isReady = true;
    loading.hidden = true;
    selectPaletteEntry(PALETTE_NAMES[0]);
  } catch (error) {
    showError(error instanceof Error ? error.message : "Unable to load Forge World.");
  }
}

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

window.addEventListener("resize", resize);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

function animate() {
  requestAnimationFrame(animate);
  if (isReady) {
    controls.update();
    voxelInteract.update();
    world.update(
      controls.object.position,
      camera.getWorldDirection(new THREE.Vector3()),
    );
  }
  renderer.render(world, camera);
}

animate();
void start();
