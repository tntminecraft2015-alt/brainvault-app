FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates curl fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
# LOCAL_WHISPER=0 skips the local speech model (~500 MB) when transcription goes to Groq's API
ARG LOCAL_WHISPER=1
# yt-dlp[default] includes yt-dlp-ejs: YouTube now needs a JavaScript runtime to solve its player challenges,
# and the worker runs it on the Node that's already in this image (--js-runtimes node)
RUN python3 -m venv /opt/py && /opt/py/bin/pip install --no-cache-dir "yt-dlp[default]" \
 && if [ "$LOCAL_WHISPER" = "1" ]; then /opt/py/bin/pip install --no-cache-dir faster-whisper; fi
ENV PATH=/opt/py/bin:$PATH PYTHON=/opt/py/bin/python DATA_DIR=/data HF_HOME=/data/hf

# YouTube PO tokens: from cloud servers YouTube hands out no downloadable formats without a "proof of origin" token.
# bgutil makes them (yt-dlp plugin + its Node generator, run per call in script mode, so nothing stays in memory).
# Plugin and generator versions must match. Needs Node 22+.
ARG BGUTIL=2.0.2
RUN /opt/py/bin/pip install --no-cache-dir "bgutil-ytdlp-pot-provider==$BGUTIL"  && mkdir -p /opt/bgutil && curl -fsSL "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/archive/refs/tags/$BGUTIL.tar.gz" | tar -xz -C /opt/bgutil --strip-components=1  && cd /opt/bgutil/server && npm ci --no-audit --no-fund && npx tsc && npm prune --omit=dev --no-audit --no-fund
ENV BGUTIL_SERVER_HOME=/opt/bgutil/server

WORKDIR /app
# Anton = the chunky caption font; libass falls back to DejaVu if the download ever fails
RUN mkdir -p fonts && (curl -fsSL -o fonts/Anton-Regular.ttf https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf || true)
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .

VOLUME /data
EXPOSE 8080
CMD ["node", "worker.js"]
