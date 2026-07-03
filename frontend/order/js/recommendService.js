import { CONFIG } from './config.js';
import { findHistoryBenchmarkWithFallback, getCatalogSizeTemplate, calcSuggestedQtyByMatchTier } from './dataService.js';

export const RECOMMEND_ERR = {
  NO_HISTORY: 'NO_HISTORY',
  NO_SIZE_TEMPLATE: 'NO_SIZE_TEMPLATE',
  SIZE_DETAIL_MISMATCH: 'SIZE_DETAIL_MISMATCH',
};

function recommendError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function getSizeList(salesBySize) {
  return Object.keys(salesBySize).filter(s => salesBySize[s] > 0);
}

function calcProportional(totalQty, sizeList, salesBySize) {
  const historyTotal = sizeList.reduce((s, k) => s + salesBySize[k], 0);
  const breakdown = {};
  let allocated = 0;
  sizeList.forEach((size, i) => {
    if (i === sizeList.length - 1) {
      breakdown[size] = totalQty - allocated;
    } else {
      const qty = Math.round(totalQty * salesBySize[size] / historyTotal);
      breakdown[size] = qty;
      allocated += qty;
    }
  });
  return breakdown;
}

export function buildEmptySizeMap(sizeTemplate) {
  return Object.fromEntries(sizeTemplate.map(s => [s, 0]));
}

/** 按历史尺码比例计算分配；sizeTemplate 限定可用尺码 */
export function calcSizeBreakdown(totalQty, salesBySize, sizeTemplate = null) {
  if (sizeTemplate?.length) {
    if (totalQty <= 0) return buildEmptySizeMap(sizeTemplate);
    const sizeList = sizeTemplate.filter(s => (salesBySize[s] ?? 0) > 0);
    if (!sizeList.length) return evenBreakdown(totalQty, sizeTemplate);
    const partial = calcProportional(totalQty, sizeList, salesBySize);
    return Object.fromEntries(sizeTemplate.map(s => [s, partial[s] ?? 0]));
  }

  if (totalQty <= 0) {
    return Object.fromEntries((CONFIG.allSizes.length ? CONFIG.allSizes : CONFIG.sizes).map(s => [s, 0]));
  }

  const sizeList = getSizeList(salesBySize);
  if (sizeList.length === 0) return evenBreakdown(totalQty, CONFIG.allSizes.length ? CONFIG.allSizes : ['均码']);

  return calcProportional(totalQty, sizeList, salesBySize);
}

function evenBreakdown(totalQty, sizeList) {
  const list = sizeList.length ? sizeList : ['均码'];
  const perSize = Math.floor(totalQty / list.length);
  const breakdown = Object.fromEntries(list.map(s => [s, perSize]));
  breakdown[list[list.length - 1]] += totalQty - perSize * list.length;
  return breakdown;
}

function resolveBenchmarkCriteria(item, overrides = {}) {
  const criteria = {
    region: item.region,
    gender: overrides.gender || item.gender,
    subCategory: overrides.subCategory || item.subCategory,
    fit: overrides.fit || item.fit,
  };
  if (overrides.styleNo) criteria.styleNo = overrides.styleNo;
  if (overrides.articleNo) criteria.articleNo = overrides.articleNo;
  if (overrides.colorSeries) criteria.colorSeries = overrides.colorSeries;
  if (overrides.fabric) criteria.fabric = overrides.fabric;
  return criteria;
}

function formatBenchmarkKey(criteria, relaxedLabel) {
  const parts = [];
  if (criteria.styleNo) parts.push(criteria.styleNo);
  if (criteria.articleNo) parts.push(criteria.articleNo);
  if (criteria.gender) parts.push(criteria.gender);
  if (criteria.subCategory) parts.push(criteria.subCategory);
  if (criteria.fit) parts.push(criteria.fit);
  if (criteria.colorSeries) parts.push(criteria.colorSeries);
  if (criteria.fabric) parts.push(criteria.fabric);
  const key = parts.length ? parts.join(' · ') : criteria.region;
  return relaxedLabel ? `${key}（${relaxedLabel}）` : key;
}

function formatBenchmarkError(criteria) {
  let msg = `${criteria.region} / ${criteria.gender} / ${criteria.subCategory} / ${criteria.fit}`;
  if (criteria.styleNo) msg += ` / ${criteria.styleNo}`;
  if (criteria.articleNo) msg += ` / ${criteria.articleNo}`;
  if (criteria.colorSeries) msg += ` / ${criteria.colorSeries}`;
  if (criteria.fabric) msg += ` / ${criteria.fabric}`;
  return msg;
}

