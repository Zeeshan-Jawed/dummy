require("dotenv").config({ quiet: true });

const { initStore, searchMany } = require("./vectorStore");
const { askLLM, askLLMOnce, warmup } = require("./llm");

const TOP_K = Number(process.env.TOP_K || 6);
const SCORE_THRESHOLD = Number(process.env.SCORE_THRESHOLD || 1.5);
const MAX_CHARS_PER_CHUNK = Number(process.env.MAX_CHARS_PER_CHUNK || 1200);
const REWRITE_QUERY = String(process.env.REWRITE_QUERY || "1") === "1";
const REWRITE_NUM_PREDICT = Number(process.env.REWRITE_NUM_PREDICT || 120);

const REWRITE_SYSTEM = `You are a search query optimizer for a Quran translation corpus.

Given the user's question, write 2 short alternative phrasings that would match how the answer is likely written in an English Quran translation. Use full names (e.g. "Prophet Ibrahim", "Ismail", "Ishaq"), include synonyms, and add 3-5 likely keywords.

Output format (no extra text, no explanations):
PARAPHRASE: <one rewritten question>
HYPOTHETICAL: <one short hypothetical answer sentence as if from the Quran translation>
KEYWORDS: <comma separated keywords>`;

const ANSWER_SYSTEM = `You are an Islamic assistant that answers using the provided context from an English Quran translation.

RULES:
- Base your answer on the "Context" block. You may synthesize across the chunks.
- If the answer truly cannot be inferred from the context, reply: "I don't know"
- Do NOT invent surah names, ayah numbers, or references that are not in the context.
- When citing, mention which chunk it came from like [1], [2].
- Be concise. No preamble.`;

let storeReady = null;
function ensureReady() {
  if (!storeReady) storeReady = initStore().then(() => warmup());
  return storeReady;
}

async function rewriteQuery(question) {
  const out = await askLLMOnce(question, {
    system: REWRITE_SYSTEM,
    options: { num_predict: REWRITE_NUM_PREDICT, temperature: 0 },
  });

  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  let paraphrase = "";
  let hypothetical = "";
  let keywords = "";

  for (const line of lines) {
    if (/^PARAPHRASE\s*:/i.test(line)) paraphrase = line.replace(/^PARAPHRASE\s*:/i, "").trim();
    else if (/^HYPOTHETICAL\s*:/i.test(line)) hypothetical = line.replace(/^HYPOTHETICAL\s*:/i, "").trim();
    else if (/^KEYWORDS\s*:/i.test(line)) keywords = line.replace(/^KEYWORDS\s*:/i, "").trim();
  }

  return { paraphrase, hypothetical, keywords, raw: out };
}

async function answer(question, { onToken, onStage } = {}) {
  await ensureReady();
  const startedAt = Date.now();

  let queries = [question];
  let rewrite = null;

  if (REWRITE_QUERY) {
    if (onStage) onStage("rewriting", { question });
    try {
      rewrite = await rewriteQuery(question);
      if (rewrite.paraphrase) queries.push(rewrite.paraphrase);
      if (rewrite.hypothetical) queries.push(rewrite.hypothetical);
      if (rewrite.keywords) queries.push(rewrite.keywords);
    } catch (err) {
      console.warn("[rewrite failed]", err.message);
    }
  }

  if (onStage) onStage("searching", { queries });
  const hits = await searchMany(queries, TOP_K);
  const relevant = hits.filter((h) => h.score <= SCORE_THRESHOLD).slice(0, TOP_K);

  const chunks = (relevant.length ? relevant : hits.slice(0, TOP_K)).map((r) => ({
    source: r.metadata.source,
    chunk: r.metadata.chunk,
    score: Number(r.score.toFixed(3)),
    preview: r.pageContent.slice(0, MAX_CHARS_PER_CHUNK),
    belowThreshold: r.score > SCORE_THRESHOLD,
  }));

  if (relevant.length === 0) {
    if (onStage) onStage("no_context", {});
    return {
      answer: "I don't know",
      sources: [],
      chunks,
      rewrite,
      tookMs: Date.now() - startedAt,
    };
  }

  const context = relevant
    .map((r, i) => `[${i + 1}] (${r.metadata.source}, chunk ${r.metadata.chunk})\n${r.pageContent.slice(0, MAX_CHARS_PER_CHUNK)}`)
    .join("\n\n");

  const prompt = `Context:
${context}

Question:
${question}

Answer using the context above. If the answer is not present, say "I don't know".`;

  if (onStage) onStage("generating", { contextChars: context.length, chunkCount: relevant.length });

  const text = await askLLM(prompt, {
    system: ANSWER_SYSTEM,
    onToken,
  });

  return {
    answer: (text || "").trim() || "I don't know",
    sources: relevant.map((r) => ({
      source: r.metadata.source,
      chunk: r.metadata.chunk,
      score: Number(r.score.toFixed(3)),
    })),
    chunks,
    rewrite,
    tookMs: Date.now() - startedAt,
  };
}

module.exports = { answer };
