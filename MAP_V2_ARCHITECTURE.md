# Map V2 Architecture

## Purpose

Map V2 replaces the current static/simulated cluster spine with a data-led map system.

The core rule is:

**Pins are the source of truth. Clusters are assignments. Boundaries are generated outputs. Reports are frozen snapshots.**

The current map is useful as a visual prototype, but it couples dealerships, clusters, boundaries, and workflow state too tightly. That makes the map feel authored rather than adaptive. Map V2 should make it impossible for assigning one manual pin to Chiswick to hide, mutate, or redraw unrelated clusters such as Brentford/teal.

## Non-Negotiable Behaviour

- Adding a location creates a pin first, not a cluster mutation.
- A dealership pin can exist without belonging to a cluster.
- Assigning a pin to a cluster only changes one cluster assignment record.
- Existing clusters are not overwritten when a new pin is added.
- Boundaries are generated from the current assignment list, not hand-authored polygons.
- Completed reports use frozen map snapshots so later discovery changes do not rewrite historic proof-of-work.
- Manual user edits always override automatic suggestions.

## Current Failure To Avoid

The reverted map pass exposed the architectural issue:

- Manual dealership data was stored too close to `clusterId`.
- The selected cluster state and map rendering were coupled.
- Accepting a manual pin into an existing cluster could alter the apparent cluster system.
- The map still felt like a styled layer over simulated seed data.

Map V2 must separate these responsibilities.

## Domain Objects

### DealershipPin

Represents a real place on the map.

```ts
type DealershipPin = {
  id: string;
  name: string;
  address: string;
  location: [lat: number, lng: number];
  brands: string[];
  website?: string;
  phone?: string;
  source: "osm" | "google" | "manual" | "csv" | "import" | "scrape";
  sourceRef?: string;
  confidence: "confirmed" | "likely" | "needs-review";
  status: "unvisited" | "visited" | "active-lead" | "not-suitable" | "converted";
  createdAt: string;
  updatedAt: string;
};
```

Important: this object should not own the working cluster assignment. It is a place record.

### ClusterAssignment

Represents membership of a pin in a field cluster.

```ts
type ClusterAssignment = {
  id: string;
  clusterId: string;
  pinId: string;
  assignmentType: "suggested" | "accepted" | "manual" | "rejected";
  confidence?: number;
  assignedAt: string;
  assignedBy: "system" | "user";
};
```

This is the safe layer. Moving Auto West into Chiswick adds/updates one assignment. It does not mutate the dealership pin or any other cluster.

### FieldCluster

Represents a work territory or field session.

```ts
type FieldCluster = {
  id: string;
  name: string;
  lifecycle: "suggested" | "accepted" | "manual" | "active" | "completed" | "frozen" | "rejected";
  colour: "amber" | "mint" | "rose" | "teal" | "lime" | "violet";
  strategy: "adaptive-density" | "manual-selection" | "imported-area" | "legacy";
  targetSession: "quick-pass" | "half-day" | "full-day" | "regional-day";
  createdAt: string;
  updatedAt: string;
};
```

Clusters do not store dealership objects. They are shells with lifecycle and metadata. Membership comes from `ClusterAssignment`.

### ClusterGeometry

Generated from assigned pins.

```ts
type ClusterGeometry = {
  clusterId: string;
  boundary: Array<[lat: number, lng: number]>;
  routeLine: Array<[lat: number, lng: number]>;
  center: [lat: number, lng: number];
  generatedFromPinIds: string[];
  generatedAt: string;
  method: "single-pin-buffer" | "route-buffer" | "convex-buffer" | "concave-hull" | "manual-adjusted";
  userAdjusted?: boolean;
};
```

Geometry is cacheable, but it is not the source of truth.

### ReportSnapshot

Frozen proof-of-work.

```ts
type ReportSnapshot = {
  id: string;
  clusterId: string;
  clusterName: string;
  pinIds: string[];
  boundary: Array<[lat: number, lng: number]>;
  routeLine: Array<[lat: number, lng: number]>;
  dealershipRows: unknown[];
  generatedAt: string;
};
```

Reports must never regenerate from live cluster data unless the user explicitly creates a new report.

## Map Modes

### 1. Discovery Mode

Purpose: planning and data review.

Shows:

- all known pins,
- unassigned pins,
- suggested clusters,
- accepted clusters,
- rejected/parked suggestions if enabled.

Actions:

- accept a suggested cluster,
- reject/park a suggestion,
- create manual cluster from selected pins,
- assign a pin to an existing cluster,
- mark a pin as not relevant,
- open the pin detail / lead workflow.

### 2. Cluster Planning Mode

Purpose: editing a field territory before going out.

Shows:

- one cluster,
- assigned pins,
- nearby unassigned pins,
- generated boundary,
- route order preview.

Actions:

- add/remove pins,
- split cluster,
- merge clusters,
- rename cluster,
- regenerate boundary,
- accept route order,
- activate cluster for fieldwork.

### 3. Field Mode

Purpose: in-person door-to-door session.

Shows:

- one active cluster,
- ordered stops,
- current GPS location,
- visited/unvisited status,
- next dealership,
- quick entry to lead/OCR/email flow.

Actions:

- start route,
- open in Google Maps,
- log visit,
- capture card,
- generate email,
- mark stop complete.

### 4. Report Mode

Purpose: management proof-of-work.

Shows:

- frozen boundary,
- visited pins,
- route/coverage proof,
- actions taken,
- follow-up proof,
- lead status.

Actions:

