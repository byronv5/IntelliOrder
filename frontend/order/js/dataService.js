import { CONFIG } from './config.js';
import { loadExcelFile, loadCatalogFile, loadSizeDetailFile, fetchManifestFiles, loadCachedJson } from './excelLoader.js';
import { parseOtbCacheRows, buildOtbChartData } from './otbService.js';
import { initPicService } from './picService.js';

let historyRows = [];
let baseRows = [];
let currentRows = [];
let currentSizeDetailRows = [];
let otbChartData = [];
let historyRecords = [];
let baseOrders = [];
let currentOrders = [];
let currentOrderRecords = [];
let initialized = false;

function sortSizes(sizes) {
  const letterOrder = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'OS'];
  return [...sizes].sort((a, b) => {
    const ia = letterOrder.indexOf(a);
    const ib = letterOrder.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return parseFloat(a) - parseFloat(b) || a.localeCompare(b, 'zh-CN');
  });
}

function addToSizeMap(map, size, qty) {
  if (!size) return;
  map[size] = (map[size] ?? 0) + qty;
}

function buildHistoryRecords(rows) {
  const map = new Map();

  rows.forEach(r => {
    const key = `${r.year}|${r.season}|${r.region}|${r.styleNo}|${r.color}`;
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        year: r.year,
        season: r.season,
        region: r.region,
        styleNo: r.styleNo,
        subCategory: r.subCategory,
        gender: r.gender,
        color: r.color,
        colorSeries: r.colorSeries,
        fit: r.fit,
        fabric: '',
        majorCategory: r.majorCategory,
        brand: r.brand,
        standardPrice: r.standardPrice,
        totalSales: 0,
        orderQty: 0,
        totalAmount: 0,
        salesBySize: {},
        orderBySize: {},
      });
    }
    const rec = map.get(key);
    rec.fabric = mergeFabric(rec.fabric, r);
    rec.totalSales += r.sales;
    rec.orderQty += r.orderQty;
    rec.totalAmount += r.amount;
    addToSizeMap(rec.salesBySize, r.size, r.sales);
    addToSizeMap(rec.orderBySize, r.size, r.orderQty);
  });

  return [...map.values()];
}

function extractNumericStyleNo(productCode) {
  const code = String(productCode ?? '');
  const match = code.match(/MW0MW(\d+)/i);
  return match ? match[1] : code;
}

/** 当前数据目录无效时，从尺码明细汇总款色目录 */
function buildCatalogFromSizeDetail(rows) {
  const map = new Map();

  rows.forEach(r => {
    const productNo = r.productNo || r.styleNo;
    if (!productNo || !r.color) return;
    const key = `${r.region}|${productNo}|${r.color}`;
    if (!map.has(key)) {
      map.set(key, {
        year: r.year,
        season: r.season,
        region: r.region,
        styleNo: r.styleNo || extractNumericStyleNo(productNo),
        productNo,
        brand: r.brand,
        subCategory: r.subCategory,
        gender: r.gender,
        color: r.color,
        colorSeries: r.colorSeries,
        fit: r.fit,
        fabric: resolveFabric(r),
        function: r.function,
        majorCategory: r.majorCategory,
        standardPrice: r.standardPrice,
        orderQty: r.confirmedOrderQty ?? 0,
      });
      return;
    }
    const rec = map.get(key);
    if (!rec.orderQty && r.confirmedOrderQty) rec.orderQty = r.confirmedOrderQty;
    rec.fabric = mergeFabric(rec.fabric, r);
    if (!rec.fit && r.fit) rec.fit = r.fit;
    if (!rec.subCategory && r.subCategory) rec.subCategory = r.subCategory;
    if (!rec.gender && r.gender) rec.gender = r.gender;
    if (!rec.colorSeries && r.colorSeries) rec.colorSeries = r.colorSeries;
  });

  return [...map.values()].filter(r => r.styleNo && r.color);
}

function buildCurrentOrderRecords(rows) {
  const map = new Map();

  rows.forEach(r => {
    const key = `${r.year}|${r.season}|${r.region}|${r.styleNo}|${r.color}`;
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        year: r.year,
        season: r.season,
        region: r.region,
        styleNo: r.styleNo,
        productNo: r.productNo,
        brand: r.brand,
        subCategory: r.subCategory,
        gender: r.gender,
        color: r.color,
        colorSeries: r.colorSeries,
        fit: r.fit,
        fabric: r.fabric,
        majorCategory: r.majorCategory,
        standardPrice: r.standardPrice,
        orderQty: 0,
      });
    }
    const rec = map.get(key);
    if (!rec.productNo && r.productNo) rec.productNo = r.productNo;
    rec.orderQty += r.orderQty;
  });

  return [...map.values()];
}

function catalogDetailKey(region, skuCode, color) {
  const base = `${skuCode}|${color}`;
  return region ? `${region}|${base}` : base;
}

/** 目录与尺码明细关联键：完整货号 MW0MW…（尺码明细「款号」列） */
function catalogSkuCode(rec) {
  return rec.productNo || rec.styleNo;
}

function resolveFabric(row) {
  const fabric = row?.fabric ?? '';
  if (fabric && fabric !== '-') return fabric;
  const fn = row?.function ?? '';
  return fn && fn !== '-' ? fn : '';
}

