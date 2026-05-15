#!/usr/bin/env bash
# LiveKit load test: spawn N fake publishers + N subscribers against
# our SFU and report mean/p95 RTT and packet-loss. Use this after a
# server config change or when troubleshooting "звук пропадает на K
# человек" reports.
#
# Pre-req: livekit-cli installed on the host running this script.
#   brew install livekit-cli                   # macOS
#   docker run --rm livekit/livekit-cli ...    # Linux without install
#
# Required env (load these from /opt/giper-pm/.env on prod):
#   LIVEKIT_API_KEY
#   LIVEKIT_API_SECRET
#   LIVEKIT_PUBLIC_URL     wss://… (the public URL clients hit)
#
# Optional:
#   N=8                    number of publisher participants (default 8)
#   DURATION=120s          run length (default 2 min)
#   VIDEO=1                publish a camera track (default on)
#   AUDIO=1                publish a mic track (default on)
#   ROOM=load-test-${RANDOM}
#
# Example: a single 30-person stress run.
#   N=30 DURATION=5m ./apps/web/scripts/livekitLoadTest.sh
#
# The test creates an ephemeral room — no Meeting row in our DB, no
# webhook side-effects. Stop early with Ctrl+C; livekit-cli tears
# down all publishers cleanly.
set -euo pipefail

: "${LIVEKIT_API_KEY:?LIVEKIT_API_KEY is required}"
: "${LIVEKIT_API_SECRET:?LIVEKIT_API_SECRET is required}"
: "${LIVEKIT_PUBLIC_URL:?LIVEKIT_PUBLIC_URL is required (wss://...)}"

N="${N:-8}"
DURATION="${DURATION:-2m}"
ROOM="${ROOM:-load-test-$(date +%s)}"
VIDEO_FLAG="--video-publishers ${N}"
AUDIO_FLAG="--audio-publishers ${N}"

if [[ "${VIDEO:-1}" == "0" ]]; then VIDEO_FLAG=""; fi
if [[ "${AUDIO:-1}" == "0" ]]; then AUDIO_FLAG=""; fi

cat <<EOF
LiveKit load test
  server:    ${LIVEKIT_PUBLIC_URL}
  room:      ${ROOM}
  publishers: N=${N}  video=${VIDEO:-1} audio=${AUDIO:-1}
  duration:  ${DURATION}

Watch the LiveKit container logs in another shell:
  docker compose -f /opt/giper-pm/docker-compose.prod.yml logs -f livekit | grep -E 'congestion|reconnect|disconnected|nack|RTT'

If you see 'congestion controller throttled' on many participants:
  - increase the host's nproc/file-descriptors limits
  - check CPU steal / niced processes (we had a miner — verify it's gone)
  - check NIC queue (ethtool -S eno3np2 | grep drops)
EOF

exec livekit-cli load-test \
  --url "${LIVEKIT_PUBLIC_URL}" \
  --api-key "${LIVEKIT_API_KEY}" \
  --api-secret "${LIVEKIT_API_SECRET}" \
  --room "${ROOM}" \
  --duration "${DURATION}" \
  ${VIDEO_FLAG} ${AUDIO_FLAG} \
  --subscribers "${N}" \
  --simulcast
