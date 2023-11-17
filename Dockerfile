FROM oven/bun:latest as builder

COPY . .
RUN bun install --production --no-cache
RUN bun build src/index.ts --compile --minify --outfile="/upload"

FROM gcr.io/distroless/base:nonroot
COPY --from=builder --chown=nonroot:nonroot /upload .

ENTRYPOINT ["./upload"]
