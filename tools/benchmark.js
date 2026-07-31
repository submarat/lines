'use strict';

const Engine = require('../docs/engine.js');
const AI = require('../docs/ai.js');

const seeds = Number(process.argv[2] || 10);
const mode = process.argv[3] || 'strong';
const maxTurns = Number(process.argv[4] || 1000);
const timeLimitMs = Number(process.argv[5] || 100);
const rootLookahead = Number(process.argv[6] || (mode === 'deep' ? 16 : 20));
const beamWidth = Number(process.argv[7] || (mode === 'deep' ? 3 : 1));

function randomGenerator(seed) {
  let state = seed >>> 0 || 1;
  return (maximum) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % maximum;
  };
}

function play(seed) {
  const state = Engine.createGame(seed);
  const randomInt = randomGenerator(seed ^ 0xa511e9b3);
  const started = Date.now();
  while (!state.gameOver && state.turn < maxTurns) {
    let move;
    if (mode === 'random') {
      const moves = Engine.legalMoves(state);
      move = moves[randomInt(moves.length)];
    } else {
      const options = mode === 'greedy'
        ? { depth: 1, timeLimitMs: 60000 }
        : {
            depth: mode === 'deep' ? 3 : 2,
            rootLookahead,
            beamWidth,
            timeLimitMs
          };
      move = AI.chooseMove(state, options);
    }
    if (!move) break;
    Engine.applyMove(state, move);
  }
  return { seed, score: state.score, turns: state.turn, ms: Date.now() - started };
}

const results = [];
for (let seed = 1; seed <= seeds; seed++) {
  const result = play(seed);
  results.push(result);
  process.stdout.write(
    `seed ${String(seed).padStart(3)}  score ${String(result.score).padStart(4)}  ` +
    `turns ${String(result.turns).padStart(4)}  ${(result.ms / 1000).toFixed(2)}s\n`
  );
}

const values = results.map((result) => result.score).sort((a, b) => a - b);
const total = values.reduce((sum, value) => sum + value, 0);
const median = values[Math.floor(values.length / 2)];
console.log(
  `${mode}: mean ${(total / values.length).toFixed(1)}, median ${median}, ` +
  `min ${values[0]}, max ${values[values.length - 1]} (${seeds} seeds)`
);
