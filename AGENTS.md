# AGENTS.md

This file defines practical working rules for contributors and coding agents in this repository.

## Project Scope

ChromeFactCheck is composed of:

- `extension/`: Chrome Manifest V3 extension UI and client logic.
- `src/ChromeFactCheck.Api/`: ASP.NET Core API for fact-checking requests.
- `ChromeFactCheck.sln`: solution entry point.

## Local Dev Commands

Run backend:

```powershell
dotnet run --project src/ChromeFactCheck.Api --urls http://localhost:5053
```

Build backend:

```powershell
dotnet build ChromeFactCheck.sln
```

Health check:

```powershell
curl http://localhost:5053/api/health
```

Load extension:

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select `extension/`

## Working Rules

- Keep changes focused and minimal for the requested task.
- Prefer English fallback labels in extension UI.
- Do not hardcode Swedish labels unless locale-specific rendering is intentional.
- Preserve current extension UX:
  - quick in-page summary first
  - full report only on `Read more...`
  - visible loading state while analysis runs
- Keep all source files UTF-8 encoded.

## Security Rules

- Never commit real API keys or secrets.
- Never log API keys in extension or backend logs.
- Treat all provider credentials as runtime-only settings.

## API/Contract Notes

- Primary endpoint: `POST /api/fact-check/selection`
- Expected request fields:
  - `selectedText`, `pageUrl`, `pageTitle`, `locale`
  - `userPreferences` including provider/model/settings
- Header for user key: `X-Llm-Api-Key`

## Coding Conventions

- C#: keep controller/service boundaries clear, avoid hidden magic.
- Extension JS: keep messaging explicit (`runtime.sendMessage` + clear action types).
- CSS: favor readable variables and consistent naming.
- Keep comments short and only for non-obvious logic.

## Verification Before Hand-off

- Backend builds without errors: `dotnet build ChromeFactCheck.sln`
- Extension loads in Chrome without manifest/content-script encoding errors.
- Selection flow works end-to-end:
  - select text
  - see loading popover
  - receive short summary
  - open full report on demand

