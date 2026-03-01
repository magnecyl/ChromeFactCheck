namespace ChromeFactCheck.Api.Options;

public sealed class TrialModeOptions
{
    public const string SectionName = "TrialMode";

    public bool Enabled { get; init; }

    public string Provider { get; init; } = "openai";

    public string ApiKey { get; init; } = string.Empty;

    public int TokenLimit { get; init; } = 20000;
}
