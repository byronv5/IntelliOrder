function formatSkuItem(s) {
  return `
    <span class="sku-cell sku-style">${s.productNo || s.styleNo}</span>
    <span class="sku-cell sku-article">${s.styleNo || '-'}</span>
    <span class="sku-cell sku-color">${s.color}</span>
    <span class="sku-cell sku-gender">${s.gender}</span>
    <span class="sku-cell sku-category">${s.subCategory}</span>
    <span class="sku-cell sku-fit">${s.fit}</span>
  `;
}

/** 款色 Autocomplete（款号 · 货号 · 颜色 · 性别 · 中类 · 版型） */
export function initStyleAutocomplete(containerId, styles, onSelect) {
  const container = document.getElementById(containerId);
  container.innerHTML = `
    <div class="autocomplete" id="styleAutocomplete">
      <input type="text" id="inpStyleSearch" placeholder="搜索款号 / 货号 / 颜色 / 中类" autocomplete="off">
      <input type="hidden" id="inpStyleNo">
      <ul class="autocomplete-list autocomplete-list-sku" id="styleSuggestions"></ul>
    </div>
  `;

  const input = document.getElementById('inpStyleSearch');
  const hidden = document.getElementById('inpStyleNo');
  const list = document.getElementById('styleSuggestions');

  function filter(query) {
    const q = query.trim().toLowerCase();
    if (!q) return styles.slice(0, 12);
    return styles.filter(s =>
      s.searchText.includes(q) || s.label.toLowerCase().includes(q),
    ).slice(0, 12);
  }

  function openList(items) {
    if (items.length === 0) {
      list.innerHTML = '<li class="autocomplete-empty">无匹配款色</li>';
    } else {
      list.innerHTML = `
        <li class="autocomplete-head">
          <span class="sku-cell">款号</span>
          <span class="sku-cell">货号</span>
          <span class="sku-cell">颜色</span>
          <span class="sku-cell">性别</span>
          <span class="sku-cell">中类</span>
          <span class="sku-cell">版型</span>
        </li>
        ${items.map(s => `<li data-value="${s.value}">${formatSkuItem(s)}</li>`).join('')}
      `;
    }
    list.classList.add('open');
  }

  function closeList() {
    list.classList.remove('open');
  }

  function select(value) {
    const style = styles.find(s => s.value === value);
    if (!style) return;
    hidden.value = value;
    input.value = style.label;
    closeList();
    onSelect(value);
  }

  input.addEventListener('input', () => {
    hidden.value = '';
    openList(filter(input.value));
  });

  input.addEventListener('focus', () => openList(filter(input.value)));

  input.addEventListener('keydown', e => {
    const items = list.querySelectorAll('li[data-value]');
    if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault();
      items[0].classList.add('active');
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = list.querySelector('li[data-value]');
      if (first) select(first.dataset.value);
    }
    if (e.key === 'Escape') closeList();
  });

  list.addEventListener('click', e => {
    const li = e.target.closest('li[data-value]');
    if (li) select(li.dataset.value);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#styleAutocomplete')) closeList();
  });

  return {
    getValue: () => hidden.value,
    setValue(value) {
      const style = styles.find(s => s.value === value);
      if (!style) return;
      hidden.value = value;
      input.value = style.label;
    },
    clear() {
      hidden.value = '';
      input.value = '';
    },
  };
}
