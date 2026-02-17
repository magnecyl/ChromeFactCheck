# ChromeFactCheck MVP

This repo contains a first end-to-end MVP for a Chrome fact-check workflow:

- `src/ChromeFactCheck.Api`: ASP.NET Core Web API backend
- `extension`: Chrome Manifest V3 extension

## Current scope

Implemented now:
- Select text on any page.
- Inline prompt appears on selection with a `Fact-check` action.
- Right click -> `Fact-check selected text`.
- Extension sends your request contract to the backend.
- Backend builds your System/Developer/User prompt and calls the configured provider.
- Backend fetches source URLs found in the selected text and includes them in verification context.
- Extension includes an explicit answer-language setting for generated explanations.
- A short 2-3 sentence summary appears in-page as a popover.
- `Read more...` opens the full extension result page.
- Result view shows explicit `True %` and `False %` probabilities plus checked source status.

Planned next:
- Auto-check full page content.
- Retrieval pipeline (Step A + Step B with source citations).

## Backend run

```powershell
cd src/ChromeFactCheck.Api
dotnet run
```

Default local URL from launch profile: `http://localhost:5053`.

Health endpoint:
- `GET /api/health`

Fact-check endpoint:
- `POST /api/fact-check/selection`
- API key header: `X-Llm-Api-Key`

### Provider handling

`userPreferences.provider` supports:
- `openai`
- `azure_openai`
- `custom`

`userPreferences.endpoint` behavior:
- `openai`: optional. If empty, defaults to `https://api.openai.com`.
- `azure_openai`: required full chat completions URL including `api-version`.
- `custom`: required. OpenAI-compatible base URL or full `/chat/completions` URL.

## Extension load

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Choose the `extension` folder.
5. Open extension `Details` -> `Extension options`.
6. Fill backend URL/provider/model/API key.
7. Pick preferred `Answer language` (`Auto` uses page/browser locale).

## Extension usage

1. Highlight text on a webpage.
2. Right click and choose `Fact-check selected text`.
3. Read the short popover summary.
4. Click `Read more...` for full verdicts and follow-up checks.

## Notes on secrets

- API key is stored in `chrome.storage.local` by the extension.
- API key is sent to backend in `X-Llm-Api-Key` header.
- Backend does not persist API keys.

## Request contract

The extension sends:

```json
{
  "selectedText": "...",
  "pageUrl": "...",
  "pageTitle": "...",
  "locale": "en-US",
  "userPreferences": {
    "provider": "openai|azure_openai|custom",
    "endpoint": "...",
    "model": "gpt-4.1-mini",
    "apiKeyPresent": true,
    "strictness": "low|medium|high",
    "answerLanguage": "auto|en-US|sv-SE|...",
    "maxSources": 5,
    "trustedDomains": ["wikipedia.org"],
    "blockedDomains": ["example.com"]
  }
}
```
