/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useReducer } from "react";
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
} from "../lib/leadHelperModel";
import {
  assignMapV2PinToCluster,
  createMapV2PinFromManualPayload,
  ensureMapV2State,
  upsertMapV2Pin,
} from "../lib/mapV2Model";

const AppStateContext = createContext(null);

function reducer(state, action) {
  const next = cloneState(state);

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

  if (action.type === "assign-map-v2-pin") {
    next.mapV2 = assignMapV2PinToCluster(ensureMapV2State(next), action.pinId, action.clusterId, action.options || {});
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
    next.actions = next.actions.map((item) =>
      item.id === action.actionId
        ? {
            ...item,
            status: "done",
            completedAt: new Date().toISOString(),
          }
        : item,
    );
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

function loadInitialState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneState(initialState);
    const parsed = JSON.parse(raw);
    if (parsed?.version !== STATE_VERSION) return cloneState(initialState);
    const defaults = cloneState(initialState);
    return {
      ...defaults,
      ...parsed,
      mapV2: parsed.mapV2?.version ? parsed.mapV2 : defaults.mapV2,
      actions: (parsed.actions || defaults.actions || []).map((action) => normalizeActionRecord(action)),
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
          typeof parsed.settings?.notificationsEnabled === "boolean"
            ? parsed.settings.notificationsEnabled
            : defaults.settings.notificationsEnabled,
        notificationLeadMinutes: Number.isFinite(Number(parsed.settings?.notificationLeadMinutes))
          ? Number(parsed.settings.notificationLeadMinutes)
          : defaults.settings.notificationLeadMinutes,
      },
      parkedDiscoveryAreaIds: Array.isArray(parsed.parkedDiscoveryAreaIds) ? parsed.parkedDiscoveryAreaIds : defaults.parkedDiscoveryAreaIds,
    };
  } catch {
    return cloneState(initialState);
  }
}

export function AppStateProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitialState);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const value = useMemo(() => {
    const clusters = getAllClusters(state);
    const selectedCluster = getCluster(state.selectedClusterId, state) || clusters[0];
    const selectedDealership = mergeDealership(state, state.currentDealershipId);
    const normalizedActions = (state.actions || []).map((item) => normalizeActionRecord(item));
    const pendingActions = normalizedActions.filter((item) => item.status === "pending");
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
      pendingDrafts,
      clustersWithVisits,
      getDealershipsForCluster: (clusterId) => getDealershipsForCluster(state, clusterId),
      getDraftForDealership: (dealershipId) => getDraftForDealership(state, dealershipId),
      getLatestContact: (dealershipId) => getLatestContact(state, dealershipId),
      getLatestMedia: (dealershipId) => getLatestMedia(state, dealershipId),
      getLatestVisit: (dealershipId) => getLatestVisit(state, dealershipId),
      getDealershipRuntime: (dealershipId) => getDealershipRuntime(state, dealershipId),
      getDealershipById: (dealershipId) => mergeDealership(state, dealershipId),
      dispatch,
    };
  }, [state]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const value = useContext(AppStateContext);
  if (!value) throw new Error("useAppState must be used inside AppStateProvider");
  return value;
}
