from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
import tkinter as tk
from tkinter import filedialog
from services.viewer_service import ViewerService

router = APIRouter()
viewer_service = ViewerService()

class QueryRequest(BaseModel):
    splits: List[str] = ["all"]
    classes: Optional[List[int]] = None
    min_boxes: int = 0
    max_boxes: Optional[int] = None
    min_area: float = 0.0
    max_area: float = 1.0
    semantic_match: Optional[Dict[str, int]] = None
    page: int = 1
    limit: int = 20

@router.get("/browse_yaml")
async def browse_yaml():
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    p = filedialog.askopenfilename(
        title="Select data.yaml", 
        filetypes=[("YAML files", "*.yaml *.yml"), ("All files", "*.*")]
    )
    root.destroy()
    return {"path": p if p else ""}

@router.post("/load")
async def load_dataset(payload: dict):
    yaml_path = payload.get("path")
    if not yaml_path: raise HTTPException(400, "Path required")
    try:
        return viewer_service.load_dataset(yaml_path)
    except Exception as e:
        raise HTTPException(500, str(e))

@router.post("/query")
async def query_images(req: QueryRequest):
    try:
        return viewer_service.query_images(req.dict())
    except Exception as e:
        raise HTTPException(500, str(e))

@router.get("/image")
async def serve_image(path: str):
    return FileResponse(path)