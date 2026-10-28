import json
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from cryptography.fernet import Fernet

from server import DeviceRegistry, make_server, normalize_address


class FakeFirewallHandler(BaseHTTPRequestHandler):
    requests: list[tuple[str, str, bytes]] = []

    def _reply(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _record(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        self.requests.append((self.path, self.headers.get("Authorization", ""), body))
        if self.headers.get("Authorization") != "Bearer device-key":
            self._reply(401, {"error": "Invalid device key"})
        else:
            self._reply(200, {"ok": True, "path": self.path, "echo": self.headers.get("Authorization")})

    def do_GET(self) -> None:
        self._record()

    def do_POST(self) -> None:
        self._record()

    def do_DELETE(self) -> None:
        self._record()

    def log_message(self, format: str, *args: object) -> None:
        pass


class RegistryHTTPTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.database_path = str(Path(self.tempdir.name) / "registry.sqlite3")
        self.encryption_key = Fernet.generate_key().decode("ascii")
        self.registry = DeviceRegistry(
            self.database_path,
            "a-secure-test-password-123",
            self.encryption_key,
        )
        self.server = make_server(self.registry, ("127.0.0.1", 0))
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.connection = HTTPConnection("127.0.0.1", self.server.server_port)
        FakeFirewallHandler.requests = []
        self.firewall = ThreadingHTTPServer(("127.0.0.1", 0), FakeFirewallHandler)
        self.firewall_thread = threading.Thread(target=self.firewall.serve_forever)
        self.firewall_thread.start()

    def tearDown(self):
        self.connection.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.firewall.shutdown()
        self.firewall.server_close()
        self.firewall_thread.join()
        self.tempdir.cleanup()

    def request(self, method, path, data=None, token=None, headers=None):
        request_headers = dict(headers or {})
        body = None
        if data is not None:
            body = json.dumps(data)
            request_headers["Content-Type"] = "application/json"
        if token:
            request_headers["Authorization"] = f"Bearer {token}"
        self.connection.request(method, path, body, request_headers)
        response = self.connection.getresponse()
        payload = response.read()
        return response, json.loads(payload) if payload else None

    def login(self):
        response, payload = self.request("POST", "/api/v1/session", {"password": "a-secure-test-password-123"})
        self.assertEqual(response.status, 200)
        return payload["token"]

    def test_cors_allows_preflight_and_registry_uses_no_credentials(self):
        response, _ = self.request(
            "OPTIONS",
            "/api/v1/devices",
            headers={
                "Origin": "https://dashboard.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        self.assertEqual(response.status, 204)
        self.assertEqual(response.getheader("Access-Control-Allow-Origin"), "*")
        self.assertEqual(response.getheader("Access-Control-Allow-Methods"), "GET, POST, DELETE, OPTIONS")
        self.assertEqual(response.getheader("Access-Control-Allow-Headers"), "Authorization, Content-Type")
        self.assertIsNone(response.getheader("Access-Control-Allow-Credentials"))

    def test_overview_layout_requires_auth_and_persists_across_registry_instances(self):
        path = "/api/v1/preferences/overview"
        for method in ("GET", "POST"):
            response, _ = self.request(method, path, {} if method == "POST" else None)
            self.assertEqual(response.status, 401)
        token = self.login()
        response, default = self.request("GET", path, token=token)
        self.assertEqual(response.status, 200)
        self.assertEqual(default, {
            "version": 1, "columns": [["interfaces", "gateways", "wireguard", "bgp"], ["system", "counters"]],
        })
        layout = {"version": 1, "columns": [["bgp", "counters", "interfaces"], ["system"]]}
        response, saved = self.request("POST", path, layout, token)
        self.assertEqual(response.status, 200)
        self.assertEqual(saved, layout)
        reopened = DeviceRegistry(self.database_path, "a-secure-test-password-123", self.encryption_key)
        self.assertEqual(reopened.get_overview_layout(), layout)
        response, loaded = self.request("GET", path, token=token)
        self.assertEqual(loaded, layout)
        response, hidden = self.request("POST", path, {"version": 1, "columns": [[], []]}, token)
        self.assertEqual(response.status, 200)
        self.assertEqual(hidden["columns"], [[], []])

    def test_invalid_overview_layout_does_not_overwrite_saved_layout(self):
        token = self.login()
        invalid = [
            {}, {"version": 2, "columns": [[], []]}, {"version": True, "columns": [[], []]},
            {"version": 1, "columns": [["unknown"], []]},
            {"version": 1, "columns": [["interfaces"], ["interfaces"]]},
            {"version": 1, "columns": [[]]}, {"version": 1, "columns": [None, []]},
            {"version": 1, "columns": [[{}], []]},
            {"version": 1, "columns": [[], []], "extra": True},
        ]
        before = self.registry.get_overview_layout()
        for value in invalid:
            with self.subTest(layout=value):
                response, payload = self.request("POST", "/api/v1/preferences/overview", value, token)
                self.assertEqual(response.status, 400)
                self.assertIn("error", payload)
                self.assertEqual(self.registry.get_overview_layout(), before)

    def test_durable_session_restores_from_httponly_cookie_and_signs_out(self):
        origin = {"Origin": "http://localhost:3030"}
        response, payload = self.request("POST", "/api/v1/session", {"password": "a-secure-test-password-123"}, headers=origin)
        cookie = response.getheader("Set-Cookie")
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        self.assertIn("Path=/api/v1/session", cookie)
        self.assertIn("Max-Age=28800", cookie)
        self.assertEqual(response.getheader("Access-Control-Allow-Origin"), origin["Origin"])
        self.assertEqual(response.getheader("Access-Control-Allow-Credentials"), "true")
        response, restored = self.request("GET", "/api/v1/session", headers={**origin, "Cookie": cookie.split(";", 1)[0]})
        self.assertEqual(response.status, 200)
        self.assertEqual(restored["token"], payload["token"])
        self.assertLessEqual(restored["expires_in"], 28800)
        response, _ = self.request("POST", "/api/v1/session/logout", {}, headers=origin)
        self.assertEqual(response.status, 200)
        self.assertIn("Max-Age=0", response.getheader("Set-Cookie"))

    def test_durable_session_rejects_untrusted_origins(self):
        token = self.login()
        response, _ = self.request("GET", "/api/v1/session", headers={
            "Origin": "https://untrusted.example", "Cookie": f"registry_session={token}",
        })
        self.assertEqual(response.status, 403)
        self.assertIsNone(response.getheader("Access-Control-Allow-Credentials"))
        response, _ = self.request("POST", "/api/v1/session/logout", {}, headers={"Origin": "https://untrusted.example"})
        self.assertEqual(response.status, 403)

    def test_durable_session_rejects_missing_or_invalid_cookies(self):
        for cookie in ("", "registry_session=invalid"):
            response, _ = self.request("GET", "/api/v1/session", headers={"Cookie": cookie})
            self.assertEqual(response.status, 401)
            self.assertIn("Max-Age=0", response.getheader("Set-Cookie"))

    def test_device_secrets_stay_server_side_and_proxy_uses_the_saved_key(self):
        token = self.login()
        address = f"http://127.0.0.1:{self.firewall.server_port}"
        response, payload = self.request(
            "POST",
            "/api/v1/devices",
            {"name": "Lab firewall", "address": address, "credential": "device-key"},
            token,
        )
        self.assertEqual(response.status, 201)
        device = payload["device"]
        self.assertNotIn("credential", device)

        response, payload = self.request("GET", "/api/v1/devices", token=token)
        self.assertEqual(response.status, 200)
        self.assertEqual(payload["devices"], [device])
        self.assertNotIn("device-key", json.dumps(payload))

        response, _ = self.request("POST", f"/api/v1/devices/{device['id']}/credential", {}, token)
        self.assertEqual(response.status, 404)

        response, payload = self.request(
            "GET", f"/api/v1/devices/{device['id']}/proxy/state?view=live", token=token
        )
        self.assertEqual(response.status, 200)
        self.assertEqual(payload, {"ok": True, "path": "/api/v1/state?view=live", "echo": "Bearer [redacted]"})
        self.assertNotIn("device-key", json.dumps(payload))
        self.assertEqual(
            FakeFirewallHandler.requests,
            [("/api/v1/state?view=live", "Bearer device-key", b"")],
        )
        self.assertEqual(response.getheader("Access-Control-Allow-Origin"), "*")

        with self.registry._connection() as connection:
            encrypted = connection.execute(
                "SELECT encrypted_credential FROM devices WHERE id = ?", (device["id"],)
            ).fetchone()[0]
        self.assertNotIn(b"device-key", encrypted)

    def test_proxy_preserves_connection_pagination_and_encoded_filters(self):
        token = self.login()
        _, created = self.request(
            "POST",
            "/api/v1/devices",
            {
                "name": "Connections test firewall",
                "address": f"http://127.0.0.1:{self.firewall.server_port}",
                "credential": "device-key",
            },
            token,
        )
        device_id = created["device"]["id"]
        for query in (
            "limit=100&offset=0",
            "address=2001%3Adb8%3A%3A1&protocol=tcp&port=0&zone=0&limit=100&offset=100",
        ):
            with self.subTest(query=query):
                endpoint = f"/statistics/connections?{query}"
                response, payload = self.request(
                    "GET", f"/api/v1/devices/{device_id}/proxy{endpoint}", token=token
                )
                self.assertEqual(response.status, 200)
                self.assertEqual(payload["path"], f"/api/v1{endpoint}")
                self.assertEqual(FakeFirewallHandler.requests[-1][0], f"/api/v1{endpoint}")
                self.assertEqual(FakeFirewallHandler.requests[-1][2], b"")
        self.assertEqual(len(FakeFirewallHandler.requests), 2)

    def test_proxy_forwards_post_body_and_rejects_missing_registry_session(self):
        token = self.login()
        _, created = self.request(
            "POST",
            "/api/v1/devices",
            {
                "name": "Mutation test firewall",
                "address": f"http://127.0.0.1:{self.firewall.server_port}",
                "credential": "device-key",
            },
            token,
        )
        device_id = created["device"]["id"]
        body = {"base_revision": 7, "config": {"enabled": True}}
        response, payload = self.request(
            "POST", f"/api/v1/devices/{device_id}/proxy/transactions", body, token
        )
        self.assertEqual(response.status, 200)
        self.assertEqual(payload["path"], "/api/v1/transactions")
        self.assertEqual(FakeFirewallHandler.requests[-1][1], "Bearer device-key")
        self.assertEqual(json.loads(FakeFirewallHandler.requests[-1][2]), body)

        response, _ = self.request(
            "POST", f"/api/v1/devices/{device_id}/proxy/transactions", body
        )
        self.assertEqual(response.status, 401)
        self.assertEqual(response.getheader("X-Registry-Auth-Error"), "true")
        self.assertEqual(len(FakeFirewallHandler.requests), 1)

    def test_proxy_forwards_delete_json_and_requires_authentication(self):
        token = self.login()
        _, created = self.request("POST", "/api/v1/devices", {
            "name": "Deletion test firewall",
            "address": f"http://127.0.0.1:{self.firewall.server_port}",
            "credential": "device-key",
        }, token)
        device_id = created["device"]["id"]
        endpoint = f"/api/v1/devices/{device_id}/proxy/connections"
        response, _ = self.request("OPTIONS", endpoint, headers={
            "Origin": "https://dashboard.example", "Access-Control-Request-Method": "DELETE",
            "Access-Control-Request-Headers": "authorization,content-type",
        })
        self.assertEqual(response.status, 204)
        self.assertIn("DELETE", response.getheader("Access-Control-Allow-Methods"))
        for suffix, body in [("", {"confirm": True}), ("/123", {
            "family": "ipv4", "protocol": 6, "zone": 0,
            "original": {"source": "192.0.2.2", "destination": "198.51.100.2", "source_port": 50000, "destination_port": 443},
        })]:
            with self.subTest(suffix=suffix):
                response, _ = self.request("DELETE", endpoint + suffix, body, token)
                self.assertEqual(response.status, 200)
                self.assertEqual(FakeFirewallHandler.requests[-1], (
                    "/api/v1/connections" + suffix, "Bearer device-key", json.dumps(body).encode("utf-8"),
                ))
        response, _ = self.request("DELETE", endpoint, {"confirm": True})
        self.assertEqual(response.status, 401)
        self.assertEqual(response.getheader("X-Registry-Auth-Error"), "true")
        self.assertEqual(len(FakeFirewallHandler.requests), 2)
        response, _ = self.request("DELETE", f"/api/v1/devices/{device_id}", {}, token)
        self.assertEqual(response.status, 405)

    def test_device_can_be_updated_and_deleted(self):
        token = self.login()
        _, created = self.request(
            "POST",
            "/api/v1/devices",
            {"name": "Lab firewall", "address": "192.0.2.1:8080", "credential": "device-key"},
            token,
        )
        device_id = created["device"]["id"]

        response, payload = self.request(
            "POST",
            f"/api/v1/devices/{device_id}/update",
            {"name": "Renamed firewall", "address": "https://192.0.2.2:8080"},
            token,
        )
        self.assertEqual(response.status, 200)
        self.assertEqual(payload["device"]["name"], "Renamed firewall")
        self.assertEqual(payload["device"]["address"], "https://192.0.2.2:8080")

        response, _ = self.request("POST", f"/api/v1/devices/{device_id}/credential", {}, token)
        self.assertEqual(response.status, 404)

        response, payload = self.request(
            "POST",
            f"/api/v1/devices/{device_id}/update",
            {"name": "Renamed firewall", "address": f"http://127.0.0.1:{self.firewall.server_port}", "credential": "rotated-key"},
            token,
        )
        self.assertEqual(response.status, 200)
        response, _ = self.request("GET", f"/api/v1/devices/{device_id}/proxy/state", token=token)
        self.assertEqual(response.status, 401)
        self.assertNotEqual(response.getheader("X-Registry-Auth-Error"), "true")
        self.assertEqual(FakeFirewallHandler.requests[-1][1], "Bearer rotated-key")

        response, payload = self.request("POST", f"/api/v1/devices/{device_id}/delete", {}, token)
        self.assertEqual(response.status, 200)
        self.assertTrue(payload["deleted"])
        response, _ = self.request("POST", f"/api/v1/devices/{device_id}/credential", {}, token)
        self.assertEqual(response.status, 404)

    def test_login_required_and_invalid_device_addresses_are_rejected(self):
        response, _ = self.request("GET", "/api/v1/devices")
        self.assertEqual(response.status, 401)
        response, _ = self.request("POST", "/api/v1/session", {"password": "wrong"})
        self.assertEqual(response.status, 401)
        for address in (
            "https://user:pass@firewall.example",
            "http://firewall.example/api/v1",
            "http://firewall.example?",
            "ftp://firewall.example",
        ):
            with self.subTest(address=address):
                with self.assertRaises(ValueError):
                    normalize_address(address)

    def test_device_records_survive_registry_restart(self):
        token = self.login()
        response, payload = self.request(
            "POST",
            "/api/v1/devices",
            {"name": "Persistent firewall", "address": "https://192.0.2.1", "credential": "durable-key"},
            token,
        )
        self.assertEqual(response.status, 201)
        device_id = payload["device"]["id"]

        restarted = DeviceRegistry(
            self.database_path,
            "a-secure-test-password-123",
            self.encryption_key,
        )
        self.assertEqual(restarted.list_devices()[0]["id"], device_id)
        self.assertEqual(restarted.get_proxy_target(device_id)[1], "durable-key")


if __name__ == "__main__":
    unittest.main()
