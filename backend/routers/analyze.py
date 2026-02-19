from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pathlib import Path
import uuid
import os
from services.analyzer import AnalyzerService
from models.schemas import AnalyzePathRequest, DatasetStats, CleanupRequest, ResplitRequest
from utils.dialogs import open_file_dialog 

router = APIRouter()
analyzer = AnalyzerService()

@router.get("/browse")
async def browse_file():
    """
    Opens the Windows dialog box on the server to select the file.
    """
    try:
        path = open_file_dialog()
        return {"path": path if path else ""}
    except Exception as e:
        print(f"Errore Dialog: {e}")
        return {"path": ""}

@router.post("/local")
async def analyze_local_dataset(request: AnalyzePathRequest):
    """
    Returns an NDJSON stream with real-time logs and progress.
    """
    try:
        dataset_id = str(uuid.uuid4())
        return StreamingResponse(
            analyzer.analyze_dataset_generator(request.path, dataset_id, request.split),
            media_type="application/x-ndjson"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/cleanup")
async def cleanup_dataset_endpoint(request: CleanupRequest):
    """
    Performs physical cleanup of duplicate files.
    """
    try:
        result = analyzer.cleanup_dataset(request)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/image")
async def get_local_image(path: str):
    """
    Reads a local file and returns it to the browser as a byte stream.
    """
    try:
        file_path = Path(path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Image not found")
        
        # Determine the correct Content-Type
        suffix = file_path.suffix.lower()
        media_type = "image/jpeg" # Default
        if suffix == ".png": media_type = "image/png"
        elif suffix == ".webp": media_type = "image/webp"
        elif suffix in [".bmp", ".gif"]: media_type = f"image/{suffix[1:]}"
        
        return FileResponse(file_path, media_type=media_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error serving image: {str(e)}")
    
@router.post("/resplit")
async def resplit_dataset_endpoint(request: ResplitRequest):
    try:
        return StreamingResponse(
            analyzer.resplit_dataset_generator(request),
            media_type="application/x-ndjson"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@router.get("/browse_folder")
async def browse_folder_endpoint():
    import tkinter as tk
    from tkinter import filedialog
    try:
        root = tk.Tk()
        root.withdraw()
        root.attributes('-topmost', True) 
        folder_path = filedialog.askdirectory(title="Select Output Folder")
        root.destroy()
        return {"path": folder_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))