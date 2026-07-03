import { fetchStoreData, getCompletionStatus, getRateBarClass, formatYoy, CONFIG } from './dataService.js';
import { renderPerformanceChart, renderCompletionChart, renderYoyChart, resizeCharts } from './charts.js';

class DashboardApp {
  constructor() {
    this.charts = [];
    this.timer = null;
    this.init();
  }

  init() {
    this.bindClock();
    this.bindResize();
    this.refresh();
    this.timer = setInterval(() => this.refresh(), CONFIG.refreshInterval);
  }

  bindClock() {
    const tick = () => {
      const now = new Date();
      document.getElementById('clock').textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
    };
    tick();
    setInterval(tick, 1000);
  }

  bindResize() {
    window.addEventListener('resize', () => resizeCharts(this.charts));
  }

  async refresh() {
    const data = await fetchStoreData();
    this.renderSummary(data.summary);
    this.renderTable(data.stores);
    this.renderCharts(data.stores);
    document.getElementById('updateTime').textContent =
      `更新于 ${data.updatedAt.toLocaleString('zh-CN')}`;
  }

  renderSummary(summary) {
    document.getElementById('totalSales').textContent = summary.totalSales.toLocaleString();
    document.getElementById('totalTarget').textContent = summary.totalTarget.toLocaleString();
    document.getElementById('overallCompletion').textContent = summary.overallCompletion;
    document.getElementById('yoyGrowth').textContent =
      summary.yoyGrowth > 0 ? `+${summary.yoyGrowth}` : summary.yoyGrowth;
    document.getElementById('lastYearSales').textContent = summary.lastYearSales.toLocaleString();
    document.getElementById('storeCount').textContent = summary.storeCount;
    document.getElementById('qualifiedCount').textContent = summary.qualifiedCount;

    const yoyEl = document.getElementById('yoyGrowth');
    yoyEl.parentElement.className = 'kpi-value ' + (summary.yoyGrowth >= 0 ? 'positive' : 'negative');

    const status = getCompletionStatus(summary.overallCompletion);
    const statusEl = document.getElementById('completionStatus');
    statusEl.textContent = status.label;
    statusEl.className = 'kpi-sub ' + status.cls;
  }

  renderTable(stores) {
    const tbody = document.getElementById('storeTableBody');
    tbody.innerHTML = stores.map((store, i) => {
      const rank = i + 1;
      const rankCls = rank <= 3 ? `rank-${rank}` : 'rank-n';
      const status = getCompletionStatus(store.completionRate);
      const yoy = formatYoy(store.yoyRate);
      const barCls = getRateBarClass(store.completionRate);

      return `<tr>
        <td><span class="rank-badge ${rankCls}">${rank}</span></td>
        <td>${store.name}</td>
        <td>${store.sales.toLocaleString()}</td>
        <td>${store.target.toLocaleString()}</td>
        <td>
          <div class="rate-bar">
            <div class="rate-bar-track">
              <div class="rate-bar-fill ${barCls}" style="width:${Math.min(store.completionRate, 100)}%"></div>
            </div>
            <span>${store.completionRate}%</span>
          </div>
        </td>
        <td class="${yoy.cls}">${yoy.text}</td>
        <td><span class="status-tag ${status.cls}">${status.label}</span></td>
      </tr>`;
    }).join('');
  }

  renderCharts(stores) {
    this.charts.forEach(c => c.dispose());
    this.charts = [
      renderPerformanceChart(document.getElementById('chartPerformance'), stores),
      renderCompletionChart(document.getElementById('chartCompletion'), stores),
      renderYoyChart(document.getElementById('chartYoy'), stores),
    ];
    requestAnimationFrame(() => {
      resizeCharts(this.charts);
      setTimeout(() => resizeCharts(this.charts), 100);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => new DashboardApp());
