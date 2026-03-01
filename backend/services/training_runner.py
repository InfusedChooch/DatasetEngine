#!/usr/bin/env python
"""
YOLO trainer worker used by DatasetEngine backend.
Supports train/export/validate/split commands.
"""

from __future__ import annotations

import argparse
import random
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Iterable

import yaml

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from config import settings


TRAINER_ROOT = settings.PROJECTS_PATH / "trainer"
DEFAULT_CONFIGS_DIR = TRAINER_ROOT / "configs"
DEFAULT_RUNS_DIR = TRAINER_ROOT / "runs"
DEFAULT_ARTIFACTS_DIR = settings.EXPORTS_PATH / "trainer_artifacts"
DEFAULT_PUBLISH_DIR = settings.BASE_PATH / "models"

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}


def _print_info(message: str) -> None:
    print(f"[INFO] {message}", flush=True)


def _print_warn(message: str) -> None:
    print(f"[WARN] {message}", flush=True)


def _print_error(message: str) -> None:
    print(f"[ERROR] {message}", flush=True)


def _print_meta(key: str, value: str | Path) -> None:
    print(f"[META] {key}={Path(value).resolve()}", flush=True)


def safe_mkdir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def ensure_default_directories() -> None:
    for path in [
        TRAINER_ROOT,
        DEFAULT_CONFIGS_DIR,
        DEFAULT_RUNS_DIR,
        DEFAULT_ARTIFACTS_DIR,
        DEFAULT_PUBLISH_DIR,
    ]:
        safe_mkdir(path)


def resolve_path(raw: str | Path) -> Path:
    path = Path(raw)
    if not path.is_absolute():
        path = (settings.BASE_PATH / path).resolve()
    return path


def parse_csv_items(value: str) -> list[str]:
    return [item.strip() for item in str(value).split(",") if item.strip()]


def normalize_device(value: str) -> str | None:
    text = str(value or "auto").strip().lower()
    if text in ("", "auto"):
        try:
            import torch  # type: ignore

            if bool(torch.cuda.is_available()):
                return "0"
            return "cpu"
        except Exception:
            return "cpu"
    return str(value)


def infer_run_name(data_yaml: Path, imgsz: int) -> str:
    stem = data_yaml.stem or "dataset"
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{stem}_{imgsz}_{ts}"


def _import_yolo():
    try:
        from ultralytics import YOLO  # type: ignore

        return YOLO
    except Exception as exc:
        _print_error("Ultralytics is not available. Install backend dependencies first.")
        raise SystemExit(2) from exc


def normalize_names(names_obj) -> dict[int, str]:
    if isinstance(names_obj, dict):
        normalized: dict[int, str] = {}
        for k, v in names_obj.items():
            try:
                normalized[int(k)] = str(v)
            except Exception:
                continue
        if normalized:
            return dict(sorted(normalized.items(), key=lambda x: x[0]))
    if isinstance(names_obj, (list, tuple)):
        return {idx: str(name) for idx, name in enumerate(names_obj)}
    return {}


def write_classes_sidecar(model, out_path: Path) -> Path:
    names = normalize_names(getattr(model, "names", {}))
    if not names:
        _print_warn("Class names unavailable; writing fallback classes.")
        names = {0: "class_0"}
    safe_mkdir(out_path.parent)
    with out_path.open("w", encoding="utf-8") as handle:
        for idx in sorted(names.keys()):
            handle.write(f"{names[idx]}\n")
    _print_info(f"Wrote class sidecar: {out_path} ({len(names)} classes)")
    return out_path


def copy_file(src: Path, dst: Path) -> Path:
    safe_mkdir(dst.parent)
    if dst.exists():
        _print_warn(f"Overwriting existing file: {dst}")
    shutil.copy2(src, dst)
    return dst


def copy_artifacts_to_publish_dir(files: Iterable[Path], publish_dir: Path) -> list[Path]:
    safe_mkdir(publish_dir)
    published: list[Path] = []
    for src in files:
        if not src.exists():
            continue
        dst = publish_dir / src.name
        published.append(copy_file(src, dst))
    return published


