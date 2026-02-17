const SETTINGS_KEY = "settings";
const I18N = globalThis.ChromeFactCheckI18n;
const DEFAULT_SETTINGS = {
  answerLanguage: "auto"
};

const answerLanguageSelect = document.getElementById("answerLanguage");
const openOptionsButton = document.getElementById("open-options");
const openResultButton = document.getElementById("open-result");
const saveStatus = document.getElementById("save-status");

let currentLocale = I18N.resolveLocale("auto", {
  pageLocale: document.documentElement.lang || "",
  browserLocale: navigator.language || ""
});

initialize().catch((error) => {
  saveStatus.textContent = error instanceof Error ? error.message : I18N.t(currentLocale, "popup.statusLoadFailed");
});

answerLanguageSelect.addEventListener("change", async () => {
  const selected = answerLanguageSelect.value || "auto";
  applyLocalization(selected);
  await saveAnswerLanguage(selected);
});

openOptionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

openResultButton.addEventListener("click", async () => {
  await chrome.tabs.create({
    url: chrome.runtime.getURL("result.html")
  });
});

async function initialize() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(stored[SETTINGS_KEY] || {})
  };

  applyLocalization(settings.answerLanguage || "auto");
  answerLanguageSelect.value = settings.answerLanguage || "auto";
  saveStatus.textContent = "";
}

async function saveAnswerLanguage(answerLanguage) {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = {
    ...(stored[SETTINGS_KEY] || {}),
    answerLanguage
  };

  await chrome.storage.local.set({
    [SETTINGS_KEY]: settings
  });

  saveStatus.textContent = I18N.t(currentLocale, "popup.statusLanguageSaved");

  window.setTimeout(() => {
    saveStatus.textContent = "";
  }, 1200);
}

function applyLocalization(answerLanguagePreference) {
  currentLocale = I18N.resolveLocale(answerLanguagePreference, {
    pageLocale: document.documentElement.lang || "",
    browserLocale: navigator.language || ""
  });

  I18N.applyTranslations(document, currentLocale);
  renderLanguageOptions(answerLanguageSelect, currentLocale);
  document.title = I18N.t(currentLocale, "popup.documentTitle");
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
