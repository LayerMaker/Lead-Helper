import express from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = process.env.PORT || 4174;
const appDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(appDir, "dist");
const contactCards = new Map();

app.use(express.json({ limit: "12mb" }));

function escapeVcardValue(value = "") {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .trim();
}

function buildContactFileName(contact = {}, dealership = {}) {
  const name = contact.name || dealership.name || "lead-helper-contact";
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "lead-helper-contact"}.vcf`;
}

function buildVcard(contact = {}, dealership = {}) {
  const nameParts = String(contact.name || "").trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : nameParts[0] || "";
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";
  const company = contact.company || dealership.name || "";
  const note = [
    dealership.name ? `Captured from Lead Helper at ${dealership.name}.` : "Captured from Lead Helper.",
    dealership.address ? `Dealership address: ${dealership.address}` : "",
    contact.rawText ? `OCR text: ${contact.rawText}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "PRODID:-//Lead Helper//Field Contact//EN",
    `N:${escapeVcardValue(lastName)};${escapeVcardValue(firstName)};;;`,
    `FN:${escapeVcardValue(contact.name || company || dealership.name || "Lead Helper Contact")}`,
    company ? `ORG:${escapeVcardValue(company)}` : "",
    contact.role ? `TITLE:${escapeVcardValue(contact.role)}` : "",
    contact.email ? `EMAIL;TYPE=WORK,INTERNET:${escapeVcardValue(contact.email)}` : "",
    contact.phone ? `TEL;TYPE=WORK,VOICE:${escapeVcardValue(contact.phone)}` : "",
    dealership.website ? `URL;TYPE=WORK:${escapeVcardValue(dealership.website)}` : "",
    dealership.address ? `ADR;TYPE=WORK:;;${escapeVcardValue(dealership.address)};;;;` : "",
    note ? `NOTE:${escapeVcardValue(note)}` : "",
    `REV:${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}`,
    "END:VCARD",
  ]
    .filter(Boolean)
    .join("\r\n");
}

function cleanupContactCards() {
  const now = Date.now();
  for (const [id, record] of contactCards.entries()) {
    if (record.expiresAt <= now) contactCards.delete(id);
  }
}

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

app.post("/api/contact-card", (request, response) => {
  cleanupContactCards();

  const contact = request.body?.contact || {};
  const dealership = request.body?.dealership || {};
  if (!contact.name && !contact.email && !contact.phone) {
    response.status(400).json({ error: "Contact name, email, or phone is required." });
    return;
  }

  const id = randomUUID();
  contactCards.set(id, {
    vcard: buildVcard(contact, dealership),
    fileName: buildContactFileName(contact, dealership),
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  response.json({ url: `/api/contact-card/${id}` });
});

app.get("/api/contact-card/:id", (request, response) => {
  cleanupContactCards();
  const record = contactCards.get(request.params.id);

  if (!record) {
    response.status(404).type("text/plain").send("Contact card expired or not found.");
    return;
  }

  response
    .status(200)
    .set({
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename="${record.fileName}"`,
      "Content-Type": "text/vcard; charset=utf-8",
    })
    .send(record.vcard);
});

app.use(express.static(distDir));

app.get(/.*/, (_request, response) => {
  response.sendFile(path.join(distDir, "index.html"));
});

app.listen(port, () => {
  console.log(`Lead Helper listening on ${port}`);
});
