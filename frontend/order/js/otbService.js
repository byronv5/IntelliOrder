import { CONFIG } from './config.js';
import { calcGrowthRate } from './compareService.js';
import { num, str, pickField } from './excelLoader.js';

const OTB_ROW_LABEL_FIELDS = ['年份', '年', '季节', 'SS'];
const OTB_AMOUNT_FIELDS = ['买货额', 'OTB', 'OTB买货额', '金额'];
const OTB_WIDE_META_KEYS = new Set(['指标', '标签', '类型', '区域', ...OTB_AMOUNT_FIELDS]);

function isOtbWideFormat(rawRows) {
  if (!rawRows.length) return false;
  return !OTB_ROW_LABEL_FIELDS.some(field => field in rawRows[0]);
}

function parseOtbRowFormat(rawRows) {
  return rawRows
    .map(row => ({
      label: str(pickField(row, ...OTB_ROW_LABEL_FIELDS)),
      amount: num(pickField(row, ...OTB_AMOUNT_FIELDS)),
      region: str(pickField(row, '区域')),
    }))
    .filter(r => r.label && r.amount > 0);
}

function pickOtbWideAmountRow(rawRows) {
  const byMeta = rawRows.find(row => {
    const meta = str(pickField(row, '指标', '标签', '类型'));
    return OTB_AMOUNT_FIELDS.includes(meta);
  });
  return byMeta ?? rawRows[0];
}

/** 宽表：标签取 Excel 表头列名；长表：标签取「年份」等列的单元格值 */
function parseOtbWideFormat(rawRows) {
  const amountRow = pickOtbWideAmountRow(rawRows);
  if (!amountRow) return [];

  return Object.keys(amountRow)
    .filter(key => !OTB_WIDE_META_KEYS.has(key))
    .map(label => ({ label, amount: num(amountRow[label]) }))
    .filter(r => r.amount > 0);
}

/** 解析 OTB 缓存行（列名 / 单元格值均原样使用，不做映射） */
export function parseOtbCacheRows(rawRows) {
  if (!rawRows?.length) return [];
  return isOtbWideFormat(rawRows) ? parseOtbWideFormat(rawRows) : parseOtbRowFormat(rawRows);
}

/** 按 Excel 行序汇总 OTB，并计算相邻行增长率 */
export function buildOtbChartData(rows) {
  const items = rows.filter(r => r.label && r.amount > 0);
  return items.map((row, index) => {
    const prevAmount = index > 0 ? items[index - 1].amount : null;
    const growth = prevAmount != null ? calcGrowthRate(prevAmount, row.amount) : null;
    return { label: row.label, amount: row.amount, growth };
  });
}

function calcCompletionRate(currentAmount, targetAmount) {
  if (!targetAmount) return null;
  return Math.round(currentAmount / targetAmount * 1000) / 10;
}

/** OTB 目标完成率（当前买货额 ÷ OTB 目标 × 100%） */
export function buildOtbCompletion(points, currentAmount, regionAmount = {}) {
  const targetPoint = points.find(p => p.label.includes('目标'));

  return {
    currentAmount,
    regionAmount,
    targetAmount: targetPoint?.amount ?? 0,
    targetLabel: targetPoint?.label ?? '',
    targetRate: calcCompletionRate(currentAmount, targetPoint?.amount ?? 0),
  };
}

export function formatOtbAmountWan(yuan) {
  return (yuan / 10000).toFixed(1);
}

export function getOtbSourceLabel() {
  return `datasource/${CONFIG.otbSourceFile}`;
}
