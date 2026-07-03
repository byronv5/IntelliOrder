const CHART_THEME = {
  text: '#7eb8d8',
  axis: 'rgba(0, 180, 255, 0.2)',
  splitLine: 'rgba(0, 180, 255, 0.08)',
  colors: ['#00d4ff', '#00e676', '#ffb300', '#ff5252', '#7c4dff', '#18ffff'],
};

function baseGrid() {
  return { left: 60, right: 20, top: 36, bottom: 24, containLabel: true };
}

/** 店铺业绩横向柱状图 */
export function renderPerformanceChart(container, stores) {
  const chart = echarts.init(container);
  const top10 = stores.slice(0, 10).reverse();

  chart.setOption({
    grid: { ...baseGrid(), left: 100 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter(params) {
        const p = params[0];
        const store = top10[p.dataIndex];
        return `${store.name}<br/>业绩: ${store.sales}万 / 目标: ${store.target}万<br/>完成率: ${store.completionRate}%`;
      },
    },
    xAxis: {
      type: 'value',
      axisLabel: { color: CHART_THEME.text, formatter: '{value}万' },
      splitLine: { lineStyle: { color: CHART_THEME.splitLine } },
    },
    yAxis: {
      type: 'category',
      data: top10.map(s => s.name),
      axisLabel: { color: CHART_THEME.text, fontSize: 11 },
      axisLine: { lineStyle: { color: CHART_THEME.axis } },
    },
    series: [
      {
        name: '目标',
        type: 'bar',
        data: top10.map(s => s.target),
        barGap: '-100%',
        itemStyle: { color: 'rgba(0, 180, 255, 0.15)', borderRadius: [0, 4, 4, 0] },
        barWidth: 14,
        z: 1,
      },
      {
        name: '业绩',
        type: 'bar',
        data: top10.map(s => ({
          value: s.sales,
          itemStyle: {
            color: s.completionRate >= 100
              ? CHART_THEME.colors[1]
              : s.completionRate >= 80
                ? CHART_THEME.colors[2]
                : CHART_THEME.colors[3],
            borderRadius: [0, 4, 4, 0],
          },
        })),
        barWidth: 14,
        z: 2,
      },
    ],
  });

  return chart;
}

/** 完成率环形图 */
export function renderCompletionChart(container, stores) {
  const chart = echarts.init(container);

  const ranges = [
    { name: '达标 ≥100%', min: 100, max: Infinity, color: CHART_THEME.colors[1] },
    { name: '接近 80-99%', min: 80, max: 99.9, color: CHART_THEME.colors[2] },
    { name: '未达标 <80%', min: 0, max: 79.9, color: CHART_THEME.colors[3] },
  ];

  const data = ranges.map(r => ({
    name: r.name,
    value: stores.filter(s => s.completionRate >= r.min && s.completionRate <= r.max).length,
    itemStyle: { color: r.color },
  }));

  chart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c}家 ({d}%)' },
    legend: {
      orient: 'vertical',
      right: 10,
      top: 'center',
      textStyle: { color: CHART_THEME.text, fontSize: 11 },
    },
    series: [{
      type: 'pie',
      radius: ['42%', '68%'],
      center: ['38%', '50%'],
      label: { show: false },
      data,
      emphasis: {
        itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0, 212, 255, 0.4)' },
      },
    }],
  });

  return chart;
}

/** 去年同期对比折柱混合图 */
export function renderYoyChart(container, stores) {
  const chart = echarts.init(container);
  const top8 = stores.slice(0, 8);

  chart.setOption({
    grid: baseGrid(),
    tooltip: { trigger: 'axis' },
    legend: {
      data: ['今年业绩', '去年同期', '同比增长'],
      textStyle: { color: CHART_THEME.text, fontSize: 11 },
      top: 0,
    },
    xAxis: {
      type: 'category',
      data: top8.map(s => s.name.replace(/·.*/, '')),
      axisLabel: { color: CHART_THEME.text, fontSize: 10, rotate: 20 },
      axisLine: { lineStyle: { color: CHART_THEME.axis } },
    },
    yAxis: [
      {
        type: 'value',
        name: '万元',
        nameTextStyle: { color: CHART_THEME.text },
        axisLabel: { color: CHART_THEME.text },
        splitLine: { lineStyle: { color: CHART_THEME.splitLine } },
      },
      {
        type: 'value',
        name: '%',
        nameTextStyle: { color: CHART_THEME.text },
        axisLabel: { color: CHART_THEME.text, formatter: '{value}%' },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '今年业绩',
        type: 'bar',
        data: top8.map(s => s.sales),
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#00d4ff' },
            { offset: 1, color: 'rgba(0, 100, 180, 0.6)' },
          ]),
          borderRadius: [4, 4, 0, 0],
        },
        barWidth: 16,
      },
      {
        name: '去年同期',
        type: 'bar',
        data: top8.map(s => s.lastYearSales),
        itemStyle: { color: 'rgba(0, 180, 255, 0.2)', borderRadius: [4, 4, 0, 0] },
        barWidth: 16,
      },
      {
        name: '同比增长',
        type: 'line',
        yAxisIndex: 1,
        data: top8.map(s => s.yoyRate),
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: CHART_THEME.colors[1], width: 2 },
        itemStyle: { color: CHART_THEME.colors[1] },
      },
    ],
  });

  return chart;
}

export function resizeCharts(charts) {
  charts.forEach(c => c?.resize());
}