def _coerce_export_path(export_result, expected_ext: str, search_hint: Path) -> Path | None:
    candidates: list[Path] = []
    if isinstance(export_result, (str, Path)):
        candidates.append(Path(export_result))
    elif isinstance(export_result, (list, tuple)):
        for item in export_result:
            if isinstance(item, (str, Path)):
                candidates.append(Path(item))

    for candidate in candidates:
        path = resolve_path(candidate)
        if path.exists() and path.suffix.lower() == expected_ext:
            return path

    if search_hint.exists():
        matches = sorted(search_hint.rglob(f"*{expected_ext}"), key=lambda p: p.stat().st_mtime, reverse=True)
        if matches:
            return matches[0]
    return None


def export_with_fallback(model, fmt: str, imgsz: int, output_path: Path, search_hint: Path) -> Path | None:
    fmt = fmt.strip().lower()
    ext = ".onnx" if fmt == "onnx" else ".engine"
    kwargs = {"format": fmt, "imgsz": int(imgsz)}
    try:
        _print_info(f"Exporting {fmt.upper()} ...")
        result = model.export(**kwargs)
        exported_path = _coerce_export_path(result, ext, search_hint)
        if exported_path is None or not exported_path.exists():
            _print_warn(f"{fmt.upper()} export returned no usable artifact.")
            return None
        return copy_file(exported_path, output_path)
    except Exception as exc:
        if fmt == "engine":
            _print_warn(f"ENGINE export skipped: {exc}")
            return None
        raise


def summarize_files(label: str, files: list[Path]) -> None:
    print("")
    print(f"=== {label} ===")
    if not files:
        print("(none)")
        return
    for file_path in files:
        print(f"- {file_path}")


def _find_layout(dataset_dir: Path) -> tuple[Path, Path, Path, Path]:
    candidates = [
        (
            dataset_dir / "train" / "images",
            dataset_dir / "train" / "labels",
            dataset_dir / "valid" / "images",
            dataset_dir / "valid" / "labels",
        ),
        (
            dataset_dir / "images" / "train",
            dataset_dir / "labels" / "train",
            dataset_dir / "images" / "val",
            dataset_dir / "labels" / "val",
        ),
    ]
    for train_images, train_labels, valid_images, valid_labels in candidates:
        if train_images.exists():
            return train_images, train_labels, valid_images, valid_labels
    raise FileNotFoundError(
        "Could not detect supported dataset layout. Expected train images under "
        "'train/images' or 'images/train'."
    )


def _list_images(images_dir: Path) -> list[Path]:
    return sorted([p for p in images_dir.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS])


def _copy_or_move(src: Path, dst: Path, copy_only: bool) -> None:
    if copy_only:
        shutil.copy2(src, dst)
    else:
        shutil.move(str(src), str(dst))


def _update_data_yaml(dataset_dir: Path, valid_images_dir: Path) -> None:
    data_yaml = dataset_dir / "data.yaml"
    if not data_yaml.exists():
        _print_warn(f"data.yaml not found at {data_yaml}. Skipping YAML update.")
        return

    rel_val = valid_images_dir.relative_to(dataset_dir).as_posix()
    lines = data_yaml.read_text(encoding="utf-8").splitlines()
    updated = False
    out_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("val:"):
            out_lines.append(f"val: {rel_val}")
            updated = True
        else:
            out_lines.append(line)

    if not updated:
        out_lines.append(f"val: {rel_val}")

    data_yaml.write_text("\n".join(out_lines).rstrip() + "\n", encoding="utf-8")
    _print_info(f"Updated val path in data.yaml -> {rel_val}")


