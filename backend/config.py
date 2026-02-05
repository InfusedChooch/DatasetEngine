from pathlib import Path
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    BASE_PATH: Path = Path.cwd() / "DatasetEngine"
    DATASETS_PATH: Path = BASE_PATH / "datasets"
    PROJECTS_PATH: Path = BASE_PATH / "projects"
    TEMP_PATH: Path = BASE_PATH / "temp"
    EXPORTS_PATH: Path = BASE_PATH / "exports"
    
    MAX_UPLOAD_SIZE: int = 2 * 1024 * 1024 * 1024
    SUPPORTED_FORMATS: dict = {
        "image": [".jpg", ".jpeg", ".png", ".bmp"],
        "video": [".mp4", ".avi", ".mov", ".mkv"],
        "model": [".pt", ".onnx"],
        "config": [".yaml", ".yml"]
    }
    
    CONFIDENCE_THRESHOLD: float = 0.25
    LOW_CONFIDENCE_THRESHOLD: float = 0.50
    FRAME_SAMPLING_RATE: int = 30
    
    def ensure_directories(self):
        for path in [self.DATASETS_PATH, self.PROJECTS_PATH, self.TEMP_PATH, self.EXPORTS_PATH]:
            path.mkdir(parents=True, exist_ok=True)
    
    def get_dataset_path(self, dataset_id: str) -> Path:
        path = self.DATASETS_PATH / dataset_id
        path.mkdir(exist_ok=True)
        return path
    
    def get_project_path(self, project_id: str) -> Path:
        path = self.PROJECTS_PATH / project_id
        path.mkdir(exist_ok=True)
        (path / "frames").mkdir(exist_ok=True)
        return path
    
    def get_video_session_path(self, session_id: str) -> Path:
        path = self.TEMP_PATH / session_id
        path.mkdir(exist_ok=True)
        (path / "frames").mkdir(exist_ok=True)
        return path
    
    class Config:
        env_file = ".env"

settings = Settings()