const MENU_ID = "chrome-fact-check.selection";
const MENU_DEFAULT_TITLE = "Fact-check selected text";
const SETTINGS_KEY = "settings";
const RESULT_KEY = "lastFactCheckResult";
const ERROR_KEY = "lastFactCheckError";
const INPUT_KEY = "lastFactCheckInput";
const TIMESTAMP_KEY = "lastFactCheckAt";

const POPOVER_MESSAGE = "SHOW_FACTCHECK_POPOVER";
const OPEN_DETAILS_MESSAGE = "OPEN_FACTCHECK_DETAILS";
const OPEN_OPTIONS_MESSAGE = "OPEN_FACTCHECK_OPTIONS";
const START_FACTCHECK_MESSAGE = "START_FACTCHECK_FROM_SELECTION";
const ICON_RESET_DELAY_MS = 4500;

const ICON_PALETTE = {
  idle: {
    base: "#1e293b",
    accent: "#60a5fa",
    ring: "#334155",
    mark: "#f8fafc"
  },
  thinking: {
    base: "#0f172a",
    accent: "#22d3ee",
    ring: "#155e75",
    mark: "#ecfeff"
  },
  success: {
    base: "#14532d",
    accent: "#4ade80",
    ring: "#166534",
    mark: "#f0fdf4"
  },
  error: {
    base: "#7f1d1d",
    accent: "#f87171",
    ring: "#991b1b",
    mark: "#fef2f2"
  }
};

let spinnerIntervalId = null;
let spinnerFrame = 0;
let iconResetTimeoutId = null;
let currentIconState = "idle";
let menuAvailable = false;

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

void setStatusIcon("idle");
ensureContextMenu();

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenu();
  void setStatusIcon("idle");
});

chrome.runtime.onStartup.addListener(() => {
  ensureContextMenu();
  void setStatusIcon("idle");
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
      locale: typeof message.locale === "string" ? message.locale : ""
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

  void runFactCheckFlow({
    selectedText: (info.selectionText || "").trim(),
    tab
  });
});

async function runFactCheckFlow({ selectedText, tab, contextOverride = null }) {
  if (!selectedText) {
    const message = "No text was selected. Highlight text and try again.";
    await saveResultState({ result: null, error: message, input: null });
    await setStatusIcon("error");
    scheduleIconReset();
    await showPopoverOrFallback(tab?.id, {
      tone: "error",
      title: "Fact-check failed",
      summary: message,
      ctaLabel: "Read more..."
    });
    return;
  }

  let requestBody;
  let finalIconState = "success";
  const initialLocale = contextOverride?.locale || chrome.i18n.getUILanguage();
  const initialUiText = getPopoverUiText(initialLocale);
  startThinkingAnimation();
  startContextMenuThinkingAnimation();
  await showPopoverOrFallback(
    tab?.id,
    {
      tone: "thinking",
      title: initialUiText.thinkingTitle,
      summary: initialUiText.thinkingSummary,
      showSpinner: true,
      hideReadMore: true,
      persist: true
    },
    {
      fallbackToDetails: false
    }
  );

  try {
    const settings = await loadSettings();
    validateSettings(settings);

    requestBody = buildFactCheckRequest(selectedText, tab, settings, contextOverride);
    const response = await callBackend(requestBody, settings);
    const uiText = getPopoverUiText(response?.meta?.locale || initialLocale);

    await saveResultState({ result: response, error: "", input: requestBody });

    await showPopoverOrFallback(tab?.id, {
      tone: "success",
      title: uiText.summaryTitle,
      summary: buildPopoverSummary(response),
      ctaLabel: uiText.readMore
    });
  } catch (error) {
    finalIconState = "error";
    const message = error instanceof Error ? error.message : "Unknown error";
    const uiText = getPopoverUiText(initialLocale);

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
      showSettingsAction: shouldShowSettingsAction(message)
    });
  } finally {
    stopThinkingAnimation();
    stopContextMenuThinkingAnimation();
    await setStatusIcon(finalIconState);
    scheduleIconReset();
  }
}

