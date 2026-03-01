import json
import random
import shutil
import yaml
from pathlib import Path
from typing import Any

from models.schemas import ExportRequest
from config import settings


class ExporterService:
    def _build_split(self, total: int, val_ratio: float) -> tuple[int, int, list[str]]:
        warnings: list[str] = []

        if total < 1:
            return 0, 0, warnings

        if val_ratio <= 0:
            return total, 0, ["Validation split disabled (`val_ratio=0`). `val` falls back to `train`."]

        if total == 1:
            return 1, 0, ["Only 1 frame available; created train-only export and set `val=train` fallback."]

        val_count = int(round(total * val_ratio))
        val_count = max(1, val_count)
        val_count = min(total - 1, val_count)

        train_count = total - val_count
        if train_count < 1:
            train_count = 1
            val_count = total - train_count

        if total < 5:
            warnings.append(
                f"Tiny dataset export ({total} frames): train={train_count}, val={val_count}. Metrics may be unstable."
            )

        return train_count, val_count, warnings

    def _write_sample(
        self,
        project_path: Path,
        annotation: dict[str, Any],
        dst_image: Path,
        dst_label: Path,
    ) -> bool:
        frame_id = annotation["frame_id"]
        src_frame = project_path / "frames" / f"frame_{frame_id:06d}.jpg"
        if not src_frame.exists():
            return False

        shutil.copy(src_frame, dst_image)
        with dst_label.open("w", encoding="utf-8") as handle:
            for box in annotation.get("boxes", []):
                line = (
                    f"{box['class_id']} "
                    f"{box['x_center']:.6f} {box['y_center']:.6f} "
                    f"{box['width']:.6f} {box['height']:.6f}\n"
                )
                handle.write(line)
        return True

    def export_dataset(self, request: ExportRequest) -> dict[str, Any]:
        project_path = settings.get_project_path(request.project_id)
        output_path = Path(request.output_name)

        images_train = output_path / "images" / "train"
        labels_train = output_path / "labels" / "train"
        images_val = output_path / "images" / "val"
        labels_val = output_path / "labels" / "val"
        for path in (images_train, labels_train, images_val, labels_val):
            path.mkdir(parents=True, exist_ok=True)

        with (project_path / "project.json").open(encoding="utf-8") as f:
            project = json.load(f)

        annotations_file = project_path / "annotations.json"
        if not annotations_file.exists():
            raise ValueError("No annotations found. Please annotate or flag some frames first.")

        with annotations_file.open(encoding="utf-8") as f:
            annotations = json.load(f)

        if request.include_all:
            frames_to_export = annotations
        else:
            frames_to_export = [a for a in annotations if a.get("include_in_training", False)]

        if request.selected_frames:
            selected = set(request.selected_frames)
            frames_to_export = [a for a in frames_to_export if a.get("frame_id") in selected]

        if not frames_to_export:
            raise ValueError("No frames marked for training. Please include some frames first.")

        shuffled = list(frames_to_export)
        random.Random(request.split_seed).shuffle(shuffled)
        train_target, val_target, warnings = self._build_split(len(shuffled), request.val_ratio)
        train_annotations = shuffled[:train_target]
        val_annotations = shuffled[train_target : train_target + val_target]

        exported_train = 0
        for idx, annotation in enumerate(train_annotations):
            image_name = f"img_train_{idx:06d}.jpg"
            label_name = f"img_train_{idx:06d}.txt"
            ok = self._write_sample(
                project_path=project_path,
                annotation=annotation,
                dst_image=images_train / image_name,
                dst_label=labels_train / label_name,
            )
            if ok:
                exported_train += 1

        exported_val = 0
        for idx, annotation in enumerate(val_annotations):
            image_name = f"img_val_{idx:06d}.jpg"
            label_name = f"img_val_{idx:06d}.txt"
            ok = self._write_sample(
                project_path=project_path,
                annotation=annotation,
                dst_image=images_val / image_name,
                dst_label=labels_val / label_name,
            )
            if ok:
                exported_val += 1

        total_exported = exported_train + exported_val
        if total_exported == 0:
            raise ValueError("No exportable frame files found. Ensure project frames exist.")

        val_ref = "images/val"
        if exported_val == 0:
            val_ref = "images/train"
            warnings.append("Validation subset is empty; `val` was set to `images/train` fallback.")

        yaml_data = {
            "path": str(output_path.absolute()),
            "train": "images/train",
            "val": val_ref,
            "names": {i: name for i, name in enumerate(project["class_names"])}
        }

        with (output_path / "data.yaml").open("w", encoding="utf-8") as f:
            yaml.dump(yaml_data, f, default_flow_style=False, sort_keys=False)

        return {
            "output_path": output_path,
            "exported_frames": total_exported,
            "split_counts": {"train": exported_train, "val": exported_val},
            "warnings": warnings,
        }
