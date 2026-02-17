using System.Net;
using System.Text;
using System.Text.Json;
using ChromeFactCheck.Api.Contracts;

namespace ChromeFactCheck.Api.Services;

public sealed class FactCheckOrchestrator(
    IHttpClientFactory httpClientFactory,
    SourceRetrievalService sourceRetrievalService,
    ILogger<FactCheckOrchestrator> logger) : IFactCheckOrchestrator
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public async Task<FactCheckSelectionResponse> FactCheckSelectionAsync(
        FactCheckSelectionRequest request,
        string? apiKey,
        CancellationToken cancellationToken)
    {
        var normalizedProvider = LlmProviderResolver.NormalizeProvider(request.UserPreferences.Provider);
        var endpoint = LlmProviderResolver.ResolveEndpoint(request.UserPreferences, normalizedProvider);
        var providedSources = await sourceRetrievalService.RetrieveAsync(request, cancellationToken);

        var payload = BuildPayload(request, providedSources);
        var httpClient = httpClientFactory.CreateClient("llm");

        using var upstreamRequest = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
        };

        LlmProviderResolver.ApplyAuthenticationHeaders(upstreamRequest, normalizedProvider, apiKey);

        using var upstreamResponse = await httpClient.SendAsync(upstreamRequest, cancellationToken);
        var responseBody = await upstreamResponse.Content.ReadAsStringAsync(cancellationToken);

        if (!upstreamResponse.IsSuccessStatusCode)
        {
            throw new UpstreamLlmException(upstreamResponse.StatusCode, responseBody);
        }

        using var upstreamJson = ParseUpstreamJson(responseBody);
        var usage = ExtractUsage(upstreamJson.RootElement);
        var modelJson = ExtractAssistantJson(upstreamJson.RootElement);
        var cleanedJson = StripMarkdownCodeFences(modelJson);

        FactCheckSelectionResponse? parsed;

        try
        {
            parsed = JsonSerializer.Deserialize<FactCheckSelectionResponse>(cleanedJson, JsonOptions);
        }
        catch (JsonException ex)
        {
            logger.LogWarning(ex, "LLM output was not valid JSON for the expected schema");
            throw new LlmResponseFormatException("LLM returned invalid JSON", ex);
        }

        if (parsed is null)
        {
            throw new LlmResponseFormatException("LLM returned empty JSON response");
        }

        parsed.Meta ??= new FactCheckMeta();
        parsed.Claims ??= Array.Empty<FactCheckClaim>();
        parsed.OverallAssessment ??= new FactCheckOverallAssessment();

        parsed.Meta.PageUrl = request.PageUrl;
        parsed.Meta.PageTitle = request.PageTitle;
        parsed.Meta.Locale = request.Locale;
        parsed.Meta.CheckedSources = providedSources
            .Select(source => new FactCheckCheckedSource
            {
                Url = source.Url,
                Title = source.Title,
                RetrievalStatus = source.RetrievalStatus
            })
            .ToArray();
        parsed.Meta.PromptTokens = usage.PromptTokens;
        parsed.Meta.CompletionTokens = usage.CompletionTokens;
        parsed.Meta.TotalTokens = usage.TotalTokens;

        NormalizeProbabilities(parsed);

        return parsed;
    }

    private static object BuildPayload(
        FactCheckSelectionRequest request,
        IReadOnlyList<RetrievedSource> providedSources)
    {
        return new
        {
            model = request.UserPreferences.Model,
            messages = new object[]
            {
                new
                {
                    role = "system",
                    content = PromptTemplates.SystemPrompt
                },
                new
                {
                    role = "developer",
                    content = PromptTemplates.DeveloperPrompt
                },
                new
                {
                    role = "user",
                    content = PromptTemplates.BuildUserPrompt(request, providedSources)
                }
            },
            temperature = MapStrictnessToTemperature(request.UserPreferences.Strictness),
            response_format = new
            {
                type = "json_object"
            }
        };
    }

    private static void NormalizeProbabilities(FactCheckSelectionResponse response)
    {
        foreach (var claim in response.Claims)
        {
            claim.Confidence = Clamp01(claim.Confidence);

            var truthProbability = claim.TruthProbability;

            if (!truthProbability.HasValue || double.IsNaN(truthProbability.Value) || double.IsInfinity(truthProbability.Value))
            {
                truthProbability = InferTruthProbability(claim.Verdict, claim.Confidence);
            }

            claim.TruthProbability = Clamp01(truthProbability.Value);
        }

        var overallTruthProbability = response.OverallAssessment.TruthProbability;

        if (!overallTruthProbability.HasValue ||
            double.IsNaN(overallTruthProbability.Value) ||
            double.IsInfinity(overallTruthProbability.Value))
        {
            overallTruthProbability = response.Claims.Count > 0
                ? response.Claims.Average(static claim => claim.TruthProbability ?? 0.5)
                : 0.5;
        }

        response.OverallAssessment.TruthProbability = Clamp01(overallTruthProbability.Value);
    }

    private static double InferTruthProbability(string verdict, double confidence)
    {
        return (verdict ?? string.Empty).Trim().ToUpperInvariant() switch
        {
            "SUPPORTED" => confidence,
            "DISPUTED" => 1.0 - confidence,
            "MISLEADING" => 1.0 - confidence,
            _ => 0.5
        };
    }

    private static double Clamp01(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value))
        {
            return 0.5;
        }

        return Math.Clamp(value, 0.0, 1.0);
    }

    private static double MapStrictnessToTemperature(string strictness)
    {
        return (strictness ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "high" => 0.0,
            "medium" => 0.2,
            "low" => 0.4,
            _ => 0.2
        };
    }

    private static JsonDocument ParseUpstreamJson(string responseBody)
    {
        try
        {
            return JsonDocument.Parse(responseBody);
        }
        catch (JsonException ex)
        {
            throw new LlmResponseFormatException("LLM response was not valid JSON", ex);
        }
    }

    private static UsageTokens ExtractUsage(JsonElement rootElement)
    {
        if (!rootElement.TryGetProperty("usage", out var usageElement) ||
            usageElement.ValueKind != JsonValueKind.Object)
        {
            return new UsageTokens(null, null, null);
        }

        var promptTokens = TryReadInt(usageElement, "prompt_tokens");
        var completionTokens = TryReadInt(usageElement, "completion_tokens");
        var totalTokens = TryReadInt(usageElement, "total_tokens");

        promptTokens ??= TryReadInt(usageElement, "input_tokens");
        completionTokens ??= TryReadInt(usageElement, "output_tokens");

        if (!totalTokens.HasValue && (promptTokens.HasValue || completionTokens.HasValue))
        {
            totalTokens = (promptTokens ?? 0) + (completionTokens ?? 0);
        }

        return new UsageTokens(promptTokens, completionTokens, totalTokens);
    }

    private static int? TryReadInt(JsonElement source, string propertyName)
    {
        if (!source.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        if (property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out var intValue))
        {
            return intValue;
        }

        return null;
    }

    private static string ExtractAssistantJson(JsonElement rootElement)
    {
        if (!rootElement.TryGetProperty("choices", out var choicesElement) ||
            choicesElement.ValueKind != JsonValueKind.Array ||
            choicesElement.GetArrayLength() == 0)
        {
            throw new LlmResponseFormatException("LLM response did not include choices");
        }

        var messageElement = choicesElement[0].GetProperty("message");

        if (!messageElement.TryGetProperty("content", out var contentElement))
        {
            throw new LlmResponseFormatException("LLM response did not include message content");
        }

        if (contentElement.ValueKind == JsonValueKind.String)
        {
            return contentElement.GetString() ?? string.Empty;
        }

        if (contentElement.ValueKind == JsonValueKind.Array)
        {
            var textParts = new List<string>();

            foreach (var item in contentElement.EnumerateArray())
            {
                if (item.TryGetProperty("text", out var textElement) && textElement.ValueKind == JsonValueKind.String)
                {
                    textParts.Add(textElement.GetString() ?? string.Empty);
                }
            }

            return string.Concat(textParts);
        }

        throw new LlmResponseFormatException("LLM message content was not a supported format");
    }

    private static string StripMarkdownCodeFences(string text)
    {
        var trimmed = text.Trim();

        if (!trimmed.StartsWith("```") || !trimmed.EndsWith("```"))
        {
            return trimmed;
        }

        var lines = trimmed.Split('\n').Select(line => line.TrimEnd('\r')).ToList();

        if (lines.Count < 3)
        {
            return trimmed;
        }

        lines.RemoveAt(0);
        lines.RemoveAt(lines.Count - 1);

        return string.Join('\n', lines).Trim();
    }

    private sealed record UsageTokens(int? PromptTokens, int? CompletionTokens, int? TotalTokens);
}

public sealed class UpstreamLlmException(HttpStatusCode statusCode, string responseBody) : Exception(
    $"LLM provider returned status {(int)statusCode}")
{
    public HttpStatusCode StatusCode { get; } = statusCode;

    public string ResponseBody { get; } = responseBody;
}

public sealed class LlmResponseFormatException : Exception
{
    public LlmResponseFormatException(string message)
        : base(message)
    {
    }

    public LlmResponseFormatException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
