"""Add img2img to the existing local API; no dependency installation or model download."""
from pathlib import Path
import shutil

root = Path(r'C:\Users\USER\Documents\Codex\2026-11-11\new-chat-2\local-image-ai')
backup = Path(__file__).resolve().parents[1] / '.local-images' / 'model-before-image-edit'
backup.mkdir(parents=True, exist_ok=True)

def update(name, changes):
    path = root / name
    content = path.read_text(encoding='utf-8')
    if not (backup / name).exists():
        shutil.copy2(path, backup / name)
    for old, new in changes:
        if new in content:
            continue
        if old not in content:
            raise RuntimeError('Unexpected source version: ' + name)
        content = content.replace(old, new, 1)
    compile(content, str(path), 'exec')
    path.write_text(content, encoding='utf-8')

update('schemas.py', [('    prompt: str = Field', "    image_base64: str | None = Field(default=None, max_length=2700000)\n    strength: float = Field(default=0.65, ge=0.1, le=0.9)\n    prompt: str = Field")])
update('app.py', [
    ("            body = bytearray()", "            body_limit = 2800000 if scope['path'] == '/generate' else 65536\n            body = bytearray()"),
    ("int(headers.get('content-length', '0')) > 65536", "int(headers.get('content-length', '0')) > body_limit"),
    ('consumed > 65536', 'consumed > body_limit'),
    ("or consumed >= 1024 * 1024:", "or (too_large and consumed >= 1024 * 1024):"),
    ("{'detail':'Request exceeds 64 KiB.'}", "{'detail':'Request exceeds the size limit.'}"),
    ("    except engine.BusyError as exc:", "    except engine.InvalidImageError:\n        raise HTTPException(422, 'Invalid source image.') from None\n    except engine.BusyError as exc:")
])
update('engine.py', [
    ('import json', 'import json\nimport base64\nimport io'),
    ('from diffusers import DPMSolverMultistepScheduler', 'from diffusers import DPMSolverMultistepScheduler, StableDiffusionImg2ImgPipeline\nfrom PIL import Image, ImageOps'),
    ('class BusyError(RuntimeError):', 'class InvalidImageError(ValueError):\n    pass\n\nclass BusyError(RuntimeError):'),
    ('        image = pipe(\n', '''        source = None
        if request.image_base64:
            try:
                raw = base64.b64decode(request.image_base64, validate=True)
                if len(raw) > 2000000:
                    raise ValueError('size')
                with Image.open(io.BytesIO(raw)) as original:
                    if original.format not in ('PNG', 'JPEG', 'WEBP') or original.width * original.height > 4000000:
                        raise ValueError('format or dimensions')
                    source = ImageOps.fit(ImageOps.exif_transpose(original).convert('RGB'), (request.width, request.height))
            except Exception:
                raise InvalidImageError() from None
        options = {'width': request.width, 'height': request.height}
        generate = pipe
        if source is not None:
            # A lightweight Diffusers wrapper reuses the SAME compiled OpenVINO components.
            # It neither loads weights nor creates a second GPU model.
            generate = StableDiffusionImg2ImgPipeline(
                vae=pipe.vae, text_encoder=pipe.text_encoder, tokenizer=pipe.tokenizer,
                unet=pipe.unet, scheduler=pipe.scheduler,
                safety_checker=pipe.safety_checker, feature_extractor=pipe.feature_extractor,
                image_encoder=getattr(pipe, 'image_encoder', None),
                requires_safety_checker=pipe.config.get('requires_safety_checker', True),
            )
            assert generate.unet is pipe.unet and generate.vae is pipe.vae and generate.text_encoder is pipe.text_encoder
            options = {'image': source, 'strength': request.strength}
        image = generate(
'''),
    ('            width=request.width, height=request.height, num_inference_steps=request.steps,', '            **options, num_inference_steps=max(request.steps, int(1 / request.strength + 0.9999)) if source is not None else request.steps,'),
    ("                  'device': _device, 'seconds': elapsed, 'image_url': f'/images/{image_id}',", "                  'mode': 'image-to-image' if source is not None else 'text-to-image',\n                  'strength': request.strength if source is not None else None,\n                  'device': _device, 'seconds': elapsed, 'image_url': f'/images/{image_id}',"),
    ("            'model_loaded': _pipe is not None, 'device': _device,", "            'image_to_image': True, 'shared_model_components': True,\n            'model_loaded': _pipe is not None, 'device': _device,")
])
print('Image editing API prepared; existing packages and model files unchanged.')
