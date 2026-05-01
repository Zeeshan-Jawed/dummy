const { answer } = require("./qa");

async function main() {
  const question = process.argv.slice(2).join(" ").trim() || "Ibrahim son name?";

  console.log(`\nQuestion: ${question}`);

  const result = await answer(question, {
    onToken: (t) => process.stdout.write(t),
    onStage: (stage, info) => console.log(`\n[${stage}]`, JSON.stringify(info).slice(0, 200)),
  });

  console.log("\n\n=== Answer ===");
  console.log(result.answer);
  console.log("==============");

  if (result.rewrite) {
    console.log("\nQuery rewrite:");
    if (result.rewrite.paraphrase) console.log("  Paraphrase  :", result.rewrite.paraphrase);
    if (result.rewrite.hypothetical) console.log("  Hypothetical:", result.rewrite.hypothetical);
    if (result.rewrite.keywords) console.log("  Keywords    :", result.rewrite.keywords);
  }

  console.log("\nSources:");
  if (!result.sources.length) console.log("(none)");
  result.sources.forEach((s) => console.log(`- ${s.source} (chunk ${s.chunk}, score ${s.score})`));

  console.log(`\n(took ${(result.tookMs / 1000).toFixed(1)}s)`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
