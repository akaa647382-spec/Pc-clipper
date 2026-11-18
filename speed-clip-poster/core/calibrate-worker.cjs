'use strict';
// Runs predictor.calibrate off the main thread (it can take up to a minute on a long history).
const { parentPort, workerData } = require('node:worker_threads');
const P = require('./predictor.cjs');

try {
  const result = P.calibrate(workerData, (done, total) => parentPort.postMessage({ progress: { done, total } }));
  parentPort.postMessage({ result });
} catch (e) {
  parentPort.postMessage({ error: e && e.message ? e.message : String(e) });
}
