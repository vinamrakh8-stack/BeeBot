"""Repo-root launcher for Bee Voice+.

    python app.py                 # API + built React app on http://127.0.0.1:5000
    python app.py init-db
    python app.py hash-password
    python app.py sync [--full]

The real application lives in ``backend/app.py``. This shim puts ``backend/`` on
the import path and loads that file, so the whole product can be started from
the repository root as well as from ``backend/``.

The backend module is loaded under its own name instead of ``import app`` on
purpose: when this file is itself imported as ``app`` (for example by
``flask --app app sync``), a plain ``import app`` would just return this module.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent / "backend"
BACKEND_MODULE_NAME = "bee_voice_backend_app"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _load_backend():
    module = sys.modules.get(BACKEND_MODULE_NAME)
    if module is not None:
        return module

    spec = importlib.util.spec_from_file_location(
        BACKEND_MODULE_NAME, BACKEND_DIR / "app.py"
    )
    if spec is None or spec.loader is None:  # pragma: no cover - broken checkout
        raise ImportError(f"Cannot load the backend app from {BACKEND_DIR / 'app.py'}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[BACKEND_MODULE_NAME] = module
    spec.loader.exec_module(module)
    return module


_backend = _load_backend()

create_app = _backend.create_app
main = _backend.main

__all__ = ["create_app", "main"]


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
