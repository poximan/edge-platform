import sqlite3
import threading
import time
from pathlib import Path


class MetricsStorage:
    def __init__(self, path: str, retention_days: int) -> None:
        self.path = path
        self.retention_seconds = retention_days * 86400
        self.lock = threading.RLock()
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self.lock, self._connect() as connection:
            connection.executescript(
                """
                PRAGMA journal_mode=WAL;
                PRAGMA synchronous=NORMAL;
                CREATE TABLE IF NOT EXISTS container_samples (
                    sampled_at INTEGER NOT NULL,
                    container_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    product TEXT NOT NULL,
                    cpu_percent REAL NOT NULL,
                    memory_bytes INTEGER NOT NULL,
                    memory_limit_bytes INTEGER NOT NULL,
                    writable_bytes INTEGER NOT NULL,
                    block_read_bytes INTEGER NOT NULL,
                    block_write_bytes INTEGER NOT NULL,
                    network_rx_bytes INTEGER NOT NULL,
                    network_tx_bytes INTEGER NOT NULL,
                    PRIMARY KEY (sampled_at, container_id)
                );
                CREATE INDEX IF NOT EXISTS ix_container_samples_product_time
                    ON container_samples(product, sampled_at);
                CREATE TABLE IF NOT EXISTS host_samples (
                    sampled_at INTEGER PRIMARY KEY,
                    disk_total_bytes INTEGER NOT NULL,
                    disk_used_bytes INTEGER NOT NULL,
                    memory_total_bytes INTEGER NOT NULL,
                    memory_used_bytes INTEGER NOT NULL,
                    swap_total_bytes INTEGER NOT NULL,
                    swap_used_bytes INTEGER NOT NULL,
                    image_bytes INTEGER NOT NULL,
                    build_cache_bytes INTEGER NOT NULL,
                    volume_bytes INTEGER NOT NULL
                );
                """
            )

    def save(self, sampled_at: int, containers: list[dict], host: dict) -> None:
        cutoff = sampled_at - self.retention_seconds
        rows = [
            (
                sampled_at, item["id"], item["name"], item["product"], item["cpu_percent"],
                item["memory_bytes"], item["memory_limit_bytes"], item["writable_bytes"],
                item["block_read_bytes"], item["block_write_bytes"],
                item["network_rx_bytes"], item["network_tx_bytes"],
            )
            for item in containers
        ]
        with self.lock, self._connect() as connection:
            connection.executemany(
                """
                INSERT INTO container_samples VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(sampled_at, container_id) DO UPDATE SET
                    name=excluded.name, product=excluded.product,
                    cpu_percent=excluded.cpu_percent, memory_bytes=excluded.memory_bytes,
                    memory_limit_bytes=excluded.memory_limit_bytes, writable_bytes=excluded.writable_bytes,
                    block_read_bytes=excluded.block_read_bytes, block_write_bytes=excluded.block_write_bytes,
                    network_rx_bytes=excluded.network_rx_bytes, network_tx_bytes=excluded.network_tx_bytes
                """,
                rows,
            )
            connection.execute(
                "INSERT OR REPLACE INTO host_samples VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    sampled_at, host["disk_total_bytes"], host["disk_used_bytes"],
                    host["memory_total_bytes"], host["memory_used_bytes"],
                    host["swap_total_bytes"], host["swap_used_bytes"],
                    host["image_bytes"], host["build_cache_bytes"], host["volume_bytes"],
                ),
            )
            connection.execute("DELETE FROM container_samples WHERE sampled_at < ?", (cutoff,))
            connection.execute("DELETE FROM host_samples WHERE sampled_at < ?", (cutoff,))

    def history(self, hours: int, product: str | None) -> dict:
        now = int(time.time())
        since = now - hours * 3600
        bucket = 60 if hours <= 6 else 300 if hours <= 24 else 1800 if hours <= 168 else 7200
        product_sql = " AND product = ?" if product else ""
        params: tuple = (bucket, bucket, since, product) if product else (bucket, bucket, since)
        with self.lock, self._connect() as connection:
            product_rows = connection.execute(
                f"""
                SELECT (sampled_at / ?) * ? AS sampled_at, product,
                       AVG(cpu_total) AS cpu_percent, AVG(memory_total) AS memory_bytes,
                       AVG(writable_total) AS writable_bytes
                FROM (
                    SELECT sampled_at, product, SUM(cpu_percent) AS cpu_total,
                           SUM(memory_bytes) AS memory_total, SUM(writable_bytes) AS writable_total
                    FROM container_samples
                    WHERE sampled_at >= ?{product_sql}
                    GROUP BY sampled_at, product
                )
                GROUP BY (sampled_at / {bucket}), product
                ORDER BY sampled_at, product
                """,
                params,
            ).fetchall()
            host_rows = connection.execute(
                """
                SELECT (sampled_at / ?) * ? AS sampled_at,
                       AVG(disk_used_bytes) AS disk_used_bytes,
                       AVG(disk_total_bytes) AS disk_total_bytes,
                       AVG(memory_used_bytes) AS memory_used_bytes,
                       AVG(memory_total_bytes) AS memory_total_bytes,
                       AVG(swap_used_bytes) AS swap_used_bytes,
                       AVG(swap_total_bytes) AS swap_total_bytes,
                       AVG(image_bytes) AS image_bytes,
                       AVG(build_cache_bytes) AS build_cache_bytes,
                       AVG(volume_bytes) AS volume_bytes
                FROM host_samples WHERE sampled_at >= ?
                GROUP BY (sampled_at / ?) ORDER BY sampled_at
                """,
                (bucket, bucket, since, bucket),
            ).fetchall()
        return {
            "hours": hours,
            "bucket_seconds": bucket,
            "products": [dict(row) for row in product_rows],
            "host": [dict(row) for row in host_rows],
        }
