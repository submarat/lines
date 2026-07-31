// Search and evaluation engine for Lines Solitaire.
// Depends on docs/engine.js and works in both browsers and Node.
(function (root, factory) {
  const engine = typeof module === 'object' && module.exports
    ? require('./engine.js')
    : root.LinesEngine;
  const api = factory(engine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LinesAI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Engine) {
  'use strict';

  if (!Engine) throw new Error('LinesEngine must be loaded before LinesAI');

  const {
    SIZE, CELL_COUNT, N_COLORS, EMPTY, LINE_DIRECTIONS,
    legalMoves, simulateMove, coordinates, moveLabel
  } = Engine;

  const WINDOWS = [];
  const WINDOW_CELLS = [];
  const ADJACENT = Array.from({ length: CELL_COUNT }, () => []);
  const NEIGHBORS = new Int16Array(CELL_COUNT * 4).fill(-1);
  const WINDOW_VALUE = [0, 0.08, 1.1, 5.4, 25, 0];

  for (let index = 0; index < CELL_COUNT; index++) {
    const row = Math.floor(index / SIZE);
    const col = index % SIZE;
    let neighborOffset = index * 4;
    for (const [deltaRow, deltaCol] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nextRow = row + deltaRow;
      const nextCol = col + deltaCol;
      if (nextRow >= 0 && nextRow < SIZE && nextCol >= 0 && nextCol < SIZE) {
        ADJACENT[index].push(nextRow * SIZE + nextCol);
        NEIGHBORS[neighborOffset++] = nextRow * SIZE + nextCol;
      }
    }
  }

  for (const [deltaRow, deltaCol] of LINE_DIRECTIONS) {
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        const endRow = row + deltaRow * 4;
        const endCol = col + deltaCol * 4;
        if (endRow < 0 || endRow >= SIZE || endCol < 0 || endCol >= SIZE) continue;
        const cells = [];
        for (let offset = 0; offset < 5; offset++) {
          cells.push((row + deltaRow * offset) * SIZE + col + deltaCol * offset);
        }
        WINDOWS.push(cells);
        WINDOW_CELLS.push(...cells);
      }
    }
  }

  const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();

  function linePotential(board) {
    let value = 0;
    let threes = 0;
    let fours = 0;
    for (let windowIndex = 0; windowIndex < WINDOW_CELLS.length; windowIndex += 5) {
      let color = EMPTY;
      let count = 0;
      let blocked = false;
      for (let offset = 0; offset < 5; offset++) {
        const cell = board[WINDOW_CELLS[windowIndex + offset]];
        if (cell === EMPTY) continue;
        if (color === EMPTY) color = cell;
        else if (cell !== color) {
          blocked = true;
          break;
        }
        count++;
      }
      if (!blocked && count) {
        value += WINDOW_VALUE[count];
        if (count === 3) threes++;
        if (count === 4) fours++;
      }
    }
    return { value, threes, fours };
  }

  function spaceFeatures(board) {
    const visited = new Uint8Array(CELL_COUNT);
    const queue = new Int16Array(CELL_COUNT);
    let empty = 0;
    let components = 0;
    let largest = 0;
    let interfaces = 0;
    let trappedBalls = 0;

    for (let index = 0; index < CELL_COUNT; index++) {
      if (board[index] === EMPTY) {
        empty++;
        const neighborBase = index * 4;
        for (let neighborIndex = 0; neighborIndex < 4; neighborIndex++) {
          const neighbor = NEIGHBORS[neighborBase + neighborIndex];
          if (neighbor === -1) break;
          if (board[neighbor] !== EMPTY) interfaces++;
        }
        if (visited[index]) continue;
        components++;
        let head = 0;
        let tail = 0;
        queue[tail++] = index;
        visited[index] = 1;
        let size = 0;
        while (head < tail) {
          const current = queue[head++];
          size++;
          const currentNeighborBase = current * 4;
          for (let neighborIndex = 0; neighborIndex < 4; neighborIndex++) {
            const neighbor = NEIGHBORS[currentNeighborBase + neighborIndex];
            if (neighbor === -1) break;
            if (!visited[neighbor] && board[neighbor] === EMPTY) {
              visited[neighbor] = 1;
              queue[tail++] = neighbor;
            }
          }
        }
        largest = Math.max(largest, size);
      } else {
        let trapped = true;
        const neighborBase = index * 4;
        for (let neighborIndex = 0; neighborIndex < 4; neighborIndex++) {
          const neighbor = NEIGHBORS[neighborBase + neighborIndex];
          if (neighbor === -1) break;
          if (board[neighbor] === EMPTY) {
            trapped = false;
            break;
          }
        }
        if (trapped) trappedBalls++;
      }
    }
    return { empty, components, largest, interfaces, trappedBalls };
  }

  function previewLinePotential(state) {
    const changedPositions = [];
    for (let index = 0; index < state.nextColors.length; index++) {
      const position = state.nextPositions[index];
      if (position !== undefined && state.board[position] === EMPTY) {
        state.board[position] = state.nextColors[index];
        changedPositions.push(position);
      }
    }
    const result = linePotential(state.board);
    for (const position of changedPositions) state.board[position] = EMPTY;
    return result;
  }

  function evaluate(state, detailed) {
    if (state.gameOver) {
      const terminal = -1000000000 + state.score * 1000;
      return detailed ? { total: terminal, terminal: true } : terminal;
    }

    const space = spaceFeatures(state.board);
    const lines = linePotential(state.board);
    const previewLines = previewLinePotential(state);
    const fragmentation = Math.max(0, space.empty - space.largest);
    const previewDelta = previewLines.value - lines.value;

    // Score and room are both indispensable: score is the objective, while room buys
    // the turns needed to score again. Line windows make purposeful construction beat
    // aimless shuffling, and connectivity prevents late-game self-cages.
    const total =
      state.score * 52 +
      space.empty * 7.5 +
      space.largest * 1.35 -
      fragmentation * 7 -
      Math.max(0, space.components - 1) * 3.5 +
      space.interfaces * 0.08 -
      space.trappedBalls * 0.3 +
      lines.value * 2.2 +
      previewDelta * 0.7;

    if (!detailed) return total;
    return {
      total,
      score: state.score,
      empty: space.empty,
      largestRegion: space.largest,
      components: space.components,
      linePotential: lines.value,
      threes: lines.threes,
      fours: lines.fours,
      previewDelta
    };
  }

  function compareCandidates(left, right) {
    if (right.searchValue !== left.searchValue) return right.searchValue - left.searchValue;
    if (right.immediateGain !== left.immediateGain) return right.immediateGain - left.immediateGain;
    if (right.value !== left.value) return right.value - left.value;
    if (left.move.start !== right.move.start) return left.move.start - right.move.start;
    return left.move.end - right.move.end;
  }

  function scoreMoves(state, deadline, counters) {
    const moves = legalMoves(state);
    const candidates = [];
    for (const move of moves) {
      if ((counters.nodes & 63) === 0 && now() >= deadline) break;
      const simulation = simulateMove(state, move);
      counters.nodes++;
      const value = evaluate(simulation.state, false);
      candidates.push({
        move,
        state: simulation.state,
        result: simulation.result,
        value,
        searchValue: value,
        immediateGain: simulation.result.scoreGain,
        pv: [move]
      });
    }
    candidates.sort(compareCandidates);
    return candidates;
  }

  function extendBeam(candidate, depth, beamWidth, deadline, counters) {
    let frontier = [{
      state: candidate.state,
      value: candidate.value,
      pv: candidate.pv.slice()
    }];
    for (let ply = 1; ply < depth; ply++) {
      if (now() >= deadline) break;
      const nextFrontier = [];
      for (const node of frontier) {
        if (now() >= deadline || node.state.gameOver) continue;
        const replies = scoreMoves(node.state, deadline, counters);
        for (let index = 0; index < Math.min(beamWidth, replies.length); index++) {
          const reply = replies[index];
          nextFrontier.push({
            state: reply.state,
            value: reply.value,
            pv: node.pv.concat([reply.move])
          });
        }
      }
      if (!nextFrontier.length) break;
      nextFrontier.sort((left, right) => right.value - left.value);
      frontier = nextFrontier.slice(0, beamWidth);
      counters.depthReached = Math.max(counters.depthReached, ply + 1);
    }
    candidate.searchValue = frontier[0].value;
    candidate.pv = frontier[0].pv;
  }

  function describe(candidate, rootState) {
    const start = coordinates(candidate.move.start);
    const end = coordinates(candidate.move.end);
    const color = rootState.board[candidate.move.start];
    const details = evaluate(candidate.state, true);
    let reason;
    if (candidate.immediateGain) {
      reason = `clears ${candidate.immediateGain} ball${candidate.immediateGain === 1 ? '' : 's'}`;
    } else if (details.fours > 0) {
      reason = `builds ${details.fours} four-in-a-row chance${details.fours === 1 ? '' : 's'}`;
    } else if (details.threes > 0) {
      reason = `develops ${details.threes} three-ball line${details.threes === 1 ? '' : 's'}`;
    } else {
      reason = `keeps ${details.empty} spaces open`;
    }
    return {
      move: candidate.move,
      label: moveLabel(candidate.move),
      color,
      start,
      end,
      value: candidate.searchValue,
      immediateGain: candidate.immediateGain,
      reason,
      pv: candidate.pv.map(moveLabel),
      features: details
    };
  }

  function analyze(state, options) {
    const settings = Object.assign({
      depth: 2,
      timeLimitMs: 100,
      rootLookahead: 18,
      beamWidth: 1,
      alternatives: 5
    }, options);
    const started = now();
    const deadline = started + Math.max(10, settings.timeLimitMs);
    const counters = { nodes: 0, depthReached: 1 };
    const candidates = scoreMoves(state, deadline, counters);
    let rankedCandidates = candidates;

    const lookaheadCount = Math.min(settings.rootLookahead, candidates.length);
    if (settings.depth > 1) {
      for (let index = 0; index < lookaheadCount; index++) {
        if (now() >= deadline) break;
        extendBeam(candidates[index], settings.depth, settings.beamWidth, deadline, counters);
      }
      const searched = candidates.slice(0, lookaheadCount);
      const deepestVariation = searched.reduce(
        (maximum, candidate) => Math.max(maximum, candidate.pv.length),
        1
      );
      // Leaf evaluations from different depths are not comparable: a deeper
      // state has already paid for more spawn turns. Rank only equally searched
      // roots, falling back to the complete one-ply list if lookahead timed out.
      rankedCandidates = deepestVariation > 1
        ? searched.filter((candidate) => candidate.pv.length === deepestVariation)
        : candidates;
      rankedCandidates.sort(compareCandidates);
    }

    const elapsedMs = now() - started;
    const visible = rankedCandidates
      .slice(0, settings.alternatives)
      .map((candidate) => describe(candidate, state));
    return {
      bestMove: visible.length ? visible[0].move : null,
      best: visible[0] || null,
      candidates: visible,
      stats: {
        nodes: counters.nodes,
        legalMoves: legalMoves(state).length,
        depth: counters.depthReached,
        elapsedMs,
        nodesPerSecond: elapsedMs ? Math.round(counters.nodes * 1000 / elapsedMs) : counters.nodes
      }
    };
  }

  function chooseMove(state, options) {
    return analyze(state, options).bestMove;
  }

  return {
    WINDOWS,
    evaluate,
    analyze,
    chooseMove
  };
});
