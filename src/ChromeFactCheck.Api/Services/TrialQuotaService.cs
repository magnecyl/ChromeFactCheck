using System.Collections.Concurrent;
using ChromeFactCheck.Api.Options;
using Microsoft.Extensions.Options;

namespace ChromeFactCheck.Api.Services;

public sealed class TrialQuotaService(IOptions<TrialModeOptions> options)
{
    private readonly ConcurrentDictionary<string, TrialUsageState> usageByTrialId = new(StringComparer.Ordinal);
    private readonly TrialModeOptions trialOptions = options.Value;

    public bool IsEnabledForProvider(string provider)
    {
        if (!trialOptions.Enabled)
        {
            return false;
        }

        if (string.IsNullOrWhiteSpace(trialOptions.ApiKey))
        {
            return false;
        }

        return string.Equals(
            trialOptions.Provider?.Trim(),
            provider?.Trim(),
            StringComparison.OrdinalIgnoreCase);
    }

    public int TokenLimit => Math.Max(1, trialOptions.TokenLimit);

    public TrialQuotaSnapshot GetSnapshot(string trialId)
    {
        if (string.IsNullOrWhiteSpace(trialId))
        {
            return new TrialQuotaSnapshot(TokenLimit, 0, TokenLimit, true);
        }

        var normalizedTrialId = NormalizeTrialId(trialId);
        var usedTokens = usageByTrialId.TryGetValue(normalizedTrialId, out var state)
            ? state.UsedTokens
            : 0;

        var remainingTokens = Math.Max(0, TokenLimit - usedTokens);
        var exhausted = remainingTokens <= 0;

        return new TrialQuotaSnapshot(TokenLimit, usedTokens, remainingTokens, exhausted);
    }

    public void EnsureCanUseTrial(string trialId)
    {
        var snapshot = GetSnapshot(trialId);

        if (!snapshot.IsExhausted)
        {
            return;
        }

        throw new TrialQuotaExceededException(snapshot.LimitTokens);
    }

    public TrialQuotaSnapshot AddUsage(string trialId, int usedTokens)
    {
        if (string.IsNullOrWhiteSpace(trialId))
        {
            return GetSnapshot(trialId);
        }

        var boundedUsage = Math.Max(0, usedTokens);
        var normalizedTrialId = NormalizeTrialId(trialId);

        usageByTrialId.AddOrUpdate(
            normalizedTrialId,
            _ => new TrialUsageState
            {
                UsedTokens = boundedUsage,
                UpdatedAtUtc = DateTimeOffset.UtcNow
            },
            (_, currentState) => currentState with
            {
                UsedTokens = currentState.UsedTokens + boundedUsage,
                UpdatedAtUtc = DateTimeOffset.UtcNow
            });

        return GetSnapshot(normalizedTrialId);
    }

    public string? GetApiKeyForTrial()
    {
        return string.IsNullOrWhiteSpace(trialOptions.ApiKey)
            ? null
            : trialOptions.ApiKey.Trim();
    }

    private static string NormalizeTrialId(string trialId)
    {
        return trialId.Trim();
    }

    private sealed record TrialUsageState
    {
        public int UsedTokens { get; init; }

        public DateTimeOffset UpdatedAtUtc { get; init; }
    }
}

public sealed record TrialQuotaSnapshot(
    int LimitTokens,
    int UsedTokens,
    int RemainingTokens,
    bool IsExhausted);

public sealed class TrialQuotaExceededException(int limitTokens) : Exception(
    $"Trial quota exceeded ({limitTokens} tokens).")
{
    public int LimitTokens { get; } = limitTokens;
}
