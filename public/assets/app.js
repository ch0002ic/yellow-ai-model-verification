const statusIndicator = document.getElementById("ws-status");
const verificationForm = document.getElementById("verification-form");
const verificationList = document.getElementById("verification-list");
const verificationTemplate = document.getElementById("verification-card-template");
const formFeedback = document.getElementById("form-feedback");
const metricChannels = document.getElementById("metric-channels");
const metricBatches = document.getElementById("metric-batches");
const metricBalances = document.getElementById("metric-balances");
const eventLog = document.getElementById("event-log");
const channelTimelineSelect = document.getElementById("channel-timeline-select");
const channelTimelineRefresh = document.getElementById("channel-timeline-refresh");
const channelTimeline = document.getElementById("channel-timeline");

const REFRESH_INTERVAL_MS = 7500;
const MAX_EVENT_ENTRIES = 24;
const MAX_TIMELINE_ROWS = 75;
const EVENT_STREAM_RETRY_MS = 5000;

let currentTimelineChannel = "";
let eventStream = null;
let eventStreamRetryTimer = null;
let eventPollingTimer = null;

async function safeFetchJSON(url, options) {
  try {
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
      },
      ...options,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(body.error ?? `Request failed with status ${response.status}`);
    }

    setStatusIndicator("connected");
    return response.json();
  } catch (error) {
    setStatusIndicator("disconnected");
    throw error;
  }
}

function setStatusIndicator(state) {
  statusIndicator.dataset.state = state;
  statusIndicator.textContent = `WS: ${state}`;
}

function parseMetadata(input) {
  if (!input || input.trim().length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error(`Metadata must be valid JSON: ${(error).message}`);
  }
}

function showFormFeedback(message, state = "info") {
  formFeedback.textContent = message;
  formFeedback.dataset.state = state;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "n/a";
  }
  return date.toLocaleString();
}

function renderVerifications(records) {
  verificationList.replaceChildren();

  for (const record of records) {
    const node = verificationTemplate.content.firstElementChild.cloneNode(true);
    const { id, channelSnapshot, result } = record;
    const status = result?.status ?? "pending";
    node.dataset.status = status;
    node.dataset.inferenceId = id;

    node.querySelector(".card-title").textContent = `Inference ${id.slice(0, 8)}`;
    node.querySelector(".status-chip").textContent = status;

    const details = node.querySelector(".card-details");
    const session = channelSnapshot.session;
    const detailsMap = {
      "Channel ID": session.channelId,
      "Session state": session.state,
      "Model ID": session.metadata.modelId,
      "Verifier ID": session.metadata.verifierId,
      "Opened": formatDate(session.openedAt ?? new Date()),
      "SDK backed": String(session.metadata.sdkBacked ?? false),
    };

    if (result?.completedAt) {
      detailsMap["Completed"] = formatDate(result.completedAt);
    }

    if (result?.proofUrl) {
      detailsMap["Proof URL"] = result.proofUrl;
    }

    if (result?.reason) {
      detailsMap["Reason"] = result.reason;
    }

    for (const [label, value] of Object.entries(detailsMap)) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value ?? "n/a";
      details.append(dt, dd);
    }

    if (status !== "pending") {
      node.querySelector(".card-actions").remove();
    }

    verificationList.appendChild(node);
  }
}

function renderEvents(snapshot) {
  metricChannels.textContent = snapshot.channels.length;
  metricBatches.textContent = snapshot.batches.length;
  metricBalances.textContent = snapshot.balances.length;

  updateChannelOptions(snapshot.channels);

  const entries = [];

  for (const event of snapshot.channels) {
    const channelId = normaliseChannelId(event.payload, event.id);
    entries.push({
      type: "channel",
      timestamp: new Date(event.updatedAt).getTime(),
      summary: `channel ${channelId}`,
      channelId,
    });
  }

  for (const batch of snapshot.batches) {
    entries.push({
      type: "batch",
      timestamp: new Date(batch.updatedAt).getTime(),
      summary: `channels_update (${batch.payload.length})`,
    });
  }

  for (const balance of snapshot.balances) {
    entries.push({
      type: "balance",
      timestamp: new Date(balance.updatedAt).getTime(),
      summary: `balance_update (${balance.payload.length})`,
    });
  }

  entries.sort((a, b) => b.timestamp - a.timestamp);

  const limited = entries.slice(0, MAX_EVENT_ENTRIES);
  eventLog.replaceChildren();

  for (const entry of limited) {
    const div = document.createElement("div");
    div.className = "entry";
    if (entry.channelId) {
      div.dataset.channelId = entry.channelId;
    }
    const time = Number.isFinite(entry.timestamp)
      ? new Date(entry.timestamp).toLocaleTimeString()
      : "–";
    div.textContent = `[${time}] ${entry.type}: ${entry.summary}`;
    eventLog.appendChild(div);
  }
}

