from pathlib import Path
from pydantic import model_validator
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    BASE_PATH: Path = Path(__file__).resolve().parent.parent
    DATASETS_PATH: Path | None = None
    PROJECTS_PATH: Path | None = None
    TEMP_PATH: Path | None = None
    EXPORTS_PATH: Path | None = None
    
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

    @model_validator(mode="after")
    def resolve_paths(self):
        base = self.BASE_PATH if self.BASE_PATH.is_absolute() else (Path.cwd() / self.BASE_PATH)
        self.BASE_PATH = base.resolve()
        self.DATASETS_PATH = self._resolve_child_path(self.DATASETS_PATH, "datasets")
        self.PROJECTS_PATH = self._resolve_child_path(self.PROJECTS_PATH, "projects")
        self.TEMP_PATH = self._resolve_child_path(self.TEMP_PATH, "temp")
        self.EXPORTS_PATH = self._resolve_child_path(self.EXPORTS_PATH, "exports")
        return self

    def _resolve_child_path(self, candidate: Path | None, default_child: str) -> Path:
        if candidate is None:
            return (self.BASE_PATH / default_child).resolve()
        if candidate.is_absolute():
            return candidate.resolve()
        return (self.BASE_PATH / candidate).resolve()
    
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