def split_dataset(
    dataset_dir: Path,
    val_fraction: float,
    seed: int,
    copy_only: bool,
    update_yaml: bool,
    dry_run: bool,
) -> int:
    if not (0.0 < val_fraction < 1.0):
        _print_error("--val-fraction must be between 0 and 1.")
        return 2

    try:
        train_images_dir, train_labels_dir, valid_images_dir, valid_labels_dir = _find_layout(dataset_dir)
    except FileNotFoundError as exc:
        _print_error(str(exc))
        return 2

    images = _list_images(train_images_dir)
    if len(images) < 2:
        _print_error(f"Need at least 2 train images to split. Found {len(images)} in {train_images_dir}")
        return 2

    existing_valid = _list_images(valid_images_dir) if valid_images_dir.exists() else []
    if existing_valid:
        _print_error(
            f"Validation split already contains {len(existing_valid)} images at {valid_images_dir}. "
            "Clear it first to avoid accidental mixing."
        )
        return 2

    val_count = round(len(images) * val_fraction)
    val_count = max(1, min(len(images) - 1, val_count))

    rng = random.Random(seed)
    selected = rng.sample(images, k=val_count)

    _print_info(f"Dataset: {dataset_dir}")
    _print_info(f"Train images before split: {len(images)}")
    _print_info(f"Validation target count: {val_count} ({val_fraction:.2%})")
    _print_info(f"Mode: {'copy' if copy_only else 'move'}")

    if dry_run:
        _print_info("Dry-run enabled; no files were changed.")
        return 0

    safe_mkdir(valid_images_dir)
    safe_mkdir(valid_labels_dir)

    moved_labels = 0
    missing_labels = 0

    for image_path in selected:
        dst_image = valid_images_dir / image_path.name
        _copy_or_move(image_path, dst_image, copy_only=copy_only)

        src_label = train_labels_dir / f"{image_path.stem}.txt"
        if src_label.exists():
            dst_label = valid_labels_dir / src_label.name
            _copy_or_move(src_label, dst_label, copy_only=copy_only)
            moved_labels += 1
        else:
            missing_labels += 1

    if update_yaml:
        _update_data_yaml(dataset_dir, valid_images_dir)

    remaining_train_images = len(_list_images(train_images_dir))
    valid_images = len(_list_images(valid_images_dir))
    _print_info(f"Train images after split: {remaining_train_images}")
    _print_info(f"Valid images after split: {valid_images}")
    _print_info(f"Labels moved/copied: {moved_labels}")
    if missing_labels:
        _print_warn(f"Missing labels for selected images: {missing_labels}")
    return 0


def do_train(args: argparse.Namespace) -> int:
    YOLO = _import_yolo()
    data_yaml = resolve_path(args.data)
    if not data_yaml.exists():
        _print_error(f"Dataset yaml not found: {data_yaml}")
        return 2

    run_name = args.name.strip() if args.name else infer_run_name(data_yaml, args.imgsz)
    project_dir = resolve_path(args.project)
    artifacts_dir = safe_mkdir(DEFAULT_ARTIFACTS_DIR / run_name)
    publish_dir = resolve_path(args.publish_dir)
    safe_mkdir(project_dir)

    _print_meta("artifact_dir", artifacts_dir)
    if args.publish:
        _print_meta("publish_dir", publish_dir)
    _print_meta("run_name", run_name)

    model_ref = str(args.model)
    _print_info(f"Starting training: model={model_ref}, data={data_yaml}, run={run_name}")
    model = YOLO(model_ref)
    train_kwargs = {
        "data": str(data_yaml),
        "imgsz": int(args.imgsz),
        "epochs": int(args.epochs),
        "batch": int(args.batch),
        "project": str(project_dir),
        "name": run_name,
        "patience": int(args.patience),
        "workers": int(args.workers),
        "seed": int(args.seed),
        "resume": bool(args.resume),
    }
    device = normalize_device(args.device)
    if device is not None:
        train_kwargs["device"] = device
    _print_info(f"Using device: {train_kwargs.get('device', 'auto')}")

    results = model.train(**train_kwargs)
    save_dir = Path(getattr(results, "save_dir", project_dir / run_name))
    best_pt = save_dir / "weights" / "best.pt"
    if not best_pt.exists():
        fallback = save_dir / "weights" / "last.pt"
        if fallback.exists():
            best_pt = fallback
            _print_warn(f"best.pt not found. Using last.pt: {fallback}")
        else:
            _print_error(f"Training finished, but no weights found under: {save_dir / 'weights'}")
            return 3

    output_files: list[Path] = []
    pt_out = copy_file(best_pt, artifacts_dir / f"{run_name}.pt")
    output_files.append(pt_out)

    best_model = YOLO(str(best_pt))
    sidecar = write_classes_sidecar(best_model, artifacts_dir / f"{run_name}_classes.txt")
    output_files.append(sidecar)

    export_formats = [f.lower() for f in parse_csv_items(args.export)]
    for fmt in export_formats:
        if fmt not in ("onnx", "engine"):
            _print_warn(f"Unsupported export format ignored: {fmt}")
            continue
        out_file = artifacts_dir / f"{run_name}.{fmt}"
        exported = export_with_fallback(best_model, fmt, int(args.imgsz), out_file, save_dir)
        if exported is not None:
            output_files.append(exported)

    published_files: list[Path] = []
    if args.publish:
        published_files = copy_artifacts_to_publish_dir(output_files, publish_dir)

    summarize_files("Artifacts", output_files)
    if args.publish:
        summarize_files("Published", published_files)
    return 0


