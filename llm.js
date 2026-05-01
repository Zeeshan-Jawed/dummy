require("dotenv").config({ quiet: true });
const axios = require("axios");

const OLLAMA_URL = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, "");
const MODEL = process.env.MODEL;
const KEEP_ALIVE = process.env.KEEP_ALIVE || "30m";
const NUM_PREDICT = Number(process.env.NUM_PREDICT || 256);
const NUM_CTX = Number(process.env.NUM_CTX || 4096);

function readStream(stream) {
  return new Promise((resolve, reject) => {
    let data = "";
    stream.on("data", (c) => (data += c.toString("utf8")));
    stream.on("end", () => resolve(data));
    stream.on("error", reject);
  });
}

async function askLLM(prompt, { system, onToken, options = {} } = {}) {
  if (!MODEL) throw new Error('Missing MODEL in .env, e.g. MODEL="llama3.2"');

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
      ...options,
    },
  };

  const res = await axios.post(`${OLLAMA_URL}/api/generate`, body, {
    responseType: "stream",
    validateStatus: () => true,
  });

  if (res.status >= 400) {
    const errBody = await readStream(res.data);
    let detail = errBody;
    try { detail = JSON.parse(errBody).error || errBody; } catch (_) {}
    throw new Error(`Ollama /api/generate returned ${res.status}: ${detail}`);
  }

  let full = "";
  let buffer = "";

  const handleLine = (line) => {
    if (!line.trim()) return;
    try {
      const obj = JSON.parse(line);
      if (obj.response) {
        full += obj.response;
        if (onToken) onToken(obj.response);
      }
      if (obj.error) throw new Error(obj.error);
    } catch (_) {
      // ignore
    }
  };

  await new Promise((resolve, reject) => {
    res.data.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) handleLine(line);
    });
    res.data.on("end", () => {
      if (buffer.trim()) handleLine(buffer);
      resolve();
    });
    res.data.on("error", reject);
  });

  return full;
}

async function askLLMOnce(prompt, { system, options = {} } = {}) {
  if (!MODEL) throw new Error('Missing MODEL in .env');

  const res = await axios.post(
    `${OLLAMA_URL}/api/generate`,
    {
      model: MODEL,
      prompt,
      system,
      stream: false,
      keep_alive: KEEP_ALIVE,
      options: {
        temperature: 0,
        top_p: 0.9,
        num_predict: NUM_PREDICT,
        num_ctx: NUM_CTX,
        ...options,
      },
    },
    { validateStatus: () => true, timeout: 120000 }
  );

  if (res.status >= 400) {
    const detail = res.data?.error || JSON.stringify(res.data);
    throw new Error(`Ollama /api/generate returned ${res.status}: ${detail}`);
  }

  return (res.data.response || "").trim();
}

async function warmup() {
  if (!MODEL) return;
  try {
    await axios.post(
      `${OLLAMA_URL}/api/generate`,
      { model: MODEL, prompt: "hi", keep_alive: KEEP_ALIVE, stream: false, options: { num_predict: 1 } },
      { validateStatus: () => true, timeout: 60000 }
    );
  } catch (_) {
    // best-effort
  }
}

module.exports = { askLLM, askLLMOnce, warmup };
