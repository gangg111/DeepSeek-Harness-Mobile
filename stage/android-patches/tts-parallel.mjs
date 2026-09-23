// Łatka: równoległa synteza fragmentów w @dsh-external/dsh-plugin-tts (Edge TTS / Google Cloud) — do EDGE_PAR naraz,
// wyniki wydawane w kolejności; lokalne silniki (rvc/index-tts2/cosyvoice/piper) zostają szeregowe.
// Użycie: node tts-parallel.mjs <katalog node_modules>   (idempotentna; przy zmianie upstreamu kończy się błędem)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const nm = process.argv[2];
const file = join(nm, '@dsh-external/dsh-plugin-tts/lib/index.mjs');
if (!existsSync(file)) { console.log('tts-parallel: brak pluginu tts, pomijam'); process.exit(0); }
let src = readFileSync(file, 'utf8');
if (src.includes('[android] parallel chunks')) { console.log('tts-parallel: już nałożona'); process.exit(0); }

function replaceOnce(from, to, label) {
  const i = src.indexOf(from);
  if (i < 0) throw new Error(`tts-parallel: nie znaleziono fragmentu (${label}) — plugin zmienił się upstream`);
  src = src.slice(0, i) + to + src.slice(i + from.length);
}

// 1. liczba równoległych syntez + prewarm dla edge/cloud
replaceOnce(
  "  if (provider === 'google-cloud-tts') return { chunkSec: 120, prewarm: 2, ratio: 0, fastFirst: true };\n  return { chunkSec: 20, prewarm: 2, ratio: 0, fastFirst: true };",
  "  if (provider === 'google-cloud-tts') return { chunkSec: 120, prewarm: EDGE_PAR, ratio: 0, fastFirst: true };\n  return { chunkSec: 20, prewarm: EDGE_PAR, ratio: 0, fastFirst: true };",
  'chunkCal');
replaceOnce(
  "function chunkCal(provider) {",
  "// [android] parallel chunks: ile fragmentów Edge/Cloud syntezować naraz (DSH_TTS_EDGE_PARALLEL, domyślnie 30)\nconst EDGE_PAR = Math.max(1, Number(process.env.DSH_TTS_EDGE_PARALLEL) || 30);\nfunction chunkCal(provider) {",
  'EDGE_PAR');

// 2. convertChunk + nextJobChunk: rezerwacja indeksu od razu, synteza równoległa, wydawanie po kolei
const start = src.indexOf('  function convertChunk(job) {');
const end = src.indexOf('  // Explicit cancel:', start);
if (start < 0 || end < 0) throw new Error('tts-parallel: nie znaleziono convertChunk/nextJobChunk');
const newBlock = `  // [android] parallel chunks: każde wywołanie rezerwuje indeks i syntezuje od razu (do jobPar naraz);
  // nextJobChunk wydaje wyniki w kolejności fragmentów.
  function jobPar(job) {
    const p = job.provider;
    return (p === 'rvc' || p === 'index-tts2' || p === 'cosyvoice' || p === 'local-piper') ? 1 : EDGE_PAR;
  }
  function ensureJobState(job) {
    if (!job.results) { job.results = new Map(); job.pending = new Map(); job.serveIdx = 0; }
  }
  function convertChunk(job) {
    ensureJobState(job);
    if (job.done || job.nextIdx >= job.parts.length) return Promise.resolve({ done: true });
    const idx = job.nextIdx++;
    const text = job.parts[idx];
    const run = async () => {
      let audioPath = null;
      let lastErr = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          audioPath = await job.sink(text);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          if (isHardChunkError(e)) break;
          if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
        }
      }
      let result;
      if (lastErr) {
        const skipErr = String((lastErr && lastErr.message) || lastErr);
        recordHostError({
          provider: job.provider || '?',
          voice: job.voice,
          textLen: String(text || '').length,
          stage: 'chunk ' + (idx + 1) + '/' + job.parts.length,
          error: skipErr.slice(0, 300)
        });
        result = { skipped: idx + 1, error: skipErr };
      } else {
        const id = 'c' + (++seq).toString(36) + '-' + hashText(text).slice(0, 6);
        files.set(id, audioPath);
        if (files.size > 300) {
          const first = files.keys().next().value;
          if (first !== undefined) files.delete(first);
        }
        result = { url: '/dsh-tts-audio/' + id };
      }
      job.results.set(idx, result);
      job.pending.delete(idx);
      return result;
    };
    const p = run();
    job.pending.set(idx, p);
    return p.then((r) => ({ ...r, more: idx + 1 < job.parts.length }));
  }
  function fillPipeline(job) {
    ensureJobState(job);
    const par = jobPar(job);
    while (!job.done && job.nextIdx < job.parts.length && job.pending.size < par) convertChunk(job).catch(() => {});
  }
  async function nextJobChunk(jobId) {
    const job = jobs.get(jobId);
    if (!job) return { done: true, gone: true };
    ensureJobState(job);
    if (job.serveIdx >= job.parts.length) {
      job.finishedAt = job.finishedAt || Date.now();
      return { done: true };
    }
    const idx = job.serveIdx;
    fillPipeline(job);
    if (!job.results.has(idx)) {
      const p = job.pending.get(idx);
      if (p) await p; else await convertChunk(job);
    }
    const r = job.results.get(idx) || { skipped: idx + 1, error: 'brak wyniku' };
    job.results.delete(idx);
    job.serveIdx++;
    fillPipeline(job);
    const more = job.serveIdx < job.parts.length;
    if (!more) job.finishedAt = job.finishedAt || Date.now();
    return { ...r, more };
  }

`;
src = src.slice(0, start) + newBlock + src.slice(end);

// 3. trasa /speak: pierwszy fragment przez nextJobChunk, reszta w tle przez fillPipeline
replaceOnce(
  `              const first = await convertChunk(job);
              if (!first || !first.url) {
                jobs.delete(jobId);
                throw hostErr('首段合成失败', 'host.chunkFail');
              }
              for (let i = 1; i < prewarm; i++) {
                convertChunk(job).then(
                  r => { if (r && r.url && jobs.get(jobId) === job) job.ready.push(r.url); },
                  () => { /* retried on demand */ }
                );
              }`,
  `              fillPipeline(job);
              const first = await nextJobChunk(jobId);
              if (!first || !first.url) {
                jobs.delete(jobId);
                throw hostErr('首段合成失败', 'host.chunkFail');
              }`,
  'speak fastFirst');
replaceOnce(
  `            for (let i = 0; i < prewarm; i++) {
              const r = await convertChunk(job);
              if (r && r.url) urls.push(r.url);
            }`,
  `            for (let i = 0; i < prewarm; i++) {
              const r = await nextJobChunk(jobId);
              if (r && r.url) urls.push(r.url);
            }`,
  'speak prewarm');

writeFileSync(file, src);
console.log('tts-parallel: nałożona (EDGE_PAR domyślnie 30)');
