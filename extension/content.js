const HOST_ID = "chrome-fact-check-popover-host";
const AUTO_CLOSE_MS = 24000;
let activeRenderToken = 0;
const QUICK_ACTION_HOST_ID = "chrome-fact-check-quick-action-host";
const START_FACTCHECK_MESSAGE = "START_FACTCHECK_FROM_SELECTION";
const QUICK_ACTION_HIDE_MS = 12000;
const SELECTION_DEBOUNCE_MS = 140;
let selectionDebounceId = null;
let quickActionTimeoutId = null;

document.addEventListener("selectionchange", handleSelectionChange, true);
document.addEventListener("mousedown", handlePointerDown, true);
document.addEventListener("scroll", handleViewportChanged, true);
window.addEventListener("resize", handleViewportChanged, true);
window.addEventListener("blur", hideQuickActionPrompt, true);

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "SHOW_FACTCHECK_POPOVER") {
    return;
  }

  renderPopover(message.payload || {});
});

function renderPopover(payload) {
  removePopover();
  hideQuickActionPrompt();
  activeRenderToken += 1;
  const token = activeRenderToken;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.position = "fixed";
  host.style.top = "16px";
  host.style.right = "16px";
  host.style.zIndex = "2147483647";

  const shadowRoot = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
    }

    .card {
      width: min(390px, calc(100vw - 32px));
      box-sizing: border-box;
      border-radius: 12px;
      border: 1px solid #c9d4ea;
      background: #ffffff;
      box-shadow: 0 10px 28px rgba(17, 25, 38, 0.2);
      color: #1b2434;
      font-family: "Segoe UI", "Helvetica Neue", sans-serif;
      padding: 12px;
      display: grid;
      gap: 10px;
    }

    .card.success {
      border-left: 4px solid #1f8a4c;
    }

    .card.error {
      border-left: 4px solid #b53a3a;
    }

    .card.thinking {
      border-left: 4px solid #0891b2;
      background: linear-gradient(135deg, #ffffff 0%, #f0fbff 100%);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .title {
      font-weight: 600;
      font-size: 14px;
      margin: 0;
      color: #101826;
    }

    .close {
      border: 0;
      background: transparent;
      color: #586983;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      padding: 0 2px;
    }

    .summary {
      margin: 0;
      font-size: 13px;
      line-height: 1.5;
      color: #2a3850;
    }

    .thinking-row {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #0f4b62;
      font-size: 12.5px;
      font-weight: 600;
    }

    .spinner {
      width: 13px;
      height: 13px;
      border-radius: 50%;
      border: 2px solid #bfe9f3;
      border-top-color: #0891b2;
      animation: spin 0.75s linear infinite;
      box-sizing: border-box;
      flex: 0 0 auto;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    button {
      font: inherit;
      border-radius: 8px;
      border: 0;
      padding: 8px 10px;
      cursor: pointer;
    }

    .primary {
      background: #0f4ecb;
      color: #ffffff;
      font-weight: 600;
    }

    .secondary {
      background: #edf1f8;
      color: #1d2a40;
    }
  `;

  const cardTone = payload.tone === "error" || payload.tone === "thinking" ? payload.tone : "success";

  const card = document.createElement("section");
  card.className = `card ${cardTone}`;

  const header = document.createElement("div");
  header.className = "header";

  const title = document.createElement("p");
  title.className = "title";
  title.textContent = payload.title || "Fact-check summary";

  const close = document.createElement("button");
  close.className = "close";
  close.type = "button";
  close.setAttribute("aria-label", "Close fact-check summary");
  close.textContent = "x";
  close.addEventListener("click", removePopover);

  header.append(title, close);

  const summary = document.createElement("p");
  summary.className = "summary";
  summary.textContent = payload.summary || "No summary available.";

  card.append(header, summary);

  if (payload.showSpinner) {
    const thinkingRow = document.createElement("div");
    thinkingRow.className = "thinking-row";

    const spinner = document.createElement("span");
    spinner.className = "spinner";

    const label = document.createElement("span");
    label.textContent = payload.spinnerLabel || "Fact-check in progress";

    thinkingRow.append(spinner, label);
    card.append(thinkingRow);
  }

  const actions = document.createElement("div");
  actions.className = "actions";

  if (!payload.hideReadMore) {
    const readMoreButton = document.createElement("button");
    readMoreButton.className = "primary";
    readMoreButton.type = "button";
    readMoreButton.textContent = payload.ctaLabel || "Read more...";
    readMoreButton.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "OPEN_FACTCHECK_DETAILS" });
      removePopover();
    });

    actions.appendChild(readMoreButton);
  }

  if (payload.showSettingsAction) {
    const settingsButton = document.createElement("button");
    settingsButton.className = "secondary";
    settingsButton.type = "button";
    settingsButton.textContent = "Settings";
    settingsButton.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "OPEN_FACTCHECK_OPTIONS" });
      removePopover();
    });

    actions.appendChild(settingsButton);
  }

  if (actions.childElementCount > 0) {
    card.append(actions);
  }

  shadowRoot.append(style, card);

  document.documentElement.appendChild(host);

  if (!payload.persist) {
    window.setTimeout(() => {
      if (token === activeRenderToken && document.getElementById(HOST_ID)) {
        removePopover();
      }
    }, AUTO_CLOSE_MS);
  }
}

function handleSelectionChange() {
  if (selectionDebounceId !== null) {
    clearTimeout(selectionDebounceId);
  }

  selectionDebounceId = window.setTimeout(() => {
    selectionDebounceId = null;
    showQuickActionPromptForSelection();
  }, SELECTION_DEBOUNCE_MS);
}

function handlePointerDown(event) {
  const promptHost = document.getElementById(QUICK_ACTION_HOST_ID);

  if (!promptHost) {
    return;
  }

  if (event.target === promptHost || promptHost.contains(event.target)) {
    return;
  }

  window.setTimeout(() => {
    const selectedText = getSelectedText();

    if (!selectedText) {
      hideQuickActionPrompt();
    }
  }, 0);
}

function handleViewportChanged() {
  if (document.getElementById(QUICK_ACTION_HOST_ID)) {
    hideQuickActionPrompt();
  }
}

function showQuickActionPromptForSelection() {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    hideQuickActionPrompt();
    return;
  }

  const selectedText = getSelectedText();

  if (!selectedText) {
    hideQuickActionPrompt();
    return;
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  if ((rect.width <= 0 && rect.height <= 0) || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)) {
    hideQuickActionPrompt();
    return;
  }

  renderQuickActionPrompt({
    selectedText,
    rect
  });
}

function renderQuickActionPrompt({ selectedText, rect }) {
  hideQuickActionPrompt();

  const host = document.createElement("div");
  host.id = QUICK_ACTION_HOST_ID;
  host.style.position = "fixed";
  host.style.zIndex = "2147483646";

  const maxWidth = Math.min(280, Math.max(220, Math.floor(window.innerWidth * 0.7)));
  const promptHeight = 78;
  let top = rect.top - promptHeight - 10;

  if (top < 8) {
    top = rect.bottom + 10;
  }

  if (top > window.innerHeight - promptHeight - 8) {
    top = Math.max(8, window.innerHeight - promptHeight - 8);
  }

  let left = rect.left + rect.width / 2 - maxWidth / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - maxWidth - 8));

  host.style.top = `${Math.round(top)}px`;
  host.style.left = `${Math.round(left)}px`;
  host.style.width = `${Math.round(maxWidth)}px`;

  const shadowRoot = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
    }

    .prompt {
      box-sizing: border-box;
      border-radius: 10px;
      border: 1px solid #c7d5ec;
      background: linear-gradient(135deg, #ffffff 0%, #f5f9ff 100%);
      box-shadow: 0 10px 22px rgba(17, 25, 38, 0.18);
      font-family: "Segoe UI", "Helvetica Neue", sans-serif;
      color: #1b2434;
      padding: 10px 10px 8px;
      display: grid;
      gap: 8px;
    }

    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .title {
      margin: 0;
      font-size: 12.5px;
      font-weight: 600;
      color: #0f2038;
      line-height: 1.3;
    }

    .button {
      border: 0;
      border-radius: 8px;
      background: #0f4ecb;
      color: #ffffff;
      font-size: 12.5px;
      font-weight: 600;
      padding: 7px 10px;
      cursor: pointer;
      white-space: nowrap;
    }

    .button:hover {
      background: #0d43ae;
    }

    .button:disabled {
      background: #7797da;
      cursor: wait;
    }

    .close {
      border: 0;
      background: transparent;
      color: #607491;
      cursor: pointer;
      font-size: 13px;
      padding: 0;
      line-height: 1;
    }
  `;

  const prompt = document.createElement("div");
  prompt.className = "prompt";

  const topRow = document.createElement("div");
  topRow.className = "row";

  const title = document.createElement("p");
  title.className = "title";
  title.textContent = "Fact-check this selection?";

  const close = document.createElement("button");
  close.className = "close";
  close.type = "button";
  close.textContent = "x";
  close.setAttribute("aria-label", "Close fact-check prompt");
  close.addEventListener("click", hideQuickActionPrompt);

  topRow.append(title, close);

  const actionRow = document.createElement("div");
  actionRow.className = "row";

  const action = document.createElement("button");
  action.className = "button";
  action.type = "button";
  action.textContent = "Fact-check";
  action.addEventListener("click", () => {
    action.disabled = true;
    action.textContent = "Starting...";

    chrome.runtime.sendMessage({
      type: START_FACTCHECK_MESSAGE,
      selectedText,
      pageUrl: window.location.href,
      pageTitle: document.title,
      locale: document.documentElement.lang || navigator.language || "en-US"
    });

    hideQuickActionPrompt();
  });

  actionRow.append(action);

  prompt.append(topRow, actionRow);
  shadowRoot.append(style, prompt);
  document.documentElement.appendChild(host);

  if (quickActionTimeoutId !== null) {
    clearTimeout(quickActionTimeoutId);
  }

  quickActionTimeoutId = window.setTimeout(() => {
    hideQuickActionPrompt();
  }, QUICK_ACTION_HIDE_MS);
}

function hideQuickActionPrompt() {
  if (quickActionTimeoutId !== null) {
    clearTimeout(quickActionTimeoutId);
    quickActionTimeoutId = null;
  }

  const promptHost = document.getElementById(QUICK_ACTION_HOST_ID);

  if (promptHost) {
    promptHost.remove();
  }
}

function getSelectedText() {
  const selection = window.getSelection();

  if (!selection) {
    return "";
  }

  return selection.toString().replace(/\s+/g, " ").trim();
}

function removePopover() {
  const existing = document.getElementById(HOST_ID);

  if (existing) {
    existing.remove();
  }
}
