'use strict';

const assert = require('node:assert/strict');
const Engine = require('../docs/engine.js');

function stateWith(boardEntries, preview) {
  const state = Engine.createGame(1);
  state.board.fill(Engine.EMPTY);
  for (const [index, color] of boardEntries) state.board[index] = color;
  state.nextColors = (preview && preview.colors || [1, 2, 3]).slice();
  state.nextPositions = (preview && preview.positions || [70, 71, 72]).slice();
  state.score = 0;
  state.turn = 0;
  state.gameOver = false;
  return state;
}

function testDeterminism() {
  assert.deepEqual(Engine.createGame(12345), Engine.createGame(12345));
  assert.notDeepEqual(Engine.createGame(12345), Engine.createGame(54321));
}

function testPathfinding() {
  const state = stateWith([[0, 0], [1, 1], [10, 2]]);
  assert.deepEqual(Engine.findPath(state, 0, 9), [0, 9]);
  state.board[9] = 3;
  assert.equal(Engine.findPath(state, 0, 18), null);
}

function testMoveClearSkipsSpawn() {
  const state = stateWith([[0, 0], [1, 0], [2, 0], [3, 0], [13, 0]]);
  const originalPreview = state.nextPositions.slice();
  const result = Engine.applyMove(state, { start: 13, end: 4 });
  assert.equal(result.scoreGain, 5);
  assert.equal(result.spawned.length, 0);
  assert.deepEqual(state.nextPositions, originalPreview);
  assert.equal(Engine.emptyCells(state).length, 81);
}

function testSpawnAndSpawnClear() {
  const state = stateWith(
    [[0, 4], [1, 4], [2, 4], [3, 4], [20, 2]],
    { colors: [4], positions: [4] }
  );
  const result = Engine.applyMove(state, { start: 20, end: 21 });
  assert.deepEqual(result.spawned, [4]);
  assert.equal(result.scoreGain, 5);
  assert.equal(state.board[4], Engine.EMPTY);
  assert.equal(state.nextColors.length, 3);
}

function testCrossScoresUniqueBalls() {
  const entries = [];
  for (const index of [36, 37, 39, 40, 2, 11, 20, 29, 50]) entries.push([index, 2]);
  const state = stateWith(entries);
  const result = Engine.applyMove(state, { start: 50, end: 38 });
  assert.equal(result.scoreGain, 9);
}

function testFastLegalMovesMatchPathfinder() {
  for (let seed = 1; seed <= 20; seed++) {
    const state = Engine.createGame(seed);
    for (let turn = 0; turn < 12 && !state.gameOver; turn++) {
      const moves = Engine.legalMoves(state);
      const listedMoves = new Set(moves.map((move) => `${move.start}:${move.end}`));
      for (const move of moves) assert.ok(Engine.findPath(state, move.start, move.end));
      for (let start = 0; start < Engine.CELL_COUNT; start++) {
        if (state.board[start] === Engine.EMPTY) continue;
        for (let end = 0; end < Engine.CELL_COUNT; end++) {
          if (state.board[end] !== Engine.EMPTY) continue;
          const listed = listedMoves.has(`${start}:${end}`);
          assert.equal(listed, Engine.findPath(state, start, end) !== null);
        }
      }
      Engine.applyMove(state, moves[(seed * 17 + turn * 31) % moves.length]);
      assert.equal(Engine.findLines(state.board).count, 0);
    }
  }
}

for (const test of [
  testDeterminism,
  testPathfinding,
  testMoveClearSkipsSpawn,
  testSpawnAndSpawnClear,
  testCrossScoresUniqueBalls,
  testFastLegalMovesMatchPathfinder
]) test();

console.log('engine tests passed');
