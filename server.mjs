import express from "express";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-chromium";

const app = express();
const execFileAsync = promisify(execFile);
const port = process.env.PORT || 4174;
const appDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(appDir, "dist");
const contactCards = new Map();
const syncRecordId = "default";
const clientStorageKey = "lead-helper-shell-v1";

app.use(express.json({ limit: "12mb" }));

function readSecretFile(relativePath) {
  try {
    return fs.readFileSync(path.join(appDir, relativePath), "utf8").trim();
  } catch {
    return "";
  }
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || readSecretFile("../../SUPABASE_URL.txt");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || readSecretFile("../../service_role secret.txt");

  return {
    configured: Boolean(url && serviceRoleKey),
    serviceRoleKey,
    url: url.replace(/\/+$/, ""),
  };
}

function slugifyFilePart(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function getRequestBaseUrl(request) {
  const protocol = request.get("x-forwarded-proto") || request.protocol || "http";
  return `${protocol}://${request.get("host")}`;
}

function getClusterNameFromState(state, clusterId) {
  const clusters = [...(state?.mapV2?.clusters || []), ...(state?.clusters || []), ...(state?.manualClusters || [])];
  return clusters.find((cluster) => cluster.id === clusterId)?.name || "cluster";
}

let chromiumInstallPromise = null;

function isMissingChromiumError(error) {
  const message = String(error?.message || "");
  return message.includes("Executable doesn't exist") || message.includes("playwright install");
}

async function installChromiumForPdf() {
  if (!chromiumInstallPromise) {
    const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
    chromiumInstallPromise = execFileAsync(npxCommand, ["playwright", "install", "chromium"], {
      cwd: appDir,
      timeout: 180000,
      maxBuffer: 1024 * 1024 * 8,
    }).finally(() => {
      chromiumInstallPromise = null;
    });
  }

  await chromiumInstallPromise;
}

async function launchPdfBrowser() {
  const launchOptions = {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  };

  try {
    return await chromium.launch(launchOptions);
  } catch (error) {
    if (!isMissingChromiumError(error)) throw error;
    await installChromiumForPdf();
    return chromium.launch(launchOptions);
  }
}

async function renderReportPdf({ request, clusterId, state }) {
  let browser;

  try {
    const baseUrl = getRequestBaseUrl(request);
    const printUrl = new URL("/reports/print", baseUrl);
    if (clusterId) printUrl.searchParams.set("cluster", clusterId);
    printUrl.searchParams.set("pdf", "1");

    browser = await launchPdfBrowser();
    const context = await browser.newContext({
      viewport: { width: 1240, height: 1754 },
    });

    if (state) {
      await context.addInitScript(
        ({ key, value }) => {
          window.localStorage.setItem(key, JSON.stringify(value));
        },
        { key: clientStorageKey, value: state },
      );
    }

    const page = await context.newPage();
    await page.goto(printUrl.toString(), { waitUntil: "networkidle", timeout: 45000 });
    await page.emulateMedia({ media: "print" });
    await page.waitForSelector(".report-export-sheet", { state: "visible", timeout: 15000 });
    await page
      .waitForFunction(
        () => {
          const map = document.querySelector(".report-leaflet-map");
          if (!map) return true;
          const tiles = [...map.querySelectorAll(".leaflet-tile")];
          return tiles.length > 0 && tiles.every((tile) => tile.complete && tile.naturalWidth > 0);
        },
        { timeout: 12000 },
      )
      .catch(() => {});
    await page.waitForTimeout(350);

    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "0mm",
        right: "0mm",
        bottom: "0mm",
        left: "0mm",
      },
    });
  } finally {
    if (browser) await browser.close();
  }
}

