#!/bin/sh
set -eu

docker compose -f docker-compose-dev.yaml up --build --watch
