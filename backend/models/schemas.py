from pydantic import BaseModel
from typing import List, Optional, Dict, Any
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