function mergeFabric(prev, row) {
  const next = resolveFabric(row);
  if (!next) return prev || '';
  if (!prev || prev === '-') return next;
  return prev;
}

const SIZE_BAND_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXL2', 'OS'];

function expandSizeBandRange(range) {
  if (!range) return [];
  if (range === 'OS') return ['OS'];
  const [start, end] = range.split('-');
  const startIdx = SIZE_BAND_ORDER.indexOf(start);
  const endIdx = SIZE_BAND_ORDER.indexOf(end);
  if (startIdx >= 0 && endIdx >= 0) return SIZE_BAND_ORDER.slice(startIdx, endIdx + 1);
  const startNum = parseFloat(start);
  const endNum = parseFloat(end);
  if (Number.isFinite(startNum) && Number.isFinite(endNum) && startNum <= endNum) {
    const sizes = [];
    for (let i = startNum; i <= endNum; i += 1) sizes.push(String(i));
    return sizes;
  }
  return [];
}

function finalizeSizeDetail(detail) {
  const sizes = { ...detail.sizes };
  const sizeBandRange = detail.sizeBandRange ?? '';
  if (!Object.keys(sizes).length && sizeBandRange) {
    for (const size of expandSizeBandRange(sizeBandRange)) {
      sizes[size] = 0;
    }
  }
  return { sizes, sizeBandRange };
}

function catalogStyleKey(region, skuNo) {
  if (!region || !skuNo) return '';
  return `${region}|style|${skuNo}`;
}

function hasSizeDetailEntry(entry) {
  return Boolean(entry && (Object.keys(entry.sizes).length > 0 || entry.sizeBandRange));
}

function buildSizeDetailMaps(rows) {
  const templateMap = new Map();
  const colorMap = new Map();

  const ensure = (map, key) => {
    if (!key) return null;
    if (!map.has(key)) map.set(key, { sizes: {}, sizeBandRange: '', hasExcelRows: false });
    return map.get(key);
  };

  const registerTemplateSize = (entry, row) => {
    if (!entry) return;
    if (row.sizeBandRange && !entry.sizeBandRange) entry.sizeBandRange = row.sizeBandRange;
    if (row.size && !(row.size in entry.sizes)) entry.sizes[row.size] = 0;
  };

  const addColorQty = (entry, row) => {
    if (!entry || !row.size) return;
    if (row.sizeDetailQty == null) return;
    entry.hasExcelRows = true;
    const qty = row.sizeDetailQty;
    if (!(row.size in entry.sizes)) entry.sizes[row.size] = 0;
    entry.sizes[row.size] += qty;
  };

  rows.forEach(r => {
    const region = r.region || '';
    if (!region) return;

    const styleKeys = [
      r.productNo && catalogStyleKey(region, r.productNo),
      r.styleNo && catalogStyleKey(region, r.styleNo),
    ].filter(Boolean);
    styleKeys.forEach(key => registerTemplateSize(ensure(templateMap, key), r));

    if (!r.color) return;
    const colorKeys = [
      r.productNo && catalogDetailKey(region, r.productNo, r.color),
      catalogDetailKey(region, r.styleNo, r.color),
    ].filter(Boolean);
    colorKeys.forEach(key => addColorQty(ensure(colorMap, key), r));
  });

  return { templateMap, colorMap };
}

/** 区域 + 款号 → 尺码模板（仅结构，数量为 0） */
function lookupSizeTemplate(templateMap, rec) {
  if (!rec.region) return { sizes: {}, sizeBandRange: '' };
  const styleKeys = [
    rec.productNo && catalogStyleKey(rec.region, rec.productNo),
    catalogStyleKey(rec.region, rec.styleNo),
  ].filter(Boolean);
  for (const key of styleKeys) {
    const hit = templateMap.get(key);
    if (hasSizeDetailEntry(hit)) return hit;
  }
  return { sizes: {}, sizeBandRange: '' };
}

/** 区域 + 款号 + 颜色 → Excel 尺码数量（仅该款色在 Excel 中有行时有效） */
function lookupColorSizeDetail(colorMap, rec) {
  const keys = [
    rec.productNo && catalogDetailKey(rec.region, rec.productNo, rec.color),
    catalogDetailKey(rec.region, rec.styleNo, rec.color),
  ].filter(Boolean);
  for (const key of keys) {
    const hit = colorMap.get(key);
    if (hit?.hasExcelRows) return hit;
  }
  return { sizes: {}, sizeBandRange: '', hasExcelRows: false };
}

function mergeTemplateAndColorQty(template, colorDetail, hasExcelDetail) {
  const base = finalizeSizeDetail(template);
  const sizes = Object.fromEntries(Object.keys(base.sizes).map(s => [s, 0]));
  if (hasExcelDetail) {
    Object.entries(colorDetail.sizes).forEach(([size, qty]) => {
      sizes[size] = qty;
    });
  }
  return finalizeSizeDetail({
    sizes,
    sizeBandRange: base.sizeBandRange || colorDetail.sizeBandRange,
  });
}

