import json
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path

from cryptography.fernet import Fernet

from server import DeviceRegistry, make_server, normalize_address


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

    def tearDown(self):
        self.connection.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
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
        self.assertEqual(response.getheader("Access-Control-Allow-Methods"), "GET, POST, OPTIONS")
        self.assertEqual(response.getheader("Access-Control-Allow-Headers"), "Authorization, Content-Type")
        self.assertIsNone(response.getheader("Access-Control-Allow-Credentials"))

    def test_device_secrets_are_encrypted_and_only_returned_on_request(self):
        token = self.login()
        response, payload = self.request(
            "POST",
            "/api/v1/devices",
            {"name": "Lab firewall", "address": "https://192.0.2.1:8080", "credential": "device-key"},
            token,
        )
        self.assertEqual(response.status, 201)
        device = payload["device"]
        self.assertNotIn("credential", device)

        response, payload = self.request("GET", "/api/v1/devices", token=token)
        self.assertEqual(response.status, 200)
        self.assertEqual(payload["devices"], [device])
        self.assertNotIn("device-key", json.dumps(payload))

        response, payload = self.request("POST", f"/api/v1/devices/{device['id']}/credential", {}, token)
        self.assertEqual(response.status, 200)
        self.assertEqual(payload["credential"], "device-key")

        with self.registry._connection() as connection:
            encrypted = connection.execute(
                "SELECT encrypted_credential FROM devices WHERE id = ?", (device["id"],)
            ).fetchone()[0]
        self.assertNotIn(b"device-key", encrypted)

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

        response, payload = self.request("POST", f"/api/v1/devices/{device_id}/credential", {}, token)
        self.assertEqual(payload["credential"], "device-key")

        response, payload = self.request(
            "POST",
            f"/api/v1/devices/{device_id}/update",
            {"name": "Renamed firewall", "address": "https://192.0.2.2:8080", "credential": "rotated-key"},
            token,
        )
        self.assertEqual(response.status, 200)
        response, payload = self.request("POST", f"/api/v1/devices/{device_id}/credential", {}, token)
        self.assertEqual(payload["credential"], "rotated-key")

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
        self.assertEqual(restarted.get_credential(device_id), "durable-key")


if __name__ == "__main__":
    unittest.main()
