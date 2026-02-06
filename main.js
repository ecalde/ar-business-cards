const DEFAULT_CARD_ID = "card_001";
const MAX_LAYERS = 5;
const spawnedEntities = [];

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

function getMindarCameraVideo() {
  // MindAR camera video is the one with a srcObject (live camera stream)
  const videos = Array.from(document.querySelectorAll("video"));
  return videos.find(v => v.srcObject) || null;
}

function iosForceCanvasAboveCamera(sceneEl) {
  let tries = 0;
  const timer = setInterval(() => {
    tries++;

    const camVideo = getMindarCameraVideo();
    const canvas = sceneEl?.renderer?.domElement || document.querySelector("canvas.a-canvas");

    if (!camVideo || !canvas) {
      if (tries > 40) clearInterval(timer);
      return;
    }

    // Put camera video behind everything
    camVideo.style.position = "fixed";
    camVideo.style.inset = "0";
    camVideo.style.width = "100%";
    camVideo.style.height = "100%";
    camVideo.style.objectFit = "cover";
    camVideo.style.zIndex = "0";

    // iOS Safari compositor tricks
    camVideo.style.opacity = "0.999";
    camVideo.style.webkitTransform = "translateZ(0)";
    camVideo.style.transform = "translateZ(0)";

    // Put canvas above the video
    canvas.style.position = "fixed";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.zIndex = "2";
    canvas.style.webkitTransform = "translateZ(1px)";
    canvas.style.transform = "translateZ(1px)";

    clearInterval(timer);
  }, 100);
}


function bringCanvasAboveVideoSafariHack() {
  let n = 0;
  const t = setInterval(() => {
    n++;

    const video = document.querySelector("video");
    const aCanvas = document.querySelector(".a-canvas");
    const canvas = document.querySelector("canvas");

    // Wait until both exist
    if (!video || !aCanvas || !canvas) {
      if (n >= 40) clearInterval(t);
      return;
    }

    // iOS Safari compositing hacks:
    // 1) "de-specialize" the video layer so z-index/stacking behaves
    video.style.opacity = "0.99";                 // IMPORTANT iOS trick
    video.style.webkitTransform = "translateZ(0)";
    video.style.transform = "translateZ(0)";
    video.style.position = "fixed";
    video.style.inset = "0";
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = "cover";
    video.style.zIndex = "0";

    // 2) Force the canvas above
    aCanvas.style.position = "fixed";
    aCanvas.style.inset = "0";
    aCanvas.style.zIndex = "2";
    aCanvas.style.webkitTransform = "translateZ(1px)";
    aCanvas.style.transform = "translateZ(1px)";

    canvas.style.position = "fixed";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.zIndex = "3";
    canvas.style.webkitTransform = "translateZ(2px)";
    canvas.style.transform = "translateZ(2px)";

    // 3) DOM order: put video first, then canvas wrapper, so canvas paints last
    // (Safari sometimes respects DOM order more than z-index for video layers.)
    if (video.parentElement !== document.body) document.body.appendChild(video);
    document.body.appendChild(aCanvas);

    clearInterval(t);
  }, 100);
}


function forceIosLayerOrder() {
  // Run a few times because iOS/Safari + A-Frame can recreate elements after start()
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;

    const video = document.querySelector("video");           // MindAR camera
    const canvas = document.querySelector("canvas");         // A-Frame WebGL
    const aCanvas = document.querySelector(".a-canvas");     // A-Frame wrapper

    if (video) {
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.style.position = "fixed";
      video.style.inset = "0";
      video.style.width = "100%";
      video.style.height = "100%";
      video.style.objectFit = "cover";
      video.style.zIndex = "0";
    }

    if (aCanvas) {
      aCanvas.style.position = "fixed";
      aCanvas.style.inset = "0";
      aCanvas.style.zIndex = "1";
    }

    if (canvas) {
      canvas.style.position = "fixed";
      canvas.style.inset = "0";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.zIndex = "2";
    }

    // After a few tries, stop
    if (tries >= 15) clearInterval(timer);
  }, 150);
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

