import { compareAnnualOrders, formatGrowth, formatAmount, formatRegionShareText, formatCategoryShareText, calcPieceUnitPrice, formatPieceUnitPrice, buildSubCategoryCompare, calcRegionGenderSharePct } from './compareService.js';

function renderGrowthCell(rate) {
  const g = formatGrowth(rate);
  return `<span class="growth-tag ${g.cls}">${g.text}</span>`;
}

function renderIncreaseCell(base, current) {
  const diff = current - base;
  const text = diff > 0 ? `+${diff}` : `${diff}`;
  const cls = diff > 0 ? 'growth-up' : diff < 0 ? 'growth-down' : 'growth-flat';
  return `<span class="growth-tag ${cls}">${text}</span>`;
}

function formatRegionValue(value, formatter) {
  return formatter ? formatter(value) : value;
}

function calcRegionPercents(regionData, total) {
  if (!regionData || !Object.keys(regionData).length) return {};
  if (!total) {
    return Object.fromEntries(Object.keys(regionData).map(name => [name, 0]));
  }
  return Object.fromEntries(
    Object.entries(regionData).map(([name, val]) => [name, Math.round(val / total * 100)]),
  );
}

function renderRegionSide(regionData, total, formatter, { showPct = true } = {}) {
  if (!regionData || Object.keys(regionData).length === 0) return '';
  const valueItems = Object.entries(regionData)
    .map(([name, val]) => `<span>${name} <strong>${formatRegionValue(val, formatter)}</strong></span>`)
    .join('');
  const pctRow = showPct
    ? `<div class="kpi-region kpi-region-pct">${Object.entries(calcRegionPercents(regionData, total))
      .map(([name, pct]) => `<span>${name}占比：<strong>${pct}%</strong></span>`)
      .join('')}</div>`
    : '';
  return `
    <div class="kpi-region-side">
      <div class="kpi-region kpi-region-values">${valueItems}</div>
      ${pctRow}
    </div>
  `;
}

function renderMetricCard(label, totalValue, regionData, unit = '', formatter = null, { showPct = true } = {}) {
  const display = formatter ? formatter(totalValue) : totalValue;
  const regionSide = renderRegionSide(regionData, totalValue, formatter, { showPct });
  return `
    <div class="kpi-card">
      <div class="kpi-label">${label}</div>
      <div class="kpi-body">
        <div class="kpi-value">${display}${unit ? `<small>${unit}</small>` : ''}</div>
        ${regionSide}
      </div>
    </div>
  `;
}

function renderGrowthCard(label, metric, field, formatter = null) {
  const g = formatGrowth(metric.growth);
  const regionGrowth = {};
  Object.keys(metric.regionBase ?? {}).forEach(name => {
    regionGrowth[name] = formatGrowth(
      calcRegionGrowth(metric.regionBase[name], metric.regionCurrent[name]),
    ).text;
  });

  return `
    <div class="kpi-card">
      <div class="kpi-label">${label}</div>
      <div class="kpi-body">
        <div class="kpi-value"><span class="growth-tag growth-tag-lg ${g.cls}">${g.text}</span></div>
        ${renderRegionSide(regionGrowth, null, v => v, { showPct: false })}
      </div>
    </div>
  `;
}

function calcRegionGrowth(base, current) {
  if (base === 0) return current > 0 ? 100 : 0;
  return Math.round((current - base) / base * 1000) / 10;
}

function renderSkuIncreaseCard(colorCount) {
  const total = colorCount.current - colorCount.base;
  const skuText = total > 0 ? `+${total}` : `${total}`;
  const skuCls = total >= 0 ? 'value-up' : 'value-down';
  const regionIncrease = {};
  Object.keys(colorCount.regionBase ?? {}).forEach(name => {
    const diff = colorCount.regionCurrent[name] - colorCount.regionBase[name];
    regionIncrease[name] = diff > 0 ? `+${diff}` : `${diff}`;
  });

  return `
    <div class="kpi-card">
      <div class="kpi-label">SKU增加数</div>
      <div class="kpi-body">
        <div class="kpi-value ${skuCls}">${skuText}<small>款色</small></div>
        ${renderRegionSide(regionIncrease, total, v => v, { showPct: false })}
      </div>
    </div>
  `;
}