def do_export(args: argparse.Namespace) -> int:
    YOLO = _import_yolo()
    weights = resolve_path(args.weights)
    if not weights.exists():
        _print_error(f"Weights file not found: {weights}")
        return 2
    if weights.suffix.lower() != ".pt":
        _print_error("Export command requires a .pt weights file.")
        return 2

    run_name = args.name.strip() if args.name else weights.stem
    artifacts_dir = safe_mkdir(DEFAULT_ARTIFACTS_DIR / run_name)
    publish_dir = resolve_path(args.publish_dir)
    model = YOLO(str(weights))

    _print_meta("artifact_dir", artifacts_dir)
    if args.publish:
        _print_meta("publish_dir", publish_dir)
    _print_meta("run_name", run_name)

    output_files: list[Path] = []
    pt_out = copy_file(weights, artifacts_dir / f"{run_name}.pt")
    output_files.append(pt_out)
    sidecar = write_classes_sidecar(model, artifacts_dir / f"{run_name}_classes.txt")
    output_files.append(sidecar)

    for fmt in [f.lower() for f in parse_csv_items(args.formats)]:
        if fmt not in ("onnx", "engine"):
            _print_warn(f"Unsupported export format ignored: {fmt}")
            continue
        out_file = artifacts_dir / f"{run_name}.{fmt}"
        exported = export_with_fallback(model, fmt, int(args.imgsz), out_file, weights.parent)
        if exported is not None:
            output_files.append(exported)

    published_files: list[Path] = []
    if args.publish:
        published_files = copy_artifacts_to_publish_dir(output_files, publish_dir)

    summarize_files("Artifacts", output_files)
    if args.publish:
        summarize_files("Published", published_files)
    return 0


def do_validate(args: argparse.Namespace) -> int:
    YOLO = _import_yolo()
    weights = resolve_path(args.weights)
    data_yaml = resolve_path(args.data)
    if not weights.exists():
        _print_error(f"Weights/model file not found: {weights}")
        return 2
    if not data_yaml.exists():
        _print_error(f"Dataset yaml not found: {data_yaml}")
        return 2

    _print_info(f"Validating model={weights} with data={data_yaml}")
    model = YOLO(str(weights))
    val_kwargs = {
        "data": str(data_yaml),
        "imgsz": int(args.imgsz),
        "batch": int(args.batch),
    }
    device = normalize_device(args.device)
    if device is not None:
        val_kwargs["device"] = device
    _print_info(f"Using device: {val_kwargs.get('device', 'auto')}")

    results = model.val(**val_kwargs)
    metrics = getattr(results, "results_dict", None)
    print("")
    print("=== Validation Summary ===")
    if isinstance(metrics, dict) and metrics:
        for key in sorted(metrics.keys()):
            print(f"- {key}: {metrics[key]}")
    else:
        print(f"- result: {results}")
    save_dir = getattr(results, "save_dir", None)
    if save_dir:
        print(f"- save_dir: {save_dir}")
    return 0


