/** 表头可搜索下拉筛选（同时仅允许一个展开） */
const openInstances = new Set();

function closeAllExcept(current) {
  for (const inst of openInstances) {
    if (inst !== current) inst._close();
  }
}

export function mountHeaderFilter(container, { options, value = '', onChange }) {
  container.innerHTML = `
    <div class="header-filter-select">
      <button type="button" class="header-filter-trigger" aria-haspopup="listbox">
        <span class="header-filter-text"></span>
        <span class="header-filter-caret">▾</span>
      </button>
      <div class="header-filter-panel">
        <input type="text" class="header-filter-search" placeholder="搜索..." autocomplete="off">
        <ul class="header-filter-list" role="listbox"></ul>
      </div>
    </div>
  `;

  const root = container.querySelector('.header-filter-select');
  const trigger = root.querySelector('.header-filter-trigger');
  const textEl = root.querySelector('.header-filter-text');
  const panel = root.querySelector('.header-filter-panel');
  const searchInput = root.querySelector('.header-filter-search');
  const listEl = root.querySelector('.header-filter-list');

  let currentValue = value;
  let allOptions = [{ value: '', label: '全部' }, ...options];
  let open = false;

  const instance = {
    _close() {
      if (!open) return;
      open = false;
      root.classList.remove('open');
      openInstances.delete(instance);
    },
  };

  function labelOf(val) {
    const hit = allOptions.find(o => o.value === val);
    return hit ? hit.label : '全部';
  }

  function syncTrigger() {
    textEl.textContent = labelOf(currentValue);
    root.classList.toggle('is-active', Boolean(currentValue));
  }

  function positionPanel() {
    const rect = trigger.getBoundingClientRect();
    panel.style.top = `${rect.bottom + 2}px`;
    panel.style.left = `${rect.left}px`;
    panel.style.minWidth = `${Math.max(rect.width, 140)}px`;
  }

  function renderList(query = '') {
    const q = query.trim().toLowerCase();
    const items = allOptions.filter(o =>
      !q || o.label.toLowerCase().includes(q) || String(o.value).toLowerCase().includes(q),
    );
    listEl.innerHTML = items.length
      ? items.map(o => `
          <li role="option" data-value="${escapeAttr(o.value)}" class="${o.value === currentValue ? 'selected' : ''}">
            ${escapeHtml(o.label)}
          </li>
        `).join('')
      : '<li class="header-filter-empty">无匹配项</li>';
  }

  function openPanel() {
    closeAllExcept(instance);
    open = true;
    openInstances.add(instance);
    root.classList.add('open');
    positionPanel();
    renderList('');
    searchInput.value = '';
    searchInput.focus();
  }

  function closePanel() {
    instance._close();
  }

  function select(val) {
    currentValue = val;
    syncTrigger();
    closePanel();
    onChange(val);
  }

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    if (open) closePanel();
    else openPanel();
  });

  searchInput.addEventListener('input', () => renderList(searchInput.value));
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePanel();
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = listEl.querySelector('li[data-value]');
      if (first) select(first.dataset.value);
    }
  });

  listEl.addEventListener('click', e => {
    const li = e.target.closest('li[data-value]');
    if (li) select(li.dataset.value);
  });

  const onDocPointerDown = e => {
    if (!root.contains(e.target)) closePanel();
  };

  const onOuterScroll = e => {
    if (!open) return;
    if (e.target === listEl) return;
    closePanel();
  };

  document.addEventListener('pointerdown', onDocPointerDown, true);
  document.addEventListener('scroll', onOuterScroll, { capture: true, passive: true });

  syncTrigger();

  return {
    setValue(val) {
      currentValue = val ?? '';
      syncTrigger();
    },
    setOptions(next) {
      allOptions = [{ value: '', label: '全部' }, ...next];
      if (!allOptions.some(o => o.value === currentValue)) {
        currentValue = '';
        syncTrigger();
      }
      if (open) renderList(searchInput.value);
    },
    destroy() {
      closePanel();
      document.removeEventListener('pointerdown', onDocPointerDown, true);
      document.removeEventListener('scroll', onOuterScroll, { capture: true });
      container.innerHTML = '';
    },
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}
