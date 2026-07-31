# Lines Solitaire

Programmed this game in circa Christmas 2009.
This is the source code for my clone of a classic game which I grew up seeing my father play. He was really good at it. The object of the game is to strike out as many spheres by lining them up into lines of five of the same colour.

See demo here: https://magicaltramp.wordpress.com/2012/01/05/line-solitaire/

## Play in your browser

The [`docs/`](docs) folder contains a browser port (vanilla HTML/CSS/JS, no build step) of the
original C++/HGE game, hosted with GitHub Pages:

**[https://submarat.github.io/lines/](https://submarat.github.io/lines/)**

Click a ball, then click an empty tile to move it there through a clear path. Line up 5 or more
balls of the same colour — in a row, column, or diagonal — to clear them and score. Every move that
doesn't clear a line adds 3 more balls. Don't let the board fill up.

## AI engine and simulator

The browser game now includes a chess-engine-style analysis panel. Toggle **Analysis on** to
highlight and rank the best moves after every turn, **Next move** makes the selected recommendation,
and **Auto play** lets the AI play continuously. Fast, Strong, and Deep profiles trade thinking time
for lookahead.

The rules live in [`docs/engine.js`](docs/engine.js), a deterministic, UI-independent simulator
shared by the browser and Node benchmarks. The AI in [`docs/ai.js`](docs/ai.js) combines exhaustive
legal-move generation with line-building, space, connectivity, preview-ball evaluation, and bounded
lookahead. Seeded games make changes directly comparable.

```sh
npm test
npm run benchmark -- 10 greedy 500
npm run benchmark -- 3 strong 500 100
```

The optimized evaluator sustains roughly 120,000–140,000 simulated positions per second on the
development machine. Fast mode normally completes a full one-ply search in about 5 ms. The current
75 ms Strong profile reached 1,006 points on seed 1 and was still alive at the 500-turn benchmark
cap. Results are seed- and machine-dependent, so use the benchmark command above for comparisons on
a fixed machine.

# Dependencies

Windows XP, 7
Haafs Game Engine - hge.relishgames.com

# Compiling and running

Haven't compiled for a while, using as example of past work.
