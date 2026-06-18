function parseJsonCandidate(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    // fall through
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // fall through
    }
  }

  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeOcrPayload(payload, rawText = "") {
  return {
    name: String(payload?.name || "").trim(),
    role: String(payload?.role || "").trim(),
    email: String(payload?.email || "").trim(),
    phone: String(payload?.phone || "").trim(),
    company: String(payload?.company || "").trim(),
    rawText: String(payload?.raw_text || payload?.rawText || rawText || "").trim(),
  };
}

export async function runOpenRouterBusinessCardOcr({ model, imageDataUrl, dealershipName }) {
  if (!imageDataUrl) {
    throw new Error("No image supplied for OCR");
  }

  const response = await fetch("/api/openrouter/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "qwen/qwen-vl-plus",
      max_tokens: 350,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Extract contact details from dealership business cards or contact photos. Return JSON only with keys: name, role, email, phone, company, raw_text. Use empty strings when unknown.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `This image was captured while visiting ${dealershipName}. Extract the person and dealership contact details. Return valid JSON only.`,
            },
            {
              type: "image_url",
              image_url: {
                url: imageDataUrl,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter OCR failed (${response.status}): ${errorText.slice(0, 240)}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  const contentText = Array.isArray(content)
    ? content.map((item) => item?.text || "").join("\n")
    : String(content || "");
  const parsed = parseJsonCandidate(contentText);

  if (!parsed) {
    throw new Error("OCR response could not be parsed as JSON");
  }

  return normalizeOcrPayload(parsed, contentText);
}
