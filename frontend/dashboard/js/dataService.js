/** 大屏配置 */
export const CONFIG = {
  refreshInterval: 30000,
  completionThreshold: {
    qualified: 100,
    warning: 80,
  },
  currencyUnit: '万元',
};

/** 模拟店铺数据 — 对接 API 时替换 fetchStoreData */
export function generateMockStores() {
  const names = [
    '旗舰店·北京', '旗舰店·上海', '标准店·广州', '标准店·深圳',
    '社区店·杭州', '社区店·成都', '社区店·武汉', '社区店·西安',
    '社区店·南京', '社区店·重庆', '社区店·天津', '社区店·苏州',
  ];

  return names.map((name, i) => {
    const target = 80 + Math.floor(Math.random() * 120);
    const lastYear = 60 + Math.floor(Math.random() * 100);
    const completion = 0.65 + Math.random() * 0.55;
    const sales = Math.round(target * completion);
    const yoy = ((sales - lastYear) / lastYear * 100);

    return {
      id: `store-${i + 1}`,
      name,
      sales,
      target,
      lastYearSales: lastYear,
      completionRate: Math.round(completion * 1000) / 10,
      yoyRate: Math.round(yoy * 10) / 10,
    };
  });
}

/** 数据服务 — 统一入口，便于后续接真实 API */
export async function fetchStoreData() {
  await delay(300);
  const stores = generateMockStores();
  return aggregateDashboardData(stores);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function aggregateDashboardData(stores) {
  const totalSales = stores.reduce((s, st) => s + st.sales, 0);
  const totalTarget = stores.reduce((s, st) => s + st.target, 0);
  const lastYearSales = stores.reduce((s, st) => s + st.lastYearSales, 0);
  const overallCompletion = totalTarget > 0
    ? Math.round(totalSales / totalTarget * 1000) / 10
    : 0;
  const yoyGrowth = lastYearSales > 0
    ? Math.round((totalSales - lastYearSales) / lastYearSales * 1000) / 10
    : 0;
  const qualifiedCount = stores.filter(s => s.completionRate >= 100).length;

  const sorted = [...stores].sort((a, b) => b.sales - a.sales);

  return {
    summary: {
      totalSales,
      totalTarget,
      overallCompletion,
      yoyGrowth,
      lastYearSales,
      storeCount: stores.length,
      qualifiedCount,
    },
    stores: sorted,
    updatedAt: new Date(),
  };
}

export function getCompletionStatus(rate, threshold = CONFIG.completionThreshold) {
  if (rate >= threshold.qualified) return { label: '已达标', cls: 'status-qualified' };
  if (rate >= threshold.warning) return { label: '接近达标', cls: 'status-warning' };
  return { label: '未达标', cls: 'status-danger' };
}

export function getRateBarClass(rate) {
  if (rate >= 100) return 'rate-high';
  if (rate >= 80) return 'rate-mid';
  return 'rate-low';
}

export function formatYoy(rate) {
  if (rate > 0) return { text: `+${rate}%`, cls: 'yoy-up' };
  if (rate < 0) return { text: `${rate}%`, cls: 'yoy-down' };
  return { text: '0%', cls: 'yoy-flat' };
}
