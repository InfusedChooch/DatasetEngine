from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path
import uuid
import os
from services.analyzer import AnalyzerService
from models.schemas import AnalyzePathRequest, DatasetStats, CleanupRequest
# Assicurati di aver creato il file backend/utils/dialogs.py come detto nei passaggi precedenti
from utils.dialogs import open_file_dialog 

router = APIRouter()
analyzer = AnalyzerService()

@router.get("/browse")
async def browse_file():
    """
    Apre la finestra di dialogo di Windows sul server per selezionare il file.
    """
    try:
        path = open_file_dialog()
        return {"path": path if path else ""}
    except Exception as e:
        print(f"Errore Dialog: {e}")
        return {"path": ""}

@router.post("/local", response_model=DatasetStats)
async def analyze_local_dataset(request: AnalyzePathRequest):
    """
    Analizza un dataset locale dato il percorso del file data.yaml.
    """
    try:
        # Generiamo un ID sessione, ma i dati restano dove sono
        dataset_id = str(uuid.uuid4())
        stats = analyzer.analyze_dataset(request.path, dataset_id)
        return stats
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        print(f"Errore Analisi: {e}")
        raise HTTPException(status_code=500, detail=f"Errore durante l'analisi: {str(e)}")

@router.post("/cleanup")
async def cleanup_dataset_endpoint(request: CleanupRequest):
    """
    Esegue la pulizia fisica dei file duplicati.
    """
    try:
        result = analyzer.cleanup_dataset(request)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/image")
async def get_local_image(path: str):
    """
    Legge un file locale e lo restituisce al browser come stream di byte.
    Aggira le restrizioni di sicurezza del browser che impediscono di caricare file locali.
    """
    try:
        file_path = Path(path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Image not found")
        
        # Determina il Content-Type corretto
        suffix = file_path.suffix.lower()
        media_type = "image/jpeg" # Default
        if suffix == ".png": media_type = "image/png"
        elif suffix == ".webp": media_type = "image/webp"
        elif suffix in [".bmp", ".gif"]: media_type = f"image/{suffix[1:]}"
        
        return FileResponse(file_path, media_type=media_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error serving image: {str(e)}")