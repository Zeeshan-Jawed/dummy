const { initStore, search } = require("./vectorStore");
const { askLLM } = require("./llm");

async function ask(question) {
  await initStore();

  const results = await search(question, 5);

  if (results.length === 0) {
    console.log("\nAnswer:\nI don't know");
    console.log("\nSources:");
    return;
  }

  const context = results.map((r) => r.pageContent).join("\n\n");

  const prompt = `
You are an Islamic assistant.

STRICT RULES:
- Answer ONLY from the context below
- If answer not found, say "I don't know"
- Do NOT use prior knowledge
- Do NOT make up answers
- Do NOT use any sources other than the context below
- Always list ALL sources at the end
- Always use only the relevant information from the context to answer.
- Always be concise and to the point.
- Always use the exact same words from the context when answering, do NOT paraphrase.
- If the you donot find the relevant KEYWORD in the context, ask user to explain or say :I don't know:

Context:
${context}

Question:
${question}
`;

  const answer = await askLLM(prompt);

  console.log("\nAnswer:\n", answer);

  console.log("\nSources:");
  results.forEach((r) => {
    console.log("-", r.metadata.source);
  });
}

// test
ask("Who is the son that prophet ibrahim was commanded to sacrifice? Provide me the surah and ayah number for that detail?");
