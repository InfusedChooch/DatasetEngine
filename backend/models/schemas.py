from pydantic import BaseModel, ConfigDict, Field
from typing import List, Optional, Dict, Any, Literal
from enum import Enum

# Analyzer
class SplitStat(BaseModel):
    total_images: int = 0
    total_labels: int = 0
    class_distribution: Dict[str, int] = {}
    image_distribution: Dict[str, int] = {}

class DatasetStats(BaseModel):
    dataset_id: str
    name: str
    total_images: int
    total_labels: int
    classes: Dict[int, str]
    class_distribution: Dict[str, int]
    image_distribution: Dict[str, int] = {}
    split_stats: Dict[str, SplitStat] = {} 
    image_paths: List[str]
    path: str
    avg_labels_per_image: float
    background_images: int
    box_size_distribution: Dict[str, int]
    duplicate_images: int
    duplicate_labels: Dict[str, int]
    duplicate_groups: List[List[str]]

class AnalyzePathRequest(BaseModel):
    path: str
    split: str = "all"


class CleanupRequest(BaseModel):
    dataset_path: str
    duplicate_groups: List[List[str]]
    clean_images: bool = False
    clean_labels: bool = False

class ResplitRequest(BaseModel):
    dataset_path: str
    train_pct: int
    val_pct: int
    test_pct: int
    priority_classes: List[str] = [] 
    output_folder: str = ""          
    is_preview: bool = False

# Merger
class DatasetInfo(BaseModel):
    """Info preliminari per la UI del merger"""
    path: str
    name: str
    classes: Dict[int, str]
    total_images: int
    split_stats: Dict[str, int] # {'train': 100, 'val': 20...}

class MergeMappingRule(BaseModel):
    dataset_index: int     # 0 = Master, 1+ = Clients
    source_class_id: int
    target_class_id: int   # -1 = Drop

class MergeRequest(BaseModel):
    datasets: List[DatasetInfo] # Ordered list :[0] is the Master
    target_classes: List[str]   # The final list of class names (es: ['ball', 'hoop', 'new_class'])
    mappings: List[MergeMappingRule] # conversion roles ID -> ID
    output_path: str
    split_ratios: List[float] # [train, val, test] es: [0.7, 0.2, 0.1]
    seed: int = 42

# Model Improvement
class FilterMode(str, Enum):
    ALL = "all"
    NO_DETECTION = "no_detection"
    LOW_CONFIDENCE = "low_confidence"
    HIGH_CONFIDENCE = "high_confidence"

class BoundingBox(BaseModel):
    class_id: int
    class_name: str
    x_center: float
    y_center: float
    width: float
    height: float
    confidence: float

class FrameInference(BaseModel):
    frame_id: int
    frame_path: str
    boxes: List[BoundingBox]
    is_annotated: bool = False
    include_in_training: bool = False

class FrameAnnotation(BaseModel):
    frame_id: int
    boxes: List[BoundingBox]
    include_in_training: bool

class Project(BaseModel):
    project_id: str
    name: str
    model_path: str
    source_type: str
    source_path: Optional[str] = None
    total_frames: int = 0
    class_names: List[str] = []

class InferenceRequest(BaseModel):
    project_id: str
    confidence: float = 0.25
    sampling_rate: int = 30

class FilterRequest(BaseModel):
    project_id: str
    mode: FilterMode
    confidence_threshold: float = 0.50

# Video-to-Dataset
class VideoProcessRequest(BaseModel):
    session_id: str
    model_path: str
    sampling_rate: int = 10
    confidence: float = 0.25

class VideoFrameAnnotation(BaseModel):
    frame_id: int
    session_id: str
    boxes: List[BoundingBox]
    included: bool = False

# Export
class ExportRequest(BaseModel):
    project_id: Optional[str] = None
    session_id: Optional[str] = None
    output_name: str
    selected_frames: Optional[List[int]] = None
    include_all: bool = False
    val_ratio: float = Field(0.2, ge=0.0, le=0.9)
    split_seed: int = 42


# Trainer
TrainingCommand = Literal["train", "export", "validate", "split"]


class TrainParams(BaseModel):
    data: str
    model: str = "yolov8s.pt"
    imgsz: int = 640
    epochs: int = 100
    batch: int = -1
    device: str = "auto"
    name: str = ""
    patience: int = 30
    workers: int = 8
    seed: int = 42
    resume: bool = False
    export_formats: str = "onnx,engine"
    publish: bool = True
    publish_dir: str = ""


class ExportParams(BaseModel):
    weights: str
    imgsz: int = 640
    formats: str = "onnx,engine"
    name: str = ""
    publish: bool = True
    publish_dir: str = ""


class ValidateParams(BaseModel):
    weights: str
    data: str
    imgsz: int = 640
    device: str = "auto"
    batch: int = -1


class SplitParams(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    dataset: str
    val_fraction: float = 0.2
    seed: int = 42
    copy_mode: bool = Field(False, alias="copy")
    update_yaml: bool = True
    dry_run: bool = False


class TrainingCreateRequest(BaseModel):
    command: TrainingCommand
    params: Dict[str, Any]
    dry_run: bool = False

    def normalized_params(self) -> Dict[str, Any]:
        validators = {
            "train": TrainParams,
            "export": ExportParams,
            "validate": ValidateParams,
            "split": SplitParams,
        }
        model_cls = validators[self.command]
        return model_cls(**self.params).model_dump(by_alias=True)


# Live Inference
LiveSourceType = Literal["screen", "webcam", "udp", "youtube_live"]


class LiveROI(BaseModel):
    x: int = Field(0, ge=0)
    y: int = Field(0, ge=0)
    w: int = Field(0, ge=0)
    h: int = Field(0, ge=0)


class LiveUDPConfig(BaseModel):
    ip: str = "127.0.0.1"
    port: int = Field(4958, ge=1, le=65535)
    target_fps: int = Field(60, ge=1, le=240)


class LiveStartRequest(BaseModel):
    source_type: LiveSourceType
    model_path: str
    target_fps: int = Field(15, ge=1, le=60)
    imgsz: int = Field(640, ge=64, le=2048)
    confidence: float = Field(0.25, ge=0.01, le=0.99)
    roi: Optional[LiveROI] = None
    udp: Optional[LiveUDPConfig] = None
    youtube_url: str = ""
    project_name: str = ""
    device_index: int = Field(0, ge=0)
    auto_capture_interval: float = Field(0.0, ge=0.0, le=3600.0)
    auto_capture_min_confidence: float = Field(0.0, ge=0.0, le=1.0)


class LiveStopRequest(BaseModel):
    session_id: str = ""


class LiveCaptureRequest(BaseModel):
    session_id: str
    include_in_training: bool = True


class LiveFrameRequest(BaseModel):
    session_id: str
    image_jpeg_base64: str
