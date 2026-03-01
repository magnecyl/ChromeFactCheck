import "./localization.js";

const MENU_ID = "chrome-fact-check.selection";
const SETTINGS_KEY = "settings";
const RESULT_KEY = "lastFactCheckResult";
const ERROR_KEY = "lastFactCheckError";
const INPUT_KEY = "lastFactCheckInput";
const TIMESTAMP_KEY = "lastFactCheckAt";
const TRIAL_CLIENT_ID_KEY = "trialClientId";

const POPOVER_MESSAGE = "SHOW_FACTCHECK_POPOVER";
const OPEN_DETAILS_MESSAGE = "OPEN_FACTCHECK_DETAILS";
const OPEN_OPTIONS_MESSAGE = "OPEN_FACTCHECK_OPTIONS";
const START_FACTCHECK_MESSAGE = "START_FACTCHECK_FROM_SELECTION";
const GET_SELECTION_CONTEXT_MESSAGE = "GET_SELECTION_CONTEXT";
const ICON_RESET_DELAY_MS = 4500;
const I18N = globalThis.ChromeFactCheckI18n;

const ICON_PALETTE = {
  idle: {
    panelTop: "#9ca3af",
    panelBottom: "#6b7280",
    accent: "#22c55e",
    ring: "#374151",
    mark: "#f9fafb"
  },
  thinking: {
    panelTop: "#9ca3af",
    panelBottom: "#6b7280",
    accent: "#10b981",
    ring: "#065f46",
    mark: "#f0fdf4"
  },
  success: {
    panelTop: "#6b7280",
    panelBottom: "#4b5563",
    accent: "#22c55e",
    ring: "#166534",
    mark: "#f0fdf4"
  },
  error: {
    panelTop: "#9ca3af",
    panelBottom: "#6b7280",
    accent: "#ef4444",
    ring: "#7f1d1d",
    mark: "#fef2f2"
  }
};

let spinnerIntervalId = null;
let spinnerFrame = 0;
let iconResetTimeoutId = null;
let currentIconState = "idle";
let menuAvailable = false;
let lastUiLocale = I18N.DEFAULT_LOCALE;

const DEFAULT_SETTINGS = {
  backendBaseUrl: "https://chromefactcheck-api.azurewebsites.net",
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

void setStatusIcon("idle");
void ensureContextMenu();

chrome.runtime.onInstalled.addListener(() => {
  void ensureContextMenu();
  void setStatusIcon("idle");
});

chrome.runtime.onStartup.addListener(() => {
  void ensureContextMenu();
  void setStatusIcon("idle");
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[SETTINGS_KEY]) {
    return;
  }

  void ensureContextMenu();
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === OPEN_DETAILS_MESSAGE) {
    void openResultDetailsTab();
    return;
  }

  if (message.type === OPEN_OPTIONS_MESSAGE) {
    void chrome.runtime.openOptionsPage();
    return;
  }

  if (message.type === START_FACTCHECK_MESSAGE) {
    const selectedText = (message.selectedText || "").trim();
    const contextOverride = {
      pageUrl: typeof message.pageUrl === "string" ? message.pageUrl : "",
      pageTitle: typeof message.pageTitle === "string" ? message.pageTitle : "",
      locale: typeof message.locale === "string" ? message.locale : "",
      selectedLinks: Array.isArray(message.selectedLinks) ? message.selectedLinks : []
    };

    void runFactCheckFlow({
      selectedText,
      tab: sender?.tab,
      contextOverride
    });
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) {
    return;
  }

  void runFactCheckFromContextMenu(info, tab);
});

async function runFactCheckFromContextMenu(info, tab) {
  const selectedText = (info.selectionText || "").trim();
  const selectionContext = await getSelectionContextFromTab(tab?.id);

  await runFactCheckFlow({
    selectedText,
    tab,
    contextOverride: selectionContext
  });
}

