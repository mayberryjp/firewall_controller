FROM debian:bookworm-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    REGISTRY_DB_PATH=/data/registry.sqlite3 \
    REGISTRY_PORT=8080

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-cryptography ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home registry \
    && mkdir /data \
    && chown registry:registry /data
COPY server.py ./
USER 10001:10001
EXPOSE 8080
CMD ["python3", "server.py"]
