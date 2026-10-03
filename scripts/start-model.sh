#!/usr/bin/env sh
# Starts llama-server with the JevK5 4B GGUF. Downloads the file on first run.
#   ./scripts/start-model.sh            # Q4_K_M (2.7 GB), fits a 4 GB GPU
#   QUANT=Q8_0 ./scripts/start-model.sh # closer to the full model, needs ~5 GB
set -e
QUANT="${QUANT:-Q4_K_M}"
exec llama-server \
  --hf-repo alibiserikbay/JevK5-GGUF \
  --hf-file "jevk5-4b-v0.3-${QUANT}.gguf" \
  -c "${CONTEXT:-4096}" -ngl "${GPU_LAYERS:-99}" -np 1 \
  --host 127.0.0.1 --port "${PORT:-8080}"
