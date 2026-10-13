#!/bin/sh
set -eu

echo "livebrary: install runtime packages"
npm ci --omit=dev --ignore-scripts

echo "livebrary: install build tools"
npm install --no-save --ignore-scripts --no-package-lock \
  prisma@6.19.3 \
  tsx@4.23.15 \
  vite@8.3.4 \
  @vitejs/plugin-react@6.1.2 \
  tailwindcss@4.3.3 \
  @tailwindcss/vite@4.3.3

echo "livebrary: build native modules"
npm rebuild esbuild argon2

echo "livebrary: generate database client"
npm run db:generate

echo "livebrary: build web"
npm run build

echo "livebrary: build finished"
