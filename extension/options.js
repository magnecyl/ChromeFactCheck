const SETTINGS_KEY = "settings";
const I18N = globalThis.ChromeFactCheckI18n;
const DEFAULT_SETTINGS = {
  backendBaseUrl: "http://localhost:5053",
  provider: "openai",
  endpoint: "https://api.openai.com",
  model: "gpt-4.1-mini",
  apiKey: "",
  strictness: "medium",
  answerLanguage: "auto",
  maxSources: 5,
  trustedDomains: "wikipedia.org\nwho.int\nscb.se",
  blockedDomains: "",
  sendPageUrl: true
};

const form = document.getElementById("settings-form");
const status = document.getElementById("status");

const fields = {
  backendBaseUrl: document.getElementById("backendBaseUrl"),
  provider: document.getElementById("provider"),
  endpoint: document.getElementById("endpoint"),
  model: document.getElementById("model"),
  apiKey: document.getElementById("apiKey"),
  strictness: document.getElementById("strictness"),
  answerLanguage: document.getElementById("answerLanguage"),
  maxSources: document.getElementById("maxSources"),
  trustedDomains: document.getElementById("trustedDomains"),
  blockedDomains: document.getElementById("blockedDomains"),
  sendPageUrl: document.getElementById("sendPageUrl")
};

let currentLocale = I18N.resolveLocale("auto", {
  pageLocale: document.documentElement.lang || "",
  browserLocale: navigator.language || ""
});

initialize().catch((error) => {
  status.textContent = error instanceof Error ? error.message : I18N.t(currentLocale, "options.statusLoadFailed");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const settings = collectFormSettings();
  const resolvedLocale = applyLocalization(settings.answerLanguage || "auto");

  if (settings.maxSources < 3 || settings.maxSources > 8) {
    status.textContent = I18N.t(resolvedLocale, "options.statusMaxSourcesRange");
    return;
  }

  await chrome.storage.local.set({
    [SETTINGS_KEY]: settings
  });

  status.textContent = I18N.t(resolvedLocale, "options.statusSaved");

  window.setTimeout(() => {
    status.textContent = "";
  }, 2000);
});

fields.answerLanguage.addEventListener("change", () => {
  applyLocalization(fields.answerLanguage.value || "auto");
});

function collectFormSettings() {
  return {
    backendBaseUrl: fields.backendBaseUrl.value.trim(),
    provider: fields.provider.value,
    endpoint: fields.endpoint.value.trim(),
    model: fields.model.value.trim(),
    apiKey: fields.apiKey.value.trim(),
    strictness: fields.strictness.value,
    answerLanguage: fields.answerLanguage.value,
    maxSources: Number(fields.maxSources.value || 5),
    trustedDomains: fields.trustedDomains.value,
    blockedDomains: fields.blockedDomains.value,
    sendPageUrl: fields.sendPageUrl.checked
  };
}

async function initialize() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(stored[SETTINGS_KEY] || {})
  };

  applyLocalization(settings.answerLanguage || "auto");

  fields.backendBaseUrl.value = settings.backendBaseUrl;
  fields.provider.value = settings.provider;
  fields.endpoint.value = settings.endpoint;
  fields.model.value = settings.model;
  fields.apiKey.value = settings.apiKey;
  fields.strictness.value = settings.strictness;
  fields.answerLanguage.value = settings.answerLanguage || "auto";
  fields.maxSources.value = String(settings.maxSources);
  fields.trustedDomains.value = settings.trustedDomains;
  fields.blockedDomains.value = settings.blockedDomains;
  fields.sendPageUrl.checked = Boolean(settings.sendPageUrl);
}

function applyLocalization(answerLanguagePreference) {
  currentLocale = I18N.resolveLocale(answerLanguagePreference, {
    pageLocale: document.documentElement.lang || "",
    browserLocale: navigator.language || ""
  });

  I18N.applyTranslations(document, currentLocale);
  renderLanguageOptions(fields.answerLanguage, currentLocale);
  document.title = I18N.t(currentLocale, "options.documentTitle");

  return currentLocale;
}

function renderLanguageOptions(selectElement, locale) {
  const currentValue = selectElement.value || "auto";
  const options = I18N.getLanguageOptions(locale);

  selectElement.replaceChildren();

  for (const option of options) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    selectElement.appendChild(node);
  }

  selectElement.value = options.some((option) => option.value === currentValue) ? currentValue : "auto";
}