- preview report,
- export PDF,
- save snapshot,
- compare cluster plan vs completed work.

## Adaptive Clustering Logic

The cluster engine should not use one fixed distance radius.

Distance means different things in different contexts:

- Inner London: tighter clusters, higher density, smaller catchment.
- Outer London / arterial roads: looser clusters, fewer stops.
- Surrey / regional trips: wider radius, day-trip style clusters.

### Inputs

- pin coordinates,
- distance from Battersea / central London,
- density of nearby pins,
- estimated travel time,
- desired session size,
- already visited status,
- manual user constraints.

### Session Profiles

```ts
type ClusterSessionProfile = {
  id: string;
  label: string;
  targetStops: [min: number, max: number];
  innerLondonRadiusMiles: number;
  outerLondonRadiusMiles: number;
  regionalRadiusMiles: number;
};
```

Suggested profiles:

- `quick-pass`: 2-4 stops
- `half-day`: 4-7 stops
- `full-day`: 7-12 stops
- `regional-day`: 2-5 stops, wider travel tolerance

### Recommended First Algorithm

Use an adaptive DBSCAN-style engine:

1. Classify each pin as inner, outer, or regional.
2. Apply different distance tolerance by zone.
3. Generate suggested clusters from density.
4. Cap or split clusters by target session size.
5. Label clusters using nearest known area.
6. Store suggestions as `FieldCluster` + `ClusterAssignment` records.
7. Let the user accept/reject/edit.

This avoids a single giant cluster stretching from South Kensington to Lambeth and Richmond.

## Boundary Generation

Boundary generation should happen after assignments.

Pipeline:

```text
assigned pin ids
  -> ordered route line
  -> buffer around route and pins
  -> simplified polygon
  -> optional user adjustment
```

Methods:

- 1 pin: circular/rounded buffer.
- 2 pins: route/line buffer.
- 3+ compact pins: convex or concave hull with buffer.
- stretched sparse pins: route buffer, not a giant polygon.
- manually edited boundary: save as `manual-adjusted`.

The boundary should look like a practical highlighter mark around the area worked, but it must be derived from actual pins and route logic.

## + Location Flow

The final UX should be:

```text
User adds name/address
  -> geocode address
  -> create DealershipPin
  -> show pin on Discovery Map
  -> suggest nearest clusters
  -> user chooses:
       accept into cluster
       create manual cluster
       leave unassigned
       move pin / confirm address
```

If confidence is low:

```text
Address found, please confirm map pin.
[Use this pin] [Move pin] [Search again]
```

The pin must appear on the map immediately after creation, even if unassigned.

## Data Sources

Map V2 should support multiple sources:

- OSM Overpass discovery,
- manual `+ Location`,
- CSV/plain text import,
- future search/scrape pipeline,
- optional Google Places later if pricing/permissions make sense.

All sources feed `DealershipPin`. None should directly mutate cluster geometry.

## Migration From Current Map

Do not replace everything in one patch.

### Phase 1: Parallel Data Model

- Add `mapV2` state alongside current state.
- Convert existing static dealerships into `DealershipPin`.
- Convert current clusters into `FieldCluster`.
- Convert current `clusterId` dealership relationships into `ClusterAssignment`.
- Keep current UI rendering from old model while new selectors are tested.

### Phase 2: V2 Selectors

Create selectors:

- `getPins()`
- `getClusters()`
- `getAssignmentsForCluster(clusterId)`
- `getPinsForCluster(clusterId)`
- `getUnassignedPins()`
- `getClusterGeometry(clusterId)`
- `getSuggestedClusters()`

No page should directly stitch old structures together.

### Phase 3: Discovery Map V2

- Render pins from `DealershipPin`.
- Render suggested/accepted clusters from assignments.
- Add unassigned pin drawer.
- Add accept/reject/create manual cluster actions.

### Phase 4: Operational Map V2

- Render one cluster from assignments.
- Generate route and boundary from assigned pins.
- Keep lead/OCR/email workflow connected by `pinId`.

### Phase 5: Reports Snapshot

- Freeze report data from `ReportSnapshot`.
- Stop reports from depending on live cluster geometry.

## First Build Slice

The first implementation should be intentionally narrow:

1. Add Map V2 data model and selectors.
2. Migrate current seed dealerships into V2 pins in memory.
3. Render a read-only V2 discovery map behind a feature flag or separate route.
4. Add `+ Location` to create a V2 pin.
5. Show unassigned V2 pins.
6. Assign one pin to one cluster without touching any other cluster.
7. Generate boundary only for the selected cluster.

This proves the architecture before adding clever clustering.

## Acceptance Tests

These tests define success:

- Adding Auto West creates one new pin.
- Auto West appears as unassigned on the map.
- Accepting Auto West into Chiswick adds one assignment.
- Existing Chiswick pins remain visible.
- Brentford/teal cluster remains visible and unchanged.
- Other cluster assignments are unchanged.
- Chiswick boundary regenerates from Chiswick assigned pins.
- Report snapshot generated before the change remains unchanged.
- Report snapshot generated after the change includes Auto West only if the cluster was used/exported after assignment.

## Implementation Notes

- Keep the old stable map until V2 passes acceptance tests.
- Do not mutate dealership seed data when assigning clusters.
- Avoid using global `selectedClusterId` as a write target for unrelated actions.
- Use explicit actions: `createPin`, `assignPinToCluster`, `rejectClusterSuggestion`, `createManualCluster`.
- Keep Map V2 reducers small and testable.
- Add migration helpers rather than rewriting old data files immediately.