async function runFactCheckFlow({ selectedText, tab, contextOverride = null }) {
  const settings = await loadSettings();
  const initialLocale = resolveUiLocale(settings.answerLanguage || "auto", contextOverride?.locale || "");
  lastUiLocale = initialLocale;
  const initialUiText = getPopoverUiText(initialLocale);

  if (!selectedText) {
    const message = t("fact.noSelection", {}, initialLocale);
    await saveResultState({ result: null, error: message, input: null });
    await setStatusIcon("error");
    scheduleIconReset();
    await showPopoverOrFallback(tab?.id, {
      tone: "error",
      title: initialUiText.failedTitle,
      summary: message,
      ctaLabel: initialUiText.readMore,
      locale: initialLocale
    });
    return;
  }

  let requestBody;
  let finalIconState = "success";

  startThinkingAnimation();
  startContextMenuThinkingAnimation();
  await showPopoverOrFallback(
    tab?.id,
    {
      tone: "thinking",
      title: initialUiText.thinkingTitle,
      summary: initialUiText.thinkingSummary,
      showSpinner: true,
      spinnerLabel: initialUiText.spinnerInProgress,
      hideReadMore: true,
      persist: true,
      locale: initialLocale
    },
    {
      fallbackToDetails: false
    }
  );

  try {
    validateSettings(settings, initialLocale);

    requestBody = buildFactCheckRequest(selectedText, tab, settings, contextOverride);
    const response = await callBackend(requestBody, settings);
    const uiLocale = resolveUiLocale(settings.answerLanguage || "auto", response?.meta?.locale || initialLocale);
    const uiText = getPopoverUiText(uiLocale);
    const overallTruthProbability = getOverallTruthProbability(response);
    const trueProbabilityPct = Math.round(overallTruthProbability * 100);
    const falseProbabilityPct = Math.round((1 - overallTruthProbability) * 100);
    lastUiLocale = uiLocale;

    await saveResultState({ result: response, error: "", input: requestBody });

    await showPopoverOrFallback(tab?.id, {
      tone: "success",
      title: uiText.summaryTitle,
      summary: buildPopoverSummary(response, uiLocale, {
        includeProbabilityLine: false
      }),
      ctaLabel: uiText.readMore,
      probabilityTruePct: trueProbabilityPct,
      probabilityFalsePct: falseProbabilityPct,
      probabilityTrueLabel: t("prob.true", {}, uiLocale),
      probabilityFalseLabel: t("prob.false", {}, uiLocale),
      locale: uiLocale
    });
  } catch (error) {
    finalIconState = "error";
    const message = error instanceof Error ? error.message : t("err.unknown", {}, initialLocale);
    const uiText = getPopoverUiText(initialLocale);
    lastUiLocale = initialLocale;

    await saveResultState({
      result: null,
      error: message,
      input: requestBody || null
    });

    await showPopoverOrFallback(tab?.id, {
      tone: "error",
      title: uiText.failedTitle,
      summary: ensureSentence(trimText(message, 220)),
      ctaLabel: uiText.readMore,
      showSettingsAction: shouldShowSettingsAction(message),
      locale: initialLocale
    });
  } finally {
    stopThinkingAnimation();
    stopContextMenuThinkingAnimation();
    await setStatusIcon(finalIconState);
    scheduleIconReset();
  }
}

async function ensureContextMenu() {
  menuAvailable = false;
  const settings = await loadSettings();
  const locale = resolveUiLocale(settings.answerLanguage || "auto", "");
  lastUiLocale = locale;
  const menuTitle = t("menu.selection", {}, locale);

  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;

    chrome.contextMenus.create({
      id: MENU_ID,
      title: menuTitle,
      contexts: ["selection"]
    }, () => {
      if (chrome.runtime.lastError) {
        menuAvailable = false;
        return;
      }

      menuAvailable = true;
    });
  });
}

function startThinkingAnimation() {
  stopThinkingAnimation();
  clearIconResetTimer();
  spinnerFrame = 0;
  void setStatusIcon("thinking", spinnerFrame);
  spinnerIntervalId = setInterval(() => {
    spinnerFrame = (spinnerFrame + 1) % 24;
    void setStatusIcon("thinking", spinnerFrame);
  }, 85);
}

function stopThinkingAnimation() {
  if (spinnerIntervalId !== null) {
    clearInterval(spinnerIntervalId);
    spinnerIntervalId = null;
  }
}

function startContextMenuThinkingAnimation() {
  if (!menuAvailable) {
    void ensureContextMenu();
  }
}

function stopContextMenuThinkingAnimation() {
  if (!menuAvailable) {
    void ensureContextMenu();
  }
}

