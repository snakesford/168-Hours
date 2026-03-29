(function () {
  'use strict';

  var STORAGE_KEY = '168hours-dual-state';
  var VIEW_MODES = ['plan', 'actual', 'compare'];
  var EDIT_BUTTON_IDS = [
    'undo-btn',
    'redo-btn',
    'eraser-btn',
    'erase-all-btn',
    'merge-categories-btn',
    'clear-merge-selection-btn',
    'add-category-btn',
    'reset-categories-btn',
    'add-type-btn',
    'import-calendar-btn'
  ];

  if (typeof window.Y === 'undefined' || typeof window.XJ !== 'function') {
    return;
  }

  var originalM = typeof window.M === 'function' ? window.M : null;
  var originalG = typeof window.G === 'function' ? window.G : null;
  var originalF = typeof window.f === 'function' ? window.f : null;
  var originalL = typeof window.L === 'function' ? window.L : null;
  var originalOJ = typeof window.OJ === 'function' ? window.OJ : null;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function cloneHistory(history) {
    var safe = history && typeof history === 'object' ? history : window.XJ();
    return {
      past: Array.isArray(safe.past) ? clone(safe.past) : [],
      future: Array.isArray(safe.future) ? clone(safe.future) : []
    };
  }

  function normalizeGridArray(grid) {
    return Array.isArray(grid) && grid.length === 168 ? grid.slice() : Array(168).fill('unassigned');
  }

  function normalizeChunkArray(cellChunks) {
    return Array.isArray(cellChunks) && cellChunks.length === 168 ? cellChunks.slice() : Array(168).fill(1);
  }

  function normalizeGridChunks(grid, cellChunks, gridChunks) {
    if (!Array.isArray(gridChunks) || gridChunks.length !== 168) {
      return grid.map(function (categoryId, index) {
        var count = cellChunks[index] || 1;
        return Array(count).fill(categoryId || 'unassigned');
      });
    }
    return gridChunks.map(function (chunk, index) {
      var count = cellChunks[index] || 1;
      if (Array.isArray(chunk) && chunk.length) {
        return chunk.slice(0, count).concat(Array(Math.max(0, count - chunk.length)).fill(grid[index] || 'unassigned'));
      }
      return Array(count).fill(grid[index] || 'unassigned');
    });
  }

  function cloneState(state) {
    var safe = state && typeof state === 'object' ? state : {};
    var grid = normalizeGridArray(safe.grid);
    var cellChunks = normalizeChunkArray(safe.cellChunks);
    return {
      categories: Array.isArray(safe.categories) ? clone(safe.categories) : [],
      groups: Array.isArray(safe.groups) ? clone(safe.groups) : [],
      grid: grid,
      gridChunks: normalizeGridChunks(grid, cellChunks, safe.gridChunks),
      cellChunks: cellChunks,
      activeCategoryId: safe.activeCategoryId || 'unassigned',
      eraserMode: Boolean(safe.eraserMode),
      trackingMode: Boolean(safe.trackingMode),
      types: Array.isArray(safe.types) ? clone(safe.types) : [],
      categoryTypes: safe.categoryTypes && typeof safe.categoryTypes === 'object' ? clone(safe.categoryTypes) : {}
    };
  }

  function blankActualState(baseState) {
    var next = cloneState(baseState);
    next.grid = Array(168).fill('unassigned');
    next.gridChunks = next.cellChunks.map(function (count) {
      return Array(count || 1).fill('unassigned');
    });
    return next;
  }

  function mergeSharedMetadata(targetState, sourceState) {
    var next = cloneState(targetState);
    var source = cloneState(sourceState);
    next.categories = clone(source.categories);
    next.groups = clone(source.groups);
    next.types = clone(source.types);
    next.categoryTypes = clone(source.categoryTypes);
    next.activeCategoryId = source.activeCategoryId;
    next.eraserMode = source.eraserMode;
    next.trackingMode = source.trackingMode;
    return next;
  }

  function sanitizePersistedDual(value) {
    if (!value || typeof value !== 'object') return null;
    if (!value.layers || typeof value.layers !== 'object') return null;
    if (!value.layers.plan || !value.layers.actual) return null;
    return {
      mode: VIEW_MODES.indexOf(value.mode) >= 0 ? value.mode : 'plan',
      layers: {
        plan: cloneState(value.layers.plan),
        actual: mergeSharedMetadata(cloneState(value.layers.actual), value.layers.plan)
      }
    };
  }

  function loadPersistedDual() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return sanitizePersistedDual(JSON.parse(raw));
    } catch (_) {
      return null;
    }
  }

  function savePersistedDual() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        mode: dual.mode,
        layers: {
          plan: cloneState(dual.layers.plan),
          actual: cloneState(dual.layers.actual)
        }
      }));
    } catch (_) {
      /* ignore storage failures */
    }
  }

  var persisted = loadPersistedDual();
  var dual = persisted || {
    mode: 'plan',
    layers: {
      plan: cloneState(window.Y),
      actual: mergeSharedMetadata(blankActualState(window.Y), window.Y)
    },
    histories: {
      plan: cloneHistory(window.N),
      actual: window.XJ()
    }
  };

  if (!dual.histories) {
    dual.histories = {
      plan: cloneHistory(window.N),
      actual: window.XJ()
    };
  }
  if (!dual.histories.plan) dual.histories.plan = cloneHistory(window.N);
  if (!dual.histories.actual) dual.histories.actual = window.XJ();

  function getEditableMode() {
    return dual.mode === 'compare' ? 'actual' : dual.mode;
  }

  function syncActiveIntoDual() {
    if (!window.Y) return;
    var sourceMode = getEditableMode();
    dual.layers[sourceMode] = cloneState(window.Y);
    dual.histories[sourceMode] = cloneHistory(window.N);
    var otherMode = sourceMode === 'plan' ? 'actual' : 'plan';
    dual.layers[otherMode] = mergeSharedMetadata(dual.layers[otherMode], window.Y);
  }

  function applyModeState() {
    var sourceMode = getEditableMode();
    var state = cloneState(dual.layers[sourceMode]);
    var history = cloneHistory(dual.histories[sourceMode]);
    window.Y = state;
    window.N = history;
  }

  function getCategory(categoryId) {
    return (dual.layers.plan.categories || []).find(function (category) {
      return category.id === categoryId;
    }) || null;
  }

  function getCategoryName(categoryId) {
    if (!categoryId || categoryId === 'unassigned') return 'Unassigned';
    var category = getCategory(categoryId);
    return category ? category.name : categoryId;
  }

  function getCategoryColor(categoryId) {
    if (!categoryId || categoryId === 'unassigned') return '#9ca3af';
    var category = getCategory(categoryId);
    return category ? category.color : '#9ca3af';
  }

  function buildUI() {
    var navTitle = document.querySelector('.nav-title');
    var sidebarContent = document.querySelector('.sidebar-content');
    if (!navTitle || !sidebarContent) return;

    if (!document.getElementById('mode-switch')) {
      var switchWrap = document.createElement('div');
      switchWrap.className = 'mode-switch';
      switchWrap.id = 'mode-switch';
      switchWrap.innerHTML = [
        '<button type="button" class="mode-switch-btn" data-mode="plan">Plan</button>',
        '<button type="button" class="mode-switch-btn" data-mode="actual">Actual</button>',
        '<button type="button" class="mode-switch-btn" data-mode="compare">Compare</button>'
      ].join('');
      sidebarContent.appendChild(switchWrap);
    }

    if (!document.getElementById('compare-summary')) {
      var summary = document.createElement('section');
      summary.className = 'compare-summary';
      summary.id = 'compare-summary';
      summary.hidden = true;
      summary.innerHTML = [
        '<div class="compare-summary-head">',
        '  <div class="compare-summary-title">Compare Summary</div>',
        '  <div class="compare-summary-note">Main fill = actual, top stripe = plan</div>',
        '</div>',
        '<div class="compare-summary-grid" id="compare-summary-grid"></div>',
        '<div class="compare-legend">',
        '  <span class="compare-legend-chip"><span class="compare-legend-swatch" style="background:#1c1917"></span>Different</span>',
        '  <span class="compare-legend-chip"><span class="compare-legend-swatch" style="background:#2563eb"></span>Planned only</span>',
        '  <span class="compare-legend-chip"><span class="compare-legend-swatch" style="background:#dc2626"></span>Unplanned actual</span>',
        '</div>'
      ].join('');
      sidebarContent.insertBefore(summary, document.getElementById('type-totals'));
    }
  }

  function updateModeUI() {
    var modeSwitch = document.getElementById('mode-switch');
    if (modeSwitch) {
      modeSwitch.querySelectorAll('[data-mode]').forEach(function (button) {
        button.classList.toggle('active', button.dataset.mode === dual.mode);
      });
    }

    document.body.classList.toggle('compare-mode', dual.mode === 'compare');

    EDIT_BUTTON_IDS.forEach(function (id) {
      var button = document.getElementById(id);
      if (!button) return;
      if (dual.mode === 'compare') {
        button.dataset.dualPrevDisabled = button.disabled ? 'true' : 'false';
        button.disabled = true;
      } else if (button.dataset.dualPrevDisabled) {
        button.disabled = button.dataset.dualPrevDisabled === 'true';
        delete button.dataset.dualPrevDisabled;
      }
    });
  }

  function computeCompareStats() {
    var plan = dual.layers.plan.grid || [];
    var actual = dual.layers.actual.grid || [];
    var stats = {
      matched: 0,
      changed: 0,
      plannedOnly: 0,
      actualOnly: 0
    };

    for (var index = 0; index < 168; index++) {
      var planned = plan[index] || 'unassigned';
      var logged = actual[index] || 'unassigned';
      if (planned === logged) {
        if (planned !== 'unassigned') stats.matched += 1;
        continue;
      }
      if (planned !== 'unassigned' && logged === 'unassigned') {
        stats.plannedOnly += 1;
        continue;
      }
      if (planned === 'unassigned' && logged !== 'unassigned') {
        stats.actualOnly += 1;
        continue;
      }
      stats.changed += 1;
    }

    return stats;
  }

  function renderCompareSummary() {
    var summary = document.getElementById('compare-summary');
    var grid = document.getElementById('compare-summary-grid');
    if (!summary || !grid) return;

    if (dual.mode !== 'compare') {
      summary.hidden = true;
      return;
    }

    var stats = computeCompareStats();
    summary.hidden = false;
    grid.innerHTML = [
      { label: 'Matched', value: stats.matched },
      { label: 'Changed', value: stats.changed },
      { label: 'Planned only', value: stats.plannedOnly },
      { label: 'Unplanned actual', value: stats.actualOnly }
    ].map(function (item) {
      return [
        '<div class="compare-stat">',
        '  <div class="compare-stat-value">' + item.value + 'h</div>',
        '  <div class="compare-stat-label">' + item.label + '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  function clearCompareAnnotations() {
    document.querySelectorAll('.compare-plan-strip, .compare-cell-label').forEach(function (node) {
      node.remove();
    });
    document.querySelectorAll('.compare-cell, .compare-cell-same, .compare-cell-mismatch, .compare-cell-missed, .compare-cell-unplanned').forEach(function (node) {
      node.classList.remove('compare-cell', 'compare-cell-same', 'compare-cell-mismatch', 'compare-cell-missed', 'compare-cell-unplanned');
      node.removeAttribute('title');
    });
  }

  function annotateCompareGrid() {
    clearCompareAnnotations();
    if (dual.mode !== 'compare') return;

    var plan = dual.layers.plan.grid || [];
    var actual = dual.layers.actual.grid || [];

    document.querySelectorAll('.cell[data-index]').forEach(function (cell) {
      var index = Number(cell.dataset.index);
      if (!Number.isInteger(index)) return;
      var planned = plan[index] || 'unassigned';
      var logged = actual[index] || 'unassigned';
      cell.classList.add('compare-cell');

      if (planned === logged) {
        cell.classList.add('compare-cell-same');
        cell.title = 'Plan and actual match';
        return;
      }

      var strip = document.createElement('span');
      strip.className = 'compare-plan-strip';
      strip.style.backgroundColor = getCategoryColor(planned);
      cell.appendChild(strip);

      var note = document.createElement('span');
      note.className = 'compare-cell-label';
      note.textContent = 'P: ' + getCategoryName(planned);
      cell.appendChild(note);

      if (planned !== 'unassigned' && logged === 'unassigned') {
        cell.classList.add('compare-cell-missed');
        cell.title = 'Planned ' + getCategoryName(planned) + ', but no actual time logged';
      } else if (planned === 'unassigned' && logged !== 'unassigned') {
        cell.classList.add('compare-cell-unplanned');
        cell.title = 'Unplanned actual: ' + getCategoryName(logged);
      } else {
        cell.classList.add('compare-cell-mismatch');
        cell.title = 'Plan: ' + getCategoryName(planned) + ' | Actual: ' + getCategoryName(logged);
      }
    });
  }

  function refreshDualUI() {
    updateModeUI();
    renderCompareSummary();
    annotateCompareGrid();
  }

  function fullRefresh() {
    applyModeState();
    if (originalM) originalM();
    if (originalG) originalG();
    if (originalF) originalF();
    refreshDualUI();
    savePersistedDual();
  }

  function switchMode(nextMode) {
    if (VIEW_MODES.indexOf(nextMode) === -1 || dual.mode === nextMode) return;
    syncActiveIntoDual();
    dual.mode = nextMode;
    fullRefresh();
  }

  document.addEventListener('click', function (event) {
    var modeButton = event.target.closest('[data-mode]');
    if (modeButton && modeButton.closest('#mode-switch')) {
      event.preventDefault();
      switchMode(modeButton.dataset.mode);
      return;
    }

    if (dual.mode !== 'compare') return;

    if (event.target.closest('#grid') || event.target.closest('#legend') || event.target.closest('.category-actions') || event.target.closest('.type-actions')) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  document.addEventListener('input', function (event) {
    if (dual.mode !== 'compare') return;
    if (event.target.closest('#legend')) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  document.addEventListener('mousedown', function (event) {
    if (dual.mode !== 'compare') return;
    if (event.target.closest('#grid')) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  document.addEventListener('touchstart', function (event) {
    if (dual.mode !== 'compare') return;
    if (event.target.closest('#grid')) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, { capture: true, passive: false });

  window.M = function () {
    syncActiveIntoDual();
    var result = originalM ? originalM.apply(this, arguments) : undefined;
    refreshDualUI();
    return result;
  };

  window.G = function () {
    syncActiveIntoDual();
    var result = originalG ? originalG.apply(this, arguments) : undefined;
    refreshDualUI();
    return result;
  };

  window.f = function () {
    syncActiveIntoDual();
    var result = originalF ? originalF.apply(this, arguments) : undefined;
    refreshDualUI();
    return result;
  };

  window.L = function () {
    syncActiveIntoDual();
    savePersistedDual();
    if (originalL) return originalL.apply(this, arguments);
  };

  window.OJ = function (state) {
    syncActiveIntoDual();
    savePersistedDual();
    if (originalOJ) return originalOJ.call(this, state);
  };

  buildUI();
  applyModeState();
  fullRefresh();
})();
