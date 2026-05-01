require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { IndexFlatL2 } = require("faiss-node");

const INDEX_DIR = path.join(__dirname, "faiss_index");
const INDEX_FILE = path.join(INDEX_DIR, "index.faiss");
const DOCS_FILE = path.join(INDEX_DIR, "docs.json");
const META_FILE = path.join(INDEX_DIR, "meta.json");

const OLLAMA_URL = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, "");
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "nomic-embed-text";
const EMBEDDING_BATCH_SIZE = Number(process.env.EMBEDDING_BATCH_SIZE || 32);
const EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER || "ollama";
const LOCAL_EMBEDDING_DIMENSIONS = Number(process.env.LOCAL_EMBEDDING_DIMENSIONS || 512);

let index = null;
let docs = [];
let meta = null;

function ensureIndexDir() {
  fs.mkdirSync(INDEX_DIR, { recursive: true });
}

function hashToken(token) {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function embedLocal(text) {
  const v = new Array(LOCAL_EMBEDDING_DIMENSIONS).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const tok of tokens) v[hashToken(tok) % LOCAL_EMBEDDING_DIMENSIONS] += 1;
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / mag);
}

async function embedWithOllama(texts) {
  const res = await axios.post(
    `${OLLAMA_URL}/api/embed`,
    { model: EMBEDDING_MODEL, input: texts },
    { validateStatus: () => true, timeout: 120000 }
  );

  if (res.status >= 400) {
    const detail = res.data?.error || JSON.stringify(res.data);
    throw new Error(
      `Ollama /api/embed returned ${res.status} for "${EMBEDDING_MODEL}": ${detail}. ` +
        `Pull it on the server: ollama pull ${EMBEDDING_MODEL}`
    );
  }

  if (!Array.isArray(res.data.embeddings)) {
    throw new Error(`Ollama did not return an embeddings array. Body: ${JSON.stringify(res.data)}`);
  }

  return res.data.embeddings;
}

async function embedMany(texts) {
  if (EMBEDDING_PROVIDER !== "ollama") return texts.map(embedLocal);
  return embedWithOllama(texts);
}

async function embed(text) {
  const [v] = await embedMany([text]);
  return v;
}

async function initStore() {
  ensureIndexDir();

  if (fs.existsSync(INDEX_FILE) && fs.existsSync(DOCS_FILE)) {
    index = IndexFlatL2.read(INDEX_FILE);
    docs = JSON.parse(fs.readFileSync(DOCS_FILE, "utf8"));
    meta = fs.existsSync(META_FILE) ? JSON.parse(fs.readFileSync(META_FILE, "utf8")) : null;

    if (meta && meta.embeddingModel && meta.embeddingModel !== EMBEDDING_MODEL) {
      console.warn(
        `[warn] Index was built with "${meta.embeddingModel}" but EMBEDDING_MODEL is "${EMBEDDING_MODEL}". ` +
          `Run: node ingest.js`
      );
    }
    return;
  }

  index = null;
  docs = [];
  meta = null;
}

async function resetStore() {
  ensureIndexDir();
  index = null;
  docs = [];
  meta = null;

  for (const f of [INDEX_FILE, DOCS_FILE, META_FILE]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

async function addDocuments(newDocs) {
  if (!newDocs.length) return;
  ensureIndexDir();

  for (let start = 0; start < newDocs.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = newDocs.slice(start, start + EMBEDDING_BATCH_SIZE);
    const vectors = await embedMany(batch.map((d) => d.pageContent));

    if (!index) {
      index = new IndexFlatL2(vectors[0].length);
      meta = { embeddingProvider: EMBEDDING_PROVIDER, embeddingModel: EMBEDDING_MODEL, dim: vectors[0].length };
    }

    for (const v of vectors) index.add(v);
    docs.push(...batch);

    index.write(INDEX_FILE);
    fs.writeFileSync(DOCS_FILE, JSON.stringify(docs, null, 2));
    fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));

    console.log(`Indexed ${docs.length} chunks total`);
  }
}

async function search(query, k = 5) {
  if (!index || docs.length === 0) return [];

  const qv = await embed(query);

  if (qv.length !== index.getDimension()) {
    throw new Error(
      `Embedding dimension mismatch: index is ${index.getDimension()}-dim but query is ${qv.length}-dim. ` +
        `Rebuild the index: node ingest.js`
    );
  }

  const r = index.search(qv, Math.min(k, docs.length));
  return r.labels
    .filter((label) => label >= 0)
    .map((label, i) => ({ ...docs[label], score: r.distances[i] }));
}

async function searchMany(queries, k = 5) {
  const seen = new Map();
  for (const q of queries) {
    const hits = await search(q, k);
    for (const hit of hits) {
      const key = `${hit.metadata.source}#${hit.metadata.chunk}`;
      const existing = seen.get(key);
      if (!existing || hit.score < existing.score) seen.set(key, hit);
    }
  }
  return [...seen.values()].sort((a, b) => a.score - b.score);
}

module.exports = { initStore, resetStore, addDocuments, search, searchMany };
