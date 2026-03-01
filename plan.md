# DatasetEngine Coherence Hardening Plan for Better Training + Refinement

## Summary
This plan fixes the remaining workflow inconsistencies so `D:\DatasetEngine` is reliable for dataset refinement and model training.  
The key outcomes are:

1. Training configs resolve to real local datasets in `datasets/`.
2. Improver exports produce leakage-safe train/val splits (recommended default: 80/20 deterministic).
3. Frontend/backend API usage is consistent (no dead endpoints, no hardcoded backend URLs).
4. Runtime storage policy is clean and intentional in git (`datasets/models/projects/exports/temp` ignored by default content).
5. README + startup docs reflect actual behavior.

Chosen defaults:
- Improver export split: `80/20` with deterministic seed `42`.
- Git policy: ignore runtime storage contents; keep placeholders/docs tracked.

## Important API / Interface Changes
1. `POST /api/improve/export` behavior change:
- Current: writes only `images/train`, `labels/train`, and sets `val: images/train`.
- New default: writes `images/train`, `labels/train`, `images/val`, `labels/val`, and `data.yaml` with `val: images/val`.

2. `ExportRequest` schema extension in backend:
- Add optional `val_ratio: float = 0.2`.
- Add optional `split_seed: int = 42`.
- If not provided by frontend, defaults apply.

3. `GET /api/training/pickers` response extension:
- Keep existing list fields for compatibility.
- Add config health metadata field (for UI warnings), e.g. `config_status` with `config_path`, `dataset_path`, `exists`.

4. Frontend runtime configuration:
- Introduce `VITE_API_BASE_URL` support.
- Replace hardcoded `http://localhost:8000` usage with centralized base URL handling.

## Implementation Plan

## Phase 1: Training Config Coherence (Highest Priority)
1. Add config validation/normalization in trainer backend service.
- Parse all yaml files under `projects/trainer/configs`.
- Detect stale Makcu absolute paths (`.../GHL-MAKCU/training/datasets/...`).
- Re-map to `D:\DatasetEngine\datasets\<dataset_folder>` when folder exists.
- Preserve unchanged when already valid.
- Return status in `pickers` metadata for unresolved configs.

2. Update template config to current repo structure.
- Change `path` in `projects/trainer/configs/data.template.yaml` from old `training/datasets/...` style to DatasetEngine-local path convention.

3. Add frontend visibility for config health.
- In Trainer page, when selected config has invalid dataset path, show blocking warning before run.
- Keep explicit path browse override available.

## Phase 2: Fix Dataset Refinement Export Leakage
1. Refactor `backend/services/exporter.py`.
- After collecting selected frames, split deterministically by `split_seed` and `val_ratio`.
- Write separate train/val image+label folders.
- Ensure no overlap between splits.

2. Guardrails for small exports.
- If too few samples for both splits, keep at least one sample in train.
- Prefer creating val only when sample count permits.
- Emit clear response metadata for actual split counts.

3. Update generated `data.yaml`.
- `train: images/train`
- `val: images/val` when val exists
- If val omitted due very small dataset, set `val: images/train` only with explicit warning message in API response.

## Phase 3: API Alignment and URL Centralization
1. Normalize frontend API access pattern.
- Replace page-level hardcoded `fetch('http://localhost:8000/...')` in all pages with centralized helpers in `frontend/src/lib/api.js`.
- Introduce single API base:
  - `const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'`
  - `const API_URL = `${API_BASE}/api``

2. Remove dead frontend methods that have no backend router.
- Remove `/video/*` helpers unless corresponding router is implemented.
- Remove stale improvement methods not used by current pages.
- Ensure current pages only call routes that exist in `backend/routers`.

3. Contract cleanup.
- Keep existing endpoint paths stable.
- Update helper names to match actual backend semantics (`create_stream`, status polling, etc.).

## Phase 4: Git Hygiene for Runtime Storage
1. Update root `.gitignore` runtime policy.
- Ignore contents of:
  - `datasets/`
  - `models/`
  - `projects/`
  - `exports/`
  - `temp/`
- Keep `.gitkeep` and README placeholders tracked where needed.

2. Ensure top-level storage dirs have placeholders.
- Add `.gitkeep` and optional short README in each runtime dir describing purpose and non-tracked policy.

3. Keep source code and docs tracked only.
- Prevent accidental large artifact/model commits.

## Phase 5: Documentation and Developer UX
1. Update root README sections:
- Trainer workflow paths.
- Config requirements and path rules.
- Improver export split behavior.
- Environment variable for API base (`VITE_API_BASE_URL`).

2. Add troubleshooting notes:
- Invalid config path detection behavior.
- How to regenerate/split dataset properly.
- GPU/CPU auto device behavior in trainer.

3. Keep startup scripts unchanged functionally, but document expected path resolution and storage directories.

## Test Cases and Scenarios

## Backend tests
1. Training pickers returns config health metadata.
- Valid config reports `exists=true`.
- Stale Makcu config reports unresolved or remapped status correctly.

2. Improver export split correctness.
- Export 100 frames => deterministic 80 train / 20 val (given defaults).
- No image appears in both train and val.
- `data.yaml` points to `images/train` and `images/val`.

3. Small dataset split fallback.
- Export 1-2 frames yields stable behavior and explicit response message.

4. Trainer command preflight.
- Starting with invalid config path returns clear 4xx error message before subprocess execution.

## Frontend tests
1. No hardcoded backend URL strings remain in pages.
2. Trainer page shows config validity warning and blocks invalid run.
3. All page API calls route through centralized API helper and work with `VITE_API_BASE_URL`.

## Repo hygiene tests
1. `git status` remains clean after generating datasets/runs/artifacts/models.
2. Runtime outputs under storage dirs are not staged by default.
3. `.gitkeep` placeholders remain tracked.

## Assumptions and Defaults
1. Environment remains Windows local-first with FastAPI backend + Vite frontend.
2. Local filesystem access via tkinter dialogs is acceptable.
3. Default export split for refinement datasets is `val_ratio=0.2`, `split_seed=42`.
4. Runtime storage artifacts are intentionally non-versioned.
5. Existing uncommitted changes in repo are intentional and will be reconciled during implementation, not force-reverted.
