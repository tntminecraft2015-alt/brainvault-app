# Clip worker

This does the heavy work for the **Clips** tab in Mission Control: it downloads the video, transcribes it, cuts 9:16 clips and burns in captions. It runs on a small always-on cloud server (Hetzner, about €6/mo), so clips get made with your PC and phone off. Any Ubuntu VM with 2+ cores and 4 GB+ of RAM works the same way.

```
Phone ─tap "Clip this"─▶ Mission Control (Render) ──POST /jobs──▶ this worker (cloud VM)
                                ▲                                     │ yt-dlp → whisper → ask MC for moments
                                └──── progress / done (retries) ──────┘ → ffmpeg → push notification to phone
```

* Mission Control **pushes** jobs here, so Render can sleep between jobs and doesn't burn free hours polling.
* The worker sends the "clips ready" push itself, so it arrives even if Render has been asleep for hours.
* The queue is saved on disk. A reboot or restart resumes the job, and results are re-reported until Mission Control accepts them.

## Option A: Render private service (what Mission Control uses now)
`render.yaml` at the repo root defines it: a **Starter private service** (512 MB, $7/mo) in the same region as `brainvault-app`, plus a 2 GB disk (~$0.50/mo) for the queue and finished clips.
* **Transcription:** goes to Groq's free Whisper API (`GROQ_API_KEY`, from console.groq.com), since local Whisper doesn't fit in 512 MB. Long VODs may pause for the free hourly limit; the worker waits that out on its own.
* **Clip files:** this service has no public address, so phones fetch clips through Mission Control's `/clipfiles/…` pass-through (`FILES_BASE_URL`).
* **On brainvault-app, set:**
  * `WORKER_URL=http://<worker internal address>:10000`, found under the worker's **Connect → Internal** in the Render dashboard
  * `WORKER_SECRET`, the same value as the worker's

## Option B: your own VM (one-time setup, about 30 min)

1. **Hetzner Cloud server.** Sign up at accounts.hetzner.com, then in the Cloud Console create a project → **Add Server**:
   * **Location:** Falkenstein, Nuremberg or Helsinki. The EU locations are much cheaper than US ones, and location doesn't matter for this.
   * **Image:** Ubuntu 24.04.
   * **Type:** Shared vCPU → **CX23** (x86, 2 vCPU / 4 GB) or **CAX11** (Arm, same size). If both are sold out, take the next size up.
   * **Networking:** keep Public IPv4 on.
   * **SSH key:** add one, or skip it and use the root password Hetzner emails you.
   * Hetzner servers have no firewall by default, so ports 80/443 are already open. If you add a Hetzner firewall, allow TCP 22, 80 and 443.
   * SSH in with `ssh root@<ip>`.
2. **Install Docker:** `curl -fsSL https://get.docker.com | sh`
3. **Copy this folder to the VM** (e.g. `scp -r worker root@<ip>:~/`), then `cd worker && cp .env.example .env && nano .env`.
   * `DOMAIN` / `PUBLIC_URL`: your IP with dashes, plus `.sslip.io`. This gives you a free hostname with no domain to buy, and Caddy gets the HTTPS certificate on its own.
   * `WORKER_SECRET`: make one with `openssl rand -hex 32`. Put the **same** value on Render.
   * `VAPID_*`: copy these from Render's environment.
4. **Start it:** `docker compose up -d --build`. The first build takes about 5 minutes, and the first job also downloads the Whisper model (about 500 MB, cached after that).
   Check that it's up with `curl https://<your-domain>/health`, which should return `{"ok":true,...}`.
5. **On Render** (Mission Control service → Environment), set:
   * `WORKER_URL=https://<your-domain>`
   * `WORKER_SECRET=<same value>`
   * `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET`: from dev.twitch.tv → Your Console → Register Your Application. Use any name, OAuth redirect `http://localhost`, category "Other", and client type Confidential.

## Logs and updates
* `docker compose logs -f worker` shows each job's progress and errors.
* After changing code: `docker compose up -d --build`. yt-dlp updates itself daily.

## Running it on your PC instead (fallback)
Install Docker Desktop, fill in `.env` with `PUBLIC_URL` left blank, then run `docker compose up -d --build worker` and `cloudflared tunnel --url http://localhost:8080`. Put the printed `https://….trycloudflare.com` address in **both** `PUBLIC_URL` (.env) and `WORKER_URL` (Render). That address changes every time cloudflared restarts, and clips only render while the PC is on.

## Optional: Cloudflare R2 for clip storage
By default, finished clips are served from this VM at `/files/…` and deleted after `KEEP_DAYS`. To use R2 instead (free up to 10 GB):
1. Create a bucket and turn on its public `r2.dev` URL.
2. Create an API token with object read & write access.
3. Add a lifecycle rule that deletes objects after 14 days, and a CORS rule that allows `GET` from `*`. Without CORS, "Save / Share" in the app can't fetch the file.
4. Fill in the `R2_*` lines in `.env`.
