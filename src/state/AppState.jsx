/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from "react";
import {
  STORAGE_KEY,
  STATE_VERSION,
  applyVisitOutcomes,
  captureMockContact,
  cloneState,
  createOperationalClusterFromDiscoveryArea,
  getAllDealerships,
  ensureEmailAction,
  getAllClusters,
  getCluster,
  getLatestContact,
  getDealershipsForCluster,
  getDealershipRuntime,
  getDraftForDealership,
  getLatestMedia,
  getLatestVisit,
  initialState,
  normalizeActionRecord,
  mergeDealership,
  saveOcrCapture,
  setDiscoveryAreaParked,
  sameOutcomes,
  upsertManualDealership,
  upsertDraft,
  uid,
} from "../lib/leadHelperModel";
import {
  assignMapV2PinToCluster,
  createMapV2ClusterFromPins,
  createMapV2PinFromManualPayload,
  ensureMapV2State,
  upsertMapV2Pin,
} from "../lib/mapV2Model";

const AppStateContext = createContext(null);
const REMOTE_SYNC_DEVICE_KEY = `${STORAGE_KEY}:device-id`;

function buildNextWeekDueAt() {
  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + 7);
  dueAt.setHours(10, 30, 0, 0);
  return dueAt.toISOString();
}

function buildWaitingResponseDueAt() {
  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + 5);
  dueAt.setHours(10, 30, 0, 0);
  return dueAt.toISOString();
}