function buildRegionPieceUnitPrices(amountMetric, qtyMetric, useCurrent) {
  const regionAmount = useCurrent ? amountMetric.regionCurrent : amountMetric.regionBase;
  const regionQty = useCurrent ? qtyMetric.regionCurrent : qtyMetric.regionBase;
  const prices = {};
  Object.keys(regionAmount ?? {}).forEach(name => {
    prices[name] = calcPieceUnitPrice(regionAmount[name] ?? 0, regionQty?.[name] ?? 0);
  });
  return prices;
}

function buildRegionPieceUnitDiff(regionBase, regionCurrent) {
  const names = [...new Set([...Object.keys(regionBase ?? {}), ...Object.keys(regionCurrent ?? {})])];
  const diff = {};
  names.forEach(name => {
    const base = regionBase[name];
    const current = regionCurrent[name];
    if (base === null || current === null) {
      diff[name] = '—';
      return;
    }
    const value = Math.round(current) - Math.round(base);
    diff[name] = value > 0 ? `+${value}` : `${value}`;
  });
  return diff;
}

function renderPieceUnitDiffCard(basePrice, currentPrice, regionDiff) {
  let display = '—';
  let cls = '';
  if (basePrice !== null && currentPrice !== null) {
    const value = Math.round(currentPrice) - Math.round(basePrice);
    display = value > 0 ? `+${value}` : `${value}`;
    cls = value > 0 ? 'value-up' : value < 0 ? 'value-down' : '';
  }

  return `
    <div class="kpi-card">
      <div class="kpi-label">件单差异</div>
      <div class="kpi-body">
        <div class="kpi-value ${cls}">${display}<small>元/件</small></div>
        ${renderRegionSide(regionDiff, null, v => v, { showPct: false })}
      </div>
    </div>
  `;
}

function renderCompareKpi(summary) {
  const { colorCount, totalQty, totalAmount } = summary;
  const basePrice = calcPieceUnitPrice(totalAmount.base, totalQty.base);
  const currentPrice = calcPieceUnitPrice(totalAmount.current, totalQty.current);
  const regionBase = buildRegionPieceUnitPrices(totalAmount, totalQty, false);
  const regionCurrent = buildRegionPieceUnitPrices(totalAmount, totalQty, true);
  const regionDiff = buildRegionPieceUnitDiff(regionBase, regionCurrent);

  return `
    <div class="kpi-grid-stack">
      <div class="kpi-grid-row">
        ${renderMetricCard('同期款色数', colorCount.base, colorCount.regionBase, '款色', null, { showPct: false })}
        ${renderMetricCard('同期订货量', totalQty.base, totalQty.regionBase, '件', v => v.toLocaleString())}
        ${renderMetricCard('同期买货额', totalAmount.base, totalAmount.regionBase, '万元', formatAmount)}
        ${renderMetricCard('同期件单', basePrice, regionBase, '元/件', formatPieceUnitPrice, { showPct: false })}
      </div>
      <div class="kpi-grid-row">
        ${renderMetricCard('当前订货款色数', colorCount.current, colorCount.regionCurrent, '款色', null, { showPct: false })}
        ${renderMetricCard('当前订货量', totalQty.current, totalQty.regionCurrent, '件', v => v.toLocaleString())}
        ${renderMetricCard('当前买货额', totalAmount.current, totalAmount.regionCurrent, '万元', formatAmount)}
        ${renderMetricCard('当前件单', currentPrice, regionCurrent, '元/件', formatPieceUnitPrice, { showPct: false })}
      </div>
      <div class="kpi-grid-row">
        ${renderSkuIncreaseCard(colorCount)}
        ${renderGrowthCard('订货量增长率', totalQty, 'totalQty')}
        ${renderGrowthCard('买货额增长率', totalAmount, 'totalAmount')}
        ${renderPieceUnitDiffCard(basePrice, currentPrice, regionDiff)}
      </div>
    </div>
  `;
}

function renderCategoryTitle(cat) {
  return cat.name;
}