async function supabaseRest(pathname, options = {}) {
  const config = getSupabaseConfig();
  if (!config.configured) {
    const error = new Error("Supabase is not configured on the server.");
    error.status = 500;
    throw error;
  }

  const response = await fetch(`${config.url}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(body?.message || body?.hint || "Supabase request failed.");
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

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

app.get("/api/supabase/status", async (_request, response) => {
  const config = getSupabaseConfig();
  if (!config.configured) {
    response.json({ configured: false, tableReady: false });
    return;
  }

  try {
    await supabaseRest(`lead_helper_app_state?id=eq.${syncRecordId}&select=id&limit=1`);
    response.json({ configured: true, tableReady: true });
  } catch (error) {
    response.status(error.status || 500).json({
      configured: true,
      tableReady: false,
      error: error.body?.message || error.message,
      hint: "Run database/schema.sql in the Supabase SQL editor, then retry.",
    });
  }
});

app.get("/api/sync/state", async (_request, response) => {
  try {
    const rows = await supabaseRest(`lead_helper_app_state?id=eq.${syncRecordId}&select=state,updated_at&limit=1`);
    const record = Array.isArray(rows) ? rows[0] : null;
    response.json({
      state: record?.state || null,
      updatedAt: record?.updated_at || null,
    });
  } catch (error) {
    response.status(error.status || 500).json({
      error: error.body?.message || error.message,
      hint: "Run database/schema.sql in the Supabase SQL editor if this is the first setup.",
    });
  }
});

app.put("/api/sync/state", async (request, response) => {
  const state = request.body?.state;
  if (!state || typeof state !== "object") {
    response.status(400).json({ error: "A state object is required." });
    return;
  }

  try {
    const rows = await supabaseRest("lead_helper_app_state?on_conflict=id", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          id: syncRecordId,
          state,
          updated_at: new Date().toISOString(),
        },
      ]),
    });
    const record = Array.isArray(rows) ? rows[0] : null;
    response.json({ ok: true, updatedAt: record?.updated_at || null });
  } catch (error) {
    response.status(error.status || 500).json({
      error: error.body?.message || error.message,
      hint: "Run database/schema.sql in the Supabase SQL editor if this is the first setup.",
    });
  }
});

app.get("/api/reports/pdf", async (request, response) => {
  try {
    const clusterId = String(request.query.cluster || "");
    const rows = await supabaseRest(`lead_helper_app_state?id=eq.${syncRecordId}&select=state&limit=1`);
    const state = Array.isArray(rows) ? rows[0]?.state : null;
    const pdfBuffer = await renderReportPdf({ request, clusterId, state });

    const clusterName = getClusterNameFromState(state, clusterId);
    const fileName = `${slugifyFilePart(clusterName) || "lead-helper"}-cluster-report-${new Date().toISOString().slice(0, 10)}.pdf`;

    response
      .status(200)
      .set({
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Type": "application/pdf",
      })
      .send(pdfBuffer);
  } catch (error) {
    response.status(error.status || 500).json({
      error: error.body?.message || error.message || "Report PDF generation failed.",
      hint: "If this is running on Render, confirm the latest deploy installed the Chromium renderer.",
    });
  }
});

app.post("/api/reports/pdf", async (request, response) => {
  try {
    const clusterId = String(request.body?.clusterId || request.query.cluster || "");
    const state = request.body?.state;

    if (!state || typeof state !== "object") {
      response.status(400).json({ error: "Current browser state is required to generate this report." });
      return;
    }

    const pdfBuffer = await renderReportPdf({ request, clusterId, state });
    const clusterName = getClusterNameFromState(state, clusterId);
    const fileName = `${slugifyFilePart(clusterName) || "lead-helper"}-cluster-report-${new Date().toISOString().slice(0, 10)}.pdf`;

    response
      .status(200)
      .set({
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Type": "application/pdf",
        "X-Report-Filename": fileName,
      })
      .send(pdfBuffer);
  } catch (error) {
    response.status(error.status || 500).json({
      error: error.body?.message || error.message || "Report PDF generation failed.",
      hint: "Use Print / Save as PDF if the server renderer is warming up or unavailable.",
    });
  }
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
