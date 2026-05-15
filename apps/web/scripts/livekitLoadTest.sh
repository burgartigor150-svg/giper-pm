#!/usr/bin/env bash
# LiveKit load test: spawn N fake publishers + N subscribers against
# our SFU. Reports per-track bitrate + packet loss + signaling
# failures.
#
# Use this after a server config change or when troubleshooting
# "звук плавает на K человек" reports. Last real run on prod showed
# 0% packet loss at N=30 once the host miner was killed — see the
# meetings notes for context.
#
# Two execution modes:
#
#   1. Local livekit-cli (brew install livekit-cli):
#        N=8 ./apps/web/scripts/livekitLoadTest.sh
#
#   2. Dockerized — used on prod where livekit-cli isn't installed:
#        DOCKERIZE=1 N=30 ./apps/web/scripts/livekitLoadTest.sh
#      Runs `docker run --rm --network host livekit/livekit-cli:latest`.
#      The script auto-falls back to docker if `livekit-cli` isn't
#      on PATH.
#
# Required env (source from /opt/giper-pm/.env on prod):
#   LIVEKIT_API_KEY
#   LIVEKIT_API_SECRET
#   LIVEKIT_PUBLIC_URL     wss://… (the URL clients hit)
#
# Optional:
#   N=8                    publishers AND subscribers count (each)
#   DURATION=60s           run length (default 60s — long enough to
#                          settle, short enough to not annoy real users)
#   ROOM=load-test-${RANDOM}
#   VIDEO_RESOLUTION=medium  high|medium|low  (default medium so 30
#                          tester clients don't try to publish 1080p)
#   PER_SECOND=10          how many testers to start per second
#                          (lower if the load-tester process is on
#                          the same machine as the SFU — open-ports
#                          flood otherwise)
#
# What to watch in the LiveKit logs in another shell while it runs:
#   docker compose -f /opt/giper-pm/docker-compose.prod.yml logs -f livekit \
#     | grep -iE 'congestion|reconnect|disconnected|nack'
#
# Notes from the May 2026 prod incident:
#   - load average above ~30 with a near-empty room => something else
#     on the host is eating CPU. We had a crypto miner under user
#     `igun2`. Audit with `top -c -o %CPU` first.
#   - 768 worker_connections in /etc/nginx/nginx.conf is the default
#     and isn't actually the bottleneck for 30 users (each WS = 2
#     conns on nginx, well below 768).
#   - "could not establish signal connection" from the *tester* doesn't
#     necessarily mean the SFU is broken — host-network docker hitting
#     itself with 30 parallel WS opens has hit per-source rate limits
#     before. Test from off-host or lower PER_SECOND if you see it.
set -euo pipefail

: "${LIVEKIT_API_KEY:?LIVEKIT_API_KEY is required}"
: "${LIVEKIT_API_SECRET:?LIVEKIT_API_SECRET is required}"
: "${LIVEKIT_PUBLIC_URL:?LIVEKIT_PUBLIC_URL is required (wss://...)}"

N="${N:-8}"
DURATION="${DURATION:-60s}"
ROOM="${ROOM:-load-test-$(date +%s)}"
VIDEO_RESOLUTION="${VIDEO_RESOLUTION:-medium}"
PER_SECOND="${PER_SECOND:-10}"

# Decide local-vs-docker. Honor explicit DOCKERIZE=1; otherwise
# auto-fallback when livekit-cli is missing.
if [[ "${DOCKERIZE:-}" == "1" || -z "$(command -v livekit-cli || true)" ]]; then
  RUNNER=(docker run --rm --network host
    -e "LIVEKIT_URL=${LIVEKIT_PUBLIC_URL}"
    -e "LIVEKIT_API_KEY=${LIVEKIT_API_KEY}"
    -e "LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}"
    livekit/livekit-cli:latest)
else
  RUNNER=(livekit-cli
    --url "${LIVEKIT_PUBLIC_URL}"
    --api-key "${LIVEKIT_API_KEY}"
    --api-secret "${LIVEKIT_API_SECRET}")
fi

cat <<EOF
LiveKit load test
  server:        ${LIVEKIT_PUBLIC_URL}
  room:          ${ROOM}
  publishers:    ${N} video + ${N} audio
  subscribers:   ${N}
  resolution:    ${VIDEO_RESOLUTION}
  ramp-up:       ${PER_SECOND}/s
  duration:      ${DURATION}
  runner:        ${RUNNER[0]}

Tail the SFU logs in another shell while this runs:
  docker compose -f /opt/giper-pm/docker-compose.prod.yml logs -f livekit \\
    | grep -iE 'congestion|reconnect|disconnected|nack'
EOF

exec "${RUNNER[@]}" load-test \
  --room "${ROOM}" \
  --duration "${DURATION}" \
  --video-publishers "${N}" \
  --audio-publishers "${N}" \
  --subscribers "${N}" \
  --num-per-second "${PER_SECOND}" \
  --video-resolution "${VIDEO_RESOLUTION}" \
  --yes