function calcSharePct(qty, total) {
  if (!total) return 0;
  return Math.round(qty / total * 100);
}

function renderMajorCategoryRegionBlock(regionBase, regionCurrent, regions) {
  const names = regions?.length
    ? regions
    : [...new Set([...Object.keys(regionBase ?? {}), ...Object.keys(regionCurrent ?? {})])];
  if (!names.length) return '';

  const items = names.map(name => `
    <div class="major-bar-region-item">
      <span class="major-bar-region-name">${name}</span>
      <span class="major-bar-region-val">${(regionBase?.[name] ?? 0).toLocaleString()} / ${(regionCurrent?.[name] ?? 0).toLocaleString()}</span>
    </div>
  `).join('');

  return `<div class="major-bar-region">${items}</div>`;
}

function renderMajorSellThroughMarker(cat, baseYear) {
  const rate = cat.sellThrough?.base;
  if (rate === null || rate === undefined) return '';
  const clamped = Math.min(rate, 100);
  return `
    <div class="major-sellthrough-marker" style="bottom:calc(${clamped}% + 2px)" title="${baseYear}售罄 ${rate}%">
      <span class="major-sellthrough-label">${rate}%</span>
      <span class="major-sellthrough-dot"></span>
    </div>
  `;
}

function renderMajorCategoryQtyBarChart(categories, baseYear, currentYear, regions = []) {
  if (!categories.length) return '<div class="empty-state">暂无大类订货量数据</div>';

  const totalBase = categories.reduce((s, c) => s + c.totalQty.base, 0);
  const totalCurrent = categories.reduce((s, c) => s + c.totalQty.current, 0);

  const groups = categories.map(cat => {
    const baseShare = calcSharePct(cat.totalQty.base, totalBase);
    const curShare = calcSharePct(cat.totalQty.current, totalCurrent);
    return `
      <div class="major-bar-group">
        <div class="major-bar-columns">
          <div class="major-bar-col major-bar-col-base" title="${baseYear} ${cat.totalQty.base.toLocaleString()} 件 · ${baseShare}%">
            <div class="major-bar-track">
              ${renderMajorSellThroughMarker(cat, baseYear)}
              <span class="major-bar-value" style="bottom:calc(${baseShare}% + 2px)">${baseShare}%</span>
              <div class="major-bar major-bar-base" style="height:${baseShare}%"></div>
            </div>
          </div>
          <div class="major-bar-col" title="${currentYear} ${cat.totalQty.current.toLocaleString()} 件 · ${curShare}%">
            <div class="major-bar-track">
              <span class="major-bar-value" style="bottom:calc(${curShare}% + 2px)">${curShare}%</span>
              <div class="major-bar major-bar-current" style="height:${curShare}%"></div>
            </div>
          </div>
        </div>
        <div class="major-bar-label">${renderCategoryTitle(cat)}</div>
        <div class="major-bar-meta">${cat.totalQty.base.toLocaleString()} / ${cat.totalQty.current.toLocaleString()} 件</div>
        <div class="major-bar-growth">${renderGrowthCell(cat.totalQty.growth)}</div>
        ${renderMajorCategoryRegionBlock(cat.totalQty.regionBase, cat.totalQty.regionCurrent, regions)}
      </div>
    `;
  }).join('');

  return `
    <div class="major-qty-bar-chart">
      <div class="major-bar-legend">
        <span class="major-bar-legend-item"><i class="legend-base"></i>${baseYear}</span>
        <span class="major-bar-legend-item"><i class="legend-current"></i>${currentYear}</span>
        <span class="major-bar-legend-item"><i class="legend-sellthrough"></i>${baseYear}售罄</span>
        <span class="major-bar-legend-hint">柱高 = 占当年大类订货量合计的占比 · 折线 = ${baseYear}销量÷订货量</span>
      </div>
      <div class="major-bar-chart-body">
        <svg class="major-sellthrough-line-svg" aria-hidden="true"></svg>
        ${groups}
      </div>
    </div>
  `;
}

