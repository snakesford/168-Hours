(function () {
  'use strict';

  var TAGS_KEY = '168hours-time-tags';
  var lastSelectedIndex = null;
  var timeTags = [];

  function safeParse(json, fallback) {
    try {
      return JSON.parse(json);
    } catch (_) {
      return fallback;
    }
  }

  function loadTags() {
    var raw = localStorage.getItem(TAGS_KEY);
    var parsed = raw ? safeParse(raw, []) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(function (t) {
        if (!t || typeof t !== 'object') return null;
        var idx = Number(t.index);
        var label = typeof t.label === 'string' ? t.label.trim() : '';
        if (!Number.isInteger(idx) || idx < 0 || idx >= 168) return null;
        if (!label) return null;
        return { index: idx, label: label };
      })
      .filter(Boolean)
      .slice(0, 30);
  }

  function saveTags() {
    localStorage.setItem(TAGS_KEY, JSON.stringify(timeTags));
  }

  function indexToLabel(index) {
    if (typeof window.l === 'function') {
      var pos = window.l(index);
      if (pos && Number.isInteger(pos.row) && Number.isInteger(pos.col)) {
        var days = typeof window.CQ === 'function' ? window.CQ() : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        var dayName = days[pos.col] || ('Day ' + (pos.col + 1));
        var hour = pos.row;
        var period = hour >= 12 ? 'pm' : 'am';
        var h12 = hour % 12;
        if (h12 === 0) h12 = 12;
        return dayName + ' ' + h12 + period;
      }
    }
    return 'Cell ' + index;
  }

  function applyCategoryToIndex(index) {
    if (!window.Y || !window.N || typeof window.v !== 'function') return;
    var activeCategory = window.Y.activeCategoryId || 'unassigned';
    if (!activeCategory) return;

    var nextGrid = Array.isArray(window.Y.grid) ? window.Y.grid.slice() : Array(168).fill('unassigned');
    var nextCellChunks = Array.isArray(window.Y.cellChunks) ? window.Y.cellChunks.slice() : Array(168).fill(1);
    var nextGridChunks = Array.isArray(window.Y.gridChunks) ? window.Y.gridChunks.map(function (arr, i) {
      if (Array.isArray(arr)) return arr.slice();
      return [nextGrid[i] || 'unassigned'];
    }) : nextGrid.map(function (cat) { return [cat || 'unassigned']; });

    var chunkCount = nextCellChunks[index] || 1;
    if (chunkCount > 1) {
      nextGridChunks[index] = Array(chunkCount).fill(activeCategory);
    } else {
      nextGridChunks[index] = [activeCategory];
    }
    nextGrid[index] = activeCategory;

    window.N = window.v(window.N, window.Y);
    window.Y = Object.assign({}, window.Y, {
      grid: nextGrid,
      cellChunks: nextCellChunks,
      gridChunks: nextGridChunks
    });

    if (typeof window.M === 'function') window.M();
    if (typeof window.G === 'function') window.G();
    if (typeof window.f === 'function') window.f();
    if (typeof window.L === 'function') window.L();
  }

  function computePatternRows() {
    if (!window.Y || !Array.isArray(window.Y.grid)) return [];
    var dayCount = typeof window.k0Q === 'function' ? window.k0Q() : 7;
    dayCount = Math.max(1, Math.min(14, dayCount));

    var rows = [];
    for (var hour = 0; hour < 24; hour++) {
      var counts = new Map();
      var total = 0;

      for (var col = 0; col < dayCount; col++) {
        var idx = typeof window.d === 'function' ? window.d(hour, col) : (col * 24 + hour);
        var chunkCount = (window.Y.cellChunks && window.Y.cellChunks[idx]) || 1;
        var chunks = (window.Y.gridChunks && window.Y.gridChunks[idx]) || [window.Y.grid[idx] || 'unassigned'];

        if (chunkCount > 1 && Array.isArray(chunks)) {
          for (var c = 0; c < chunks.length; c++) {
            var cat = chunks[c] || 'unassigned';
            if (cat === 'unassigned') continue;
            counts.set(cat, (counts.get(cat) || 0) + 1 / chunkCount);
            total += 1 / chunkCount;
          }
        } else {
          var categoryId = window.Y.grid[idx] || 'unassigned';
          if (categoryId === 'unassigned') continue;
          counts.set(categoryId, (counts.get(categoryId) || 0) + 1);
          total += 1;
        }
      }

      if (total === 0 || counts.size === 0) continue;
      var bestId = null;
      var bestHours = 0;
      counts.forEach(function (value, key) {
        if (value > bestHours) {
          bestHours = value;
          bestId = key;
        }
      });
      if (!bestId) continue;

      var pct = Math.round((bestHours / dayCount) * 100);
      if (pct < 35) continue;

      var category = (window.Y.categories || []).find(function (c) { return c.id === bestId; });
      var label = category ? category.name : bestId;
      rows.push({
        hour: hour,
        categoryId: bestId,
        label: label,
        color: category ? category.color : '#9ca3af',
        percent: pct,
        hours: Math.round(bestHours * 10) / 10
      });
    }

    rows.sort(function (a, b) {
      if (b.percent !== a.percent) return b.percent - a.percent;
      return a.hour - b.hour;
    });
    return rows.slice(0, 10);
  }

  function buildEnhancementsUI() {
    var section = document.querySelector('.week-start-section');
    if (!section) return null;

    var wrap = document.createElement('div');
    wrap.className = 'enhancements-wrap';
    wrap.innerHTML = [
      '<div class="week-start-setting tag-setting">',
      '  <label class="week-start-label">Time tags</label>',
      '  <div class="time-tag-controls">',
      '    <button id="add-time-tag-btn" type="button" class="btn btn-secondary">Tag selected time</button>',
      '  </div>',
      '  <div id="time-tag-list" class="time-tag-list"></div>',
      '</div>',
      '<div class="week-start-setting pattern-setting">',
      '  <label class="week-start-label">Pattern chart</label>',
      '  <div id="pattern-chart" class="pattern-chart"></div>',
      '</div>'
    ].join('');
    section.appendChild(wrap);
    return wrap;
  }

  function renderTimeTags() {
    var list = document.getElementById('time-tag-list');
    if (!list) return;
    if (!timeTags.length) {
      list.innerHTML = '<div class="pattern-empty">No tags yet</div>';
      return;
    }

    list.innerHTML = timeTags.map(function (tag, idx) {
      return [
        '<div class="time-tag-row">',
        '  <button class="time-tag-fill" data-tag-index="' + idx + '" type="button">' + tag.label + '</button>',
        '  <button class="time-tag-delete" data-tag-index="' + idx + '" type="button" aria-label="Delete tag">x</button>',
        '</div>'
      ].join('');
    }).join('');
  }

  function renderPatternChart() {
    var chart = document.getElementById('pattern-chart');
    if (!chart) return;

    var rows = computePatternRows();
    if (!rows.length) {
      chart.innerHTML = '<div class="pattern-empty">Add more planned time to reveal patterns</div>';
      return;
    }

    chart.innerHTML = rows.map(function (row) {
      var displayHour = row.hour % 12 === 0 ? 12 : row.hour % 12;
      var suffix = row.hour >= 12 ? 'pm' : 'am';
      return [
        '<div class="pattern-row">',
        '  <div class="pattern-head"><span>' + displayHour + suffix + '</span><span>' + row.percent + '%</span></div>',
        '  <div class="pattern-bar"><span style="width:' + row.percent + '%;background:' + row.color + '"></span></div>',
        '  <div class="pattern-label">' + row.label + ' (' + row.hours + 'h)</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  function addCurrentSelectionAsTag() {
    if (!Number.isInteger(lastSelectedIndex) || lastSelectedIndex < 0 || lastSelectedIndex >= 168) {
      alert('Select a time cell first, then add a tag.');
      return;
    }
    var label = indexToLabel(lastSelectedIndex);
    var exists = timeTags.some(function (t) { return t.index === lastSelectedIndex; });
    if (exists) {
      renderTimeTags();
      return;
    }
    timeTags.push({ index: lastSelectedIndex, label: label });
    saveTags();
    renderTimeTags();
  }

  function bindEvents() {
    var grid = document.getElementById('grid');
    var addTagBtn = document.getElementById('add-time-tag-btn');
    var tagList = document.getElementById('time-tag-list');

    if (grid) {
      grid.addEventListener('mousedown', function (evt) {
        var target = evt.target.closest('.cell,.cell-chunk');
        if (!target) return;
        var idx = Number(target.dataset.index);
        if (Number.isInteger(idx) && idx >= 0 && idx < 168) lastSelectedIndex = idx;
      }, true);

      grid.addEventListener('touchstart', function (evt) {
        var touchTarget = evt.target && evt.target.closest ? evt.target.closest('.cell,.cell-chunk') : null;
        if (!touchTarget) return;
        var idx = Number(touchTarget.dataset.index);
        if (Number.isInteger(idx) && idx >= 0 && idx < 168) lastSelectedIndex = idx;
      }, { capture: true, passive: true });
    }

    if (addTagBtn) {
      addTagBtn.addEventListener('click', addCurrentSelectionAsTag);
    }

    if (tagList) {
      tagList.addEventListener('click', function (evt) {
        var fillBtn = evt.target.closest('.time-tag-fill');
        if (fillBtn) {
          var idx = Number(fillBtn.dataset.tagIndex);
          var tag = timeTags[idx];
          if (!tag) return;
          applyCategoryToIndex(tag.index);
          renderPatternChart();
          return;
        }

        var delBtn = evt.target.closest('.time-tag-delete');
        if (delBtn) {
          var delIdx = Number(delBtn.dataset.tagIndex);
          if (!Number.isInteger(delIdx) || delIdx < 0 || delIdx >= timeTags.length) return;
          timeTags.splice(delIdx, 1);
          saveTags();
          renderTimeTags();
        }
      });
    }

    var rerender = function () {
      renderPatternChart();
    };

    var gridObserverTarget = document.getElementById('grid');
    if (gridObserverTarget && typeof MutationObserver !== 'undefined') {
      var observer = new MutationObserver(rerender);
      observer.observe(gridObserverTarget, { childList: true, subtree: true });
    }

    var weekStart = document.getElementById('week-start-select');
    var dayStart = document.getElementById('day-start-select');
    var weekDays = document.getElementById('week-days-select');
    [weekStart, dayStart, weekDays].forEach(function (el) {
      if (!el) return;
      el.addEventListener('change', function () {
        setTimeout(renderPatternChart, 0);
      });
    });
  }

  function init() {
    if (document.getElementById('time-tag-list')) return;
    timeTags = loadTags();
    buildEnhancementsUI();
    renderTimeTags();
    renderPatternChart();
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