function reducer(state, action) {
  const next = cloneState(state);

  if (action.type === "replace-state") {
    return hydrateState(action.state);
  }

  if (action.type === "select-cluster") {
    next.selectedClusterId = action.clusterId;
    const dealers = getDealershipsForCluster(next, action.clusterId);
    if (dealers[0]) next.currentDealershipId = dealers[0].id;
    return next;
  }

  if (action.type === "promote-discovery-area") {
    createOperationalClusterFromDiscoveryArea(next, action.areaId, action.name);
    return next;
  }

  if (action.type === "park-discovery-area") {
    setDiscoveryAreaParked(next, action.areaId, true);
    return next;
  }

  if (action.type === "restore-discovery-area") {
    setDiscoveryAreaParked(next, action.areaId, false);
    return next;
  }

  if (action.type === "select-dealership") {
    next.currentDealershipId = action.dealershipId;
    next.selectedClusterId = mergeDealership(next, action.dealershipId).clusterId;
    return next;
  }

  if (action.type === "capture-contact") {
    captureMockContact(next, action.dealershipId);
    return next;
  }

  if (action.type === "save-ocr-contact") {
    saveOcrCapture(next, action.dealershipId, action.payload);
    return next;
  }

  if (action.type === "upsert-manual-dealership") {
    upsertManualDealership(next, action.payload);
    return next;
  }

  if (action.type === "upsert-map-v2-pin") {
    next.mapV2 = upsertMapV2Pin(ensureMapV2State(next), action.pin || createMapV2PinFromManualPayload(action.payload || {}));
    return next;
  }

  if (action.type === "add-location-to-map") {
    const dealership = upsertManualDealership(next, action.dealership || {});
    const pinPayload = {
      ...(action.pin || {}),
      legacyDealershipId: dealership.id,
    };
    const pin = createMapV2PinFromManualPayload(pinPayload);
    next.mapV2 = upsertMapV2Pin(ensureMapV2State(next), pin);
    if (action.clusterId) {
      next.mapV2 = assignMapV2PinToCluster(next.mapV2, pin.id, action.clusterId, action.options || {});
    }
    return next;
  }

  if (action.type === "assign-map-v2-pin") {
    next.mapV2 = assignMapV2PinToCluster(ensureMapV2State(next), action.pinId, action.clusterId, action.options || {});
    return next;
  }

  if (action.type === "create-map-v2-cluster-from-pins") {
    next.mapV2 = createMapV2ClusterFromPins(ensureMapV2State(next), action.pinIds, action.name);
    return next;
  }

  if (action.type === "save-settings") {
    next.settings = {
      ...(next.settings || {}),
      ...(action.payload || {}),
    };
    return next;
  }

  if (action.type === "save-email-draft") {
    upsertDraft(next, action.dealershipId, action.outcomes, action.status || "draft", action.draft || {});
    ensureEmailAction(next, action.dealershipId, "pending");
    return next;
  }

  if (action.type === "open-email-handoff") {
    const latest = getLatestVisit(next, action.dealershipId);
    if (!latest || !sameOutcomes(latest.outcomes, action.outcomes)) {
      applyVisitOutcomes(next, action.dealershipId, action.outcomes, "Outlook draft opened from Email page");
    }

    upsertDraft(next, action.dealershipId, action.outcomes, "opened", {
      ...(action.draft || {}),
      handoff: action.handoff || "outlook-app",
      openedAt: action.openedAt || new Date().toISOString(),
      proofLabel: "Outlook draft opened",
    });
    ensureEmailAction(next, action.dealershipId, "done");
    next.actions.forEach((item) => {
      if (item.dealershipId === action.dealershipId && item.type === "email") {
        item.status = "done";
        item.completedAt = action.openedAt || new Date().toISOString();
      }
    });
    return next;
  }

  if (action.type === "generate-visit") {
    applyVisitOutcomes(next, action.dealershipId, action.outcomes, action.note, { scheduleAt: action.scheduleAt });
    return next;
  }

  if (action.type === "complete-action") {
    const completedAction = next.actions.find((item) => item.id === action.actionId);
    next.actions = next.actions.map((item) =>
      item.id === action.actionId
        ? {
            ...item,
            status: "done",
            completedAt: new Date().toISOString(),
            completedOutcome: action.outcome || "done",
            completedLabel: action.label || "Done",
            completedNote: action.note || "",
          }
        : item,
    );

    if (completedAction && ["follow_up_sent", "no_reply_yet"].includes(action.outcome)) {
      const existingWaitingAction = next.actions.find(
        (item) =>
          item.status === "pending" &&
          item.dealershipId === completedAction.dealershipId &&
          (item.sourceCompletedAction === completedAction.id || item.sourceSummaryOutcome === "no_response_yet"),
      );
      if (!existingWaitingAction) {
        next.actions.unshift(
          normalizeActionRecord({
            id: uid("action"),
            dealershipId: completedAction.dealershipId,
            title: "Await response to site pack",
            type: "waiting_response",
            dueAt: buildWaitingResponseDueAt(),
            dueText: "",
            priority: "low",
            status: "pending",
            note: "Site pack or follow-up media sent. Waiting on the lead to respond before chasing too hard.",
            sourceCompletedAction: completedAction.id,
          }),
        );
      }
    }

    return next;
  }

  if (action.type === "reopen-action") {
    next.actions = next.actions.map((item) =>
      item.id === action.actionId
        ? normalizeActionRecord({
            ...item,
            status: "pending",
            completedAt: "",
            completedOutcome: "",
            completedLabel: "",
            completedNote: "",
            notifiedAt: "",
          })
        : item,
    );
    return next;
  }

  if (action.type === "toggle-summary-outcome") {
    next.summaryOutcomes = next.summaryOutcomes || [];
    const dealershipId = action.dealershipId;
    const outcomeId = action.outcomeId;
    const current =
      next.summaryOutcomes.find((item) => item.dealershipId === dealershipId) || {
        id: uid("summary"),
        dealershipId,
        outcomeIds: [],
        labels: [],
        note: "",
        updatedAt: "",
      };
    const isSelected = current.outcomeIds.includes(outcomeId);
    const outcomeIds = isSelected ? current.outcomeIds.filter((item) => item !== outcomeId) : [...current.outcomeIds, outcomeId];
    const labels = isSelected ? current.labels.filter((item) => item !== action.label) : [...current.labels, action.label];
    const nextRecord = {
      ...current,
      outcomeIds,
      labels,
      updatedAt: new Date().toISOString(),
    };

    next.summaryOutcomes = [nextRecord, ...next.summaryOutcomes.filter((item) => item.dealershipId !== dealershipId)];

    if (!isSelected && action.createChaseAction) {
      const existingChase = next.actions.find(
        (item) => item.dealershipId === dealershipId && item.status === "pending" && item.sourceSummaryOutcome === outcomeId,
      );
      if (!existingChase) {
        const dueAt = buildNextWeekDueAt();
        next.actions.unshift(
          normalizeActionRecord({
            id: uid("action"),
            dealershipId,
            title: action.chaseTitle || "Chase follow-up response",
            type: "call",
            dueAt,
            dueText: "",
            priority: "medium",
            status: "pending",
            note: action.chaseNote || "Created from weekly summary review.",
            sourceSummaryOutcome: outcomeId,
          }),
        );
      }
    }

    return next;
  }

  if (action.type === "set-summary-report-inclusion") {
    next.summaryOutcomes = next.summaryOutcomes || [];
    const dealershipId = action.dealershipId;
    const current =
      next.summaryOutcomes.find((item) => item.dealershipId === dealershipId) || {
        id: uid("summary"),
        dealershipId,
        outcomeIds: [],
        labels: [],
        note: "",
        updatedAt: "",
      };
    const nextRecord = {
      ...current,
      includeInReport: Boolean(action.includeInReport),
      reportIncludedAt: action.includeInReport ? new Date().toISOString() : "",
      updatedAt: new Date().toISOString(),
    };
    next.summaryOutcomes = [nextRecord, ...next.summaryOutcomes.filter((item) => item.dealershipId !== dealershipId)];
    return next;
  }

  if (action.type === "reschedule-action") {
    next.actions = next.actions.map((item) =>
      item.id === action.actionId
        ? normalizeActionRecord({
            ...item,
            dueAt: action.dueAt || item.dueAt,
            notifiedAt: "",
          })
        : item,
    );
    return next;
  }

  if (action.type === "mark-action-notified") {
    next.actions = next.actions.map((item) =>
      item.id === action.actionId
        ? {
            ...item,
            notifiedAt: action.notifiedAt || new Date().toISOString(),
          }
        : item,
    );
    return next;
  }

  if (action.type === "send-email") {
    const latest = getLatestVisit(next, action.dealershipId);
    if (!latest || !sameOutcomes(latest.outcomes, action.outcomes)) {
      applyVisitOutcomes(next, action.dealershipId, action.outcomes, "Sent from FGI Email");
    } else {
      latest.note = "Sent from FGI Email";
    }
    upsertDraft(next, action.dealershipId, action.outcomes, "sent", {
      ...(action.draft || {}),
      sentAt: action.sentAt || new Date().toISOString(),
      proofLabel: "Email marked sent",
    });
    ensureEmailAction(next, action.dealershipId, "done");
    next.actions.forEach((item) => {
      if (item.dealershipId === action.dealershipId && item.type === "email") item.status = "done";
    });
    return next;
  }

  if (action.type === "reset-demo") {
    return cloneState(initialState);
  }

  return state;
}

