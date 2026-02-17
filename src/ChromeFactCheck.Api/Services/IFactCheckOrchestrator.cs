using ChromeFactCheck.Api.Contracts;

namespace ChromeFactCheck.Api.Services;

public interface IFactCheckOrchestrator
{
    Task<FactCheckSelectionResponse> FactCheckSelectionAsync(
        FactCheckSelectionRequest request,
        string? apiKey,
        CancellationToken cancellationToken);
}
