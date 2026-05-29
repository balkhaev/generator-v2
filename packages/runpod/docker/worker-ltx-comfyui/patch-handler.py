#!/usr/bin/env python3
"""Patch упстримового /handler.py от runpod-workers/worker-comfyui.

Базовый handler.py версии 5.8.5 обрабатывает только output key ``images``
у каждой ноды (см. handler.py:752-849). Custom-нода
``VHS_VideoCombine`` (comfyui-videohelpersuite) кладёт результат в ключ
``gifs`` — handler его игнорирует и помечает как unhandled, из-за чего
mp4-файл, реально сохранённый в /comfyui/output/, никогда не доходит до
serverless response'а.

Этот patch добавляет обработку ключей ``gifs`` и ``videos`` (на случай
будущих custom-нод). Логика идентична branch'у ``images``:
скачивает файл через /view, загружает в S3 (если задан BUCKET_ENDPOINT_URL)
или возвращает base64, и пушит результат в общий ``output_data`` список.

Применяется один раз во время docker build (после установки кастомных
нод). Идемпотентен: если patch уже применён — exit 0.
"""

from __future__ import annotations

import sys
from pathlib import Path

HANDLER_PATH = Path("/handler.py")

# Маркер, по которому определяем, был ли patch уже применён ранее
# (предотвращает повторное применение при rebuild с теми же layer'ами).
PATCH_MARKER = "# >>> ltx-worker: video output patch v1"

# Анкор внутри оригинального handler.py — начало блока, обрабатывающего
# ``other_keys`` (warning-only). Перед ним мы вставим обработку видео.
ANCHOR = '            # Check for other output types\n            other_keys = [k for k in node_output.keys() if k != "images"]'

