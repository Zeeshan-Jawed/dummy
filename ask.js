const { initStore, search } = require("./vectorStore");
const { askLLM, warmup } = require("./llm");

const SCORE_THRESHOLD = Number(process.env.SCORE_THRESHOLD || 1.2);
const TOP_K = Number(process.env.TOP_K || 3);

const SYSTEM_PROMPT = `You are an Islamic assistant that answers ONLY from the provided context.

STRICT RULES:
- Use ONLY the text inside the "Context" block. Treat it as your single source of truth.
- If the answer is not explicitly in the context, reply EXACTLY: "I don't know"
- Do NOT use any prior knowledge, training data, or external sources.
- Do NOT invent surah names, ayah numbers, hadith, or references.
- Do NOT paraphrase quoted text; quote the exact words from the context.
- Be concise. No preamble, no disclaimers.`;

async function ask(question) {
  await initStore();
  warmup();

  const t0 = Date.now();
  const results = await search(question, TOP_K);

  const relevant = results.filter((r) => r.score <= SCORE_THRESHOLD);

  if (relevant.length === 0) {
    console.log("\nAnswer:\nI don't know");
    console.log("\nSources:");
    return;
  }

  const context = relevant
    .map((r, i) => `[${i + 1}] (${r.metadata.source})\n${r.pageContent}`)
    .join("\n\n");

  const prompt = `Context:
${context}

Question:
${question}

Answer using ONLY the context above. If not present, say "I don't know".`;

  process.stdout.write("\nAnswer:\n");
  await askLLM(prompt, {
    system: SYSTEM_PROMPT,
    onToken: (t) => process.stdout.write(t),
  });

  console.log("\n\nSources:");
  relevant.forEach((r) => {
    console.log(`- ${r.metadata.source} (chunk ${r.metadata.chunk}, score ${r.score.toFixed(3)})`);
  });
  console.log(`\n(took ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

ask("Who is the son that prophet ibrahim was commanded to sacrifice? Provide me the surah and ayah number for that detail?");
