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

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ""));
}

export async function generateOpenRouterEmailDraft({
  model,
  dealership,
  contact,
  latestVisit,
  outcomes,
  emailType,
  templateSubject,
  templateBody,
  selectedAddress,
  mode = "polish",
}) {
  const context = compact({
    dealership_name: dealership?.name,
    dealership_address: dealership?.address,
    dealership_website: dealership?.website,
    contact_name: contact?.name,
    contact_role: contact?.role,
    contact_email: contact?.email,
    selected_to_address: selectedAddress,
    visit_note: latestVisit?.note,
    visit_outcomes: outcomes,
    email_type: emailType,
    template_subject: templateSubject,
    template_body: templateBody,
  });

  const systemPrompt =
    mode === "generate"
      ? "You write concise, polished UK English follow-up emails after commercial property outreach visits to car dealerships. Return JSON only with keys subject and body. Keep tone professional, warm, and direct. No markdown. No placeholders unless a detail is truly missing."
      : "You polish concise UK English follow-up emails after commercial property outreach visits to car dealerships. Improve clarity and flow but keep facts grounded in the provided context. Return JSON only with keys subject and body. No markdown.";

  const userPrompt =
    mode === "generate"
      ? `Write a complete follow-up email from the context below.\n${JSON.stringify(context, null, 2)}`
      : `Polish this email using the context below. Keep it concise and natural.\n${JSON.stringify(context, null, 2)}`;

  const response = await fetch("/api/openrouter/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "openai/gpt-5-mini",
      temperature: mode === "generate" ? 0.5 : 0.25,
      max_tokens: 700,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter email generation failed (${response.status}): ${errorText.slice(0, 240)}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  const contentText = Array.isArray(content)
    ? content.map((item) => item?.text || "").join("\n")
    : String(content || "");
  const parsed = parseJsonCandidate(contentText);

  if (!parsed) {
    throw new Error("Email response could not be parsed as JSON");
  }

  return {
    subject: String(parsed.subject || templateSubject || "").trim(),
    body: String(parsed.body || templateBody || "").trim(),
  };
}
