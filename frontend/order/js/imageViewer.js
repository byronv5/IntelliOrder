const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const STEP = 0.1;

let root = null;
let imgEl = null;
let frameEl = null;
let sliderEl = null;
let labelEl = null;
let titleEl = null;
let scale = 1;
let baseWidth = 0;
let baseHeight = 0;
let onKeyDown = null;

function ensureViewer() {
  if (root) return;

  root = document.createElement('div');
  root.className = 'image-viewer';
  root.hidden = true;
  root.innerHTML = `
    <div class="image-viewer-backdrop" data-action="close"></div>
    <div class="image-viewer-dialog" role="dialog" aria-modal="true">
      <div class="image-viewer-toolbar">
        <span class="image-viewer-title"></span>
        <div class="image-viewer-zoom">
          <button type="button" class="btn btn-outline image-viewer-zoom-btn" data-zoom="out" title="缩小">−</button>
          <input type="range" class="image-viewer-slider" min="25" max="400" step="5" value="100">
          <span class="image-viewer-zoom-label">100%</span>
          <button type="button" class="btn btn-outline image-viewer-zoom-btn" data-zoom="in" title="放大">+</button>
          <button type="button" class="btn btn-outline" data-zoom="reset">重置</button>
        </div>
        <button type="button" class="image-viewer-close" data-action="close" title="关闭">×</button>
      </div>
      <div class="image-viewer-stage">
        <div class="image-viewer-frame">
          <img class="image-viewer-img" alt="">
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  imgEl = root.querySelector('.image-viewer-img');
  frameEl = root.querySelector('.image-viewer-frame');
  sliderEl = root.querySelector('.image-viewer-slider');
  labelEl = root.querySelector('.image-viewer-zoom-label');
  titleEl = root.querySelector('.image-viewer-title');

  root.querySelectorAll('[data-action="close"]').forEach(el => {
    el.addEventListener('click', closeImageViewer);
  });
  root.querySelector('[data-zoom="out"]').addEventListener('click', () => setScale(scale - STEP));
  root.querySelector('[data-zoom="in"]').addEventListener('click', () => setScale(scale + STEP));
  root.querySelector('[data-zoom="reset"]').addEventListener('click', () => setScale(1));
  sliderEl.addEventListener('input', () => setScale(Number(sliderEl.value) / 100));
  root.querySelector('.image-viewer-stage').addEventListener('wheel', onWheel, { passive: false });
  imgEl.addEventListener('load', onImageLoad);

  onKeyDown = e => {
    if (root.hidden) return;
    if (e.key === 'Escape') closeImageViewer();
  };
  document.addEventListener('keydown', onKeyDown);
}

function onWheel(e) {
  if (root.hidden) return;
  e.preventDefault();
  setScale(scale + (e.deltaY > 0 ? -STEP : STEP));
}

function fitBaseSize() {
  const stage = root.querySelector('.image-viewer-stage');
  const naturalW = imgEl.naturalWidth;
  const naturalH = imgEl.naturalHeight;
  if (!naturalW || !naturalH || !stage) return;

  const padding = 48;
  const maxW = Math.max(stage.clientWidth - padding, 120);
  const maxH = Math.max(stage.clientHeight - padding, 120);
  const fit = Math.min(1, maxW / naturalW, maxH / naturalH);
  baseWidth = naturalW * fit;
  baseHeight = naturalH * fit;
  imgEl.style.width = `${baseWidth}px`;
  imgEl.style.height = `${baseHeight}px`;
}

function applyScale() {
  frameEl.style.width = `${baseWidth * scale}px`;
  frameEl.style.height = `${baseHeight * scale}px`;
  imgEl.style.transform = `scale(${scale})`;
  sliderEl.value = String(Math.round(scale * 100));
  labelEl.textContent = `${Math.round(scale * 100)}%`;
}

function setScale(next) {
  if (!baseWidth || !baseHeight) return;
  scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
  applyScale();
}

function onImageLoad() {
  fitBaseSize();
  scale = 1;
  applyScale();
  const stage = root.querySelector('.image-viewer-stage');
  stage.scrollTop = 0;
  stage.scrollLeft = 0;
}

function closeImageViewer() {
  if (!root) return;
  root.hidden = true;
  document.body.classList.remove('image-viewer-open');
  imgEl.removeAttribute('src');
  baseWidth = 0;
  baseHeight = 0;
}

export function openImageViewer({ src, title = '' }) {
  if (!src) return;
  ensureViewer();
  scale = 1;
  baseWidth = 0;
  baseHeight = 0;
  titleEl.textContent = title;
  imgEl.alt = title;
  labelEl.textContent = '100%';
  sliderEl.value = '100';
  root.hidden = false;
  document.body.classList.add('image-viewer-open');
  imgEl.src = src;
  if (imgEl.complete) onImageLoad();
}

export function bindImageZoomClick(container, selector = '.order-product-thumb') {
  container.querySelectorAll(selector).forEach(img => {
    img.addEventListener('click', () => {
      openImageViewer({ src: img.src, title: img.alt || img.title || '' });
    });
  });
}