def do_split(args: argparse.Namespace) -> int:
    dataset_dir = resolve_path(args.dataset)
    if not dataset_dir.exists():
        _print_error(f"Dataset path not found: {dataset_dir}")
        return 2
    return split_dataset(
        dataset_dir=dataset_dir,
        val_fraction=float(args.val_fraction),
        seed=int(args.seed),
        copy_only=bool(args.copy),
        update_yaml=bool(args.update_yaml),
        dry_run=bool(args.dry_run),
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="DatasetEngine YOLO training/export/validation helper.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    train_p = subparsers.add_parser("train", help="Train a YOLO detect model and export artifacts.")
    train_p.add_argument("--data", required=True, help="Path to data.yaml")
    train_p.add_argument("--model", default="yolov8s.pt", help="Base model weights")
    train_p.add_argument("--imgsz", type=int, default=640)
    train_p.add_argument("--epochs", type=int, default=100)
    train_p.add_argument("--batch", type=int, default=-1, help="Use -1 for auto-batch")
    train_p.add_argument("--device", default="auto", help="auto|cpu|0|0,1")
    train_p.add_argument("--project", default=str(DEFAULT_RUNS_DIR), help="Ultralytics project dir")
    train_p.add_argument("--name", default="", help="Run name (optional)")
    train_p.add_argument("--patience", type=int, default=30)
    train_p.add_argument("--workers", type=int, default=8)
    train_p.add_argument("--seed", type=int, default=42)
    train_p.add_argument("--resume", action="store_true", help="Resume an interrupted run")
    train_p.add_argument("--export", default="onnx,engine", help="Comma-separated export formats")
    train_p.add_argument("--publish", dest="publish", action="store_true", default=True)
    train_p.add_argument("--no-publish", dest="publish", action="store_false")
    train_p.add_argument("--publish-dir", default=str(DEFAULT_PUBLISH_DIR))
    train_p.set_defaults(func=do_train)

    export_p = subparsers.add_parser("export", help="Export an existing .pt model to ONNX/ENGINE.")
    export_p.add_argument("--weights", required=True, help="Path to .pt model")
    export_p.add_argument("--imgsz", type=int, default=640)
    export_p.add_argument("--formats", default="onnx,engine", help="Comma-separated export formats")
    export_p.add_argument("--name", default="", help="Artifact name prefix (optional)")
    export_p.add_argument("--publish", dest="publish", action="store_true", default=True)
    export_p.add_argument("--no-publish", dest="publish", action="store_false")
    export_p.add_argument("--publish-dir", default=str(DEFAULT_PUBLISH_DIR))
    export_p.set_defaults(func=do_export)

    val_p = subparsers.add_parser("validate", help="Validate a model on a dataset.")
    val_p.add_argument("--weights", required=True, help="Path to .pt/.onnx/.engine")
    val_p.add_argument("--data", required=True, help="Path to data.yaml")
    val_p.add_argument("--imgsz", type=int, default=640)
    val_p.add_argument("--device", default="auto", help="auto|cpu|0|0,1")
    val_p.add_argument("--batch", type=int, default=-1)
    val_p.set_defaults(func=do_validate)

    split_p = subparsers.add_parser("split", help="Split train set into train+valid.")
    split_p.add_argument("--dataset", required=True, help="Path to dataset root")
    split_p.add_argument("--val-fraction", type=float, default=0.2, help="Fraction of train images for valid")
    split_p.add_argument("--seed", type=int, default=42, help="Random seed")
    split_p.add_argument("--copy", action="store_true", help="Copy files instead of moving")
    split_p.add_argument(
        "--no-update-yaml",
        dest="update_yaml",
        action="store_false",
        help="Do not update val path in data.yaml.",
    )
    split_p.add_argument("--dry-run", action="store_true", help="Preview split without changing files")
    split_p.set_defaults(update_yaml=True, func=do_split)

    return parser


def main() -> int:
    ensure_default_directories()
    parser = build_parser()
    args = parser.parse_args()
    try:
        return int(args.func(args))
    except KeyboardInterrupt:
        _print_warn("Interrupted by user.")
        return 130
    except SystemExit:
        raise
    except Exception as exc:
        _print_error(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
