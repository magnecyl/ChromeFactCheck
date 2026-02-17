const SETTINGS_KEY = "settings";
const DEFAULT_SETTINGS = {
  answerLanguage: "auto"
};

const answerLanguageSelect = document.getElementById("answerLanguage");
const openOptionsButton = document.getElementById("open-options");
const openResultButton = document.getElementById("open-result");
const saveStatus = document.getElementById("save-status");

initialize().catch((error) => {
  saveStatus.textContent = error instanceof Error ? error.message : "Failed to load settings.";
});

answerLanguageSelect.addEventListener("change", async () => {
  await saveAnswerLanguage(answerLanguageSelect.value);
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

  saveStatus.textContent = "Language saved.";

  window.setTimeout(() => {
    saveStatus.textContent = "";
  }, 1200);
}