function ensureContextMenu() {
  menuAvailable = false;

  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;

    chrome.contextMenus.create({
      id: MENU_ID,
      title: MENU_DEFAULT_TITLE,
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
    ensureContextMenu();
  }
}

function stopContextMenuThinkingAnimation() {
  if (!menuAvailable) {
    ensureContextMenu();
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
    await chrome.action.setTitle({ title: "Chrome Fact Check: thinking..." });
    return;
  }

  if (state === "success") {
    await chrome.action.setTitle({ title: "Chrome Fact Check: latest check completed" });
    return;
  }

  if (state === "error") {
    await chrome.action.setTitle({ title: "Chrome Fact Check: latest check failed" });
    return;
  }

  await chrome.action.setTitle({ title: "Chrome Fact Check" });
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

  ctx.clearRect(0, 0, size, size);
  drawRoundedRect(ctx, inset, inset, size - inset * 2, size - inset * 2, radius);
  ctx.fillStyle = palette.base;
  ctx.fill();
  ctx.lineWidth = Math.max(1, size * 0.05);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.stroke();

  const glowRadius = size * 0.31;
  const gradient = ctx.createRadialGradient(size * 0.72, size * 0.32, 0, size * 0.5, size * 0.5, glowRadius * 1.8);
  gradient.addColorStop(0, `${palette.accent}cc`);
  gradient.addColorStop(1, `${palette.ring}00`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.5, glowRadius * 1.35, 0, Math.PI * 2);
  ctx.fill();

  if (state === "error") {
    drawCrossMark(ctx, size, palette.mark);
  } else {
    drawCheckMark(ctx, size, palette.mark, state === "thinking" ? 0.5 : 1);
  }

  if (state === "thinking") {
    drawSpinnerArc(ctx, size, palette.mark, frame);
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
  const radius = size * 0.36;
  const start = ((frame % 24) / 24) * Math.PI * 2;
  const end = start + Math.PI * 1.28;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.12;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(center, center, radius, start, end);
  ctx.stroke();
  ctx.restore();
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored[SETTINGS_KEY] || {})
  };
}

function validateSettings(settings) {
  if (!settings.backendBaseUrl || !settings.backendBaseUrl.trim()) {
    throw new Error("Set Backend URL in extension options.");
  }

  const provider = (settings.provider || "").trim();

  if (["openai", "azure_openai"].includes(provider) && !settings.apiKey.trim()) {
    throw new Error("Set API key in extension options for this provider.");
  }

  if (provider === "azure_openai" && !settings.endpoint.trim()) {
    throw new Error("Set Azure endpoint in extension options.");
  }

  if (provider === "custom" && !settings.endpoint.trim()) {
    throw new Error("Set custom endpoint in extension options.");
  }
}

function buildFactCheckRequest(selectedText, tab, settings, contextOverride = null) {
  const locale = contextOverride?.locale || chrome.i18n.getUILanguage();
  const pageTitle = contextOverride?.pageTitle || tab?.title || "";
  const pageUrl = settings.sendPageUrl
    ? contextOverride?.pageUrl || tab?.url || ""
    : "";

  return {
    selectedText,
    pageUrl,
    pageTitle,
    locale,
    userPreferences: {
      provider: settings.provider,
      endpoint: settings.endpoint || "",
      model: settings.model,
      apiKeyPresent: Boolean(settings.apiKey && settings.apiKey.trim()),
      strictness: settings.strictness,
      answerLanguage: settings.answerLanguage || "auto",
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

  if (settings.apiKey?.trim()) {
    headers["X-Llm-Api-Key"] = settings.apiKey.trim();
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody)
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Backend error ${response.status}: ${trimText(responseText, 240)}`);
  }

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error("Backend returned non-JSON content.");
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

function openResultDetailsTab() {
  return chrome.tabs.create({ url: chrome.runtime.getURL("result.html") });
}

function buildPopoverSummary(result) {
  const locale = result?.meta?.locale || chrome.i18n.getUILanguage();
  const uiText = getPopoverUiText(locale);
  const sentences = [];
  const overallTruthProbability = getOverallTruthProbability(result);
  const falseProbability = 1 - overallTruthProbability;
  const claims = Array.isArray(result?.claims) ? result.claims : [];
  const primaryClaim = claims[0];
  const checkedSources = Array.isArray(result?.meta?.checkedSources) ? result.meta.checkedSources : [];

  sentences.push(ensureSentence(
    uiText.probabilityLine(
      Math.round(overallTruthProbability * 100),
      Math.round(falseProbability * 100)
    )
  ));

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
  void locale;

  return {
    thinkingTitle: "Fact-checking...",
    thinkingSummary: "Checking the selected text and linked sources now. This can take a few seconds.",
    summaryTitle: "Fact-check summary",
    failedTitle: "Fact-check failed",
    readMore: "Read more...",
    probabilityLine: (truePct, falsePct) => `Estimated probability: true ${truePct}% and false ${falsePct}%`,
    primaryClaimLine: (verdict, confidence) => `Primary claim: ${translateVerdict(verdict)} (${confidence}%)`,
    sourcesLine: (fetchedCount, failedCount) =>
      failedCount > 0
        ? `Checked sources: ${fetchedCount} fetched, ${failedCount} failed`
        : `Checked sources: ${fetchedCount} fetched`,
    noSourcesLine: "No links were included in the selected text",
    openDetailsLine: "Open Read more for claim-by-claim detail"
  };
}

function translateVerdict(verdict) {
  return (verdict || "UNCLEAR").toUpperCase();
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

function trimText(text, maxLength) {
  const cleanText = (text || "").replace(/\s+/g, " ").trim();

  if (cleanText.length <= maxLength) {
    return cleanText;
  }

  return `${cleanText.slice(0, maxLength).trimEnd()}...`;
}
