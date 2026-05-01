require("dotenv").config({ quiet: true });

const path = require("path");
const express = require("express");
const { answer } = require("./qa");

const PORT = Number(process.env.PORT || 3000);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/ask", async (req, res) => {
  const question = String(req.query.q || "").trim();
  if (!question) {
    res.status(400).json({ error: "Missing 'q' query parameter" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let closed = false;
  req.on("close", () => { closed = true; });

  try {
    const result = await answer(question, {
      onToken: (token) => { if (!closed) send("token", { token }); },
      onStage: (stage, info) => { if (!closed) send("stage", { stage, info }); },
    });

    if (!closed) {
      send("done", result);
      res.end();
    }
  } catch (err) {
    console.error("\n[/api/ask error]", err.message);
    if (!closed) {
      send("error", { message: err.message });
      res.end();
    }
  }
});

app.listen(PORT, () => {
  console.log(`\nServer running at http://localhost:${PORT}`);
});
