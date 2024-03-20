#!/usr/bin/env sh

set -x
set -e

npm_deps_hash=$(nix shell nixpkgs#prefetch-npm-deps --command prefetch-npm-deps $1)
sed -i "s#npmDepsHash = .*#npmDepsHash = \"${npm_deps_hash}\";#g" default.nix