function buildCatalogMetaMap(...sources) {
  const map = new Map();

  const merge = (key, row) => {
    if (!key) return;
    const prev = map.get(key) ?? {};
    map.set(key, {
      fabric: mergeFabric(prev.fabric, row),
      fit: row.fit || prev.fit || '',
      colorSeries: row.colorSeries || prev.colorSeries || '',
    });
  };

  for (const rows of sources) {
    rows.forEach(r => {
      const region = r.region || '';
      if (!region) return;
      if (r.productNo) merge(catalogStyleKey(region, r.productNo), r);
      if (r.styleNo) merge(catalogStyleKey(region, r.styleNo), r);
    });
  }

  return map;
}

function lookupCatalogMeta(metaMap, rec) {
  if (!rec.region) return {};
  const keys = [
    rec.productNo && catalogStyleKey(rec.region, rec.productNo),
    catalogStyleKey(rec.region, rec.styleNo),
  ].filter(Boolean);
  for (const key of keys) {
    const hit = metaMap.get(key);
    if (hit && (hit.fabric || hit.fit || hit.colorSeries)) return hit;
  }
  return {};
}

function enrichRecordMeta(rec, meta) {
  return {
    ...rec,
    fabric: mergeFabric(rec.fabric, rec) || meta.fabric || '',
    fit: rec.fit || meta.fit || '',
    colorSeries: rec.colorSeries || meta.colorSeries || '',
    gender: rec.gender || '',
    subCategory: rec.subCategory || '',
  };
}

function attachSizeDetails(records, templateMap, colorMap, metaMap) {
  return records.map(rec => {
    const template = lookupSizeTemplate(templateMap, rec);
    const colorDetail = lookupColorSizeDetail(colorMap, rec);
    const detail = mergeTemplateAndColorQty(template, colorDetail, colorDetail.hasExcelRows);
    const sizeTemplateKeys = orderSizeKeysByCurrentDetail(detail.sizes);
    return enrichRecordMeta({
      ...rec,
      sizeBandRange: detail.sizeBandRange,
      sizeDetailBySize: detail.sizes,
      catalogSizeDetailBySize: { ...detail.sizes },
      hasExcelSizeDetail: colorDetail.hasExcelRows,
      sizeTemplateKeys,
    }, lookupCatalogMeta(metaMap, rec));
  });
}

function aggregateHistoryBenchmark(records) {
  const result = { totalSales: 0, orderQty: 0, salesBySize: {}, matchCount: records.length };
  records.forEach(r => {
    result.totalSales += r.totalSales;
    result.orderQty += r.orderQty;
    Object.entries(r.salesBySize).forEach(([size, qty]) => {
      result.salesBySize[size] = (result.salesBySize[size] ?? 0) + qty;
    });
  });
  return result;
}

function buildAnnualOrders(rows) {
  const map = new Map();

  rows.forEach(r => {
    const key = `${r.region}|${r.styleNo}|${r.color}`;
    if (!map.has(key)) {
      map.set(key, {
        id: `order-${r.year}-${key}`,
        year: r.year,
        region: r.region,
        styleNo: r.styleNo,
        subCategory: r.subCategory,
        gender: r.gender,
        color: r.color,
        colorSeries: r.colorSeries,
        fit: r.fit,
        category: r.subCategory,
        majorCategory: r.majorCategory,
        unitPrice: r.standardPrice,
        quantity: 0,
        amount: 0,
        sales: 0,
      });
    }
    const item = map.get(key);
    item.quantity += r.orderQty;
    item.amount += r.amount;
    item.sales += r.sales ?? 0;
  });

  return [...map.values()];
}

function buildSkuStyleOptions(records, region) {
  return records
    .filter(r => !region || r.region === region)
    .map(r => {
      const value = `${r.styleNo}|${r.color}`;
      return {
        value,
        styleNo: r.styleNo,
        productNo: r.productNo,
        color: r.color,
        gender: r.gender,
        subCategory: r.subCategory,
        fit: r.fit,
        colorSeries: r.colorSeries,
        standardPrice: r.standardPrice,
        label: [r.productNo, r.styleNo, r.color, r.gender, r.subCategory, r.fit].filter(Boolean).join(' · '),
        searchText: `${r.productNo} ${r.styleNo} ${r.color} ${r.gender} ${r.subCategory} ${r.fit}`.toLowerCase(),
      };
    });
}

function updateCurrentConfig(rows) {
  CONFIG.currentStyleNos = sortSizes([...new Set(rows.map(r => r.styleNo))].filter(Boolean));
  CONFIG.currentGenders = sortSizes([...new Set(rows.map(r => r.gender))].filter(Boolean));
  CONFIG.currentSubCategories = sortSizes([...new Set(rows.map(r => r.subCategory))].filter(Boolean));
  CONFIG.currentFits = sortSizes([...new Set(rows.map(r => r.fit))].filter(Boolean));
  CONFIG.currentFabrics = sortSizes([...new Set(rows.map(r => resolveFabric(r)))].filter(Boolean));
  CONFIG.currentColorSeries = sortSizes([...new Set(rows.map(r => r.colorSeries))].filter(Boolean));
  CONFIG.currentBrands = sortSizes([...new Set(rows.map(r => r.brand))].filter(Boolean));
}

