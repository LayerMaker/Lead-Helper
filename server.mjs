import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = process.env.PORT || 4174;
const appDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(appDir, "dist");

app.use(express.json({ limit: "12mb" }));

app.get("/api/openrouter/status", (_request, response) => {
  response.json({
    configured: Boolean(process.env.OPENROUTER_API_KEY),
    ocrModel: process.env.OPENROUTER_OCR_MODEL || "qwen/qwen3.7-plus",
    emailModel: process.env.OPENROUTER_EMAIL_MODEL || "openai/gpt-5-mini",
  });
});

async function proxyOpenRouterChat(request, response, modelOverride) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    response.status(500).json({
      error: "OPENROUTER_API_KEY is not configured on the server.",
    });
    return;
  }

  try {
    const payload = {
      ...request.body,
      model: modelOverride || request.body?.model,
    };

    const openRouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": request.get("origin") || "https://lead-helper.onrender.com",
        "X-Title": "Lead Helper",
      },
      body: JSON.stringify(payload),
    });

    const responseText = await openRouterResponse.text();
    response
      .status(openRouterResponse.status)
      .type(openRouterResponse.headers.get("content-type") || "application/json")
      .send(responseText);
  } catch (error) {
    response.status(502).json({
      error: error?.message || "OpenRouter request failed.",
    });
  }
}

app.post("/api/openrouter/ocr", async (request, response) => {
  await proxyOpenRouterChat(request, response, process.env.OPENROUTER_OCR_MODEL || "qwen/qwen3.7-plus");
});

app.post("/api/openrouter/email", async (request, response) => {
  await proxyOpenRouterChat(request, response, process.env.OPENROUTER_EMAIL_MODEL || "openai/gpt-5-mini");
});

app.post("/api/openrouter/chat", async (request, response) => {
  await proxyOpenRouterChat(request, response);
});

app.use(express.static(distDir));

app.get(/.*/, (_request, response) => {
  response.sendFile(path.join(distDir, "index.html"));
});

app.listen(port, () => {
  console.log(`Lead Helper listening on ${port}`);
});
