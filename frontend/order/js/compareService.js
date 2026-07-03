import { CONFIG } from './config.js';

/** 计算同比增长率 (%) */
export function calcGrowthRate(base, current) {
  if (base === 0) return current > 0 ? 100 : 0;
  return Math.round((current - base) / base * 1000) / 10;
}

function collectGroupNames(ordersBase, ordersCurrent, field) {
  return [...new Set([
    ...ordersBase.map(o => o[field]),
    ...ordersCurrent.map(o => o[field]),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function addColorKey(colorKeys, order, orderedColorOnly = false) {
  if (orderedColorOnly && order.quantity <= 0) return;
  colorKeys.add(`${order.styleNo}-${order.color}`);
}

function aggregateTotal(orders, { orderedColorOnly = false } = {}) {
  const colorKeys = new Set();
  let totalQty = 0;
  let totalAmount = 0;

  orders.forEach(o => {
    addColorKey(colorKeys, o, orderedColorOnly);
    totalQty += o.quantity;
    totalAmount += o.amount;
  });

  return { colorCount: colorKeys.size, totalQty, totalAmount };
}

function aggregateByRegion(orders, regionNames, { orderedColorOnly = false } = {}) {
  const byRegion = {};
  regionNames.forEach(name => {
    byRegion[name] = { colorKeys: new Set(), totalQty: 0, totalAmount: 0 };
  });

  orders.forEach(o => {
    const reg = byRegion[o.region];
    if (!reg) return;
    addColorKey(reg.colorKeys, o, orderedColorOnly);
    reg.totalQty += o.quantity;
    reg.totalAmount += o.amount;
  });

  return regionNames.map(name => ({
    name,
    colorCount: byRegion[name].colorKeys.size,
    totalQty: byRegion[name].totalQty,
    totalAmount: byRegion[name].totalAmount,
  }));
}

function aggregateByGroup(orders, groupNames, field, { orderedColorOnly = false } = {}) {
  const byGroup = {};
  groupNames.forEach(name => {
    byGroup[name] = { colorKeys: new Set(), totalQty: 0, totalAmount: 0 };
  });

  orders.forEach(o => {
    const group = byGroup[o[field]];
    if (!group) return;
    addColorKey(group.colorKeys, o, orderedColorOnly);
    group.totalQty += o.quantity;
    group.totalAmount += o.amount;
  });

  const stats = {};
  groupNames.forEach(name => {
    stats[name] = {
      colorCount: byGroup[name].colorKeys.size,
      totalQty: byGroup[name].totalQty,
      totalAmount: byGroup[name].totalAmount,
    };
  });

  return stats;
}

function buildMetricCompare(baseVal, currentVal) {
  return { base: baseVal, current: currentVal, growth: calcGrowthRate(baseVal, currentVal) };
}

function buildMetricWithRegions(baseTotal, currentTotal, baseByRegion, currentByRegion, field, regions) {
  const baseMap = Object.fromEntries(baseByRegion.map(r => [r.name, r]));
  const currentMap = Object.fromEntries(currentByRegion.map(r => [r.name, r]));
  const metric = buildMetricCompare(baseTotal, currentTotal);

  return {
    ...metric,
    regionBase: Object.fromEntries(regions.map(r => [r, baseMap[r]?.[field] ?? 0])),
    regionCurrent: Object.fromEntries(regions.map(r => [r, currentMap[r]?.[field] ?? 0])),
  };
}

function buildGroupCompare(baseStats, currentStats, names) {
  return names.map(name => {
    const b = baseStats[name] ?? { colorCount: 0, totalQty: 0, totalAmount: 0 };
    const c = currentStats[name] ?? { colorCount: 0, totalQty: 0, totalAmount: 0 };
    return {
      name,
      colorCount: buildMetricCompare(b.colorCount, c.colorCount),
      totalQty: buildMetricCompare(b.totalQty, c.totalQty),
      totalAmount: buildMetricCompare(b.totalAmount, c.totalAmount),
    };
  });
}

function aggregateGroupRegionMap(orders, groupNames, field, regionNames) {
  const map = {};
  groupNames.forEach(name => {
    map[name] = {
      colorKeys: new Set(),
      totalQty: 0,
      totalAmount: 0,
      totalSales: 0,
      byRegion: Object.fromEntries(regionNames.map(r => [r, 0])),
    };
  });

  orders.forEach(o => {
    const g = map[o[field]];
    if (!g) return;
    g.colorKeys.add(`${o.styleNo}-${o.color}`);
    g.totalQty += o.quantity;
    g.totalAmount += o.amount;
    g.totalSales += o.sales ?? 0;
    if (g.byRegion[o.region] !== undefined) g.byRegion[o.region] += o.quantity;
  });

  return map;
}

export function calcSellThroughRate(sales, orderQty) {
  if (!orderQty) return null;
  return Math.round(sales / orderQty * 100);
}

function buildQtyCompareByField(ordersBase, ordersCurrent, names, field, regions) {
  const baseMap = aggregateGroupRegionMap(ordersBase, names, field, regions);
  const currentMap = aggregateGroupRegionMap(ordersCurrent, names, field, regions);

  return names.map(name => {
    const b = baseMap[name] ?? { totalQty: 0, totalAmount: 0, totalSales: 0, byRegion: {} };
    const c = currentMap[name] ?? { totalQty: 0, totalAmount: 0, totalSales: 0, byRegion: {} };
    return {
      name,
      sellThrough: {
        base: calcSellThroughRate(b.totalSales, b.totalQty),
      },
      totalQty: {
        ...buildMetricCompare(b.totalQty, c.totalQty),
        regionBase: Object.fromEntries(regions.map(r => [r, b.byRegion[r] ?? 0])),
        regionCurrent: Object.fromEntries(regions.map(r => [r, c.byRegion[r] ?? 0])),
      },
      totalAmount: buildMetricCompare(b.totalAmount, c.totalAmount),
    };
  });
}

function buildMajorCategoryCompare(ordersBase, ordersCurrent, names, regions) {
  return buildQtyCompareByField(ordersBase, ordersCurrent, names, 'majorCategory', regions);
}

function aggregateByRegionGender(orders, regions, genders, { orderedColorOnly = false } = {}) {
  const map = {};
  regions.forEach(region => {
    genders.forEach(gender => {
      map[`${region}\0${gender}`] = {
        region,
        gender,
        colorKeys: new Set(),
        totalQty: 0,
        totalAmount: 0,
      };
    });
  });

  orders.forEach(o => {
    const bucket = map[`${o.region}\0${o.gender}`];
    if (!bucket) return;
    addColorKey(bucket.colorKeys, o, orderedColorOnly);
    bucket.totalQty += o.quantity;
    bucket.totalAmount += o.amount;
  });

  return map;
}

function statsFromBucket(bucket) {
  if (!bucket) return { colorCount: 0, totalQty: 0, totalAmount: 0 };
  return {
    colorCount: bucket.colorKeys.size,
    totalQty: bucket.totalQty,
    totalAmount: bucket.totalAmount,
  };
}

function buildRegionCompare(ordersBase, ordersCurrent, regions) {
  const genders = GENDER_ORDER.filter(g =>
    ordersBase.some(o => o.gender === g) || ordersCurrent.some(o => o.gender === g),
  );
  const baseMap = aggregateByRegionGender(ordersBase, regions, genders);
  const currentMap = aggregateByRegionGender(ordersCurrent, regions, genders, ORDERED_COLOR_ONLY);
  const baseByRegion = aggregateByRegion(ordersBase, regions);
  const currentByRegion = aggregateByRegion(ordersCurrent, regions, ORDERED_COLOR_ONLY);
  const baseRegionMap = Object.fromEntries(baseByRegion.map(r => [r.name, r]));
  const currentRegionMap = Object.fromEntries(currentByRegion.map(r => [r.name, r]));

  const rows = regions.flatMap(region => {
    const genderRows = genders.map(gender => {
      const b = statsFromBucket(baseMap[`${region}\0${gender}`]);
      const c = statsFromBucket(currentMap[`${region}\0${gender}`]);
      return {
        region,
        gender,
        colorCount: buildMetricCompare(b.colorCount, c.colorCount),
        totalQty: buildMetricCompare(b.totalQty, c.totalQty),
        totalAmount: buildMetricCompare(b.totalAmount, c.totalAmount),
      };
    });

    const rb = baseRegionMap[region] ?? { colorCount: 0, totalQty: 0, totalAmount: 0 };
    const rc = currentRegionMap[region] ?? { colorCount: 0, totalQty: 0, totalAmount: 0 };
    const subtotal = {
      region,
      gender: '合计',
      isSubtotal: true,
      colorCount: buildMetricCompare(rb.colorCount, rc.colorCount),
      totalQty: buildMetricCompare(rb.totalQty, rc.totalQty),
      totalAmount: buildMetricCompare(rb.totalAmount, rc.totalAmount),
    };

    return [...genderRows, subtotal];
  });

  const baseTotal = aggregateTotal(ordersBase);
  const currentTotal = aggregateTotal(ordersCurrent, ORDERED_COLOR_ONLY);
  rows.push({
    region: '两地合计',
    gender: '',
    isTotal: true,
    ...buildTotalRow(baseTotal, currentTotal),
  });

  return rows;
}

function buildTotalRow(baseTotal, currentTotal) {
  return {
    name: '合计',
    colorCount: buildMetricCompare(baseTotal.colorCount, currentTotal.colorCount),
    totalQty: buildMetricCompare(baseTotal.totalQty, currentTotal.totalQty),
    totalAmount: buildMetricCompare(baseTotal.totalAmount, currentTotal.totalAmount),
  };
}

function filterOrdersByRegion(orders, region) {
  if (!region) return orders;
  return orders.filter(o => o.region === region);
}

function buildCategoryMajorMap(...orderLists) {
  const map = {};
  orderLists.forEach(orders => {
    orders.forEach(o => {
      if (!o.category || map[o.category] || !o.majorCategory) return;
      map[o.category] = o.majorCategory;
    });
  });
  return map;
}

/** 中类明细对比（可按区域筛选） */
export function buildSubCategoryCompare(ordersBase, ordersCurrent, region = '') {
  const baseFiltered = filterOrdersByRegion(ordersBase, region);
  const currentFiltered = filterOrdersByRegion(ordersCurrent, region);

  const subNames = collectGroupNames(baseFiltered, currentFiltered, 'category');
  const baseSub = aggregateByGroup(baseFiltered, subNames, 'category');
  const currentSub = aggregateByGroup(currentFiltered, subNames, 'category', ORDERED_COLOR_ONLY);
  const majorMap = buildCategoryMajorMap(baseFiltered, currentFiltered);

  const baseTotal = aggregateTotal(baseFiltered);
  const currentTotal = aggregateTotal(currentFiltered, ORDERED_COLOR_ONLY);

  const subRows = buildGroupCompare(baseSub, currentSub, subNames).map(row => ({
    ...row,
    majorCategory: majorMap[row.name] ?? '',
  }));
  subRows.sort((a, b) => b.totalAmount.current - a.totalAmount.current);

  return [
    ...subRows,
    { ...buildTotalRow(baseTotal, currentTotal), majorCategory: '' },
  ];
}

const ORDERED_COLOR_ONLY = { orderedColorOnly: true };

const MAJOR_CATEGORY_ORDER = ['外套', '内搭', '下搭', '连衣裙', '配饰'];
const GENDER_ORDER = ['男', '女'];

/** 区域内性别占比 = 该性别订货量 ÷ 区域男女合计 */
export function calcRegionGenderSharePct(region, genderName, regionData) {
  const maleQty = regionData?.男?.[region] ?? 0;
  const femaleQty = regionData?.女?.[region] ?? 0;
  const total = maleQty + femaleQty;
  if (!total) return 0;
  const malePct = calcRegionShare(maleQty, total);
  return genderName === '男' ? malePct : 100 - malePct;
}

function sortByFixedOrder(categories, order) {
  const orderOf = name => {
    const index = order.indexOf(name);
    return index >= 0 ? index : order.length;
  };
  return [...categories].sort((a, b) => {
    const diff = orderOf(a.name) - orderOf(b.name);
    return diff !== 0 ? diff : a.name.localeCompare(b.name, 'zh-CN');
  });
}

function sortMajorCategories(categories) {
  return sortByFixedOrder(categories, MAJOR_CATEGORY_ORDER);
}

function buildGenderCompare(ordersBase, ordersCurrent, regions) {
  const names = GENDER_ORDER.filter(g =>
    ordersBase.some(o => o.gender === g) || ordersCurrent.some(o => o.gender === g),
  );
  if (!names.length) return [];
  return sortByFixedOrder(
    buildQtyCompareByField(ordersBase, ordersCurrent, names, 'gender', regions),
    GENDER_ORDER,
  );
}

function collectRegionNames(ordersBase, ordersCurrent, fallback = []) {
  return [...new Set([
    ...fallback,
    ...ordersBase.map(o => o.region),
    ...ordersCurrent.map(o => o.region),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/** 年度对比 — 左侧大类、右侧中类，KPI 含区域明细 */
export function compareAnnualOrders(ordersBase, ordersCurrent) {
  const [baseYear, currentYear] = CONFIG.compareYears;
  const regions = collectRegionNames(ordersBase, ordersCurrent, CONFIG.regions);

  const baseTotal = aggregateTotal(ordersBase);
  const currentTotal = aggregateTotal(ordersCurrent, ORDERED_COLOR_ONLY);
  const baseByRegion = aggregateByRegion(ordersBase, regions);
  const currentByRegion = aggregateByRegion(ordersCurrent, regions, ORDERED_COLOR_ONLY);

  const majorNames = collectGroupNames(ordersBase, ordersCurrent, 'majorCategory');

  const colorCount = buildMetricWithRegions(
    baseTotal.colorCount, currentTotal.colorCount, baseByRegion, currentByRegion, 'colorCount', regions,
  );
  const totalQty = buildMetricWithRegions(
    baseTotal.totalQty, currentTotal.totalQty, baseByRegion, currentByRegion, 'totalQty', regions,
  );
  const totalAmount = buildMetricWithRegions(
    baseTotal.totalAmount, currentTotal.totalAmount, baseByRegion, currentByRegion, 'totalAmount', regions,
  );

  return {
    baseYear,
    currentYear,
    regions,
    summary: { colorCount, totalQty, totalAmount },
    majorCategories: sortMajorCategories(
      buildMajorCategoryCompare(ordersBase, ordersCurrent, majorNames, regions),
    ),
    genderCompare: buildGenderCompare(ordersBase, ordersCurrent, regions),
    regionCompare: buildRegionCompare(ordersBase, ordersCurrent, regions),
    subCategories: buildSubCategoryCompare(ordersBase, ordersCurrent),
  };
}

export function formatGrowth(rate) {
  if (rate > 0) return { text: `+${rate}%`, cls: 'growth-up' };
  if (rate < 0) return { text: `${rate}%`, cls: 'growth-down' };
  return { text: '0%', cls: 'growth-flat' };
}

export function formatAmount(yuan) {
  return (yuan / 10000).toFixed(1);
}

/** 件单 = 买货额(元) / 进货折扣 / 订货量(件) */
export function calcPieceUnitPrice(amountYuan, qty, purchaseRate = CONFIG.purchaseRate) {
  if (!qty) return null;
  return amountYuan / purchaseRate / qty;
}

export function formatPieceUnitPrice(value) {
  if (value === null || !Number.isFinite(value)) return '—';
  return String(Math.round(value));
}

export function calcRegionShare(value, total) {
  if (!total) return 0;
  return Math.round(value / total * 100);
}

export function formatRegionShareText(row, regionSubtotal, field) {
  if (row.isTotal) return '—';
  if (row.isSubtotal) return '100%';
  const baseShare = calcRegionShare(row[field].base, regionSubtotal[field].base);
  const currentShare = calcRegionShare(row[field].current, regionSubtotal[field].current);
  return `${baseShare}% / ${currentShare}%`;
}

function formatIncreaseExport(base, current) {
  const diff = current - base;
  return diff > 0 ? `+${diff}` : `${diff}`;
}

function buildCompareMetricHeaderRows(baseYear, currentYear) {
  const groupRow = [
    '款色数', '款色数', '款色数',
    '订货量(件)', '订货量(件)', '订货量(件)', '订货量(件)',
    '买货额(万元)', '买货额(万元)', '买货额(万元)', '买货额(万元)',
  ];
  const detailRow = [
    String(baseYear), String(currentYear), '增加数',
    String(baseYear), String(currentYear), '增长率', '占比',
    String(baseYear), String(currentYear), '增长率', '占比',
  ];
  return { groupRow, detailRow };
}

function buildCompareCsvHeaderRows(prefixLabels, baseYear, currentYear) {
  const { groupRow, detailRow } = buildCompareMetricHeaderRows(baseYear, currentYear);
  const emptyPrefix = prefixLabels.map(() => '');
  return [
    [...prefixLabels, ...groupRow],
    [...emptyPrefix, ...detailRow],
  ];
}

function buildRegionExportRow(row, regionSubtotal) {
  return [
    row.region,
    row.gender,
    row.colorCount.base,
    row.colorCount.current,
    formatIncreaseExport(row.colorCount.base, row.colorCount.current),
    row.totalQty.base,
    row.totalQty.current,
    formatGrowth(row.totalQty.growth).text,
    formatRegionShareText(row, regionSubtotal, 'totalQty'),
    formatAmount(row.totalAmount.base),
    formatAmount(row.totalAmount.current),
    formatGrowth(row.totalAmount.growth).text,
    formatRegionShareText(row, regionSubtotal, 'totalAmount'),
  ];
}

export function exportRegionCompareCsv(rows, baseYear, currentYear, escapeCell) {
  const headerRows = buildCompareCsvHeaderRows(['区域', '性别'], baseYear, currentYear);

  const regionOrder = [...new Set(rows.filter(r => !r.isTotal).map(r => r.region))];
  const dataRows = regionOrder.flatMap(region => {
    const genderRows = rows.filter(r => r.region === region && !r.isSubtotal);
    const subtotalRow = rows.find(r => r.region === region && r.isSubtotal);
    return [...genderRows, ...(subtotalRow ? [subtotalRow] : [])]
      .map(row => buildRegionExportRow(row, subtotalRow ?? row));
  });

  const totalRow = rows.find(r => r.isTotal);
  if (totalRow) dataRows.push(buildRegionExportRow(totalRow, totalRow));

  return '\uFEFF' + [...headerRows, ...dataRows].map(r => r.map(escapeCell).join(',')).join('\n');
}

export function formatCategoryShareText(metric, totals, isTotalRow) {
  if (isTotalRow) return '—';
  const baseShare = calcRegionShare(metric.base, totals.base);
  const currentShare = calcRegionShare(metric.current, totals.current);
  return `${baseShare}% / ${currentShare}%`;
}

function formatCategoryShareExport(metric, totals, isTotalRow) {
  return formatCategoryShareText(metric, totals, isTotalRow);
}

function buildSubCategoryExportRow(row, totals) {
  const isTotalRow = row.name === '合计';
  return [
    isTotalRow ? '' : (row.majorCategory ?? ''),
    row.name,
    row.colorCount.base,
    row.colorCount.current,
    formatIncreaseExport(row.colorCount.base, row.colorCount.current),
    row.totalQty.base,
    row.totalQty.current,
    formatGrowth(row.totalQty.growth).text,
    formatCategoryShareExport(row.totalQty, totals.qty, isTotalRow),
    formatAmount(row.totalAmount.base),
    formatAmount(row.totalAmount.current),
    formatGrowth(row.totalAmount.growth).text,
    formatCategoryShareExport(row.totalAmount, totals.amount, isTotalRow),
  ];
}

export function exportSubCategoryCompareCsv(rows, baseYear, currentYear, escapeCell) {
  const totalRow = rows.find(r => r.name === '合计');
  const totals = {
    qty: {
      base: totalRow?.totalQty.base ?? 0,
      current: totalRow?.totalQty.current ?? 0,
    },
    amount: {
      base: totalRow?.totalAmount.base ?? 0,
      current: totalRow?.totalAmount.current ?? 0,
    },
  };
  const headerRows = buildCompareCsvHeaderRows(['大类', '中类'], baseYear, currentYear);
  const dataRows = rows.map(row => buildSubCategoryExportRow(row, totals));
  return '\uFEFF' + [...headerRows, ...dataRows].map(r => r.map(escapeCell).join(',')).join('\n');
}
