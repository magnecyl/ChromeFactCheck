using System.Net.Http.Headers;
using ChromeFactCheck.Api.Contracts;

namespace ChromeFactCheck.Api.Services;

internal static class LlmProviderResolver
{
    internal static string NormalizeProvider(string provider)
    {
        if (string.IsNullOrWhiteSpace(provider))
        {
            throw new ArgumentException("provider is required");
        }

        return provider.Trim().ToLowerInvariant() switch
        {
            "openai" => "openai",
            "azure_openai" => "azure_openai",
            "custom" => "custom",
            _ => throw new ArgumentException("provider must be one of: openai, azure_openai, custom")
        };
    }

    internal static bool RequiresApiKey(string normalizedProvider)
    {
        return normalizedProvider is "openai" or "azure_openai";
    }

    internal static Uri ResolveEndpoint(FactCheckUserPreferences preferences, string normalizedProvider)
    {
        return normalizedProvider switch
        {
            "openai" => ResolveOpenAiCompatibleEndpoint(
                string.IsNullOrWhiteSpace(preferences.Endpoint)
                    ? "https://api.openai.com"
                    : preferences.Endpoint),
            "custom" => ResolveOpenAiCompatibleEndpoint(preferences.Endpoint),
            "azure_openai" => ResolveAzureEndpoint(preferences.Endpoint),
            _ => throw new ArgumentException("Unsupported provider")
        };
    }

    internal static void ApplyAuthenticationHeaders(
        HttpRequestMessage request,
        string normalizedProvider,
        string? apiKey)
    {
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return;
        }

        if (normalizedProvider == "azure_openai")
        {
            request.Headers.Add("api-key", apiKey.Trim());
            return;
        }

        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey.Trim());
    }

    private static Uri ResolveOpenAiCompatibleEndpoint(string endpoint)
    {
        if (string.IsNullOrWhiteSpace(endpoint))
        {
            throw new ArgumentException("endpoint is required for custom provider");
        }

        var trimmed = endpoint.Trim().TrimEnd('/');

        if (trimmed.Contains("/chat/completions", StringComparison.OrdinalIgnoreCase))
        {
            return new Uri(trimmed);
        }

        if (trimmed.EndsWith("/v1", StringComparison.OrdinalIgnoreCase))
        {
            return new Uri($"{trimmed}/chat/completions");
        }

        return new Uri($"{trimmed}/v1/chat/completions");
    }

    private static Uri ResolveAzureEndpoint(string endpoint)
    {
        if (string.IsNullOrWhiteSpace(endpoint))
        {
            throw new ArgumentException(
                "endpoint is required for azure_openai and should include /chat/completions and api-version query parameter");
        }

        if (!endpoint.Contains("/chat/completions", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException(
                "azure_openai endpoint must be a full chat completions URL ending with /chat/completions?api-version=...");
        }

        return new Uri(endpoint.Trim());
    }
}
