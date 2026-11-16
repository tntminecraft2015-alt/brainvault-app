# Transcribe a 16 kHz mono WAV with word timestamps (faster-whisper, CPU, int8).
# Usage: python3 transcribe.py audio.wav out.json
# Prints "PROGRESS 0.000–1.000" lines so the worker can report how far along it is.
import json, os, sys
from faster_whisper import WhisperModel

model = WhisperModel(os.environ.get("WHISPER_MODEL", "small"), device="cpu", compute_type="int8",
                     cpu_threads=int(os.environ.get("WHISPER_THREADS", "4")))
segments, info = model.transcribe(sys.argv[1], word_timestamps=True, vad_filter=True,
                                  language=os.environ.get("WHISPER_LANG") or None)
dur = info.duration or 1
out = []
for s in segments:
    out.append({"s": round(s.start, 2), "e": round(s.end, 2), "t": s.text.strip(),
                "w": [[round(w.start, 2), round(w.end, 2), w.word.strip()] for w in (s.words or [])]})
    print(f"PROGRESS {min(1, s.end / dur):.3f}", flush=True)
with open(sys.argv[2], "w") as f:
    json.dump({"duration": info.duration, "segments": out}, f)
