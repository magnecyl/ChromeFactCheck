# ChromeFactCheck

ChromeFactCheck is a Chrome extension plus ASP.NET Core backend for fast claim verification.
It lets users select text on any page, request a fact check, view a short in-page summary, and open a full report on demand.

## What It Does

- Select text on a page and trigger fact checking.
- Show a short 2-3 sentence summary in a popover.
- Show loading state with spinner while analysis is running.
- Open detailed output only when user clicks `Read more...`.
- Support configurable LLM provider, endpoint, model, API key, and answer language.

## Repository Structure

- `extension/` Chrome Manifest V3 extension
- `src/ChromeFactCheck.Api/` ASP.NET Core backend (`net9.0`)
- `ChromeFactCheck.sln` solution file

## Prerequisites

- .NET SDK 9.0+
- Google Chrome (or Chromium with extension support)
- An LLM API key for configured provider

## Quick Start

### 1) Run backend

From repo root:

```powershell
dotnet run --project src/ChromeFactCheck.Api --urls http://localhost:5053
```

Health check:

```powershell
curl http://localhost:5053/api/health
```

### 2) Load extension

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the `extension` folder

### 3) Configure settings

Use the extension popup (`toolbar icon`) or options page:

- `Backend URL`: `http://localhost:5053` for local development
- `Provider`: `openai`, `azure_openai`, or `custom`
- `Endpoint`: required for `azure_openai` and `custom`
- `Model`: for example `gpt-4.1-mini`
- `API Key`: stored in `chrome.storage.local`
- `Answer Language`: `auto` or explicit locale (`en-US`, `sv-SE`, etc.)

## User Flow

1. User highlights text on a web page.
2. Extension opens the small fact-check prompt/popover.
3. Backend receives selection + metadata and runs analysis.
4. Extension shows short summary with estimated true/false probability.
5. User can click `Read more...` to open full report page.

## API Reference

### Endpoints

- `GET /api/health`
- `POST /api/fact-check/selection`

### Request contract (`POST /api/fact-check/selection`)

```json
{
  "selectedText": "string",
  "pageUrl": "string",
  "pageTitle": "string",
  "locale": "en-US",
  "userPreferences": {
    "provider": "openai|azure_openai|custom",
    "endpoint": "string",
    "model": "string",
    "apiKeyPresent": true,
    "strictness": "low|medium|high",
    "answerLanguage": "auto|en-US|sv-SE",
    "maxSources": 5,
    "trustedDomains": ["wikipedia.org"],
    "blockedDomains": ["example.com"]
  }
}
```

### Provider behavior

- `openai`: endpoint optional, defaults to `https://api.openai.com`
- `azure_openai`: full chat-completions endpoint required (include `api-version`)
- `custom`: OpenAI-compatible endpoint required

### Secrets and auth

- Extension sends key in `X-Llm-Api-Key` header.
- Backend uses it per request and should not persist it.

## Development Workflow

### Build

```powershell
dotnet build ChromeFactCheck.sln
```

### Typical local loop

1. Edit API and/or extension files.
2. Build backend with `dotnet build`.
3. Reload extension in `chrome://extensions`.
4. Re-test by selecting text on a page.

## Troubleshooting

- `Could not load file 'content.js' ... UTF-8 encoded`
  - Re-save `extension/content.js` as UTF-8 (without BOM recommended).
- `Cannot find menu item with id ...`
  - Reload extension and ensure context menu is created on startup/install.
- Popup not updating
  - Reload extension and check `chrome://extensions` service worker logs.
- Backend not reachable
  - Verify API URL and run `curl http://localhost:5053/api/health`.

## Security Notes

- Do not commit real API keys.
- Do not log secrets in API or extension logs.
- Keep provider endpoints explicit in non-default setups.

## Roadmap

- Full-page auto-check mode (beyond selected text)
- Retrieval-assisted second pass with source adjudication
- Better citation display and conflict handling between sources