# Заменяющий блок: сначала перебираем video-ключи (`gifs`, `videos`),
# обрабатываем каждый файл как handler делает с `images`, затем
# восстанавливаем оригинальный other_keys warning, но исключая уже
# обработанные video-ключи (чтобы не мусорить warning'ами).
SENTINEL_SUFFIX = """

# >>> ltx-worker: bootstrap sentinel wrapper
import json as _ltx_json
import os as _ltx_os
import re as _ltx_re
import shutil as _ltx_shutil
import tempfile as _ltx_tempfile
import urllib.request as _ltx_urlreq


def _ltx_read_sentinel():
\tfor _candidate in (
\t\t"/runpod-volume/ComfyUI/models/_bootstrap_aux_status.json",
\t\t"/runpod-volume/models/_bootstrap_aux_status.json",
\t\t"/workspace/ComfyUI/models/_bootstrap_aux_status.json",
\t):
\t\ttry:
\t\t\twith open(_candidate) as _fh:
\t\t\t\treturn _ltx_json.load(_fh)
\t\texcept FileNotFoundError:
\t\t\tcontinue
\t\texcept Exception as _e:
\t\t\treturn {"_sentinel_error": str(_e), "path": _candidate}
\treturn {
\t\t"status": "sentinel-missing",
\t\t"runpod_volume_listing": _ltx_safe_ls("/runpod-volume"),
\t\t"runpod_volume_comfyui_listing": _ltx_safe_ls("/runpod-volume/ComfyUI"),
\t\t"runpod_volume_models_listing": _ltx_safe_ls("/runpod-volume/models"),
\t}


def _ltx_safe_ls(path):
\ttry:
\t\treturn sorted(_ltx_os.listdir(path))[:40]
\texcept Exception as _e:
\t\treturn f"err: {_e}"


# --- per-request Civitai LoRA auto-download ----------------------------------
# Serverless-граф ссылается на LoRA по имени `civitai-{modelId}-{versionId}.
# safetensors`, но этот файл отсутствует на network volume (его никто не
# заливал, а в base-image нет curl). ComfyUI на валидации `/prompt` отвергает
# граф (lora_name не в списке) → handler отдаёт `success_no_images`.
# Поэтому ПЕРЕД инференсом скачиваем недостающие LoRA в models/loras/ через
# Civitai download API (Python urllib, токен из env). Volume общий и
# персистентный, поэтому первая генерация прогревает LoRA для всех будущих.
_LTX_LORA_DIRS = (
\t"/runpod-volume/ComfyUI/models/loras",
\t"/runpod-volume/models/loras",
\t"/workspace/ComfyUI/models/loras",
)
_LTX_CIVITAI_RE = _ltx_re.compile(r"^civitai-(\\d+)-(\\d+)\\.safetensors$")
_LTX_MIN_LORA_BYTES = 1024 * 1024


def _ltx_lora_dir():
\tfor _d in _LTX_LORA_DIRS:
\t\tif _ltx_os.path.isdir(_ltx_os.path.dirname(_d)):
\t\t\ttry:
\t\t\t\t_ltx_os.makedirs(_d, exist_ok=True)
\t\t\texcept Exception:
\t\t\t\tpass
\t\t\treturn _d
\t_d = _LTX_LORA_DIRS[0]
\ttry:
\t\t_ltx_os.makedirs(_d, exist_ok=True)
\texcept Exception:
\t\tpass
\treturn _d


def _ltx_collect_lora_names(job):
\t_names = set()
\ttry:
\t\t_wf = (job or {}).get("input", {}).get("workflow", {})
\t\tif isinstance(_wf, dict):
\t\t\tfor _node in _wf.values():
\t\t\t\tif not isinstance(_node, dict):
\t\t\t\t\tcontinue
\t\t\t\t_inp = _node.get("inputs", {})
\t\t\t\tif isinstance(_inp, dict):
\t\t\t\t\t_v = _inp.get("lora_name")
\t\t\t\t\tif isinstance(_v, str):
\t\t\t\t\t\t_names.add(_v)
\texcept Exception:
\t\tpass
\treturn _names


def _ltx_download_civitai(version_id, dest_path):
\t_token = (
\t\t_ltx_os.environ.get("CIVITAI_API_TOKEN")
\t\tor _ltx_os.environ.get("CIVITAI_API_KEY")
\t\tor ""
\t)
\t_url = f"https://civitai.com/api/download/models/{version_id}"
\tif _token:
\t\t_url += f"?token={_token}"
\t_req = _ltx_urlreq.Request(_url, headers={"User-Agent": "ltx-worker/1.0"})
\t_fd, _tmp = _ltx_tempfile.mkstemp(
\t\tsuffix=".safetensors", dir=_ltx_os.path.dirname(dest_path)
\t)
\t_ltx_os.close(_fd)
\ttry:
\t\twith _ltx_urlreq.urlopen(_req, timeout=900) as _resp:
\t\t\t_ctype = _resp.headers.get("Content-Type", "")
\t\t\tif "text/html" in _ctype:
\t\t\t\traise RuntimeError(
\t\t\t\t\tf"civitai returned HTML (token/auth issue), content-type={_ctype}"
\t\t\t\t)
\t\t\twith open(_tmp, "wb") as _out:
\t\t\t\t_ltx_shutil.copyfileobj(_resp, _out, 1024 * 1024)
\t\t_size = _ltx_os.path.getsize(_tmp)
\t\tif _size < _LTX_MIN_LORA_BYTES:
\t\t\traise RuntimeError(f"downloaded file too small ({_size} bytes)")
\t\t_ltx_os.replace(_tmp, dest_path)
\t\treturn {"versionId": version_id, "bytes": _size, "status": "downloaded"}
\tfinally:
\t\ttry:
\t\t\tif _ltx_os.path.exists(_tmp):
\t\t\t\t_ltx_os.remove(_tmp)
\t\texcept Exception:
\t\t\tpass


def _ltx_ensure_loras(job):
\t_report = []
\t_names = _ltx_collect_lora_names(job)
\tif not _names:
\t\treturn _report
\t_dir = _ltx_lora_dir()
\tfor _name in sorted(_names):
\t\t_m = _LTX_CIVITAI_RE.match(_name)
\t\tif not _m:
\t\t\tcontinue
\t\t_version = _m.group(2)
\t\t_dest = _ltx_os.path.join(_dir, _name)
\t\ttry:
\t\t\tif (
\t\t\t\t_ltx_os.path.exists(_dest)
\t\t\t\tand _ltx_os.path.getsize(_dest) > _LTX_MIN_LORA_BYTES
\t\t\t):
\t\t\t\t_report.append({"name": _name, "status": "cached"})
\t\t\t\tcontinue
\t\t\t_info = _ltx_download_civitai(_version, _dest)
\t\t\t_info["name"] = _name
\t\t\t_report.append(_info)
\t\texcept Exception as _e:
\t\t\t_report.append({"name": _name, "status": "error", "error": str(_e)})
\treturn _report


_ltx_orig_handler = handler


def handler(job):
\t_lora_report = []
\ttry:
\t\t_lora_report = _ltx_ensure_loras(job)
\texcept Exception as _e:
\t\t_lora_report = [{"status": "fatal", "error": str(_e)}]
\ttry:
\t\tresult = _ltx_orig_handler(job)
\texcept Exception as _e:
\t\tresult = {"error": f"handler raised: {_e}"}
\ttry:
\t\tif isinstance(result, dict):
\t\t\tresult["_bootstrap_sentinel"] = _ltx_read_sentinel()
\t\t\tresult["_ltx_lora_downloads"] = _lora_report
\texcept Exception as _e:
\t\tif isinstance(result, dict):
\t\t\tresult["_bootstrap_sentinel_error"] = str(_e)
\treturn result
# <<< ltx-worker: bootstrap sentinel wrapper
"""

