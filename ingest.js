const fs = require("fs");
const path = require("path");
const { extractText, splitText } = require("./utils");
const { resetStore, addDocuments } = require("./vectorStore");

async function run() {
  await resetStore();

  const pdfDir = path.join(__dirname, "pdf");

  if (!fs.existsSync(pdfDir)) {
    fs.mkdirSync(pdfDir, { recursive: true });
    console.log(`Created PDF folder: ${pdfDir}`);
    console.log("Add your PDF files there, then run: node ingest.js");
    return;
  }

  const files = fs.readdirSync(pdfDir);
  const pdfFiles = files.filter((file) => file.toLowerCase().endsWith(".pdf"));

  if (pdfFiles.length === 0) {
    console.log(`No PDF files found in: ${pdfDir}`);
    return;
  }

  for (const file of pdfFiles) {
    console.log("Processing:", file);

    const filePath = path.join(pdfDir, file);
    const text = await extractText(filePath);
    const docs = await splitText(text);
    console.log(`Chunks: ${docs.length}`);

    const formatted = docs.map((doc, i) => ({
      pageContent: doc.pageContent,
      metadata: {
        source: file,
        chunk: i,
      },
    }));

    await addDocuments(formatted);
  }

  console.log("✅ All PDFs indexed");
}

run();
