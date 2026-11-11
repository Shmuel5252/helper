"""One-time download of the pinned Hebrew-English model; never receives prompts."""
from pathlib import Path
from huggingface_hub import snapshot_download

ROOT = Path(__file__).resolve().parents[2]
snapshot_download(
    repo_id="tiedeman/opus-mt-he-en",
    revision="d1f295aeecf3139b988f44cc2df27fb523dda9f9",
    local_dir=ROOT / ".local-images" / "translation" / "model",
    allow_patterns=["config.json", "pytorch_model.bin", "source.spm", "target.spm",
                    "tokenizer_config.json", "special_tokens_map.json", "vocab.json", "README.md"],
)
print("Local Hebrew-English model downloaded.")