function inferPrimaryYear(rows, fallbackLabel) {
  const counts = {};
  rows.forEach(r => {
    if (!r.year) return;
    counts[r.year] = (counts[r.year] ?? 0) + 1;
  });
  const entries = Object.entries(counts);
  if (!entries.length) return fallbackLabel;
  entries.sort((a, b) => b[1] - a[1]);
  return Number(entries[0][0]);
}

function updateHistoryConfig(rows) {
  CONFIG.historyStyleNos = sortSizes([...new Set(rows.map(r => r.styleNo))].filter(Boolean));
  CONFIG.historyArticleNos = sortSizes(
    [...new Set(rows.map(r => extractNumericStyleNo(r.styleNo)))].filter(Boolean),
  );
  CONFIG.subCategories = sortSizes([...new Set(rows.map(r => r.subCategory))].filter(Boolean));
  CONFIG.categories = CONFIG.subCategories;
  CONFIG.genders = sortSizes([...new Set(rows.map(r => r.gender))].filter(Boolean));
  CONFIG.years = [...new Set(rows.map(r => r.year))].filter(Boolean).sort((a, b) => a - b);
  CONFIG.seasons = sortSizes([...new Set(rows.map(r => r.season))].filter(Boolean));
  CONFIG.colorSeries = sortSizes([...new Set(rows.map(r => r.colorSeries))].filter(Boolean));
  CONFIG.fits = sortSizes([...new Set(rows.map(r => r.fit))].filter(Boolean));
  CONFIG.fabrics = sortSizes([...new Set(rows.map(r => resolveFabric(r)))].filter(Boolean));
  CONFIG.brands = sortSizes([...new Set(rows.map(r => r.brand))].filter(Boolean));
}

function updateCompareConfig(base, current) {
  const compareRows = [...base, ...current];
  CONFIG.majorCategories = sortSizes([...new Set(compareRows.map(r => r.majorCategory))].filter(Boolean));
  CONFIG.compareYears = [
    inferPrimaryYear(base, '同期'),
    inferPrimaryYear(current, '当前'),
  ];
}

function mergeRegions(...rowSets) {
  CONFIG.regions = sortSizes(
    [...new Set(rowSets.flatMap(rows => rows.map(r => r.region)).filter(Boolean))],
  );
}

function updateSizeConfig(...rowSets) {
  const sizes = rowSets.flatMap(rows => rows.map(r => r.size)).filter(Boolean);
  CONFIG.allSizes = sortSizes([...new Set(sizes)]);
  CONFIG.sizes = CONFIG.allSizes;
}

function assertFileExists(manifestFiles, file) {
  if (!manifestFiles.includes(file)) {
    throw new Error(`未找到数据文件 datasource/${file}，请将文件放入 datasource 目录后重新运行 start.bat`);
  }
}

function assertHasRows(rows, file) {
  if (rows.length === 0) throw new Error(`${file} 中没有有效数据`);
}

/** 初始化：概览同期/当前、历史数据分别来自指定 Excel */
export async function initDataService() {
  if (initialized) return;

  const { historySourceFile, baseSourceFile, currentSourceFile, currentSizeDetailSourceFile } = CONFIG;
  const manifestFiles = await fetchManifestFiles();

  [historySourceFile, baseSourceFile, currentSourceFile, currentSizeDetailSourceFile].forEach(file => {
    assertFileExists(manifestFiles, file);
  });

  [historyRows, baseRows, currentSizeDetailRows] = await Promise.all([
    loadExcelFile(historySourceFile),
    loadExcelFile(baseSourceFile),
    loadSizeDetailFile(currentSizeDetailSourceFile),
  ]);
  currentRows = await loadCatalogFile(currentSourceFile);
  if (currentRows.length === 0) {
    currentRows = buildCatalogFromSizeDetail(currentSizeDetailRows);
  }

  assertHasRows(historyRows, historySourceFile);
  assertHasRows(baseRows, baseSourceFile);
  assertHasRows(currentSizeDetailRows, currentSizeDetailSourceFile);
  if (currentRows.length === 0) {
    throw new Error(`${currentSourceFile} 与 ${currentSizeDetailSourceFile} 均无法生成订货目录，请检查 Excel 格式`);
  }

  updateHistoryConfig(historyRows);
  updateCompareConfig(baseRows, currentRows);
  updateCurrentConfig(currentRows);
  mergeRegions(historyRows, baseRows, currentRows);
  updateSizeConfig(historyRows, baseRows, currentRows, currentSizeDetailRows);

  historyRecords = buildHistoryRecords(historyRows);
  const { templateMap, colorMap } = buildSizeDetailMaps(currentSizeDetailRows);
  const catalogMetaMap = buildCatalogMetaMap(currentSizeDetailRows, currentRows);
  currentOrderRecords = attachSizeDetails(buildCurrentOrderRecords(currentRows), templateMap, colorMap, catalogMetaMap);
  baseOrders = buildAnnualOrders(baseRows);
  currentOrders = buildAnnualOrders(currentRows);
  otbChartData = await loadOtbChartData(manifestFiles);
  await initPicService();
  initialized = true;
}

async function loadOtbChartData(manifestFiles) {
  const { otbSourceFile } = CONFIG;
  if (!manifestFiles.includes(otbSourceFile)) return [];
  const rows = parseOtbCacheRows(await loadCachedJson(otbSourceFile));
  return buildOtbChartData(rows);
}

