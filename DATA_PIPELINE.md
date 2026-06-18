# Data Pipeline

Lead Helper now uses a dataset-driven pipeline:

1. import job
2. raw dataset
3. normalized dataset
4. frontend map / clustering / fence generation

## Files

- Raw dataset: `data/dealerships.raw.sample.json`
- Import jobs: `data/import-jobs/*.json`
- Candidate source files: `data/candidates/*`
- Geocode cache: `data/.geocode-cache.json`
- Normalized frontend dataset: `src/data/dealerships.normalized.json`

## Commands

- Refresh Wandsworth:
  - `npm run data:refresh:wandsworth`
- Refresh Chiswick:
  - `npm run data:refresh:chiswick`
- Collect OSM candidates for Wandsworth:
  - `npm run data:collect:wandsworth:osm`
- Collect a wider London discovery dataset for new-car showrooms:
  - `npm run data:collect:london:newcar`
- Collect OSM candidates and import them into the raw dataset:
  - `npm run data:refresh:wandsworth:osm`
- Run a custom job:
  - `npm run data:import -- ./data/import-jobs/your-job.json`
- Rebuild normalized dataset only:
  - `npm run data:build`

## Job Format

An import job must provide:

- `clusterId`
- `centerQuery`
- `maxDistanceMiles`
- either `candidates` or `candidatesFile`

`candidatesFile` can be:

- `.json` array
- `.json` object with `candidates`
- `.csv`

## OSM collector

The collector uses:

- Nominatim to geocode the center query
- Overpass `nwr["shop"="car"]` around that center

It writes a reviewable candidate file before import. That keeps discovery separate from ingestion.

Optional collector fields:

- `profile`: apply a qualification profile such as `new-car-showroom`
- `searches`: run one collector job across multiple centers/radii and merge the results
- `sameNameMergeDistanceMiles`: merge same-name nearby duplicates and keep the richer record
- `overpassUrls`: override the default Overpass endpoint fallback list

## Merge Rules

Imported records replace existing raw records in the same cluster, and dedupe also checks:

- `id`
- normalized `website`
- normalized `name + address`

## Why this split exists

The frontend should not depend directly on scraping or geocoding. The map reads a normalized dataset, while the importer layer handles search, geocoding, filtering, and merge behavior.
