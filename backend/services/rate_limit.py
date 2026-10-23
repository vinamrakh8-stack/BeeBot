"""Small in-process sliding-window rate limiter for expensive AI endpoints.

A single-process Flask deployment is the documented Phase 1/2 setup. A
multi-worker deployment should move this to Redis or the reverse proxy.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from api_utils import ApiError


class RateLimiter:
    def __init__(self, limit: int, window_seconds: float = 60.0) -> None:
        self.limit = max(1, int(limit))
        self.window_seconds = float(window_seconds)
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            events = self._events[key]
            while events and events[0] <= cutoff:
                events.popleft()
            if len(events) >= self.limit:
                retry_after = max(1, int(events[0] + self.window_seconds - now) + 1)
                raise ApiError(
                    f"Too many AI requests. Try again in about {retry_after} seconds.",
                    status=429,
                    code="rate_limited",
                    headers={"Retry-After": str(retry_after)},
                )
            events.append(now)

    def reset(self, key: str | None = None) -> None:
        with self._lock:
            if key is None:
                self._events.clear()
            else:
                self._events.pop(key, None)
