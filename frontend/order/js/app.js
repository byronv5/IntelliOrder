import { CONFIG } from './config.js';
import { fetchHistoricalData, fetchCompareOrders, fetchCurrentOrderList, getCurrentOrderSummary, exportCurrentOrdersCsv, escapeCsvCell, getStyleOptions, getCurrentItemByStyleColor, getStyleNoOptions, getHistoryRecommendOptions, parseSkuKey, buildOrderListSizeDetail, sumOrderSizes, hasActiveOrderRow, getOrderDisplaySizeTotal, getOrderSizeMismatchKind, orderCatalogSizeKeys, getCatalogSizeTemplate, initDataService, reloadDataService, reloadHistoryData, getOverviewSourceHint, getHistorySourceHint, getCreateCatalogSourceHint, getCreateRecommendSourceHint, getOrdersSourceHint, getOtbChartData } from './dataService.js';
import { compareAnnualOrders, exportRegionCompareCsv, exportSubCategoryCompareCsv, buildSubCategoryCompare } from './compareService.js';
import { recommendOrder, calcSizeBreakdown, sumSizes, parseSizeQty, buildEmptySizeMap, RECOMMEND_ERR, validateOrder, calcHistorySizeSharePct } from './recommendService.js';
import { upsertOrder, getLocalOrder, mergeCatalogWithLocalSizes, migrateLocalStorageIfNeeded, clearAllPlacedOrders } from './orderService.js';
import { runAutoMatchOrders, isUnplacedOrderRow, isPlacedOrderRow } from './autoMatchOrderService.js';
import { renderCompareView, bindSubCategoryRegionFilter } from './compareView.js';
import { renderOtbChart } from './otbView.js';
import { initStyleAutocomplete } from './styleAutocomplete.js';
import { mountHeaderFilter } from './headerFilterSelect.js';
import { ORDER_HEAD_COLUMNS, buildOrderFilterOptions, filterOrderRecords } from './orderFilter.js';
import { getProductImageUrl, initPicService } from './picService.js';
import { bindImageZoomClick } from './imageViewer.js';

class OrderApp {
  constructor() {
    this.currentTab = 'overview';
    this.historyFilters = {};
    this.orderFilters = {};
    this.orderFilterControls = [];
    this.draft = null;
    this.pendingPrefill = null;
    this.returnToOrdersAfterSave = false;
    this.init();
  }

  async init() {
    this.bindTabs();
    this.bindCreateActions();
    document.getElementById('btnExport').addEventListener('click', () => this.exportCsv());
    document.getElementById('btnAutoMatch')?.addEventListener('click', () => this.autoMatchAllOrders());
    document.getElementById('btnClearPlaced')?.addEventListener('click', () => this.clearAllPlacedOrders());
    document.getElementById('btnExportRegion').addEventListener('click', () => this.exportRegionCompare());
    document.getElementById('btnExportSubCategory').addEventListener('click', () => this.exportSubCategoryCompare());
    try {
      await initDataService();
      const migrated = await migrateLocalStorageIfNeeded();
      if (migrated > 0) this.toast(`已从浏览器缓存迁移 ${migrated} 条订货到 SQLite`, 'success');
      this.updateSourceLabels();
    } catch (err) {
      document.getElementById('headerMeta').textContent = `数据加载失败: ${err.message}`;
      this.toast(err.message, 'error');
    }
    this.renderHistoryFilters();
    this.renderCreateForm();
    await this.refresh();
  }

  updateSourceLabels() {
    const [y0, y1] = CONFIG.compareYears;
    const overviewHint = getOverviewSourceHint();
    document.getElementById('headerMeta').textContent =
      `${y0} vs ${y1} 订货对比 · ${overviewHint} · 已加载`;
    document.querySelector('#panel-overview .card-header').textContent =
      `${y0} vs ${y1} 订货对比 · ${overviewHint}`;
    document.querySelector('#panel-history .card-header').textContent =
      `历史销售数据 · ${getHistorySourceHint()}`;
    document.querySelector('#panel-create .card-header').textContent =
      `新建订货 · ${getCreateCatalogSourceHint()} · ${getCreateRecommendSourceHint()}`;
    const orderTitle = document.querySelector('#panel-orders .card-header span');
    if (orderTitle) orderTitle.textContent = `订货单列表 · ${getOrdersSourceHint()}`;
  }

