namespace ChromeFactCheck.Api.Contracts;

public sealed class FactCheckSelectionResponse
{
    public FactCheckMeta Meta { get; set; } = new();

    public IReadOnlyList<FactCheckClaim> Claims { get; set; } = Array.Empty<FactCheckClaim>();

    public FactCheckOverallAssessment OverallAssessment { get; set; } = new();
}

public sealed class FactCheckMeta
{
    public string PageUrl { get; set; } = string.Empty;

    public string PageTitle { get; set; } = string.Empty;

    public string Locale { get; set; } = "en-US";

    public IReadOnlyList<FactCheckCheckedSource> CheckedSources { get; set; } = Array.Empty<FactCheckCheckedSource>();
}

public sealed class FactCheckCheckedSource
{
    public string Url { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public string RetrievalStatus { get; set; } = "fetched";
}

public sealed class FactCheckClaim
{
    public string Claim { get; set; } = string.Empty;

    public string Verdict { get; set; } = "UNCLEAR";

    public double Confidence { get; set; }

    public double? TruthProbability { get; set; }

    public string ShortExplanation { get; set; } = string.Empty;

    public IReadOnlyList<string> SearchQueries { get; set; } = Array.Empty<string>();

    public IReadOnlyList<string> EvidenceNeeded { get; set; } = Array.Empty<string>();

    public IReadOnlyList<string> Notes { get; set; } = Array.Empty<string>();
}

public sealed class FactCheckOverallAssessment
{
    public string Summary { get; set; } = string.Empty;

    public double? TruthProbability { get; set; }

    public IReadOnlyList<string> KeyRisks { get; set; } = Array.Empty<string>();

    public IReadOnlyList<string> WhatToCheckNext { get; set; } = Array.Empty<string>();
}
