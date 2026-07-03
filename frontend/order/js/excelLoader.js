const DATASOURCE_BASE = './datasource/';
const CACHE_BASE = './datasource/cache/';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v) {
  return v == null ? '' : String(v).trim();
}

function pickField(row, ...keys) {
  for (const key of keys) {
    const value = row[key];
    if (value != null && String(value).trim() !== '') return value;
  }
  return '';
}

export { num, str, pickField };

/** 解析 Excel 行 → 标准记录（兼容新旧列名） */
export function normalizeRow(row) {
  return {
    majorCategory: str(pickField(row, '大类')),
    region: str(pickField(row, '区域')),
    brand: str(pickField(row, '品牌')),
    year: num(pickField(row, '年份')),
    season: str(pickField(row, '季节')),
    gender: str(pickField(row, '性别')),
    subCategory: str(pickField(row, '中类')),
    styleNo: str(pickField(row, '款号')),
    productNo: str(pickField(row, '货号')),
    color: str(pickField(row, '颜色')),
    standardPrice: num(pickField(row, '标准价')),
    sku: num(pickField(row, 'SKU')),
    fit: str(pickField(row, '版型')),
    fabric: str(pickField(row, '面料')),
    function: str(pickField(row, '功能')),
    colorSeries: str(pickField(row, '色系')),
    orderSeason: str(pickField(row, '订货会季节')),
    size: str(pickField(row, '尺码')),
    sizeBandRange: str(pickField(row, '尺码带范围', '尺码范围')),
    orderQty: num(pickField(row, '订货量', '确认下单量', 'QTY综合')),
    sales: num(pickField(row, '销量', 'SUM销量')),
    inventory: num(pickField(row, '库存')),
    amount: num(pickField(row, '买货额')),
    productAttr: str(pickField(row, '商品属性')),
  };
}

/** 当前数据目录行（款色级；Excel「货号」= 数字款号，「款号」= 完整货号） */
export function normalizeCatalogRow(row) {
  return {
    ...normalizeRow(row),
    styleNo: str(pickField(row, '货号')),
    productNo: str(pickField(row, '款号')),
    size: '',
  };
}

function pickSizeDetailQty(row) {
  for (const key of ['订货尺码明细', '尺码订货数量', '尺码数量']) {
    if (!(key in row)) continue;
    const value = row[key];
    if (value == null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    return num(value);
  }
  return null;
}

/** 解析尺码明细 Excel（款号/货号语义与当前数据目录一致） */
export function normalizeSizeDetailRow(row) {
  const base = normalizeRow(row);
  const sizeDetailQty = pickSizeDetailQty(row);
  return {
    ...base,
    styleNo: str(pickField(row, '货号')),
    productNo: str(pickField(row, '款号')),
    sizeDetailQty,
    orderQty: sizeDetailQty ?? 0,
    confirmedOrderQty: num(pickField(row, '确认下单量')),
  };
}

function sheetToSizeDetailRows(rawRows) {
  return rawRows
    .map(normalizeSizeDetailRow)
    .filter(r => r.styleNo && (r.size || r.sizeBandRange));
}

function sheetToSizeRows(rawRows, normalize = normalizeRow) {
  return rawRows.map(normalize).filter(r => r.styleNo && r.size);
}

function sheetToCatalogRows(rawRows) {
  return rawRows.map(normalizeCatalogRow).filter(r => r.styleNo && r.color);
}

function cacheFileName(excelFile) {
  return `${excelFile.replace(/\.xlsx$/i, '')}.json`;
}

async function readCachedJson(file) {
  const cacheFile = cacheFileName(file);
  const res = await fetch(`${CACHE_BASE}${encodeURIComponent(cacheFile)}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`无法加载 ${file} 的数据缓存，请重新运行 start.bat`);
  }
  return res.json();
}

export async function loadCachedJson(file) {
  return readCachedJson(file);
}

/** 加载通用 Excel 缓存（自定义解析） */
export async function loadCustomCachedFile(file, normalize, validate = () => true) {
  const rawRows = await readCachedJson(file);
  return rawRows.map(normalize).filter(validate);
}

export async function fetchManifestFiles() {
  const manifestRes = await fetch(`${DATASOURCE_BASE}manifest.json`, { cache: 'no-store' });
  if (!manifestRes.ok) {
    throw new Error('未找到 datasource/manifest.json，请先运行 start.bat');
  }
  const files = await manifestRes.json();
  if (files.length === 0) throw new Error('datasource 目录下没有 Excel 文件');
  return files;
}

async function readCachedRows(file, { normalize = normalizeRow, filterRows } = {}) {
  const rawRows = await readCachedJson(file);
  const rows = filterRows
    ? filterRows(rawRows)
    : sheetToSizeRows(rawRows, normalize);
  rows.forEach(r => { r.sourceFile = file; });
  return rows;
}

/** 加载指定 Excel 文件（尺码明细行） */
export async function loadExcelFile(file) {
  return readCachedRows(file);
}

/** 加载当前数据目录（款色级，不要求尺码列） */
export async function loadCatalogFile(file) {
  return readCachedRows(file, { filterRows: sheetToCatalogRows });
}

/** 加载尺码明细 Excel */
export async function loadSizeDetailFile(file) {
  return readCachedRows(file, {
    normalize: normalizeSizeDetailRow,
    filterRows: sheetToSizeDetailRows,
  });
}

/** 加载多个 Excel 文件 */
export async function loadExcelFiles(files) {
  const allRows = [];
  for (const file of files) {
    allRows.push(...await readCachedRows(file));
  }
  return allRows;
}

/** 加载 manifest 中全部 Excel */
export async function loadAllExcelFiles() {
  return loadExcelFiles(await fetchManifestFiles());
}

export function parseFileMeta(filename) {
  const base = filename.replace(/\.xlsx$/i, '');
  const m = base.match(/^(\d{4})(.+)$/);
  if (!m) return { year: null, season: base, fileName: filename };
  return { year: parseInt(m[1], 10), season: m[2], fileName: filename };
}
