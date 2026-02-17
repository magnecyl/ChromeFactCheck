using System.Net;
using System.Text.RegularExpressions;
using ChromeFactCheck.Api.Contracts;

namespace ChromeFactCheck.Api.Services;

public sealed class SourceRetrievalService(
    IHttpClientFactory httpClientFactory,
    ILogger<SourceRetrievalService> logger)
{
    private static readonly Regex UrlRegex = new(
        @"https?://[^\s\""""'<>\]\)]+",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    internal async Task<IReadOnlyList<RetrievedSource>> RetrieveAsync(
        FactCheckSelectionRequest request,
        CancellationToken cancellationToken)
    {
        var sourceLimit = Math.Clamp(request.UserPreferences.MaxSources, 1, 8);
        var blockedDomains = request.UserPreferences.BlockedDomains
            .Select(NormalizeDomain)
            .Where(static domain => !string.IsNullOrWhiteSpace(domain))
            .ToArray();

        var urls = ExtractUrls(request.SelectedText)
            .Take(sourceLimit)
            .ToList();

        if (urls.Count == 0)
        {
            return Array.Empty<RetrievedSource>();
        }

        var retrievalTasks = urls
            .Select(url => RetrieveSingleAsync(url, blockedDomains, cancellationToken))
            .ToArray();

        var results = await Task.WhenAll(retrievalTasks);

        return results;
    }

    private async Task<RetrievedSource> RetrieveSingleAsync(
        Uri sourceUrl,
        IReadOnlyList<string> blockedDomains,
        CancellationToken cancellationToken)
    {
        if (IsDomainBlocked(sourceUrl.Host, blockedDomains))
        {
            return new RetrievedSource(
                sourceUrl.AbsoluteUri,
                sourceUrl.Host,
                "Source retrieval skipped because domain is blocked in extension settings.",
                "blocked");
        }

        var directFetch = await TryDownloadTextAsync(sourceUrl.AbsoluteUri, cancellationToken);

        if (directFetch.Success)
        {
            return BuildRetrievedSource(sourceUrl.AbsoluteUri, directFetch.Content, "fetched-direct");
        }

        var proxyUrl = $"https://r.jina.ai/{sourceUrl.AbsoluteUri}";
        var proxyFetch = await TryDownloadTextAsync(proxyUrl, cancellationToken);

        if (proxyFetch.Success)
        {
            return BuildRetrievedSource(sourceUrl.AbsoluteUri, proxyFetch.Content, "fetched-via-proxy");
        }

        logger.LogInformation(
            "Failed to retrieve source {SourceUrl}. Direct={DirectError}. Proxy={ProxyError}",
            sourceUrl.AbsoluteUri,
            directFetch.Error,
            proxyFetch.Error);

        return new RetrievedSource(
            sourceUrl.AbsoluteUri,
            sourceUrl.Host,
            "Source retrieval failed. Unable to load content from this link.",
            "failed");
    }

    private async Task<DownloadResult> TryDownloadTextAsync(string url, CancellationToken cancellationToken)
    {
        try
        {
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(12));

            var client = httpClientFactory.CreateClient("retrieval");
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.UserAgent.ParseAdd("ChromeFactCheck/0.1");

            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeoutCts.Token);

            if (!response.IsSuccessStatusCode)
            {
                return DownloadResult.Fail($"HTTP {(int)response.StatusCode}");
            }

            var mediaType = response.Content.Headers.ContentType?.MediaType ?? string.Empty;

            if (mediaType.Contains("pdf", StringComparison.OrdinalIgnoreCase))
            {
                return DownloadResult.Fail("PDF content is not yet supported");
            }

            var rawContent = await response.Content.ReadAsStringAsync(timeoutCts.Token);

            if (string.IsNullOrWhiteSpace(rawContent))
            {
                return DownloadResult.Fail("empty response");
            }

            return DownloadResult.Ok(rawContent);
        }
        catch (OperationCanceledException)
        {
            return DownloadResult.Fail("timeout");
        }
        catch (Exception ex)
        {
            return DownloadResult.Fail(ex.Message);
        }
    }

    private static RetrievedSource BuildRetrievedSource(string url, string rawContent, string retrievalStatus)
    {
        var shortened = rawContent.Length > 80_000
            ? rawContent[..80_000]
            : rawContent;

        if (LooksLikeHtml(shortened))
        {
            return BuildFromHtml(url, shortened, retrievalStatus);
        }

        return BuildFromText(url, shortened, retrievalStatus);
    }

    private static RetrievedSource BuildFromHtml(string url, string html, string retrievalStatus)
    {
        var titleMatch = Regex.Match(html, "(?is)<title[^>]*>(.*?)</title>");
        var title = titleMatch.Success
            ? NormalizeWhitespace(WebUtility.HtmlDecode(titleMatch.Groups[1].Value))
            : new Uri(url).Host;

        var withoutScripts = Regex.Replace(html, "(?is)<script[^>]*>.*?</script>", " ");
        var withoutStyles = Regex.Replace(withoutScripts, "(?is)<style[^>]*>.*?</style>", " ");
        var text = Regex.Replace(withoutStyles, "(?is)<[^>]+>", " ");
        var excerpt = NormalizeWhitespace(WebUtility.HtmlDecode(text));

        return new RetrievedSource(
            url,
            Truncate(title, 180),
            Truncate(excerpt, 2200),
            retrievalStatus);
    }

    private static RetrievedSource BuildFromText(string url, string text, string retrievalStatus)
    {
        var normalized = NormalizeWhitespace(text);
        var lines = text
            .Split('\n')
            .Select(static line => line.Trim())
            .Where(static line => !string.IsNullOrWhiteSpace(line))
            .ToList();

        var title = lines.FirstOrDefault() ?? new Uri(url).Host;

        if (title.StartsWith("Title:", StringComparison.OrdinalIgnoreCase))
        {
            title = title[6..].Trim();
        }

        return new RetrievedSource(
            url,
            Truncate(title, 180),
            Truncate(normalized, 2200),
            retrievalStatus);
    }

    private static IEnumerable<Uri> ExtractUrls(string text)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (Match match in UrlRegex.Matches(text))
        {
            var candidate = match.Value.Trim().TrimEnd('.', ',', ';', ':', ')', ']', '}');

            if (!Uri.TryCreate(candidate, UriKind.Absolute, out var uri))
            {
                continue;
            }

            if (!uri.Scheme.Equals("http", StringComparison.OrdinalIgnoreCase) &&
                !uri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (seen.Add(uri.AbsoluteUri))
            {
                yield return uri;
            }
        }
    }

    private static bool LooksLikeHtml(string content)
    {
        return content.Contains("<html", StringComparison.OrdinalIgnoreCase) ||
               content.Contains("<body", StringComparison.OrdinalIgnoreCase) ||
               content.Contains("</p>", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsDomainBlocked(string host, IEnumerable<string> blockedDomains)
    {
        var normalizedHost = NormalizeDomain(host);

        foreach (var blocked in blockedDomains)
        {
            if (normalizedHost.Equals(blocked, StringComparison.OrdinalIgnoreCase) ||
                normalizedHost.EndsWith($".{blocked}", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private static string NormalizeDomain(string domain)
    {
        return (domain ?? string.Empty)
            .Trim()
            .TrimStart('.')
            .ToLowerInvariant();
    }

    private static string NormalizeWhitespace(string text)
    {
        return Regex.Replace(text ?? string.Empty, "\\s+", " ").Trim();
    }

    private static string Truncate(string text, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length <= maxLength)
        {
            return text;
        }

        return $"{text[..maxLength].TrimEnd()}...";
    }

    private readonly record struct DownloadResult(bool Success, string Content, string Error)
    {
        internal static DownloadResult Ok(string content) => new(true, content, string.Empty);

        internal static DownloadResult Fail(string error) => new(false, string.Empty, error);
    }
}

internal sealed record RetrievedSource(
    string Url,
    string Title,
    string Excerpt,
    string RetrievalStatus);
