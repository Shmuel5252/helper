# Local Hebrew-to-English image prompts

Select **תרגום מקומי — ללא ספק חיצוני** in Realistic Vision advanced settings.
The server queues Hebrew without any cloud model call. The outbound worker runs
the local translator, appends the existing face-quality tokens, records the exact
English prompt under its active lease, then dispatches Realistic Vision.
There is no cloud fallback. Direct, cloud translation and AI planning remain separate.

The hosted app still uses its existing Vercel/Supabase queue and private image
storage. This feature moves translation inference to the computer; it does not
turn the hosted app into an entirely offline website.

## Setup on the worker computer

Use a Python environment with PyTorch and Transformers supporting MarianMT
(verified with Python 3.12, torch 2.15.0 and transformers 5.5.4). Install the
tokenizer dependencies into `.local-images/translation/vendor` using:

```powershell
& $python -m pip install --target .local-images/translation/vendor -r scripts/image-worker/translation-requirements.txt
& $python scripts/image-worker/download-translation.py
```

Set `IMAGE_TRANSLATION_PYTHON` in the worker's environment to that Python
executable, then restart the idle worker. Model and vendor files are ignored by Git.
The one-time download uses [OPUS-MT Hebrew-English](https://huggingface.co/tiedeman/opus-mt-he-en),
pinned to revision `d1f295aeecf3139b988f44cc2df27fb523dda9f9`; its model card is
downloaded alongside the weights. No remote model code is executed.

`translate-local.py` loads files only from disk. An audit hook denies network
operations throughout the translator process. The response reports offline mode
and the number of attempted network operations; the worker requires that count
to be zero. The translator exits before image inference to release its memory.
Long inputs exceeding the model's context and incomplete outputs fail explicitly
instead of being silently truncated. Translation is machine-generated and should
be checked for important names, negations and other precise details.

## Verification

```powershell
node --test tests/local-image-translation.test.mjs lib/realistic-direct.test.ts
node tests/image-routing.int.mjs # with the isolated image test app running
```

The HTTP tests cover no cloud calls, lease checks, invalid translations, and
rejecting prompt changes after generation has started. The real-model smoke test
is `tests/local-translation-smoke.mjs` and requires `IMAGE_TRANSLATION_PYTHON`.
