'use strict';

importScripts('engine.js', 'ai.js');

self.addEventListener('message', (event) => {
  const { id, state, options } = event.data;
  try {
    const result = self.LinesAI.analyze(state, options);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message || String(error) });
  }
});
