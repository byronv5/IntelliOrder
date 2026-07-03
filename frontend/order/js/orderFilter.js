import { sumOrderSizes, hasActiveOrderRow, getOrderDisplaySizeTotal } from './dataService.js';

export const ORDER_HEAD_COLUMNS = [
  { key: 'region', label: '区域', filter: true },
  { key: 'brand', label: '品牌', filter: true, compact: true },
  { key: 'image', label: '图片', image: true },
  { key: 'productNo', label: '款号', filter: true },
  { key: 'styleNo', label: '货号', filter: true },
  { key: 'subCategory', label: '中类', filter: true },
  { key: 'gender', label: '性别', filter: true, compact: true },
  { key: 'color', label: '颜色', compact: true },
  { key: 'standardPrice', label: '标准价', num: true, compact: true },
  { key: 'colorSeries', label: '色系', filter: true },
  { key: 'fabric', label: '面料', filter: true },
  { key: 'fit', label: '版型', filter: true },
  { key: 'sizeBandRange', label: '尺码带范围' },
  { key: 'orderQty', label: '订货量', filter: true, num: true },
  { key: 'sizeTotal', label: '尺码合计', filter: true, num: true },
  { key: 'sizeDetail', label: '订货尺码明细' },
  { key: 'action', label: '操作' },
];

const EMPTY_VALUE = '__empty__';

export function getOrderFieldValue(record, key) {
  if (key === 'sizeTotal') return getOrderDisplaySizeTotal(record);
  if (key === 'standardPrice') return record.standardPrice ?? '';
  if (key === 'productNo') return record.productNo ?? '';
  if (key === 'styleNo') return record.styleNo ?? '';
  if (key === 'sizeBandRange') {
    return hasActiveOrderRow(record) ? (record.sizeBandRange ?? '') : '';
  }
  return record[key] ?? '';
}

export function buildOrderFilterOptions(records, key, { num = false } = {}) {
  const raw = records.map(r => getOrderFieldValue(r, key));
  const values = [...new Set(raw.map(v => (v === '' || v == null ? EMPTY_VALUE : String(v))))];
  if (num) {
    values.sort((a, b) => {
      if (a === EMPTY_VALUE) return 1;
      if (b === EMPTY_VALUE) return -1;
      return Number(a) - Number(b);
    });
  } else {
    values.sort((a, b) => {
      if (a === EMPTY_VALUE) return 1;
      if (b === EMPTY_VALUE) return -1;
      return a.localeCompare(b, 'zh-CN');
    });
  }
  return values.map(toFilterOption);
}

function toFilterOption(value) {
  if (value === EMPTY_VALUE) return { value: EMPTY_VALUE, label: '(空)' };
  return { value, label: value };
}

export function filterOrderRecords(records, filters) {
  const active = Object.entries(filters).filter(([, v]) => v);
  if (active.length === 0) return records;
  return records.filter(r =>
    active.every(([key, val]) => {
      const fieldVal = getOrderFieldValue(r, key);
      if (val === EMPTY_VALUE) return fieldVal === '' || fieldVal == null;
      return String(fieldVal) === val;
    }),
  );
}
