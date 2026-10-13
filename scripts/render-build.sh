#!/bin/sh
set -eu

echo "livebrary: install packages"
npm ci --omit=dev --ignore-scripts

echo "livebrary: build native modules"
npm rebuild esbuild argon2

echo "livebrary: generate database client"
npm run db:generate

echo "livebrary: build web"
npm run build

echo "livebrary: build finished"
