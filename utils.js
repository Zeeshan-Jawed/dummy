const fs = require("fs");
const { PDFParse } = require("pdf-parse");

async function extractText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buffer });

  try {
    const data = await parser.getText();
    return data.text;
  } finally {
    await parser.destroy();
  }
}

async function splitText(text) {
  const chunkSize = Number(process.env.CHUNK_SIZE || 3000);
  const chunkOverlap = Number(process.env.CHUNK_OVERLAP || 300);
  const normalizedText = text.replace(/\s+/g, " ").trim();
  const docs = [];

  for (let start = 0; start < normalizedText.length; start += chunkSize - chunkOverlap) {
    const pageContent = normalizedText.slice(start, start + chunkSize).trim();

    if (pageContent) {
      docs.push({ pageContent, metadata: {} });
    }
  }

  return docs;
}

module.exports = { extractText, splitText };
