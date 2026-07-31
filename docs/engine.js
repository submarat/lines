// Deterministic, UI-independent Lines Solitaire engine.
// Works as a browser global (`LinesEngine`) and as a CommonJS module.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LinesEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SIZE = 9;
  const CELL_COUNT = SIZE * SIZE;
  const N_COLORS = 7;
  const LINE_LENGTH = 5;
  const EMPTY = -1;
  const SPAWN_COUNT = 3;
  const ORTHOGONAL = [-1, 1, -SIZE, SIZE];
  const LINE_DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  const rowOf = (index) => Math.floor(index / SIZE);
  const colOf = (index) => index % SIZE;
  const toIndex = (row, col) => row * SIZE + col;
  const inBounds = (row, col) => row >= 0 && row < SIZE && col >= 0 && col < SIZE;
  const sameCell = (a, b) => a === b;

  function normalizeSeed(seed) {
    const value = Number(seed) >>> 0;
    return value || 0x9e3779b9;
  }

  // Mulberry32's state transition, exposed through the state so simulations clone exactly.
  function random(state) {
    state.rngState = (state.rngState + 0x6d2b79f5) >>> 0;
    let value = state.rngState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  function randomInt(state, maximum) {
    return Math.floor(random(state) * maximum);
  }

  function cloneState(state) {
    return {
      board: state.board.slice(),
      score: state.score,
      nextColors: state.nextColors.slice(),
      nextPositions: state.nextPositions.slice(),
      rngState: state.rngState >>> 0,
      turn: state.turn,
      gameOver: state.gameOver,
      seed: state.seed >>> 0
    };
  }

  function emptyCells(state) {
    const result = [];
    for (let index = 0; index < CELL_COUNT; index++) {
      if (state.board[index] === EMPTY) result.push(index);
    }
    return result;
  }

  function shuffled(state, values) {
    for (let index = values.length - 1; index > 0; index--) {
      const other = randomInt(state, index + 1);
      const temporary = values[index];
      values[index] = values[other];
      values[other] = temporary;
    }
    return values;
  }

  function generatePreview(state) {
    const positions = shuffled(state, emptyCells(state)).slice(0, SPAWN_COUNT);
    state.nextColors = positions.map(() => randomInt(state, N_COLORS));
    state.nextPositions = positions;
  }

  function findLines(board) {
    const marked = new Uint8Array(CELL_COUNT);
    let count = 0;

    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        const start = toIndex(row, col);
        const color = board[start];
        if (color === EMPTY) continue;

        for (const [deltaRow, deltaCol] of LINE_DIRECTIONS) {
          const previousRow = row - deltaRow;
          const previousCol = col - deltaCol;
          if (inBounds(previousRow, previousCol) &&
              board[toIndex(previousRow, previousCol)] === color) continue;

          let length = 1;
          let nextRow = row + deltaRow;
          let nextCol = col + deltaCol;
          while (inBounds(nextRow, nextCol) &&
                 board[toIndex(nextRow, nextCol)] === color) {
            length++;
            nextRow += deltaRow;
            nextCol += deltaCol;
          }

          if (length >= LINE_LENGTH) {
            for (let offset = 0; offset < length; offset++) {
              const index = toIndex(row + deltaRow * offset, col + deltaCol * offset);
              if (!marked[index]) {
                marked[index] = 1;
                count++;
              }
            }
          }
        }
      }
    }
    return { marked, count };
  }

  function clearLines(state) {
    const lines = findLines(state.board);
    if (!lines.count) return [];
    const cleared = [];
    for (let index = 0; index < CELL_COUNT; index++) {
      if (lines.marked[index]) {
        state.board[index] = EMPTY;
        cleared.push(index);
      }
    }
    state.score += cleared.length;
    return cleared;
  }

  // A legal position never contains a completed line: lines are cleared as soon
  // as they are created. Therefore a new line must pass through the moved ball
  // or one of this turn's spawned balls. Checking only those anchors is much
  // cheaper than rescanning all 81 cells for every search node.
  function clearLinesThrough(state, anchors) {
    const marked = new Uint8Array(CELL_COUNT);
    let count = 0;
    for (const anchor of anchors) {
      const color = state.board[anchor];
      if (color === EMPTY) continue;
      const anchorRow = rowOf(anchor);
      const anchorCol = colOf(anchor);
      for (const [deltaRow, deltaCol] of LINE_DIRECTIONS) {
        let startRow = anchorRow;
        let startCol = anchorCol;
        while (inBounds(startRow - deltaRow, startCol - deltaCol) &&
               state.board[toIndex(startRow - deltaRow, startCol - deltaCol)] === color) {
          startRow -= deltaRow;
          startCol -= deltaCol;
        }
        let length = 0;
        let row = startRow;
        let col = startCol;
        while (inBounds(row, col) && state.board[toIndex(row, col)] === color) {
          length++;
          row += deltaRow;
          col += deltaCol;
        }
        if (length < LINE_LENGTH) continue;
        for (let offset = 0; offset < length; offset++) {
          const index = toIndex(startRow + deltaRow * offset, startCol + deltaCol * offset);
          if (!marked[index]) {
            marked[index] = 1;
            count++;
          }
        }
      }
    }
    if (!count) return [];
    const cleared = [];
    for (let index = 0; index < CELL_COUNT; index++) {
      if (!marked[index]) continue;
      state.board[index] = EMPTY;
      cleared.push(index);
    }
    state.score += cleared.length;
    return cleared;
  }

  function spawnPreview(state) {
    const placed = [];
    for (let previewIndex = 0; previewIndex < state.nextColors.length; previewIndex++) {
      let position = state.nextPositions[previewIndex];
      if (position === undefined || state.board[position] !== EMPTY ||
          placed.some((cell) => sameCell(cell, position))) {
        const available = emptyCells(state);
        if (!available.length) break;
        position = available[randomInt(state, available.length)];
      }
      state.board[position] = state.nextColors[previewIndex];
      placed.push(position);
    }
    return placed;
  }

  function reachableFrom(state, start, includeParents) {
    if (start < 0 || start >= CELL_COUNT || state.board[start] === EMPTY) {
      return { cells: [], parents: null };
    }
    const visited = new Uint8Array(CELL_COUNT);
    const parents = includeParents ? new Int16Array(CELL_COUNT).fill(-1) : null;
    const queue = new Int16Array(CELL_COUNT);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const cells = [];

    while (head < tail) {
      const current = queue[head++];
      const row = rowOf(current);
      const col = colOf(current);
      for (const delta of ORTHOGONAL) {
        const next = current + delta;
        if (next < 0 || next >= CELL_COUNT || visited[next]) continue;
        if ((delta === -1 || delta === 1) && rowOf(next) !== row) continue;
        if ((delta === -SIZE || delta === SIZE) && colOf(next) !== col) continue;
        if (state.board[next] !== EMPTY) continue;
        visited[next] = 1;
        if (parents) parents[next] = current;
        queue[tail++] = next;
        cells.push(next);
      }
    }
    return { cells, parents };
  }

  function findPath(state, start, end) {
    if (end < 0 || end >= CELL_COUNT || state.board[end] !== EMPTY) return null;
    const result = reachableFrom(state, start, true);
    if (result.parents[end] === -1) return null;
    const path = [end];
    let current = end;
    while (current !== start) {
      current = result.parents[current];
      path.push(current);
    }
    path.reverse();
    return path;
  }

  function legalMoves(state) {
    if (state.gameOver) return [];
    const componentOf = new Int16Array(CELL_COUNT).fill(-1);
    const components = [];
    for (let index = 0; index < CELL_COUNT; index++) {
      if (state.board[index] !== EMPTY || componentOf[index] !== -1) continue;
      const componentIndex = components.length;
      const cells = [index];
      componentOf[index] = componentIndex;
      for (let head = 0; head < cells.length; head++) {
        const current = cells[head];
        const row = rowOf(current);
        const col = colOf(current);
        for (const delta of ORTHOGONAL) {
          const next = current + delta;
          if (next < 0 || next >= CELL_COUNT || componentOf[next] !== -1) continue;
          if ((delta === -1 || delta === 1) && rowOf(next) !== row) continue;
          if ((delta === -SIZE || delta === SIZE) && colOf(next) !== col) continue;
          if (state.board[next] !== EMPTY) continue;
          componentOf[next] = componentIndex;
          cells.push(next);
        }
      }
      components.push(cells);
    }

    const moves = [];
    const seenComponents = new Uint8Array(components.length);
    for (let start = 0; start < CELL_COUNT; start++) {
      if (state.board[start] === EMPTY) continue;
      seenComponents.fill(0);
      const row = rowOf(start);
      for (const delta of ORTHOGONAL) {
        const neighbor = start + delta;
        if (neighbor < 0 || neighbor >= CELL_COUNT) continue;
        if ((delta === -1 || delta === 1) && rowOf(neighbor) !== row) continue;
        const component = componentOf[neighbor];
        if (component < 0 || seenComponents[component]) continue;
        seenComponents[component] = 1;
        for (const end of components[component]) moves.push({ start, end });
      }
    }
    return moves;
  }

  function isLegalMove(state, move) {
    return Boolean(move) && Number.isInteger(move.start) && Number.isInteger(move.end) &&
      state.board[move.start] !== EMPTY && state.board[move.end] === EMPTY &&
      findPath(state, move.start, move.end) !== null;
  }

  function applyMove(state, move, options) {
    const settings = options || {};
    if (settings.validate !== false && !isLegalMove(state, move)) throw new Error('Illegal move');
    const path = settings.includePath ? findPath(state, move.start, move.end) : null;
    const scoreBefore = state.score;
    const color = state.board[move.start];
    state.board[move.start] = EMPTY;
    state.board[move.end] = color;

    let cleared = clearLinesThrough(state, [move.end]);
    let spawned = [];
    if (!cleared.length) {
      spawned = spawnPreview(state);
      cleared = clearLinesThrough(state, spawned);
      generatePreview(state);
    }

    state.turn++;
    state.gameOver = emptyCells(state).length === 0;
    return {
      move: { start: move.start, end: move.end },
      path,
      spawned,
      cleared,
      scoreGain: state.score - scoreBefore,
      gameOver: state.gameOver
    };
  }

  function simulateMove(state, move) {
    const nextState = cloneState(state);
    const result = applyMove(nextState, move, { validate: false });
    return { state: nextState, result };
  }

  function createGame(seed) {
    const normalizedSeed = normalizeSeed(seed === undefined ? Date.now() : seed);
    const state = {
      board: new Array(CELL_COUNT).fill(EMPTY),
      score: 0,
      nextColors: [],
      nextPositions: [],
      rngState: normalizedSeed,
      turn: 0,
      gameOver: false,
      seed: normalizedSeed
    };
    generatePreview(state);
    spawnPreview(state);
    generatePreview(state);
    return state;
  }

  function coordinates(index) {
    return { r: rowOf(index), c: colOf(index) };
  }

  function moveLabel(move) {
    const start = coordinates(move.start);
    const end = coordinates(move.end);
    return `${String.fromCharCode(65 + start.c)}${start.r + 1}–${String.fromCharCode(65 + end.c)}${end.r + 1}`;
  }

  return {
    SIZE,
    CELL_COUNT,
    N_COLORS,
    LINE_LENGTH,
    EMPTY,
    LINE_DIRECTIONS,
    createGame,
    cloneState,
    emptyCells,
    findLines,
    findPath,
    reachableFrom,
    legalMoves,
    isLegalMove,
    applyMove,
    simulateMove,
    coordinates,
    toIndex,
    moveLabel
  };
});
