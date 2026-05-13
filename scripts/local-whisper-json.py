#!/usr/bin/env python
import argparse
import importlib.util
import inspect
import json
import os
import sys
from typing import Optional


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Transcribe one audio file and print JSON to stdout."
    )
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--check-model", action="store_true")
    parser.add_argument("--download-model", action="store_true")
    parser.add_argument("--input")
    parser.add_argument("--model", default="small")
    parser.add_argument("--model-dir", default=None)
    parser.add_argument("--language", default=None)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    args = parser.parse_args()

    if args.check:
        return check_dependencies()

    if args.check_model:
        return check_model(args.model, args.device, args.compute_type)

    if args.download_model:
        return download_model(args.model, args.model_dir)

    if not args.input:
        print("--input is required", file=sys.stderr)
        return 2

    if not os.path.exists(args.input):
        print(f"input audio file does not exist: {args.input}", file=sys.stderr)
        return 2

    try:
        text = transcribe(
            args.input,
            args.model,
            normalize_language(args.language),
            args.device,
            args.compute_type,
        )
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1

    print(json.dumps({"text": text}, ensure_ascii=False))
    return 0


def check_dependencies() -> int:
    if importlib.util.find_spec("faster_whisper") is not None:
        print(json.dumps({"ok": True, "engine": "faster-whisper"}))
        return 0

    if importlib.util.find_spec("whisper") is not None:
        print(
            json.dumps(
                {
                    "ok": True,
                    "engine": "whisper",
                    "note": "openai-whisper fallback requires --model to be a local model file path to avoid automatic downloads",
                }
            )
        )
        return 0

    print(
        "Neither faster_whisper nor whisper is installed. Install one in the Python environment, or point PHASE3_LOCAL_WHISPER_COMMAND/ARGS to your own JSON wrapper.",
        file=sys.stderr,
    )
    return 1


def check_model(model_name: str, device: str, compute_type: str) -> int:
    try:
        engine = load_model_for_check(model_name, device, compute_type)
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1

    print(
        json.dumps(
            {
                "ok": True,
                "engine": engine,
                "model": model_name,
                "device": device,
                "compute_type": compute_type,
            },
            ensure_ascii=False,
        )
    )
    return 0


def download_model(model_name: str, model_dir: Optional[str]) -> int:
    if model_name not in {"small", "medium"}:
        print("downloadable local-whisper model must be 'small' or 'medium'", file=sys.stderr)
        return 2

    if model_dir is None or not model_dir.strip():
        print("--model-dir is required with --download-model", file=sys.stderr)
        return 2

    target_dir = os.path.abspath(
        os.path.join(model_dir, f"faster-whisper-{model_name}")
    )
    if has_faster_whisper_model_files(target_dir):
        print(
            json.dumps(
                {
                    "ok": True,
                    "model": model_name,
                    "model_path": target_dir,
                    "already_present": True,
                },
                ensure_ascii=False,
            )
        )
        return 0

    try:
        from huggingface_hub import snapshot_download

        snapshot_download(
            repo_id=f"Systran/faster-whisper-{model_name}",
            local_dir=target_dir,
            local_dir_use_symlinks=False,
        )
    except Exception as error:
        print(f"Failed to download faster-whisper model {model_name}: {error}", file=sys.stderr)
        return 1

    if not has_faster_whisper_model_files(target_dir):
        print(
            f"Downloaded model folder is incomplete: {target_dir}",
            file=sys.stderr,
        )
        return 1

    print(
        json.dumps(
            {
                "ok": True,
                "model": model_name,
                "model_path": target_dir,
                "already_present": False,
            },
            ensure_ascii=False,
        )
    )
    return 0


def has_faster_whisper_model_files(model_path: str) -> bool:
    return os.path.isfile(os.path.join(model_path, "config.json")) and os.path.isfile(
        os.path.join(model_path, "model.bin")
    )


def load_model_for_check(model_name: str, device: str, compute_type: str) -> str:
    if importlib.util.find_spec("faster_whisper") is not None:
        load_faster_whisper_model(model_name, device, compute_type)
        return "faster-whisper"

    if importlib.util.find_spec("whisper") is not None:
        load_openai_whisper_model(model_name, device)
        return "whisper"

    raise RuntimeError(
        "Neither faster_whisper nor whisper is installed. No package installation was attempted."
    )


def transcribe(
    input_path: str,
    model_name: str,
    language: Optional[str],
    device: str,
    compute_type: str,
) -> str:
    if importlib.util.find_spec("faster_whisper") is not None:
        return transcribe_with_faster_whisper(
            input_path,
            model_name,
            language,
            device,
            compute_type,
        )

    if importlib.util.find_spec("whisper") is not None:
        return transcribe_with_openai_whisper(
            input_path,
            model_name,
            language,
            device,
        )

    raise RuntimeError(
        "Neither faster_whisper nor whisper is installed. No package installation was attempted."
    )


def transcribe_with_faster_whisper(
    input_path: str,
    model_name: str,
    language: Optional[str],
    device: str,
    compute_type: str,
) -> str:
    model = load_faster_whisper_model(model_name, device, compute_type)

    segments, _info = model.transcribe(input_path, language=language)
    return "".join(segment.text for segment in segments).strip()


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
            "Installed faster-whisper does not expose local_files_only. Provide a local model path in PHASE3_LOCAL_WHISPER_MODEL to avoid automatic downloads."
        )

    try:
        return WhisperModel(model_name, **init_kwargs)
    except Exception as error:
        raise RuntimeError(
            f"Failed to load faster-whisper model locally: {model_name}. No automatic model download was attempted. {error}"
        ) from error


def transcribe_with_openai_whisper(
    input_path: str,
    model_name: str,
    language: Optional[str],
    device: str,
) -> str:
    model = load_openai_whisper_model(model_name, device)
    result = model.transcribe(input_path, language=language, fp16=False)
    text = result.get("text", "")
    return str(text).strip()


def load_openai_whisper_model(model_name: str, device: str):
    if not os.path.exists(model_name):
        raise RuntimeError(
            "openai-whisper fallback requires PHASE3_LOCAL_WHISPER_MODEL to be a local model file path. Named models are not loaded here because that may trigger an automatic download."
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
