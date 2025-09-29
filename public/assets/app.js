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
const telemetryBooted = document.getElementById("telemetry-booted");
const telemetryGenerated = document.getElementById("telemetry-generated");
const telemetryElements = {
  channelTotal: document.getElementById("telemetry-channel-total"),
  channelSnapshot: document.getElementById("telemetry-channel-snapshot"),
  channelLastEvent: document.getElementById("telemetry-channel-last"),
  verificationsActive: document.getElementById("telemetry-verifications-active"),
  verificationsResolved: document.getElementById("telemetry-verifications-resolved"),
  verificationsVerified: document.getElementById("telemetry-verifications-verified"),
  verificationsFailed: document.getElementById("telemetry-verifications-failed"),
  automationTriggered: document.getElementById("telemetry-automation-triggered"),
  automationPending: document.getElementById("telemetry-automation-pending"),
  automationCompleted: document.getElementById("telemetry-automation-completed"),
  automationFailed: document.getElementById("telemetry-automation-failed"),
  automationAverage: document.getElementById("telemetry-automation-avg"),
};
const telemetryEventRate = document.getElementById("telemetry-event-rate");
const telemetryEventRateSparkline = document.getElementById("telemetry-event-rate-sparkline");
const telemetryEnabled =
  telemetryBooted instanceof HTMLElement &&
  telemetryGenerated instanceof HTMLElement &&
  Object.values(telemetryElements).some((element) => element instanceof HTMLElement);
const sparklineEnabled =
  telemetryEventRate instanceof HTMLElement && telemetryEventRateSparkline instanceof SVGElement;
const telemetryHistory = {
  eventRate: [],
  samples: [],
};
const numberFormatter = new Intl.NumberFormat("en-US");

const REFRESH_INTERVAL_MS = 7500;
const MAX_EVENT_ENTRIES = 24;
const MAX_TIMELINE_ROWS = 75;
const EVENT_STREAM_RETRY_MS = 5000;
const MAX_SPARKLINE_POINTS = 24;
const SPARKLINE_WIDTH = 100;
const SPARKLINE_HEIGHT = 24;
const EVENT_RATE_WINDOW_MS = 60_000;

let currentTimelineChannel = "";
let eventStream = null;
let eventStreamRetryTimer = null;
let eventPollingTimer = null;
let demoMode = false;

const DEMO_CHANNEL_ID = "0xchannel-demo-001";
const DEMO_BALANCE_ID = "demo-balance-001";
const demoState = {
  verifications: [],
  snapshot: null,
  channelHistory: new Map(),
  telemetry: null,
};

const generateId = () =>
  (window.crypto?.randomUUID?.() ?? `demo-${Date.now()}-${Math.random().toString(16).slice(2)}`);

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
  const label = state === "demo" ? "demo" : state;
  statusIndicator.textContent = `WS: ${label.toUpperCase()}`;
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

function formatRelativeTime(value) {
  if (!value) {
    return "–";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "–";
  }

  const diffMs = Date.now() - date.getTime();
  const tense = diffMs >= 0 ? "ago" : "from now";
  const seconds = Math.round(Math.abs(diffMs) / 1000);

  if (seconds < 5) {
    return "just now";
  }
  if (seconds < 60) {
    return `${seconds}s ${tense}`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${tense}`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${tense}`;
  }

  const days = Math.round(hours / 24);
  if (days < 7) {
    return `${days}d ${tense}`;
  }

  const weeks = Math.round(days / 7);
  if (weeks < 52) {
    return `${weeks}w ${tense}`;
  }

  const years = Math.round(days / 365);
  return `${years}y ${tense}`;
}

function formatDurationFromMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "–";
  }

  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  if (value < 60_000) {
    return `${(value / 1000).toFixed(1)} s`;
  }
  if (value < 3_600_000) {
    return `${(value / 60_000).toFixed(1)} min`;
  }

  return `${(value / 3_600_000).toFixed(1)} h`;
}

function setNumberMetric(element, value) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  const numeric = typeof value === "bigint" ? Number(value) : Number(value ?? 0);
  element.textContent = Number.isFinite(numeric) ? numberFormatter.format(numeric) : "0";
}