function scheduleIconReset(delayMs = ICON_RESET_DELAY_MS) {
  clearIconResetTimer();
  iconResetTimeoutId = setTimeout(() => {
    void setStatusIcon("idle");
    iconResetTimeoutId = null;
  }, delayMs);
}

function clearIconResetTimer() {
  if (iconResetTimeoutId !== null) {
    clearTimeout(iconResetTimeoutId);
    iconResetTimeoutId = null;
  }
}

async function setStatusIcon(state, frame = 0) {
  try {
    const imageData = {
      16: drawIcon(16, state, frame),
      32: drawIcon(32, state, frame)
    };

    await chrome.action.setIcon({ imageData });

    if (state !== currentIconState) {
      currentIconState = state;
      await updateActionBadge(state);
      await updateActionTitle(state);
    }
  } catch {
    // Ignore icon failures in unsupported environments.
  }
}

async function updateActionBadge(state) {
  if (state === "thinking") {
    await chrome.action.setBadgeBackgroundColor({ color: "#0891b2" });
    await chrome.action.setBadgeText({ text: "..." });
    return;
  }

  if (state === "success") {
    await chrome.action.setBadgeBackgroundColor({ color: "#15803d" });
    await chrome.action.setBadgeText({ text: "OK" });
    return;
  }

  if (state === "error") {
    await chrome.action.setBadgeBackgroundColor({ color: "#b91c1c" });
    await chrome.action.setBadgeText({ text: "!" });
    return;
  }

  await chrome.action.setBadgeText({ text: "" });
}

async function updateActionTitle(state) {
  if (state === "thinking") {
    await chrome.action.setTitle({ title: t("action.thinking", {}, lastUiLocale) });
    return;
  }

  if (state === "success") {
    await chrome.action.setTitle({ title: t("action.success", {}, lastUiLocale) });
    return;
  }

  if (state === "error") {
    await chrome.action.setTitle({ title: t("action.error", {}, lastUiLocale) });
    return;
  }

  await chrome.action.setTitle({ title: t("action.idle", {}, lastUiLocale) });
}

