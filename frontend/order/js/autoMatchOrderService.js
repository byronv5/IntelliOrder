import { recommendOrder, calcSizeBreakdown, validateOrder } from './recommendService.js';
import { sumOrderSizes } from './dataService.js';

export function isUnplacedOrderRow(row) {
  if (row.orderQty <= 0) return false;
  return sumOrderSizes(row.placedSizeBySize ?? {}) === 0;
}

export function isPlacedOrderRow(row) {
  return sumOrderSizes(row.placedSizeBySize ?? {}) > 0;
}

export function buildMatchedOrder(row) {
  const rec = recommendOrder(row, {});
  const quantity = row.orderQty > 0 ? row.orderQty : rec.quantity;
  const sizes = quantity === rec.quantity
    ? rec.sizes
    : calcSizeBreakdown(quantity, rec.historySizes, rec.sizeTemplate);

  const order = {
    region: row.region,
    styleNo: row.styleNo,
    productNo: row.productNo ?? '',
    subCategory: rec.subCategory,
    gender: rec.gender,
    color: rec.color,
    standardPrice: rec.standardPrice,
    colorSeries: rec.colorSeries,
    fit: rec.fit,
    fabric: row.fabric ?? rec.fabric ?? '',
    quantity,
    sizes,
    sizeTemplate: rec.sizeTemplate,
  };
  validateOrder(order);
  return order;
}

export async function runAutoMatchOrders(records, upsertOrder) {
  const targets = records.filter(isUnplacedOrderRow);
  const result = { total: targets.length, success: 0, failed: [] };

  for (const row of targets) {
    try {
      await upsertOrder(buildMatchedOrder(row));
      result.success += 1;
    } catch (err) {
      result.failed.push({
        region: row.region,
        styleNo: row.styleNo,
        color: row.color,
        message: err.message,
      });
    }
  }

  return result;
}
