// Lines Solitaire - browser port
// Rules ported from https://github.com/submarat/lines (C++/HGE original):
// 9x9 board, 7 ball colours. Select a ball, move it to an empty tile that it
// can reach through a chain of empty tiles. If moving the ball completes a
// line of 5+ same-coloured balls (row, column, or either diagonal), the line
// pops and scores points. Otherwise 3 new balls appear at previously
// previewed positions. Game ends when the board fills up.

(() => {
  const SIZE = 9;
  const N_COLORS = 7;
  const LINE_LENGTH = 5;
  const BEST_KEY = 'lines_best_score';
  const MUTE_KEY = 'lines_muted';

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  const key = (r, c) => `${r},${c}`;
  const randInt = (n) => Math.floor(Math.random() * n);

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---------- Audio ----------
  let audioCtx = null;
  let muted = localStorage.getItem(MUTE_KEY) === '1';

  function ensureCtx() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    }
    return audioCtx;
  }

  function playTone(freq, dur, type = 'sine', gain = 0.12, delay = 0) {
    if (muted) return;
    const ctx = ensureCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function playSound(name) {
    switch (name) {
      case 'select': playTone(660, 0.06, 'triangle', 0.12); break;
      case 'tick': playTone(760, 0.03, 'triangle', 0.06); break;
      case 'move': playTone(520, 0.05, 'sine', 0.10); break;
      case 'pop': [880, 660, 440].forEach((f, i) => playTone(f, 0.14, 'square', 0.09, i * 0.05)); break;
      case 'spawn': playTone(300, 0.09, 'sine', 0.07); playTone(450, 0.09, 'sine', 0.05, 0.05); break;
      case 'invalid': playTone(160, 0.15, 'sawtooth', 0.08); break;
      case 'gameover': [392, 349, 330, 262].forEach((f, i) => playTone(f, 0.25, 'sine', 0.11, i * 0.18)); break;
      case 'victory': [523, 659, 784, 1047].forEach((f, i) => playTone(f, 0.2, 'triangle', 0.11, i * 0.14)); break;
    }
  }

  document.addEventListener('pointerdown', () => { try { ensureCtx().resume(); } catch (e) {} }, { once: true });

  // ---------- Game state ----------
  let board = [];
  let score = 0;
  let selected = null; // {r, c}
  let nextColors = [];
  let nextPositions = []; // [{r,c}, ...]
  let isAnimating = false;
  let clearingSet = null; // Set of "r,c" currently mid-pop animation (still show ball)
  let spawningSet = null; // Set of "r,c" that just spawned this render

  function emptyCells() {
    const cells = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === null) cells.push({ r, c });
      }
    }
    return cells;
  }

  function generatePreview() {
    const colors = [randInt(N_COLORS), randInt(N_COLORS), randInt(N_COLORS)];
    const positions = shuffle(emptyCells()).slice(0, 3);
    return { colors, positions };
  }

  function bfsPath(start, end) {
    const visited = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
    const parent = new Map();
    const queue = [start];
    visited[start.r][start.c] = true;
    const deltas = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    while (queue.length) {
      const cur = queue.shift();
      if (cur.r === end.r && cur.c === end.c) {
        const path = [cur];
        let k = key(cur.r, cur.c);
        while (parent.has(k)) {
          const p = parent.get(k);
          path.unshift(p);
          k = key(p.r, p.c);
        }
        return path;
      }
      for (const [dr, dc] of deltas) {
        const nr = cur.r + dr, nc = cur.c + dc;
        if (!inBounds(nr, nc) || visited[nr][nc]) continue;
        if (board[nr][nc] !== null) continue;
        visited[nr][nc] = true;
        parent.set(key(nr, nc), cur);
        queue.push({ r: nr, c: nc });
      }
    }
    return null;
  }

  function findLines() {
    const toClear = new Set();
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const color = board[r][c];
        if (color === null) continue;
        for (const [dr, dc] of dirs) {
          const pr = r - dr, pc = c - dc;
          if (inBounds(pr, pc) && board[pr][pc] === color) continue; // not the start of a run
          let len = 1, rr = r + dr, cc = c + dc;
          while (inBounds(rr, cc) && board[rr][cc] === color) { len++; rr += dr; cc += dc; }
          if (len >= LINE_LENGTH) {
            let xr = r, xc = c;
            for (let n = 0; n < len; n++) { toClear.add(key(xr, xc)); xr += dr; xc += dc; }
          }
        }
      }
    }
    return toClear;
  }

  function spawnBalls() {
    const placed = [];
    for (let i = 0; i < nextColors.length; i++) {
      let pos = nextPositions[i];
      if (!pos || board[pos.r][pos.c] !== null) {
        const avail = emptyCells().filter((e) => !placed.some((p) => p.r === e.r && p.c === e.c));
        if (avail.length === 0) continue;
        pos = avail[randInt(avail.length)];
      }
      board[pos.r][pos.c] = nextColors[i];
      placed.push({ r: pos.r, c: pos.c });
    }
    return placed;
  }

  // ---------- DOM ----------
  const boardEl = document.getElementById('board');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const overlayEl = document.getElementById('overlay');
  const overlayTitleEl = document.getElementById('overlayTitle');
  const overlayScoreEl = document.getElementById('overlayScore');
  const soundBtn = document.getElementById('soundBtn');
  const newGameBtn = document.getElementById('newGameBtn');
  const overlayRestartBtn = document.getElementById('overlayRestart');

  const cellEls = [];

  function buildBoardDom() {
    boardEl.innerHTML = '';
    cellEls.length = 0;
    for (let r = 0; r < SIZE; r++) {
      const row = [];
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell selectable';
        cell.dataset.r = r;
        cell.dataset.c = c;
        cell.addEventListener('click', () => onCellClick(r, c));
        boardEl.appendChild(cell);
        row.push(cell);
      }
      cellEls.push(row);
    }
  }

  function render() {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = cellEls[r][c];
        cell.innerHTML = '';
        const color = board[r][c];
        const k = key(r, c);
        if (color !== null) {
          const ball = document.createElement('div');
          ball.className = 'ball';
          if (selected && selected.r === r && selected.c === c) ball.classList.add('selected');
          if (clearingSet && clearingSet.has(k)) {
            ball.dataset.mode = 'pop';
            ball.dataset.row = String(N_COLORS + color); // pop rows follow the 7 idle rows
            ball.dataset.start = String(performance.now());
          } else {
            ball.dataset.mode = 'idle';
            ball.dataset.row = String(color);
            if (spawningSet && spawningSet.has(k)) ball.classList.add('spawning');
          }
          cell.appendChild(ball);
        } else if (nextPositions.some((p, i) => p && p.r === r && p.c === c)) {
          const idx = nextPositions.findIndex((p) => p && p.r === r && p.c === c);
          const dot = document.createElement('div');
          dot.className = 'preview-dot';
          dot.dataset.mode = 'static';
          dot.dataset.row = String(nextColors[idx]);
          cell.appendChild(dot);
        }
      }
    }
    scoreEl.textContent = score;
    bestEl.textContent = localStorage.getItem(BEST_KEY) || '0';
  }

  // Sprite sheet: 10 animation-frame columns x 14 rows (colours 0-6 idle,
  // colours 7-13 = same colours popping). Positions are percentages so the
  // sheet scales responsively with the ball element's own rendered size.
  const SPRITE_COLS = 10;
  const SPRITE_ROWS = 14;
  const IDLE_FPS = 20;
  const POP_FPS = 40;

  function spriteTick(now) {
    const idleFrame = Math.floor(now / (1000 / IDLE_FPS)) % SPRITE_COLS;
    document.querySelectorAll('.ball, .preview-dot').forEach((el) => {
      const mode = el.dataset.mode;
      const row = Number(el.dataset.row);
      let frame;
      if (mode === 'pop') {
        const elapsed = now - Number(el.dataset.start);
        frame = Math.min(SPRITE_COLS - 1, Math.floor(elapsed / (1000 / POP_FPS)));
      } else if (mode === 'static') {
        frame = 0;
      } else {
        frame = idleFrame;
      }
      el.style.backgroundPositionX = `${(frame / (SPRITE_COLS - 1)) * 100}%`;
      el.style.backgroundPositionY = `${(row / (SPRITE_ROWS - 1)) * 100}%`;
    });
    requestAnimationFrame(spriteTick);
  }
  requestAnimationFrame(spriteTick);

  async function flashPath(path) {
    const perStep = 40;
    path.forEach((p, i) => {
      setTimeout(() => {
        const cell = cellEls[p.r][p.c];
        cell.classList.remove('path-flash');
        void cell.offsetWidth;
        cell.classList.add('path-flash');
        playSound('tick');
      }, i * perStep);
    });
    await sleep(path.length * perStep + 180);
  }

  function shakeCell(r, c) {
    const cell = cellEls[r][c];
    cell.classList.remove('shake');
    void cell.offsetWidth;
    cell.classList.add('shake');
    setTimeout(() => cell.classList.remove('shake'), 320);
  }

  async function resolveClear(cleared) {
    clearingSet = cleared;
    render();
    playSound('pop');
    await sleep(280);
    for (const k of cleared) {
      const [r, c] = k.split(',').map(Number);
      board[r][c] = null;
    }
    score += cleared.size;
    clearingSet = null;
    render();
  }

  function endGame() {
    const best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
    const isNewBest = score > best;
    if (isNewBest) localStorage.setItem(BEST_KEY, String(score));
    overlayTitleEl.textContent = isNewBest ? 'New Best Score!' : 'Game Over';
    overlayScoreEl.textContent = `You scored ${score} point${score === 1 ? '' : 's'}.`;
    overlayEl.classList.remove('hidden');
    playSound(isNewBest ? 'victory' : 'gameover');
    render();
  }

  async function afterMove() {
    const cleared = findLines();
    if (cleared.size > 0) {
      await resolveClear(cleared);
      return;
    }
    const placed = spawnBalls();
    spawningSet = new Set(placed.map((p) => key(p.r, p.c)));
    render();
    playSound('spawn');
    await sleep(240);
    spawningSet = null;

    const cleared2 = findLines();
    if (cleared2.size > 0) {
      await resolveClear(cleared2);
    }

    const preview = generatePreview();
    nextColors = preview.colors;
    nextPositions = preview.positions;
    render();

    if (emptyCells().length === 0) {
      endGame();
    }
  }

  async function attemptMove(start, end) {
    isAnimating = true;
    const path = bfsPath(start, end);
    if (!path) {
      playSound('invalid');
      shakeCell(end.r, end.c);
      isAnimating = false;
      return;
    }
    await flashPath(path);
    const color = board[start.r][start.c];
    board[start.r][start.c] = null;
    board[end.r][end.c] = color;
    selected = null;
    render();
    playSound('move');
    await afterMove();
    isAnimating = false;
  }

  function onCellClick(r, c) {
    if (isAnimating) return;
    const occupied = board[r][c] !== null;
    if (!selected) {
      if (occupied) {
        selected = { r, c };
        playSound('select');
        render();
      }
      return;
    }
    if (selected.r === r && selected.c === c) {
      selected = null;
      render();
      return;
    }
    if (occupied) {
      selected = { r, c };
      playSound('select');
      render();
      return;
    }
    attemptMove(selected, { r, c });
  }

  function newGame() {
    board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    score = 0;
    selected = null;
    isAnimating = false;
    clearingSet = null;
    spawningSet = null;
    overlayEl.classList.add('hidden');

    const initial = generatePreview();
    nextColors = initial.colors;
    nextPositions = initial.positions;
    spawnBalls();

    const preview = generatePreview();
    nextColors = preview.colors;
    nextPositions = preview.positions;

    render();
  }

  function updateSoundBtn() {
    soundBtn.textContent = muted ? '🔇' : '🔊';
  }

  soundBtn.addEventListener('click', () => {
    muted = !muted;
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    updateSoundBtn();
  });

  newGameBtn.addEventListener('click', () => {
    if (!isAnimating) newGame();
  });

  overlayRestartBtn.addEventListener('click', () => {
    newGame();
  });

  buildBoardDom();
  updateSoundBtn();
  newGame();
})();