REPLACEMENT = f"""            {PATCH_MARKER}
            # VHS_VideoCombine кладёт mp4/webm в key `gifs`, SaveVideo —
            # в `videos`. Логика обработки идентична `images`.
            for video_key in ("gifs", "videos"):
                if video_key in node_output:
                    print(
                        f"worker-comfyui - Node {{node_id}} contains "
                        f"{{len(node_output[video_key])}} {{video_key}} item(s)"
                    )
                    for video_info in node_output[video_key]:
                        v_filename = video_info.get("filename")
                        v_subfolder = video_info.get("subfolder", "")
                        v_type = video_info.get("type")
                        if v_type == "temp":
                            print(
                                f"worker-comfyui - Skipping {{video_key}} {{v_filename}} (type=temp)"
                            )
                            continue
                        if not v_filename:
                            warn_msg = (
                                f"Skipping {{video_key}} item in node {{node_id}} "
                                f"due to missing filename: {{video_info}}"
                            )
                            print(f"worker-comfyui - {{warn_msg}}")
                            errors.append(warn_msg)
                            continue
                        v_bytes = get_image_data(v_filename, v_subfolder, v_type)
                        if not v_bytes:
                            error_msg = (
                                f"Failed to fetch {{video_key}} data for {{v_filename}} "
                                "from /view endpoint."
                            )
                            errors.append(error_msg)
                            continue
                        v_ext = os.path.splitext(v_filename)[1] or ".mp4"
                        if os.environ.get("BUCKET_ENDPOINT_URL"):
                            try:
                                with tempfile.NamedTemporaryFile(
                                    suffix=v_ext, delete=False
                                ) as tmp:
                                    tmp.write(v_bytes)
                                    tmp_path = tmp.name
                                print(
                                    f"worker-comfyui - Wrote {{video_key}} bytes to {{tmp_path}}"
                                )
                                print(
                                    f"worker-comfyui - Uploading {{v_filename}} to S3..."
                                )
                                s3_url = rp_upload.upload_image(job_id, tmp_path)
                                os.remove(tmp_path)
                                print(
                                    f"worker-comfyui - Uploaded {{v_filename}} to S3: {{s3_url}}"
                                )
                                output_data.append(
                                    {{
                                        "filename": v_filename,
                                        "type": "s3_url",
                                        "data": s3_url,
                                    }}
                                )
                            except Exception as e:
                                error_msg = (
                                    f"Error uploading {{v_filename}} to S3: {{e}}"
                                )
                                print(f"worker-comfyui - {{error_msg}}")
                                errors.append(error_msg)
                        else:
                            try:
                                b64 = base64.b64encode(v_bytes).decode("utf-8")
                                output_data.append(
                                    {{
                                        "filename": v_filename,
                                        "type": "base64",
                                        "data": b64,
                                    }}
                                )
                                print(
                                    f"worker-comfyui - Encoded {{v_filename}} as base64"
                                )
                            except Exception as e:
                                error_msg = (
                                    f"Error encoding {{v_filename}} to base64: {{e}}"
                                )
                                print(f"worker-comfyui - {{error_msg}}")
                                errors.append(error_msg)
            # <<< ltx-worker: video output patch v1
            # Check for other output types
            other_keys = [k for k in node_output.keys() if k not in ("images", "gifs", "videos")]"""


def main() -> int:
	if not HANDLER_PATH.exists():
		print(f"[patch-handler] FATAL: {HANDLER_PATH} not found", file=sys.stderr)
		return 1
	original = HANDLER_PATH.read_text()
	if PATCH_MARKER in original:
		print("[patch-handler] already patched, skip")
		return 0
	if ANCHOR not in original:
		print(
			"[patch-handler] FATAL: anchor not found — handler.py upstream layout changed; "
			"update patch-handler.py manually",
			file=sys.stderr,
		)
		return 2
	patched = original.replace(ANCHOR, REPLACEMENT, 1)
	if patched == original:
		print("[patch-handler] FATAL: replacement did not change content", file=sys.stderr)
		return 3
	# Append sentinel wrapper в конец handler.py — после оригинального
	# `if __name__ == "__main__": runpod.serverless.start(...)`. Wrapper
	# заменит глобальный `handler` symbol до того, как runpod подхватит его.
	# Чтобы это работало даже если patch выполняется при build (когда
	# runpod ещё не импортирован), кладём wrapper ДО main-guard'а.
	main_anchor = 'if __name__ == "__main__":'
	if main_anchor not in patched:
		print(
			"[patch-handler] FATAL: main guard not found, cannot inject sentinel wrapper",
			file=sys.stderr,
		)
		return 4
	patched = patched.replace(main_anchor, SENTINEL_SUFFIX + "\n" + main_anchor, 1)
	HANDLER_PATH.write_text(patched)
	print("[patch-handler] applied video output patch v1 + sentinel wrapper")
	return 0


if __name__ == "__main__":
	sys.exit(main())
