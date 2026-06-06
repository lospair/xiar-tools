"use strict";

const DetectionDefaults = {
  whiteThreshold: 245,
  tolerance: 18,
  lineCoverage: 0.96,
  maxLineThickness: 2.6,
  minSide: 64,
  minAreaRatio: 0.005
};

const REGION_COLORS = [
  "#0f766e",
  "#b7791f",
  "#2563eb",
  "#c026d3",
  "#16a34a",
  "#7c3aed",
  "#ea580c",
  "#0891b2",
  "#4d7c0f",
  "#9333ea"
];

const MIN_EDIT_SIDE = 1;
const SNAP_DISTANCE = 8;
const LOUPE_NORMAL_SAMPLE = 25;
const LOUPE_HANDLE_SAMPLE = 17;

const state = {
  sources: [],
  currentSourceId: null,
  selectedRegionId: null,
  zoom: 1,
  pixelated: true,
  snapEnabled: true,
  drag: null,
  activePointers: new Map(),
  touchGesture: null,
  activeHandle: null,
  loupe: null,
  loupeHideTimer: null,
  toastTimer: null,
  idSeed: 1
};

const el = {
  fileInput: document.getElementById("fileInput"),
  dropZone: document.getElementById("dropZone"),
  sourceHeading: document.getElementById("sourceHeading"),
  sourceList: document.getElementById("sourceList"),
  regionHeading: document.getElementById("regionHeading"),
  regionList: document.getElementById("regionList"),
  statusText: document.getElementById("statusText"),
  detectButton: document.getElementById("detectButton"),
  detectSettingsButton: document.getElementById("detectSettingsButton"),
  addRegionButton: document.getElementById("addRegionButton"),
  deleteRegionButton: document.getElementById("deleteRegionButton"),
  exportButton: document.getElementById("exportButton"),
  exportBottomButton: document.getElementById("exportBottomButton"),
  snapButton: document.getElementById("snapButton"),
  toast: document.getElementById("toast"),
  fitButton: document.getElementById("fitButton"),
  actualSizeButton: document.getElementById("actualSizeButton"),
  zoomOutButton: document.getElementById("zoomOutButton"),
  zoomInButton: document.getElementById("zoomInButton"),
  zoomInput: document.getElementById("zoomInput"),
  pixelButton: document.getElementById("pixelButton"),
  viewport: document.getElementById("viewport"),
  stage: document.getElementById("stage"),
  canvas: document.getElementById("imageCanvas"),
  overlay: document.getElementById("overlay"),
  loupe: document.getElementById("loupe"),
  panUpButton: document.getElementById("panUpButton"),
  panDownButton: document.getElementById("panDownButton"),
  panLeftButton: document.getElementById("panLeftButton"),
  panRightButton: document.getElementById("panRightButton"),
  xInput: document.getElementById("xInput"),
  yInput: document.getElementById("yInput"),
  wInput: document.getElementById("wInput"),
  hInput: document.getElementById("hInput"),
  whiteThresholdInput: document.getElementById("whiteThresholdInput"),
  toleranceInput: document.getElementById("toleranceInput"),
  lineCoverageInput: document.getElementById("lineCoverageInput"),
  maxLineThicknessInput: document.getElementById("maxLineThicknessInput"),
  minSideInput: document.getElementById("minSideInput"),
  minAreaRatioInput: document.getElementById("minAreaRatioInput")
};

const ctx = el.canvas.getContext("2d", { willReadFrequently: true });
const loupeCtx = el.loupe.getContext("2d");
const encoder = new TextEncoder();

function nextId(prefix) {
  const id = `${prefix}-${state.idSeed}`;
  state.idSeed += 1;
  return id;
}

function currentSource() {
  return state.sources.find((source) => source.id === state.currentSourceId) || null;
}

function selectedRegion() {
  const source = currentSource();
  return source?.regions.find((region) => region.id === state.selectedRegionId) || null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function baseName(fileName) {
  return fileName.replace(/\.[^.]+$/, "") || "image";
}

function regionColor(index) {
  return REGION_COLORS[index % REGION_COLORS.length];
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function sanitizeFileName(name) {
  const cleaned = String(name || "crop.png")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return /\.png$/i.test(cleaned) ? cleaned : `${cleaned || "crop"}.png`;
}

function isLikelyImageFile(file) {
  return file.type.startsWith("image/")
    || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(file.name || "");
}

function readDetectionSettings() {
  return {
    whiteThreshold: clamp(Number(el.whiteThresholdInput.value) || DetectionDefaults.whiteThreshold, 0, 255),
    tolerance: Math.max(0, Number(el.toleranceInput.value) || DetectionDefaults.tolerance),
    lineCoverage: clamp(Number(el.lineCoverageInput.value) || DetectionDefaults.lineCoverage, 0, 1),
    maxLineThickness: Math.max(0.1, Number(el.maxLineThicknessInput.value) || DetectionDefaults.maxLineThickness),
    minSide: Math.max(1, Math.round(Number(el.minSideInput.value) || DetectionDefaults.minSide)),
    minAreaRatio: Math.max(0, Number(el.minAreaRatioInput.value) || DetectionDefaults.minAreaRatio)
  };
}

function updateStatusCounts() {
  const source = currentSource();
  const current = source?.regions.length || 0;
  const total = state.sources.reduce((sum, item) => sum + item.regions.length, 0);
  el.statusText.textContent = `現在 ${current}件 / 全体 ${total}件`;
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.className = "toast show";
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    el.toast.className = "toast";
  }, 4200);
}

function withDisabledExport(disabled) {
  const exportDisabled = disabled || collectEnabledRegions().length === 0;
  el.exportButton.disabled = exportDisabled;
  if (el.exportBottomButton) el.exportBottomButton.disabled = exportDisabled;
}

function renderAll() {
  renderSourceList();
  renderCanvas();
  renderOverlay();
  renderRegionList();
  updateControls();
}

async function loadFiles(files) {
  const imageFiles = Array.from(files || []).filter(isLikelyImageFile);
  if (imageFiles.length === 0) return;

  const loaded = [];
  for (const file of imageFiles) {
    try {
      const source = await createSource(file);
      source.regions = detectRegions(source, readDetectionSettings());
      assignRegionNames(source);
      loaded.push(source);
    } catch (error) {
      console.error(error);
      showToast(`${file.name} を読み込めませんでした`);
    }
  }

  state.sources.push(...loaded);
  if (loaded[0]) {
    state.currentSourceId = loaded[0].id;
    state.selectedRegionId = loaded[0].regions[0]?.id || null;
    clearActiveHandle();
  }
  renderAll();
  if (loaded[0]) requestAnimationFrame(fitToViewport);
}

async function createSource(file) {
  const objectUrl = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";
  const loaded = new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });
  img.src = objectUrl;
  await loaded;
  if (img.decode) await img.decode().catch(() => {});

  return {
    id: nextId("source"),
    file,
    fileName: file.name,
    name: file.name,
    objectUrl,
    img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    regions: [],
    splitLines: [],
    hasManualEdits: false
  };
}

