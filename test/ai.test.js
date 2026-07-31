'use strict';

const assert = require('node:assert/strict');
const Engine = require('../docs/engine.js');
const AI = require('../docs/ai.js');

function emptyState() {
  const state = Engine.createGame(99);
  state.board.fill(Engine.EMPTY);
  state.nextColors = [1, 2, 3];
  state.nextPositions = [70, 71, 72];
  state.score = 0;
  state.gameOver = false;
  return state;
}

function testTakesImmediateLine() {
  const state = emptyState();
  for (const index of [0, 1, 2, 3, 13]) state.board[index] = 0;
  const analysis = AI.analyze(state, { depth: 1, timeLimitMs: 1000 });
  assert.deepEqual(analysis.bestMove, { start: 13, end: 4 });
  assert.equal(analysis.best.immediateGain, 5);
}

function testAnalysisIsPureAndLegal() {
  const state = Engine.createGame(1234);
  const before = Engine.cloneState(state);
  const analysis = AI.analyze(state, { depth: 2, timeLimitMs: 1000, rootLookahead: 3 });
  assert.deepEqual(state, before);
  assert.ok(Engine.isLegalMove(state, analysis.bestMove));
  assert.ok(analysis.stats.nodes > 0);
  assert.ok(analysis.candidates.length > 0);
}

function testBeamSearchReturnsAThreeMoveVariation() {
  const state = Engine.createGame(4321);
  const analysis = AI.analyze(state, {
    depth: 3,
    beamWidth: 2,
    rootLookahead: 2,
    timeLimitMs: 1000
  });
  assert.equal(analysis.stats.depth, 3);
  assert.equal(analysis.best.pv.length, 3);
  assert.ok(Engine.isLegalMove(state, analysis.bestMove));
}

testTakesImmediateLine();
testAnalysisIsPureAndLegal();
testBeamSearchReturnsAThreeMoveVariation();
console.log('ai tests passed');