function updateChannelOptions(channels) {
  if (!channelTimelineSelect) {
    return;
  }

  const unique = Array.from(
    new Set(
      channels
        .map((entry) => entry?.id)
        .filter((value) => typeof value === "string" && value.trim().length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b));

  const previousValue = channelTimelineSelect.value;
  const fragment = document.createDocumentFragment();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a channel";
  fragment.appendChild(placeholder);

  for (const id of unique) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    fragment.appendChild(option);
  }

  channelTimelineSelect.replaceChildren(fragment);

  if (previousValue && unique.includes(previousValue)) {
    channelTimelineSelect.value = previousValue;
  } else {
    channelTimelineSelect.value = "";
    currentTimelineChannel = "";
    renderTimelineMessage("Choose a channel to load its event history.", "empty");
  }
}

function normaliseChannelId(payload, fallback) {
  if (typeof fallback === "string" && fallback.trim().length > 0) {
    return fallback;
  }

  if (payload && typeof payload === "object") {
    if (typeof payload.channelId === "string") {
      return payload.channelId;
    }

    if (typeof payload.channel_id === "string") {
      return payload.channel_id;
    }

    if (typeof payload.id === "string") {
      return payload.id;
    }
  }

  return "unknown";
}

function renderTimelineMessage(message, state = "empty") {
  if (!channelTimeline) {
    return;
  }

  channelTimeline.dataset.state = state;
  channelTimeline.replaceChildren();
  const div = document.createElement("div");
  div.className = "timeline-message";
  div.textContent = message;
  channelTimeline.appendChild(div);
}

function setTimelineLoading() {
  if (!channelTimeline) {
    return;
  }

  channelTimeline.dataset.state = "loading";
  channelTimeline.replaceChildren();
}

function renderChannelTimelineEntries(rows) {
  if (!channelTimeline) {
    return;
  }

  if (!rows || rows.length === 0) {
    renderTimelineMessage("No history found for this channel yet.");
    return;
  }

  channelTimeline.dataset.state = "ready";
  channelTimeline.replaceChildren();

  for (const row of rows.slice(0, MAX_TIMELINE_ROWS)) {
    const payload = row.payload;
    const entry = document.createElement("article");
    entry.className = "timeline-entry";

    const header = document.createElement("header");
    const timestamp = document.createElement("span");
    timestamp.className = "timeline-timestamp";
    timestamp.textContent = formatDate(row.occurredAt);
    header.appendChild(timestamp);

    const state = document.createElement("span");
    state.className = "timeline-state";
    state.textContent = deriveTimelineState(payload);
    header.appendChild(state);

    entry.appendChild(header);

    const dl = document.createElement("dl");
    const summary = buildTimelineSummary(row, payload);

    for (const [label, value] of summary) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      dl.append(dt, dd);
    }

    if (dl.childElementCount > 0) {
      entry.appendChild(dl);
    }

    const details = document.createElement("details");
    const summaryNode = document.createElement("summary");
    summaryNode.textContent = "Raw payload";
    details.appendChild(summaryNode);

    const pre = document.createElement("pre");
    pre.textContent = formatPayload(payload);
    details.appendChild(pre);

    entry.appendChild(details);
    channelTimeline.appendChild(entry);
  }
}

function deriveTimelineState(payload) {
  if (!payload) {
    return "unknown";
  }

  if (typeof payload === "string") {
    return "raw";
  }

  if (typeof payload.state === "string") {
    return payload.state;
  }

  if (payload.session && typeof payload.session.state === "string") {
    return payload.session.state;
  }

  return "update";
}

