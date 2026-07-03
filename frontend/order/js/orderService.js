import { CONFIG } from './config.js';
import { validateOrder } from './recommendService.js';
import { getAllSizes, sumOrderSizes } from './dataService.js';

const API_ORDERS = '/api/orders';

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `请求失败 (${res.status})`);
  return data;
}

function localOrderKey(order) {
  return `${order.region}|${order.styleNo}|${order.color}`;
}

export async function getOrders() {
  try {
    const orders = await requestJson(API_ORDERS);
    return orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch (err) {
    console.warn('[orderService] 无法读取本地订货库，请确认已运行 start.bat', err);
    return [];
  }
}

export async function getLocalOrderMap() {
  const map = new Map();
  (await getOrders()).forEach(o => {
    map.set(localOrderKey(o), o);
    if (o.productNo) {
      map.set(`${o.region}|${o.productNo}|${o.color}`, o);
    }
  });
  return map;
}

function lookupLocalOrder(localMap, row) {
  return localMap.get(`${row.region}|${row.styleNo}|${row.color}`)
    ?? (row.productNo ? localMap.get(`${row.region}|${row.productNo}|${row.color}`) : null);
}

export async function getLocalOrder(region, styleNo, color) {
  const map = await getLocalOrderMap();
  return map.get(`${region}|${styleNo}|${color}`) ?? null;
}

export async function mergeCatalogWithLocalSizes(catalogRows) {
  const localMap = await getLocalOrderMap();
  return catalogRows.map(row => {
    const local = lookupLocalOrder(localMap, row);
    const placedSizeBySize = { ...(local?.sizes ?? {}) };
    const hasPlaced = sumOrderSizes(placedSizeBySize) > 0;
    return {
      ...row,
      placedSizeBySize,
      catalogSizeDetailBySize: { ...(row.catalogSizeDetailBySize ?? {}) },
      hasExcelSizeDetail: row.hasExcelSizeDetail ?? false,
      sizeTemplateKeys: row.sizeTemplateKeys ?? [],
      sizeDetailBySize: hasPlaced ? placedSizeBySize : row.sizeDetailBySize,
    };
  });
}

export async function createOrder(orderData) {
  return upsertOrder(orderData);
}

export async function upsertOrder(orderData) {
  validateOrder(orderData);
  return requestJson(API_ORDERS, {
    method: 'PUT',
    body: JSON.stringify(orderData),
  });
}

export async function updateOrder(id, updates) {
  const orders = await getOrders();
  const existing = orders.find(o => o.id === id);
  if (!existing) throw new Error('订货单不存在');
  return upsertOrder({ ...existing, ...updates });
}

export async function confirmOrder(id) {
  return updateOrder(id, { status: 'confirmed' });
}

export async function deleteOrder(id) {
  await requestJson(`${API_ORDERS}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** 清除本地库中全部已下单尺码记录 */
export async function clearAllPlacedOrders() {
  const data = await requestJson(API_ORDERS, { method: 'DELETE' });
  return data.deleted ?? 0;
}

export async function migrateLocalStorageIfNeeded() {
  const raw = localStorage.getItem(CONFIG.storageKey);
  if (!raw) return 0;

  let orders;
  try {
    orders = JSON.parse(raw);
  } catch {
    localStorage.removeItem(CONFIG.storageKey);
    return 0;
  }
  if (!Array.isArray(orders) || orders.length === 0) {
    localStorage.removeItem(CONFIG.storageKey);
    return 0;
  }

  const { migrated } = await requestJson(`${API_ORDERS}/migrate`, {
    method: 'POST',
    body: JSON.stringify(orders),
  });
  localStorage.removeItem(CONFIG.storageKey);
  return migrated ?? orders.length;
}

export function getOrderSummary(orders) {
  const totalQty = orders.reduce((s, o) => s + o.quantity, 0);
  const styleSet = new Set(orders.map(o => o.styleNo));
  const confirmed = orders.filter(o => o.status === 'confirmed').length;

  const bySeries = {};
  orders.forEach(o => {
    bySeries[o.colorSeries] = (bySeries[o.colorSeries] ?? 0) + o.quantity;
  });

  const sizeTotal = {};
  getAllSizes().forEach(s => { sizeTotal[s] = 0; });
  orders.forEach(o => {
    Object.entries(o.sizes ?? {}).forEach(([s, v]) => {
      sizeTotal[s] = (sizeTotal[s] ?? 0) + v;
    });
  });

  return { totalQty, styleCount: styleSet.size, orderCount: orders.length, confirmed, bySeries, sizeTotal };
}

export function exportOrdersCsv(orders) {
  const sizes = getAllSizes().length ? getAllSizes() : Object.keys(orders[0]?.sizes ?? {});
  const headers = ['区域', '款号', '货号', '中类', '性别', '颜色', '标准价', '色系', '面料', '版型', '订货数量', ...sizes, '状态', '创建时间'];
  const rows = orders.map(o => [
    o.region ?? '', o.productNo ?? '', o.styleNo, o.subCategory ?? '', o.gender ?? '', o.color,
    o.standardPrice ?? '', o.colorSeries, o.fabric ?? '', o.fit,
    o.quantity, ...sizes.map(s => o.sizes[s] ?? 0),
    o.status === 'confirmed' ? '已确认' : '草稿',
    new Date(o.createdAt).toLocaleString('zh-CN'),
  ]);

  const bom = '\uFEFF';
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  return bom + csv;
}
