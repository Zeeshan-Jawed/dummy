require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { IndexFlatL2 } = require("faiss-node");

const INDEX_DIR = path.join(__dirname, "faiss_index");
const INDEX_FILE = path.join(INDEX_DIR, "index.faiss");
const DOCS_FILE = path.join(INDEX_DIR, "docs.json");
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || process.env.MODEL || "nomic-embed-text";
const EMBEDDING_BATCH_SIZE = Number(process.env.EMBEDDING_BATCH_SIZE || 8);
const EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER || "local";
const LOCAL_EMBEDDING_DIMENSIONS = Number(process.env.LOCAL_EMBEDDING_DIMENSIONS || 512);

let index = null;
let docs = [];

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
  const vector = new Array(LOCAL_EMBEDDING_DIMENSIONS).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) || [];

  for (const token of tokens) {
    const index = hashToken(token) % LOCAL_EMBEDDING_DIMENSIONS;
    vector[index] += 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / magnitude);
}

async function embedWithOllama(texts) {
  try {
    const res = await axios.post(`${OLLAMA_URL}/api/embed`, {
      model: EMBEDDING_MODEL,
      input: texts,
    });

    if (!Array.isArray(res.data.embeddings)) {
      throw new Error("Ollama did not return an embeddings array.");
    }

    return res.data.embeddings;
  } catch (error) {
    const detail = error.response?.data?.error || error.message;
    throw new Error(
      `Failed to embed text with Ollama model "${EMBEDDING_MODEL}". ` +
        `Set EMBEDDING_MODEL to an installed embedding model, for example "nomic-embed-text". ${detail}`
    );
  }
}

async function embedMany(texts) {
  if (EMBEDDING_PROVIDER !== "ollama") {
    return texts.map(embedLocal);
  }

  return embedWithOllama(texts);
}

async function embed(text) {
  const [vector] = await embedMany([text]);
  return vector;
}

async function initStore() {
  ensureIndexDir();

  if (fs.existsSync(INDEX_FILE) && fs.existsSync(DOCS_FILE)) {
    index = IndexFlatL2.read(INDEX_FILE);
    docs = JSON.parse(fs.readFileSync(DOCS_FILE, "utf8"));
    return;
  }

  index = null;
  docs = [];
}

async function resetStore() {
  ensureIndexDir();
  index = null;
  docs = [];

  for (const file of [INDEX_FILE, DOCS_FILE]) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}

async function addDocuments(newDocs) {
  if (!newDocs.length) return;

  ensureIndexDir();

  for (let start = 0; start < newDocs.length; start += EMBEDDING_BATCH_SIZE) {
    const batchDocs = newDocs.slice(start, start + EMBEDDING_BATCH_SIZE);
    const vectors = await embedMany(batchDocs.map((doc) => doc.pageContent));

    if (!index) {
      index = new IndexFlatL2(vectors[0].length);
    }

    for (const vector of vectors) {
      index.add(vector);
    }

    docs.push(...batchDocs);
    index.write(INDEX_FILE);
    fs.writeFileSync(DOCS_FILE, JSON.stringify(docs, null, 2));

    console.log(`Indexed ${docs.length} chunks total`);
  }
}

async function search(query, k = 5) {
  if (!index || docs.length === 0) {
    return [];
  }

  const queryVector = await embed(query);
  const results = index.search(queryVector, Math.min(k, docs.length));

  return results.labels
    .filter((label) => label >= 0)
    .map((label, i) => ({
      ...docs[label],
      score: results.distances[i],
    }));
}

module.exports = { initStore, resetStore, addDocuments, search };