function setRelativeMetric(element, value) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  if (!value) {
    element.textContent = "–";
    element.removeAttribute("title");
    return;
  }

  const relative = formatRelativeTime(value);
  element.textContent = relative;
  element.title = formatDate(value);
}

function setDurationMetric(element, value) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  element.textContent = formatDurationFromMs(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    element.title = `${Math.round(value)} ms`;
  } else {
    element.removeAttribute("title");
  }
}

function setTimestampMetric(element, value) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  if (!value) {
    element.textContent = "–";
    element.removeAttribute("title");
    return;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    element.textContent = "–";
    element.removeAttribute("title");
    return;
  }

  element.textContent = `${formatRelativeTime(date)} · ${date.toLocaleTimeString()}`;
  element.title = date.toLocaleString();
}

function resetEventRateTrend() {
  telemetryHistory.eventRate = [];
  telemetryHistory.samples = [];

  if (telemetryEventRate instanceof HTMLElement) {
    telemetryEventRate.textContent = "–";
    telemetryEventRate.removeAttribute("title");
  }

  if (telemetryEventRateSparkline instanceof SVGElement) {
    telemetryEventRateSparkline.replaceChildren();
    telemetryEventRateSparkline.dataset.empty = "true";
  }
}

function updateEventRateTrend(snapshot) {
  if (!sparklineEnabled || !snapshot?.channelEvents) {
    return;
  }

  const totalRaw = snapshot.channelEvents.total ?? snapshot.channelEvents.count;
  const total = Number(totalRaw ?? 0);
  const timestamp = snapshot.generatedAt ? new Date(snapshot.generatedAt).getTime() : Date.now();

  if (!Number.isFinite(total) || !Number.isFinite(timestamp)) {
    return;
  }

  telemetryHistory.samples.push({ timestamp, total });
  const windowStart = timestamp - EVENT_RATE_WINDOW_MS;
  telemetryHistory.samples = telemetryHistory.samples.filter((sample, index, array) => {
    if (index === array.length - 1) {
      return true;
    }
    return sample.timestamp >= windowStart;
  });

  if (telemetryHistory.samples.length > MAX_SPARKLINE_POINTS + 1) {
    telemetryHistory.samples.splice(0, telemetryHistory.samples.length - (MAX_SPARKLINE_POINTS + 1));
  }

  if (telemetryHistory.samples.length < 2) {
    renderEventRateTrend(null);
    return;
  }

  const baseline = telemetryHistory.samples[0];
  const latest = telemetryHistory.samples[telemetryHistory.samples.length - 1];
  const elapsedMs = latest.timestamp - baseline.timestamp;
  if (elapsedMs <= 0) {
    renderEventRateTrend(null);
    return;
  }

  const safeDelta = Math.max(0, latest.total - baseline.total);
  const ratePerMinute = (safeDelta / elapsedMs) * 60_000;

  if (!Number.isFinite(ratePerMinute)) {
    renderEventRateTrend(null);
    return;
  }

  telemetryHistory.eventRate.push(ratePerMinute);
  if (telemetryHistory.eventRate.length > MAX_SPARKLINE_POINTS) {
    telemetryHistory.eventRate.shift();
  }

  renderEventRateTrend(ratePerMinute);
}

function renderEventRateTrend(currentRate) {
  if (telemetryEventRate instanceof HTMLElement) {
    const latest =
      typeof currentRate === "number" && Number.isFinite(currentRate)
        ? currentRate
        : telemetryHistory.eventRate.length > 0
            ? telemetryHistory.eventRate[telemetryHistory.eventRate.length - 1]
            : undefined;

    if (typeof latest === "number" && Number.isFinite(latest)) {
      const display = latest >= 100 ? Math.round(latest) : latest >= 10 ? latest.toFixed(1) : latest.toFixed(2);
      telemetryEventRate.textContent = display;
      telemetryEventRate.title = `${latest.toFixed(2)} events per minute`;
    } else {
      telemetryEventRate.textContent = "–";
      telemetryEventRate.removeAttribute("title");
    }
  }

  if (telemetryEventRateSparkline instanceof SVGElement) {
    if (!telemetryHistory.eventRate.length) {
      telemetryEventRateSparkline.replaceChildren();
      telemetryEventRateSparkline.dataset.empty = "true";
      return;
    }

    renderSparkline(telemetryEventRateSparkline, telemetryHistory.eventRate);
    telemetryEventRateSparkline.dataset.empty = "false";
  }
}

