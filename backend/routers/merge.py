from fastapi import APIRouter, HTTPException
from models.schemas import MergeRequest
from services.merger import MergerService

router = APIRouter()
merger = MergerService()

@router.post("/execute")
async def execute_merge(request: MergeRequest):
    try:
        output_path = merger.merge_datasets(request)
        return {
            "success": True,
            "output_path": str(output_path),
            "message": f"Datasets merged successfully into {request.output_name}"
        }
    except Exception as e:
        raise HTTPException(500, f"Merge failed: {str(e)}")