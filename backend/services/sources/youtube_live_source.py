from __future__ import annotations

from typing import Optional

import cv2
import numpy as np

from utils.youtube_dl import download_youtube_video


class YouTubeLiveSource:
    """
    Deferred adapter placeholder.
    Full live reconnect/refresh behavior is intentionally postponed to v1.1.
    """

    def __init__(self, youtube_url: str) -> None:
        self.youtube_url = youtube_url
        self._cap: Optional[cv2.VideoCapture] = None

    def start(self) -> None:
        raise RuntimeError(
            "youtube_live source is currently disabled (deferred to v1.1). "
            "Use screen/webcam/udp sources for live inference."
        )

    def read(self) -> Optional[np.ndarray]:
        if self._cap is None:
            return None
        ok, frame = self._cap.read()
        if not ok:
            return None
        return frame

    def stop(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None

    def reconnect(self) -> None:
        self.stop()
        self.start()
