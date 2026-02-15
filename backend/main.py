from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from config import settings
from routers import analyze, merge, improvement, viewer 

settings.ensure_directories()

app = FastAPI(
    title="Dataset Engine - Complete System",
    version="3.0.0",
    description="Professional dataset management + iterative model improvement"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/storage", StaticFiles(directory=str(settings.BASE_PATH)), name="storage")

app.include_router(viewer.router, prefix="/api/viewer", tags=["Dataset Viewer"]) 
app.include_router(analyze.router, prefix="/api/analyze", tags=["Analyzer"])
app.include_router(merge.router, prefix="/api/merge", tags=["Merger"])
app.include_router(improvement.router, prefix="/api/improve", tags=["Model Improvement"])

@app.get("/")
async def root():
    return {
        "message": "Dataset Engine - Complete System",
        "version": "3.0.0",
        "modules": [
            "Dataset Viewer - Visually explore datasets",
            "Analyzer - Understand your datasets",
            "Merger - Combine multiple datasets",
            "Model Improvement - Find & fix model failures"
        ]
    }

@app.get("/api/settings")
async def get_settings():
    return {
        "storage_path": str(settings.BASE_PATH),
        "datasets_path": str(settings.DATASETS_PATH),
        "projects_path": str(settings.PROJECTS_PATH),
        "exports_path": str(settings.EXPORTS_PATH)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)