function drawIcon(size, state, frame) {
  const palette = ICON_PALETTE[state] || ICON_PALETTE.idle;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }

  const inset = size * 0.08;
  const radius = size * 0.24;
  const center = size / 2;

  ctx.clearRect(0, 0, size, size);

  const bodyGradient = ctx.createLinearGradient(0, inset, 0, size - inset);
  bodyGradient.addColorStop(0, palette.panelTop);
  bodyGradient.addColorStop(1, palette.panelBottom);

  drawRoundedRect(ctx, inset, inset, size - inset * 2, size - inset * 2, radius);
  ctx.fillStyle = bodyGradient;
  ctx.fill();
  ctx.lineWidth = Math.max(1, size * 0.05);
  ctx.strokeStyle = withAlpha("#ffffff", 0.24);
  ctx.stroke();

  const plateRadius = size * 0.35;
  ctx.beginPath();
  ctx.arc(center, center, plateRadius, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha("#111827", 0.22);
  ctx.fill();
  ctx.lineWidth = Math.max(1, size * 0.055);
  ctx.strokeStyle = withAlpha(palette.ring, 0.8);
  ctx.stroke();

  if (state === "error") {
    drawCrossMark(ctx, size, palette.accent);
  } else {
    drawCheckMark(ctx, size, palette.accent, state === "thinking" ? 0.6 : 1);
  }

  if (state === "success") {
    ctx.save();
    ctx.lineWidth = Math.max(1, size * 0.065);
    ctx.strokeStyle = withAlpha(palette.accent, 0.42);
    ctx.beginPath();
    ctx.arc(center, center, size * 0.425, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (state === "thinking") {
    drawSpinnerArc(ctx, size, palette.accent, frame);
  }

  return ctx.getImageData(0, 0, size, size);
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawCheckMark(ctx, size, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.14;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(size * 0.29, size * 0.53);
  ctx.lineTo(size * 0.45, size * 0.68);
  ctx.lineTo(size * 0.73, size * 0.36);
  ctx.stroke();
  ctx.restore();
}

function drawCrossMark(ctx, size, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.14;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(size * 0.32, size * 0.32);
  ctx.lineTo(size * 0.68, size * 0.68);
  ctx.moveTo(size * 0.68, size * 0.32);
  ctx.lineTo(size * 0.32, size * 0.68);
  ctx.stroke();
  ctx.restore();
}

function drawSpinnerArc(ctx, size, color, frame) {
  const center = size / 2;
  const radius = size * 0.42;
  const start = ((frame % 24) / 24) * Math.PI * 2;
  const end = start + Math.PI * 1.12;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.09;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(center, center, radius, start, end);
  ctx.stroke();
  ctx.restore();
}

function withAlpha(hex, alpha) {
  const safeHex = (hex || "").trim();
  const normalized = safeHex.startsWith("#") ? safeHex.slice(1) : safeHex;

  if (normalized.length !== 6) {
    return `rgba(255, 255, 255, ${Math.min(1, Math.max(0, alpha))})`;
  }

  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const clampedAlpha = Math.min(1, Math.max(0, alpha));

  return `rgba(${r}, ${g}, ${b}, ${clampedAlpha})`;
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored[SETTINGS_KEY] || {})
  };
}

function validateSettings(settings, locale = lastUiLocale) {
  if (!settings.backendBaseUrl || !settings.backendBaseUrl.trim()) {
    throw new Error(t("err.setBackendUrl", {}, locale));
  }

  const provider = (settings.provider || "").trim();

  if (provider === "azure_openai" && !settings.apiKey.trim()) {
    throw new Error(t("err.setApiKey", {}, locale));
  }

  if (provider === "azure_openai" && !settings.endpoint.trim()) {
    throw new Error(t("err.setAzureEndpoint", {}, locale));
  }

  if (provider === "custom" && !settings.endpoint.trim()) {
    throw new Error(t("err.setCustomEndpoint", {}, locale));
  }
}

function buildFactCheckRequest(selectedText, tab, settings, contextOverride = null) {
  const locale = contextOverride?.locale || chrome.i18n.getUILanguage();
  const resolvedAnswerLanguage = resolveUiLocale(settings.answerLanguage || "auto", locale);
  const pageTitle = contextOverride?.pageTitle || tab?.title || "";
  const pageUrl = settings.sendPageUrl
    ? contextOverride?.pageUrl || tab?.url || ""
    : "";
  const selectedLinks = Array.isArray(contextOverride?.selectedLinks)
    ? contextOverride.selectedLinks
      .map((value) => String(value || "").trim())
      .filter(Boolean)
    : [];

  return {
    selectedText,
    selectedLinks,
    pageUrl,
    pageTitle,
    locale,
    userPreferences: {
      provider: settings.provider,
      endpoint: settings.endpoint || "",
      model: settings.model,
      apiKeyPresent: Boolean(settings.apiKey && settings.apiKey.trim()),
      strictness: settings.strictness,
      answerLanguage: resolvedAnswerLanguage,
      maxSources: Number(settings.maxSources || 5),
      trustedDomains: parseDomainList(settings.trustedDomains),
      blockedDomains: parseDomainList(settings.blockedDomains)
    }
  };
}

async function callBackend(requestBody, settings) {
  const apiUrl = `${settings.backendBaseUrl.replace(/\/$/, "")}/api/fact-check/selection`;
  const headers = {
    "Content-Type": "application/json"
  };

  const hasApiKey = Boolean(settings.apiKey?.trim());

  if (hasApiKey) {
    headers["X-Llm-Api-Key"] = settings.apiKey.trim();
  } else if ((settings.provider || "").trim() === "openai") {
    headers["X-Trial-Id"] = await getOrCreateTrialClientId();
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody)
  });

  const responseText = await response.text();

  if (!response.ok) {
    const detail = extractBackendErrorMessage(responseText);
    throw new Error(`Backend error ${response.status}: ${detail}`);
  }

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(t("err.backendNonJson", {}, lastUiLocale));
  }
}

async function saveResultState({ result, error, input }) {
  await chrome.storage.local.set({
    [RESULT_KEY]: result,
    [ERROR_KEY]: error,
    [INPUT_KEY]: input,
    [TIMESTAMP_KEY]: new Date().toISOString()
  });
}

async function showPopoverOrFallback(tabId, payload, options = {}) {
  const fallbackToDetails = options.fallbackToDetails ?? false;

  if (!tabId) {
    if (fallbackToDetails) {
      await openResultDetailsTab();
    }

    return;
  }

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: POPOVER_MESSAGE,
      payload
    });
  } catch {
    if (fallbackToDetails) {
      await openResultDetailsTab();
    }
  }
}