AFRAME.registerComponent("always-on-top", {
  init() {
    this.apply = this.apply.bind(this);
    this.el.addEventListener("model-loaded", this.apply);
    // Apply soon for non-model entities too
    setTimeout(this.apply, 0);
  },
  apply() {
    const obj = this.el.object3D;
    obj.renderOrder = 999;

    obj.traverse((node) => {
      if (!node.isMesh) return;

      node.renderOrder = 999;

      const mat = node.material;
      const mats = Array.isArray(mat) ? mat : [mat];

      for (const m of mats) {
        if (!m) continue;
        m.depthTest = false;
        m.depthWrite = false;
        m.transparent = true;
        m.needsUpdate = true;
      }
    });
  },
  remove() {
    this.el.removeEventListener("model-loaded", this.apply);
  }
});


function makeEntityCommon(layer) {
  const e = document.createElement("a-entity");

  const [x, y, z] = layer.pos || [0, 0, -0.12];
  e.setAttribute("position", `${x} ${y} ${z}`);

  const [sx, sy, sz] = layer.scale || [0.2, 0.2, 0.2];
  e.setAttribute("scale", `${sx} ${sy} ${sz}`);

  const anim = layer.anim || {};
  const floatAmp = Number(anim.float || 0);

  // ❌ Disable spin entirely for now
  const spinY = 0;

  if (floatAmp) {
    e.setAttribute("layer-anim", `float: ${floatAmp}; spinY: 0`);
  }

  e.setAttribute("always-on-top", "");

  return e;
}

function addImageLayer(anchor, layer) {
  const e = makeEntityCommon(layer);

  const plane = document.createElement("a-plane");

  // Disable fallback color + mipmap artifacts
  const bust = Date.now(); // simple cache-buster
  plane.setAttribute(
    "material",
    `src: url(${layer.src}?v=${bust}); transparent: true; alphaTest: 0.01; side: double; color: #fff; shader: flat;`
  );
  plane.setAttribute("side", "double");
  plane.setAttribute("rotation", "0 0 0");

  e.appendChild(plane);
  anchor.appendChild(e);
  spawnedEntities.push(e);
}

function addModelLayer(anchor, layer) {
  const e = makeEntityCommon(layer);

  const model = document.createElement("a-gltf-model");
  model.setAttribute("src", layer.src);
  e.appendChild(model);

  model.setAttribute("animation-mixer", ""); // optional if you use animations

  anchor.appendChild(e);
  spawnedEntities.push(e);
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
  plane.setAttribute("material", `shader: flat; src: #${vidId}; depthTest: false; depthWrite: false;`);
  plane.setAttribute("side", "double");

  e.appendChild(plane);

  anchor.appendChild(e);
  spawnedEntities.push(e);
}

function clearAnchor(anchor) {
  // Remove all children (previous layers)
  while (anchor.firstChild) anchor.removeChild(anchor.firstChild);
}

function setAnchorVisible(anchor, isVisible) {
  if (!anchor || !anchor.object3D) return;
  anchor.object3D.visible = isVisible;
}

function hideAllOverlaysAndReset(anchor) {
  // Hide the anchor itself (hides all children)
  setAnchorVisible(anchor, false);

  // Also explicitly hide spawned overlay entities (extra safety)
  for (const el of spawnedEntities) {
    if (!el || !el.object3D) continue;
    el.object3D.visible = false;

    // If entity uses a video texture, reset the underlying <video>
    const mat = el.getAttribute && el.getAttribute("material");
    if (mat?.src && typeof mat.src === "string" && mat.src.startsWith("#")) {
      const vid = document.querySelector(mat.src);
      if (vid && vid.tagName === "VIDEO") {
        vid.pause();
        vid.currentTime = 0;
        vid.muted = true;
      }
    }
  }

  // Also reset any <a-assets> videos (covers cases where material isn't found)
  const vids = document.querySelectorAll("a-assets video");
  for (const v of vids) {
    try {
      v.pause();
      v.currentTime = 0;
      v.muted = true;
    } catch {}
  }
}

function getAllAFrameCanvasEls(sceneEl) {
  const list = [];

  // A-Frame wrapper + its WebGL canvas
  const aCanvas = document.querySelector(".a-canvas");
  if (aCanvas) list.push(aCanvas);

  // Renderer canvas (best source of truth)
  const rendererCanvas = sceneEl?.renderer?.domElement;
  if (rendererCanvas) list.push(rendererCanvas);

  // Fallback canvases (sometimes multiple exist)
  document.querySelectorAll("canvas").forEach(c => list.push(c));

  // Dedup
  return Array.from(new Set(list));
}

