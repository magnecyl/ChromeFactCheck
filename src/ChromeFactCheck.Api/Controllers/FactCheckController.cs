using ChromeFactCheck.Api.Contracts;
using ChromeFactCheck.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace ChromeFactCheck.Api.Controllers;

[ApiController]
[Route("api/fact-check")]
public sealed class FactCheckController(
    IFactCheckOrchestrator orchestrator,
    ILogger<FactCheckController> logger) : ControllerBase
{
    [HttpPost("selection")]
    public async Task<ActionResult<FactCheckSelectionResponse>> CheckSelection(
        [FromBody] FactCheckSelectionRequest request,
        [FromHeader(Name = "X-Llm-Api-Key")] string? apiKey,
        CancellationToken cancellationToken)
    {
        var validationErrors = ValidateRequest(request, apiKey);

        if (validationErrors.Count > 0)
        {
            return BadRequest(new ValidationProblemDetails(validationErrors)
            {
                Title = "Invalid fact-check request",
                Status = StatusCodes.Status400BadRequest
            });
        }

        try
        {
            var result = await orchestrator.FactCheckSelectionAsync(request, apiKey, cancellationToken);
            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            logger.LogInformation(ex, "Validation failed for fact-check request");
            return BadRequest(new ProblemDetails
            {
                Title = "Invalid configuration",
                Detail = ex.Message,
                Status = StatusCodes.Status400BadRequest
            });
        }
        catch (UpstreamLlmException ex)
        {
            logger.LogWarning("LLM provider returned status {StatusCode}", (int)ex.StatusCode);
            return StatusCode(StatusCodes.Status502BadGateway, new ProblemDetails
            {
                Title = "LLM provider error",
                Detail = ex.ResponseBody,
                Status = StatusCodes.Status502BadGateway
            });
        }
        catch (LlmResponseFormatException ex)
        {
            logger.LogWarning(ex, "LLM response format was invalid");
            return StatusCode(StatusCodes.Status502BadGateway, new ProblemDetails
            {
                Title = "Invalid response from LLM provider",
                Detail = ex.Message,
                Status = StatusCodes.Status502BadGateway
            });
        }
    }

    private static Dictionary<string, string[]> ValidateRequest(
        FactCheckSelectionRequest request,
        string? apiKey)
    {
        var errors = new Dictionary<string, string[]>();
        var preferences = request.UserPreferences;

        if (string.IsNullOrWhiteSpace(request.SelectedText))
        {
            errors["selectedText"] = ["selectedText is required"];
        }

        if (preferences is null)
        {
            errors["userPreferences"] = ["userPreferences is required"];
            return errors;
        }

        if (preferences.MaxSources is < 3 or > 8)
        {
            errors["userPreferences.maxSources"] = ["maxSources must be between 3 and 8"];
        }

        if (!new[] { "low", "medium", "high" }.Contains(
                preferences.Strictness?.Trim() ?? string.Empty,
                StringComparer.OrdinalIgnoreCase))
        {
            errors["userPreferences.strictness"] = ["strictness must be one of: low, medium, high"];
        }

        if (string.IsNullOrWhiteSpace(preferences.AnswerLanguage))
        {
            errors["userPreferences.answerLanguage"] = ["answerLanguage is required"];
        }

        string provider;

        try
        {
            provider = LlmProviderResolver.NormalizeProvider(preferences.Provider);
        }
        catch (ArgumentException ex)
        {
            errors["userPreferences.provider"] = [ex.Message];
            return errors;
        }

        if (LlmProviderResolver.RequiresApiKey(provider) && string.IsNullOrWhiteSpace(apiKey))
        {
            errors["x-llm-api-key"] = [$"{provider} requires X-Llm-Api-Key header"];
        }

        if (preferences.ApiKeyPresent && string.IsNullOrWhiteSpace(apiKey))
        {
            errors["x-llm-api-key"] = ["apiKeyPresent=true but X-Llm-Api-Key header was empty"];
        }

        return errors;
    }
}
