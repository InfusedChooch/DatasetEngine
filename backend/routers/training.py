from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import settings
from models.schemas import TrainingCreateRequest
from services.trainer_service import trainer_service

router = APIRouter()


class BrowseResponse(BaseModel):
    path: str


@router.get("/pickers")
async def get_pickers():
    try:
        return trainer_service.get_pickers()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read pickers: {exc}")


@router.get("/browse", response_model=BrowseResponse)
async def browse(kind: str = Query(..., pattern="^(yaml|model|weights|dir|dataset)$")):
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    selected = ""
    try:
        if kind == "yaml":
            selected = filedialog.askopenfilename(
                title="Select YAML Config",
                initialdir=str((settings.PROJECTS_PATH / "trainer" / "configs").resolve()),
                filetypes=[("YAML files", "*.yaml *.yml"), ("All files", "*.*")],
            )
        elif kind in ("model", "weights"):
            selected = filedialog.askopenfilename(
                title="Select Model/Weights",
                initialdir=str((settings.BASE_PATH / "models").resolve()),
                filetypes=[
                    ("Model files", "*.pt *.onnx *.engine"),
                    ("PyTorch", "*.pt"),
                    ("ONNX", "*.onnx"),
                    ("TensorRT", "*.engine"),
                    ("All files", "*.*"),
                ],
            )
        elif kind == "dataset":
            selected = filedialog.askdirectory(
                title="Select Dataset Root",
                initialdir=str(settings.DATASETS_PATH.resolve()),
            )
        else:
            selected = filedialog.askdirectory(
                title="Select Folder",
                initialdir=str(settings.BASE_PATH.resolve()),
            )
    finally:
        root.destroy()

    return {"path": str(Path(selected).resolve()) if selected else ""}


@router.post("/create_stream")
async def create_stream(request: TrainingCreateRequest):
    try:
        stream = trainer_service.create_stream(request)
        return StreamingResponse(stream, media_type="application/x-ndjson")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to start training job: {exc}")


@router.post("/stop")
async def stop_active_job():
    result = trainer_service.stop_active_job()
    if not result.get("stopped"):
        raise HTTPException(status_code=409, detail=result.get("message", "No active job"))
    return result


@router.get("/status")
async def training_status():
    return trainer_service.get_status()


@router.get("/history")
async def training_history(limit: int = Query(50, ge=1, le=300)):
    return {"items": trainer_service.get_history(limit)}
