FROM rust:1.98-bookworm AS builder

ENV RUSTUP_TOOLCHAIN=1.98.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN cargo build --locked --release --example demo

FROM debian:bookworm-slim AS runner

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/examples/demo /usr/local/bin/voxelize-demo

ENV VOXELIZE_DATA_DIR=/var/data
EXPOSE 10000

CMD ["voxelize-demo"]
