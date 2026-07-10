"""
Portable object storage for uploaded files (patient photos, owner videos, etc).

This replaces Emergent's proprietary storage service (integrations.emergentagent.com),
which only works inside Emergent's hosting environment and requires an
EMERGENT_LLM_KEY. Two backends are supported here, selected via STORAGE_BACKEND:

- "local" (default): saves files to disk under LOCAL_STORAGE_DIR.
  Zero config, good for getting deployed quickly. IMPORTANT: most hosts
  (including Render's free/starter web services) use an ephemeral filesystem,
  so uploaded files can be WIPED on every redeploy or restart, and this will
  not work at all if you ever run more than one backend instance. Fine for
  a demo/single-instance deployment with a persistent disk attached; not
  recommended for real production use.

- "s3": saves files to an S3-compatible bucket (AWS S3, Cloudflare R2,
  Backblaze B2, MinIO, etc). This is the recommended option for production.
  Requires: S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
  (S3_ENDPOINT_URL is optional, needed for R2/B2/MinIO instead of real AWS).

Both backends expose the same two functions the app calls:
  put_object(path, data, content_type) -> {"path": str, "size": int}
  get_object(path) -> (data: bytes, content_type: str)
"""
import os
from pathlib import Path
from typing import Tuple

STORAGE_BACKEND = os.environ.get("STORAGE_BACKEND", "local").lower()

_s3_client = None
_s3_bucket = None
_local_root: Path = None


def _init_s3():
    global _s3_client, _s3_bucket
    if _s3_client is not None:
        return
    import boto3
    _s3_bucket = os.environ["S3_BUCKET"]
    _s3_client = boto3.client(
        "s3",
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
        endpoint_url=os.environ.get("S3_ENDPOINT_URL") or None,
    )


def _init_local():
    global _local_root
    if _local_root is not None:
        return
    _local_root = Path(os.environ.get("LOCAL_STORAGE_DIR", "./uploads")).resolve()
    _local_root.mkdir(parents=True, exist_ok=True)


def init_storage():
    """Kept for compatibility with the previous storage client's interface."""
    if STORAGE_BACKEND == "s3":
        _init_s3()
    else:
        _init_local()
    return True


def put_object(path: str, data: bytes, content_type: str) -> dict:
    if STORAGE_BACKEND == "s3":
        _init_s3()
        _s3_client.put_object(Bucket=_s3_bucket, Key=path, Body=data, ContentType=content_type)
    else:
        _init_local()
        full_path = _local_root / path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_bytes(data)
    return {"path": path, "size": len(data)}


def get_object(path: str) -> Tuple[bytes, str]:
    if STORAGE_BACKEND == "s3":
        _init_s3()
        obj = _s3_client.get_object(Bucket=_s3_bucket, Key=path)
        return obj["Body"].read(), obj.get("ContentType") or "application/octet-stream"
    else:
        _init_local()
        full_path = _local_root / path
        if not full_path.exists():
            raise FileNotFoundError(path)
        return full_path.read_bytes(), "application/octet-stream"
