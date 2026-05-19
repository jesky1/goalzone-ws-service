#!/bin/bash
# WebSocket service wrapper - keeps the service running
cd /home/z/my-project/mini-services/ws-service

while true; do
  echo "[$(date)] Starting WebSocket service..."
  bun index.ts 2>&1
  EXIT_CODE=$?
  echo "[$(date)] WebSocket service exited with code $EXIT_CODE, restarting in 3s..."
  sleep 3
done
