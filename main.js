const DEFAULT_CARD_ID = "card_001";
const MAX_LAYERS = 5;

function $(id) {
  return document.getElementById(id);
}

function getCardIdFromUrl() {
  const url = new URL(window.location.href);
  const id = url.searchParams.get("id");
  return id && id.trim() ? id.trim() : DEFAULT_CARD_ID;
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return await res.json();
}

function setStatus(msg) {
  $("status").textContent = msg;
}

function clampLayers(layers) {
  if (!Array.isArray(layers)) return [];
  return layers.slice(0, MAX_LAYERS);
}

/**
 * Simple animation: float + spinY
 * - float: amplitude in units (e.g., 0.01)
 * - spinY: degrees per second
 */
AFRAME.registerComponent("layer-anim", {
  schema: {
    float: { type: "number", default: 0 },
    spinY: { type: "number", default: 0 }
  },
  init() {
    this.baseY = this.el.object3D.position.y;
  },
  tick(t, dt) {
    const time = t / 1000;
    const dts = dt / 1000;

    if (this.data.float > 0) {
      this.el.object3D.position.y = this.baseY + Math.sin(time * 2.0) * this.data.float;
    }
    if (this.data.spinY !== 0) {
      const radPerSec = (this.data.spinY * Math.PI) / 180;
      this.el.object3D.rotation.y += radPerSec * dts;
    }
  }
});

function makeEntityCommon(layer) {
  const e = document.createElement("a-entity");

  const [x, y, z] = layer.pos || [0, 0, 0.12];
  e.setAttribute("position", `${x} ${y} ${z}`);

  const [sx, sy, sz] = layer.scale || [0.2, 0.2, 0.2];
  e.setAttribute("scale", `${sx} ${sy} ${sz}`);

  const anim = layer.anim || {};
  const floatAmp = Number(anim.float || 0);
  const spinY = Number(anim.spinY || 0);
  if (floatAmp || spinY) {
    e.setAttribute("layer-anim", `float: ${floatAmp}; spinY: ${spinY}`);
  }

  return e;
}

function addImageLayer(anchor, layer) {
  // Use a plane with a transparent PNG texture
  const e = makeEntityCommon(layer);

  const plane = document.createElement("a-plane");
  plane.setAttribute("material", `src: url(${layer.src}); transparent: true;`);
  plane.setAttribute("rotation", "0 0 0");

  // For image layers, scale usually controls plane size better than entity scale,
  // so keep plane at 1x1 and scale entity to desired size.
  e.appendChild(plane);
  anchor.appendChild(e);
}

function addModelLayer(anchor, layer) {
  const e = makeEntityCommon(layer);

  const model = document.createElement("a-gltf-model");
  model.setAttribute("src", layer.src);
  e.appendChild(model);

  anchor.appendChild(e);
}

function ensureVideoAsset(layer) {
  // Create a hidden <video> element as a reusable texture source
  const assets = $("assets");
  const vidId = `vid_${btoa(layer.src).replace(/=/g, "")}`;

  if ($(vidId)) return vidId;

  const v = document.createElement("video");
  v.id = vidId;
  v.src = layer.src;
  v.crossOrigin = "anonymous";
  v.loop = true;
  v.playsInline = true;
  v.muted = true; // helps autoplay policies, but iOS still often needs a gesture
  v.preload = "auto";

  assets.appendChild(v);
  return vidId;
}

function addVideoLayer(anchor, layer) {
  const e = makeEntityCommon(layer);

  const vidId = ensureVideoAsset(layer);

  const plane = document.createElement("a-plane");
  plane.setAttribute("material", `src: #${vidId};`);
  e.appendChild(plane);

  anchor.appendChild(e);
}

function clearAnchor(anchor) {
  // Remove all children (previous layers)
  while (anchor.firstChild) anchor.removeChild(anchor.firstChild);
}

function showVideoButtonIfNeeded(layers) {
  const needsVideo = layers.some(l => l.type === "video");
  const btn = $("videoBtn");
  btn.style.display = needsVideo ? "inline-block" : "none";
}

async function main() {
  const cardId = getCardIdFromUrl();
  setStatus(`Card: ${cardId} — loading config…`);

  const config = await loadJSON("cards.json");
  const card = config[cardId];

  if (!card) {
    setStatus(`Unknown card id: ${cardId}. Using default: ${DEFAULT_CARD_ID}`);
  }

  const chosen = card || config[DEFAULT_CARD_ID];
  if (!chosen) {
    throw new Error("cards.json must include at least the default card config.");
  }

  // Set Instagram link for this card
  $("igBtn").href = chosen.instagramUrl || "https://instagram.com/";

  const layers = clampLayers(chosen.layers || []);
  showVideoButtonIfNeeded(layers);

  // MindAR scene + controls
  const sceneEl = document.querySelector("a-scene");
  const anchor = $("anchor");
  const startBtn = $("startBtn");
  const stopBtn = $("stopBtn");
  const videoBtn = $("videoBtn");

  // Build layers now (they’ll show once the target is detected)
  clearAnchor(anchor);

  for (const layer of layers) {
    if (!layer || !layer.type || !layer.src) continue;

    if (layer.type === "image") addImageLayer(anchor, layer);
    else if (layer.type === "model") addModelLayer(anchor, layer);
    else if (layer.type === "video") addVideoLayer(anchor, layer);
  }

  setStatus(`Ready. Tap “Start AR”, then point at the EC logo.`);

  startBtn.addEventListener("click", async () => {
    setStatus("Starting AR…");

    // MindAR system is available after scene loads
    const mindarSystem = sceneEl.systems["mindar-image-system"];
    if (!mindarSystem) {
      setStatus("MindAR not ready yet. Try again in a moment.");
      return;
    }

    try {
      await mindarSystem.start();
      startBtn.disabled = true;
      stopBtn.disabled = false;
      setStatus("AR started. Point at the EC logo.");
    } catch (err) {
      console.error(err);
      setStatus("Could not start AR (camera permission?).");
    }
  });

  stopBtn.addEventListener("click", async () => {
    const mindarSystem = sceneEl.systems["mindar-image-system"];
    if (!mindarSystem) return;
    await mindarSystem.stop();
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setStatus("Stopped. Tap Start AR to run again.");
  });

  // iOS often requires a user gesture to start video playback
  videoBtn.addEventListener("click", async () => {
    // Play all video assets we created
    const vids = document.querySelectorAll("a-assets video");
    for (const v of vids) {
      try {
        v.muted = false; // if sound, keep this false, but iOS may block without further steps
        await v.play();
      } catch (e) {
        console.warn("Video play blocked:", e);
      }
    }
    setStatus("Video started (if your browser allows it).");
  });
}

window.addEventListener("DOMContentLoaded", () => {
  main().catch(err => {
    console.error(err);
    setStatus(`Error: ${err.message}`);
  });
});
