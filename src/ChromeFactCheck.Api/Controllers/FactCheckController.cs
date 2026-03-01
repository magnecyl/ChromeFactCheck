using ChromeFactCheck.Api.Contracts;
using ChromeFactCheck.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace ChromeFactCheck.Api.Controllers;

[ApiController]
[Route("api/fact-check")]
public sealed class FactCheckController(
    IFactCheckOrchestrator orchestrator,
    TrialQuotaService trialQuotaService,
    ILogger<FactCheckController> logger) : ControllerBase
{
    [HttpPost("selection")]
    public async Task<ActionResult<FactCheckSelectionResponse>> CheckSelection(
        [FromBody] FactCheckSelectionRequest request,
        [FromHeader(Name = "X-Llm-Api-Key")] string? apiKey,
        [FromHeader(Name = "X-Trial-Id")] string? trialId,
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

        var normalizedProvider = LlmProviderResolver.NormalizeProvider(request.UserPreferences.Provider);
        var shouldUseTrial = string.IsNullOrWhiteSpace(apiKey) &&
                             trialQuotaService.IsEnabledForProvider(normalizedProvider);

        if (LlmProviderResolver.RequiresApiKey(normalizedProvider) && string.IsNullOrWhiteSpace(apiKey) && !shouldUseTrial)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["x-llm-api-key"] = [$"{normalizedProvider} requires X-Llm-Api-Key header"]
            })
            {
                Title = "Invalid fact-check request",
                Status = StatusCodes.Status400BadRequest
            });
        }

        if (shouldUseTrial && string.IsNullOrWhiteSpace(trialId))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["x-trial-id"] = ["X-Trial-Id header is required for trial mode"]
            })
            {
                Title = "Invalid fact-check request",
                Status = StatusCodes.Status400BadRequest
            });
        }

        try
        {
            if (shouldUseTrial)
            {
                trialQuotaService.EnsureCanUseTrial(trialId!);
            }

            var effectiveApiKey = shouldUseTrial
                ? trialQuotaService.GetApiKeyForTrial()
                : apiKey;

            if (LlmProviderResolver.RequiresApiKey(normalizedProvider) && string.IsNullOrWhiteSpace(effectiveApiKey))
            {
                return BadRequest(new ProblemDetails
                {
                    Title = "Invalid configuration",
                    Detail = "Trial mode is not configured with a backend API key.",
                    Status = StatusCodes.Status400BadRequest
                });
            }

            var result = await orchestrator.FactCheckSelectionAsync(request, effectiveApiKey, cancellationToken);

            if (shouldUseTrial)
            {
                var consumedTokens = GetConsumedTokenCount(result, request);
                var snapshot = trialQuotaService.AddUsage(trialId!, consumedTokens);

                result.Meta.TrialMode = true;
                result.Meta.TrialTokenLimit = snapshot.LimitTokens;
                result.Meta.TrialUsedTokens = snapshot.UsedTokens;
                result.Meta.TrialRemainingTokens = snapshot.RemainingTokens;
            }

            return Ok(result);
        }
        catch (TrialQuotaExceededException ex)
        {
            var trialLocale = ResolveTrialLocale(request);
            var problem = GetTrialQuotaExceededProblem(trialLocale, ex.LimitTokens);

            return StatusCode(StatusCodes.Status402PaymentRequired, new ProblemDetails
            {
                Title = problem.Title,
                Detail = problem.Detail,
                Status = StatusCodes.Status402PaymentRequired
            });
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

        try
        {
            _ = LlmProviderResolver.NormalizeProvider(preferences.Provider);
        }
        catch (ArgumentException ex)
        {
            errors["userPreferences.provider"] = [ex.Message];
            return errors;
        }

        if (preferences.ApiKeyPresent && string.IsNullOrWhiteSpace(apiKey))
        {
            errors["x-llm-api-key"] = ["apiKeyPresent=true but X-Llm-Api-Key header was empty"];
        }

        return errors;
    }

    private static int GetConsumedTokenCount(
        FactCheckSelectionResponse response,
        FactCheckSelectionRequest request)
    {
        if (response.Meta.TotalTokens is > 0)
        {
            return response.Meta.TotalTokens.Value;
        }

        var promptTokens = response.Meta.PromptTokens;
        var completionTokens = response.Meta.CompletionTokens;

        if (promptTokens.HasValue || completionTokens.HasValue)
        {
            return Math.Max(1, (promptTokens ?? 0) + (completionTokens ?? 0));
        }

        // Fallback estimate used only when upstream usage is missing.
        return Math.Max(1, request.SelectedText.Length / 4);
    }

    private static string ResolveTrialLocale(FactCheckSelectionRequest request)
    {
        var answerLanguage = request.UserPreferences?.AnswerLanguage?.Trim() ?? string.Empty;

        if (!string.IsNullOrWhiteSpace(answerLanguage) &&
            !string.Equals(answerLanguage, "auto", StringComparison.OrdinalIgnoreCase))
        {
            return answerLanguage;
        }

        return request.Locale?.Trim() ?? string.Empty;
    }

    private static ProblemDetails GetTrialQuotaExceededProblem(string locale, int limitTokens)
    {
        var language = GetLanguageCode(locale);

        if (language == "sv")
        {
            return new ProblemDetails
            {
                Title = "Gratis kvot förbrukad",
                Detail =
                    $"Din gratis kvot på {limitTokens} token är förbrukad. Lägg till din egen API-nyckel i tilläggets inställningar för att fortsätta."
            };
        }

        if (language == "de")
        {
            return new ProblemDetails
            {
                Title = "Testkontingent aufgebraucht",
                Detail =
                    $"Ihr kostenloses Kontingent von {limitTokens} Tokens ist aufgebraucht. Fügen Sie in den Erweiterungseinstellungen Ihren eigenen API-Schlüssel hinzu, um fortzufahren."
            };
        }

        if (language == "fr")
        {
            return new ProblemDetails
            {
                Title = "Quota gratuite épuisée",
                Detail =
                    $"Votre quota gratuit de {limitTokens} jetons est épuisé. Ajoutez votre propre clé API dans les paramètres de l'extension pour continuer."
            };
        }

        if (language == "es")
        {
            return new ProblemDetails
            {
                Title = "Cuota gratuita agotada",
                Detail =
                    $"Tu cuota gratuita de {limitTokens} tokens está agotada. Agrega tu propia clave API en la configuración de la extensión para continuar."
            };
        }

        return new ProblemDetails
        {
            Title = "Free token quota exhausted",
            Detail =
                $"Your free quota of {limitTokens} tokens is exhausted. Add your own API key in extension settings to continue."
        };
    }

    private static string GetLanguageCode(string locale)
    {
        if (string.IsNullOrWhiteSpace(locale))
        {
            return "en";
        }

        var normalized = locale.Trim().Replace('_', '-');
        var separatorIndex = normalized.IndexOf('-');

        if (separatorIndex > 0)
        {
            normalized = normalized[..separatorIndex];
        }

        return normalized.ToLowerInvariant();
    }
}
