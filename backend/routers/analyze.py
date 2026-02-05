from fastapi import APIRouter, UploadFile, HTTPException
from pathlib import Path
import uuid
from config import settings
from services.analyzer import AnalyzerService
from models.schemas import AnalyzePathRequest, DatasetStats
from utils.dialogs import open_file_dialog 

router = APIRouter()
analyzer = AnalyzerService()

@router.get("/browse")
async def browse_file():
    path = open_file_dialog()
    if not path:
        return {"path": ""}
    return {"path": path}

@router.post("/local", response_model=DatasetStats)
async def analyze_local_dataset(request: AnalyzePathRequest):
    try:
        # FIX LOGICA: Se l'utente passa una cartella, cerchiamo data.yaml dentro
        path_obj = Path(request.path)
        if path_obj.is_dir():
            possible_yaml = path_obj / "data.yaml"
            if possible_yaml.exists():
                path_obj = possible_yaml
            else:
                # Prova a vedere se c'è un .yml
                possible_yml = path_obj / "data.yml"
                if possible_yml.exists():
                    path_obj = possible_yml
                else:
                    raise FileNotFoundError(f"Nessun file data.yaml trovato nella cartella: {request.path}")
        
        # Ora passiamo il percorso del FILE, non della cartella
        dataset_id = str(uuid.uuid4())
        stats = analyzer.analyze_dataset(str(path_obj), dataset_id)
        return stats

    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        # Stampa l'errore nella console per debug
        print(f"Errore Backend: {e}")
        raise HTTPException(status_code=500, detail=f"Errore: {str(e)}")

@router.get("/stats/{dataset_id}")
async def get_stats(dataset_id: str):
    yaml_path = settings.get_dataset_path(dataset_id) / "data.yaml"
    
    if not yaml_path.exists():
        raise HTTPException(404, "Dataset not found")
    
    stats = analyzer.analyze_dataset(yaml_path, dataset_id)
    return stats

@router.get("/heatmap/{dataset_id}")
async def get_heatmap(dataset_id: str):
    yaml_path = settings.get_dataset_path(dataset_id) / "data.yaml"
    
    if not yaml_path.exists():
        raise HTTPException(404, "Dataset not found")
    
    stats = analyzer.analyze_dataset(yaml_path, dataset_id)
    return {
        "labels": list(stats.class_distribution.keys()),
        "counts": list(stats.class_distribution.values())
    }