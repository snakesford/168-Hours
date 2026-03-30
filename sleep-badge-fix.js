(function () {
  'use strict';

  function sleepHoursForIndex(state, index) {
    var chunkCount = (state.cellChunks && state.cellChunks[index]) || 1;
    if (chunkCount > 1) {
      var chunks = Array.isArray(state.gridChunks && state.gridChunks[index])
        ? state.gridChunks[index]
        : Array(chunkCount).fill((state.grid && state.grid[index]) || 'unassigned');
      var total = 0;
      for (var i = 0; i < chunkCount; i++) {
        if ((chunks[i] || 'unassigned') === 'sleep') total += 1 / chunkCount;
      }
      return total;
    }

    return state.grid && state.grid[index] === 'sleep' ? 1 : 0;
  }

  function computeSleepBadges() {
    var badges = new Map();
    var state = window.Y;
    if (!state || !Array.isArray(state.grid) || state.grid.length !== 168) return badges;

    var running = 0;
    for (var carryIndex = 167; carryIndex >= 0; carryIndex--) {
      var carryHours = sleepHoursForIndex(state, carryIndex);
      if (carryHours > 0) {
        running += carryHours;
      } else {
        break;
      }
    }

    for (var index = 0; index < 168; index++) {
      var hours = sleepHoursForIndex(state, index);
      if (hours > 0) {
        running += hours;
        var wholeHours = Math.floor(running + 1e-9);
        if (wholeHours > 0) badges.set(index, wholeHours);
      } else {
        running = 0;
      }
    }

    return badges;
  }

  function applySleepBadges() {
    var grid = document.getElementById('grid');
    if (!grid) return;

    var badges = computeSleepBadges();
    var cells = grid.querySelectorAll('.cell[data-index]');
    Array.prototype.forEach.call(cells, function (cell) {
      var existing = cell.querySelector('.sleep-hour-badge');
      if (existing) existing.remove();

      var index = Number(cell.dataset.index);
      var hours = badges.get(index);
      if (!hours) return;

      var badge = document.createElement('span');
      badge.className = 'sleep-hour-badge';
      badge.textContent = String(hours);
      cell.appendChild(badge);
    });
  }

  function install() {
    if (typeof window.M !== 'function') return;

    var originalRender = window.M;
    window.M = function () {
      var result = originalRender.apply(this, arguments);
      applySleepBadges();
      return result;
    };

    applySleepBadges();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
}());