function renderSparkline(svgElement, data) {
  if (!(svgElement instanceof SVGElement)) {
    return;
  }

  const sliceStart = Math.max(0, data.length - MAX_SPARKLINE_POINTS);
  const values = data.slice(sliceStart).map((value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  });

  if (!values.length) {
    svgElement.replaceChildren();
    svgElement.dataset.empty = "true";
    return;
  }

  if (values.length === 1) {
    values.push(values[0]);
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  const coords = values.map((value, index) => {
    const x = (index / (values.length - 1)) * SPARKLINE_WIDTH;
    const normalized = range === 0 ? 0.5 : (value - min) / (range || 1);
    const y = SPARKLINE_HEIGHT - normalized * SPARKLINE_HEIGHT;
    return { x, y };
  });

  const linePath = coords
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");

  let areaPath = `M${coords[0].x.toFixed(2)} ${SPARKLINE_HEIGHT.toFixed(2)}`;
  for (const point of coords) {
    areaPath += ` L${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }
  const lastPoint = coords[coords.length - 1];
  areaPath += ` L${lastPoint.x.toFixed(2)} ${SPARKLINE_HEIGHT.toFixed(2)} Z`;

  const areaNode = document.createElementNS("http://www.w3.org/2000/svg", "path");
  areaNode.setAttribute("d", areaPath);
  areaNode.setAttribute("class", "sparkline-area");

  const lineNode = document.createElementNS("http://www.w3.org/2000/svg", "path");
  lineNode.setAttribute("d", linePath);
  lineNode.setAttribute("class", "sparkline-line");

  svgElement.replaceChildren(areaNode, lineNode);
}

function renderTelemetry(snapshot) {
  if (!snapshot) {
    return;
  }

  if (telemetryEnabled) {
    setNumberMetric(telemetryElements.channelTotal, snapshot.channelEvents?.total ?? 0);
    setNumberMetric(telemetryElements.channelSnapshot, snapshot.channelEvents?.snapshotSize ?? 0);
    setRelativeMetric(telemetryElements.channelLastEvent, snapshot.channelEvents?.lastEventAt);

    setNumberMetric(telemetryElements.verificationsActive, snapshot.verifications?.active ?? 0);
    setNumberMetric(telemetryElements.verificationsResolved, snapshot.verifications?.resolved ?? 0);
    setNumberMetric(
      telemetryElements.verificationsVerified,
      snapshot.verifications?.resolvedByStatus?.verified ?? 0,
    );
    setNumberMetric(
      telemetryElements.verificationsFailed,
      snapshot.verifications?.resolvedByStatus?.failed ?? 0,
    );

    setNumberMetric(telemetryElements.automationTriggered, snapshot.automation?.triggered ?? 0);
    setNumberMetric(telemetryElements.automationPending, snapshot.automation?.pending ?? 0);
    setNumberMetric(telemetryElements.automationCompleted, snapshot.automation?.completed ?? 0);
    setNumberMetric(telemetryElements.automationFailed, snapshot.automation?.failed ?? 0);
    setDurationMetric(telemetryElements.automationAverage, snapshot.automation?.averageProcessingMs);

    setTimestampMetric(telemetryBooted, snapshot.bootedAt);
    setTimestampMetric(telemetryGenerated, snapshot.generatedAt);
  }

  updateEventRateTrend(snapshot);
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

    const actions = node.querySelector(".card-actions");
    if (actions) {
      if (status !== "pending") {
        actions.remove();
      } else {
        actions.replaceChildren(createAutomationBadge());
      }
    }

    verificationList.appendChild(node);
  }
}

function enableDemoMode(reason) {
  if (demoMode) {
    return;
  }

  demoMode = true;
  console.warn("Demo mode enabled due to API failure", reason);
  setStatusIndicator("demo");
  initialiseDemoData();
  resetEventRateTrend();
  showFormFeedback("Demo mode active. Using simulated data while the API is unavailable.", "info");
  renderEvents(demoState.snapshot);
  renderVerifications(demoState.verifications);
  renderTelemetry(demoState.telemetry);
}

function initialiseDemoData() {
  const now = new Date();

  const demoChannelPayload = {
    channelId: DEMO_CHANNEL_ID,
    state: "active",
    sequence: 1,
    metadata: {
      modelId: "clip-vit-base-32",
      verifierId: "yellow-clearnode-auditor",
      sdkBacked: false,
      demo: true,
    },
    updatedAt: now.toISOString(),
  };

  demoState.snapshot = {
    channels: [
      {
        id: DEMO_CHANNEL_ID,
        updatedAt: now,
        payload: demoChannelPayload,
      },
    ],
    batches: [],
    balances: [
      {
        id: DEMO_BALANCE_ID,
        updatedAt: now,
        payload: [
          {
            channelId: DEMO_CHANNEL_ID,
            asset: "USDC",
            amount: "0.00",
          },
        ],
      },
    ],
  };

  demoState.channelHistory.set(DEMO_CHANNEL_ID, [
    {
      id: generateId(),
      type: "channel",
      occurredAt: now.toISOString(),
      channelId: DEMO_CHANNEL_ID,
      payload: demoChannelPayload,
    },
  ]);

  demoState.verifications = [];

  demoState.telemetry = {
    bootedAt: now.toISOString(),
    generatedAt: now.toISOString(),
    channelEvents: {
      total: 1,
      byType: {
        channel: 1,
        channels: 0,
        balance: 0,
      },
      lastEventAt: now.toISOString(),
      snapshotSize: 1,
    },
    verifications: {
      totalStarted: 0,
      active: 0,
      resolved: 0,
      resolvedByStatus: {
        pending: 0,
        verified: 0,
        failed: 0,
      },
      lastStartedAt: undefined,
      lastResolvedAt: undefined,
    },
    automation: {
      triggered: 0,
      pending: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      processingSumMs: 0,
      processingCount: 0,
      averageProcessingMs: null,
      lastCompletedAt: undefined,
    },
  };
}

function updateDemoTelemetryGenerated() {
  if (!demoState.telemetry) {
    return;
  }

  demoState.telemetry.generatedAt = new Date().toISOString();
}

function appendDemoChannelEvent(payload, type = "channel") {
  const occurredAt = new Date(payload?.updatedAt ?? Date.now());
  const channelId =
    (payload && typeof payload === "object" && (payload.channelId || payload.session?.channelId)) ||
    DEMO_CHANNEL_ID;
  const timestamped = {
    id: generateId(),
    updatedAt: occurredAt,
    payload,
  };

  if (!demoState.snapshot) {
    demoState.snapshot = { channels: [], batches: [], balances: [] };
  }

  if (type === "channel") {
    demoState.snapshot.channels.unshift({
      ...timestamped,
      id: channelId,
    });
    demoState.snapshot.channels = demoState.snapshot.channels.slice(0, MAX_EVENT_ENTRIES);
  } else if (type === "channels") {
    demoState.snapshot.batches.unshift(timestamped);
    demoState.snapshot.batches = demoState.snapshot.batches.slice(0, MAX_EVENT_ENTRIES);
  } else if (type === "balance") {
    demoState.snapshot.balances.unshift(timestamped);
    demoState.snapshot.balances = demoState.snapshot.balances.slice(0, MAX_EVENT_ENTRIES);
  }

  const history = demoState.channelHistory.get(channelId) ?? [];
  history.unshift({
    id: timestamped.id,
    type,
    occurredAt: occurredAt.toISOString(),
    channelId,
    payload,
  });
  demoState.channelHistory.set(channelId, history);

  if (demoState.telemetry?.channelEvents) {
    demoState.telemetry.channelEvents.total += 1;
    if (demoState.telemetry.channelEvents.byType[type] !== undefined) {
      demoState.telemetry.channelEvents.byType[type] += 1;
    }
    demoState.telemetry.channelEvents.lastEventAt = occurredAt.toISOString();
    demoState.telemetry.channelEvents.snapshotSize = demoState.snapshot.channels.length;
  }

  updateDemoTelemetryGenerated();

  if (channelTimelineSelect && channelTimelineSelect.value === channelId) {
    renderChannelTimelineEntries(history);
  }
}

function createDemoVerification(payload) {
  if (!demoState.telemetry) {
    initialiseDemoData();
  }

  const inferenceId = generateId();
  const now = new Date();

  const session = {
    channelId: DEMO_CHANNEL_ID,
    state: "active",
    openedAt: now,
    metadata: {
      ...(payload.metadata ?? {}),
      modelId: payload.modelId,
      verifierId: payload.verifierId,
      sdkBacked: false,
      demo: true,
    },
  };

  const inference = {
    inferenceId,
    modelId: payload.modelId,
    inputHash: payload.inputHash,
    outputHash: payload.outputHash,
    latencyMs: payload.latencyMs,
    metadata: payload.metadata,
  };

  const record = {
    id: inferenceId,
    channelSnapshot: {
      session,
      inflight: [inference],
      results: [
        {
          inferenceId,
          status: "pending",
        },
      ],
    },
  };

  demoState.verifications.unshift(record);

  if (demoState.telemetry) {
    demoState.telemetry.verifications.totalStarted += 1;
    demoState.telemetry.verifications.active += 1;
    demoState.telemetry.verifications.lastStartedAt = now.toISOString();
    demoState.telemetry.automation.triggered += 1;
    demoState.telemetry.automation.pending += 1;
    updateDemoTelemetryGenerated();
  }

  appendDemoChannelEvent(
    {
      ...session,
      event: "inference_registered",
      inferenceId,
      updatedAt: now.toISOString(),
    },
    "channel",
  );

  renderVerifications(demoState.verifications);
  renderEvents(demoState.snapshot);
  renderTelemetry(demoState.telemetry);

  scheduleDemoResolution(record, payload);
}

function scheduleDemoResolution(record, payload) {
  const processingMs = Math.round(600 + Math.random() * 800);

  window.setTimeout(() => {
    const now = new Date();

    record.result = {
      inferenceId: record.id,
      status: "verified",
      proofUrl: `https://clearnode.yellow.dev/proofs/${record.id}`,
      completedAt: now,
      metadata: {
        ...(payload.metadata ?? {}),
        automated: true,
        evaluatedBy: "demo-automated-verifier",
        processingMs,
        createdAt: now.toISOString(),
      },
    };

    if (record.channelSnapshot) {
      record.channelSnapshot.inflight = record.channelSnapshot.inflight.filter(
        (item) => item.inferenceId !== record.id,
      );

      const resultIndex = record.channelSnapshot.results.findIndex(
        (item) => item.inferenceId === record.id,
      );

      if (resultIndex >= 0) {
        record.channelSnapshot.results[resultIndex] = record.result;
      } else {
        record.channelSnapshot.results.push(record.result);
      }
    }

    if (demoState.telemetry) {
      demoState.telemetry.verifications.active = Math.max(
        0,
        demoState.telemetry.verifications.active - 1,
      );
      demoState.telemetry.verifications.resolved += 1;
      demoState.telemetry.verifications.resolvedByStatus.verified += 1;
      demoState.telemetry.verifications.lastResolvedAt = now.toISOString();

      demoState.telemetry.automation.pending = Math.max(
        0,
        demoState.telemetry.automation.pending - 1,
      );
      demoState.telemetry.automation.completed += 1;
      demoState.telemetry.automation.processingSumMs += processingMs;
      demoState.telemetry.automation.processingCount += 1;
      demoState.telemetry.automation.averageProcessingMs = Math.round(
        demoState.telemetry.automation.processingSumMs /
          demoState.telemetry.automation.processingCount,
      );
      demoState.telemetry.automation.lastCompletedAt = now.toISOString();
      updateDemoTelemetryGenerated();
    }

    appendDemoChannelEvent(
      {
        ...record.channelSnapshot.session,
        event: "inference_verified",
        inferenceId: record.id,
        result: record.result,
        updatedAt: now.toISOString(),
      },
      "channel",
    );

    renderVerifications(demoState.verifications);
    renderEvents(demoState.snapshot);
    renderTelemetry(demoState.telemetry);
  }, processingMs);
}

