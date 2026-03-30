(function () {
  'use strict';

  var STORAGE_KEY = '168hours-week-schedules-v1';
  var SELECTED_WEEK_KEY = '168hours-selected-week-v1';
  var RECURRING_KEY = '168hours-row-recurring-v1';
  var isApplyingWeek = false;
  var statusTimerId = null;

  if (typeof window.Y === 'undefined' || typeof window.M !== 'function' || typeof window.G !== 'function' || typeof window.f !== 'function' || typeof window.L !== 'function') {
    return;
  }

  var originalM = window.M;
  var originalL = window.L;
  var originalOJ = typeof window.OJ === 'function' ? window.OJ : null;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function safeStateClone(state) {
    var source = state && typeof state === 'object' ? state : {};
    var grid = Array.isArray(source.grid) && source.grid.length === 168 ? source.grid.slice() : Array(168).fill('unassigned');
    var cellChunks = Array.isArray(source.cellChunks) && source.cellChunks.length === 168 ? source.cellChunks.slice() : Array(168).fill(1);
    var gridChunks = Array.isArray(source.gridChunks) && source.gridChunks.length === 168
      ? source.gridChunks.map(function (chunk, index) {
          var count = cellChunks[index] || 1;
          if (Array.isArray(chunk) && chunk.length) {
            return chunk.slice(0, count).concat(Array(Math.max(0, count - chunk.length)).fill(grid[index] || 'unassigned'));
          }
          return Array(count).fill(grid[index] || 'unassigned');
        })
      : grid.map(function (categoryId, index) {
          return Array(cellChunks[index] || 1).fill(categoryId || 'unassigned');
        });

    return {
      categories: Array.isArray(source.categories) ? clone(source.categories) : [],
      groups: Array.isArray(source.groups) ? clone(source.groups) : [],
      grid: grid,
      gridChunks: gridChunks,
      cellChunks: cellChunks,
      activeCategoryId: source.activeCategoryId || 'unassigned',
      eraserMode: Boolean(source.eraserMode),
      trackingMode: Boolean(source.trackingMode),
      types: Array.isArray(source.types) ? clone(source.types) : [],
      categoryTypes: source.categoryTypes && typeof source.categoryTypes === 'object' ? clone(source.categoryTypes) : {}
    };
  }

  function safeHistoryClone(history) {
    var source = history && typeof history === 'object' ? history : (typeof window.XJ === 'function' ? window.XJ() : { past: [], future: [] });
    return {
      past: Array.isArray(source.past) ? clone(source.past) : [],
      future: Array.isArray(source.future) ? clone(source.future) : []
    };
  }

  function buildBlankStateFromCurrent() {
    var base = safeStateClone(window.Y);
    base.grid = Array(168).fill('unassigned');
    base.gridChunks = base.cellChunks.map(function (count) {
      return Array(count || 1).fill('unassigned');
    });
    base.activeCategoryId = 'unassigned';
    base.eraserMode = false;
    return base;
  }

  function getWeekStartDay() {
    var select = document.getElementById('week-start-select');
    var value = select ? Number(select.value) : 1;
    if (!Number.isInteger(value) || value < 1 || value > 7) return 1;
    return value % 7;
  }

  function pad(num) {
    return String(num).padStart(2, '0');
  }

  function formatWeekId(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function startOfWeek(date) {
    var result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var weekStartDay = getWeekStartDay();
    var currentDay = result.getDay();
    var diff = (currentDay - weekStartDay + 7) % 7;
    result.setDate(result.getDate() - diff);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  function weekIdFromDate(date) {
    return formatWeekId(startOfWeek(date));
  }

  function dateFromWeekId(weekId) {
    if (typeof weekId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(weekId)) return null;
    var parts = weekId.split('-').map(Number);
    var date = new Date(parts[0], parts[1] - 1, parts[2]);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function shiftWeekId(weekId, delta) {
    var base = dateFromWeekId(weekId) || startOfWeek(new Date());
    base.setDate(base.getDate() + (delta * 7));
    return formatWeekId(base);
  }

  function formatDateLabel(date) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function formatClock(date) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function describeWeek(weekId) {
    var start = dateFromWeekId(weekId);
    if (!start) return weekId;
    var end = new Date(start);
    end.setDate(start.getDate() + 6);
    return formatDateLabel(start) + ' - ' + formatDateLabel(end);
  }

  function relativeWeekLabel(weekId) {
    var todayWeek = weekIdFromDate(new Date());
    if (weekId === todayWeek) return 'This week';
    if (weekId === shiftWeekId(todayWeek, -1)) return 'Last week';
    if (weekId === shiftWeekId(todayWeek, 1)) return 'Next week';
    return '';
  }

  function getDayStartHour() {
    var select = document.getElementById('day-start-select');
    var value = select ? Number(select.value) : 5;
    if (!Number.isInteger(value) || value < 0 || value > 23) return 5;
    return value;
  }

  function saveStore(store) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (_) {
      /* ignore storage failures */
    }
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { weeks: {} };
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.weeks || typeof parsed.weeks !== 'object') {
        return { weeks: {} };
      }

      var weeks = {};
      Object.keys(parsed.weeks).forEach(function (weekId) {
        var entry = parsed.weeks[weekId];
        if (!entry || typeof entry !== 'object') return;
        weeks[weekId] = {
          weekId: weekId,
          savedAt: typeof entry.savedAt === 'string' ? entry.savedAt : new Date().toISOString(),
          state: safeStateClone(entry.state),
          history: safeHistoryClone(entry.history)
        };
      });
      return { weeks: weeks };
    } catch (_) {
      return { weeks: {} };
    }
  }

  function loadRecurringRows() {
    try {
      var raw = localStorage.getItem(RECURRING_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};

      var rows = {};
      Object.keys(parsed).forEach(function (hourKey) {
        var entry = parsed[hourKey];
        if (!entry || typeof entry !== 'object' || !Array.isArray(entry.cells)) return;
        rows[hourKey] = {
          hour: Number(hourKey),
          label: typeof entry.label === 'string' ? entry.label : '',
          savedAt: typeof entry.savedAt === 'string' ? entry.savedAt : new Date().toISOString(),
          cells: entry.cells
            .map(function (cell) {
              var index = Number(cell.index);
              var cellChunks = Number(cell.cellChunks);
              var chunks = Array.isArray(cell.gridChunks) ? cell.gridChunks.slice() : [cell.grid || 'unassigned'];
              if (!Number.isInteger(index) || index < 0 || index >= 168) return null;
              if (!Number.isInteger(cellChunks) || cellChunks < 1) cellChunks = 1;
              return {
                index: index,
                cellChunks: cellChunks,
                grid: typeof cell.grid === 'string' ? cell.grid : (chunks[0] || 'unassigned'),
                gridChunks: chunks
              };
            })
            .filter(Boolean)
        };
      });
      return rows;
    } catch (_) {
      return {};
    }
  }

  function saveRecurringRows() {
    try {
      localStorage.setItem(RECURRING_KEY, JSON.stringify(recurringRows));
    } catch (_) {
      /* ignore storage failures */
    }
  }

  var store = loadStore();
  var recurringRows = loadRecurringRows();
  var selectedWeekId = localStorage.getItem(SELECTED_WEEK_KEY) || weekIdFromDate(new Date());

  function persistSelectedWeek() {
    try {
      localStorage.setItem(SELECTED_WEEK_KEY, selectedWeekId);
    } catch (_) {
      /* ignore storage failures */
    }
  }

  function isFutureWeek(weekId) {
    var target = dateFromWeekId(weekId);
    var current = startOfWeek(new Date());
    if (!target || !current) return false;
    return target.getTime() > current.getTime();
  }

  function applyRecurringRowsToState(state) {
    var next = safeStateClone(state);
    var validCategoryIds = new Set((next.categories || []).map(function (category) {
      return category.id;
    }));

    Object.keys(recurringRows).forEach(function (hourKey) {
      var template = recurringRows[hourKey];
      if (!template || !Array.isArray(template.cells)) return;

      template.cells.forEach(function (cell) {
        var index = Number(cell.index);
        var cellChunks = Number(cell.cellChunks);
        if (!Number.isInteger(index) || index < 0 || index >= 168) return;
        if (!Number.isInteger(cellChunks) || cellChunks < 1) cellChunks = 1;

        var chunks = cellChunks === 1
          ? [cell.grid || 'unassigned']
          : (Array.isArray(cell.gridChunks) ? cell.gridChunks.slice(0, cellChunks) : [cell.grid || 'unassigned']);
        while (chunks.length < cellChunks) chunks.push(cell.grid || 'unassigned');
        chunks = chunks.map(function (categoryId) {
          return validCategoryIds.has(categoryId) ? categoryId : 'unassigned';
        });

        next.cellChunks[index] = cellChunks;
        next.gridChunks[index] = chunks;
        next.grid[index] = chunks[0] || 'unassigned';
      });
    });

    return next;
  }

  function saveCurrentWeek() {
    if (!selectedWeekId) return;
    store.weeks[selectedWeekId] = {
      weekId: selectedWeekId,
      savedAt: new Date().toISOString(),
      state: safeStateClone(window.Y),
      history: safeHistoryClone(window.N)
    };
    saveStore(store);
  }

  function flushCurrentWeek() {
    saveCurrentWeek();
    persistSelectedWeek();
  }

  function createEmptyHistory() {
    return typeof window.XJ === 'function' ? window.XJ() : { past: [], future: [] };
  }

  function buildNewWeekState() {
    return applyRecurringRowsToState(buildBlankStateFromCurrent());
  }

  function ensureWeekExists(weekId, seedState, seedHistory, options) {
    if (store.weeks[weekId]) return;
    var config = options && typeof options === 'object' ? options : {};
    var nextState = seedState ? safeStateClone(seedState) : buildBlankStateFromCurrent();
    if (!seedState && (config.applyRecurringRows || isFutureWeek(weekId))) {
      nextState = applyRecurringRowsToState(nextState);
    }
    store.weeks[weekId] = {
      weekId: weekId,
      savedAt: new Date().toISOString(),
      state: nextState,
      history: seedHistory ? safeHistoryClone(seedHistory) : createEmptyHistory()
    };
    saveStore(store);
  }

  function openAdjacentWeek(delta) {
    if (!isFutureWeek(selectedWeekId)) {
      syncRecurringRowsFromCurrentState();
    }
    var targetWeekId = shiftWeekId(selectedWeekId, delta);
    var createdNewWeek = false;
    if (!store.weeks[targetWeekId] && delta > 0) {
      ensureWeekExists(targetWeekId, buildNewWeekState(), createEmptyHistory(), { applyRecurringRows: true });
      createdNewWeek = true;
    }
    applyWeek(targetWeekId);
  }

  function applyWeek(weekId) {
    ensureWeekExists(weekId);
    var entry = store.weeks[weekId];
    if (!entry) return;

    isApplyingWeek = true;
    selectedWeekId = weekId;
    persistSelectedWeek();

    window.Y = safeStateClone(entry.state);
    window.N = safeHistoryClone(entry.history);

    window.M();
    window.G();
    window.f();
    originalL.call(window);

    isApplyingWeek = false;
    renderWeekUI();
  }

  function deleteWeek(weekId) {
    if (!store.weeks[weekId]) return;
    delete store.weeks[weekId];

    var remaining = sortedWeekIds();
    if (!remaining.length) {
      selectedWeekId = weekIdFromDate(new Date());
      ensureWeekExists(selectedWeekId, buildBlankStateFromCurrent(), typeof window.XJ === 'function' ? window.XJ() : { past: [], future: [] });
      saveStore(store);
      applyWeek(selectedWeekId);
      return;
    }

    saveStore(store);

    if (selectedWeekId === weekId) {
      applyWeek(remaining[0]);
      return;
    }

    renderWeekUI();
  }

  function sortedWeekIds() {
    return Object.keys(store.weeks).sort(function (a, b) {
      return b.localeCompare(a);
    });
  }

  function visibleWeekIds() {
    var ids = sortedWeekIds();
    if (ids.indexOf(selectedWeekId) === -1) ids.unshift(selectedWeekId);
    ids = Array.from(new Set(ids));
    ids.sort(function (a, b) {
      return b.localeCompare(a);
    });
    return ids;
  }

  function countAssignedHours(state) {
    if (!state || !Array.isArray(state.grid)) return 0;
    var total = 0;
    for (var index = 0; index < 168; index++) {
      var chunkCount = (state.cellChunks && state.cellChunks[index]) || 1;
      var chunks = (state.gridChunks && state.gridChunks[index]) || [state.grid[index] || 'unassigned'];
      if (chunkCount > 1 && Array.isArray(chunks)) {
        for (var c = 0; c < chunkCount; c++) {
          if ((chunks[c] || 'unassigned') !== 'unassigned') total += 1 / chunkCount;
        }
      } else if ((state.grid[index] || 'unassigned') !== 'unassigned') {
        total += 1;
      }
    }
    return Math.round(total * 10) / 10;
  }

  function getConfiguredDayCount() {
    var select = document.getElementById('week-days-select');
    var value = select ? Number(select.value) : 7;
    if (!Number.isInteger(value) || value < 1 || value > 14) return 7;
    return value;
  }

  function categoryNameForId(categoryId, state) {
    if (!categoryId || categoryId === 'unassigned') return 'Unassigned';
    var categories = state && Array.isArray(state.categories) ? state.categories : [];
    var match = categories.find(function (category) {
      return category.id === categoryId;
    });
    return match ? match.name : categoryId;
  }

  function getCurrentSchedulePosition(now) {
    var weekStartDay = getWeekStartDay();
    var dayStartHour = getDayStartHour();
    var currentDay = now.getDay();
    var dayOffset = (currentDay - weekStartDay + 7) % 7;
    var minutesSinceMidnight = (now.getHours() * 60) + now.getMinutes();

    if (minutesSinceMidnight < dayStartHour * 60) {
      dayOffset = (dayOffset - 1 + 7) % 7;
    }

    var shiftedMinutes = (minutesSinceMidnight - (dayStartHour * 60) + 1440) % 1440;
    return {
      dayOffset: dayOffset,
      rowIndex: Math.floor(shiftedMinutes / 60),
      minuteWithinRow: shiftedMinutes % 60
    };
  }

  function getCountdownInfo() {
    if (!window.Y) return null;

    var now = new Date();
    var position = getCurrentSchedulePosition(now);
    var dayCount = getConfiguredDayCount();
    if (position.dayOffset < 0 || position.dayOffset >= dayCount) {
      return {
        now: now,
        title: 'Current time ' + formatClock(now),
        detail: 'No scheduled day remains in this week.'
      };
    }

    var state = safeStateClone(window.Y);
    var segments = [];
    for (var dayIndex = position.dayOffset; dayIndex < dayCount; dayIndex++) {
      for (var rowIndex = dayIndex === position.dayOffset ? position.rowIndex : 0; rowIndex < 24; rowIndex++) {
        var gridIndex = (dayIndex * 24) + rowIndex;
        var chunkCount = (state.cellChunks && state.cellChunks[gridIndex]) || 1;
        var gridChunks = (state.gridChunks && state.gridChunks[gridIndex]) || [state.grid[gridIndex] || 'unassigned'];
        var segmentMinutes = 60 / chunkCount;

        for (var chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
          segments.push({
            startMinutes: (dayIndex * 1440) + (rowIndex * 60) + Math.round(chunkIndex * segmentMinutes),
            categoryId: gridChunks[chunkIndex] || state.grid[gridIndex] || 'unassigned'
          });
        }
      }
    }

    if (!segments.length) {
      return {
        now: now,
        title: 'Current time ' + formatClock(now),
        detail: 'No upcoming categories in this saved week.'
      };
    }

    var currentMinutes = (position.dayOffset * 1440) + (position.rowIndex * 60) + position.minuteWithinRow;
    var currentSegment = segments[0];
    for (var i = 0; i < segments.length; i++) {
      if (segments[i].startMinutes <= currentMinutes) {
        currentSegment = segments[i];
      } else {
        break;
      }
    }

    var nextSegment = null;
    for (var j = 0; j < segments.length; j++) {
      if (segments[j].startMinutes > currentMinutes && segments[j].categoryId !== currentSegment.categoryId) {
        nextSegment = segments[j];
        break;
      }
    }

    if (!nextSegment) {
      return {
        now: now,
        title: 'Current time ' + formatClock(now),
        detail: 'No later category changes in this saved week.'
      };
    }

    var minutesRemaining = Math.max(0, nextSegment.startMinutes - currentMinutes);
    var hoursPart = Math.floor(minutesRemaining / 60);
    var minutesPart = minutesRemaining % 60;
    var remainingLabel = hoursPart > 0 ? hoursPart + 'h ' + String(minutesPart).padStart(2, '0') + 'm' : minutesPart + 'm';
    var nextCategoryName = categoryNameForId(nextSegment.categoryId, state);

    return {
      now: now,
      title: 'Current time ' + formatClock(now),
      detail: remainingLabel + ' until ' + nextCategoryName + ' starts'
    };
  }

  function renderWeekStatus() {
    var badge = document.getElementById('live-status');
    var info = getCountdownInfo();
    if (!info) return;
    if (badge) {
      badge.textContent = info.title.replace(/^Current time\s+/, '') + ' · ' + info.detail;
    }
  }

  function ensureStatusTimer() {
    if (statusTimerId) clearInterval(statusTimerId);
    statusTimerId = window.setInterval(renderWeekStatus, 15000);
  }

  function getVisibleDayCount() {
    if (typeof window.k0Q === 'function') {
      return Math.max(1, Math.min(7, Number(window.k0Q()) || 7));
    }
    return 7;
  }

  function getGridCells() {
    return Array.from(document.querySelectorAll('#grid .cell'));
  }

  function getRowCells(rowIndex) {
    var dayCount = getVisibleDayCount();
    var cells = getGridCells();
    var start = rowIndex * dayCount;
    return cells.slice(start, start + dayCount);
  }

  function getRowHourKey(rowIndex) {
    var rowCells = getRowCells(rowIndex);
    if (!rowCells.length) return null;
    var firstIndex = Number(rowCells[0].dataset.index);
    if (!Number.isInteger(firstIndex) || firstIndex < 0) return null;
    return firstIndex % 24;
  }

  function captureRecurringRow(rowIndex) {
    var hourKey = getRowHourKey(rowIndex);
    if (!Number.isInteger(hourKey)) return;

    var rowCells = getRowCells(rowIndex);
    var labelNode = document.querySelector('.hour-label[data-row-index="' + rowIndex + '"] .hour-label-time');
    var labelText = labelNode ? labelNode.textContent.trim() : String(hourKey);
    var cells = rowCells
      .map(function (cell) {
        var index = Number(cell.dataset.index);
        if (!Number.isInteger(index) || index < 0 || index >= 168) return null;
        var cellChunks = (window.Y.cellChunks && window.Y.cellChunks[index]) || 1;
        var gridValue = (window.Y.grid && window.Y.grid[index]) || 'unassigned';
        var gridChunks = cellChunks === 1
          ? [gridValue]
          : ((window.Y.gridChunks && window.Y.gridChunks[index]) || [gridValue]);
        return {
          index: index,
          cellChunks: cellChunks,
          grid: gridValue,
          gridChunks: Array.isArray(gridChunks) ? gridChunks.slice() : [gridChunks || 'unassigned']
        };
      })
      .filter(Boolean);

    recurringRows[String(hourKey)] = {
      hour: hourKey,
      label: labelText,
      savedAt: new Date().toISOString(),
      cells: cells
    };
    saveRecurringRows();
    renderRecurringButtons();
  }

  function removeRecurringRow(rowIndex) {
    var hourKey = getRowHourKey(rowIndex);
    if (!Number.isInteger(hourKey) || !recurringRows[String(hourKey)]) return;

    delete recurringRows[String(hourKey)];
    saveRecurringRows();
    renderRecurringButtons();
  }

  function syncRecurringRowsFromCurrentState() {
    var labels = Array.from(document.querySelectorAll('#hour-labels .hour-label'));
    if (!labels.length) return;

    labels.forEach(function (_, rowIndex) {
      var hourKey = getRowHourKey(rowIndex);
      if (!Number.isInteger(hourKey) || !recurringRows[String(hourKey)]) return;
      captureRecurringRow(rowIndex);
    });
  }

  function renderRecurringButtons() {
    var labels = Array.from(document.querySelectorAll('#hour-labels .hour-label'));
    if (!labels.length) return;

    labels.forEach(function (label, rowIndex) {
      label.dataset.rowIndex = String(rowIndex);
      label.classList.add('hour-label-with-recurring');

      var timeNode = label.querySelector('.hour-label-time');
      if (!timeNode) {
        var existingText = label.textContent.trim();
        label.textContent = '';
        timeNode = document.createElement('span');
        timeNode.className = 'hour-label-time';
        timeNode.textContent = existingText;
        label.appendChild(timeNode);
      }

      var button = label.querySelector('.hour-recurring-btn');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'hour-recurring-btn';
        button.innerHTML = '<span class="hour-recurring-checkbox" aria-hidden="true"><span class="hour-recurring-checkbox-mark">\u2713</span></span><span class="hour-recurring-text">recurring</span>';
        label.appendChild(button);
      }

      button.dataset.rowIndex = String(rowIndex);
      var hourKey = getRowHourKey(rowIndex);
      var isActive = Number.isInteger(hourKey) && Boolean(recurringRows[String(hourKey)]);
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      button.title = isActive ? 'Remove recurring row for future weeks' : 'Save this row for future new weeks';
    });
  }

  function buildUI() {
    var headerActions = document.querySelector('.header-actions');
    var navTitle = document.querySelector('.nav-title');
    if (!headerActions) return;
    if (document.getElementById('week-schedules-bar')) return;

    if (navTitle && !document.getElementById('live-status')) {
      var liveStatus = document.createElement('span');
      liveStatus.className = 'live-status';
      liveStatus.id = 'live-status';
      navTitle.insertAdjacentElement('afterend', liveStatus);
    }

    var bar = document.createElement('section');
    bar.className = 'week-schedules-bar';
    bar.id = 'week-schedules-bar';

    var main = document.createElement('div');
    main.className = 'week-schedules-main';

    var nav = document.createElement('div');
    nav.className = 'week-schedules-nav';

    var prevButton = document.createElement('button');
    prevButton.id = 'week-prev-btn';
    prevButton.type = 'button';
    prevButton.className = 'btn week-nav-btn';
    prevButton.setAttribute('aria-label', 'Previous week');
    prevButton.textContent = 'Prev';

    var currentWrap = document.createElement('div');
    currentWrap.className = 'week-current-wrap';

    var currentButton = document.createElement('button');
    currentButton.id = 'week-current-btn';
    currentButton.type = 'button';
    currentButton.className = 'week-current-btn';
    currentButton.setAttribute('aria-haspopup', 'dialog');
    currentButton.setAttribute('aria-expanded', 'false');

    var popover = document.createElement('div');
    popover.id = 'week-picker-popover';
    popover.className = 'week-picker-popover';
    popover.hidden = true;

    var popoverHead = document.createElement('div');
    popoverHead.className = 'week-picker-head';
    popoverHead.textContent = 'Saved weeks';

    var list = document.createElement('div');
    list.id = 'week-schedule-list';
    list.className = 'week-schedule-list';

    popover.appendChild(popoverHead);
    popover.appendChild(list);
    currentWrap.appendChild(currentButton);
    currentWrap.appendChild(popover);

    var nextButton = document.createElement('button');
    nextButton.id = 'week-next-btn';
    nextButton.type = 'button';
    nextButton.className = 'btn week-nav-btn';
    nextButton.setAttribute('aria-label', 'Next week');
    nextButton.textContent = 'Next';

    nav.appendChild(prevButton);
    nav.appendChild(currentWrap);
    nav.appendChild(nextButton);
    main.appendChild(nav);

    var saveButton = document.createElement('button');
    saveButton.id = 'save-week-btn';
    saveButton.type = 'button';
    saveButton.className = 'btn btn-secondary week-save-btn';
    saveButton.textContent = 'Save Week';

    bar.appendChild(main);
    bar.appendChild(saveButton);
    headerActions.insertBefore(bar, headerActions.firstChild);

    if (saveButton) {
      saveButton.addEventListener('click', function () {
        saveCurrentWeek();
        renderWeekUI();
      });
    }

    if (prevButton) {
      prevButton.addEventListener('click', function () {
        openAdjacentWeek(-1);
      });
    }

    if (nextButton) {
      nextButton.addEventListener('click', function () {
        openAdjacentWeek(1);
      });
    }

    if (currentButton) {
      currentButton.addEventListener('click', function () {
        if (!popover) return;
        var isOpen = !popover.hidden;
        popover.hidden = isOpen;
        currentButton.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      });
    }

    if (list) {
      list.addEventListener('click', function (event) {
        var deleteButton = event.target.closest('[data-delete-week-id]');
        if (deleteButton) {
          event.preventDefault();
          event.stopPropagation();
          deleteWeek(deleteButton.getAttribute('data-delete-week-id'));
          return;
        }
        var button = event.target.closest('[data-week-id]');
        if (!button) return;
        if (popover) popover.hidden = true;
        if (currentButton) currentButton.setAttribute('aria-expanded', 'false');
        applyWeek(button.getAttribute('data-week-id'));
      });
    }

    document.addEventListener('click', function (event) {
      var recurringButton = event.target.closest('.hour-recurring-btn');
      if (!recurringButton) return;
      event.preventDefault();
      var rowIndex = Number(recurringButton.getAttribute('data-row-index'));
      if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex > 23) return;
      if (recurringButton.classList.contains('active')) {
        removeRecurringRow(rowIndex);
        return;
      }
      captureRecurringRow(rowIndex);
    });

    document.addEventListener('click', function (event) {
      if (!popover || popover.hidden) return;
      if (bar.contains(event.target)) return;
      popover.hidden = true;
      if (currentButton) currentButton.setAttribute('aria-expanded', 'false');
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || !popover || popover.hidden) return;
      popover.hidden = true;
      if (currentButton) currentButton.setAttribute('aria-expanded', 'false');
    });
  }

  function replaceChildren(node, children) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
    children.forEach(function (child) {
      node.appendChild(child);
    });
  }

  function buildTextSpan(className, text) {
    var span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  }

  function buildWeekScheduleEntry(weekId, isActive) {
    var entry = store.weeks[weekId];
    var hours = countAssignedHours(entry ? entry.state : null);
    var label = relativeWeekLabel(weekId);

    var wrapper = document.createElement('div');
    wrapper.className = 'week-schedule-entry' + (isActive ? ' active' : '');

    var itemButton = document.createElement('button');
    itemButton.type = 'button';
    itemButton.className = 'week-schedule-item' + (isActive ? ' active' : '');
    itemButton.setAttribute('data-week-id', weekId);

    itemButton.appendChild(buildTextSpan('week-schedule-main', describeWeek(weekId)));
    itemButton.appendChild(buildTextSpan('week-schedule-meta', (label || weekId) + ' · starts ' + weekId));
    itemButton.appendChild(buildTextSpan('week-schedule-meta', hours + 'h planned'));

    var deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'week-schedule-delete';
    deleteButton.setAttribute('data-delete-week-id', weekId);
    deleteButton.setAttribute('aria-label', 'Delete saved week ' + weekId);
    deleteButton.textContent = 'Delete';

    wrapper.appendChild(itemButton);
    wrapper.appendChild(deleteButton);
    return wrapper;
  }

  function renderWeekUI() {
    var currentButton = document.getElementById('week-current-btn');
    var list = document.getElementById('week-schedule-list');
    if (!currentButton || !list) return;

    var relative = relativeWeekLabel(selectedWeekId);
    replaceChildren(currentButton, [
      buildTextSpan('week-current-main', describeWeek(selectedWeekId)),
      buildTextSpan('week-current-sub', (relative || selectedWeekId) + ' · ' + selectedWeekId)
    ]);

    var ids = visibleWeekIds();
    replaceChildren(list, ids.map(function (weekId) {
      return buildWeekScheduleEntry(weekId, weekId === selectedWeekId);
    }));
    renderWeekStatus();
  }

  window.L = function () {
    var result = originalL.apply(this, arguments);
    if (!isApplyingWeek) {
      if (!isFutureWeek(selectedWeekId)) {
        syncRecurringRowsFromCurrentState();
      }
      flushCurrentWeek();
      renderWeekUI();
    }
    renderRecurringButtons();
    return result;
  };

  window.OJ = function (state) {
    var result = originalOJ ? originalOJ.call(this, state) : undefined;
    if (!isApplyingWeek) {
      if (!isFutureWeek(selectedWeekId)) {
        syncRecurringRowsFromCurrentState();
      }
      flushCurrentWeek();
      renderWeekUI();
    }
    renderRecurringButtons();
    return result;
  };

  window.M = function () {
    var result = originalM.apply(this, arguments);
    renderRecurringButtons();
    return result;
  };

  window.addEventListener('pagehide', flushCurrentWeek);
  window.addEventListener('beforeunload', flushCurrentWeek);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushCurrentWeek();
  });

  ensureWeekExists(selectedWeekId, window.Y, window.N);
  flushCurrentWeek();
  buildUI();
  ensureStatusTimer();
  applyWeek(selectedWeekId);
})();