export function bindMajorSellThroughLine(chartRoot) {
  const body = chartRoot?.querySelector('.major-bar-chart-body');
  const svg = chartRoot?.querySelector('.major-sellthrough-line-svg');
  const markers = body ? [...body.querySelectorAll('.major-sellthrough-marker')] : [];
  if (!body || !svg) return;

  if (markers.length < 2) {
    svg.innerHTML = '';
    return;
  }

  const columns = body.querySelector('.major-bar-columns');
  if (!columns) {
    svg.innerHTML = '';
    return;
  }

  const bodyRect = body.getBoundingClientRect();
  const columnsRect = columns.getBoundingClientRect();
  const svgTop = columnsRect.top - bodyRect.top;
  const svgH = columnsRect.height;
  const svgW = body.clientWidth;

  svg.style.top = `${svgTop}px`;
  svg.style.height = `${svgH}px`;
  svg.setAttribute('width', String(svgW));
  svg.setAttribute('height', String(svgH));
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);

  const points = markers.map(marker => {
    const dot = marker.querySelector('.major-sellthrough-dot') ?? marker;
    const r = dot.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 - bodyRect.left,
      y: r.top + r.height / 2 - bodyRect.top - svgTop,
    };
  });

  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');
  svg.innerHTML = `<polyline class="major-sellthrough-path" points="${polyline}" />`;
}

function renderGenderCompareSection(genders, baseYear, currentYear, regions) {
  if (!genders.length) return '<div class="empty-state">暂无性别对比数据</div>';
  return renderGenderPieCompare(genders, baseYear, currentYear, regions);
}

const GENDER_SLICE_COLORS = { 男: '#1677ff', 女: '#ff85c0' };

