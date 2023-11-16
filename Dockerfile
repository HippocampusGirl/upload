FROM node

RUN --mount=target=/upload \
    cp -r /upload /tmp \
    && cd /tmp/upload \
    && npm run build \
    && install --mode=555 --target-directory=/usr/local/bin upload.cjs \
    && cd /tmp \
    && rm -rf *

ENTRYPOINT ["/usr/local/bin/upload.cjs"]
