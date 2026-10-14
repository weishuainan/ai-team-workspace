#!/bin/bash
set -e

exec venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8080 --workers 2