function hydrateState(parsed) {
  if (parsed?.version !== STATE_VERSION) return cloneState(initialState);
  const defaults = cloneState(initialState);
  return {
    ...defaults,
    ...parsed,
    mapV2: parsed.mapV2?.version ? parsed.mapV2 : defaults.mapV2,
    actions: (parsed.actions || defaults.actions || []).map((action) => normalizeActionRecord(action)),
    summaryOutcomes: Array.isArray(parsed.summaryOutcomes) ? parsed.summaryOutcomes : defaults.summaryOutcomes,
    settings: {
      ...defaults.settings,
      ...(parsed.settings || {}),
      openRouterApiKey: parsed.settings?.openRouterApiKey || defaults.settings.openRouterApiKey,
      ocrModel: parsed.settings?.ocrModel || defaults.settings.ocrModel,
      emailModel: parsed.settings?.emailModel || defaults.settings.emailModel,
      emailGenerationMode: parsed.settings?.emailGenerationMode || defaults.settings.emailGenerationMode,
      workEmail: parsed.settings?.workEmail || defaults.settings.workEmail,
      preferredSendMode: parsed.settings?.preferredSendMode || defaults.settings.preferredSendMode,
      notificationsEnabled:
        typeof parsed.settings?.notificationsEnabled === "boolean" ? parsed.settings.notificationsEnabled : defaults.settings.notificationsEnabled,
      notificationLeadMinutes: Number.isFinite(Number(parsed.settings?.notificationLeadMinutes))
        ? Number(parsed.settings.notificationLeadMinutes)
        : defaults.settings.notificationLeadMinutes,
    },
    parkedDiscoveryAreaIds: Array.isArray(parsed.parkedDiscoveryAreaIds) ? parsed.parkedDiscoveryAreaIds : defaults.parkedDiscoveryAreaIds,
  };
}

