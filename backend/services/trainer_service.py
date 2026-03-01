from __future__ import annotations

import json
import re
import subprocess
import sys
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Generator

import yaml

from config import settings
from models.schemas import TrainingCreateRequest


class TrainerService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._active_job: dict[str, Any] | None = None
        self._last_result: dict[str, Any] | None = None

        self.trainer_root = settings.PROJECTS_PATH / "trainer"
        self.configs_dir = self.trainer_root / "configs"
        self.runs_dir = self.trainer_root / "runs"
        self.artifacts_dir = settings.EXPORTS_PATH / "trainer_artifacts"
        self.models_dir = settings.BASE_PATH / "models"
        self.history_path = self.trainer_root / "job_history.json"
        self.runner_script = Path(__file__).resolve().parent / "training_runner.py"

        self._ensure_directories()

    def _ensure_directories(self) -> None:
        for path in [
            self.trainer_root,
            self.configs_dir,
            self.runs_dir,
            self.artifacts_dir,
            self.models_dir,
        ]:
            path.mkdir(parents=True, exist_ok=True)

        if not self.history_path.exists():
            self.history_path.write_text("[]\n", encoding="utf-8")

    def _utc_now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _json_event(self, payload: dict[str, Any]) -> str:
        return json.dumps(payload) + "\n"

    def _is_job_running(self, job: dict[str, Any] | None) -> bool:
        if not job:
            return False
        process = job.get("process")
        return process is not None and process.poll() is None

    def _safe_iterdir(self, path: Path) -> list[Path]:
        try:
            return list(path.iterdir())
        except Exception:
            return []

    def _read_history(self) -> list[dict[str, Any]]:
        try:
            return json.loads(self.history_path.read_text(encoding="utf-8"))
        except Exception:
            return []

    def _write_history(self, history: list[dict[str, Any]]) -> None:
        self.history_path.write_text(json.dumps(history, indent=2), encoding="utf-8")

    def _append_history(self, entry: dict[str, Any]) -> None:
        history = self._read_history()
        history.insert(0, entry)
        self._write_history(history[:300])

    def get_history(self, limit: int = 50) -> list[dict[str, Any]]:
        history = self._read_history()
        return history[: max(1, min(limit, 300))]

    def _as_public_job(self, job: dict[str, Any]) -> dict[str, Any]:
        return {
            "job_id": job.get("job_id"),
            "command": job.get("command"),
            "status": "running" if self._is_job_running(job) else "finished",
            "started_at": job.get("started_at"),
            "stop_requested": bool(job.get("stop_requested")),
            "artifact_dir": job.get("artifact_dir") or "",
            "publish_dir": job.get("publish_dir") or "",
            "run_name": job.get("run_name") or "",
            "pid": getattr(job.get("process"), "pid", None),
        }

    def get_status(self) -> dict[str, Any]:
        with self._lock:
            active = self._active_job
            if active and self._is_job_running(active):
                return {"active": True, "job": self._as_public_job(active), "last_result": self._last_result}
            return {"active": False, "job": None, "last_result": self._last_result}

    def _resolve_any_path(self, raw_value: str | Path) -> Path:
        path = Path(raw_value)
        if not path.is_absolute():
            path = (settings.BASE_PATH / path).resolve()
        else:
            path = path.resolve()
        return path

    def _read_yaml_mapping(self, config_path: Path) -> dict[str, Any]:
        try:
            loaded = yaml.safe_load(config_path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise ValueError(f"Failed to parse yaml: {config_path} ({exc})") from exc
        if not isinstance(loaded, dict):
            raise ValueError(f"YAML must contain a mapping/object at root: {config_path}")
        return loaded

    def _resolve_dataset_root_from_config(self, config_path: Path, raw_dataset_path: str) -> Path:
        path_obj = Path(str(raw_dataset_path).strip())
        if path_obj.is_absolute():
            return path_obj.resolve()
        return (config_path.parent / path_obj).resolve()

    def _find_dataset_remap_candidate(self, raw_dataset_path: str) -> Path | None:
        token = Path(str(raw_dataset_path)).name
        if not token:
            return None

        candidates = [p for p in self._safe_iterdir(settings.DATASETS_PATH) if p.is_dir()]
        if not candidates:
            return None

        token_lc = token.lower()
        direct = next((p for p in candidates if p.name.lower() == token_lc), None)
        if direct:
            return direct.resolve()

        stem_lc = Path(token).stem.lower()
        if stem_lc:
            prefix = next((p for p in candidates if p.name.lower().startswith(stem_lc)), None)
            if prefix:
                return prefix.resolve()
        return None

    def _inspect_training_config(self, config_path: Path, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        status = {
            "config_path": str(config_path.resolve()),
            "dataset_path": "",
            "exists": False,
            "normalized_path": "",
        }

        if payload is None:
            try:
                payload = self._read_yaml_mapping(config_path)
            except Exception:
                return status

        raw_dataset_path = payload.get("path")
        if not isinstance(raw_dataset_path, str) or not raw_dataset_path.strip():
            return status

        dataset_root = self._resolve_dataset_root_from_config(config_path, raw_dataset_path)
        status["dataset_path"] = str(dataset_root)
        status["exists"] = dataset_root.exists()

        if not status["exists"]:
            remap = self._find_dataset_remap_candidate(raw_dataset_path)
            if remap is not None:
                status["normalized_path"] = str(remap)
        return status

    def _ensure_config_dataset_paths(self, data_yaml: str) -> None:
        config_path = self._resolve_any_path(data_yaml)
        if not config_path.exists():
            raise ValueError(f"Data YAML not found: {config_path}")

        if config_path.suffix.lower() not in (".yaml", ".yml"):
            raise ValueError(f"Unsupported config format: {config_path}. Expected .yaml/.yml")

        payload = self._read_yaml_mapping(config_path)
        status = self._inspect_training_config(config_path, payload=payload)

        if not status["dataset_path"]:
            raise ValueError(
                f"Config '{config_path}' has no `path:` entry. Set it to your dataset root in datasets/."
            )
        if not status["exists"]:
            suggestion = status["normalized_path"]
            if suggestion:
                raise ValueError(
                    f"Config dataset path is invalid: {status['dataset_path']}. "
                    f"Suggested remap: {suggestion}. Update `path:` in the yaml before running."
                )
            raise ValueError(
                f"Config dataset path does not exist: {status['dataset_path']}. "
                "Update `path:` in the yaml before running."
            )

        dataset_root = Path(status["dataset_path"])
        for split_key in ("train", "val"):
            split_value = payload.get(split_key)
            if not isinstance(split_value, str) or not split_value.strip():
                raise ValueError(f"Config '{config_path}' is missing `{split_key}:` entry.")
            split_path = Path(split_value)
            split_abs = split_path.resolve() if split_path.is_absolute() else (dataset_root / split_path).resolve()
            if not split_abs.exists():
                raise ValueError(
                    f"Config '{config_path}' points `{split_key}` to missing path: {split_abs}. "
                    "Fix train/val paths before running."
                )

    def get_pickers(self) -> dict[str, Any]:
        self._ensure_directories()
        config_files: list[Path] = []
        for pattern in ("*.yaml", "*.yml"):
            config_files.extend(self.configs_dir.glob(pattern))

        model_candidates: list[Path] = []
        ext_patterns = ("*.pt", "*.onnx", "*.engine")
        for pattern in ext_patterns:
            model_candidates.extend(self.models_dir.glob(pattern))
            model_candidates.extend(self.artifacts_dir.rglob(pattern))
            model_candidates.extend(self.runs_dir.rglob(pattern))

        datasets: list[Path] = []
        for child in sorted(self._safe_iterdir(settings.DATASETS_PATH), key=lambda p: p.name.lower()):
            if child.is_dir():
                datasets.append(child)

        configs_sorted = sorted({path.resolve() for path in config_files}, key=lambda p: str(p).lower())
        models_sorted = sorted({str(path.resolve()) for path in model_candidates}, key=str.lower)

        config_status = [self._inspect_training_config(path) for path in configs_sorted]

        return {
            "configs": [str(path) for path in configs_sorted],
            "models": models_sorted,
            "weights": models_sorted,
            "datasets": [str(path.resolve()) for path in datasets],
            "config_status": config_status,
            "default_paths": {
                "configs_dir": str(self.configs_dir.resolve()),
                "runs_dir": str(self.runs_dir.resolve()),
                "artifacts_dir": str(self.artifacts_dir.resolve()),
                "publish_dir": str(self.models_dir.resolve()),
                "datasets_dir": str(settings.DATASETS_PATH.resolve()),
            },
        }

    def _preflight_command(self, command: str, params: dict[str, Any]) -> None:
        if command in ("train", "validate"):
            self._ensure_config_dataset_paths(str(params.get("data", "")))
        elif command == "export":
            weights = self._resolve_any_path(str(params.get("weights", "")))
            if not weights.exists():
                raise ValueError(f"Weights file not found: {weights}")
        elif command == "split":
            dataset = self._resolve_any_path(str(params.get("dataset", "")))
            if not dataset.exists():
                raise ValueError(f"Dataset path not found: {dataset}")

    def _build_subprocess_command(self, command: str, params: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
        cmd = [sys.executable, "-u", str(self.runner_script), command]
        derived: dict[str, Any] = {
            "artifact_dir": "",
            "publish_dir": "",
            "run_name": "",
        }

        if command == "train":
            cmd.extend(["--data", str(params["data"])])
            cmd.extend(["--model", str(params.get("model", "yolov8s.pt"))])
            cmd.extend(["--imgsz", str(params.get("imgsz", 640))])
            cmd.extend(["--epochs", str(params.get("epochs", 100))])
            cmd.extend(["--batch", str(params.get("batch", -1))])
            cmd.extend(["--device", str(params.get("device", "auto"))])
            cmd.extend(["--project", str(self.runs_dir.resolve())])
            cmd.extend(["--patience", str(params.get("patience", 30))])
            cmd.extend(["--workers", str(params.get("workers", 8))])
            cmd.extend(["--seed", str(params.get("seed", 42))])
            cmd.extend(["--export", str(params.get("export_formats", "onnx,engine"))])
            publish_dir = str(params.get("publish_dir") or self.models_dir.resolve())
            cmd.extend(["--publish-dir", publish_dir])
            if params.get("name"):
                cmd.extend(["--name", str(params["name"])])
                derived["run_name"] = str(params["name"])
                derived["artifact_dir"] = str((self.artifacts_dir / str(params["name"])).resolve())
            if bool(params.get("resume")):
                cmd.append("--resume")
            if bool(params.get("publish", True)):
                cmd.append("--publish")
                derived["publish_dir"] = str(Path(publish_dir).resolve())
            else:
                cmd.append("--no-publish")

        elif command == "export":
            cmd.extend(["--weights", str(params["weights"])])
            cmd.extend(["--imgsz", str(params.get("imgsz", 640))])
            cmd.extend(["--formats", str(params.get("formats", "onnx,engine"))])
            publish_dir = str(params.get("publish_dir") or self.models_dir.resolve())
            cmd.extend(["--publish-dir", publish_dir])
            if params.get("name"):
                cmd.extend(["--name", str(params["name"])])
                derived["run_name"] = str(params["name"])
            if bool(params.get("publish", True)):
                cmd.append("--publish")
                derived["publish_dir"] = str(Path(publish_dir).resolve())
            else:
                cmd.append("--no-publish")

        elif command == "validate":
            cmd.extend(["--weights", str(params["weights"])])
            cmd.extend(["--data", str(params["data"])])
            cmd.extend(["--imgsz", str(params.get("imgsz", 640))])
            cmd.extend(["--device", str(params.get("device", "auto"))])
            cmd.extend(["--batch", str(params.get("batch", -1))])

        elif command == "split":
            cmd.extend(["--dataset", str(params["dataset"])])
            cmd.extend(["--val-fraction", str(params.get("val_fraction", 0.2))])
            cmd.extend(["--seed", str(params.get("seed", 42))])
            if bool(params.get("copy", False)):
                cmd.append("--copy")
            if not bool(params.get("update_yaml", True)):
                cmd.append("--no-update-yaml")
            if bool(params.get("dry_run", False)):
                cmd.append("--dry-run")
        else:
            raise ValueError(f"Unsupported training command: {command}")

        return cmd, derived

    def _parse_meta_line(self, line: str, job: dict[str, Any]) -> bool:
        match = re.match(r"^\[META\]\s+([^=]+)=(.+)$", line.strip())
        if not match:
            return False
        key = match.group(1).strip()
        value = match.group(2).strip()
        if key == "artifact_dir":
            job["artifact_dir"] = value
        elif key == "publish_dir":
            job["publish_dir"] = value
        elif key == "run_name":
            job["run_name"] = value
        return True

    def _parse_progress_event(self, line: str) -> dict[str, Any] | None:
        text = line.strip()
        ratio = re.search(r"\b(\d+)\s*/\s*(\d+)\b", text)
        percent = re.search(r"(\d{1,3}(?:\.\d+)?)\s*%", text)
        if not ratio and not percent:
            return None

        payload: dict[str, Any] = {"type": "progress", "log": text}
        if ratio:
            payload["current"] = int(ratio.group(1))
            payload["total"] = int(ratio.group(2))
        if percent:
            payload["percent"] = float(percent.group(1))
        elif ratio:
            total = max(1, int(ratio.group(2)))
            payload["percent"] = round((int(ratio.group(1)) / total) * 100.0, 1)
        return payload

    def _finalize_job(self, job: dict[str, Any], status: str, return_code: int) -> dict[str, Any]:
        ended_at = self._utc_now()
        result = {
            "job_id": job["job_id"],
            "command": job["command"],
            "status": status,
            "return_code": return_code,
            "started_at": job["started_at"],
            "ended_at": ended_at,
            "params": job["params"],
            "artifact_dir": job.get("artifact_dir") or "",
            "publish_dir": job.get("publish_dir") or "",
            "run_name": job.get("run_name") or "",
        }
        self._append_history(result)
        self._last_result = result
        with self._lock:
            if self._active_job and self._active_job.get("job_id") == job["job_id"]:
                self._active_job = None
        return result

    def create_stream(self, request: TrainingCreateRequest) -> Generator[str, None, None]:
        params = request.normalized_params()
        self._preflight_command(request.command, params)

        if request.dry_run:
            dry_cmd, _ = self._build_subprocess_command(request.command, params)

            def dry_stream() -> Generator[str, None, None]:
                yield self._json_event({"type": "status", "state": "dry_run"})
                yield self._json_event({"type": "log", "msg": "Dry-run only. No process started."})
                yield self._json_event({"type": "log", "msg": " ".join(dry_cmd)})
                yield self._json_event({"type": "complete", "status": "dry_run", "return_code": 0})

            return dry_stream()

        with self._lock:
            if self._active_job and self._is_job_running(self._active_job):
                raise RuntimeError("A training job is already running.")

            cmd, derived = self._build_subprocess_command(request.command, params)
            process = subprocess.Popen(
                cmd,
                cwd=str((settings.BASE_PATH / "backend").resolve()),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )

            job = {
                "job_id": str(uuid.uuid4()),
                "command": request.command,
                "params": params,
                "started_at": self._utc_now(),
                "process": process,
                "stop_requested": False,
                "artifact_dir": derived.get("artifact_dir", ""),
                "publish_dir": derived.get("publish_dir", ""),
                "run_name": derived.get("run_name", ""),
            }
            self._active_job = job

        def stream() -> Generator[str, None, None]:
            process = job["process"]
            return_code = 1
            finalized = False
            try:
                yield self._json_event({"type": "status", "state": "running", "job": self._as_public_job(job)})
                yield self._json_event({"type": "log", "msg": f"$ {' '.join(cmd)}"})
                if process.stdout is not None:
                    for raw_line in process.stdout:
                        line = raw_line.rstrip("\r\n")
                        if not line:
                            continue
                        if self._parse_meta_line(line, job):
                            continue
                        progress = self._parse_progress_event(line)
                        if progress:
                            yield self._json_event(progress)
                        yield self._json_event({"type": "log", "msg": line})

                return_code = int(process.wait())
                stop_requested = bool(job.get("stop_requested"))
                status = "canceled" if stop_requested else ("completed" if return_code == 0 else "failed")
                summary = self._finalize_job(job, status=status, return_code=return_code)
                finalized = True

                if status == "failed":
                    yield self._json_event(
                        {
                            "type": "error",
                            "status": status,
                            "return_code": return_code,
                            "artifact_dir": summary.get("artifact_dir", ""),
                            "publish_dir": summary.get("publish_dir", ""),
                        }
                    )
                else:
                    yield self._json_event(
                        {
                            "type": "complete",
                            "status": status,
                            "return_code": return_code,
                            "artifact_dir": summary.get("artifact_dir", ""),
                            "publish_dir": summary.get("publish_dir", ""),
                        }
                    )
            finally:
                if not finalized:
                    if process.poll() is None:
                        try:
                            process.terminate()
                            process.wait(timeout=3)
                        except Exception:
                            try:
                                process.kill()
                            except Exception:
                                pass
                    rc = int(process.poll() if process.poll() is not None else return_code)
                    status = "canceled" if job.get("stop_requested") else ("completed" if rc == 0 else "failed")
                    self._finalize_job(job, status=status, return_code=rc)

        return stream()

    def stop_active_job(self) -> dict[str, Any]:
        with self._lock:
            job = self._active_job
            if not self._is_job_running(job):
                return {"stopped": False, "message": "No active training job."}
            assert job is not None
            process = job["process"]
            job["stop_requested"] = True

        try:
            process.terminate()
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
        except Exception as exc:
            return {"stopped": False, "message": f"Failed to stop job: {exc}"}

        return {"stopped": True, "job_id": job["job_id"]}


trainer_service = TrainerService()
