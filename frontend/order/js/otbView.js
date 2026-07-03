import { formatGrowth } from './compareService.js';
import { formatOtbAmountWan, getOtbSourceLabel, buildOtbCompletion } from './otbService.js';

function calcGrowthScale(points) {
  const rates = points.map(p => p.growth).filter(g => g != null);
  if (!rates.length) return { min: -20, max: 40 };
  const min = Math.min(...rates, 0);
  const max = Math.max(...rates, 0);
  const pad = Math.max(10, (max - min) * 0.15);
  return { min: min - pad, max: max + pad };
}

function growthToBottomPct(growth, scale) {
  const span = scale.max - scale.min;
  if (!span) return 50;
  return ((growth - scale.min) / span) * 100;
}

function renderOtbGrowthMarker(point, scale) {
  if (point.growth == null) return '';
  const bottom = growthToBottomPct(point.growth, scale);
  const g = formatGrowth(point.growth);
  return `
    <div class="otb-growth-marker" style="bottom:calc(${bottom}% + 2px)" title="增长率 ${g.text}">
      <span class="otb-growth-label ${g.cls}">${g.text}</span>
      <span class="otb-growth-dot"></span>
    </div>
  `;
}

function donutSlicePath(cx, cy, ro, ri, a0, a1) {
  if (a1 - a0 >= Math.PI * 2 - 0.001) a1 = a0 + Math.PI * 2 - 0.001;
  const p0 = { x: cx + ro * Math.cos(a0), y: cy + ro * Math.sin(a0) };
  const p1 = { x: cx + ro * Math.cos(a1), y: cy + ro * Math.sin(a1) };
  const p2 = { x: cx + ri * Math.cos(a1), y: cy + ri * Math.sin(a1) };
  const p3 = { x: cx + ri * Math.cos(a0), y: cy + ri * Math.sin(a0) };
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${ro} ${ro} 0 ${large} 1 ${p1.x} ${p1.y} L ${p2.x} ${p2.y} A ${ri} ${ri} 0 ${large} 0 ${p3.x} ${p3.y} Z`;
}

function buildCompletionDonutSvg(rate) {
  const cx = 100;
  const cy = 100;
  const ro = 88;
  const ri = 58;
  const filled = Math.min(Math.max(rate, 0), 100);
  const a0 = -Math.PI / 2;
  const a1 = a0 + (filled / 100) * Math.PI * 2;
  const doneColor = rate >= 100 ? '#52c41a' : '#1677ff';
  const remainColor = '#e8e8e8';

  if (filled <= 0) {
    return `<circle cx="${cx}" cy="${cy}" r="${ro}" fill="${remainColor}"></circle>
      <circle cx="${cx}" cy="${cy}" r="${ri}" fill="#fff"></circle>`;
  }
  if (filled >= 100) {
    return `<path d="${donutSlicePath(cx, cy, ro, ri, a0, a0 + Math.PI * 2 - 0.001)}" fill="${doneColor}"></path>`;
  }
  return `
    <path d="${donutSlicePath(cx, cy, ro, ri, a0, a1)}" fill="${doneColor}"></path>
    <path d="${donutSlicePath(cx, cy, ro, ri, a1, a0 + Math.PI * 2)}" fill="${remainColor}"></path>
  `;
}

const OTB_REGION_LABELS = ['陕西', '新疆'];

function renderRegionAmountMeta(regionAmount) {
  return OTB_REGION_LABELS
    .map(name => `<span>${name} ${formatOtbAmountWan(regionAmount?.[name] ?? 0)} 万</span>`)
    .join('');
}

function renderCompletionPie(title, rate, currentAmount, targetAmount, targetLabel, regionAmount) {
  if (!targetAmount || rate == null) {
    return `<div class="otb-completion-pie"><div class="empty-state">暂无 ${targetLabel} 数据</div></div>`;
  }
  const displayPct = Math.round(rate * 10) / 10;
  const pctText = Number.isInteger(displayPct) ? `${displayPct}` : `${displayPct}`;
  return `
    <div class="otb-completion-pie">
      <div class="otb-completion-title">${title}</div>
      <div class="otb-completion-svg-wrap">
        <svg viewBox="0 0 200 200" class="otb-completion-svg" role="img" aria-label="${title} ${pctText}%">
          ${buildCompletionDonutSvg(rate)}
        </svg>
        <div class="otb-completion-center">
          <span class="otb-completion-pct">${pctText}%</span>
        </div>
      </div>
      <div class="otb-completion-meta">
        <span>当前买货额 ${formatOtbAmountWan(currentAmount)} 万</span>
        ${renderRegionAmountMeta(regionAmount)}
        <span>${targetLabel} ${formatOtbAmountWan(targetAmount)} 万</span>
      </div>
    </div>
  `;
}

function renderOtbBarChart(points) {
  const maxAmount = Math.max(...points.map(p => p.amount), 1);
  const scale = calcGrowthScale(points);
  return points.map(point => {
    const barPct = Math.round(point.amount / maxAmount * 100);
    const wan = formatOtbAmountWan(point.amount);
    return `
      <div class="otb-bar-group">
        <div class="otb-bar-col">
          <div class="otb-bar-track">
            ${renderOtbGrowthMarker(point, scale)}
            <span class="otb-bar-value" style="bottom:calc(${barPct}% + 2px)">${wan}万</span>
            <div class="otb-bar" style="height:${barPct}%" title="${point.label} 买货额 ${wan} 万元"></div>
          </div>
        </div>
        <div class="otb-bar-label">${point.label}</div>
      </div>
    `;
  }).join('');
}

function renderOtbCompletionPanel(completion) {
  const { regionAmount } = completion;
  return `
    <div class="otb-completion-panel">
      ${renderCompletionPie('OTB目标完成率', completion.targetRate, completion.currentAmount, completion.targetAmount, completion.targetLabel, regionAmount)}
    </div>
  `;
}

export function renderOtbChart(points, currentAmount = 0, regionAmount = {}) {
  const el = document.getElementById('overviewOtbChart');
  if (!el) return;

  if (!points.length) {
    el.innerHTML = `<div class="empty-state">暂无 OTB 数据，请将 OTB.xlsx 放入 datasource 目录后重新运行 start.bat</div>`;
    return;
  }

  const completion = buildOtbCompletion(points, currentAmount, regionAmount);

  el.innerHTML = `
    <div class="otb-combo-chart">
      <div class="otb-chart-meta">数据来源 ${getOtbSourceLabel()} · 当前买货额 ${formatOtbAmountWan(currentAmount)} 万元</div>
      <div class="otb-card-layout">
        <div class="otb-chart-main">
          <div class="otb-legend">
            <span class="otb-legend-item"><i class="otb-legend-bar"></i>买货额(万元)</span>
            <span class="otb-legend-item"><i class="otb-legend-line"></i>同比增长率</span>
          </div>
          <div class="otb-chart-body">
            <svg class="otb-growth-line-svg" aria-hidden="true"></svg>
            ${renderOtbBarChart(points)}
          </div>
        </div>
        ${renderOtbCompletionPanel(completion)}
      </div>
    </div>
  `;
  requestAnimationFrame(() => bindOtbGrowthLine(el));
}

export function bindOtbGrowthLine(chartRoot) {
  const body = chartRoot?.querySelector('.otb-chart-body');
  const svg = chartRoot?.querySelector('.otb-growth-line-svg');
  const markers = body ? [...body.querySelectorAll('.otb-growth-marker')] : [];
  if (!body || !svg || markers.length < 2) {
    if (svg) svg.innerHTML = '';
    return;
  }

  const bodyRect = body.getBoundingClientRect();
  const svgH = body.clientHeight;
  const svgW = body.clientWidth;

  svg.style.top = '0';
  svg.style.height = `${svgH}px`;
  svg.setAttribute('width', String(svgW));
  svg.setAttribute('height', String(svgH));
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);

  const points = markers.map(marker => {
    const dot = marker.querySelector('.otb-growth-dot') ?? marker;
    const r = dot.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 - bodyRect.left,
      y: r.top + r.height / 2 - bodyRect.top,
    };
  });

  svg.innerHTML = `<polyline class="otb-growth-path" points="${points.map(p => `${p.x},${p.y}`).join(' ')}" />`;
}