function getSyncDevice() {
  const nav = typeof window !== "undefined" ? window.navigator : null;
  const userAgent = nav?.userAgent || "";
  const isPhone = /iphone|android.*mobile|mobile/i.test(userAgent);
  const label = isPhone ? "Phone field device" : "Desktop review device";
  let id;

  try {
    id = window.localStorage.getItem(REMOTE_SYNC_DEVICE_KEY) || "";
    if (!id) {
      id = `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      window.localStorage.setItem(REMOTE_SYNC_DEVICE_KEY, id);
    }
  } catch {
    id = "unknown-device";
  }

  return { id, label };
}

function prepareRemoteState(state, syncMeta = {}) {
  const remoteState = cloneState(state);
  if (remoteState.settings) delete remoteState.settings.openRouterApiKey;
  remoteState.syncMeta = {
    ...(remoteState.syncMeta || {}),
    ...syncMeta,
  };
  return remoteState;
}

function loadInitialState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneState(initialState);
    const parsed = JSON.parse(raw);
    return hydrateState(parsed);
  } catch {
    return cloneState(initialState);
  }
}

export function AppStateProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitialState);
  const [cloudSync, setCloudSync] = useState({
    checked: false,
    busy: false,
    error: "",
    lastCloudUpdatedAt: "",
    lastDeviceLabel: "",
    lastPushedAt: "",
    lastPulledAt: "",
    message: "Cloud backup not checked yet",
  });

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const refreshCloudSyncStatus = useCallback(async function refreshCloudSyncStatus() {
    setCloudSync((current) => ({ ...current, busy: true, error: "", message: "Checking cloud backup..." }));
    try {
      const response = await fetch("/api/sync/state");
      if (!response.ok) throw new Error("Cloud backup is not ready.");
      const payload = await response.json();
      const remoteState = payload.state?.version === STATE_VERSION ? payload.state : null;
      setCloudSync((current) => ({
        ...current,
        checked: true,
        busy: false,
        error: "",
        lastCloudUpdatedAt: payload.updatedAt || "",
        lastDeviceLabel: remoteState?.syncMeta?.deviceLabel || "",
        lastPushedAt: remoteState?.syncMeta?.pushedAt || "",
        message: remoteState ? "Cloud backup available" : "No cloud backup has been saved yet",
      }));
      return payload;
    } catch (error) {
      setCloudSync((current) => ({
        ...current,
        checked: true,
        busy: false,
        error: error.message || "Cloud backup check failed",
        message: "Cloud backup unavailable",
      }));
      throw error;
    }
  }, []);

  const pushCloudBackup = useCallback(async function pushCloudBackup() {
    const device = getSyncDevice();
    const pushedAt = new Date().toISOString();
    const remoteState = prepareRemoteState(state, {
      deviceId: device.id,
      deviceLabel: device.label,
      pushedAt,
    });

    setCloudSync((current) => ({ ...current, busy: true, error: "", message: "Backing up this device to cloud..." }));
    try {
      const response = await fetch("/api/sync/state", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ state: remoteState }),
      });
      if (!response.ok) throw new Error("Cloud backup failed.");
      const payload = await response.json();
      setCloudSync((current) => ({
        ...current,
        checked: true,
        busy: false,
        error: "",
        lastCloudUpdatedAt: payload.updatedAt || pushedAt,
        lastDeviceLabel: device.label,
        lastPushedAt: pushedAt,
        message: "This device is backed up to cloud",
      }));
      return payload;
    } catch (error) {
      setCloudSync((current) => ({
        ...current,
        busy: false,
        error: error.message || "Cloud backup failed",
        message: "Cloud backup failed",
      }));
      throw error;
    }
  }, [state]);

  const pullCloudBackup = useCallback(async function pullCloudBackup() {
    setCloudSync((current) => ({ ...current, busy: true, error: "", message: "Loading cloud backup onto this device..." }));
    try {
      const response = await fetch("/api/sync/state");
      if (!response.ok) throw new Error("Cloud backup is not ready.");
      const payload = await response.json();
      if (payload.state?.version !== STATE_VERSION) throw new Error("No compatible cloud backup was found.");
      dispatch({ type: "replace-state", state: payload.state });
      setCloudSync((current) => ({
        ...current,
        checked: true,
        busy: false,
        error: "",
        lastCloudUpdatedAt: payload.updatedAt || "",
        lastDeviceLabel: payload.state?.syncMeta?.deviceLabel || "",
        lastPulledAt: new Date().toISOString(),
        lastPushedAt: payload.state?.syncMeta?.pushedAt || current.lastPushedAt,
        message: "Cloud backup loaded onto this device",
      }));
      return payload;
    } catch (error) {
      setCloudSync((current) => ({
        ...current,
        busy: false,
        error: error.message || "Cloud backup load failed",
        message: "Cloud backup load failed",
      }));
      throw error;
    }
  }, []);

  useEffect(() => {
    refreshCloudSyncStatus().catch(() => {});
  }, [refreshCloudSyncStatus]);

  const value = useMemo(() => {
    const clusters = getAllClusters(state);
    const selectedCluster = getCluster(state.selectedClusterId, state) || clusters[0];
    const selectedDealership = mergeDealership(state, state.currentDealershipId);
    const normalizedActions = (state.actions || []).map((item) => normalizeActionRecord(item));
    const pendingActions = normalizedActions.filter((item) => item.status === "pending");
    const completedActions = normalizedActions
      .filter((item) => item.status === "done")
      .sort((left, right) => String(right.completedAt || "").localeCompare(String(left.completedAt || "")));
    const pendingDrafts = state.emailDrafts.filter((item) => item.status === "draft");
    const clustersWithVisits = new Set(state.visits.map((visit) => visit.clusterId));

    return {
      state,
      mapV2: ensureMapV2State(state),
      selectedCluster,
      selectedDealership,
      dealerships: getAllDealerships(state),
      clusters,
      settings: state.settings || initialState.settings,
      actions: normalizedActions,
      pendingActions,
      completedActions,
      pendingDrafts,
      clustersWithVisits,
      cloudSync,
      pushCloudBackup,
      pullCloudBackup,
      refreshCloudSyncStatus,
      getDealershipsForCluster: (clusterId) => getDealershipsForCluster(state, clusterId),
      getDraftForDealership: (dealershipId) => getDraftForDealership(state, dealershipId),
      getLatestContact: (dealershipId) => getLatestContact(state, dealershipId),
      getLatestMedia: (dealershipId) => getLatestMedia(state, dealershipId),
      getLatestVisit: (dealershipId) => getLatestVisit(state, dealershipId),
      getDealershipRuntime: (dealershipId) => getDealershipRuntime(state, dealershipId),
      getDealershipById: (dealershipId) => mergeDealership(state, dealershipId),
      dispatch,
    };
  }, [cloudSync, pullCloudBackup, pushCloudBackup, refreshCloudSyncStatus, state]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const value = useContext(AppStateContext);
  if (!value) throw new Error("useAppState must be used inside AppStateProvider");
  return value;
}
