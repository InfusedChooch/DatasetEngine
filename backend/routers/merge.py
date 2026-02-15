from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from models.schemas import MergeRequest, DatasetInfo
from services.merger import MergerService
from utils.dialogs import open_file_dialog, open_folder_dialog

router = APIRouter()
merger = MergerService()

@router.post("/info", response_model=DatasetInfo)
async def get_dataset_info_endpoint(payload: dict):
    path = payload.get("path")
    if not path: raise HTTPException(400, "Path required")
    try:
        return merger.get_dataset_info(path)
    except Exception as e:
        raise HTTPException(500, str(e))

@router.get("/browse_file")
async def browse_file_endpoint():
    p = open_file_dialog()
    return {"path": p if p else ""}

@router.get("/browse_folder")
async def browse_folder_endpoint():
    p = open_folder_dialog()
    return {"path": p if p else ""}

@router.post("/execute")
async def execute_merge(request: MergeRequest):
    """
    A JSON event stream (NDJSON) returns to update the UI in real time.
    """
    return StreamingResponse(
        merger.merge_datasets_generator(request),
        media_type="application/x-ndjson"
    )