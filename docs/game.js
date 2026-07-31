// Browser controller for the deterministic engine and AI.
(() => {
  'use strict';

  const Engine = window.LinesEngine;
  const AI = window.LinesAI;
  const BEST_KEY = 'lines_best_score';
  const MUTE_KEY = 'lines_muted';
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const AI_PROFILES = {
    fast: { depth: 1, timeLimitMs: 25, rootLookahead: 0, beamWidth: 1, label: 'Fast' },
    strong: { depth: 2, timeLimitMs: 75, rootLookahead: 20, beamWidth: 1, label: 'Strong' },
    deep: { depth: 3, timeLimitMs: 350, rootLookahead: 16, beamWidth: 3, label: 'Deep' }
  };

  let state;
  let selected = null;
  let suggestion = null;
  let analysis = null;
  let isAnimating = false;
  let isThinking = false;
  let analysisMode = false;
  let autoPlaying = false;
  let displayBoard = null;
  let clearingSet = null;
  let spawningSet = null;
  let audioCtx = null;
  let muted = localStorage.getItem(MUTE_KEY) === '1';
  let workerSequence = 0;
  const workerRequests = new Map();
  const aiWorker = typeof Worker === 'function' ? new Worker('ai-worker.js') : null;

  const boardEl = document.getElementById('board');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const turnEl = document.getElementById('turn');
  const overlayEl = document.getElementById('overlay');
  const overlayTitleEl = document.getElementById('overlayTitle');
  const overlayScoreEl = document.getElementById('overlayScore');
  const soundBtn = document.getElementById('soundBtn');
  const newGameBtn = document.getElementById('newGameBtn');
  const overlayRestartBtn = document.getElementById('overlayRestart');
  const analyzeBtn = document.getElementById('analyzeBtn');
  const stepBtn = document.getElementById('stepBtn');
  const autoplayBtn = document.getElementById('autoplayBtn');
  const strengthSelect = document.getElementById('strengthSelect');
  const engineStatusEl = document.getElementById('engineStatus');
  const engineMoveEl = document.getElementById('engineMove');
  const engineReasonEl = document.getElementById('engineReason');
  const engineStatsEl = document.getElementById('engineStats');
  const candidateListEl = document.getElementById('candidateList');
  const cellEls = [];

  if (aiWorker) {
    aiWorker.addEventListener('message', (event) => {
      const pending = workerRequests.get(event.data.id);
      if (!pending) return;
      workerRequests.delete(event.data.id);
      if (event.data.error) pending.reject(new Error(event.data.error));
      else pending.resolve(event.data.result);
    });
    aiWorker.addEventListener('error', (event) => {
      for (const pending of workerRequests.values()) pending.reject(event.error || new Error(event.message));
      workerRequests.clear();
    });
  }

  function analyzePosition(position, profile) {
    if (!aiWorker) return Promise.resolve(AI.analyze(position, profile));
    const id = ++workerSequence;
    return new Promise((resolve, reject) => {
      workerRequests.set(id, { resolve, reject });
      aiWorker.postMessage({ id, state: position, options: profile });
    });
  }

  function ensureAudioContext() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContext();
    }
    return audioCtx;
  }

  function playTone(frequency, duration, type = 'sine', gain = 0.12, delay = 0) {
    if (muted) return;
    const context = ensureAudioContext();
    if (context.state === 'suspended') context.resume();
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    volume.gain.setValueAtTime(gain, start);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(volume).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function playSound(name) {
    if (name === 'select') playTone(660, 0.06, 'triangle');
    if (name === 'tick') playTone(760, 0.03, 'triangle', 0.05);
    if (name === 'move') playTone(520, 0.05, 'sine', 0.1);
    if (name === 'pop') [880, 660, 440].forEach((f, i) => playTone(f, 0.14, 'square', 0.08, i * 0.05));
    if (name === 'spawn') {
      playTone(300, 0.09, 'sine', 0.07);
      playTone(450, 0.09, 'sine', 0.05, 0.05);
    }
    if (name === 'invalid') playTone(160, 0.15, 'sawtooth', 0.08);
    if (name === 'gameover') [392, 349, 330, 262].forEach((f, i) => playTone(f, 0.25, 'sine', 0.1, i * 0.18));
    if (name === 'victory') [523, 659, 784, 1047].forEach((f, i) => playTone(f, 0.2, 'triangle', 0.1, i * 0.14));
  }

  function buildBoard() {
    boardEl.innerHTML = '';
    for (let index = 0; index < Engine.CELL_COUNT; index++) {
      const cell = document.createElement('button');
      cell.className = 'cell selectable';
      const coordinate = Engine.coordinates(index);
      cell.setAttribute('aria-label', `${String.fromCharCode(65 + coordinate.c)}${coordinate.r + 1}`);
      cell.addEventListener('click', () => onCellClick(index));
      boardEl.appendChild(cell);
      cellEls.push(cell);
    }
  }

  function previewAt(index) {
    const previewIndex = state.nextPositions.indexOf(index);
    return previewIndex === -1 ? null : state.nextColors[previewIndex];
  }

  function render() {
    const board = displayBoard || state.board;
    for (let index = 0; index < Engine.CELL_COUNT; index++) {
      const cell = cellEls[index];
      cell.innerHTML = '';
      cell.classList.toggle('suggest-start', Boolean(suggestion && suggestion.start === index));
      cell.classList.toggle('suggest-end', Boolean(suggestion && suggestion.end === index));
      const color = board[index];
      if (color !== Engine.EMPTY) {
        const ball = document.createElement('span');
        ball.className = `ball color-${color}`;
        if (selected === index) ball.classList.add('selected');
        if (clearingSet && clearingSet.has(index)) ball.classList.add('popping');
        if (spawningSet && spawningSet.has(index)) ball.classList.add('spawning');
        cell.appendChild(ball);
      } else {
        const previewColor = previewAt(index);
        if (previewColor !== null) {
          const dot = document.createElement('span');
          dot.className = `preview-dot color-${previewColor}`;
          cell.appendChild(dot);
        }
      }
    }
    scoreEl.textContent = state.score;
    bestEl.textContent = localStorage.getItem(BEST_KEY) || '0';
    turnEl.textContent = state.turn;
    analyzeBtn.disabled = isAnimating || isThinking || state.gameOver;
    stepBtn.disabled = isAnimating || isThinking || state.gameOver;
    strengthSelect.disabled = isThinking || autoPlaying;
  }

  function resetAnalysis(message = 'Ready') {
    analysis = null;
    suggestion = null;
    engineStatusEl.textContent = message;
    engineStatusEl.classList.remove('thinking');
    engineMoveEl.textContent = '—';
    engineReasonEl.textContent = 'Analyze the position to see the best move.';
    engineStatsEl.textContent = '';
    candidateListEl.innerHTML = '';
  }

  function renderAnalysisToggle() {
    analyzeBtn.textContent = analysisMode ? 'Analysis on' : 'Analysis off';
    analyzeBtn.classList.toggle('active', analysisMode);
    analyzeBtn.setAttribute('aria-pressed', String(analysisMode));
  }

  function renderAnalysis(result) {
    analysis = result;
    suggestion = result.bestMove;
    engineStatusEl.textContent = 'Position analyzed';
    engineStatusEl.classList.remove('thinking');
    if (!result.best) {
      engineMoveEl.textContent = 'No legal move';
      engineReasonEl.textContent = '';
      render();
      return;
    }
    engineMoveEl.textContent = result.best.label;
    engineReasonEl.textContent = result.best.reason;
    const stats = result.stats;
    engineStatsEl.textContent =
      `depth ${stats.depth} · ${stats.nodes.toLocaleString()} nodes · ${Math.round(stats.elapsedMs)} ms`;
    candidateListEl.innerHTML = '';
    result.candidates.forEach((candidate, index) => {
      const button = document.createElement('button');
      button.className = `candidate${index === 0 ? ' best' : ''}`;
      button.innerHTML =
        `<span class="candidate-rank">${index + 1}</span>` +
        `<span><strong>${candidate.label}</strong><small>${candidate.reason}</small></span>` +
        `<span class="candidate-gain">${candidate.immediateGain ? `+${candidate.immediateGain}` : ''}</span>`;
      button.addEventListener('click', () => {
        suggestion = candidate.move;
        engineMoveEl.textContent = candidate.label;
        engineReasonEl.textContent = candidate.reason;
        render();
      });
      candidateListEl.appendChild(button);
    });
    render();
  }

  async function requestAnalysis() {
    if (isAnimating || isThinking || state.gameOver) return null;
    isThinking = true;
    engineStatusEl.textContent = 'Calculating…';
    engineStatusEl.classList.add('thinking');
    engineMoveEl.textContent = '…';
    render();
    await sleep(20); // Give the browser a chance to paint the thinking state.
    const profile = AI_PROFILES[strengthSelect.value] || AI_PROFILES.strong;
    const analyzedSeed = state.seed;
    const analyzedTurn = state.turn;
    let result;
    try {
      result = await analyzePosition(state, profile);
    } catch (error) {
      console.error('AI worker failed; falling back to main-thread analysis.', error);
      result = AI.analyze(state, profile);
    }
    if (state.seed !== analyzedSeed || state.turn !== analyzedTurn) return null;
    isThinking = false;
    renderAnalysis(result);
    return result;
  }

  async function flashPath(path) {
    const perStep = autoPlaying ? 11 : 28;
    path.forEach((index, offset) => {
      setTimeout(() => {
        const cell = cellEls[index];
        cell.classList.remove('path-flash');
        void cell.offsetWidth;
        cell.classList.add('path-flash');
        if (!autoPlaying || offset === path.length - 1) playSound('tick');
      }, offset * perStep);
    });
    await sleep(path.length * perStep + (autoPlaying ? 35 : 100));
  }

  function stagedBoardBeforeResolution(before, move, result, previewColors) {
    const staged = before.slice();
    staged[move.end] = staged[move.start];
    staged[move.start] = Engine.EMPTY;
    result.spawned.forEach((position, index) => {
      staged[position] = previewColors[index];
    });
    return staged;
  }

  async function executeMove(move) {
    if (isAnimating || state.gameOver || !Engine.isLegalMove(state, move)) return false;
    isAnimating = true;
    selected = null;
    suggestion = null;
    const path = Engine.findPath(state, move.start, move.end);
    await flashPath(path);
    const boardBefore = state.board.slice();
    const previewColors = state.nextColors.slice();
    const result = Engine.applyMove(state, move);
    displayBoard = stagedBoardBeforeResolution(boardBefore, move, result, previewColors);
    playSound('move');

    if (result.spawned.length) {
      spawningSet = new Set(result.spawned);
      playSound('spawn');
      render();
      await sleep(autoPlaying ? 75 : 180);
      spawningSet = null;
    }
    if (result.cleared.length) {
      clearingSet = new Set(result.cleared);
      playSound('pop');
      render();
      await sleep(autoPlaying ? 120 : 260);
      clearingSet = null;
    }

    displayBoard = null;
    analysis = null;
    isAnimating = false;
    resetAnalysis(autoPlaying ? 'Watching AI' : 'Ready');
    render();
    if (state.gameOver) {
      endGame();
    } else if (analysisMode && !autoPlaying) {
      await requestAnalysis();
    }
    return true;
  }

  function shakeCell(index) {
    const cell = cellEls[index];
    cell.classList.remove('shake');
    void cell.offsetWidth;
    cell.classList.add('shake');
    setTimeout(() => cell.classList.remove('shake'), 320);
  }

  async function onCellClick(index) {
    if (isAnimating || isThinking || autoPlaying || state.gameOver) return;
    const occupied = state.board[index] !== Engine.EMPTY;
    if (selected === null) {
      if (occupied) {
        selected = index;
        playSound('select');
        render();
      }
      return;
    }
    if (selected === index) {
      selected = null;
      render();
    } else if (occupied) {
      selected = index;
      playSound('select');
      render();
    } else {
      const move = { start: selected, end: index };
      if (!Engine.isLegalMove(state, move)) {
        playSound('invalid');
        shakeCell(index);
        return;
      }
      await executeMove(move);
    }
  }

  function endGame() {
    stopAutoplay();
    const best = Number(localStorage.getItem(BEST_KEY) || 0);
    const isNewBest = state.score > best;
    if (isNewBest) localStorage.setItem(BEST_KEY, String(state.score));
    overlayTitleEl.textContent = isNewBest ? 'New Best Score!' : 'Game Over';
    overlayScoreEl.textContent = `Scored ${state.score} in ${state.turn} moves.`;
    overlayEl.classList.remove('hidden');
    playSound(isNewBest ? 'victory' : 'gameover');
    render();
  }

  function newGame() {
    stopAutoplay();
    state = Engine.createGame(Date.now());
    selected = null;
    displayBoard = null;
    clearingSet = null;
    spawningSet = null;
    isAnimating = false;
    isThinking = false;
    overlayEl.classList.add('hidden');
    resetAnalysis();
    renderAnalysisToggle();
    render();
    if (analysisMode) setTimeout(requestAnalysis, 0);
  }

  function stopAutoplay() {
    autoPlaying = false;
    autoplayBtn.textContent = '▶ Auto play';
    autoplayBtn.classList.remove('active');
  }

  async function autoplay() {
    if (autoPlaying) {
      stopAutoplay();
      return;
    }
    autoPlaying = true;
    autoplayBtn.textContent = '■ Stop';
    autoplayBtn.classList.add('active');
    selected = null;
    while (autoPlaying && !state.gameOver) {
      const result = await requestAnalysis();
      if (!autoPlaying || !result || !result.bestMove) break;
      await executeMove(result.bestMove);
      await sleep(45);
    }
    if (!state.gameOver) stopAutoplay();
  }

  document.addEventListener('pointerdown', () => {
    try { ensureAudioContext().resume(); } catch (error) { /* audio is optional */ }
  }, { once: true });

  soundBtn.addEventListener('click', () => {
    muted = !muted;
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    soundBtn.textContent = muted ? '🔇' : '🔊';
  });
  newGameBtn.addEventListener('click', newGame);
  overlayRestartBtn.addEventListener('click', newGame);
  analyzeBtn.addEventListener('click', async () => {
    analysisMode = !analysisMode;
    renderAnalysisToggle();
    if (analysisMode) await requestAnalysis();
    else {
      resetAnalysis('Analysis off');
      render();
    }
  });
  stepBtn.addEventListener('click', async () => {
    const result = suggestion ? analysis : await requestAnalysis();
    const move = suggestion || (result && result.bestMove);
    if (move) await executeMove(move);
  });
  autoplayBtn.addEventListener('click', autoplay);
  strengthSelect.addEventListener('change', () => resetAnalysis(`${AI_PROFILES[strengthSelect.value].label} mode`));

  buildBoard();
  soundBtn.textContent = muted ? '🔇' : '🔊';
  newGame();
})();