function buildTimelineSummary(row, payload) {
  const entries = [];
  const channelId = row.channelId ??
    (payload && typeof payload === "object" && (payload.channelId || payload.channel_id));
  if (channelId) {
    entries.push(["Channel", channelId]);
  }

  const seq = getFirstDefined(payload, ["sequence", ["session", "sequence"]]);
  if (seq !== undefined) {
    entries.push(["Sequence", String(seq)]);
  }

  const state = getFirstDefined(payload, ["state", ["session", "state"]]);
  if (state) {
    entries.push(["State", state]);
  }

  const modelId = getFirstDefined(payload, [["metadata", "modelId"], ["session", "metadata", "modelId"]]);
  if (modelId) {
    entries.push(["Model", modelId]);
  }

  const verifierId = getFirstDefined(payload, [["metadata", "verifierId"], ["session", "metadata", "verifierId"]]);
  if (verifierId) {
    entries.push(["Verifier", verifierId]);
  }

  const participants = getFirstDefined(payload, [["participants"], ["session", "participants"]]);
  if (Array.isArray(participants)) {
    entries.push(["Participants", String(participants.length)]);
  }

  const balances = getFirstDefined(payload, [["balances"], ["session", "balances"]]);
  if (Array.isArray(balances)) {
    entries.push(["Balances", String(balances.length)]);
  }

  const updatedAt = getFirstDefined(payload, [["updatedAt"], ["session", "updatedAt"], ["session", "updated_at"]]);
  if (updatedAt) {
    entries.push(["Channel Updated", formatDate(updatedAt)]);
  }

  return entries;
}

function getFirstDefined(payload, paths) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  for (const path of paths) {
    const keys = Array.isArray(path) ? path : [path];
    let value = payload;
    let found = true;

    for (const key of keys) {
      if (!value || typeof value !== "object" || !(key in value)) {
        found = false;
        break;
      }

      value = value[key];
    }

    if (found && value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
}

function formatPayload(payload) {
  if (payload === undefined || payload === null) {
    return "null";
  }

  if (typeof payload === "string") {
    return payload;
  }

  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

async function loadChannelTimeline(channelId, { force = false } = {}) {
  if (!channelTimeline) {
    return;
  }

  if (!channelId) {
    currentTimelineChannel = "";
    renderTimelineMessage("Choose a channel to load its event history.", "empty");
    return;
  }

  if (!force && channelId === currentTimelineChannel && channelTimeline.dataset.state === "ready") {
    return;
  }

  currentTimelineChannel = channelId;
  setTimelineLoading();

  try {
    const rows = await safeFetchJSON(`/api/clearnode/channels/${encodeURIComponent(channelId)}`);
    renderChannelTimelineEntries(rows);
  } catch (error) {
    console.error(error);
    channelTimeline.dataset.state = "error";
    channelTimeline.replaceChildren();
    const div = document.createElement("div");
    div.className = "timeline-message";
    div.textContent = error?.message ?? "Failed to fetch channel history";
    channelTimeline.appendChild(div);
  }
}

function handleEventStreamPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return;
  }

  const snapshot = payload.snapshot;
  if (!snapshot) {
    return;
  }

  renderEvents(snapshot);

  if (!channelTimelineSelect || !channelTimelineSelect.value) {
    return;
  }

  const selectedChannel = channelTimelineSelect.value;
  if (payload.type === "channel" && payload.channelId === selectedChannel) {
    void loadChannelTimeline(selectedChannel, { force: true });
  }
}

function startEventStream() {
  if (!window.EventSource || eventStream) {
    return;
  }

  try {
    const source = new EventSource("/api/clearnode/events/stream");
    eventStream = source;

    source.onopen = () => {
      setStatusIndicator("connected");
      stopEventPolling();
    };

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setStatusIndicator("connected");
        handleEventStreamPayload(data);
      } catch (error) {
        console.error("Failed to parse ClearNode event stream payload", error);
      }
    };

    source.onerror = () => {
      setStatusIndicator("disconnected");
      source.close();
      eventStream = null;
      ensureEventPolling();
      scheduleEventStreamRestart();
    };
  } catch (error) {
    console.error("Failed to establish ClearNode event stream", error);
    ensureEventPolling();
    scheduleEventStreamRestart();
  }
}

function ensureEventPolling() {
  if (eventPollingTimer !== null) {
    return;
  }

  eventPollingTimer = window.setInterval(() => {
    void refreshEvents().catch((error) =>
      console.error("Event refresh failed", error),
    );
  }, REFRESH_INTERVAL_MS);
}

function stopEventPolling() {
  if (eventPollingTimer === null) {
    return;
  }

  window.clearInterval(eventPollingTimer);
  eventPollingTimer = null;
}

