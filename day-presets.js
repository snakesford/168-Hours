(function () {
  'use strict';

  var PRESETS_KEY = '168hours-day-presets-v1';
  var SELECTED_DAY_KEY = '168hours-selected-day-column-v1';
  var selectedDayColumn = loadSelectedDayColumn();
  var presets = loadPresets();
  var originalL = window.L;
  var originalF = window.f;

  if (typeof window.Y === 'undefined' || typeof window.M !== 'function' || typeof window.G !== 'function' || typeof window.f !== 'function' || typeof window.L !== 'function') {
    return;
  }

  function loadSelectedDayColumn() {
    var raw = localStorage.getItem(SELECTED_DAY_KEY);
    var parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 6) return 0;
    return parsed;
  }

  function saveSelectedDayColumn() {
    try {
      localStorage.setItem(SELECTED_DAY_KEY, String(selectedDayColumn));
    } catch (_) {
      /* ignore storage failures */
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getVisibleDayCount() {
    if (typeof window.k0Q === 'function') {
      return Math.max(1, Math.min(7, Number(window.k0Q()) || 7));
    }
    return 7;
  }

  function clampSelectedDayColumn() {
    var max = getVisibleDayCount() - 1;
    if (!Number.isInteger(selectedDayColumn) || selectedDayColumn < 0) {
      selectedDayColumn = 0;
    } else if (selectedDayColumn > max) {
      selectedDayColumn = max;
    }
  }

  function createPresetId() {
    return 'preset-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  }

  function normalizeCellSnapshot(cell) {
    if (!cell || typeof cell !== 'object') return null;

    var cellChunks = Number(cell.cellChunks);
    if (!Number.isInteger(cellChunks) || cellChunks < 1 || cellChunks > 4) cellChunks = 1;

    var gridChunks = Array.isArray(cell.gridChunks) ? cell.gridChunks.slice(0, cellChunks) : [];
    while (gridChunks.length < cellChunks) {
      gridChunks.push(typeof cell.grid === 'string' ? cell.grid : 'unassigned');
    }

    gridChunks = gridChunks.map(function (categoryId) {
      return typeof categoryId === 'string' ? categoryId : 'unassigned';
    });

    return {
      cellChunks: cellChunks,
      grid: typeof cell.grid === 'string' ? cell.grid : (gridChunks[0] || 'unassigned'),
      gridChunks: gridChunks
    };
  }

  function normalizePreset(preset) {
    if (!preset || typeof preset !== 'object') return null;

    var name = typeof preset.name === 'string' ? preset.name.trim() : '';
    if (!name || !Array.isArray(preset.cells) || preset.cells.length !== 24) return null;

    var cells = preset.cells.map(normalizeCellSnapshot);
    if (cells.some(function (cell) { return !cell; })) return null;

    return {
      id: typeof preset.id === 'string' && preset.id ? preset.id : createPresetId(),
      name: name,
      createdAt: typeof preset.createdAt === 'string' ? preset.createdAt : new Date().toISOString(),
      cells: cells
    };
  }

  function loadPresets() {
    try {
      var raw = localStorage.getItem(PRESETS_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizePreset).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  function savePresets() {
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
    } catch (_) {
      /* ignore storage failures */
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char];
    });
  }

  function getDayName(column) {
    var labels = typeof window.CQ === 'function' ? window.CQ() : [];
    return labels[column] || ('Day ' + (column + 1));
  }

  function getTargetIndex(hour, dayColumn) {
    if (typeof window.d === 'function') return window.d(hour, dayColumn);
    return (dayColumn * 24) + hour;
  }

  function getSelectedDayIndexes(dayColumn) {
    var dayCount = getVisibleDayCount();
    var cells = Array.prototype.slice.call(document.querySelectorAll('#grid .cell'));
    var indexes = [];

    if (cells.length >= dayCount * 24) {
      for (var row = 0; row < 24; row++) {
        var cell = cells[(row * dayCount) + dayColumn];
        var index = cell ? Number(cell.dataset.index) : NaN;
        if (Number.isInteger(index) && index >= 0 && index < 168) {
          indexes.push(index);
        } else {
          indexes.push(getTargetIndex(row, dayColumn));
        }
      }
      return indexes;
    }

    for (var hour = 0; hour < 24; hour++) {
      indexes.push(getTargetIndex(hour, dayColumn));
    }

    return indexes;
  }

  function getValidCategoryIds() {
    return new Set((window.Y.categories || []).map(function (category) {
      return category.id;
    }));
  }

  function getDaySnapshot(dayColumn) {
    var validCategoryIds = getValidCategoryIds();
    var state = window.Y || {};
    var indexes = getSelectedDayIndexes(dayColumn);

    return Array.from({ length: 24 }, function (_, hour) {
      var index = indexes[hour];
      var cellChunks = (state.cellChunks && state.cellChunks[index]) || 1;
      var gridValue = (state.grid && state.grid[index]) || 'unassigned';
      var rawChunks = cellChunks === 1
        ? [gridValue]
        : ((state.gridChunks && state.gridChunks[index]) || [gridValue]);
      var gridChunks = Array.isArray(rawChunks) ? rawChunks.slice(0, cellChunks) : [gridValue];

      while (gridChunks.length < cellChunks) {
        gridChunks.push(gridValue);
      }

      gridChunks = gridChunks.map(function (categoryId) {
        return validCategoryIds.has(categoryId) ? categoryId : 'unassigned';
      });

      return {
        cellChunks: cellChunks,
        grid: cellChunks === 1 ? (validCategoryIds.has(gridValue) ? gridValue : 'unassigned') : (gridChunks[0] || 'unassigned'),
        gridChunks: gridChunks
      };
    });
  }

  function buildUI() {
    if (document.getElementById('day-preset-controls')) return;

    var section = document.querySelector('.week-start-section');
    if (!section) return;

    var wrap = document.createElement('div');
    wrap.className = 'day-preset-setting';
    wrap.id = 'day-preset-controls';
    wrap.innerHTML = [
      '<div class="day-preset-head">',
      '  <label class="week-start-label" for="day-preset-day">Day presets</label>',
      '  <div class="day-preset-note">Choose a preset and replace every hour in the selected day.</div>',
      '</div>',
      '<div class="day-preset-grid">',
      '  <select id="day-preset-day" class="week-start-select"></select>',
      '  <select id="day-preset-select" class="week-start-select"></select>',
      '  <button id="day-preset-apply" type="button" class="btn btn-secondary">Apply preset</button>',
      '  <button id="day-preset-save" type="button" class="btn btn-secondary">Save selected day</button>',
      '  <button id="day-preset-delete" type="button" class="btn btn-danger">Delete preset</button>',
      '</div>'
    ].join('');

    section.appendChild(wrap);
  }

  function renderSelectedDay() {
    clampSelectedDayColumn();

    var labels = document.getElementById('day-labels');
    if (!labels) return;

    Array.prototype.forEach.call(labels.children, function (node, index) {
      node.classList.toggle('day-label-selected', index === selectedDayColumn);
      node.setAttribute('title', index === selectedDayColumn ? 'Preset target day' : 'Click to target this day for presets');
    });
  }

  function renderPresetControls() {
    buildUI();

    var daySelect = document.getElementById('day-preset-day');
    var presetSelect = document.getElementById('day-preset-select');
    var applyButton = document.getElementById('day-preset-apply');
    var saveButton = document.getElementById('day-preset-save');
    var deleteButton = document.getElementById('day-preset-delete');
    if (!daySelect || !presetSelect || !applyButton || !saveButton || !deleteButton) return;

    clampSelectedDayColumn();

    daySelect.innerHTML = Array.from({ length: getVisibleDayCount() }, function (_, column) {
      return '<option value="' + column + '">' + escapeHtml(getDayName(column)) + '</option>';
    }).join('');
    daySelect.value = String(selectedDayColumn);

    var currentPresetId = presetSelect.value;
    presetSelect.innerHTML = ['<option value="">Select preset</option>'].concat(
      presets.map(function (preset) {
        return '<option value="' + preset.id + '">' + escapeHtml(preset.name) + '</option>';
      })
    ).join('');

    if (currentPresetId && presets.some(function (preset) { return preset.id === currentPresetId; })) {
      presetSelect.value = currentPresetId;
    }

    var isCompareMode = document.body.classList.contains('compare-mode');
    var hasPreset = Boolean(presetSelect.value);
    applyButton.disabled = isCompareMode || !hasPreset;
    saveButton.disabled = isCompareMode;
    deleteButton.disabled = !hasPreset;
  }

  function syncUI() {
    renderSelectedDay();
    renderPresetControls();
  }

  function updateState(nextState) {
    if (typeof window.v === 'function') {
      window.N = window.v(window.N, window.Y);
    }

    window.Y = Object.assign({}, window.Y, nextState);
    window.M();
    window.G();
    window.f();
    window.L();
    syncUI();
  }

  function applyPresetToDay(presetId) {
    if (document.body.classList.contains('compare-mode')) return;

    var preset = presets.find(function (entry) {
      return entry.id === presetId;
    });
    if (!preset) return;

    var validCategoryIds = getValidCategoryIds();
    var indexes = getSelectedDayIndexes(selectedDayColumn);
    var nextGrid = Array.isArray(window.Y.grid) ? window.Y.grid.slice() : Array(168).fill('unassigned');
    var nextCellChunks = Array.isArray(window.Y.cellChunks) ? window.Y.cellChunks.slice() : Array(168).fill(1);
    var nextGridChunks = Array.isArray(window.Y.gridChunks)
      ? window.Y.gridChunks.map(function (chunk, index) {
          if (Array.isArray(chunk)) return chunk.slice();
          return [nextGrid[index] || 'unassigned'];
        })
      : nextGrid.map(function (categoryId) {
          return [categoryId || 'unassigned'];
        });

    preset.cells.forEach(function (cell, hour) {
      var index = indexes[hour];
      var chunkCount = Number(cell.cellChunks) || 1;
      var gridChunks = Array.isArray(cell.gridChunks) ? cell.gridChunks.slice(0, chunkCount) : [cell.grid || 'unassigned'];

      while (gridChunks.length < chunkCount) {
        gridChunks.push(cell.grid || 'unassigned');
      }

      gridChunks = gridChunks.map(function (categoryId) {
        return validCategoryIds.has(categoryId) ? categoryId : 'unassigned';
      });

      nextCellChunks[index] = chunkCount;
      nextGridChunks[index] = gridChunks;
      nextGrid[index] = gridChunks[0] || 'unassigned';
    });

    updateState({
      grid: nextGrid,
      cellChunks: nextCellChunks,
      gridChunks: nextGridChunks
    });
  }

  function saveSelectedDayAsPreset() {
    if (document.body.classList.contains('compare-mode')) return;

    var defaultName = getDayName(selectedDayColumn) + ' preset';
    var rawName = window.prompt('Preset name:', defaultName);
    if (rawName === null) return;

    var name = rawName.trim();
    if (!name) {
      window.alert('Preset name is required.');
      return;
    }

    var existing = presets.find(function (preset) {
      return preset.name.toLowerCase() === name.toLowerCase();
    });

    var nextPreset = {
      id: existing ? existing.id : createPresetId(),
      name: name,
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      cells: getDaySnapshot(selectedDayColumn)
    };

    if (existing) {
      existing.name = nextPreset.name;
      existing.cells = clone(nextPreset.cells);
    } else {
      presets.push(nextPreset);
    }

    presets.sort(function (left, right) {
      return left.name.localeCompare(right.name);
    });
    savePresets();
    renderPresetControls();

    var presetSelect = document.getElementById('day-preset-select');
    if (presetSelect) {
      presetSelect.value = nextPreset.id;
      renderPresetControls();
    }
  }

  function deleteSelectedPreset() {
    var presetSelect = document.getElementById('day-preset-select');
    if (!presetSelect || !presetSelect.value) return;

    var preset = presets.find(function (entry) {
      return entry.id === presetSelect.value;
    });
    if (!preset) return;

    if (!window.confirm('Delete preset "' + preset.name + '"?')) return;

    presets = presets.filter(function (entry) {
      return entry.id !== preset.id;
    });
    savePresets();
    renderPresetControls();
  }

  function bindEvents() {
    var labels = document.getElementById('day-labels');
    if (labels) {
      labels.addEventListener('click', function (event) {
        var target = event.target.closest('span');
        if (!target) return;

        var nodes = Array.prototype.slice.call(labels.children);
        var index = nodes.indexOf(target);
        if (index < 0) return;

        selectedDayColumn = index;
        saveSelectedDayColumn();
        syncUI();
      });
    }

    document.addEventListener('change', function (event) {
      if (event.target && event.target.id === 'day-preset-day') {
        selectedDayColumn = Number(event.target.value);
        clampSelectedDayColumn();
        saveSelectedDayColumn();
        syncUI();
        return;
      }

      if (event.target && event.target.id === 'day-preset-select') {
        renderPresetControls();
      }
    });

    document.addEventListener('click', function (event) {
      var applyButton = event.target.closest('#day-preset-apply');
      if (applyButton) {
        var presetSelect = document.getElementById('day-preset-select');
        if (presetSelect && presetSelect.value) applyPresetToDay(presetSelect.value);
        return;
      }

      var saveButton = event.target.closest('#day-preset-save');
      if (saveButton) {
        saveSelectedDayAsPreset();
        return;
      }

      var deleteButton = event.target.closest('#day-preset-delete');
      if (deleteButton) {
        deleteSelectedPreset();
      }
    });

    var dayStart = document.getElementById('day-start-select');
    var weekStart = document.getElementById('week-start-select');
    var weekDays = document.getElementById('week-days-select');

    [dayStart, weekStart, weekDays].forEach(function (select) {
      if (!select) return;
      select.addEventListener('change', function () {
        clampSelectedDayColumn();
        saveSelectedDayColumn();
        window.setTimeout(syncUI, 0);
      });
    });
  }

  function init() {
    buildUI();
    bindEvents();
    syncUI();
  }

  window.L = function () {
    if (typeof originalL === 'function') originalL.apply(this, arguments);
    syncUI();
  };

  window.f = function () {
    if (typeof originalF === 'function') originalF.apply(this, arguments);
    renderPresetControls();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