  bindTabs() {
    document.getElementById('tabs').addEventListener('click', e => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      this.switchTab(tab.dataset.tab);
    });
  }

  switchTab(name) {
    this.currentTab = name;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
    this.refresh();
  }

  async refresh() {
    if (this.currentTab === 'overview') await this.renderOverview();
    if (this.currentTab === 'history') {
      await reloadDataService();
      this.updateSourceLabels();
      this.renderHistoryFilters();
      await this.renderHistory();
    }
    if (this.currentTab === 'create') {
      await reloadDataService();
      await reloadHistoryData();
      this.updateSourceLabels();
      const prefill = this.pendingPrefill;
      this.pendingPrefill = null;
      this.renderCreateForm();
      if (prefill) this.applyPrefill(prefill);
    }
    if (this.currentTab === 'orders') {
      await reloadDataService();
      this.updateSourceLabels();
      await this.renderOrders();
    }
  }

  /* ---- 概览：2026 vs 2027 对比 ---- */
  async renderOverview() {
    const { base, current } = await fetchCompareOrders();
    renderCompareView(base, current);
    bindSubCategoryRegionFilter();
    const { summary } = compareAnnualOrders(base, current);
    renderOtbChart(getOtbChartData(), summary.totalAmount.current, summary.totalAmount.regionCurrent);
  }

  /* ---- 历史数据 ---- */
  renderHistoryFilters() {
    const el = document.getElementById('historyFilters');
    el.innerHTML = `
      <div class="form-group"><label>区域</label>
        <select id="fRegion"><option value="">全部</option>
          ${CONFIG.regions.map(r => `<option value="${r}">${r}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>品牌</label>
        <select id="fBrand"><option value="">全部</option>
          ${CONFIG.brands.map(b => `<option value="${b}">${b}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>年份</label>
        <select id="fYear"><option value="">全部</option>
          ${CONFIG.years.map(y => `<option value="${y}">${y}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>季节</label>
        <select id="fSeason"><option value="">全部</option>
          ${CONFIG.seasons.map(s => `<option value="${s}">${s}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>款号</label><input type="text" id="fStyleNo" placeholder="搜索款号"></div>
      <div class="form-group"><label>中类</label>
        <select id="fSubCategory"><option value="">全部</option>
          ${CONFIG.subCategories.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>性别</label>
        <select id="fGender"><option value="">全部</option>
          ${CONFIG.genders.map(g => `<option value="${g}">${g}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>色系</label>
        <select id="fColorSeries"><option value="">全部</option>
          ${CONFIG.colorSeries.map(s => `<option value="${s}">${s}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>版型</label>
        <select id="fFit"><option value="">全部</option>
          ${CONFIG.fits.map(f => `<option value="${f}">${f}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>面料</label>
        <select id="fFabric"><option value="">全部</option>
          ${CONFIG.fabrics.map(f => `<option value="${f}">${f}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>颜色</label><input type="text" id="fColor" placeholder="搜索颜色"></div>
      <div class="form-group" style="justify-content:flex-end"><label>&nbsp;</label>
        <button class="btn btn-primary" id="btnFilter">查询</button>
      </div>
    `;
    document.getElementById('btnFilter').addEventListener('click', () => this.applyHistoryFilter());
  }

  applyHistoryFilter() {
    this.historyFilters = {
      region: document.getElementById('fRegion').value,
      brand: document.getElementById('fBrand').value,
      year: document.getElementById('fYear').value,
      season: document.getElementById('fSeason').value,
      styleNo: document.getElementById('fStyleNo').value.trim(),
      subCategory: document.getElementById('fSubCategory').value,
      gender: document.getElementById('fGender').value,
      colorSeries: document.getElementById('fColorSeries').value,
      fit: document.getElementById('fFit').value,
      fabric: document.getElementById('fFabric').value,
      color: document.getElementById('fColor').value.trim(),
    };
    this.renderHistory();
  }

  async renderHistory() {
    const data = await fetchHistoricalData(this.historyFilters);
    const tbody = document.getElementById('historyBody');

    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="15" class="empty-state">暂无匹配数据</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(r => `
      <tr>
        <td>${r.region}</td>
        <td>${r.brand || '-'}</td>
        <td class="num">${r.year}</td>
        <td>${r.season}</td>
        <td>${r.styleNo}</td>
        <td>${r.subCategory}</td>
        <td>${r.gender}</td>
        <td>${r.color}</td>
        <td class="num">${this.formatPrice(r.standardPrice)}</td>
        <td><span class="tag tag-series">${r.colorSeries}</span></td>
        <td>${r.fabric || '-'}</td>
        <td><span class="tag tag-fit">${r.fit}</span></td>
        <td class="num">${r.orderQty.toLocaleString()}</td>
        <td class="num">${r.totalSales.toLocaleString()}</td>
        <td>${this.formatSizeBrief(r.salesBySize)}</td>
      </tr>
    `).join('');
  }

  formatPrice(price) {
    if (!price) return '-';
    return Number(price).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  unplacedQtyTone(value) {
    if (value < 0) return 'tone-negative';
    if (value === 0) return 'tone-zero';
    return 'tone-positive';
  }

  formatSizeBrief(sizes) {
    return Object.entries(sizes)
      .filter(([, v]) => v > 0)
      .map(([s, v]) => `${s}:${v}`)
      .join(' ');
  }

  /* ---- 新建订货 ---- */
  renderCreateForm() {
    const historyOpts = getHistoryRecommendOptions();
    const { styleNos, articleNos, genders, subCategories, fits, colorSeries, fabrics } = historyOpts;

    document.getElementById('createForm').innerHTML = `
      <div class="form-group"><label>区域</label>
        <select id="selRegion">${CONFIG.regions.map(r => `<option value="${r}">${r}</option>`).join('')}</select>
      </div>
      <div class="form-group form-group-wide"><label>款号</label><div id="styleAutocompleteWrap"></div></div>
      <div class="form-group"><label>货号</label>
        <input type="text" id="inpArticleNo" list="articleNoList" placeholder="自动识别" autocomplete="off" readonly>
        <datalist id="articleNoList"></datalist>
      </div>
      <div class="form-group"><label>标准价</label><input id="inpPrice" readonly placeholder="自动识别"></div>
      <div class="form-group"><label>面料</label><input id="inpFabric" readonly placeholder="自动识别"></div>
      <div class="form-group"><label>版型</label><input id="inpFit" readonly placeholder="自动识别"></div>
      <div class="form-group"><label>色系</label><input id="inpSeries" readonly placeholder="自动识别"></div>
      <div class="form-group"><label>订货量</label><input id="inpOrderQty" readonly placeholder="自动识别"></div>
      <div class="form-group"><label>推荐订货量</label><input type="number" id="inpQty" min="1" placeholder="可手动填写"></div>
    `;

    const recField = (id, label, options) => `
      <div class="form-group"><label>${label}<span class="form-optional">选填</span></label>
        <input type="text" id="${id}" list="${id}List" placeholder="默认" autocomplete="off">
        <datalist id="${id}List">${options.map(v => `<option value="${v}"></option>`).join('')}</datalist>
      </div>`;

    document.getElementById('createRecommendForm').innerHTML = `
      <div class="form-group form-group-label">
        <label>智能推荐</label>
        <span class="form-hint">${getCreateRecommendSourceHint()}</span>
      </div>
      ${recField('recStyleNo', '款号', styleNos)}
      ${recField('recArticleNo', '货号', articleNos)}
      ${recField('recGender', '性别', genders)}
      ${recField('recSubCategory', '中类', subCategories)}
      ${recField('recFit', '版型', fits)}
      ${recField('recColorSeries', '色系', colorSeries)}
      ${recField('recFabric', '面料', fabrics)}
      <div class="form-group" style="justify-content:flex-end"><label>&nbsp;</label>
        <button class="btn btn-primary" id="btnRecommend">生成推荐</button>
      </div>
    `;

    const region = document.getElementById('selRegion').value;
    const styles = getStyleOptions(region);
    this.styleAutocomplete = initStyleAutocomplete('styleAutocompleteWrap', styles, () => this.onStyleChange());
    document.getElementById('selRegion').addEventListener('change', () => this.onRegionChange());
    document.getElementById('btnRecommend').addEventListener('click', () => this.generateRecommend());
    const inpQty = document.getElementById('inpQty');
    inpQty.addEventListener('change', () => this.onQtyChange());
    inpQty.addEventListener('input', () => this.onQtyChange());
    this.updateArticleNoDatalist();
    this.onStyleChange();
  }

  updateArticleNoDatalist() {
    const region = document.getElementById('selRegion')?.value ?? '';
    const { styleNo, color } = parseSkuKey(this.getSelectedSkuKey());
    const current = styleNo && color ? getCurrentItemByStyleColor(styleNo, color, region) : null;
    const options = getStyleNoOptions({
      region,
      productNo: current?.productNo,
      color: color || undefined,
    });
    const list = document.getElementById('articleNoList');
    if (!list) return;
    list.innerHTML = options.map(v => `<option value="${v}"></option>`).join('');
  }

  onRegionChange() {
    const region = document.getElementById('selRegion').value;
    const styles = getStyleOptions(region);
    this.styleAutocomplete = initStyleAutocomplete('styleAutocompleteWrap', styles, () => this.onStyleChange());
    this.updateArticleNoDatalist();
    this.onStyleChange();
  }

  getSelectedSkuKey() {
    return this.styleAutocomplete?.getValue() ?? '';
  }

  fillStyleMetaFromSku(skuKey, region) {
    const { styleNo, color } = parseSkuKey(skuKey);
    const current = styleNo && color ? getCurrentItemByStyleColor(styleNo, color, region) : null;
    document.getElementById('inpSeries').value = current?.colorSeries ?? '';
    document.getElementById('inpFabric').value = current?.fabric ?? '';
    document.getElementById('inpFit').value = current?.fit ?? '';
    document.getElementById('inpPrice').value = current ? this.formatPrice(current.standardPrice) : '';
    document.getElementById('inpArticleNo').value = current?.styleNo ?? '';
    document.getElementById('inpOrderQty').value = current?.orderQty ? current.orderQty.toLocaleString() : '';
    this.updateArticleNoDatalist();
  }

  async applyPrefill({ styleNo, color, region }) {
    if (region) {
      document.getElementById('selRegion').value = region;
      const styles = getStyleOptions(region);
      this.styleAutocomplete = initStyleAutocomplete('styleAutocompleteWrap', styles, () => this.onStyleChange());
    }
    this.styleAutocomplete.setValue(`${styleNo}|${color}`);
    this.onStyleChange();
    const local = await getLocalOrder(region, styleNo, color);
    if (local) {
      this.loadLocalDraft(local);
      return;
    }
    this.generateRecommend();
  }

  loadLocalDraft(local) {
    document.getElementById('inpQty').value = local.quantity;
    document.getElementById('inpArticleNo').value = local.styleNo ?? '';
    const current = getCurrentItemByStyleColor(local.styleNo, local.color, local.region);
    const { templateKeys, sizeBandRange } = current
      ? getCatalogSizeTemplate(current)
      : { templateKeys: orderCatalogSizeKeys(local.sizes ?? {}), sizeBandRange: '' };
    const sizes = Object.fromEntries(
      templateKeys.map(s => [s, local.sizes?.[s] ?? 0]),
    );
    let historySizes = {};
    if (current) {
      try {
        historySizes = recommendOrder(current, {}).historySizes;
      } catch {
        historySizes = {};
      }
    }
    this.draft = {
      styleNo: local.styleNo,
      color: local.color,
      subCategory: local.subCategory ?? current?.subCategory ?? '',
      gender: local.gender ?? current?.gender ?? '',
      fit: local.fit ?? current?.fit ?? '',
      fabric: local.fabric ?? current?.fabric ?? '',
      standardPrice: local.standardPrice ?? current?.standardPrice ?? 0,
      colorSeries: local.colorSeries ?? current?.colorSeries ?? '',
      productNo: local.productNo ?? current?.productNo ?? '',
      quantity: local.quantity,
      sizes,
      sizeTemplate: templateKeys,
      sizeBandRange,
      historySizes,
      benchmarkKey: '已保存订货',
      historyMatchCount: 0,
      historyTotal: 0,
    };
    document.getElementById('recommendArea').innerHTML = `
      <div class="recommend-box">
        <h4>已保存订货 · ${local.styleNo} · ${local.color}</h4>
        <p class="recommend-saved-hint">继续编辑尺码后保存，数据将写入本地 SQLite 数据库。</p>
      </div>`;
    this.renderSizeEditor(sizes, { sizeTemplate: templateKeys, sizeBandRange });
    this.showSizeEditor();
  }

  onStyleChange() {
    const skuKey = this.getSelectedSkuKey();
    const region = document.getElementById('selRegion').value;
    if (!skuKey) {
      document.getElementById('inpPrice').value = '';
      document.getElementById('inpFabric').value = '';
      document.getElementById('inpFit').value = '';
      document.getElementById('inpSeries').value = '';
      document.getElementById('inpArticleNo').value = '';
      document.getElementById('inpOrderQty').value = '';
      this.draft = null;
      this.hideSizeEditor();
      document.getElementById('recommendArea').innerHTML = '';
      this.updateArticleNoDatalist();
      return;
    }
    const { styleNo, color } = parseSkuKey(skuKey);
    if (this.draft && (this.draft.styleNo !== styleNo || this.draft.color !== color || this.draft.region !== region)) {
      this.draft = null;
      this.hideSizeEditor();
      document.getElementById('recommendArea').innerHTML = '';
      document.getElementById('inpQty').value = '';
    }
    this.fillStyleMetaFromSku(skuKey, region);
  }

  getRecommendOverrides() {
    const val = id => document.getElementById(id)?.value.trim() ?? '';
    return {
      styleNo: val('recStyleNo'),
      articleNo: val('recArticleNo'),
      gender: val('recGender'),
      subCategory: val('recSubCategory'),
      fit: val('recFit'),
      colorSeries: val('recColorSeries'),
      fabric: val('recFabric'),
    };
  }

  async generateRecommend() {
    const skuKey = this.getSelectedSkuKey();
    const region = document.getElementById('selRegion').value;
    if (!skuKey) { this.toast('请选择款色', 'error'); return; }

    const { styleNo, color } = parseSkuKey(skuKey);
    let current = null;
    try {
      await reloadHistoryData();
      current = getCurrentItemByStyleColor(styleNo, color, region);
      if (!current) {
        throw new Error(`当前订货单中未找到：${region} / ${styleNo} / ${color}`);
      }
      const rec = recommendOrder(current, this.getRecommendOverrides());
      rec.productNo = current.productNo || '';
      this.draft = rec;
      document.getElementById('inpQty').value = rec.quantity;
      document.getElementById('inpFabric').value = rec.fabric || current.fabric || '';
      document.getElementById('inpFit').value = rec.fit || current.fit || '';
      this.renderRecommend(rec);
      this.renderSizeEditor(rec.sizes, {
        sizeTemplate: rec.sizeTemplate,
        sizeBandRange: rec.sizeBandRange,
        warn: rec.benchmarkRelaxed,
        warnMessage: rec.benchmarkRelaxed
          ? `尺码明细编辑（${rec.relaxedLabel}，请核对）`
          : '',
      });
      this.showSizeEditor();
    } catch (err) {
      this.toast(err.message, 'error');
      if (!current || err.code === RECOMMEND_ERR.NO_SIZE_TEMPLATE) return;

      const { templateKeys, sizeBandRange } = getCatalogSizeTemplate(current);
      if (!templateKeys.length) return;

      const qty = Math.max(0, current.orderQty || 0);
      const sizes = buildEmptySizeMap(templateKeys);
      const manualHint = err.code === RECOMMEND_ERR.SIZE_DETAIL_MISMATCH
        ? '历史基准与当前尺码明细无法匹配，请手动填写各尺码数量。'
        : '未找到历史基准，请手动填写各尺码数量。';

      this.draft = {
        styleNo: current.styleNo,
        color: current.color,
        subCategory: current.subCategory,
        gender: current.gender,
        fit: current.fit,
        colorSeries: current.colorSeries,
        region: current.region,
        standardPrice: current.standardPrice,
        productNo: current.productNo || '',
        quantity: qty || sumSizes(sizes),
        sizes,
        sizeTemplate: templateKeys,
        sizeBandRange,
        historySizes: {},
        benchmarkKey: '手动填写',
        historyMatchCount: 0,
        historyTotal: 0,
        benchmarkRelaxed: true,
        manualFill: true,
        manualReason: err.code,
      };
      document.getElementById('inpQty').value = this.draft.quantity;
      document.getElementById('recommendArea').innerHTML = `
        <div class="recommend-box recommend-box-warn">
          <h4>需手动填写 · ${current.styleNo} · ${current.color}</h4>
          <p class="recommend-saved-hint">${manualHint}</p>
        </div>`;
      this.renderSizeEditor(sizes, {
        sizeTemplate: templateKeys,
        sizeBandRange,
        warn: true,
        warnMessage: '尺码明细编辑（请按尺码带手动填写）',
      });
      this.showSizeEditor();
    }
  }

  ensureDraftFromSelection() {
    const skuKey = this.getSelectedSkuKey();
    if (!skuKey) {
      this.toast('请选择款色', 'error');
      return null;
    }
    const region = document.getElementById('selRegion').value;
    const { styleNo, color } = parseSkuKey(skuKey);
    const current = getCurrentItemByStyleColor(styleNo, color, region);
    if (!current) {
      this.toast(`当前订货单中未找到：${region} / ${styleNo} / ${color}`, 'error');
      return null;
    }

    const { templateKeys, sizeBandRange } = getCatalogSizeTemplate(current);
    if (!templateKeys.length) {
      this.toast('未找到款色尺码明细', 'error');
      return null;
    }

    if (this.draft?.styleNo === styleNo && this.draft?.color === color && this.draft?.region === region) {
      return this.draft;
    }

    try {
      const rec = recommendOrder(current, this.getRecommendOverrides());
      rec.productNo = current.productNo || '';
      this.draft = rec;
      document.getElementById('inpFabric').value = rec.fabric || current.fabric || '';
      document.getElementById('inpFit').value = rec.fit || current.fit || '';
      this.renderRecommend(rec);
      return this.draft;
    } catch (err) {
      if (err.code === RECOMMEND_ERR.NO_SIZE_TEMPLATE) {
        this.toast(err.message, 'error');
        return null;
      }
      this.draft = {
        styleNo: current.styleNo,
        color: current.color,
        subCategory: current.subCategory,
        gender: current.gender,
        fit: current.fit,
        colorSeries: current.colorSeries,
        region: current.region,
        standardPrice: current.standardPrice,
        productNo: current.productNo || '',
        sizeTemplate: templateKeys,
        sizeBandRange,
        historySizes: {},
        sizes: buildEmptySizeMap(templateKeys),
        quantity: 0,
        manualFill: true,
        benchmarkRelaxed: true,
        relaxedLabel: '手动填写',
        benchmarkKey: '手动填写',
        historyMatchCount: 0,
        historyTotal: 0,
      };
      return this.draft;
    }
  }

  applyQtyToDraft(qty) {
    const draft = this.ensureDraftFromSelection();
    if (!draft) return;

    draft.quantity = qty;
    draft.sizes = calcSizeBreakdown(qty, draft.historySizes ?? {}, draft.sizeTemplate);
    this.renderSizeEditor(draft.sizes, {
      sizeTemplate: draft.sizeTemplate,
      sizeBandRange: draft.sizeBandRange,
      historySizes: draft.historySizes,
      warn: draft.benchmarkRelaxed || draft.manualFill,
      warnMessage: draft.manualFill
        ? '尺码明细编辑（按历史占比或均分，可调整）'
        : draft.benchmarkRelaxed
          ? `尺码明细编辑（${draft.relaxedLabel}，请核对）`
          : '',
    });
    this.showSizeEditor();
    if (!draft.manualFill) {
      this.renderRecommend({ ...draft, quantity: qty, sizes: draft.sizes });
    }
  }

  onQtyChange() {
    const qty = parseInt(document.getElementById('inpQty').value, 10);
    if (!Number.isFinite(qty) || qty <= 0) return;
    this.applyQtyToDraft(qty);
  }

  renderRecommend(rec) {
    if (rec.manualFill) return;
    const warnClass = rec.benchmarkRelaxed ? ' recommend-box-warn' : '';
    const relaxedHint = rec.benchmarkRelaxed
      ? `<p class="recommend-saved-hint">匹配已${rec.relaxedLabel}，推荐结果仅供参考，请核对尺码明细。</p>`
      : '';
    document.getElementById('recommendArea').innerHTML = `
      <div class="recommend-box${warnClass}">
        <h4>智能推荐 · ${rec.styleNo} ${rec.subCategory} · ${rec.color}</h4>
        ${relaxedHint}
        <div class="recommend-stats">
          <span>匹配基准<strong>${rec.benchmarkKey}</strong></span>
          <span>历年样本<strong>${rec.historyMatchCount}</strong>条</span>
          <span>${rec.qtyBasisLabel ?? '基准销量'}<strong>${(rec.maxSalesInPool ?? 0).toLocaleString()}</strong>件</span>
          <span>换算<strong>÷ ${(rec.salesToOrderRatio * 100).toFixed(0)}%</strong></span>
          <span>建议订货<strong>${rec.quantity.toLocaleString()}</strong>件</span>
        </div>
        <div class="size-compare">
          <div class="size-compare-col">
            <h5>历史尺码占比</h5>
            ${this.renderBarChart(rec.historySizes, 'history')}
          </div>
          <div class="size-compare-col">
            <h5>推荐订货尺码</h5>
            ${this.renderBarChart(rec.sizes, 'order', rec.sizeTemplate)}
          </div>
        </div>
      </div>
    `;
  }

  renderBarChart(sizes, cls, sizeTemplate = null) {
    const keys = sizeTemplate?.length ? sizeTemplate : orderCatalogSizeKeys(sizes);
    const max = Math.max(...Object.values(sizes), 1);
    return `<div class="bar-chart">${keys.map(s => {
      const val = sizes[s] ?? 0;
      const pct = Math.round(val / max * 100);
      return `<div class="bar-row">
        <span class="bar-label">${s}</span>
        <div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>
        <span class="bar-val">${val}</span>
      </div>`;
    }).join('')}</div>`;
  }

  calcSizeSharePct(qty, total) {
    if (!total) return 0;
    return Math.round(qty / total * 100);
  }

  updateSizeShareDisplay(sizes, sizeKeys) {
    const total = sumSizes(sizes);
    sizeKeys.forEach(s => {
      const el = document.getElementById('sizeEditor')?.querySelector(`.size-pct[data-size="${s}"]`);
      if (el) el.textContent = `${this.calcSizeSharePct(sizes[s] ?? 0, total)}%`;
    });
  }

  formatRecommendSharePct(pct) {
    return pct == null ? '-' : `${pct}%`;
  }

  renderSizeEditor(sizes, { warn = false, warnMessage = '', sizeTemplate = null, sizeBandRange = '', productNo = '', historySizes = null } = {}) {
    const sizeKeys = sizeTemplate?.length ? sizeTemplate : orderCatalogSizeKeys(sizes);
    const total = sumSizes(sizes);
    const historyBase = historySizes ?? this.draft?.historySizes ?? {};
    const recommendPcts = calcHistorySizeSharePct(historyBase, sizeKeys);
    const warnClass = warn ? ' size-editor-warn' : '';
    const headerText = warn
      ? (warnMessage || '尺码明细编辑（请核对）')
      : '尺码明细编辑';
    const bandHint = sizeBandRange
      ? `<div class="size-editor-band">尺码带范围：${sizeBandRange}</div>`
      : '';
    const productNoResolved = productNo || this.draft?.productNo || '';
    const imageUrl = getProductImageUrl(productNoResolved);
    const imageAlt = String(productNoResolved).replace(/"/g, '&quot;');
    const imageCard = imageUrl
      ? `<div class="size-editor-product-card">
          <img class="size-editor-product-img" src="${imageUrl}" alt="${imageAlt}" title="${imageAlt}">
        </div>`
      : `<div class="size-editor-product-card size-editor-product-card-empty">
          <span class="size-editor-product-placeholder">${productNoResolved ? '暂无图片' : '请选择款色'}</span>
        </div>`;
    document.getElementById('sizeEditor').innerHTML = `
      <div class="size-editor-block${warnClass}">
        <div class="size-editor-layout">
          <div class="size-editor-main">
            <div class="size-editor-top-left">
              <div class="size-editor-header">${headerText}</div>
              <div class="size-editor-actions">
                <button type="button" class="btn btn-primary" id="btnSaveOrder">保存订货单</button>
                <button type="button" class="btn btn-outline" id="btnResetForm">重置</button>
              </div>
            </div>
            ${bandHint}
            <div class="size-editor-row">
              <div class="size-editor-grid-wrap">
                <div class="size-grid size-grid-editor">
                  <div class="size-item size-total-item">
                    <label>尺码合计</label>
                    <output class="size-total-value" id="sizeTotal">${total}</output>
                  </div>
                  ${sizeKeys.map(s => `
                    <div class="size-item">
                      <label>${s}</label>
                      <input type="number" min="0" step="1" data-size="${s}" value="${Math.max(0, sizes[s] ?? 0)}">
                    </div>
                  `).join('')}
                </div>
                <div class="size-grid size-grid-editor size-grid-pct">
                  <div class="size-item size-pct-label"><span>占比</span></div>
                  ${sizeKeys.map(s => `
                    <div class="size-item">
                      <span class="size-pct" data-size="${s}">${this.calcSizeSharePct(sizes[s] ?? 0, total)}%</span>
                    </div>
                  `).join('')}
                </div>
                <div class="size-grid size-grid-editor size-grid-pct size-grid-rec-pct">
                  <div class="size-item size-pct-label"><span>推荐占比</span></div>
                  ${sizeKeys.map(s => `
                    <div class="size-item">
                      <span class="size-rec-pct" data-size="${s}">${this.formatRecommendSharePct(recommendPcts[s])}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>
          ${imageCard}
        </div>
      </div>
    `;

    bindImageZoomClick(document.getElementById('sizeEditor'), '.size-editor-product-img');

    document.getElementById('sizeEditor').querySelectorAll('input[data-size]').forEach(input => {
      input.addEventListener('input', () => {
        if (!this.draft) return;
        const qty = parseSizeQty(input.value);
        if (String(input.value) !== '' && qty !== Number(input.value)) {
          input.value = qty;
        }
        this.draft.sizes[input.dataset.size] = qty;
        const nextTotal = sumSizes(this.draft.sizes);
        this.draft.quantity = nextTotal;
        document.getElementById('sizeTotal').textContent = nextTotal;
        document.getElementById('inpQty').value = nextTotal;
        this.updateSizeShareDisplay(this.draft.sizes, sizeKeys);
      });
    });
  }

  showSizeEditor() {
    document.getElementById('sizeEditor').style.display = '';
  }

  hideSizeEditor() {
    document.getElementById('sizeEditor').innerHTML = '';
    document.getElementById('sizeEditor').style.display = 'none';
  }

  bindCreateActions() {
    document.getElementById('panel-create').addEventListener('click', e => {
      if (e.target.id === 'btnSaveOrder') this.saveOrder();
      if (e.target.id === 'btnResetForm') this.resetCreateForm();
    });
  }

  async saveOrder() {
    if (!this.draft) { this.toast('请先填写推荐订货量或生成推荐', 'error'); return; }

    const sizes = Object.fromEntries(
      this.draft.sizeTemplate.map(s => [s, parseSizeQty(this.draft.sizes[s])]),
    );
    this.draft.sizes = sizes;
    const qty = sumSizes(sizes);
    if (qty <= 0) { this.toast('尺码合计必须大于 0', 'error'); return; }
    this.draft.quantity = qty;
    document.getElementById('inpQty').value = qty;

    try {
      validateOrder({
        region: document.getElementById('selRegion').value,
        styleNo: this.draft.styleNo,
        color: this.draft.color,
        quantity: this.draft.quantity,
        sizes,
        sizeTemplate: this.draft.sizeTemplate,
      });
      await upsertOrder({
        region: document.getElementById('selRegion').value,
        styleNo: this.draft.styleNo,
        productNo: this.draft.productNo || '',
        subCategory: this.draft.subCategory,
        gender: this.draft.gender,
        color: this.draft.color,
        standardPrice: this.draft.standardPrice,
        colorSeries: this.draft.colorSeries,
        fit: this.draft.fit,
        fabric: this.draft.fabric ?? document.getElementById('inpFabric')?.value ?? '',
        quantity: this.draft.quantity,
        sizes,
      });
      this.toast('订货单已保存到本地数据库', 'success');
      const backToOrders = this.returnToOrdersAfterSave;
      this.resetCreateForm();
      if (backToOrders) this.switchTab('orders');
    } catch (err) {
      this.toast(err.message, 'error');
    }
  }

  resetCreateForm() {
    this.returnToOrdersAfterSave = false;
    this.draft = null;
    document.getElementById('recommendArea').innerHTML = '';
    this.hideSizeEditor();
    document.getElementById('inpQty').value = '';
    document.getElementById('inpOrderQty').value = '';
    this.onStyleChange();
  }

  prefillOrder(styleNo, color, region) {
    this.returnToOrdersAfterSave = true;
    this.pendingPrefill = { styleNo, color, region };
    this.switchTab('create');
  }

  /* ---- 订货单 ---- */
  destroyOrderFilters() {
    this.orderFilterControls.forEach(c => c.destroy());
    this.orderFilterControls = [];
  }

  renderOrderTableHead(allOrders) {
    const filterableKeys = new Set(ORDER_HEAD_COLUMNS.filter(c => c.filter).map(c => c.key));
    for (const key of Object.keys(this.orderFilters)) {
      if (!filterableKeys.has(key)) delete this.orderFilters[key];
    }

    const thClass = col => [col.num && 'num', col.compact && 'col-fit', col.image && 'col-image'].filter(Boolean).join(' ');
    const thead = document.getElementById('orderHead');
    thead.innerHTML = `
      <tr class="order-head-row">
        ${ORDER_HEAD_COLUMNS.map(col => `
          <th class="${thClass(col)}" data-col="${col.key}">
            <div class="th-title">${col.label}</div>
            ${col.filter ? `<div class="header-filter-slot" data-field="${col.key}"></div>` : ''}
          </th>
        `).join('')}
      </tr>
    `;

    thead.querySelectorAll('.header-filter-slot').forEach(slot => {
      const key = slot.dataset.field;
      const col = ORDER_HEAD_COLUMNS.find(c => c.key === key);
      const options = buildOrderFilterOptions(allOrders, key, { num: col?.num });
      const control = mountHeaderFilter(slot, {
        options,
        value: this.orderFilters[key] ?? '',
        onChange: val => {
          if (val) this.orderFilters[key] = val;
          else delete this.orderFilters[key];
          this.renderOrderTableBody(allOrders);
        },
      });
      this.orderFilterControls.push(control);
    });
  }

  renderOrderTableBody(allOrders) {
    const orders = filterOrderRecords(allOrders, this.orderFilters);
    const stats = getCurrentOrderSummary(orders);
    const colCount = ORDER_HEAD_COLUMNS.length;
    const tbody = document.getElementById('orderBody');
    const tfoot = document.getElementById('orderFoot');

    document.getElementById('orderKpi').innerHTML = `
      <div class="kpi-card kpi-style-group">
        <div class="kpi-style-main">
          <div class="kpi-style-item">
            <div class="kpi-label">实际订货款色数</div>
            <div class="kpi-value">${stats.orderedStyleCount}<small>款色</small></div>
          </div>
          <div class="kpi-style-item">
            <div class="kpi-label">实际下单款色数</div>
            <div class="kpi-value">${stats.placedStyleCount}<small>款色</small></div>
          </div>
        </div>
        <div class="kpi-style-footer">
          <span>提供款色数：<strong>${stats.providedCount}</strong>款色</span>
          <span>已订未下：<strong>${stats.unplacedStyleCount}</strong>款色</span>
        </div>
      </div>
      <div class="kpi-card kpi-style-group">
        <div class="kpi-style-main">
          <div class="kpi-style-item">
            <div class="kpi-label">实际订货量</div>
            <div class="kpi-value">${stats.orderedQty.toLocaleString()}<small>件</small></div>
          </div>
          <div class="kpi-style-item">
            <div class="kpi-label">实际下单量</div>
            <div class="kpi-value">${stats.placedQty.toLocaleString()}<small>件</small></div>
          </div>
        </div>
        <div class="kpi-style-footer">
          <span>订货总量：<strong>${stats.totalQty.toLocaleString()}</strong>件</span>
          <span>未下单量：<strong class="${this.unplacedQtyTone(stats.unplacedQty)}">${stats.unplacedQty.toLocaleString()}</strong>件</span>
        </div>
      </div>
      <div class="kpi-card"><div class="kpi-label">买货额</div><div class="kpi-value">${this.formatPrice(stats.purchaseAmount)}<small>元</small></div></div>
      <div class="kpi-card"><div class="kpi-label">订货吊牌额</div><div class="kpi-value">${this.formatPrice(stats.tagAmount)}<small>元</small></div></div>
    `;

    if (orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${colCount}" class="empty-state">${allOrders.length ? '暂无匹配数据' : '暂无订货数据'}</td></tr>`;
      tfoot.innerHTML = '';
      return;
    }

    const totalSizeQty = orders.reduce(
      (s, o) => s + (hasActiveOrderRow(o) ? getOrderDisplaySizeTotal(o) : 0),
      0,
    );
    const footerSizeMismatch = stats.totalQty !== totalSizeQty;
    const footerMismatchClass = footerSizeMismatch
      ? (orders.some(o => getOrderSizeMismatchKind(o) === 'placed') ? ' num-mismatch' : ' num-mismatch-catalog')
      : '';
    tbody.innerHTML = orders.map(o => {
      const hasOrder = hasActiveOrderRow(o);
      const sizeTotal = getOrderDisplaySizeTotal(o);
      const sizeDetail = hasOrder ? buildOrderListSizeDetail(o) : '';
      const imageUrl = getProductImageUrl(o.productNo);
      const imageAlt = String(o.productNo ?? '').replace(/"/g, '&quot;');
      const mismatchKind = getOrderSizeMismatchKind(o);
      const mismatchClass = mismatchKind === 'placed'
        ? 'num num-mismatch'
        : mismatchKind === 'catalog'
          ? 'num num-mismatch-catalog'
          : 'num';
      const sizeTotalText = !hasOrder
        ? '-'
        : sizeTotal > 0
          ? sizeTotal.toLocaleString()
          : o.orderQty > 0
            ? '0'
            : '-';
      return `
      <tr>
        <td>${o.region}</td>
        <td class="col-fit">${o.brand || '-'}</td>
        <td class="col-image">${imageUrl
          ? `<img class="order-product-thumb" src="${imageUrl}" alt="${imageAlt}" loading="lazy" title="${imageAlt}">`
          : '-'}</td>
        <td>${o.productNo || '-'}</td>
        <td>${o.styleNo}</td>
        <td>${o.subCategory}</td>
        <td class="col-fit">${o.gender}</td>
        <td class="col-fit">${o.color}</td>
        <td class="num col-fit">${this.formatPrice(o.standardPrice)}</td>
        <td><span class="tag tag-series">${o.colorSeries || '-'}</span></td>
        <td>${o.fabric || '-'}</td>
        <td><span class="tag tag-fit">${o.fit || '-'}</span></td>
        <td>${hasOrder ? (o.sizeBandRange || '-') : '-'}</td>
        <td class="${mismatchClass}">${o.orderQty.toLocaleString()}</td>
        <td class="${mismatchClass}">${sizeTotalText}</td>
        <td>${sizeDetail || '-'}</td>
        <td><span class="action-link" data-action="order" data-style="${o.styleNo}" data-color="${o.color}" data-region="${o.region}">去订货</span></td>
      </tr>
    `;
    }).join('');

    tfoot.innerHTML = `
      <tr class="order-table-total-row">
        <td colspan="5"><strong>合计</strong></td>
        <td colspan="4">提供 ${stats.providedCount} 款色 · 订货 ${stats.orderedStyleCount} · 下单 ${stats.placedStyleCount} · 未下单 ${stats.unplacedStyleCount}</td>
        <td class="num" title="订货吊牌额">${this.formatPrice(stats.tagAmount)}</td>
        <td class="num" colspan="2" title="买货额">买货额 ${this.formatPrice(stats.purchaseAmount)}</td>
        <td></td>
        <td class="num">${stats.totalQty.toLocaleString()}</td>
        <td class="num${footerMismatchClass}">${totalSizeQty.toLocaleString()}</td>
        <td colspan="2"></td>
      </tr>
    `;

    tbody.querySelectorAll('[data-action="order"]').forEach(link => {
      link.addEventListener('click', () => {
        this.prefillOrder(link.dataset.style, link.dataset.color, link.dataset.region);
      });
    });
    bindImageZoomClick(tbody);
  }

  async renderOrders() {
    await initPicService();
    const allOrders = await mergeCatalogWithLocalSizes(await fetchCurrentOrderList());
    this.allOrders = allOrders;
    this.destroyOrderFilters();
    this.renderOrderTableHead(allOrders);
    this.renderOrderTableBody(allOrders);
    this.updateAutoMatchButton(allOrders);
    this.updateClearPlacedButton(allOrders);
  }

  updateClearPlacedButton(allOrders) {
    const btn = document.getElementById('btnClearPlaced');
    if (!btn) return;
    const count = allOrders.filter(isPlacedOrderRow).length;
    btn.textContent = count > 0 ? `一键清除 (${count})` : '一键清除';
    btn.disabled = count === 0;
  }

  updateAutoMatchButton(allOrders) {
    const btn = document.getElementById('btnAutoMatch');
    if (!btn) return;
    const count = allOrders.filter(isUnplacedOrderRow).length;
    btn.textContent = count > 0 ? `一键匹配下单 (${count})` : '一键匹配下单';
    btn.disabled = count === 0;
  }

  async autoMatchAllOrders() {
    const btn = document.getElementById('btnAutoMatch');
    try {
      await reloadDataService();
      await reloadHistoryData();
      const allOrders = await mergeCatalogWithLocalSizes(await fetchCurrentOrderList());
      const unplaced = allOrders.filter(isUnplacedOrderRow);
      if (!unplaced.length) {
        this.toast('没有需要匹配的未下款项色', 'error');
        return;
      }
      if (!window.confirm(`将对 ${unplaced.length} 个未下款项色按历史尺码比例智能匹配并下单，是否继续？`)) {
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.textContent = '匹配中…';
      }
      const result = await runAutoMatchOrders(unplaced, upsertOrder);
      if (result.failed.length) {
        const sample = result.failed.slice(0, 2).map(f => `${f.styleNo}/${f.color}`).join('、');
        const suffix = result.failed.length > 2 ? '…' : '';
        this.toast(`成功 ${result.success} 款，失败 ${result.failed.length} 款（${sample}${suffix}）`, 'error');
      } else if (result.success === 0) {
        this.toast('全部款色匹配失败，请检查历史基准与尺码明细', 'error');
      } else {
        this.toast(`一键匹配下单完成，共 ${result.success} 款`, 'success');
      }
    } catch (err) {
      this.toast(err.message || '一键匹配下单失败', 'error');
    } finally {
      await this.renderOrders().catch(() => {
        if (btn) btn.disabled = false;
      });
    }
  }

  async clearAllPlacedOrders() {
    await reloadDataService();
    const allOrders = await mergeCatalogWithLocalSizes(await fetchCurrentOrderList());
    const placed = allOrders.filter(isPlacedOrderRow);
    if (!placed.length) {
      this.toast('没有已下单的尺码可清除', 'error');
      return;
    }
    if (!window.confirm(`将清除 ${placed.length} 个款色的已下单尺码明细，是否继续？`)) {
      return;
    }

    const btn = document.getElementById('btnClearPlaced');
    if (btn) btn.disabled = true;
    try {
      const deleted = await clearAllPlacedOrders();
      await this.renderOrders();
      this.toast(`已清除 ${deleted} 条下单记录`, 'success');
    } catch (err) {
      this.toast(err.message, 'error');
      if (btn) btn.disabled = false;
    }
  }

  async exportCsv() {
    const allOrders = this.allOrders ?? await mergeCatalogWithLocalSizes(await fetchCurrentOrderList());
    const orders = filterOrderRecords(allOrders, this.orderFilters);
    if (orders.length === 0) { this.toast('暂无数据可导出', 'error'); return; }

    const csv = exportCurrentOrdersCsv(orders);
    this.downloadCsv(csv, `订货单_${new Date().toISOString().slice(0, 10)}.csv`);
    this.toast('导出成功', 'success');
  }

  async exportRegionCompare() {
    const { base, current } = await fetchCompareOrders();
    const { regionCompare, baseYear, currentYear } = compareAnnualOrders(base, current);
    if (!regionCompare.length) { this.toast('暂无数据可导出', 'error'); return; }

    const csv = exportRegionCompareCsv(regionCompare, baseYear, currentYear, escapeCsvCell);
    this.downloadCsv(csv, `区域明细对比_${baseYear}_${currentYear}_${new Date().toISOString().slice(0, 10)}.csv`);
    this.toast('导出成功', 'success');
  }

  async exportSubCategoryCompare() {
    const { base, current } = await fetchCompareOrders();
    const region = document.getElementById('subCategoryRegionFilter')?.value ?? '';
    const [baseYear, currentYear] = CONFIG.compareYears;
    const subCategories = buildSubCategoryCompare(base, current, region);
    if (!subCategories.length) { this.toast('暂无数据可导出', 'error'); return; }

    const regionSuffix = region ? `_${region}` : '';
    const csv = exportSubCategoryCompareCsv(subCategories, baseYear, currentYear, escapeCsvCell);
    this.downloadCsv(csv, `中类明细对比_${baseYear}_${currentYear}${regionSuffix}_${new Date().toISOString().slice(0, 10)}.csv`);
    this.toast('导出成功', 'success');
  }

  downloadCsv(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  toast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }
}

new OrderApp();
