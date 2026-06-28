#!/usr/bin/env python
import argparse
import importlib.util
import inspect
import json
import os
import sys
from typing import Any, Optional


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Keep a local Whisper model loaded and transcribe JSONL requests."
    )
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default=None)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    args = parser.parse_args()

    try:
        engine, model = load_model(args.model, args.device, args.compute_type)
    except Exception as error:
        write_json(
            {
                "type": "ready",
                "ok": False,
                "error": str(error),
                "model": args.model,
                "device": args.device,
                "compute_type": args.compute_type,
            }
        )
        return 1

    write_json(
        {
            "type": "ready",
            "ok": True,
            "engine": engine,
            "model": args.model,
            "device": args.device,
            "compute_type": args.compute_type,
        }
    )

    default_language = normalize_language(args.language)
    for line in sys.stdin:
        stripped = line.strip()
        if not stripped:
            continue

        try:
            request = json.loads(stripped)
        except Exception as error:
            write_json(
                {
                    "type": "result",
                    "id": None,
                    "ok": False,
                    "error": f"Malformed JSON request: {error}",
                }
            )
            continue

        if isinstance(request, dict) and request.get("type") == "shutdown":
            write_json({"type": "shutdown", "ok": True})
            return 0

        request_id = request.get("id") if isinstance(request, dict) else None
        try:
            input_path = read_string(request, "input")
            language = normalize_language(
                read_optional_string(request, "language") or default_language
            )
            if not os.path.exists(input_path):
                raise RuntimeError(f"input audio file does not exist: {input_path}")

            text = transcribe_loaded(engine, model, input_path, language)
            write_json(
                {
                    "type": "result",
                    "id": request_id,
                    "ok": True,
                    "text": text,
                }
            )
        except Exception as error:
            write_json(
                {
                    "type": "result",
                    "id": request_id,
                    "ok": False,
                    "error": str(error),
                }
            )

    return 0


def write_json(value: dict[str, Any]) -> None:
    print(json.dumps(value, ensure_ascii=False), flush=True)


def read_string(value: Any, key: str) -> str:
    if not isinstance(value, dict):
        raise RuntimeError("request must be a JSON object")
    result = value.get(key)
    if not isinstance(result, str) or not result.strip():
        raise RuntimeError(f"request.{key} must be a non-empty string")
    return result


def read_optional_string(value: Any, key: str) -> Optional[str]:
    if not isinstance(value, dict):
        return None
    result = value.get(key)
    return result if isinstance(result, str) else None


def load_model(model_name: str, device: str, compute_type: str):
    if importlib.util.find_spec("faster_whisper") is not None:
        return (
            "faster-whisper",
            load_faster_whisper_model(model_name, device, compute_type),
        )

    if importlib.util.find_spec("whisper") is not None:
        return ("whisper", load_openai_whisper_model(model_name, device))

    raise RuntimeError(
        "Neither faster_whisper nor whisper is installed. No package installation was attempted."
    )


def transcribe_loaded(
    engine: str,
    model: Any,
    input_path: str,
    language: Optional[str],
) -> str:
    if engine == "faster-whisper":
        segments, _info = model.transcribe(input_path, language=language)
        return "".join(segment.text for segment in segments).strip()

    if engine == "whisper":
        result = model.transcribe(input_path, language=language, fp16=False)
        return str(result.get("text", "")).strip()

    raise RuntimeError(f"Unsupported local-whisper engine: {engine}")


def load_faster_whisper_model(model_name: str, device: str, compute_type: str):
    from faster_whisper import WhisperModel

    init_kwargs = {
        "device": device,
        "compute_type": compute_type,
    }
    signature = inspect.signature(WhisperModel)
    if "local_files_only" in signature.parameters:
        init_kwargs["local_files_only"] = True
    elif not os.path.exists(model_name):
        raise RuntimeError(
            "Installed faster-whisper does not expose local_files_only. Provide a local model path to avoid automatic downloads."
        )

    try:
        return WhisperModel(model_name, **init_kwargs)
    except Exception as error:
        raise RuntimeError(
            f"Failed to load faster-whisper model locally: {model_name}. No automatic model download was attempted. {error}"
        ) from error


def load_openai_whisper_model(model_name: str, device: str):
    if not os.path.exists(model_name):
        raise RuntimeError(
            "openai-whisper fallback requires the local-whisper model to be a local model file path."
        )

    import whisper

    load_kwargs = {}
    if device and device != "auto":
        load_kwargs["device"] = device
    return whisper.load_model(model_name, **load_kwargs)


def normalize_language(language: Optional[str]) -> Optional[str]:
    if language is None:
        return None
    stripped = language.strip()
    return stripped if stripped else None


if __name__ == "__main__":
    raise SystemExit(main())
