FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates curl fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
# LOCAL_WHISPER=0 skips the local speech model (~500 MB) when transcription goes to Groq's API
ARG LOCAL_WHISPER=1
RUN python3 -m venv /opt/py && /opt/py/bin/pip install --no-cache-dir yt-dlp \
 && if [ "$LOCAL_WHISPER" = "1" ]; then /opt/py/bin/pip install --no-cache-dir faster-whisper; fi
ENV PATH=/opt/py/bin:$PATH PYTHON=/opt/py/bin/python DATA_DIR=/data HF_HOME=/data/hf

WORKDIR /app
# Anton = the chunky caption font; libass falls back to DejaVu if the download ever fails
RUN mkdir -p fonts && (curl -fsSL -o fonts/Anton-Regular.ttf https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf || true)
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .

VOLUME /data
EXPOSE 8080
CMD ["node", "worker.js"]