function scheduleEventStreamRestart() {
  if (!window.EventSource) {
    return;
  }

  if (eventStreamRetryTimer !== null) {
    return;
  }

  eventStreamRetryTimer = window.setTimeout(() => {
    eventStreamRetryTimer = null;
    startEventStream();
  }, EVENT_STREAM_RETRY_MS);
}

async function refreshVerifications() {
  const records = await safeFetchJSON("/api/verifications");
  renderVerifications(records);
}

async function refreshEvents() {
  const snapshot = await safeFetchJSON("/api/clearnode/events");
  renderEvents(snapshot);

  if (channelTimelineSelect && channelTimelineSelect.value) {
    void loadChannelTimeline(channelTimelineSelect.value);
  }
}

async function handleCreateVerification(event) {
  event.preventDefault();
  const data = new FormData(verificationForm);

  try {
    const metadata = parseMetadata(data.get("metadata"));
    const payload = {
      modelId: data.get("modelId")?.toString().trim(),
      verifierId: data.get("verifierId")?.toString().trim(),
      inputHash: data.get("inputHash")?.toString().trim(),
      outputHash: data.get("outputHash")?.toString().trim(),
      latencyMs: Number(data.get("latencyMs")),
      metadata,
    };

    await safeFetchJSON("/api/verifications", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    verificationForm.reset();
    showFormFeedback("Verification created successfully", "success");
    await refreshVerifications();
  } catch (error) {
    console.error(error);
    showFormFeedback(error.message ?? "Failed to create verification", "error");
  }
}

async function handleResolveVerification(inferenceId, status) {
  try {
    let proofUrl;
    let reason;

    if (status === "failed") {
      reason = window.prompt("Provide a reason for the failure:");
      if (!reason) {
        showFormFeedback("Resolution cancelled: reason is required for failures", "error");
        return;
      }
    }

    proofUrl = window.prompt("Optional proof URL (leave blank to skip):") ?? undefined;

    const payload = {
      status,
      proofUrl: proofUrl?.trim() || undefined,
      reason: reason?.trim() || undefined,
    };

    await safeFetchJSON(`/api/verifications/${inferenceId}/resolve`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    showFormFeedback(`Verification ${inferenceId} marked as ${status}`, "success");
    await refreshVerifications();
  } catch (error) {
    console.error(error);
    showFormFeedback(error.message ?? "Failed to resolve verification", "error");
  }
}

verificationForm.addEventListener("submit", handleCreateVerification);

verificationList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const action = target.dataset.action;
  if (action !== "resolve") {
    return;
  }

  const card = target.closest(".card");
  if (!card) {
    return;
  }

  const inferenceId = card.dataset.inferenceId;
  const status = target.dataset.status;
  if (!inferenceId || !status) {
    return;
  }

  void handleResolveVerification(inferenceId, status);
});

eventLog.addEventListener("click", (event) => {
  const entry = event.target instanceof HTMLElement ? event.target.closest(".entry") : undefined;
  if (!entry) {
    return;
  }

  const channelId = entry.dataset.channelId;
  if (!channelId || !channelTimelineSelect) {
    return;
  }

  const optionExists = Array.from(channelTimelineSelect.options).some((option) => option.value === channelId);
  if (!optionExists) {
    return;
  }

  channelTimelineSelect.value = channelId;
  void loadChannelTimeline(channelId, { force: true });
});

channelTimelineSelect?.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) {
    return;
  }

  void loadChannelTimeline(target.value, { force: true });
});

channelTimelineRefresh?.addEventListener("click", () => {
  if (!channelTimelineSelect) {
    return;
  }

  void loadChannelTimeline(channelTimelineSelect.value, { force: true });
});

async function bootstrap() {
  try {
    await Promise.all([refreshVerifications(), refreshEvents()]);
  } catch (error) {
    console.error("Initial load failed", error);
    showFormFeedback("Unable to load initial data", "error");
  }

  setInterval(() => {
    void refreshVerifications().catch((error) => console.error("Verification refresh failed", error));
  }, REFRESH_INTERVAL_MS);

  ensureEventPolling();

  if (window.EventSource) {
    startEventStream();
  }
}

void bootstrap();

window.addEventListener("beforeunload", () => {
  if (eventStream) {
    eventStream.close();
    eventStream = null;
  }

  if (eventStreamRetryTimer !== null) {
    window.clearTimeout(eventStreamRetryTimer);
    eventStreamRetryTimer = null;
  }

  if (eventPollingTimer !== null) {
    window.clearInterval(eventPollingTimer);
    eventPollingTimer = null;
  }
});