/** 基于历年历史生成订货建议，尺码仅限当前款色尺码明细 */
export function recommendOrder(currentItem, overrides = {}) {
  const { templateKeys, sizeBandRange } = getCatalogSizeTemplate(currentItem);
  if (!templateKeys.length) {
    throw recommendError(
      `未找到款色尺码明细：${currentItem.region} / ${currentItem.styleNo} / ${currentItem.color}`,
      RECOMMEND_ERR.NO_SIZE_TEMPLATE,
    );
  }

  const criteria = resolveBenchmarkCriteria(currentItem, overrides);
  const matched = findHistoryBenchmarkWithFallback(criteria, currentItem);
  if (!matched) {
    throw recommendError(
      `未找到历年历史基准：${formatBenchmarkError(criteria)}`,
      RECOMMEND_ERR.NO_HISTORY,
    );
  }

  const { benchmark, matchedRecords, matchCriteria, matchTier, relaxed, relaxedLabel } = matched;
  const sizeBase = benchmark.salesBySize;
  const overlap = templateKeys.filter(s => (sizeBase[s] ?? 0) > 0);
  if (!overlap.length) {
    throw recommendError(
      `历史基准与尺码明细无法匹配（${templateKeys.join('/')}）`,
      RECOMMEND_ERR.SIZE_DETAIL_MISMATCH,
    );
  }

  const qtyBasis = calcSuggestedQtyByMatchTier(matchTier, matchedRecords, currentItem, overrides);
  const suggestedQty = qtyBasis.qty;
  const sizes = calcSizeBreakdown(suggestedQty, sizeBase, templateKeys);

  return {
    styleNo: currentItem.styleNo,
    subCategory: currentItem.subCategory,
    gender: currentItem.gender,
    color: currentItem.color,
    colorSeries: currentItem.colorSeries,
    fit: currentItem.fit,
    fabric: currentItem.fabric ?? '',
    region: currentItem.region,
    standardPrice: currentItem.standardPrice,
    quantity: suggestedQty,
    sizes,
    sizeTemplate: templateKeys,
    sizeBandRange,
    historyTotal: benchmark.totalSales,
    historyOrderQty: benchmark.orderQty,
    historyMatchCount: benchmark.matchCount,
    maxSalesInPool: qtyBasis.sales,
    qtyBasisLabel: qtyBasis.basisLabel,
    matchTier,
    salesToOrderRatio: CONFIG.salesToOrderRatio,
    historySizes: sizeBase,
    benchmarkKey: formatBenchmarkKey(matchCriteria, relaxed ? relaxedLabel : ''),
    benchmarkRelaxed: relaxed,
    relaxedLabel,
  };
}

export function parseSizeQty(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** 校验尺码合计与订货数量一致 */
export function validateOrder(order) {
  if (!order.region) throw new Error('请选择区域');
  if (!order.styleNo) throw new Error('请选择款号');
  if (!order.color) throw new Error('请选择颜色');
  if (order.quantity <= 0) throw new Error('订货数量必须大于 0');

  const template = order.sizeTemplate;
  const sizeEntries = Object.entries(order.sizes ?? {});

  for (const [size, qty] of sizeEntries) {
    if (qty < 0) throw new Error(`尺码 ${size} 数量不能小于 0`);
    if (template?.length && !template.includes(size)) {
      throw new Error(`尺码 ${size} 不在当前款色尺码带内`);
    }
  }

  if (template?.length) {
    const missing = template.filter(s => !(s in (order.sizes ?? {})));
    if (missing.length) throw new Error(`缺少尺码：${missing.join('/')}`);
  }

  const sizeTotal = Object.values(order.sizes).reduce((a, b) => a + b, 0);
  if (sizeTotal !== order.quantity) {
    throw new Error(`尺码合计 ${sizeTotal} 与订货数量 ${order.quantity} 不一致`);
  }
}

export function sumSizes(sizes) {
  return Object.values(sizes).reduce((a, b) => a + b, 0);
}

/** 按历史销量计算各尺码推荐占比（与 calcSizeBreakdown 使用同一历史基准） */
export function calcHistorySizeSharePct(historySizes, sizeKeys) {
  if (!sizeKeys?.length) return {};
  const sales = historySizes ?? {};
  const total = sizeKeys.reduce((sum, size) => sum + (sales[size] ?? 0), 0);
  if (!total) return Object.fromEntries(sizeKeys.map(size => [size, null]));

  const activeKeys = sizeKeys.filter(size => (sales[size] ?? 0) > 0);
  const result = Object.fromEntries(sizeKeys.map(size => [size, 0]));
  let allocated = 0;
  activeKeys.forEach((size, index) => {
    if (index === activeKeys.length - 1) {
      result[size] = 100 - allocated;
      return;
    }
    const pct = Math.round((sales[size] / total) * 100);
    result[size] = pct;
    allocated += pct;
  });
  return result;
}
