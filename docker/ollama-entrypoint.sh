#!/bin/sh
set -e

ollama serve &
SERVER_PID=$!

echo "waiting for ollama server..."
until ollama list >/dev/null 2>&1; do
  sleep 1
done

if [ -n "$OLLAMA_MODEL" ]; then
  echo "pulling model: $OLLAMA_MODEL"
  ollama pull "$OLLAMA_MODEL"
fi

wait $SERVER_PID