async function getSelectionContextFromTab(tabId) {
  if (!tabId) {
    return null;
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: GET_SELECTION_CONTEXT_MESSAGE
    });

    if (!response || typeof response !== "object") {
      return null;
    }

    return {
      pageUrl: typeof response.pageUrl === "string" ? response.pageUrl : "",
      pageTitle: typeof response.pageTitle === "string" ? response.pageTitle : "",
      locale: typeof response.locale === "string" ? response.locale : "",
      selectedLinks: Array.isArray(response.selectedLinks) ? response.selectedLinks : []
    };
  } catch {
    return null;
  }
}

function openResultDetailsTab() {
  return chrome.tabs.create({ url: chrome.runtime.getURL("result.html") });
}

function buildPopoverSummary(result, localeHint = "", options = {}) {
  const includeProbabilityLine = options.includeProbabilityLine ?? true;
  const locale = resolveUiLocale(localeHint || result?.meta?.locale || "auto");
  const uiText = getPopoverUiText(locale);
  const sentences = [];
  const overallTruthProbability = getOverallTruthProbability(result);
  const falseProbability = 1 - overallTruthProbability;
  const claims = Array.isArray(result?.claims) ? result.claims : [];
  const primaryClaim = claims[0];
  const checkedSources = Array.isArray(result?.meta?.checkedSources) ? result.meta.checkedSources : [];

  if (includeProbabilityLine) {
    sentences.push(ensureSentence(
      uiText.probabilityLine(
        Math.round(overallTruthProbability * 100),
        Math.round(falseProbability * 100)
      )
    ));
  }

  if (primaryClaim) {
    const verdict = (primaryClaim.verdict || "UNCLEAR").toUpperCase();
    const confidence = Math.round(clamp01(Number(primaryClaim.confidence || 0)) * 100);
    const reason = firstSentenceOrEmpty(primaryClaim.shortExplanation);
    const compactReason = truncateAtWord(reason, 120);
    let primaryLine = uiText.primaryClaimLine(verdict, confidence);

    if (compactReason) {
      primaryLine = `${primaryLine} ${compactReason}`;
    }

    sentences.push(ensureSentence(primaryLine));
  }

  if (checkedSources.length > 0) {
    const fetchedCount = checkedSources.filter((source) =>
      (source?.retrievalStatus || "").toLowerCase().startsWith("fetched")
    ).length;
    const failedCount = checkedSources.length - fetchedCount;

    sentences.push(ensureSentence(uiText.sourcesLine(fetchedCount, failedCount)));
  } else if (sentences.length < 3) {
    sentences.push(ensureSentence(uiText.noSourcesLine));
  }

  if (sentences.length < 2) {
    sentences.push(ensureSentence(uiText.openDetailsLine));
  }

  return sentences
    .filter((sentence) => sentence && sentence.trim().length > 0)
    .slice(0, 3)
    .join(" ");
}

function getPopoverUiText(locale) {
  const resolvedLocale = resolveUiLocale(locale, locale);

  return {
    thinkingTitle: t("fact.thinkingTitle", {}, resolvedLocale),
    thinkingSummary: t("fact.thinkingSummary", {}, resolvedLocale),
    summaryTitle: t("fact.summaryTitle", {}, resolvedLocale),
    failedTitle: t("fact.failedTitle", {}, resolvedLocale),
    readMore: t("ui.readMore", {}, resolvedLocale),
    spinnerInProgress: t("fact.spinnerInProgress", {}, resolvedLocale),
    probabilityLine: (truePct, falsePct) =>
      t("fact.probabilityLine", { truePct, falsePct }, resolvedLocale),
    primaryClaimLine: (verdict, confidence) =>
      t("fact.primaryClaimLine", { verdict: translateVerdict(verdict, resolvedLocale), confidence }, resolvedLocale),
    sourcesLine: (fetchedCount, failedCount) =>
      failedCount > 0
        ? t("fact.sourcesLineWithFailed", { fetchedCount, failedCount }, resolvedLocale)
        : t("fact.sourcesLineFetchedOnly", { fetchedCount }, resolvedLocale),
    noSourcesLine: t("fact.noSourcesLine", {}, resolvedLocale),
    openDetailsLine: t("fact.openDetailsLine", {}, resolvedLocale)
  };
}

