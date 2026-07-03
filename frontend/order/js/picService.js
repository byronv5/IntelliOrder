const PIC_API = '/api/product-images';

/** @type {Map<string, string>} */
let imageByProductNo = new Map();
let initialized = false;

function normalizeKey(productNo) {
  return String(productNo ?? '').trim().toLowerCase();
}

export async function initPicService() {
  const res = await fetch(PIC_API, { cache: 'no-store' });
  if (!res.ok) {
    imageByProductNo = new Map();
    initialized = true;
    return;
  }
  const data = await res.json();
  imageByProductNo = new Map(
    Object.entries(data ?? {}).map(([key, url]) => [normalizeKey(key), url]),
  );
  initialized = true;
}

export function getProductImageUrl(productNo) {
  if (!productNo) return '';
  return imageByProductNo.get(normalizeKey(productNo)) ?? '';
}

export function isPicServiceReady() {
  return initialized;
}
