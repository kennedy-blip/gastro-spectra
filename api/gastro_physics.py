"""GASTRO-SPECTRA — Python 3.12 Vercel Serverless Function.

Routes (POST JSON, action field):
  health | peg-analyze | peg-preset | swallow | fodmap | colorimetry | hepatology
Every branch has a deterministic ES2024 mirror in src/lib/engines/ so the offline APK
returns identical numbers when this function is unreachable.
"""

from __future__ import annotations

import json
import math
import os
import sys
from http.server import BaseHTTPRequestHandler
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from python_gastro import fodmap_fermentation_kinetics as ffk  # noqa: E402
from python_gastro import phonoenterography_hepatology_solver as phs  # noqa: E402

VERSION = "29.0.0-polyglot"


def _peg_analyze(payload: dict) -> dict:
    preset = payload.get("preset")
    sample_rate = int(payload.get("sampleRate", 48000))
    duration = float(payload.get("durationSec", 12.0))
    if preset:
        samples = phs.synthesize_preset(preset, sample_rate, duration)
    else:
        samples = [float(x) for x in payload.get("samples", [])][: sample_rate * 30]
        if not samples:
            samples = phs.synthesize_preset("normoactive", sample_rate, min(duration, 12.0))
    return phs.analyze_recording(
        samples,
        sample_rate=sample_rate,
        duration_sec=duration,
        threshold_multiplier=float(payload.get("thresholdMultiplier", 3.5)),
    )


def _colorimetry(payload: dict) -> dict:
    lab = phs.srgb_to_lab(
        float(payload.get("r", 107)), float(payload.get("g", 74)), float(payload.get("b", 42))
    )
    return {
        "engine": "python-3.12",
        "lab": lab,
        "pigment": phs.classify_pigment(lab),
        "bbps": phs.bbps_segment(lab),
    }


def _hepatology(payload: dict) -> dict:
    fib = phs.fib4(
        float(payload.get("age", 54)),
        float(payload.get("ast", 38)),
        float(payload.get("alt", 44)),
        float(payload.get("platelets", 210)),
    )
    meld = phs.meld_30(
        bool(payload.get("female", False)),
        float(payload.get("bilirubin", 1.2)),
        float(payload.get("sodium", 137)),
        float(payload.get("inr", 1.1)),
        float(payload.get("creatinine", 0.9)),
        float(payload.get("albumin", 4.0)),
        bool(payload.get("dialysis", False)),
    )
    return {
        "engine": "python-3.12",
        "fib4": fib,
        "meld": meld,
        "de_ritis": phs.de_ritis(float(payload.get("ast", 38)), float(payload.get("alt", 44))),
        "r_factor": phs.r_factor(
            float(payload.get("alt", 44)),
            float(payload.get("ulnAlt", 40)),
            float(payload.get("alp", 90)),
            float(payload.get("ulnAlp", 120)),
        ),
    }


def _dispatch(payload: dict) -> dict:
    action = str(payload.get("action", "health"))
    if action == "health":
        return {"ok": True, "engine": "python-3.12", "version": VERSION, "python": sys.version.split()[0]}
    if action == "peg-analyze":
        return _peg_analyze(payload)
    if action == "peg-preset":
        return {"preset": payload.get("preset", "normoactive"), "samples": len(phs.synthesize_preset(str(payload.get("preset", "normoactive"))))}
    if action == "swallow":
        return phs.segment_swallow(str(payload.get("preset", "healthy")))
    if action == "fodmap":
        return ffk.simulate_meal(payload)
    if action == "colorimetry":
        return _colorimetry(payload)
    if action == "hepatology":
        return _hepatology(payload)
    return {"ok": False, "error": f"Unknown action '{action}'"}


class handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: Any) -> None:
        encoded = json.dumps(body, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, {})

    def do_GET(self) -> None:  # noqa: N802
        self._send(200, {"ok": True, "engine": "python-3.12", "version": VERSION,
                         "actions": ["health", "peg-analyze", "peg-preset", "swallow", "fodmap", "colorimetry", "hepatology"]})

    def do_POST(self) -> None:  # noqa: N802
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length else b"{}"
            payload = json.loads(raw or b"{}")
            if not isinstance(payload, dict):
                raise ValueError("Payload must be a JSON object")
            self._send(200, _dispatch(payload))
        except Exception as exc:  # noqa: BLE001
            self._send(400, {"ok": False, "error": str(exc)})


if __name__ == "__main__":
    # Local smoke test: python3 api/gastro_physics.py
    demo = _dispatch({"action": "health"})
    print(json.dumps(demo, indent=2))
    print(json.dumps(_dispatch({"action": "peg-analyze", "preset": "obstruction", "durationSec": 12}), indent=2)[:1200])
    demo_fib = _dispatch({"action": "hepatology", "age": 58, "ast": 62, "alt": 48, "platelets": 96})
    print(json.dumps(demo_fib, indent=2))
    assert not math.isnan(demo_fib["fib4"]["fib4"])
