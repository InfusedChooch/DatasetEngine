from __future__ import annotations

import socket
import threading
import time
from typing import Optional

import cv2
import numpy as np


class UDPMJPEGSource:
    """
    Minimal MJPEG-over-UDP receiver adapted from the existing GHL implementation.
    Keeps only the latest valid decoded frame for low-latency consumers.
    """

    def __init__(self, ip: str, port: int, target_fps: int = 60) -> None:
        self.ip = str(ip).strip()
        self.port = int(port)
        self.target_fps = int(target_fps)

        self._socket: Optional[socket.socket] = None
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

        self._buffer = bytearray()
        self._buffer_lock = threading.Lock()

        self._frame_lock = threading.Lock()
        self._latest_frame: Optional[np.ndarray] = None
        self._last_frame_ts = 0.0

        self.decode_ok = 0
        self.decode_fail = 0

    def start(self) -> None:
        self.stop()
        self._stop_event.clear()
        self._buffer = bytearray()

        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024 * 1024)
        sock.settimeout(1.0)
        sock.bind((self.ip, self.port))

        self._socket = sock
        self._thread = threading.Thread(target=self._receive_loop, daemon=True)
        self._thread.start()

    def _decode_jpeg(self, jpeg_bytes: bytes) -> Optional[np.ndarray]:
        array = np.frombuffer(jpeg_bytes, dtype=np.uint8)
        frame = cv2.imdecode(array, cv2.IMREAD_COLOR)
        if frame is None:
            self.decode_fail += 1
            return None
        self.decode_ok += 1
        return frame

    def _receive_loop(self) -> None:
        while not self._stop_event.is_set():
            sock = self._socket
            if sock is None:
                time.sleep(0.02)
                continue

            try:
                data, _ = sock.recvfrom(65535)
            except socket.timeout:
                continue
            except OSError:
                break
            except Exception:
                continue

            with self._buffer_lock:
                self._buffer.extend(data)
                if len(self._buffer) > 4 * 1024 * 1024:
                    # Packet loss/corruption guard.
                    self._buffer = self._buffer[-2 * 1024 * 1024 :]

                while True:
                    start = self._buffer.find(b"\xff\xd8")
                    if start < 0:
                        self._buffer.clear()
                        break
                    end = self._buffer.find(b"\xff\xd9", start + 2)
                    if end < 0:
                        if start > 0:
                            del self._buffer[:start]
                        break

                    jpeg = bytes(self._buffer[start : end + 2])
                    del self._buffer[: end + 2]

                    frame = self._decode_jpeg(jpeg)
                    if frame is None:
                        continue
                    with self._frame_lock:
                        self._latest_frame = frame
                        self._last_frame_ts = time.time()

    def read(self) -> Optional[np.ndarray]:
        with self._frame_lock:
            if self._latest_frame is None:
                return None
            return self._latest_frame.copy()

    def last_frame_age_seconds(self) -> float:
        with self._frame_lock:
            ts = self._last_frame_ts
        if ts <= 0:
            return 9999.0
        return max(0.0, time.time() - ts)

    def reconnect(self) -> None:
        self.stop()
        self.start()

    def stop(self) -> None:
        self._stop_event.set()
        thread = self._thread
        self._thread = None
        if thread is not None and thread.is_alive():
            thread.join(timeout=1.5)

        sock = self._socket
        self._socket = None
        if sock is not None:
            try:
                sock.close()
            except Exception:
                pass
