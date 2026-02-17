using System.ComponentModel.DataAnnotations;

namespace ChromeFactCheck.Api.Contracts;

public sealed class FactCheckSelectionRequest
{
    [Required(AllowEmptyStrings = false)]
    public string SelectedText { get; init; } = string.Empty;

    public string PageUrl { get; init; } = string.Empty;

    public string PageTitle { get; init; } = string.Empty;

    [Required(AllowEmptyStrings = false)]
    public string Locale { get; init; } = "en-US";

    [Required]
    public FactCheckUserPreferences UserPreferences { get; init; } = new();
}

public sealed class FactCheckUserPreferences
{
    [Required(AllowEmptyStrings = false)]
    public string Provider { get; init; } = "openai";

    public string Endpoint { get; init; } = string.Empty;

    [Required(AllowEmptyStrings = false)]
    public string Model { get; init; } = "gpt-4.1-mini";

    public bool ApiKeyPresent { get; init; }

    [Required(AllowEmptyStrings = false)]
    public string Strictness { get; init; } = "medium";

    [Required(AllowEmptyStrings = false)]
    public string AnswerLanguage { get; init; } = "auto";

    [Range(3, 8)]
    public int MaxSources { get; init; } = 5;

    public IReadOnlyList<string> TrustedDomains { get; init; } = Array.Empty<string>();

    public IReadOnlyList<string> BlockedDomains { get; init; } = Array.Empty<string>();
}
