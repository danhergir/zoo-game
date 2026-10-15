#!/bin/sh
# Builds the game and publishes dist/ to the gh-pages branch, which GitHub Pages serves.
set -e
cd "$(dirname "$0")/.."
npm run build
remote=$(git remote get-url origin)
cd dist
rm -rf .git
git init -q
git checkout -q -b gh-pages
git add -A
git commit -q -m "Deploy $(git -C .. rev-parse --short HEAD)"
git push -f "$remote" gh-pages
rm -rf .git
