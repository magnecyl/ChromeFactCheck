# Privacy Policy for Chrome Fact Check

Last updated: February 17, 2026

Chrome Fact Check helps users fact-check text selected on web pages. This policy explains what data is processed by the extension and backend service.

## 1. Data We Process

- Selected text and selected links from the page when the user starts a fact-check.
- Page title and optional page URL (URL sharing can be disabled in extension settings).
- Locale and user preferences (language, strictness, max sources, trusted/blocked domains, provider settings).
- Optional API key entered by the user in extension settings (stored locally in browser storage).
- Technical metadata such as timestamps, request status, token usage, and error logs.
- A random trial identifier (stored locally) when trial mode is used.

## 2. How We Use Data

- To send fact-check requests to the configured backend.
- To retrieve and evaluate sources related to selected claims.
- To generate and return summaries, verdicts, and detailed reports.
- To operate security, reliability, abuse prevention, and trial quota controls.

## 3. Data Sharing

- We do not sell personal data.
- Data is shared only with service providers needed to deliver the feature, such as:
  - Hosting and infrastructure provider (Azure App Service)
  - Configured LLM provider (OpenAI, Azure OpenAI, or user-configured compatible provider)
  - Source retrieval services used by the backend

## 4. Data Storage and Retention

- Extension settings are stored locally in the user's browser until changed or removed.
- Request content is processed to generate results; backend logs may be retained for operational and security purposes for a limited time.
- Users should avoid submitting sensitive personal information for fact-checking.

## 5. User Controls

- Fact-checking is user-initiated.
- Users can disable page URL sharing in settings.
- Users can remove stored settings and API keys from extension storage at any time.
- Users can uninstall the extension at any time.

## 6. Security

- Production traffic is sent over HTTPS.
- Access to service data is limited to operation and security needs.

## 7. Children

This service is not intended for children under 13.

## 8. Changes to This Policy

We may update this policy from time to time. The latest version will be published at this URL.

## 9. Contact

- Support: https://github.com/magnecyl/ChromeFactCheck/issues
