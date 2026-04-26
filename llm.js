require("dotenv").config({ quiet: true });
const axios = require("axios");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = process.env.MODEL;

async function askLLM(prompt) {
  if (!MODEL) {
    throw new Error('Missing MODEL in .env, for example: MODEL="llama3.2"');
  }

  const res = await axios.post(`${OLLAMA_URL}/api/generate`, {
    model: MODEL,
    prompt,
    stream: false,
  });

  return res.data.response;
}

module.exports = { askLLM };