export function getOtbChartData() {
  return otbChartData;
}

/** 强制重新读取 datasource 下全部 Excel */
export async function reloadDataService() {
  initialized = false;
  await initDataService();
}

/** 重新读取历年历史数据（智能推荐基准） */
export async function reloadHistoryData() {
  const file = CONFIG.historySourceFile;
  historyRows = await loadExcelFile(file);
  assertHasRows(historyRows, file);
  updateHistoryConfig(historyRows);
  mergeRegions(historyRows, baseRows, currentRows);
  updateSizeConfig(historyRows, baseRows, currentRows);
  historyRecords = buildHistoryRecords(historyRows);
}

export function getHistoryRecommendOptions() {
  return {
    styleNos: CONFIG.historyStyleNos,
    articleNos: CONFIG.historyArticleNos,
    genders: CONFIG.genders,
    subCategories: CONFIG.subCategories,
    fits: CONFIG.fits,
    colorSeries: CONFIG.colorSeries,
    fabrics: CONFIG.fabrics,
  };
}

export function isDataReady() {
  return initialized;
}

export function getHistorySourceFile() {
  return CONFIG.historySourceFile;
}

export function getBaseSourceFile() {
  return CONFIG.baseSourceFile;
}

export function getCurrentSourceFile() {
  return CONFIG.currentSourceFile;
}

export function getCurrentSizeDetailSourceFile() {
  return CONFIG.currentSizeDetailSourceFile;
}

function sourcePath(configKey) {
  return `datasource/${CONFIG[configKey]}`;
}

export function getOverviewSourceHint() {
  return `同期 ${sourcePath('baseSourceFile')} · 当前 ${sourcePath('currentSourceFile')}`;
}

export function getHistorySourceHint() {
  return `数据源 ${sourcePath('historySourceFile')}`;
}

export function getCreateCatalogSourceHint() {
  return `商品/款号/订货量 ${sourcePath('currentSourceFile')}`;
}

export function getCreateRecommendSourceHint() {
  return `智能推荐 ${sourcePath('historySourceFile')} · 匹配：款号→货号→精确→放宽 · 订货量：款号/货号/区域性别中类 分档÷75%`;
}

export function getOrdersSourceHint() {
  return `商品/订货量 ${sourcePath('currentSourceFile')} · 尺码 ${sourcePath('currentSizeDetailSourceFile')} · 订货 SQLite data/orders.db`;
}

export function getHistoricalData() {
  return historyRecords;
}

export async function fetchHistoricalData(filters = {}) {
  if (!initialized) await initDataService();
  let data = [...historyRecords];

  if (filters.region) data = data.filter(r => r.region === filters.region);
  if (filters.brand) data = data.filter(r => r.brand === filters.brand);
  if (filters.year) data = data.filter(r => r.year === Number(filters.year));
  if (filters.season) data = data.filter(r => r.season === filters.season);
  if (filters.styleNo) data = data.filter(r => r.styleNo.includes(filters.styleNo));
  if (filters.subCategory) data = data.filter(r => r.subCategory === filters.subCategory);
  if (filters.gender) data = data.filter(r => r.gender === filters.gender);
  if (filters.colorSeries) data = data.filter(r => r.colorSeries === filters.colorSeries);
  if (filters.fit) data = data.filter(r => r.fit === filters.fit);
  if (filters.fabric) data = data.filter(r => resolveFabric(r) === filters.fabric);
  if (filters.color) data = data.filter(r => r.color.includes(filters.color));

  return data.sort((a, b) => b.totalSales - a.totalSales);
}

export function getStyleOptions(region) {
  return buildSkuStyleOptions(currentOrderRecords, region);
}

export function parseSkuKey(key) {
  const sep = key.indexOf('|');
  if (sep < 0) return { styleNo: key, color: '' };
  return { styleNo: key.slice(0, sep), color: key.slice(sep + 1) };
}

export async function fetchCurrentOrderList() {
  if (!initialized) await initDataService();
  return [...currentOrderRecords].sort((a, b) => b.orderQty - a.orderQty);
}