function donutSlicePath(cx, cy, ro, ri, a0, a1) {
  if (a1 - a0 >= Math.PI * 2 - 0.001) a1 = a0 + Math.PI * 2 - 0.001;
  const p0 = { x: cx + ro * Math.cos(a0), y: cy + ro * Math.sin(a0) };
  const p1 = { x: cx + ro * Math.cos(a1), y: cy + ro * Math.sin(a1) };
  const p2 = { x: cx + ri * Math.cos(a1), y: cy + ri * Math.sin(a1) };
  const p3 = { x: cx + ri * Math.cos(a0), y: cy + ri * Math.sin(a0) };
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${ro} ${ro} 0 ${large} 1 ${p1.x} ${p1.y} L ${p2.x} ${p2.y} A ${ri} ${ri} 0 ${large} 0 ${p3.x} ${p3.y} Z`;
}

function buildGenderPieSvg(items, total, regionData, regions) {
  const cx = 100;
  const cy = 100;
  const ro = 90;
  const ri = 52;
  const labelR = (ro + ri) / 2;
  let angle = -Math.PI / 2;
  const regionNames = regions?.length ? regions : Object.keys(regionData?.[items[0]?.name] ?? {});

  const slices = items.map(item => {
    const pct = total > 0 ? item.value / total * 100 : 0;
    const span = total > 0 ? (item.value / total) * Math.PI * 2 : 0;
    const a0 = angle;
    const a1 = angle + span;
    angle = a1;

    const mid = (a0 + a1) / 2;
    const lx = cx + labelR * Math.cos(mid);
    const ly = cy + labelR * Math.sin(mid);
    const pctRounded = Math.round(pct);
    const regionPayload = regionNames.map(r => ({
      name: r,
      qty: regionData?.[item.name]?.[r] ?? 0,
    }));
    const label = pct >= 8
      ? `<text x="${lx}" y="${ly}" class="gender-pie-slice-label" text-anchor="middle" dominant-baseline="middle">${pctRounded}%</text>`
      : '';

    return `
      <path class="gender-pie-slice" d="${donutSlicePath(cx, cy, ro, ri, a0, a1)}"
        fill="${GENDER_SLICE_COLORS[item.name] ?? '#bfbfbf'}"
        data-name="${item.name}"
        data-qty="${item.value}"
        data-pct="${pctRounded}"
        data-regions='${JSON.stringify(regionPayload).replace(/'/g, '&#39;')}'
        data-region-gender='${JSON.stringify(regionData).replace(/'/g, '&#39;')}'></path>
      ${label}
    `;
  }).join('');

  if (!total) {
    return `<circle cx="${cx}" cy="${cy}" r="${ro}" fill="#f0f0f0" class="gender-pie-slice-empty"></circle>`;
  }
  return slices;
}

function regionGenderShareLabel(genderName) {
  return genderName === '男' ? '男装占比' : '女装占比';
}

function formatGenderPieTip(slice) {
  const name = slice.dataset.name ?? '';
  const qty = Number(slice.dataset.qty ?? 0);
  const pct = slice.dataset.pct ?? '0';
  let lines = [`${name}：${qty.toLocaleString()} 件（${pct}%）`];
  try {
    const regionPayload = JSON.parse(slice.dataset.regions ?? '[]');
    const regionData = JSON.parse(slice.dataset.regionGender ?? '{}');
    regionPayload.forEach(r => {
      const rPct = calcRegionGenderSharePct(r.name, name, regionData);
      lines.push(`${r.name} ${r.qty.toLocaleString()} 件 · ${regionGenderShareLabel(name)} ${rPct}%`);
    });
  } catch { /* ignore */ }
  return lines.join('\n');
}

function bindGenderPieTooltips(root) {
  if (!root) return;
  root.querySelectorAll('.gender-pie-svg-wrap').forEach(wrap => {
    const tooltip = wrap.querySelector('.gender-pie-tooltip');
    const svg = wrap.querySelector('.gender-pie-svg');
    if (!tooltip || !svg) return;

    const show = (e, slice) => {
      tooltip.textContent = formatGenderPieTip(slice);
      tooltip.hidden = false;
      move(e);
    };
    const move = e => {
      const rect = wrap.getBoundingClientRect();
      tooltip.style.left = `${e.clientX - rect.left + 12}px`;
      tooltip.style.top = `${e.clientY - rect.top + 12}px`;
    };
    const hide = () => { tooltip.hidden = true; };

    svg.querySelectorAll('.gender-pie-slice').forEach(slice => {
      slice.addEventListener('mouseenter', e => show(e, slice));
      slice.addEventListener('mousemove', move);
      slice.addEventListener('mouseleave', hide);
    });
  });
}

function renderGenderPieLegend(items, total, regionData, regions) {
  const regionNames = regions?.length ? regions : Object.keys(regionData?.[items[0]?.name] ?? {});
  return items.map(item => {
    const pct = total > 0 ? Math.round(item.value / total * 100) : 0;
    const regionLines = regionNames.map(r => {
      const val = regionData?.[item.name]?.[r] ?? 0;
      const rPct = calcRegionGenderSharePct(r, item.name, regionData);
      return `<span class="gender-pie-region-kv">${r} ${val.toLocaleString()} 件 · ${regionGenderShareLabel(item.name)} ${rPct}%</span>`;
    }).join('');
    return `
      <div class="gender-pie-legend-item">
        <span class="gender-pie-legend-dot" style="background:${GENDER_SLICE_COLORS[item.name] ?? '#bfbfbf'}"></span>
        <div class="gender-pie-legend-text">
          <span class="gender-pie-legend-name">${item.name}</span>
          <span class="gender-pie-legend-val">${item.value.toLocaleString()} 件 · ${pct}%</span>
          ${regionLines ? `<span class="gender-pie-legend-region">${regionLines}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderGenderPieSingle(genders, yearLabel, field, regionField, regions) {
  const items = genders.map(g => ({ name: g.name, value: g.totalQty[field] }));
  const total = items.reduce((s, i) => s + i.value, 0);
  const regionData = Object.fromEntries(
    genders.map(g => [g.name, g.totalQty[regionField] ?? {}]),
  );
  const svgSlices = buildGenderPieSvg(items, total, regionData, regions);

  return `
    <div class="gender-pie-wrap">
      <div class="gender-pie-year">${yearLabel}</div>
      <div class="gender-pie-svg-wrap">
        <svg viewBox="0 0 200 200" class="gender-pie-svg" role="img" aria-label="${yearLabel} 性别订货占比">
          ${svgSlices}
        </svg>
        <div class="gender-pie-center">
          <span class="gender-pie-total">${total.toLocaleString()}</span>
          <span class="gender-pie-total-label">件</span>
        </div>
        <div class="gender-pie-tooltip" hidden></div>
      </div>
      <div class="gender-pie-legend">${renderGenderPieLegend(items, total, regionData, regions)}</div>
    </div>
  `;
}

function renderGenderPieCompare(genders, baseYear, currentYear, regions) {
  const growthRow = genders.map(g => `
    <div class="gender-pie-growth-item">
      <span class="gender-pie-growth-name">${g.name}</span>
      ${renderGrowthCell(g.totalQty.growth)}
    </div>
  `).join('');

  return `
    <div class="gender-pie-compare">
      <div class="gender-pie-row">
        ${renderGenderPieSingle(genders, baseYear, 'base', 'regionBase', regions)}
        ${renderGenderPieSingle(genders, currentYear, 'current', 'regionCurrent', regions)}
      </div>
      <div class="gender-pie-growth-row">${growthRow}</div>
    </div>
  `;
}

function renderRegionShareCell(row, regionSubtotal, field) {
  if (row.isTotal) return '<td class="num">—</td>';
  if (row.isSubtotal) return '<td class="num">100%</td>';
  return `<td class="num region-share">${formatRegionShareText(row, regionSubtotal, field)}</td>`;
}

function renderRegionMetricCells(row, regionSubtotal) {
  return `
      <td class="num">${row.colorCount.base}</td>
      <td class="num">${row.colorCount.current}</td>
      <td class="num">${renderIncreaseCell(row.colorCount.base, row.colorCount.current)}</td>
      <td class="num">${row.totalQty.base.toLocaleString()}</td>
      <td class="num">${row.totalQty.current.toLocaleString()}</td>
      <td class="num">${renderGrowthCell(row.totalQty.growth)}</td>
      ${renderRegionShareCell(row, regionSubtotal, 'totalQty')}
      <td class="num">${formatAmount(row.totalAmount.base)}</td>
      <td class="num">${formatAmount(row.totalAmount.current)}</td>
      <td class="num">${renderGrowthCell(row.totalAmount.growth)}</td>
      ${renderRegionShareCell(row, regionSubtotal, 'totalAmount')}
  `;
}

function renderCategoryShareCell(cat, totals, field, isTotalRow) {
  const text = formatCategoryShareText(cat[field], totals, isTotalRow);
  if (isTotalRow) return '<td class="num">—</td>';
  return `<td class="num region-share">${text}</td>`;
}

function renderCategoryMetricCells(cat, totals, isTotalRow) {
  return `
      <td class="num">${cat.colorCount.base}</td>
      <td class="num">${cat.colorCount.current}</td>
      <td class="num">${renderIncreaseCell(cat.colorCount.base, cat.colorCount.current)}</td>
      <td class="num">${cat.totalQty.base.toLocaleString()}</td>
      <td class="num">${cat.totalQty.current.toLocaleString()}</td>
      <td class="num">${renderGrowthCell(cat.totalQty.growth)}</td>
      ${renderCategoryShareCell(cat, totals.qty, 'totalQty', isTotalRow)}
      <td class="num">${formatAmount(cat.totalAmount.base)}</td>
      <td class="num">${formatAmount(cat.totalAmount.current)}</td>
      <td class="num">${renderGrowthCell(cat.totalAmount.growth)}</td>
      ${renderCategoryShareCell(cat, totals.amount, 'totalAmount', isTotalRow)}
  `;
}

function renderCategoryTable(categories, { totalNames = ['合计', '两地合计'] } = {}) {
  const totalSet = new Set(totalNames);
  const totalRow = categories.find(c => totalSet.has(c.name));
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

  return categories.map(cat => {
    const isTotalRow = totalSet.has(cat.name);
    return `
    <tr class="${isTotalRow ? 'table-total-row' : ''}">
      <td>${isTotalRow ? '' : (cat.majorCategory ?? '')}</td>
      <td><strong>${cat.name}</strong></td>
      ${renderCategoryMetricCells(cat, totals, isTotalRow)}
    </tr>
  `;
  }).join('');
}

function renderRegionTable(rows) {
  const totalRow = rows.find(r => r.isTotal);
  const regionOrder = [...new Set(rows.filter(r => !r.isTotal).map(r => r.region))];

  const body = regionOrder.flatMap(region => {
    const genderRows = rows.filter(r => r.region === region && !r.isSubtotal);
    const subtotalRow = rows.find(r => r.region === region && r.isSubtotal);
    const rowCount = genderRows.length + (subtotalRow ? 1 : 0);

    const genderHtml = genderRows.map((row, idx) => `
      <tr>
        ${idx === 0 ? `<td rowspan="${rowCount}"><strong>${region}</strong></td>` : ''}
        <td>${row.gender}</td>
        ${renderRegionMetricCells(row, subtotalRow)}
      </tr>
    `).join('');

    const subtotalHtml = subtotalRow ? `
      <tr class="table-subtotal-row">
        <td><strong>${subtotalRow.gender}</strong></td>
        ${renderRegionMetricCells(subtotalRow, subtotalRow)}
      </tr>
    ` : '';

    return genderHtml + subtotalHtml;
  }).join('');

  const total = totalRow ? `
    <tr class="table-total-row">
      <td colspan="2"><strong>${totalRow.region}</strong></td>
      ${renderRegionMetricCells(totalRow, totalRow)}
    </tr>
  ` : '';

  return body + total;
}

let cachedCompareOrders = { base: [], current: [] };

function getSubCategoryRegion() {
  return document.getElementById('subCategoryRegionFilter')?.value ?? '';
}

function populateSubCategoryRegionFilter(regions) {
  const el = document.getElementById('subCategoryRegionFilter');
  if (!el) return;
  const selected = el.value;
  el.innerHTML = `<option value="">全部</option>${regions.map(r => `<option value="${r}">${r}</option>`).join('')}`;
  el.value = selected && regions.includes(selected) ? selected : '';
}

export function renderSubCategoryTable(ordersBase, ordersCurrent, region = getSubCategoryRegion()) {
  const rows = buildSubCategoryCompare(ordersBase, ordersCurrent, region);
  document.getElementById('overviewCategoryTable').innerHTML = renderCategoryTable(rows);
}

export function bindSubCategoryRegionFilter() {
  const el = document.getElementById('subCategoryRegionFilter');
  if (!el || el.dataset.bound) return;
  el.dataset.bound = '1';
  el.addEventListener('change', () => {
    renderSubCategoryTable(cachedCompareOrders.base, cachedCompareOrders.current, el.value);
  });
}

export function renderCompareView(orders2026, orders2027, elements = {}) {
  const ids = {
    kpi: elements.kpi ?? 'overviewKpi',
    chart: elements.chart ?? 'overviewCategoryChart',
    genderChart: elements.genderChart ?? 'overviewGenderChart',
    table: elements.table ?? 'overviewCategoryTable',
    regionTable: elements.regionTable ?? 'overviewRegionTable',
  };
  const data = compareAnnualOrders(orders2026, orders2027);
  const { summary, majorCategories, genderCompare, regionCompare, baseYear, currentYear, regions } = data;
  cachedCompareOrders = { base: orders2026, current: orders2027 };

  document.getElementById(ids.kpi).innerHTML = renderCompareKpi(summary);
  document.getElementById(ids.chart).innerHTML =
    renderMajorCategoryQtyBarChart(majorCategories, baseYear, currentYear, regions);
  const chartEl = document.getElementById(ids.chart);
  requestAnimationFrame(() => bindMajorSellThroughLine(chartEl));
  document.getElementById(ids.genderChart).innerHTML =
    renderGenderCompareSection(genderCompare, baseYear, currentYear, regions);
  bindGenderPieTooltips(document.getElementById(ids.genderChart));
  populateSubCategoryRegionFilter(regions);
  renderSubCategoryTable(orders2026, orders2027);
  document.getElementById(ids.regionTable).innerHTML = renderRegionTable(regionCompare);

  document.querySelectorAll('[data-year="base"]').forEach(el => { el.textContent = baseYear; });
  document.querySelectorAll('[data-year="current"]').forEach(el => { el.textContent = currentYear; });
}
