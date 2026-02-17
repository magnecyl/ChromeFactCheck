using System.Text;
using ChromeFactCheck.Api.Contracts;

namespace ChromeFactCheck.Api.Services;

internal static class PromptTemplates
{
    internal const string SystemPrompt = """
You are a fact-checking assistant used in a browser extension. Your goal is to help users verify claims in selected web text.

Rules:
- Do not assume the selected text is true.
- Extract specific, checkable claims (atomic claims).
- For each claim, decide whether it is Supported, Disputed, Misleading, or Unclear based on evidence.
- If evidence is insufficient, say Unclear and explain what is missing.
- Prefer primary and authoritative sources (government, universities, standards bodies, major reference works). Avoid low-quality blogs or SEO sites.
- Be transparent about uncertainty and ambiguity.
- Never reveal API keys or any user secrets.
- Do not accuse individuals of crimes or wrongdoing. If the text makes allegations, treat as UNCLEAR unless verified by strong sources.
- Output MUST be valid JSON matching the provided schema. No extra text.
""";

    internal const string DeveloperPrompt = """
You will receive:
- selectedText (user-highlighted text)
- pageUrl, pageTitle
- locale and preferences

Task:
- Produce up to 5 atomic claims from selectedText.
- For each claim, provide:
  - verdict: one of ["SUPPORTED","DISPUTED","MISLEADING","UNCLEAR"]
  - truthProbability: number from 0.00 to 1.00 (probability the claim is true)
  - confidence: 0.00 to 1.00
  - shortExplanation: 1 to 3 sentences
  - searchQueries: 2 to 4 queries to find evidence
  - evidenceNeeded: if UNCLEAR, list what evidence would resolve it

Provide a final overallAssessment for the selection.

Important:
- If selectedText is opinion or value judgement, label as UNCLEAR and explain it is not strictly fact-checkable.
- If the claim depends on time (for example "today" or "recently"), specify it and request a date.
- If numbers or statistics appear, request original dataset/source if not provided.
- If providedSources are included, check those first and explicitly reflect them in explanation/notes.
- Use the requested answer language for all explanatory text in the JSON fields.
- Do not accuse individuals of crimes or wrongdoing. If the text makes allegations, treat as UNCLEAR unless verified by strong sources.

Return JSON exactly in this schema:
{
  "meta": {
    "pageUrl": "string",
    "pageTitle": "string",
    "locale": "string"
  },
  "claims": [
    {
      "claim": "string",
      "verdict": "SUPPORTED|DISPUTED|MISLEADING|UNCLEAR",
      "truthProbability": 0.0,
      "confidence": 0.0,
      "shortExplanation": "string",
      "searchQueries": ["string"],
      "evidenceNeeded": ["string"],
      "notes": ["string"]
    }
  ],
  "overallAssessment": {
    "summary": "string",
    "truthProbability": 0.0,
    "keyRisks": ["string"],
    "whatToCheckNext": ["string"]
  }
}
""";

    internal static string BuildUserPrompt(
        FactCheckSelectionRequest request,
        IReadOnlyList<RetrievedSource> providedSources)
    {
        var trustedDomains = request.UserPreferences.TrustedDomains.Any()
            ? string.Join(", ", request.UserPreferences.TrustedDomains)
            : "(none)";

        var blockedDomains = request.UserPreferences.BlockedDomains.Any()
            ? string.Join(", ", request.UserPreferences.BlockedDomains)
            : "(none)";
        var resolvedAnswerLanguage = ResolveAnswerLanguage(request);

        var builder = new StringBuilder();

        builder.AppendLine("selectedText:");
        builder.AppendLine("\"\"\"");
        builder.AppendLine(request.SelectedText);
        builder.AppendLine("\"\"\"");
        builder.AppendLine("context:");
        builder.AppendLine($"- pageUrl: {request.PageUrl}");
        builder.AppendLine($"- pageTitle: {request.PageTitle}");
        builder.AppendLine($"- locale: {request.Locale}");
        builder.AppendLine($"- strictness: {request.UserPreferences.Strictness}");
        builder.AppendLine($"- answerLanguage: {request.UserPreferences.AnswerLanguage}");
        builder.AppendLine($"- resolvedAnswerLanguage: {resolvedAnswerLanguage}");
        builder.AppendLine($"- maxSources: {request.UserPreferences.MaxSources}");
        builder.AppendLine($"- trustedDomains: {trustedDomains}");
        builder.AppendLine($"- blockedDomains: {blockedDomains}");
        builder.AppendLine($"instruction: Write all explanatory text in {resolvedAnswerLanguage}.");
        builder.AppendLine("providedSources:");

        if (providedSources.Count == 0)
        {
            builder.AppendLine("- (none)");
        }
        else
        {
            for (var index = 0; index < providedSources.Count; index++)
            {
                var source = providedSources[index];
                builder.AppendLine($"- source[{index + 1}]");
                builder.AppendLine($"  - url: {source.Url}");
                builder.AppendLine($"  - title: {source.Title}");
                builder.AppendLine($"  - retrievalStatus: {source.RetrievalStatus}");
                builder.AppendLine($"  - excerpt: {source.Excerpt}");
            }
        }

        return builder.ToString();
    }

    private static string ResolveAnswerLanguage(FactCheckSelectionRequest request)
    {
        var configured = request.UserPreferences.AnswerLanguage?.Trim();

        if (string.IsNullOrWhiteSpace(configured) ||
            string.Equals(configured, "auto", StringComparison.OrdinalIgnoreCase))
        {
            return request.Locale;
        }

        return configured;
    }
}