async function loadFixtureUrls(urls) {
  const files = [];
  for (const url of urls) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fixture failed: ${url}`);
    const blob = await response.blob();
    const name = decodeURIComponent(url.split("/").pop() || "fixture.png");
    files.push(new File([blob], name, { type: blob.type || "image/png" }));
  }
  await loadFiles(files);
}

function assignRegionNames(source) {
  const stem = baseName(source.fileName);
  source.regions.forEach((region, index) => {
    region.name = region.name || `${stem}_crop_${String(index + 1).padStart(2, "0")}.png`;
    region.color = region.color || regionColor(index);
  });
}

function selectSource(sourceId) {
  if (state.currentSourceId === sourceId) return;
  const source = state.sources.find((item) => item.id === sourceId);
  if (!source) return;
  state.currentSourceId = sourceId;
  state.selectedRegionId = source.regions[0]?.id || null;
  clearActiveHandle();
  renderAll();
  requestAnimationFrame(fitToViewport);
}

function removeSource(sourceId) {
  const index = state.sources.findIndex((source) => source.id === sourceId);
  if (index < 0) return;
  const [removed] = state.sources.splice(index, 1);
  URL.revokeObjectURL(removed.objectUrl);
  if (state.currentSourceId === sourceId) {
    const next = state.sources[Math.min(index, state.sources.length - 1)] || null;
    state.currentSourceId = next?.id || null;
    state.selectedRegionId = next?.regions[0]?.id || null;
    clearActiveHandle();
  }
  renderAll();
}

function selectRegion(regionId, options = {}) {
  if (state.selectedRegionId !== regionId) clearActiveHandle();
  state.selectedRegionId = regionId;
  renderOverlay();
  renderRegionList();
  updateControls();
  const region = selectedRegion();
  if (region && options.scroll) scrollRegionIntoView(region);
}

function clearActiveHandle() {
  state.activeHandle = null;
  state.loupe = null;
  el.loupe.classList.remove("handle-mode", "dragging");
}

function markManualEdit(source = currentSource()) {
  if (source) source.hasManualEdits = true;
}

function updateControls() {
  const source = currentSource();
  const region = selectedRegion();
  const hasSource = Boolean(source);
  el.detectButton.disabled = !hasSource;
  el.detectSettingsButton.disabled = !hasSource;
  el.addRegionButton.disabled = !hasSource;
  el.deleteRegionButton.disabled = !region;
  [el.xInput, el.yInput, el.wInput, el.hInput].forEach((input) => {
    input.disabled = !region;
  });
  if (!region) {
    el.xInput.value = "";
    el.yInput.value = "";
    el.wInput.value = "";
    el.hInput.value = "";
  } else {
    el.xInput.value = region.x;
    el.yInput.value = region.y;
    el.wInput.value = region.width;
    el.hInput.value = region.height;
  }
  el.snapButton.setAttribute("aria-pressed", String(state.snapEnabled));
  el.pixelButton.setAttribute("aria-pressed", String(!state.pixelated));
  withDisabledExport(false);
  updateStatusCounts();
}

function renderSourceList() {
  el.sourceHeading.textContent = `画像 ${state.sources.length}枚`;
  if (state.sources.length === 0) {
    el.sourceList.innerHTML = '<div class="empty-state">未選択</div>';
    return;
  }

  el.sourceList.innerHTML = "";
  for (const source of state.sources) {
    const item = document.createElement("div");
    item.className = `source-item${source.id === state.currentSourceId ? " active" : ""}`;

    const main = document.createElement("button");
    main.type = "button";
    main.className = "source-main";
    main.title = `${source.name} を編集対象にします`;
    main.addEventListener("click", () => selectSource(source.id));

    const thumb = document.createElement("img");
    thumb.className = "source-thumb";
    thumb.src = source.objectUrl;
    thumb.alt = "";

    const body = document.createElement("div");
    const name = document.createElement("div");
    name.className = "source-name";
    name.textContent = source.name;
    const meta = document.createElement("div");
    meta.className = "source-meta";
    meta.textContent = `${source.width}x${source.height} / ${source.regions.length}件`;
    body.append(name, meta);
    main.append(thumb, body);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button danger";
    remove.title = `${source.name} を一覧から削除します`;
    remove.setAttribute("aria-label", `${source.name} を削除`);
    remove.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8l1 2h4v2H3V6h4l1-2Zm1 6h2v8H9v-8Zm4 0h2v8h-2v-8ZM6 10h12l-.7 10.1A2 2 0 0 1 15.3 22H8.7a2 2 0 0 1-2-1.9L6 10Z"/></svg>';
    remove.addEventListener("click", () => removeSource(source.id));

    item.append(main, remove);
    el.sourceList.append(item);
  }
}

function renderCanvas() {
  const source = currentSource();
  if (!source) {
    el.stage.classList.add("empty");
    el.stage.style.width = "720px";
    el.stage.style.height = "480px";
    el.canvas.width = 1;
    el.canvas.height = 1;
    el.canvas.classList.toggle("pixelated", state.pixelated);
    ctx.clearRect(0, 0, 1, 1);
    el.overlay.setAttribute("viewBox", "0 0 1 1");
    return;
  }

  el.stage.classList.remove("empty");
  el.canvas.width = source.width;
  el.canvas.height = source.height;
  el.canvas.classList.toggle("pixelated", state.pixelated);
  el.canvas.style.width = `${source.width * state.zoom}px`;
  el.canvas.style.height = `${source.height * state.zoom}px`;
  el.stage.style.width = `${source.width * state.zoom}px`;
  el.stage.style.height = `${source.height * state.zoom}px`;
  el.overlay.setAttribute("viewBox", `0 0 ${source.width} ${source.height}`);
  ctx.clearRect(0, 0, source.width, source.height);
  ctx.drawImage(source.img, 0, 0);
}

function svg(tag, attrs) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    node.setAttribute(key, value);
  }
  return node;
}

function getHandleSize() {
  return clamp(12 / state.zoom, 4, 18);
}

function makeHandles(region) {
  const x1 = region.x;
  const x2 = region.x + region.width;
  const y1 = region.y;
  const y2 = region.y + region.height;
  const cx = region.x + region.width / 2;
  const cy = region.y + region.height / 2;
  return [
    { name: "nw", x: x1, y: y1 },
    { name: "n", x: cx, y: y1 },
    { name: "ne", x: x2, y: y1 },
    { name: "e", x: x2, y: cy },
    { name: "se", x: x2, y: y2 },
    { name: "s", x: cx, y: y2 },
    { name: "sw", x: x1, y: y2 },
    { name: "w", x: x1, y: cy }
  ];
}

function renderOverlay() {
  const source = currentSource();
  el.overlay.replaceChildren();
  if (!source) return;

  const lineLayer = svg("g", { class: "line-layer" });
  for (const line of source.splitLines) {
    const center = (line.start + line.end + 1) / 2;
    const lineNode = line.axis === "x"
      ? svg("line", {
          class: "split-line",
          x1: center,
          y1: line.min,
          x2: center,
          y2: line.max,
          "data-line-id": line.id
        })
      : svg("line", {
          class: "split-line",
          x1: line.min,
          y1: center,
          x2: line.max,
          y2: center,
          "data-line-id": line.id
        });
    lineNode.addEventListener("pointerdown", onLinePointerDown);
    lineLayer.append(lineNode);
  }
  el.overlay.append(lineLayer);

  const regionLayer = svg("g", { class: "region-layer" });
  const selectedLayer = svg("g", { class: "selected-region-layer" });
  const handleSize = getHandleSize();

  for (const region of source.regions) {
    const selected = region.id === state.selectedRegionId;
    const color = region.color || "#0f766e";
    const rect = svg("rect", {
      class: `crop-rect${selected ? " selected" : ""}${region.enabled ? "" : " disabled"}`,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      style: `--region-color: ${color}; --region-fill: ${hexToRgba(color, 0.12)};`,
      "data-region-id": region.id
    });
    rect.addEventListener("pointerdown", onRegionPointerDown);
    rect.addEventListener("click", (event) => {
      event.stopPropagation();
      selectRegion(region.id);
    });

    const label = svg("text", {
      class: "region-label",
      x: region.x + 8,
      y: region.y + 20
    });
    label.textContent = sanitizeFileName(region.name).replace(/\.png$/i, "");

    const targetLayer = selected ? selectedLayer : regionLayer;
    targetLayer.append(rect, label);

    if (selected) {
      for (const handle of makeHandles(region)) {
        const node = svg("rect", {
          class: `handle ${handle.name}`,
          x: handle.x - handleSize / 2,
          y: handle.y - handleSize / 2,
          width: handleSize,
          height: handleSize,
          rx: Math.max(1, handleSize * 0.18),
          "data-region-id": region.id,
          "data-handle": handle.name
        });
        node.addEventListener("pointerdown", onHandlePointerDown);
        selectedLayer.append(node);
      }
    }
  }
  el.overlay.append(regionLayer, selectedLayer);
}

function renderRegionList() {
  const source = currentSource();
  const count = source?.regions.length || 0;
  el.regionHeading.textContent = `候補 ${count}件`;
  if (!source) {
    el.regionList.innerHTML = '<div class="empty-state">未選択</div>';
    return;
  }
  if (source.regions.length === 0) {
    el.regionList.innerHTML = '<div class="empty-state">候補なし</div>';
    return;
  }

  el.regionList.innerHTML = "";
  for (const region of source.regions) {
    const item = document.createElement("div");
    item.className = `region-item${region.id === state.selectedRegionId ? " active" : ""}`;
    item.style.setProperty("--region-color", region.color || "#0f766e");
    item.addEventListener("click", (event) => {
      if (event.target.closest("input")) return;
      selectRegion(region.id, { scroll: true });
    });

    const thumb = document.createElement("canvas");
    thumb.className = "region-thumb";
    thumb.width = 72;
    thumb.height = 72;

    const content = document.createElement("div");
    content.className = "region-content";
    const row = document.createElement("div");
    row.className = "region-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = region.enabled;
    checkbox.title = "この候補をエクスポート対象にします";
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => {
      region.enabled = checkbox.checked;
      renderOverlay();
      updateControls();
    });

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = region.name;
    nameInput.title = "出力ファイル名";
    nameInput.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      if (state.selectedRegionId !== region.id) selectRegion(region.id);
    });
    nameInput.addEventListener("click", (event) => event.stopPropagation());
    nameInput.addEventListener("input", () => {
      region.name = nameInput.value;
      renderOverlay();
      updateControls();
    });
    nameInput.addEventListener("blur", () => {
      region.name = sanitizeFileName(region.name);
      renderRegionList();
    });

    row.append(checkbox, nameInput);

    const meta = document.createElement("button");
    meta.type = "button";
    meta.className = "region-meta";
    meta.textContent = `${region.x},${region.y} / ${region.width}x${region.height}`;
    meta.title = "この候補を選択して表示位置へスクロールします";
    meta.addEventListener("click", (event) => {
      event.stopPropagation();
      selectRegion(region.id, { scroll: true });
    });

    content.append(row, meta);
    item.append(thumb, content);
    el.regionList.append(item);
    drawRegionThumb(thumb, source, region);
  }
}

function drawRegionThumb(canvas, source, region) {
  const thumbCtx = canvas.getContext("2d");
  thumbCtx.clearRect(0, 0, canvas.width, canvas.height);
  thumbCtx.fillStyle = "#f8fafc";
  thumbCtx.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / region.width, canvas.height / region.height);
  const dw = Math.max(1, Math.round(region.width * scale));
  const dh = Math.max(1, Math.round(region.height * scale));
  const dx = Math.round((canvas.width - dw) / 2);
  const dy = Math.round((canvas.height - dh) / 2);
  thumbCtx.drawImage(source.img, region.x, region.y, region.width, region.height, dx, dy, dw, dh);
}

function scrollRegionIntoView(region) {
  const rect = el.stage.getBoundingClientRect();
  const viewportRect = el.viewport.getBoundingClientRect();
  const left = rect.left + region.x * state.zoom - viewportRect.left + el.viewport.scrollLeft;
  const top = rect.top + region.y * state.zoom - viewportRect.top + el.viewport.scrollTop;
  el.viewport.scrollTo({
    left: Math.max(0, left - viewportRect.width / 2 + (region.width * state.zoom) / 2),
    top: Math.max(0, top - viewportRect.height / 2 + (region.height * state.zoom) / 2),
    behavior: "smooth"
  });
}

function fitToViewport() {
  const source = currentSource();
  if (!source) return;
  const rect = el.viewport.getBoundingClientRect();
  const availableW = Math.max(120, rect.width - 56);
  const availableH = Math.max(120, rect.height - 56);
  setZoom(clamp(Math.min(availableW / source.width, availableH / source.height), 0.1, 3));
}

function setZoom(nextZoom, anchorCenter = true) {
  const source = currentSource();
  if (!source) return;
  const oldZoom = state.zoom;
  const next = clamp(nextZoom, 0.1, 8);
  if (Math.abs(next - oldZoom) < 0.0001) return;

  const rect = el.viewport.getBoundingClientRect();
  const anchorX = anchorCenter ? el.viewport.scrollLeft + rect.width / 2 : el.viewport.scrollLeft;
  const anchorY = anchorCenter ? el.viewport.scrollTop + rect.height / 2 : el.viewport.scrollTop;
  const imageX = anchorX / oldZoom;
  const imageY = anchorY / oldZoom;
  state.zoom = next;
  el.zoomInput.value = String(Math.round(next * 100));
  renderCanvas();
  renderOverlay();
  el.viewport.scrollLeft = imageX * next - (anchorCenter ? rect.width / 2 : 0);
  el.viewport.scrollTop = imageY * next - (anchorCenter ? rect.height / 2 : 0);
  if (state.activeHandle) drawActiveHandleLoupe(false);
}

function setZoomAt(nextZoom, clientX, clientY) {
  const source = currentSource();
  if (!source) return;
  const before = clientToImage(clientX, clientY);
  state.zoom = clamp(nextZoom, 0.1, 8);
  el.zoomInput.value = String(Math.round(state.zoom * 100));
  renderCanvas();
  renderOverlay();
  const stageRect = el.stage.getBoundingClientRect();
  const viewportRect = el.viewport.getBoundingClientRect();
  el.viewport.scrollLeft += stageRect.left + before.x * state.zoom - clientX;
  el.viewport.scrollTop += stageRect.top + before.y * state.zoom - clientY;
  if (state.activeHandle) drawActiveHandleLoupe(false);
}

function panViewport(dx, dy) {
  const source = currentSource();
  if (!source) return;
  clearActiveHandle();
  const stepX = Math.max(48, Math.round(el.viewport.clientWidth * 0.28));
  const stepY = Math.max(48, Math.round(el.viewport.clientHeight * 0.28));
  el.viewport.scrollBy({
    left: dx * stepX,
    top: dy * stepY,
    behavior: "smooth"
  });
}

function clientToImage(clientX, clientY) {
  const source = currentSource();
  if (!source) return { x: 0, y: 0 };
  const rect = el.stage.getBoundingClientRect();
  return {
    x: clamp((clientX - rect.left) / rect.width * source.width, 0, source.width),
    y: clamp((clientY - rect.top) / rect.height * source.height, 0, source.height)
  };
}

function updateSelectedFromInputs() {
  const source = currentSource();
  const region = selectedRegion();
  if (!source || !region) return;
  const x = Math.round(Number(el.xInput.value) || 0);
  const y = Math.round(Number(el.yInput.value) || 0);
  const width = Math.max(MIN_EDIT_SIDE, Math.round(Number(el.wInput.value) || region.width));
  const height = Math.max(MIN_EDIT_SIDE, Math.round(Number(el.hInput.value) || region.height));
  region.x = clamp(x, 0, Math.max(0, source.width - MIN_EDIT_SIDE));
  region.y = clamp(y, 0, Math.max(0, source.height - MIN_EDIT_SIDE));
  region.width = clamp(width, MIN_EDIT_SIDE, source.width - region.x);
  region.height = clamp(height, MIN_EDIT_SIDE, source.height - region.y);
  markManualEdit(source);
  clearActiveHandle();
  renderOverlay();
  renderRegionList();
  updateControls();
}

function nudgeSelected(dx, dy) {
  const source = currentSource();
  const region = selectedRegion();
  if (!source || !region) return;
  moveRegion(region, dx, dy, source);
  markManualEdit(source);
  clearActiveHandle();
  renderOverlay();
  renderRegionList();
  updateControls();
}

function moveRegion(region, dx, dy, source) {
  region.x = clamp(Math.round(region.x + dx), 0, source.width - region.width);
  region.y = clamp(Math.round(region.y + dy), 0, source.height - region.height);
}

function resizeRegion(region, handle, dx, dy, source) {
  let left = region.x;
  let top = region.y;
  let right = region.x + region.width;
  let bottom = region.y + region.height;

  if (handle.includes("w")) left += dx;
  if (handle.includes("e")) right += dx;
  if (handle.includes("n")) top += dy;
  if (handle.includes("s")) bottom += dy;

  left = clamp(Math.round(left), 0, source.width - MIN_EDIT_SIDE);
  right = clamp(Math.round(right), MIN_EDIT_SIDE, source.width);
  top = clamp(Math.round(top), 0, source.height - MIN_EDIT_SIDE);
  bottom = clamp(Math.round(bottom), MIN_EDIT_SIDE, source.height);

  if (right - left < MIN_EDIT_SIDE) {
    if (handle.includes("w")) left = right - MIN_EDIT_SIDE;
    else right = left + MIN_EDIT_SIDE;
  }
  if (bottom - top < MIN_EDIT_SIDE) {
    if (handle.includes("n")) top = bottom - MIN_EDIT_SIDE;
    else bottom = top + MIN_EDIT_SIDE;
  }

  region.x = left;
  region.y = top;
  region.width = right - left;
  region.height = bottom - top;
}

function snapResize(region, handle, source) {
  const threshold = Math.max(1, Math.round(SNAP_DISTANCE / state.zoom));
  const pointsX = collectSnapPoints(source, "x", region.id);
  const pointsY = collectSnapPoints(source, "y", region.id);
  let left = region.x;
  let top = region.y;
  let right = region.x + region.width;
  let bottom = region.y + region.height;

  if (handle.includes("w")) left = nearestSnap(left, pointsX, threshold);
  if (handle.includes("e")) right = nearestSnap(right, pointsX, threshold);
  if (handle.includes("n")) top = nearestSnap(top, pointsY, threshold);
  if (handle.includes("s")) bottom = nearestSnap(bottom, pointsY, threshold);

  if (right - left >= MIN_EDIT_SIDE) {
    region.x = clamp(left, 0, source.width - MIN_EDIT_SIDE);
    region.width = clamp(right - left, MIN_EDIT_SIDE, source.width - region.x);
  }
  if (bottom - top >= MIN_EDIT_SIDE) {
    region.y = clamp(top, 0, source.height - MIN_EDIT_SIDE);
    region.height = clamp(bottom - top, MIN_EDIT_SIDE, source.height - region.y);
  }
}

function collectSnapPoints(source, axis, excludeRegionId) {
  const points = axis === "x" ? [0, source.width] : [0, source.height];
  for (const region of source.regions) {
    if (region.id === excludeRegionId) continue;
    if (axis === "x") {
      points.push(region.x, region.x + region.width);
    } else {
      points.push(region.y, region.y + region.height);
    }
  }
  for (const line of source.splitLines) {
    if (line.axis === axis) points.push(Math.round((line.start + line.end + 1) / 2));
  }
  return points;
}

function nearestSnap(value, points, threshold) {
  let best = value;
  let bestDistance = threshold + 1;
  for (const point of points) {
    const distance = Math.abs(value - point);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return bestDistance <= threshold ? best : value;
}

function rectanglesOverlap(a, b) {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

function findAddPosition(source, base, width, height) {
  const candidates = [
    { x: base.x + base.width, y: base.y },
    { x: base.x, y: base.y + base.height },
    { x: base.x - width, y: base.y },
    { x: base.x, y: base.y - height }
  ];

  for (const candidate of candidates) {
    const rect = { x: candidate.x, y: candidate.y, width, height };
    if (isInsideSource(rect, source) && !source.regions.some((region) => rectanglesOverlap(rect, region))) {
      return candidate;
    }
  }

  const step = Math.max(12, Math.round(Math.min(width, height) / 3));
  for (let y = 0; y <= source.height - height; y += step) {
    for (let x = 0; x <= source.width - width; x += step) {
      const rect = { x, y, width, height };
      if (!source.regions.some((region) => rectanglesOverlap(rect, region))) return { x, y };
    }
  }

  return {
    x: clamp(base.x + 24, 0, Math.max(0, source.width - width)),
    y: clamp(base.y + 24, 0, Math.max(0, source.height - height))
  };
}

function isInsideSource(rect, source) {
  return rect.x >= 0
    && rect.y >= 0
    && rect.x + rect.width <= source.width
    && rect.y + rect.height <= source.height;
}

function addRegion() {
  const source = currentSource();
  if (!source) return;
  const selected = selectedRegion();
  const base = selected || source.regions[0] || {
    x: Math.round(source.width * 0.25),
    y: Math.round(source.height * 0.25),
    width: Math.max(64, Math.round(source.width * 0.32)),
    height: Math.max(64, Math.round(source.height * 0.32))
  };
  const width = clamp(base.width, MIN_EDIT_SIDE, source.width);
  const height = clamp(base.height, MIN_EDIT_SIDE, source.height);
  const pos = findAddPosition(source, base, width, height);
  const region = {
    id: nextId("crop"),
    sourceId: source.id,
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    width,
    height,
    enabled: true,
    color: regionColor(source.regions.length),
    name: `${baseName(source.fileName)}_crop_${String(source.regions.length + 1).padStart(2, "0")}.png`
  };
  source.regions.push(region);
  state.selectedRegionId = region.id;
  markManualEdit(source);
  clearActiveHandle();
  renderAll();
  scrollRegionIntoView(region);
}

function deleteSelectedRegion() {
  const source = currentSource();
  const region = selectedRegion();
  if (!source || !region) return;
  const index = source.regions.findIndex((item) => item.id === region.id);
  source.regions.splice(index, 1);
  state.selectedRegionId = source.regions[Math.min(index, source.regions.length - 1)]?.id || null;
  markManualEdit(source);
  clearActiveHandle();
  renderAll();
}

function detectCurrent() {
  const source = currentSource();
  if (!source) return;
  if (source.hasManualEdits) {
    const ok = window.confirm("手動編集した矩形が自動検出結果で置き換わります。再検出しますか？");
    if (!ok) return;
  }
  source.regions = detectRegions(source, readDetectionSettings());
  source.hasManualEdits = false;
  assignRegionNames(source);
  state.selectedRegionId = source.regions[0]?.id || null;
  clearActiveHandle();
  renderAll();
}

function estimateBackground(imageData) {
  const { data, width, height } = imageData;
  const rs = [];
  const gs = [];
  const bs = [];
  const step = Math.max(1, Math.floor(Math.max(width, height) / 220));
  const pushPixel = (x, y) => {
    const i = (y * width + x) * 4;
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
  };
  for (let x = 0; x < width; x += step) {
    pushPixel(x, 0);
    pushPixel(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    pushPixel(0, y);
    pushPixel(width - 1, y);
  }
  const median = (values) => {
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] || 255;
  };
  return { r: median(rs), g: median(gs), b: median(bs) };
}

function buildSeparatorMasks(imageData, background, settings) {
  const { data, width, height } = imageData;
  const strict = new Uint8Array(width * height);
  const relaxed = new Uint8Array(width * height);
  const backgroundMask = new Uint8Array(width * height);
  const bgBrightness = (background.r + background.g + background.b) / 3;
  const backgroundIsLight = bgBrightness >= 225;
  const relaxedFloor = Math.max(235, settings.whiteThreshold - Math.min(12, settings.tolerance * 0.7));

  for (let i = 0, p = 0; p < strict.length; i += 4, p += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const brightness = (r + g + b) / 3;
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    const distance = Math.abs(r - background.r) + Math.abs(g - background.g) + Math.abs(b - background.b);
    const pureWhite = r >= settings.whiteThreshold && g >= settings.whiteThreshold && b >= settings.whiteThreshold;
    const lineWhite = brightness >= settings.whiteThreshold - 2
      && saturation <= Math.max(10, settings.tolerance * 0.7);
    const relaxedLineWhite = brightness >= relaxedFloor
      && saturation <= Math.max(14, settings.tolerance);
    const nearBackground = backgroundIsLight
      && distance <= settings.tolerance * 3.2
      && brightness >= Math.max(218, bgBrightness - settings.tolerance * 1.6)
      && saturation <= Math.max(20, settings.tolerance * 1.8);
    strict[p] = pureWhite || lineWhite ? 1 : 0;
    relaxed[p] = strict[p] || relaxedLineWhite ? 1 : 0;
    backgroundMask[p] = relaxed[p] || nearBackground ? 1 : 0;
  }
  return { strict, relaxed, background: backgroundMask };
}

function buildIntegralImage(mask, width, height) {
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      rowSum += mask[(y - 1) * width + (x - 1)];
      integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + rowSum;
    }
  }
  return integral;
}

function countWhite(integral, imageWidth, x, y, width, height) {
  const stride = imageWidth + 1;
  const x1 = Math.max(0, Math.round(x));
  const y1 = Math.max(0, Math.round(y));
  const x2 = Math.max(x1, Math.round(x + width));
  const y2 = Math.max(y1, Math.round(y + height));
  return integral[y2 * stride + x2] - integral[y1 * stride + x2] - integral[y2 * stride + x1] + integral[y1 * stride + x1];
}

function detectRegions(source, settings) {
  const work = document.createElement("canvas");
  work.width = source.width;
  work.height = source.height;
  const workCtx = work.getContext("2d", { willReadFrequently: true });
  workCtx.drawImage(source.img, 0, 0);
  const imageData = workCtx.getImageData(0, 0, source.width, source.height);
  const background = estimateBackground(imageData);
  const masks = buildSeparatorMasks(imageData, background, settings);
  const contentMask = new Uint8Array(masks.relaxed.length);
  for (let i = 0; i < contentMask.length; i += 1) contentMask[i] = masks.background[i] ? 0 : 1;

  const context = {
    source,
    settings,
    integral: buildIntegralImage(masks.strict, source.width, source.height),
    relaxedIntegral: buildIntegralImage(masks.relaxed, source.width, source.height),
    backgroundIntegral: buildIntegralImage(masks.background, source.width, source.height),
    contentIntegral: buildIntegralImage(contentMask, source.width, source.height),
    lines: []
  };
  const root = { x: 0, y: 0, width: source.width, height: source.height };
  const detected = dedupeRegions(
    splitRegion(root, context, 0)
      .map((region) => normalizeCrop(region, source))
      .map((region) => trimEdgeBands(region, context))
      .filter((region) => isUsableRegion(region, source, settings))
  );
  const repaired = repairMissingLeftGridColumn(detected, source, settings);

  source.splitLines = dedupeLines([...context.lines, ...repaired.lines]);
  return repaired.regions
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((rect, index) => ({
      id: nextId("crop"),
      sourceId: source.id,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      enabled: true,
      color: regionColor(index),
      name: ""
    }));
}

function splitRegion(region, context, depth) {
  const { settings } = context;
  if (depth > 12) return [region];
  if (region.width < settings.minSide * 2 || region.height < settings.minSide * 2) return [region];

  const candidates = [
    ...findLineRuns(region, "x", context),
    ...findLineRuns(region, "y", context)
  ].sort((a, b) => b.score - a.score);

  for (const candidate of candidates) {
    const parts = splitByRun(region, candidate);
    if (!parts) continue;
    if (!hasEnoughContent(parts.before, context) || !hasEnoughContent(parts.after, context)) continue;
    context.lines.push({
      id: nextId("line"),
      axis: candidate.axis,
      start: candidate.start,
      end: candidate.end,
      min: candidate.axis === "x" ? region.y : region.x,
      max: candidate.axis === "x" ? region.y + region.height : region.x + region.width
    });
    return [
      ...splitRegion(parts.before, context, depth + 1),
      ...splitRegion(parts.after, context, depth + 1)
    ];
  }

  return [region];
}

function splitByRun(region, run) {
  if (run.axis === "x") {
    const before = { x: region.x, y: region.y, width: run.start - region.x, height: region.height };
    const after = { x: run.end + 1, y: region.y, width: region.x + region.width - run.end - 1, height: region.height };
    if (before.width <= 0 || after.width <= 0) return null;
    return { before, after };
  }
  const before = { x: region.x, y: region.y, width: region.width, height: run.start - region.y };
  const after = { x: region.x, y: run.end + 1, width: region.width, height: region.y + region.height - run.end - 1 };
  if (before.height <= 0 || after.height <= 0) return null;
  return { before, after };
}

function findLineRuns(region, axis, context) {
  const strictRuns = findLineRunsFromIntegral(region, axis, context, context.integral, context.settings.lineCoverage, false);
  const relaxedRuns = findLineRunsFromIntegral(region, axis, context, context.relaxedIntegral, Math.max(0.985, context.settings.lineCoverage + 0.025), true);
  return mergeCandidateRuns([...strictRuns, ...relaxedRuns], axis);
}

function findLineRunsFromIntegral(region, axis, context, integral, coverageThreshold, relaxed) {
  const { source, settings } = context;
  const start = axis === "x" ? region.x : region.y;
  const end = axis === "x" ? region.x + region.width : region.y + region.height;
  const orthogonalLength = axis === "x" ? region.height : region.width;
  const rawRuns = [];
  let runStart = null;

  for (let pos = start; pos < end; pos += 1) {
    const count = axis === "x"
      ? countWhite(integral, source.width, pos, region.y, 1, region.height)
      : countWhite(integral, source.width, region.x, pos, region.width, 1);
    const coverage = count / orthogonalLength;
    const isLine = coverage >= coverageThreshold;
    if (isLine && runStart === null) runStart = pos;
    if ((!isLine || pos === end - 1) && runStart !== null) {
      rawRuns.push({ start: runStart, end: isLine && pos === end - 1 ? pos : pos - 1, axis });
      runStart = null;
    }
  }

  const maxThickness = effectiveMaxLineThickness(source, axis, settings);
  return mergeRuns(rawRuns, 1)
    .filter((run) => run.end - run.start + 1 <= maxThickness)
    .filter((run) => {
      const before = run.start - start;
      const after = end - run.end - 1;
      return before >= settings.minSide && after >= settings.minSide;
    })
    .map((run) => withRunStats(run, region, axis, context, integral, relaxed))
    .filter((run) => run.minChunkCoverage >= (relaxed ? 0.965 : Math.max(0.84, settings.lineCoverage - 0.08)))
    .filter((run) => relaxed || run.coverage >= Math.max(0.9, settings.lineCoverage - 0.04));
}

function mergeRuns(runs, maxGap) {
  if (runs.length <= 1) return runs;
  const sorted = runs.map((run) => ({ ...run })).sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];
  for (const run of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (run.start <= last.end + maxGap + 1) {
      last.end = Math.max(last.end, run.end);
    } else {
      merged.push(run);
    }
  }
  return merged;
}

function mergeCandidateRuns(runs, axis) {
  if (runs.length <= 1) return runs;
  const sorted = runs.map((run) => ({ ...run })).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const run of sorted) {
    const last = merged[merged.length - 1];
    if (last && run.start <= last.end + 2) {
      last.start = Math.min(last.start, run.start);
      last.end = Math.max(last.end, run.end);
      if (run.score > last.score) {
        last.score = run.score;
        last.coverage = run.coverage;
        last.minChunkCoverage = run.minChunkCoverage;
      }
    } else {
      merged.push({ ...run, axis });
    }
  }
  return merged;
}

function withRunStats(run, region, axis, context, integral, relaxed) {
  const { source, settings } = context;
  const thickness = run.end - run.start + 1;
  const maxThickness = effectiveMaxLineThickness(source, axis, settings);
  const bandArea = thickness * (axis === "x" ? region.height : region.width);
  const bandCount = axis === "x"
    ? countWhite(integral, source.width, run.start, region.y, thickness, region.height)
    : countWhite(integral, source.width, region.x, run.start, region.width, thickness);
  const coverage = bandCount / bandArea;
  const minChunkCoverage = lineChunkCoverage(run, region, axis, context, integral);
  const before = run.start - (axis === "x" ? region.x : region.y);
  const after = (axis === "x" ? region.x + region.width : region.y + region.height) - run.end - 1;
  const balance = Math.min(before, after) / Math.max(before, after);
  const thicknessPenalty = thickness / Math.max(1, maxThickness);
  const relaxedPenalty = relaxed ? 0.18 : 0;
  return {
    ...run,
    coverage,
    minChunkCoverage,
    score: coverage * 3 + minChunkCoverage * 2 + balance * 0.35 - thicknessPenalty * 0.28 - relaxedPenalty
  };
}

function lineChunkCoverage(run, region, axis, context, integral) {
  const { source } = context;
  const orthogonalLength = axis === "x" ? region.height : region.width;
  const chunkCount = clamp(Math.floor(orthogonalLength / 100), 4, 16);
  let minCoverage = 1;
  const thickness = run.end - run.start + 1;
  for (let i = 0; i < chunkCount; i += 1) {
    const a = Math.round(i * orthogonalLength / chunkCount);
    const b = Math.round((i + 1) * orthogonalLength / chunkCount);
    const length = Math.max(1, b - a);
    const count = axis === "x"
      ? countWhite(integral, source.width, run.start, region.y + a, thickness, length)
      : countWhite(integral, source.width, region.x + a, run.start, length, thickness);
    minCoverage = Math.min(minCoverage, count / (thickness * length));
  }
  return minCoverage;
}

function effectiveMaxLineThickness(source, axis, settings) {
  const length = axis === "x" ? source.width : source.height;
  return Math.max(1, Math.ceil(length * settings.maxLineThickness / 100));
}

function hasEnoughContent(region, context) {
  const { source, settings } = context;
  if (region.width < settings.minSide || region.height < settings.minSide) return false;
  const area = region.width * region.height;
  const content = countWhite(context.contentIntegral, source.width, region.x, region.y, region.width, region.height);
  const ratio = content / area;
  return ratio >= 0.012 || content >= 900;
}

function normalizeCrop(region, source) {
  const x = clamp(Math.round(region.x), 0, source.width - 1);
  const y = clamp(Math.round(region.y), 0, source.height - 1);
  const right = clamp(Math.round(region.x + region.width), x + 1, source.width);
  const bottom = clamp(Math.round(region.y + region.height), y + 1, source.height);
  return { x, y, width: right - x, height: bottom - y };
}

function trimEdgeBands(region, context) {
  const { source, settings, integral, relaxedIntegral, backgroundIntegral } = context;
  const threshold = Math.min(0.985, settings.lineCoverage + 0.02);
  let { x, y, width, height } = region;
  const originalRight = x + width;
  const originalBottom = y + height;
  const wideSingleRow = source.width / source.height > 1.35;
  const trimX = wideSingleRow ? 0 : getOuterTrimLimit(source, "x", settings, width);
  const trimY = wideSingleRow ? 0 : getOuterTrimLimit(source, "y", settings, height);
  const edgeCoverage = (targetIntegral, tx, ty, tw, th) => countWhite(targetIntegral, source.width, tx, ty, tw, th) / (tw * th);
  const isOuterWhite = (tx, ty, tw, th) => {
    const strict = edgeCoverage(integral, tx, ty, tw, th);
    const relaxed = edgeCoverage(relaxedIntegral, tx, ty, tw, th);
    const background = edgeCoverage(backgroundIntegral, tx, ty, tw, th);
    return strict >= threshold || relaxed >= 0.995 || background >= 0.995;
  };

  let trim = 0;
  if (region.x === 0) {
    while (trim < trimX && width > settings.minSide && isOuterWhite(x, y, 1, height)) {
      x += 1;
      width -= 1;
      trim += 1;
    }
  }

  trim = 0;
  if (originalRight >= source.width - 1) {
    while (trim < trimX && width > settings.minSide && isOuterWhite(x + width - 1, y, 1, height)) {
      width -= 1;
      trim += 1;
    }
  }

  trim = 0;
  if (region.y === 0) {
    while (trim < trimY && height > settings.minSide && isOuterWhite(x, y, width, 1)) {
      y += 1;
      height -= 1;
      trim += 1;
    }
  }

  trim = 0;
  if (originalBottom >= source.height - 1) {
    while (trim < trimY && height > settings.minSide && isOuterWhite(x, y + height - 1, width, 1)) {
      height -= 1;
      trim += 1;
    }
  }
  return { x, y, width, height };
}

function getOuterTrimLimit(source, axis, settings, regionSide) {
  const byRatio = effectiveMaxLineThickness(source, axis, settings);
  const byRegion = Math.floor(regionSide / 7);
  return Math.max(0, Math.min(byRatio, byRegion));
}

function isUsableRegion(region, source, settings) {
  if (region.width < settings.minSide || region.height < settings.minSide) return false;
  return region.width * region.height >= source.width * source.height * settings.minAreaRatio;
}

function dedupeRegions(regions) {
  const seen = new Set();
  const result = [];
  for (const region of regions) {
    const key = `${region.x},${region.y},${region.width},${region.height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(region);
  }
  return result;
}