function createAutomationBadge() {
  const span = document.createElement("span");
  span.className = "automation-badge";
  span.textContent = "Automated verification in progress…";
  return span;
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

  if (demoMode) {
    const rows = demoState.channelHistory.get(channelId) ?? [];
    renderChannelTimelineEntries(rows);
    return;
  }

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

  if (payload.metrics) {
    renderTelemetry(payload.metrics);
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
  if (payload.type === "channel") {
    if (payload.channelId === selectedChannel) {
      void loadChannelTimeline(selectedChannel, { force: true });
    }
    return;
  }

  void loadChannelTimeline(selectedChannel, { force: true });
}

function startEventStream() {
  if (demoMode) {
    return;
  }

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
    if (telemetryEnabled && !eventStream) {
      void refreshTelemetry();
    }
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
  if (demoMode) {
    renderVerifications(demoState.verifications);
    return;
  }

  try {
    const records = await safeFetchJSON("/api/verifications");
    renderVerifications(records);
  } catch (error) {
    console.warn("Verification refresh failed, switching to demo mode", error);
    enableDemoMode(error);
    renderVerifications(demoState.verifications);
  }
}

async function refreshEvents() {
  if (demoMode) {
    if (demoState.snapshot) {
      renderEvents(demoState.snapshot);
    }

    if (channelTimelineSelect && channelTimelineSelect.value) {
      void loadChannelTimeline(channelTimelineSelect.value);
    }
    return;
  }

  try {
    const snapshot = await safeFetchJSON("/api/clearnode/events");
    renderEvents(snapshot);

    if (channelTimelineSelect && channelTimelineSelect.value) {
      void loadChannelTimeline(channelTimelineSelect.value);
    }
  } catch (error) {
    console.warn("Event refresh failed, switching to demo mode", error);
    enableDemoMode(error);
    if (demoState.snapshot) {
      renderEvents(demoState.snapshot);
    }
    if (channelTimelineSelect && channelTimelineSelect.value) {
      void loadChannelTimeline(channelTimelineSelect.value);
    }
  }
}

async function refreshTelemetry() {
  if (!telemetryEnabled) {
    return;
  }

  if (demoMode) {
    if (demoState.telemetry) {
      renderTelemetry(demoState.telemetry);
    }
    return;
  }

  try {
    const response = await fetch("/api/metrics");
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const snapshot = await response.json();
    renderTelemetry(snapshot);
  } catch (error) {
    console.warn("Telemetry refresh failed", error);
  }
}

async function handleCreateVerification(event) {
  event.preventDefault();
  const data = new FormData(verificationForm);

  let metadata;
  try {
    metadata = parseMetadata(data.get("metadata"));
  } catch (error) {
    showFormFeedback(error?.message ?? "Metadata must be valid JSON", "error");
    return;
  }

  const payload = {
    modelId: data.get("modelId")?.toString().trim() ?? "",
    verifierId: data.get("verifierId")?.toString().trim() ?? "",
    inputHash: data.get("inputHash")?.toString().trim() ?? "",
    outputHash: data.get("outputHash")?.toString().trim() ?? "",
    latencyMs: Number(data.get("latencyMs")),
    metadata,
  };

  if (demoMode) {
    createDemoVerification(payload);
    verificationForm.reset();
    showFormFeedback("Verification created and evaluated automatically (demo mode)", "success");
    return;
  }

  try {
    await safeFetchJSON("/api/verifications", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    verificationForm.reset();
    showFormFeedback("Verification created successfully", "success");
    await refreshVerifications();
  } catch (error) {
    console.error(error);
    enableDemoMode(error);
    createDemoVerification(payload);
    verificationForm.reset();
    showFormFeedback("Verification created and evaluated automatically (demo mode)", "success");
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

resetEventRateTrend();

async function bootstrap() {
  try {
    const tasks = [refreshVerifications(), refreshEvents()];
    if (telemetryEnabled) {
      tasks.push(refreshTelemetry());
    }

    await Promise.all(tasks);
  } catch (error) {
    console.error("Initial load failed", error);
    showFormFeedback("Unable to load initial data", "error");
    enableDemoMode(error);
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
