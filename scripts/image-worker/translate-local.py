"""Offline, one-shot Hebrew-English translation over stdin/stdout. No server."""
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / '.local-images' / 'translation'
sys.path.insert(0, str(DATA / 'vendor'))
for key, value in {'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1',
                   'HF_HUB_DISABLE_TELEMETRY': '1', 'DO_NOT_TRACK': '1',
                   'HF_HUB_DISABLE_PROGRESS_BARS': '1',
                   'TOKENIZERS_PARALLELISM': 'false'}.items():
    os.environ[key] = value

network_attempts = 0
def deny_network(event, _args):
    global network_attempts
    if event in ('socket.connect', 'socket.connect_ex', 'socket.getaddrinfo',
                 'socket.gethostbyname', 'socket.gethostbyaddr', 'socket.sendto', 'socket.sendmsg'):
        network_attempts += 1
        raise PermissionError('Translation is offline-only')

sys.addaudithook(deny_network)
sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')

def main():
    request = json.loads(sys.stdin.read(16000))
    text = request.get('text')
    if not isinstance(text, str) or not text.strip() or len(text) > 2000:
        raise ValueError('Invalid input')
    import torch
    from transformers import MarianTokenizer, MarianMTModel
    from transformers.utils import logging
    logging.set_verbosity_error()
    torch.set_num_threads(2)
    tokenizer = MarianTokenizer.from_pretrained(DATA / 'model', local_files_only=True)
    model = MarianMTModel.from_pretrained(DATA / 'model', local_files_only=True).eval()
    encoded = tokenizer(text, return_tensors='pt', truncation=False)
    if encoded['input_ids'].shape[-1] > model.config.max_position_embeddings:
        raise ValueError('Input exceeds local translator capacity')
    with torch.inference_mode():
        output = model.generate(**encoded, num_beams=4, do_sample=False, max_new_tokens=512)
    if int(output[0, -1]) != tokenizer.eos_token_id:
        raise ValueError('Incomplete translation')
    translated = tokenizer.decode(output[0], skip_special_tokens=True)
    if not translated.strip() or len(translated) > 2000:
        raise ValueError('Invalid translation')
    print(json.dumps({'text': translated, 'offline': True, 'network_attempts': network_attempts}, ensure_ascii=False))

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not print submitted text, model output or environment credentials.
        print(json.dumps({'error': type(error).__name__, 'offline': True,
                          'network_attempts': network_attempts}), file=sys.stderr)
        sys.exit(1)