function translateVerdict(verdict, locale = lastUiLocale) {
  return t(`verdict.${(verdict || "UNCLEAR").toUpperCase()}`, {}, locale);
}

function firstSentenceOrEmpty(text) {
  const sentence = splitSentences(text || "")[0];
  return sentence || "";
}

function truncateAtWord(text, maxLength) {
  const compact = (text || "").replace(/\s+/g, " ").trim();

  if (compact.length <= maxLength) {
    return compact;
  }

  const sliced = compact.slice(0, maxLength);
  const lastSpace = sliced.lastIndexOf(" ");

  if (lastSpace < 40) {
    return `${sliced.trimEnd()}...`;
  }

  return `${sliced.slice(0, lastSpace).trimEnd()}...`;
}

function getOverallTruthProbability(result) {
  const direct = toProbability(result?.overallAssessment?.truthProbability);

  if (direct !== null) {
    return direct;
  }

  const claims = Array.isArray(result?.claims) ? result.claims : [];

  if (!claims.length) {
    return 0.5;
  }

  const probabilities = claims.map((claim) => {
    const provided = toProbability(claim?.truthProbability);

    if (provided !== null) {
      return provided;
    }

    const confidence = clamp01(Number(claim?.confidence || 0));
    const verdict = (claim?.verdict || "UNCLEAR").toUpperCase();

    if (verdict === "SUPPORTED") {
      return confidence;
    }

    if (verdict === "DISPUTED" || verdict === "MISLEADING") {
      return clamp01(1 - confidence);
    }

    return 0.5;
  });

  const total = probabilities.reduce((sum, value) => sum + value, 0);

  return clamp01(total / probabilities.length);
}

function toProbability(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  return clamp01(numeric);
}

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0.5;
  }

  return Math.min(1, Math.max(0, value));
}

function shouldShowSettingsAction(message) {
  if (!message) {
    return false;
  }

  const lower = message.toLowerCase();

  return ["api key", "backend", "endpoint", "options", "provider"].some((hint) => lower.includes(hint));
}

function resolveUiLocale(answerLanguagePreference = "auto", pageLocale = "") {
  return I18N.resolveLocale(answerLanguagePreference, {
    pageLocale,
    browserLocale: chrome.i18n.getUILanguage()
  });
}

function t(key, values = {}, locale = lastUiLocale) {
  return I18N.t(locale, key, values);
}

function splitSentences(text) {
  return (text || "")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function ensureSentence(text) {
  const trimmed = (text || "").trim();

  if (!trimmed) {
    return "";
  }

  if (/[.!?]$/.test(trimmed)) {
    return trimmed;
  }

  return `${trimmed}.`;
}

function parseDomainList(rawValue) {
  return (rawValue || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function getOrCreateTrialClientId() {
  const stored = await chrome.storage.local.get(TRIAL_CLIENT_ID_KEY);
  const existing = stored[TRIAL_CLIENT_ID_KEY];

  if (typeof existing === "string" && existing.trim().length > 0) {
    return existing.trim();
  }

  const generated = crypto.randomUUID();
  await chrome.storage.local.set({
    [TRIAL_CLIENT_ID_KEY]: generated
  });

  return generated;
}

function extractBackendErrorMessage(responseText) {
  const fallback = trimText(responseText, 240);

  try {
    const parsed = JSON.parse(responseText);

    if (typeof parsed?.detail === "string" && parsed.detail.trim()) {
      return trimText(parsed.detail.trim(), 240);
    }

    if (typeof parsed?.title === "string" && parsed.title.trim()) {
      return trimText(parsed.title.trim(), 240);
    }

    if (parsed?.errors && typeof parsed.errors === "object") {
      const firstKey = Object.keys(parsed.errors)[0];

      if (firstKey) {
        const firstValue = parsed.errors[firstKey];

        if (Array.isArray(firstValue) && firstValue[0]) {
          return trimText(String(firstValue[0]), 240);
        }
      }
    }

    return fallback;
  } catch {
    return fallback;
  }
}

function trimText(text, maxLength) {
  const cleanText = (text || "").replace(/\s+/g, " ").trim();

  if (cleanText.length <= maxLength) {
    return cleanText;
  }

  return `${cleanText.slice(0, maxLength).trimEnd()}...`;
}