function dedupeLines(lines) {
  const seen = new Set();
  const result = [];
  for (const line of lines) {
    const key = `${line.axis},${line.start},${line.end},${line.min},${line.max}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(line);
  }
  return result;
}

function repairMissingLeftGridColumn(regions, source, settings) {
  if (source.width / source.height > 1.35 || regions.length !== 4) {
    return { regions, lines: [] };
  }
  const fullHeight = regions.find((region) => region.height >= source.height * 0.82 && region.width >= source.width * 0.45);
  if (!fullHeight) return { regions, lines: [] };

  const column = regions
    .filter((region) => region !== fullHeight)
    .sort((a, b) => a.y - b.y);
  if (column.length !== 3) return { regions, lines: [] };

  const minX = Math.min(...column.map((region) => region.x));
  const maxX = Math.max(...column.map((region) => region.x));
  const medianWidth = [...column.map((region) => region.width)].sort((a, b) => a - b)[1];
  const rowsAreStacked = column.every((region) => Math.abs(region.x - minX) <= Math.max(12, medianWidth * 0.12));
  if (!rowsAreStacked) return { regions, lines: [] };

  const largeRight = fullHeight.x + fullHeight.width;
  const gap = clamp(minX - largeRight, 0, effectiveMaxLineThickness(source, "x", settings));
  const leftColumnX = Math.round(minX - medianWidth - gap);
  const leftColumnWidth = largeRight - leftColumnX;
  const leftTallWidth = leftColumnX - fullHeight.x - gap;
  if (leftColumnX <= fullHeight.x + settings.minSide || leftColumnWidth < settings.minSide || leftTallWidth < settings.minSide) {
    return { regions, lines: [] };
  }

  const leftTall = {
    x: fullHeight.x,
    y: fullHeight.y,
    width: leftTallWidth,
    height: fullHeight.height
  };
  const repairedColumn = column.map((row) => ({
    x: leftColumnX,
    y: row.y,
    width: leftColumnWidth,
    height: row.height
  }));
  const others = regions.filter((region) => region !== fullHeight && !column.includes(region));
  const lines = [
    {
      id: nextId("line"),
      axis: "x",
      start: leftColumnX - gap,
      end: leftColumnX - 1,
      min: fullHeight.y,
      max: fullHeight.y + fullHeight.height
    }
  ];
  for (let i = 1; i < column.length; i += 1) {
    const previous = column[i - 1];
    const current = column[i];
    if (current.y > previous.y + previous.height) {
      lines.push({
        id: nextId("line"),
        axis: "y",
        start: previous.y + previous.height,
        end: current.y - 1,
        min: leftColumnX,
        max: largeRight
      });
    }
  }
  return { regions: [leftTall, ...repairedColumn, ...column, ...others], lines };
}

function tryPointerCapture(target, pointerId) {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // SVG pointer capture can fail in a few browsers; document listeners still complete the drag.
  }
}

function rememberPointer(event) {
  if (event.pointerType !== "touch") return false;
  state.activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
  if (state.activePointers.size >= 2) {
    startTouchGesture(event);
    return true;
  }
  return false;
}

function updatePointerPosition(event) {
  if (event.pointerType !== "touch" || !state.activePointers.has(event.pointerId)) return;
  state.activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
}

function forgetPointer(event) {
  if (event.pointerType !== "touch") return;
  state.activePointers.delete(event.pointerId);
  if (state.activePointers.size < 2) {
    state.touchGesture = null;
  } else if (state.touchGesture) {
    startTouchGesture(event);
  }
}

function firstTwoTouchPoints() {
  return Array.from(state.activePointers.values()).slice(0, 2);
}

function touchCenter(points) {
  return {
    x: (points[0].clientX + points[1].clientX) / 2,
    y: (points[0].clientY + points[1].clientY) / 2
  };
}

function touchDistance(points) {
  return Math.hypot(points[0].clientX - points[1].clientX, points[0].clientY - points[1].clientY);
}

function startTouchGesture(event) {
  const source = currentSource();
  if (!source) return;
  event.preventDefault();
  event.stopPropagation();
  cancelCurrentDragForGesture();
  const points = firstTwoTouchPoints();
  if (points.length < 2) return;
  const center = touchCenter(points);
  const image = clientToImage(center.x, center.y);
  state.touchGesture = {
    startDistance: Math.max(1, touchDistance(points)),
    startZoom: state.zoom,
    imageX: image.x,
    imageY: image.y
  };
}

function updateTouchGesture(event) {
  if (!state.touchGesture || state.activePointers.size < 2) return false;
  event.preventDefault();
  const source = currentSource();
  if (!source) return true;
  const points = firstTwoTouchPoints();
  const center = touchCenter(points);
  const distance = Math.max(1, touchDistance(points));
  state.zoom = clamp(state.touchGesture.startZoom * distance / state.touchGesture.startDistance, 0.1, 8);
  el.zoomInput.value = String(Math.round(state.zoom * 100));
  renderCanvas();
  renderOverlay();

  const viewportRect = el.viewport.getBoundingClientRect();
  el.viewport.scrollLeft = el.stage.offsetLeft + state.touchGesture.imageX * state.zoom - (center.x - viewportRect.left);
  el.viewport.scrollTop = el.stage.offsetTop + state.touchGesture.imageY * state.zoom - (center.y - viewportRect.top);
  return true;
}

function cancelCurrentDragForGesture() {
  if (!state.drag) return;
  const source = state.sources.find((item) => item.id === state.drag.sourceId);
  if (source && (state.drag.type === "move" || state.drag.type === "resize")) {
    const region = source.regions.find((item) => item.id === state.drag.regionId);
    if (region) Object.assign(region, state.drag.original);
  }
  if (source && state.drag.type === "line") {
    const line = source.splitLines.find((item) => item.id === state.drag.lineId);
    if (line) Object.assign(line, state.drag.originalLine);
    source.regions.splice(0, source.regions.length, ...state.drag.originalRegions.map((region) => ({ ...region })));
  }
  state.drag = null;
  el.overlay.querySelectorAll(".split-line.dragging").forEach((node) => node.classList.remove("dragging"));
  el.loupe.classList.remove("dragging");
  renderOverlay();
  renderRegionList();
  updateControls();
}

function hasDragStarted(event, drag, threshold = null) {
  if (drag.started) return true;
  const limit = threshold ?? (drag.pointerType === "touch" ? 8 : 2);
  const distance = Math.hypot(event.clientX - drag.clientStartX, event.clientY - drag.clientStartY);
  if (distance < limit) return false;
  drag.started = true;
  return true;
}

function startViewportPan(event) {
  event.preventDefault();
  event.stopPropagation();
  clearActiveHandle();
  tryPointerCapture(el.viewport, event.pointerId);
  state.drag = {
    type: "pan",
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    started: true,
    clientX: event.clientX,
    clientY: event.clientY,
    scrollLeft: el.viewport.scrollLeft,
    scrollTop: el.viewport.scrollTop
  };
}

function onRegionPointerDown(event) {
  if (rememberPointer(event)) return;
  if (event.button === 1) {
    startViewportPan(event);
    return;
  }
  if (event.button !== 0) return;
  const source = currentSource();
  const region = source?.regions.find((item) => item.id === event.currentTarget.dataset.regionId);
  if (!source || !region) return;

  event.preventDefault();
  event.stopPropagation();
  const alreadySelected = region.id === state.selectedRegionId;
  selectRegion(region.id);
  if (!alreadySelected) {
    if (event.pointerType === "touch") startViewportPan(event);
    return;
  }
  clearActiveHandle();
  state.drag = {
    type: "move",
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    started: false,
    clientStartX: event.clientX,
    clientStartY: event.clientY,
    start: clientToImage(event.clientX, event.clientY),
    sourceId: source.id,
    regionId: region.id,
    original: { ...region }
  };
  tryPointerCapture(event.currentTarget, event.pointerId);
}

function onHandlePointerDown(event) {
  if (rememberPointer(event)) return;
  if (event.button === 1) {
    startViewportPan(event);
    return;
  }
  if (event.button !== 0) return;
  const source = currentSource();
  const region = source?.regions.find((item) => item.id === event.currentTarget.dataset.regionId);
  if (!source || !region) return;

  event.preventDefault();
  event.stopPropagation();
  clearActiveHandle();
  selectRegion(region.id);
  const handle = event.currentTarget.dataset.handle;
  state.drag = {
    type: "resize",
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    started: false,
    clientStartX: event.clientX,
    clientStartY: event.clientY,
    handle,
    start: clientToImage(event.clientX, event.clientY),
    sourceId: source.id,
    regionId: region.id,
    original: { ...region }
  };
  el.loupe.classList.add("dragging");
  drawHandleLoupe(region, handle, true);
  tryPointerCapture(event.currentTarget, event.pointerId);
}

function onLinePointerDown(event) {
  if (rememberPointer(event)) return;
  if (event.button === 1) {
    startViewportPan(event);
    return;
  }
  if (event.button !== 0) return;
  const source = currentSource();
  const line = source?.splitLines.find((item) => item.id === event.currentTarget.dataset.lineId);
  if (!source || !line) return;
  event.preventDefault();
  event.stopPropagation();
  clearActiveHandle();
  state.drag = {
    type: "line",
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    started: false,
    clientStartX: event.clientX,
    clientStartY: event.clientY,
    start: clientToImage(event.clientX, event.clientY),
    sourceId: source.id,
    lineId: line.id,
    originalLine: { ...line },
    originalRegions: source.regions.map((region) => ({ ...region }))
  };
  event.currentTarget.classList.add("dragging");
  tryPointerCapture(event.currentTarget, event.pointerId);
}

function onOverlayPointerDown(event) {
  if (rememberPointer(event)) return;
  if (event.button === 1) {
    startViewportPan(event);
    return;
  }
  if (event.button === 0 && event.target === el.overlay) {
    selectRegion(null);
    startViewportPan(event);
  }
}

function onPointerMove(event) {
  updatePointerPosition(event);
  if (updateTouchGesture(event)) return;

  if (state.drag?.type === "resize" && state.drag.pointerId === event.pointerId) {
    updateResizeDrag(event);
    return;
  }

  if (!state.drag || state.drag.pointerId !== event.pointerId) {
    if (!state.activeHandle) drawLoupeFromClient(event.clientX, event.clientY);
    return;
  }

  if (state.drag.type === "pan") {
    el.viewport.scrollLeft = state.drag.scrollLeft - (event.clientX - state.drag.clientX);
    el.viewport.scrollTop = state.drag.scrollTop - (event.clientY - state.drag.clientY);
    return;
  }

  const source = state.sources.find((item) => item.id === state.drag.sourceId);
  if (!source) return;
  const current = clientToImage(event.clientX, event.clientY);
  const dx = Math.round(current.x - state.drag.start.x);
  const dy = Math.round(current.y - state.drag.start.y);

  if (state.drag.type === "move") {
    if (!hasDragStarted(event, state.drag)) return;
    const region = source.regions.find((item) => item.id === state.drag.regionId);
    if (!region) return;
    Object.assign(region, state.drag.original);
    moveRegion(region, dx, dy, source);
    renderOverlay();
    renderRegionList();
    updateControls();
    return;
  }

  if (state.drag.type === "line") {
    if (!hasDragStarted(event, state.drag)) return;
    applyLineDrag(source, dx, dy);
    renderOverlay();
    renderRegionList();
    updateControls();
  }
}

function updateResizeDrag(event) {
  const source = state.sources.find((item) => item.id === state.drag.sourceId);
  const region = source?.regions.find((item) => item.id === state.drag.regionId);
  if (!source || !region) return;
  if (!hasDragStarted(event, state.drag, state.drag.fromLoupe ? 2 : null)) return;
  let dx;
  let dy;
  if (state.drag.fromLoupe) {
    const scale = state.drag.sample / el.loupe.width;
    dx = Math.round((event.clientX - state.drag.clientX) * scale);
    dy = Math.round((event.clientY - state.drag.clientY) * scale);
  } else {
    const current = clientToImage(event.clientX, event.clientY);
    dx = Math.round(current.x - state.drag.start.x);
    dy = Math.round(current.y - state.drag.start.y);
  }
  Object.assign(region, state.drag.original);
  resizeRegion(region, state.drag.handle, dx, dy, source);
  if (state.snapEnabled && !event.altKey) snapResize(region, state.drag.handle, source);
  renderOverlay();
  renderRegionList();
  updateControls();
  drawHandleLoupe(region, state.drag.handle, true);
}

function onPointerUp(event) {
  if (!state.drag || state.drag.pointerId !== event.pointerId) {
    forgetPointer(event);
    return;
  }
  const finished = state.drag;
  if (["move", "resize", "line"].includes(finished.type) && finished.started) {
    markManualEdit(state.sources.find((source) => source.id === finished.sourceId));
  }
  state.drag = null;
  el.overlay.querySelectorAll(".split-line.dragging").forEach((node) => node.classList.remove("dragging"));
  el.loupe.classList.remove("dragging");
  if (finished.type === "resize") {
    state.activeHandle = {
      sourceId: finished.sourceId,
      regionId: finished.regionId,
      handle: finished.handle
    };
    const source = state.sources.find((item) => item.id === finished.sourceId);
    const region = source?.regions.find((item) => item.id === finished.regionId);
    if (region) drawHandleLoupe(region, finished.handle, false);
  }
  renderOverlay();
  forgetPointer(event);
}

function onPointerCancel(event) {
  if (state.drag?.pointerId === event.pointerId) {
    cancelCurrentDragForGesture();
  }
  forgetPointer(event);
}

function applyLineDrag(source, dx, dy) {
  const line = source.splitLines.find((item) => item.id === state.drag.lineId);
  if (!line) return;
  source.regions.splice(0, source.regions.length, ...state.drag.originalRegions.map((region) => ({ ...region })));
  Object.assign(line, state.drag.originalLine);
  const delta = line.axis === "x" ? dx : dy;
  const oldCenter = Math.round((line.start + line.end + 1) / 2);
  const min = line.min + 1;
  const max = line.max - 1;
  const newCenter = clamp(oldCenter + delta, min, max);
  const applied = newCenter - oldCenter;
  line.start += applied;
  line.end += applied;

  for (const region of source.regions) {
    if (line.axis === "x") {
      const right = region.x + region.width;
      if (Math.abs(right - oldCenter) <= SNAP_DISTANCE) region.width = clamp(newCenter - region.x, MIN_EDIT_SIDE, source.width - region.x);
      if (Math.abs(region.x - oldCenter) <= SNAP_DISTANCE) {
        const oldRight = region.x + region.width;
        region.x = clamp(newCenter, 0, oldRight - MIN_EDIT_SIDE);
        region.width = oldRight - region.x;
      }
    } else {
      const bottom = region.y + region.height;
      if (Math.abs(bottom - oldCenter) <= SNAP_DISTANCE) region.height = clamp(newCenter - region.y, MIN_EDIT_SIDE, source.height - region.y);
      if (Math.abs(region.y - oldCenter) <= SNAP_DISTANCE) {
        const oldBottom = region.y + region.height;
        region.y = clamp(newCenter, 0, oldBottom - MIN_EDIT_SIDE);
        region.height = oldBottom - region.y;
      }
    }
  }
}

function onLoupePointerDown(event) {
  if (event.button !== 0 || !state.activeHandle) return;
  const source = state.sources.find((item) => item.id === state.activeHandle.sourceId);
  const region = source?.regions.find((item) => item.id === state.activeHandle.regionId);
  if (!source || !region || !state.loupe) return;
  event.preventDefault();
  event.stopPropagation();
  state.drag = {
    type: "resize",
    fromLoupe: true,
    pointerId: event.pointerId,
    handle: state.activeHandle.handle,
    sourceId: source.id,
    regionId: region.id,
    original: { ...region },
    clientX: event.clientX,
    clientY: event.clientY,
    sample: state.loupe.sample
  };
  el.loupe.classList.add("dragging");
  tryPointerCapture(el.loupe, event.pointerId);
}

function drawLoupeFromClient(clientX, clientY) {
  const source = currentSource();
  if (!source) return;
  const rect = el.stage.getBoundingClientRect();
  const margin = 120;
  if (clientX < rect.left - margin || clientX > rect.right + margin || clientY < rect.top - margin || clientY > rect.bottom + margin) {
    scheduleLoupeHide();
    return;
  }
  clearTimeout(state.loupeHideTimer);
  const x = clamp(clientX, rect.left, rect.right);
  const y = clamp(clientY, rect.top, rect.bottom);
  const pos = clientToImage(x, y);
  drawLoupeAtImagePoint(source, pos.x, pos.y, LOUPE_NORMAL_SAMPLE, "normal");
}

function drawActiveHandleLoupe(dragging) {
  if (!state.activeHandle) return;
  const source = state.sources.find((item) => item.id === state.activeHandle.sourceId);
  const region = source?.regions.find((item) => item.id === state.activeHandle.regionId);
  if (source && region) drawHandleLoupe(region, state.activeHandle.handle, dragging);
}

function drawHandleLoupe(region, handle, dragging) {
  const source = currentSource();
  if (!source) return;
  const focus = handleFocusPoint(region, handle);
  drawLoupeAtImagePoint(source, focus.x, focus.y, LOUPE_HANDLE_SAMPLE, dragging ? "dragging" : "handle");
}

function handleFocusPoint(region, handle) {
  const left = region.x;
  const right = region.x + region.width;
  const top = region.y;
  const bottom = region.y + region.height;
  const cx = region.x + region.width / 2;
  const cy = region.y + region.height / 2;
  const points = {
    n: { x: cx, y: top },
    s: { x: cx, y: bottom },
    e: { x: right, y: cy },
    w: { x: left, y: cy },
    ne: { x: right, y: top },
    se: { x: right, y: bottom },
    sw: { x: left, y: bottom },
    nw: { x: left, y: top }
  };
  return points[handle] || { x: cx, y: cy };
}

function drawLoupeAtImagePoint(source, x, y, sample, mode) {
  clearTimeout(state.loupeHideTimer);
  const sx = clamp(Math.round(x) - Math.floor(sample / 2), 0, Math.max(0, source.width - sample));
  const sy = clamp(Math.round(y) - Math.floor(sample / 2), 0, Math.max(0, source.height - sample));
  state.loupe = { sourceId: source.id, sx, sy, sample, focusX: x, focusY: y };
  loupeCtx.imageSmoothingEnabled = false;
  loupeCtx.clearRect(0, 0, el.loupe.width, el.loupe.height);
  loupeCtx.drawImage(el.canvas, sx, sy, sample, sample, 0, 0, el.loupe.width, el.loupe.height);
  drawLoupeRegionEdges(sx, sy, sample);
  drawLoupeCrosshair(x, y, sx, sy, sample, mode);
  el.loupe.classList.add("visible");
  el.loupe.classList.toggle("handle-mode", mode === "handle" || mode === "dragging");
  el.loupe.classList.toggle("dragging", mode === "dragging");
}

function drawLoupeRegionEdges(sx, sy, sample) {
  const region = selectedRegion();
  if (!region) return;
  const scale = el.loupe.width / sample;
  const left = (region.x - sx) * scale;
  const right = (region.x + region.width - sx) * scale;
  const top = (region.y - sy) * scale;
  const bottom = (region.y + region.height - sy) * scale;
  loupeCtx.save();
  loupeCtx.strokeStyle = "rgba(225, 29, 72, 0.95)";
  loupeCtx.lineWidth = 2;
  loupeCtx.beginPath();
  if (left >= -2 && left <= el.loupe.width + 2) {
    loupeCtx.moveTo(left, 0);
    loupeCtx.lineTo(left, el.loupe.height);
  }
  if (right >= -2 && right <= el.loupe.width + 2) {
    loupeCtx.moveTo(right, 0);
    loupeCtx.lineTo(right, el.loupe.height);
  }
  if (top >= -2 && top <= el.loupe.height + 2) {
    loupeCtx.moveTo(0, top);
    loupeCtx.lineTo(el.loupe.width, top);
  }
  if (bottom >= -2 && bottom <= el.loupe.height + 2) {
    loupeCtx.moveTo(0, bottom);
    loupeCtx.lineTo(el.loupe.width, bottom);
  }
  loupeCtx.stroke();
  loupeCtx.restore();
}

function drawLoupeCrosshair(x, y, sx, sy, sample, mode) {
  const scale = el.loupe.width / sample;
  const cx = (x - sx) * scale;
  const cy = (y - sy) * scale;
  loupeCtx.save();
  loupeCtx.strokeStyle = mode === "normal" ? "rgba(15, 118, 110, 0.95)" : "rgba(183, 121, 31, 0.96)";
  loupeCtx.lineWidth = mode === "normal" ? 1.5 : 2.5;
  loupeCtx.beginPath();
  loupeCtx.moveTo(cx, 0);
  loupeCtx.lineTo(cx, el.loupe.height);
  loupeCtx.moveTo(0, cy);
  loupeCtx.lineTo(el.loupe.width, cy);
  loupeCtx.stroke();
  if (mode !== "normal") {
    loupeCtx.fillStyle = "rgba(225, 29, 72, 0.95)";
    loupeCtx.beginPath();
    loupeCtx.arc(cx, cy, 5, 0, Math.PI * 2);
    loupeCtx.fill();
  }
  loupeCtx.restore();
}

function scheduleLoupeHide() {
  if (state.activeHandle || state.drag?.type === "resize") return;
  clearTimeout(state.loupeHideTimer);
  state.loupeHideTimer = setTimeout(() => el.loupe.classList.remove("visible", "handle-mode", "dragging"), 700);
}

function collectEnabledRegions() {
  return state.sources.flatMap((source) => source.regions
    .filter((region) => region.enabled)
    .map((region) => ({ source, region })));
}

async function cropToBlob(source, region) {
  const canvas = document.createElement("canvas");
  canvas.width = region.width;
  canvas.height = region.height;
  const cropCtx = canvas.getContext("2d");
  cropCtx.drawImage(source.img, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG生成に失敗しました")), "image/png");
  });
}

async function exportAll() {
  const tasks = collectEnabledRegions();
  if (tasks.length === 0) {
    showToast("有効な候補がありません");
    return;
  }

  withDisabledExport(true);
  try {
    const files = [];
    for (const task of tasks) {
      const blob = await cropToBlob(task.source, task.region);
      files.push(new File([blob], sanitizeFileName(task.region.name), { type: "image/png" }));
    }

    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files, title: "Grid Cropper" });
      return;
    }

    if (window.showDirectoryPicker) {
      const directory = await window.showDirectoryPicker({ mode: "readwrite" });
      for (const file of files) {
        const handle = await directory.getFileHandle(sanitizeFileName(file.name), { create: true });
        const writable = await handle.createWritable();
        await writable.write(file);
        await writable.close();
      }
      return;
    }

    await downloadZipFromFiles(files, makeZipName());
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error(error);
      showToast("エクスポートに失敗しました");
    }
  } finally {
    withDisabledExport(false);
  }
}

async function downloadZipFromFiles(files, fileName) {
  const entries = [];
  for (const file of files) {
    entries.push({
      name: sanitizeFileName(file.name),
      bytes: new Uint8Array(await file.arrayBuffer()),
      date: new Date(file.lastModified || Date.now())
    });
  }
  downloadBlob(new Blob([createZip(entries)], { type: "application/zip" }), fileName);
}

function makeZipName() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "");
  const id = crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(16).slice(2, 10);
  return `grid-crops_${stamp}_${id}.zip`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function createZip(entries) {
  const fileRecords = [];
  const centralRecords = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.bytes);
    const { time, date } = dosDateTime(entry.date);
    const local = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(local.buffer);
    writeLocalHeader(view, nameBytes, crc, entry.bytes.length, time, date);
    local.set(nameBytes, 30);
    fileRecords.push(local, entry.bytes);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    writeCentralHeader(centralView, nameBytes, crc, entry.bytes.length, time, date, offset);
    central.set(nameBytes, 46);
    centralRecords.push(central);
    offset += local.length + entry.bytes.length;
  }

  const centralSize = centralRecords.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return new Blob([...fileRecords, ...centralRecords, end]);
}

function writeLocalHeader(view, nameBytes, crc, size, time, date) {
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(10, time, true);
  view.setUint16(12, date, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, nameBytes.length, true);
}

function writeCentralHeader(view, nameBytes, crc, size, time, date, offset) {
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(12, time, true);
  view.setUint16(14, date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint32(42, offset, true);
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function registerEvents() {
  el.fileInput.addEventListener("change", (event) => {
    loadFiles(event.target.files);
    event.target.value = "";
  });
  el.dropZone.addEventListener("click", () => el.fileInput.click());
  el.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    el.dropZone.classList.add("dragging");
  });
  el.dropZone.addEventListener("dragleave", () => {
    el.dropZone.classList.remove("dragging");
  });
  el.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    el.dropZone.classList.remove("dragging");
    loadFiles(event.dataTransfer.files);
  });
  el.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      el.fileInput.click();
    }
  });

  el.detectButton.addEventListener("click", detectCurrent);
  el.detectSettingsButton.addEventListener("click", detectCurrent);
  el.addRegionButton.addEventListener("click", addRegion);
  el.deleteRegionButton.addEventListener("click", deleteSelectedRegion);
  el.exportButton.addEventListener("click", exportAll);
  if (el.exportBottomButton) el.exportBottomButton.addEventListener("click", exportAll);
  el.fitButton.addEventListener("click", fitToViewport);
  el.actualSizeButton.addEventListener("click", () => setZoom(1));
  el.zoomOutButton.addEventListener("click", () => setZoom(state.zoom / 1.25));
  el.zoomInButton.addEventListener("click", () => setZoom(state.zoom * 1.25));
  el.zoomInput.addEventListener("input", () => setZoom(Number(el.zoomInput.value) / 100));
  el.pixelButton.addEventListener("click", () => {
    state.pixelated = !state.pixelated;
    el.canvas.classList.toggle("pixelated", state.pixelated);
    updateControls();
  });
  el.snapButton.addEventListener("click", () => {
    state.snapEnabled = !state.snapEnabled;
    updateControls();
  });
  el.panUpButton?.addEventListener("click", () => panViewport(0, -1));
  el.panDownButton?.addEventListener("click", () => panViewport(0, 1));
  el.panLeftButton?.addEventListener("click", () => panViewport(-1, 0));
  el.panRightButton?.addEventListener("click", () => panViewport(1, 0));

  for (const input of [el.xInput, el.yInput, el.wInput, el.hInput]) {
    input.addEventListener("change", updateSelectedFromInputs);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") updateSelectedFromInputs();
    });
  }

  el.overlay.addEventListener("pointerdown", onOverlayPointerDown);
  el.viewport.addEventListener("pointerdown", (event) => {
    if (rememberPointer(event)) return;
    if (event.pointerType === "touch" && event.target === el.viewport) {
      startViewportPan(event);
      return;
    }
    if (event.button === 1) startViewportPan(event);
  });
  el.viewport.addEventListener("auxclick", (event) => {
    if (event.button === 1) event.preventDefault();
  });
  el.viewport.addEventListener("wheel", (event) => {
    if (!currentSource()) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0014);
    setZoomAt(state.zoom * factor, event.clientX, event.clientY);
  }, { passive: false });
  el.viewport.addEventListener("pointerleave", scheduleLoupeHide);
  el.loupe.addEventListener("pointerdown", onLoupePointerDown);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerCancel);
  el.viewport.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    nudgeSelected(dx, dy);
  });
  window.addEventListener("resize", () => {
    if (currentSource()) {
      renderCanvas();
      renderOverlay();
    }
  });
}

registerEvents();
renderAll();

const fixtureUrls = new URLSearchParams(window.location.search).getAll("fixture");
if (fixtureUrls.length > 0) {
  loadFixtureUrls(fixtureUrls).catch((error) => {
    console.error(error);
    showToast("fixtureを読み込めませんでした");
  });
}

window.__gridCropperTest = {
  state,
  loadFiles,
  loadFixtureUrls,
  detectRegions,
  readDetectionSettings,
  createZip,
  crc32
};
