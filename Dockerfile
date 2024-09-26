FROM node as build

# Run a clean build of the project and package it
RUN --mount=type=bind,source=src,target=/upload/src \
    --mount=type=bind,source=package.json,target=/upload/package.json \
    --mount=type=bind,source=package-lock.json,target=/upload/package-lock.json \
    --mount=type=bind,source=tsconfig.json,target=/upload/tsconfig.json \
    cd /upload \
    && npm clean-install \
    && npm run build \
    && mv --verbose /$(npm pack --pack-destination /) /upload.tgz

FROM node:slim

# Copy the built package and install it globally
RUN --mount=type=bind,from=build,source=/upload.tgz,target=/upload.tgz \
    npm install --global /upload.tgz

ENTRYPOINT ["/usr/local/bin/upload"]
