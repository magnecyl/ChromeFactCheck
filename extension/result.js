const RESULT_KEY = "lastFactCheckResult";
const ERROR_KEY = "lastFactCheckError";
const INPUT_KEY = "lastFactCheckInput";
const TIMESTAMP_KEY = "lastFactCheckAt";
const MIN_LOADING_MS = 900;

const loadingPanel = document.getElementById("loading-panel");
const timestampElement = document.getElementById("timestamp");
const errorPanel = document.getElementById("error-panel");
const errorText = document.getElementById("error-text");
const inputPanel = document.getElementById("input-panel");
const selectedTextElement = document.getElementById("selected-text");
const summaryPanel = document.getElementById("summary-panel");
const overallProbabilityElement = document.getElementById("overall-probability");
const summaryElement = document.getElementById("summary");
const keyRisksElement = document.getElementById("key-risks");
const checkNextElement = document.getElementById("check-next");
const sourcesPanel = document.getElementById("sources-panel");
const checkedSourcesElement = document.getElementById("checked-sources");
const claimsPanel = document.getElementById("claims-panel");
const claimsListElement = document.getElementById("claims-list");
const emptyPanel = document.getElementById("empty-panel");
const openOptionsButton = document.getElementById("open-options");

openOptionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

initialize().catch((error) => {
  showError(error instanceof Error ? error.message : "Failed to load result.");
});

async function initialize() {
  const loadingStart = Date.now();
  const state = await chrome.storage.local.get([RESULT_KEY, ERROR_KEY, INPUT_KEY, TIMESTAMP_KEY]);
  const result = state[RESULT_KEY];
  const error = state[ERROR_KEY];
  const input = state[INPUT_KEY];
  const timestamp = state[TIMESTAMP_KEY];

  timestampElement.textContent = timestamp
    ? `Updated ${new Date(timestamp).toLocaleString()}`
    : "No runs yet";

  if (input?.selectedText) {
    selectedTextElement.textContent = input.selectedText;
    inputPanel.classList.remove("hidden");
  }

  if (error) {
    showError(error);
    await ensureMinimumLoading(loadingStart);
    hideLoading();
    return;
  }

  if (!result) {
    emptyPanel.classList.remove("hidden");
    await ensureMinimumLoading(loadingStart);
    hideLoading();
    return;
  }

  await ensureMinimumLoading(loadingStart);
  renderSummary(result.overallAssessment || {}, result.claims || []);
  renderCheckedSources(result.meta?.checkedSources || []);
  await renderClaims(result.claims || []);
  hideLoading();
}

function showError(message) {
  hideLoading();
  errorText.textContent = message;
  errorPanel.classList.remove("hidden");
}

function renderSummary(assessment, claims) {
  const overallTruthProbability = toProbability(assessment.truthProbability);

  if (overallTruthProbability !== null) {
    const falseProbability = 1 - overallTruthProbability;
    overallProbabilityElement.textContent = `True: ${(overallTruthProbability * 100).toFixed(0)}% | False: ${(falseProbability * 100).toFixed(0)}%`;
  } else {
    const inferred = inferOverallTruthProbability(claims);
    overallProbabilityElement.textContent = `True: ${(inferred * 100).toFixed(0)}% | False: ${((1 - inferred) * 100).toFixed(0)}%`;
  }

  summaryElement.textContent = assessment.summary || "No summary returned.";

  renderList(keyRisksElement, assessment.keyRisks || []);
  renderList(checkNextElement, assessment.whatToCheckNext || []);
  summaryPanel.classList.remove("hidden");
}

function renderCheckedSources(sources) {
  checkedSourcesElement.replaceChildren();

  if (!sources.length) {
    const li = document.createElement("li");
    li.textContent = "No source links were included in the selected text.";
    checkedSourcesElement.appendChild(li);
    sourcesPanel.classList.remove("hidden");
    return;
  }

  for (const source of sources) {
    const li = document.createElement("li");
    li.className = "source-item";

    const link = document.createElement("a");
    link.href = source.url || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = source.title || source.url || "(untitled source)";

    const status = document.createElement("div");
    status.className = "source-status";
    status.textContent = `${source.retrievalStatus || "unknown"} - ${source.url || ""}`;

    li.append(link, status);
    checkedSourcesElement.appendChild(li);
  }

  sourcesPanel.classList.remove("hidden");
}

