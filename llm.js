require("dotenv").config({ quiet: true });
const axios = require("axios");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = process.env.MODEL;
const KEEP_ALIVE = process.env.KEEP_ALIVE || "30m";
const NUM_PREDICT = Number(process.env.NUM_PREDICT || 256);
const NUM_CTX = Number(process.env.NUM_CTX || 4096);

async function askLLM(prompt, { system, onToken } = {}) {
  if (!MODEL) {
    throw new Error('Missing MODEL in .env, for example: MODEL="llama3.2"');
  }

  const body = {
    model: MODEL,
    prompt,
    system,
    stream: true,
    keep_alive: KEEP_ALIVE,
    options: {
      temperature: 0,
      top_p: 0.9,
      num_predict: NUM_PREDICT,
      num_ctx: NUM_CTX,
      repeat_penalty: 1.1,
    },
  };

  const res = await axios.post(`${OLLAMA_URL}/api/generate`, body, {
    responseType: "stream",
  });

  let full = "";
  let buffer = "";

  await new Promise((resolve, reject) => {
    res.data.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.response) {
            full += obj.response;
            if (onToken) onToken(obj.response);
          }
          if (obj.error) reject(new Error(obj.error));
        } catch (_) {
          // ignore partial JSON lines
        }
      }
    });
    res.data.on("end", resolve);
    res.data.on("error", reject);
  });

  return full;
}

async function warmup() {
  if (!MODEL) return;
  try {
    await axios.post(`${OLLAMA_URL}/api/generate`, {
      model: MODEL,
      prompt: "",
      keep_alive: KEEP_ALIVE,
      stream: false,
    });
  } catch (_) {
    // best-effort
  }
}

module.exports = { askLLM, warmup };