function forceHideElement(el, hide) {
  if (!el) return;

  if (hide) {
    el.style.visibility = "hidden";
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
    // keep in DOM but invisible (more reliable than display:none on iOS)
  } else {
    el.style.visibility = "visible";
    el.style.opacity = "1";
    el.style.pointerEvents = "auto";
  }
}

function clearWebGLCanvas(sceneEl) {
  const canvas = sceneEl?.renderer?.domElement;
  if (!canvas) return;

  try {
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");

    if (!gl) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  } catch {
    // ignore
  }
}

function showScene(sceneEl, show) {
  // 1) If hiding: force one blank clear first
  if (!show) {
    // Try to clear the current frame buffer
    clearWebGLCanvas(sceneEl);

    // Ask A-Frame to render once more (blank frame tends to replace frozen one)
    try {
      sceneEl?.renderer?.render(sceneEl.object3D, sceneEl.camera);
    } catch {}
  }

  // 2) Hard-hide or show ALL canvas-related elements
  const canvases = getAllAFrameCanvasEls(sceneEl);
  for (const el of canvases) forceHideElement(el, !show);

  // 3) Also hide/show the scene root (fine to keep)
  forceHideElement(sceneEl, !show);
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
  anchor.addEventListener("targetFound", () => {
  setStatus("Target found ✅");
  setAnchorVisible(anchor, true);
  // Show all spawned overlays
  for (const el of spawnedEntities) {
    if (el?.object3D) el.object3D.visible = true;
  }
  });

  anchor.addEventListener("targetLost", () => {
    setStatus("Target lost…");
    hideAllOverlaysAndReset(anchor);
  });

  const startBtn = $("startBtn");
  const stopBtn = $("stopBtn");
  const videoBtn = $("videoBtn");

  // iOS Safari sometimes re-stacks the camera/video vs WebGL canvas
  // exactly when a target is found (scanning -> tracking).
  anchor.addEventListener("targetFound", () => {
    iosForceCanvasAboveCamera(sceneEl);
    setTimeout(() => iosForceCanvasAboveCamera(sceneEl), 150);
  });

  anchor.addEventListener("targetLost", () => {
    // Optional: keep status updates so you can confirm events are firing
    // setStatus("Target lost…");
  });


  // Build layers now (they’ll show once the target is detected)
  clearAnchor(anchor);
  spawnedEntities.length = 0;

  for (const layer of layers) {
    if (!layer || !layer.type || !layer.src) continue;

    if (layer.type === "image") addImageLayer(anchor, layer);
    else if (layer.type === "gif") addImageLayer(anchor, layer);
    else if (layer.type === "model") addModelLayer(anchor, layer);
    else if (layer.type === "video") addVideoLayer(anchor, layer);
  }

  setStatus(`Ready. Tap “Start AR”, then point at the EC logo.`);
  showScene(sceneEl, false);
  hideAllOverlaysAndReset(anchor);
  setAnchorVisible(anchor, false);


  startBtn.addEventListener("click", async () => {
    setStatus("Starting AR…");

    // MindAR system is available after scene loads
    const mindarSystem = sceneEl.systems["mindar-image-system"];
    if (!mindarSystem) {
      setStatus("MindAR not ready yet. Try again in a moment.");
      return;
    }

    try {
      showScene(sceneEl, true);          // show WebGL output
      hideAllOverlaysAndReset(anchor);   // keep overlays hidden until targetFound
      
      await mindarSystem.start();
      
      /* Wait for renderer to exist and then force layering */
      iosForceCanvasAboveCamera(sceneEl);
      /* Also run again shortly after start (iOS sometimes re-stacks once) */
      setTimeout(() => iosForceCanvasAboveCamera(sceneEl), 300);
      
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

    // Hide overlays immediately
    hideAllOverlaysAndReset(anchor);

    setAnchorVisible(anchor, false);
    // Stop camera tracking
    await mindarSystem.stop();

    // Hide and clear the WebGL output (prevents frozen AR overlay)
    showScene(sceneEl, false);

    // Extra: Safari sometimes reapplies styles after stop—re-hide again
    setTimeout(() => showScene(sceneEl, false), 50);
    setTimeout(() => showScene(sceneEl, false), 250);

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