async function renderClaims(claims) {
  await nextAnimationFrame();
  claimsListElement.replaceChildren();

  if (!claims.length) {
    const note = document.createElement("p");
    note.textContent = "No claims returned.";
    claimsListElement.appendChild(note);
  }

  for (const claim of claims) {
    claimsListElement.appendChild(buildClaimElement(claim));
  }

  claimsPanel.classList.remove("hidden");
}

function buildClaimElement(claim) {
  const container = document.createElement("article");
  container.className = "claim";

  const header = document.createElement("div");
  header.className = "claim-header";

  const badge = document.createElement("span");
  const verdict = (claim.verdict || "UNCLEAR").toUpperCase();
  badge.className = `badge ${verdict}`;
  badge.textContent = verdict;

  const confidence = document.createElement("span");
  const confidenceValue = clamp01(Number(claim.confidence || 0));
  confidence.textContent = `Confidence: ${(confidenceValue * 100).toFixed(0)}%`;

  const truthProbabilityValue = toProbability(claim.truthProbability);
  const inferredTruthProbability =
    truthProbabilityValue !== null ? truthProbabilityValue : inferTruthProbabilityFromVerdict(verdict, confidenceValue);

  const truthProbability = document.createElement("span");
  truthProbability.textContent = `True: ${(inferredTruthProbability * 100).toFixed(0)}% | False: ${((1 - inferredTruthProbability) * 100).toFixed(0)}%`;

  header.append(badge, confidence, truthProbability);

  const claimText = document.createElement("p");
  claimText.textContent = claim.claim || "(empty claim)";

  const explanation = document.createElement("p");
  explanation.textContent = claim.shortExplanation || "No explanation returned.";

  const searchTitle = document.createElement("h3");
  searchTitle.textContent = "Search queries";

  const searchList = document.createElement("ul");
  renderList(searchList, claim.searchQueries || []);

  const evidenceTitle = document.createElement("h3");
  evidenceTitle.textContent = "Evidence needed";

  const evidenceList = document.createElement("ul");
  renderList(evidenceList, claim.evidenceNeeded || []);

  container.append(header, claimText, explanation, searchTitle, searchList, evidenceTitle, evidenceList);

  return container;
}

function renderList(target, values) {
  target.replaceChildren();

  if (!values.length) {
    const li = document.createElement("li");
    li.textContent = "None";
    target.appendChild(li);
    return;
  }

  for (const value of values) {
    const li = document.createElement("li");
    li.textContent = value;
    target.appendChild(li);
  }
}

function toProbability(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  return clamp01(numeric);
}

function inferOverallTruthProbability(claims) {
  if (!Array.isArray(claims) || !claims.length) {
    return 0.5;
  }

  const probabilities = claims
    .map((claim) => {
      const confidence = clamp01(Number(claim?.confidence || 0));
      const direct = toProbability(claim?.truthProbability);
      const verdict = (claim?.verdict || "UNCLEAR").toUpperCase();

      if (direct !== null) {
        return direct;
      }

      return inferTruthProbabilityFromVerdict(verdict, confidence);
    });

  const total = probabilities.reduce((sum, value) => sum + value, 0);

  return clamp01(total / probabilities.length);
}

function inferTruthProbabilityFromVerdict(verdict, confidence) {
  if (verdict === "SUPPORTED") {
    return confidence;
  }

  if (verdict === "DISPUTED" || verdict === "MISLEADING") {
    return clamp01(1 - confidence);
  }

  return 0.5;
}

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0.5;
  }

  return Math.min(1, Math.max(0, value));
}

function hideLoading() {
  loadingPanel.classList.add("hidden");
}

async function ensureMinimumLoading(loadingStart) {
  const elapsed = Date.now() - loadingStart;
  const remaining = MIN_LOADING_MS - elapsed;

  if (remaining > 0) {
    await delay(remaining);
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function nextAnimationFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}
