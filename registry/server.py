from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import ssl
import threading
import time
import uuid
from collections import defaultdict, deque
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from cryptography.fernet import Fernet, InvalidToken

SESSION_LIFETIME_SECONDS = 8 * 60 * 60
MAX_BODY_BYTES = 64 * 1024
MAX_DEVICES = 500
NAME_LIMIT = 80
ADDRESS_LIMIT = 300
CREDENTIAL_LIMIT = 4096


def encode_token(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def decode_token(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def normalize_address(value: object) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > ADDRESS_LIMIT:
        raise ValueError("Enter a device origin such as https://192.0.2.1:8080")
    address = value.strip()
    if "://" not in address:
        address = f"http://{address}"
    try:
        parsed = urlsplit(address)
        _ = parsed.port
    except ValueError as error:
        raise ValueError("Enter a valid device address and port") from error
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
        or "?" in address
        or "#" in address
    ):
        raise ValueError("Device address must be an http(s) origin without credentials, path, query or fragment")
    return f"{parsed.scheme}://{parsed.netloc}"


def normalize_name(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("Device name is required")
    name = value.strip()
    if not name or len(name) > NAME_LIMIT or any(ord(char) < 32 for char in name):
        raise ValueError(f"Device name must be 1 to {NAME_LIMIT} printable characters")
    return name


def normalize_credential(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("A device bearer key is required")
    credential = value.strip()
    if not credential or len(credential) > CREDENTIAL_LIMIT or "\r" in credential or "\n" in credential:
        raise ValueError(f"Device bearer key must be 1 to {CREDENTIAL_LIMIT} characters without newlines")
    return credential


class DeviceRegistry:
    def __init__(self, database_path: str, admin_password: str, encryption_key: str):
        if len(admin_password) < 16:
            raise ValueError("REGISTRY_ADMIN_PASSWORD must contain at least 16 characters")
        if not database_path:
            raise ValueError("REGISTRY_DB_PATH is required")
        try:
            encryption_key_bytes = encryption_key.encode("ascii")
            self.cipher = Fernet(encryption_key_bytes)
            raw_key = base64.urlsafe_b64decode(encryption_key_bytes)
        except (UnicodeEncodeError, ValueError) as error:
            raise ValueError("REGISTRY_ENCRYPTION_KEY must be a valid Fernet key") from error
        self.admin_password = admin_password.encode("utf-8")
        self.session_key = hmac.digest(raw_key, b"firewall-controller-registry-session-v1", "sha256")
        self.database_path = database_path
        self.login_failures: dict[str, deque[float]] = defaultdict(deque)
        self.login_lock = threading.Lock()
        parent = Path(database_path).parent
        parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        self._connect().close()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute(
            """CREATE TABLE IF NOT EXISTS devices (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                address TEXT NOT NULL,
                encrypted_credential BLOB NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"""
        )
        connection.commit()
        return connection

    @contextmanager
    def _connection(self):
        connection = self._connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _session_token(self) -> str:
        now = int(time.time())
        payload = json.dumps(
            {"exp": now + SESSION_LIFETIME_SECONDS, "iat": now, "nonce": secrets.token_urlsafe(18)},
            separators=(",", ":"),
        ).encode("utf-8")
        encoded = encode_token(payload)
        signature = encode_token(hmac.digest(self.session_key, encoded.encode("ascii"), "sha256"))
        return f"{encoded}.{signature}"

    def authenticate_password(self, password: object, client: str) -> str:
        now = time.monotonic()
        with self.login_lock:
            failures = self.login_failures[client]
            while failures and failures[0] <= now - 900:
                failures.popleft()
            if len(failures) >= 5:
                raise PermissionError("Too many failed login attempts; try again in 15 minutes")
            supplied = password.encode("utf-8") if isinstance(password, str) else b""
            if not hmac.compare_digest(supplied, self.admin_password):
                failures.append(now)
                raise PermissionError("Invalid registry password")
            failures.clear()
        return self._session_token()

    def verify_session(self, token: str) -> bool:
        try:
            encoded, signature = token.split(".", 1)
            expected = hmac.digest(self.session_key, encoded.encode("ascii"), "sha256")
            if not hmac.compare_digest(decode_token(signature), expected):
                return False
            payload = json.loads(decode_token(encoded))
            return isinstance(payload.get("exp"), int) and payload["exp"] > int(time.time())
        except (ValueError, UnicodeError, binascii.Error, json.JSONDecodeError, AttributeError):
            return False

    @staticmethod
    def _public(row: sqlite3.Row) -> dict[str, str]:
        return {
            "id": row["id"],
            "name": row["name"],
            "address": row["address"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def list_devices(self) -> list[dict[str, str]]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT id, name, address, created_at, updated_at FROM devices ORDER BY name COLLATE NOCASE, id"
            ).fetchall()
        return [self._public(row) for row in rows]

    def create_device(self, name: object, address: object, credential: object) -> dict[str, str]:
        device_id = str(uuid.uuid4())
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        values = (
            device_id,
            normalize_name(name),
            normalize_address(address),
            self.cipher.encrypt(normalize_credential(credential).encode("utf-8")),
            now,
            now,
        )
        with self._connection() as connection:
            count = connection.execute("SELECT COUNT(*) FROM devices").fetchone()[0]
            if count >= MAX_DEVICES:
                raise ValueError(f"Registry is limited to {MAX_DEVICES} devices")
            connection.execute(
                "INSERT INTO devices (id, name, address, encrypted_credential, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                values,
            )
            row = connection.execute(
                "SELECT id, name, address, created_at, updated_at FROM devices WHERE id = ?", (device_id,)
            ).fetchone()
        return self._public(row)

    def get_credential(self, device_id: str) -> str:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT encrypted_credential FROM devices WHERE id = ?", (device_id,)
            ).fetchone()
        if row is None:
            raise LookupError("Device not found")
        try:
            return self.cipher.decrypt(row["encrypted_credential"]).decode("utf-8")
        except (InvalidToken, UnicodeDecodeError) as error:
            raise RuntimeError("Stored device credential could not be decrypted") from error

    def update_device(self, device_id: str, name: object, address: object, credential: object = None) -> dict[str, str]:
        normalized_name = normalize_name(name)
        normalized_address = normalize_address(address)
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with self._connection() as connection:
            row = connection.execute("SELECT * FROM devices WHERE id = ?", (device_id,)).fetchone()
            if row is None:
                raise LookupError("Device not found")
            encrypted = row["encrypted_credential"]
            if credential is not None and credential != "":
                encrypted = self.cipher.encrypt(normalize_credential(credential).encode("utf-8"))
            connection.execute(
                "UPDATE devices SET name = ?, address = ?, encrypted_credential = ?, updated_at = ? WHERE id = ?",
                (normalized_name, normalized_address, encrypted, now, device_id),
            )
            updated = connection.execute(
                "SELECT id, name, address, created_at, updated_at FROM devices WHERE id = ?", (device_id,)
            ).fetchone()
        return self._public(updated)

    def delete_device(self, device_id: str) -> None:
        with self._connection() as connection:
            result = connection.execute("DELETE FROM devices WHERE id = ?", (device_id,))
            if result.rowcount == 0:
                raise LookupError("Device not found")


def make_server(
    registry: DeviceRegistry,
    address: tuple[str, int],
    tls_certificate: str = "",
    tls_private_key: str = "",
) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        server_version = "DeviceRegistry"

        def _send(self, status: int, data: object = None, headers: dict[str, str] | None = None) -> None:
            payload = b"" if data is None else json.dumps(data, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if self.path.startswith("/api/v1/"):
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Expose-Headers", "WWW-Authenticate")
            for name, value in (headers or {}).items():
                self.send_header(name, value)
            if data is not None:
                self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            if payload:
                self.wfile.write(payload)

        def _body(self) -> dict[str, object]:
            raw_length = self.headers.get("Content-Length", "")
            if not raw_length.isdigit() or int(raw_length) > MAX_BODY_BYTES:
                raise ValueError("Request body is missing or exceeds the 64 KiB limit")
            try:
                value = json.loads(self.rfile.read(int(raw_length)))
            except (json.JSONDecodeError, UnicodeDecodeError) as error:
                raise ValueError("Request body must be valid JSON") from error
            if not isinstance(value, dict):
                raise ValueError("Request body must be a JSON object")
            return value

        def _authorized(self) -> bool:
            header = self.headers.get("Authorization", "")
            scheme, separator, token = header.partition(" ")
            return bool(separator and scheme == "Bearer" and self.registry.verify_session(token))

        def do_OPTIONS(self) -> None:
            if not self.path.startswith("/api/v1/"):
                self._send(404, {"error": "Not found"})
                return
            requested_method = self.headers.get("Access-Control-Request-Method", "")
            requested_headers = {
                item.strip().lower()
                for item in self.headers.get("Access-Control-Request-Headers", "").split(",")
                if item.strip()
            }
            if requested_method not in ("GET", "POST") or not requested_headers.issubset(
                {"authorization", "content-type"}
            ):
                self._send(405, {"error": "Unsupported cross-origin method or header"})
                return
            self._send(204, headers={
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Authorization, Content-Type",
                "Access-Control-Max-Age": "600",
            })

        def do_GET(self) -> None:
            if self.path == "/health":
                self._send(200, {"status": "ok"})
                return
            if self.path != "/api/v1/devices":
                self._send(404, {"error": "Not found"})
                return
            if not self._authorized():
                self._send(401, {"error": "Registry login required"})
                return
            try:
                devices = self.registry.list_devices()
            except sqlite3.Error as error:
                self.log_error("device registry database read failed: %s", error)
                self._send(503, {"error": "Device registry storage is unavailable"})
                return
            self._send(200, {"devices": devices})

        def do_POST(self) -> None:
            try:
                body = self._body()
                path = urlsplit(self.path).path
                if path == "/api/v1/session":
                    token = self.registry.authenticate_password(body.get("password"), self.client_address[0])
                    self._send(200, {"token": token, "expires_in": SESSION_LIFETIME_SECONDS})
                    return
                if not self._authorized():
                    self._send(401, {"error": "Registry login required"})
                    return
                if path == "/api/v1/devices":
                    self._send(201, {"device": self.registry.create_device(
                        body.get("name"), body.get("address"), body.get("credential")
                    )})
                    return
                match = re.fullmatch(r"/api/v1/devices/([0-9a-fA-F-]{36})/(credential|update|delete)", path)
                if match is None:
                    self._send(404, {"error": "Not found"})
                    return
                device_id, action = match.groups()
                if action == "credential":
                    self._send(200, {"credential": self.registry.get_credential(device_id)})
                elif action == "update":
                    self._send(200, {"device": self.registry.update_device(
                        device_id, body.get("name"), body.get("address"), body.get("credential")
                    )})
                else:
                    self.registry.delete_device(device_id)
                    self._send(200, {"deleted": True})
            except PermissionError as error:
                self._send(429 if str(error).startswith("Too many") else 401, {"error": str(error)})
            except LookupError as error:
                self._send(404, {"error": str(error)})
            except (ValueError, TypeError) as error:
                self._send(400, {"error": str(error)})
            except sqlite3.Error as error:
                self.log_error("device registry database operation failed: %s", error)
                self._send(503, {"error": "Device registry storage is unavailable"})
            except RuntimeError as error:
                self.log_error("device registry secret operation failed: %s", error)
                self._send(500, {"error": "Stored device key could not be decrypted"})

        def do_PUT(self) -> None:
            self._send(405, {"error": "Method not allowed"})

        def do_DELETE(self) -> None:
            self._send(405, {"error": "Method not allowed"})

    Handler.registry = registry
    server = ThreadingHTTPServer(address, Handler)
    if bool(tls_certificate) != bool(tls_private_key):
        server.server_close()
        raise ValueError("REGISTRY_TLS_CERT and REGISTRY_TLS_KEY must be configured together")
    if tls_certificate:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(tls_certificate, tls_private_key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
    return server


def main() -> None:
    password = os.environ.get("REGISTRY_ADMIN_PASSWORD", "")
    encryption_key = os.environ.get("REGISTRY_ENCRYPTION_KEY", "")
    database_path = os.environ.get("REGISTRY_DB_PATH", "/data/registry.sqlite3")
    tls_certificate = os.environ.get("REGISTRY_TLS_CERT", "")
    tls_private_key = os.environ.get("REGISTRY_TLS_KEY", "")
    try:
        registry = DeviceRegistry(database_path, password, encryption_key)
        port = int(os.environ.get("REGISTRY_PORT", "8080"))
        server = make_server(
            registry, ("0.0.0.0", port), tls_certificate, tls_private_key
        )
    except (ValueError, OSError) as error:
        raise SystemExit(f"Device registry configuration error: {error}") from error
    protocol = "https" if tls_certificate else "http"
    print(f"Device registry listening on {protocol} port {port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
