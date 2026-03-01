from __future__ import annotations

import threading
from typing import Optional

import cv2
import numpy as np


class WebcamSource:
    def __init__(self, device_index: int = 0, target_fps: int = 15) -> None:
        self.device_index = int(device_index)
        self.target_fps = int(target_fps)
        self._cap: Optional[cv2.VideoCapture] = None
        self._lock = threading.Lock()

    def start(self) -> None:
        backends = [cv2.CAP_DSHOW, cv2.CAP_MSMF, cv2.CAP_ANY]
        last_error = ""
        for backend in backends:
            cap = cv2.VideoCapture(self.device_index, backend)
            if not cap.isOpened():
                cap.release()
                continue

            cap.set(cv2.CAP_PROP_FPS, float(self.target_fps))
            with self._lock:
                self._cap = cap
            return

        last_error = f"Unable to open webcam device index {self.device_index}."
        raise RuntimeError(last_error)

    def read(self) -> Optional[np.ndarray]:
        with self._lock:
            cap = self._cap
        if cap is None:
            return None

        ok, frame = cap.read()
        if not ok or frame is None:
            return None
        return frame

    def stop(self) -> None:
        with self._lock:
            cap = self._cap
            self._cap = None
        if cap is not None:
            cap.release()

    def reconnect(self) -> None:
        self.stop()
        self.start()