export function getProductNoOptions(filters = {}) {
  let data = currentOrderRecords;
  if (filters.region) data = data.filter(r => r.region === filters.region);
  if (filters.styleNo) data = data.filter(r => r.styleNo === filters.styleNo);
  if (filters.color) data = data.filter(r => r.color === filters.color);
  return [...new Set(data.map(r => r.productNo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/** 货号候选（数字款号） */
export function getStyleNoOptions(filters = {}) {
  let data = currentOrderRecords;
  if (filters.region) data = data.filter(r => r.region === filters.region);
  if (filters.productNo) data = data.filter(r => r.productNo === filters.productNo);
  if (filters.color) data = data.filter(r => r.color === filters.color);
  return [...new Set(data.map(r => r.styleNo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
}

export function getCurrentOrderSummary(records) {
  const totalQty = records.reduce((s, r) => s + r.orderQty, 0);
  const tagAmount = records.reduce((s, r) => s + r.orderQty * (r.standardPrice ?? 0), 0);
  const purchaseAmount = tagAmount * CONFIG.purchaseRate;
  const providedCount = records.length;
  const orderedStyleCount = records.filter(r => r.orderQty > 0).length;
  const placedStyleCount = records.filter(r => getOrderDisplaySizeTotal(r) > 0).length;
  const unplacedStyleCount = records.filter(
    r => r.orderQty > 0 && getOrderDisplaySizeTotal(r) === 0,
  ).length;
  const orderedQty = totalQty;
  const placedQty = records.reduce((s, r) => s + getOrderDisplaySizeTotal(r), 0);
  const unplacedQty = records.reduce(
    (s, r) => s + Math.max(0, r.orderQty - getOrderDisplaySizeTotal(r)),
    0,
  );
  return {
    providedCount,
    orderedStyleCount,
    placedStyleCount,
    unplacedStyleCount,
    orderedQty,
    placedQty,
    unplacedQty,
    orderCount: providedCount,
    totalQty,
    tagAmount,
    purchaseAmount,
  };
}

export function sumOrderSizes(orderBySize) {
  return Object.values(orderBySize ?? {}).reduce((a, b) => a + b, 0);
}

function escapeCsvCell(val) {
  const s = String(val ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export { escapeCsvCell };

export function exportCurrentOrdersCsv(records) {
  const baseHeaders = [
    '区域', '品牌', '款号', '货号', '中类', '性别', '颜色', '标准价', '色系', '面料', '版型',
    '尺码带范围', '订货量', '尺码合计',
  ];
  const headers = [...baseHeaders, '尺码名称', '尺码订货数量'];
  const rows = [];

  for (const r of records) {
    const hasOrder = hasActiveOrderRow(r);
    const sizeTotal = hasOrder ? getOrderDisplaySizeTotal(r) : 0;
    const base = [
      r.region,
      r.brand ?? '',
      r.productNo ?? '',
      r.styleNo,
      r.subCategory,
      r.gender,
      r.color,
      r.standardPrice,
      r.colorSeries,
      r.fabric ?? '',
      r.fit,
      hasOrder ? (r.sizeBandRange ?? '') : '',
      r.orderQty,
      sizeTotal || '',
    ];
    if (!hasOrder) {
      rows.push([...base, '', '']);
      continue;
    }
    const templateKeys = r.sizeTemplateKeys?.length
      ? r.sizeTemplateKeys
      : getCatalogSizeTemplate(r).templateKeys;
    if (!templateKeys.length) {
      rows.push([...base, '', '']);
      continue;
    }
    const source = getPlacedSizeTotal(r) > 0
      ? (r.placedSizeBySize ?? {})
      : (r.catalogSizeDetailBySize ?? {});
    for (const size of templateKeys) {
      rows.push([...base, size, source[size] ?? 0]);
    }
  }

  return '\uFEFF' + [headers, ...rows].map(row => row.map(escapeCsvCell).join(',')).join('\n');
}

export async function fetchCompareOrders() {
  if (!initialized) await initDataService();
  return { base: baseOrders, current: currentOrders };
}

export function getColorsByStyle(styleNo, region) {
  const records = currentOrderRecords.filter(r =>
    r.styleNo === styleNo && (!region || r.region === region),
  );
  const colorMap = new Map();
  records.forEach(r => {
    if (!colorMap.has(r.color)) {
      colorMap.set(r.color, { value: r.color, label: r.color, colorSeries: r.colorSeries });
    }
  });
  return [...colorMap.values()];
}

export function getCurrentItemByStyleColor(styleNo, color, region) {
  return currentOrderRecords.find(r =>
    r.styleNo === styleNo && r.color === color && r.region === region,
  ) ?? null;
}

/** 按条件筛选历年历史款色记录 */
function filterHistoryRecords(criteria) {
  return historyRecords.filter(r => {
    if (criteria.region && r.region !== criteria.region) return false;
    if (criteria.gender && r.gender !== criteria.gender) return false;
    if (criteria.subCategory && r.subCategory !== criteria.subCategory) return false;
    if (criteria.fit && r.fit !== criteria.fit) return false;
    if (criteria.styleNo && r.styleNo !== criteria.styleNo) return false;
    if (criteria.articleNo && extractNumericStyleNo(r.styleNo) !== String(criteria.articleNo)) return false;
    if (criteria.colorSeries && r.colorSeries !== criteria.colorSeries) return false;
    if (criteria.fabric && r.fabric !== criteria.fabric) return false;
    return true;
  });
}

/** 按条件匹配历年历史；未传字段表示不限制 */
export function findHistoryBenchmark(criteria) {
  const matched = filterHistoryRecords(criteria);
  if (!matched.length) return null;
  return aggregateHistoryBenchmark(matched);
}

const MATCH_TIER_LABELS = {
  'by-styleNo': '款号匹配',
  'by-articleNo': '货号匹配',
  exact: '精确匹配',
  'no-fit': '放宽版型',
  'no-subCategory': '放宽中类',
  'no-fit-subCategory': '放宽版型与中类',
};

const QTY_BASIS_LABELS = {
  'by-styleNo': '该款销量',
  'by-articleNo': '货号最大销量',
  exact: '区域+性别+中类最大销量',
  'no-fit': '区域+性别+中类最大销量',
  'no-subCategory': '区域+性别+中类最大销量',
  'no-fit-subCategory': '区域+性别+中类最大销量',
};

function salesToSuggestedQty(sales) {
  if (sales <= 0) return 1;
  return Math.max(1, Math.round(sales / CONFIG.salesToOrderRatio));
}

function buildHistoryMatchAttempts(criteria, item) {
  const optional = {};
  if (criteria.styleNo) optional.styleNo = criteria.styleNo;
  if (criteria.articleNo) optional.articleNo = criteria.articleNo;
  if (criteria.colorSeries) optional.colorSeries = criteria.colorSeries;
  if (criteria.fabric) optional.fabric = criteria.fabric;

  const mwStyleNo = criteria.styleNo || item?.productNo || '';
  const numericArticleNo = criteria.articleNo || item?.styleNo || '';

  const attempts = [];
  if (mwStyleNo) {
    attempts.push({ tier: 'by-styleNo', match: { region: criteria.region, styleNo: mwStyleNo } });
  }
  if (numericArticleNo) {
    attempts.push({
      tier: 'by-articleNo',
      match: { region: criteria.region, articleNo: String(numericArticleNo) },
    });
  }
  attempts.push({ tier: 'exact', match: { ...criteria } });
  attempts.push({
    tier: 'no-fit',
    match: { region: criteria.region, gender: criteria.gender, subCategory: criteria.subCategory, ...optional },
  });
  attempts.push({
    tier: 'no-subCategory',
    match: { region: criteria.region, gender: criteria.gender, fit: criteria.fit, ...optional },
  });
  attempts.push({
    tier: 'no-fit-subCategory',
    match: { region: criteria.region, gender: criteria.gender, ...optional },
  });
  return attempts;
}

/** 区域+性别+中类 历年单款色销量最大值 */
export function getMaxSalesByRegionGenderSub(item, overrides = {}) {
  const region = item.region;
  const gender = overrides.gender || item.gender;
  const subCategory = overrides.subCategory || item.subCategory;
  if (!region || !gender || !subCategory) return 0;
  return historyRecords
    .filter(r => r.region === region && r.gender === gender && r.subCategory === subCategory)
    .reduce((max, r) => Math.max(max, r.totalSales), 0);
}

/** 按匹配层级计算推荐订货量基准销量 */
export function calcSuggestedQtyByMatchTier(tier, matchedRecords, item, overrides = {}) {
  if (tier === 'by-styleNo') {
    const sameColor = matchedRecords.filter(r => r.color === item.color);
    const pool = sameColor.length ? sameColor : matchedRecords;
    const sales = pool.reduce((sum, r) => sum + r.totalSales, 0);
    return { sales, qty: salesToSuggestedQty(sales), basisLabel: QTY_BASIS_LABELS[tier] };
  }
  if (tier === 'by-articleNo') {
    const sales = matchedRecords.reduce((max, r) => Math.max(max, r.totalSales), 0);
    return { sales, qty: salesToSuggestedQty(sales), basisLabel: QTY_BASIS_LABELS[tier] };
  }
  const sales = getMaxSalesByRegionGenderSub(item, overrides);
  return { sales, qty: salesToSuggestedQty(sales), basisLabel: QTY_BASIS_LABELS[tier] ?? QTY_BASIS_LABELS.exact };
}

/** 按款号→货号→精确→放宽顺序匹配历年历史基准 */
export function findHistoryBenchmarkWithFallback(criteria, item = {}) {
  for (const { tier, match } of buildHistoryMatchAttempts(criteria, item)) {
    const matchedRecords = filterHistoryRecords(match);
    if (!matchedRecords.length) continue;
    const benchmark = aggregateHistoryBenchmark(matchedRecords);
    const isRelaxed = !['by-styleNo', 'by-articleNo', 'exact'].includes(tier);
    return {
      benchmark,
      matchedRecords,
      matchCriteria: match,
      matchTier: tier,
      relaxed: isRelaxed,
      relaxedLabel: MATCH_TIER_LABELS[tier],
    };
  }
  return null;
}

export function getHistoryByStyleColor(styleNo, color, region) {
  return historyRecords.find(r =>
    r.styleNo === styleNo && r.color === color && r.region === region,
  ) ?? null;
}

export function getSummaryStats(records) {
  const totalSales = records.reduce((s, r) => s + r.totalSales, 0);
  const colorCount = new Set(records.map(r => `${r.styleNo}-${r.color}`)).size;

  const bySeries = {};
  records.forEach(r => {
    bySeries[r.colorSeries] = (bySeries[r.colorSeries] ?? 0) + r.totalSales;
  });

  return {
    totalSales,
    styleCount: new Set(records.map(r => r.styleNo)).size,
    colorCount,
    bySeries,
    recordCount: records.length,
  };
}

export function getHistorySizeOrder() {
  return sortSizes([...new Set(historyRows.map(r => r.size))].filter(Boolean));
}

export function getCurrentSizeDetailOrder() {
  const seen = new Set();
  const order = [];
  for (const row of currentSizeDetailRows) {
    const size = row.size;
    if (!size || seen.has(size)) continue;
    seen.add(size);
    order.push(size);
  }
  return order;
}

/** 按历史数据尺码顺序排列（新建订货尺码编辑） */
export function orderSizeKeys(sizeMap) {
  const keys = Object.keys(sizeMap ?? {});
  if (!keys.length) return [];
  const historyOrder = getHistorySizeOrder();
  const ordered = historyOrder.filter(s => keys.includes(s));
  const extra = sortSizes(keys.filter(k => !historyOrder.includes(k)));
  return [...ordered, ...extra];
}

/** 款色尺码模板（区域+款号匹配，与新建订货一致） */
export function getCatalogSizeTemplate(record) {
  const detail = finalizeSizeDetail({
    sizes: { ...(record?.sizeDetailBySize ?? {}) },
    sizeBandRange: record?.sizeBandRange ?? '',
  });
  const templateKeys = record?.sizeTemplateKeys?.length
    ? record.sizeTemplateKeys
    : orderSizeKeysByCurrentDetail(detail.sizes);
  return {
    sizes: detail.sizes,
    sizeBandRange: detail.sizeBandRange,
    templateKeys,
  };
}

export function orderCatalogSizeKeys(recordOrSizeMap) {
  if (recordOrSizeMap?.sizeTemplateKeys?.length) {
    return recordOrSizeMap.sizeTemplateKeys;
  }
  if (recordOrSizeMap?.sizeDetailBySize) {
    return getCatalogSizeTemplate(recordOrSizeMap).templateKeys;
  }
  return orderSizeKeysByCurrentDetail(recordOrSizeMap ?? {});
}

function orderSizeKeysByCurrentDetail(sizeMap) {
  const keys = Object.keys(sizeMap ?? {});
  if (!keys.length) return [];
  const detailOrder = getCurrentSizeDetailOrder();
  const ordered = detailOrder.filter(s => keys.includes(s));
  const extra = sortSizes(keys.filter(k => !detailOrder.includes(k)));
  return [...ordered, ...extra];
}

export function hasSizeDetailData(sizeMap) {
  return Object.keys(sizeMap ?? {}).length > 0;
}

export function hasSizeDetailMeta(record) {
  return Boolean(record?.sizeBandRange) || hasSizeDetailData(record?.sizeDetailBySize);
}

/** 订货单是否应展示尺码（有订货量或已写入本地下单尺码） */
export function hasActiveOrderRow(record, placedSizeBySize = null) {
  const placed = placedSizeBySize ?? record?.placedSizeBySize ?? {};
  const placedTotal = sumOrderSizes(placed);
  return (record?.orderQty ?? 0) > 0 || placedTotal > 0;
}

export function getOrderDisplaySizeTotal(record, placedSizeBySize = null) {
  const placed = placedSizeBySize ?? record?.placedSizeBySize ?? {};
  const placedTotal = sumOrderSizes(placed);
  if (placedTotal > 0) return placedTotal;
  if ((record?.orderQty ?? 0) > 0 && record?.hasExcelSizeDetail) {
    return sumOrderSizes(record.catalogSizeDetailBySize ?? {});
  }
  return 0;
}

/** 本地下单尺码合计 */
export function getPlacedSizeTotal(record) {
  return sumOrderSizes(record?.placedSizeBySize ?? {});
}

/** Excel 尺码明细合计（仅该款色在 Excel 中有明细行时累计） */
export function getCatalogSizeTotal(record) {
  if (!record?.hasExcelSizeDetail) return 0;
  return sumOrderSizes(record.catalogSizeDetailBySize ?? {});
}

/**
 * 订货量与尺码合计不一致时的类型
 * - placed：有本地下单，标红
 * - catalog：无本地下单，用 Excel 明细，标绿
 */
export function getOrderSizeMismatchKind(record) {
  if (!hasActiveOrderRow(record)) return null;
  const orderQty = record.orderQty ?? 0;
  if (orderQty <= 0) return null;

  const placedTotal = getPlacedSizeTotal(record);
  if (placedTotal > 0) {
    return placedTotal !== orderQty ? 'placed' : null;
  }
  return getCatalogSizeTotal(record) !== orderQty ? 'catalog' : null;
}

export function formatOrderSizeDetail(pageSizes, sizeTemplate = null) {
  const ordered = sizeTemplate?.length
    ? sizeTemplate
    : orderSizeKeysByCurrentDetail(pageSizes);
  if (!ordered.length) return '';
  return ordered.map(s => `${s}:${pageSizes[s] ?? 0}`).join(' ');
}

/** 订货列表尺码明细：按模板展示全部尺码，本地优先，无则 Excel，无数量显示 0 */
export function buildOrderListSizeDetail(record) {
  const templateKeys = record?.sizeTemplateKeys?.length
    ? record.sizeTemplateKeys
    : getCatalogSizeTemplate(record).templateKeys;
  if (!templateKeys.length) return '';

  const sizes = Object.fromEntries(templateKeys.map(s => [s, 0]));
  const source = getPlacedSizeTotal(record) > 0
    ? (record.placedSizeBySize ?? {})
    : (record.catalogSizeDetailBySize ?? {});

  templateKeys.forEach(s => {
    sizes[s] = source[s] ?? 0;
  });
  return formatOrderSizeDetail(sizes, templateKeys);
}

export function getAllSizes() {
  return CONFIG.allSizes ?? CONFIG.sizes;
}
