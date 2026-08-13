#!/usr/bin/env python3
"""Local YOLOv8 spaghetti (炒面) detector for hanye monitor.

Usage:
  python detect_spaghetti.py --weights best.pt --image shot.jpg
  python detect_spaghetti.py --weights best.pt --stdin-b64

Stdout: JSON { "ok": true, "detections": [{ "label", "confidence", "xyxy" }], "maxConfidence": 0.0 }
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
import tempfile
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", required=True)
    parser.add_argument("--image", default="")
    parser.add_argument("--stdin-b64", action="store_true")
    parser.add_argument("--conf", type=float, default=0.25)
    args = parser.parse_args()

    weights = Path(args.weights)
    if not weights.is_file():
        print(json.dumps({"ok": False, "message": f"weights not found: {weights}"}))
        return 1

    try:
        from ultralytics import YOLO  # type: ignore
    except Exception as e:
        print(
            json.dumps(
                {
                    "ok": False,
                    "message": f"ultralytics 未安装，请执行: pip install ultralytics opencv-python-headless ({e})",
                }
            )
        )
        return 1

    tmp_path = None
    try:
        if args.stdin_b64:
            raw = sys.stdin.buffer.read()
            # allow data URL prefix
            text = raw.decode("utf-8", errors="ignore").strip()
            if "," in text and text.startswith("data:"):
                text = text.split(",", 1)[1]
            data = base64.b64decode(text)
            fd, tmp_path = tempfile.mkstemp(suffix=".jpg")
            import os

            os.close(fd)
            Path(tmp_path).write_bytes(data)
            image = tmp_path
        else:
            image = args.image
            if not image or not Path(image).is_file():
                print(json.dumps({"ok": False, "message": "image missing"}))
                return 1

        model = YOLO(str(weights))
        results = model.predict(source=image, conf=args.conf, verbose=False)
        detections = []
        max_conf = 0.0
        for r in results:
            names = r.names or {}
            boxes = getattr(r, "boxes", None)
            if boxes is None:
                continue
            for b in boxes:
                conf = float(b.conf[0]) if b.conf is not None else 0.0
                cls_id = int(b.cls[0]) if b.cls is not None else 0
                label = str(names.get(cls_id, "Spaghetti"))
                xyxy = [float(x) for x in b.xyxy[0].tolist()] if b.xyxy is not None else []
                detections.append({"label": label, "confidence": conf, "xyxy": xyxy})
                if conf > max_conf:
                    max_conf = conf

        print(
            json.dumps(
                {
                    "ok": True,
                    "detections": detections,
                    "maxConfidence": max_conf,
                    "count": len(detections),
                }
            )
        )
        return 0
    except Exception as e:
        print(json.dumps({"ok": False, "message": str(e)}))
        return 1
    finally:
        if tmp_path:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
