#!/usr/bin/env python3
import argparse
import errno
import getpass
import json
import os
import sys
import urllib.error
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


DEFAULT_ENDPOINT = "https://ayush-ai-verma--kev27b-api.modal.run"
DEFAULT_ENDPOINT_LINE = f'const DEFAULT_ENDPOINT = "{DEFAULT_ENDPOINT}";'.encode("ascii")
REWRITTEN_ENDPOINT_LINE = b"const DEFAULT_ENDPOINT = location.origin;"
ALLOWED_PROXY_PATHS = {("GET", "/v1/models"), ("POST", "/v1/systemone")}
MAX_BODY_BYTES = 64_000
UPSTREAM_TIMEOUT_SECONDS = 600


class StartupError(Exception):
    pass


def read_dotenv(path):
    values = {}
    if not path.exists():
        return values
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        raise StartupError("Unable to read .env.") from None

    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        name, separator, value = line.partition("=")
        if not separator:
            continue
        name = name.strip()
        if name not in {"KEV_API_KEY", "KEV_ENDPOINT"}:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[name] = value
    return values


def save_key(path, key):
    if path.is_symlink():
        raise StartupError("Refusing to save the key because .env is a symbolic link.")
    try:
        existing = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    except OSError:
        raise StartupError("Unable to update .env.") from None

    kept_lines = []
    for line in existing:
        name = line.strip().partition("=")[0].strip()
        if name == "export KEV_API_KEY":
            name = "KEV_API_KEY"
        if name != "KEV_API_KEY":
            kept_lines.append(line)
    kept_lines.append(f"KEV_API_KEY={key}")
    contents = "\n".join(kept_lines) + "\n"

    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(str(path), flags, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as env_file:
            env_file.write(contents)
        os.chmod(str(path), 0o600)
    except OSError:
        raise StartupError("Unable to save the key to .env.") from None


def load_key(path, dotenv):
    key = os.environ.get("KEV_API_KEY", "").strip() or dotenv.get("KEV_API_KEY", "").strip()
    if key:
        return key
    if not sys.stdin.isatty():
        raise StartupError(
            "KEV_API_KEY is missing. Set it in the environment or .env, "
            "or run the server interactively to enter it."
        )

    key = getpass.getpass("Kev API key (input hidden): ").strip()
    if not key:
        raise StartupError("No Kev API key was provided.")
    if input("Save it to .env for next time? [y/N]").strip().lower() in {"y", "yes"}:
        save_key(path, key)
    return key


def resolve_endpoint(dotenv):
    endpoint = (
        os.environ.get("KEV_ENDPOINT", "").strip()
        or dotenv.get("KEV_ENDPOINT", "").strip()
        or DEFAULT_ENDPOINT
    ).rstrip("/")
    parsed = urlsplit(endpoint)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise StartupError(
            "KEV_ENDPOINT must be an http:// or https:// base URL without credentials, "
            "a query, or a fragment."
        )
    return endpoint, parsed.netloc


def load_rewritten_app(site_dir):
    app_path = site_dir / "app.js"
    try:
        app_js = app_path.read_bytes()
    except OSError:
        raise StartupError(f"Unable to read {app_path}.") from None
    if app_js.count(DEFAULT_ENDPOINT_LINE) != 1:
        raise StartupError(
            'site/app.js must contain exactly one expected DEFAULT_ENDPOINT line '
            'before the local server can start.'
        )
    return app_js.replace(DEFAULT_ENDPOINT_LINE, REWRITTEN_ENDPOINT_LINE, 1)


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


def make_handler(site_dir, app_js, endpoint, api_key):
    upstream = urllib.request.build_opener(NoRedirectHandler())

    class LocalHandler(SimpleHTTPRequestHandler):
        server_version = "BioinformaticsToolFinder/1.0"
        sys_version = ""

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(site_dir), **kwargs)

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def log_message(self, message, *args):
            method = getattr(self, "command", "-")
            path = urlsplit(getattr(self, "path", "")).path or "-"
            status = args[0] if args else "-"
            print(f"{method} {path} {status}", flush=True)

        def _send_json(self, status, payload):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _proxy(self, method):
            parsed_path = urlsplit(self.path)
            if (method, parsed_path.path) not in ALLOWED_PROXY_PATHS:
                self.send_error(404)
                return

            body = None
            if method == "POST":
                length_header = self.headers.get("Content-Length")
                if length_header is None:
                    self.send_error(411, "Content-Length required")
                    return
                try:
                    length = int(length_header)
                except ValueError:
                    self.send_error(400, "Invalid Content-Length")
                    return
                if length < 0:
                    self.send_error(400, "Invalid Content-Length")
                    return
                if length > MAX_BODY_BYTES:
                    self.send_error(413)
                    return
                body = self.rfile.read(length)

            path = parsed_path.path
            if parsed_path.query:
                path += "?" + parsed_path.query
            headers = {"Authorization": f"Bearer {api_key}"}
            if body is not None:
                headers["Content-Type"] = "application/json"
            request = urllib.request.Request(
                endpoint + path,
                data=body,
                method=method,
                headers=headers,
            )
            try:
                with upstream.open(request, timeout=UPSTREAM_TIMEOUT_SECONDS) as response:
                    status = response.status
                    response_body = response.read()
            except urllib.error.HTTPError as error:
                status = error.code
                response_body = error.read()
            except Exception:
                self._send_json(502, {"error": "Upstream network request failed."})
                return

            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response_body)))
            self.end_headers()
            self.wfile.write(response_body)

        def do_GET(self):
            path = urlsplit(self.path).path
            if path.startswith("/v1/"):
                self._proxy("GET")
                return
            if path == "/app.js":
                self.send_response(200)
                self.send_header("Content-Type", "text/javascript; charset=utf-8")
                self.send_header("Content-Length", str(len(app_js)))
                self.end_headers()
                self.wfile.write(app_js)
                return
            super().do_GET()

        def do_POST(self):
            self._proxy("POST")

    return LocalHandler


def bind_server(handler, requested_port, explicit_port):
    ports = [requested_port] if explicit_port else list(range(8000, 8011))
    for port in ports:
        try:
            return ThreadingHTTPServer(("127.0.0.1", port), handler)
        except OSError as error:
            if error.errno == errno.EADDRINUSE:
                if explicit_port:
                    raise StartupError(f"Port {port} is already in use.") from None
                continue
            raise StartupError(f"Could not bind to 127.0.0.1:{port}.") from None
    raise StartupError("Ports 8000 through 8010 are in use; choose another with --port.")


def main():
    parser = argparse.ArgumentParser(description="Serve the Bioinformatics Tool Finder locally.")
    parser.add_argument("--port", type=int, default=None, help="port to bind (default: 8000)")
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser")
    args = parser.parse_args()
    explicit_port = args.port is not None
    port = args.port if explicit_port else 8000
    if not 1 <= port <= 65535:
        parser.error("--port must be between 1 and 65535")

    script_dir = Path(__file__).resolve().parent
    site_dir = script_dir / "site"
    try:
        app_js = load_rewritten_app(site_dir)
        env_path = script_dir / ".env"
        dotenv = read_dotenv(env_path)
        api_key = load_key(env_path, dotenv)
        endpoint, endpoint_host = resolve_endpoint(dotenv)
        handler = make_handler(site_dir, app_js, endpoint, api_key)
        server = bind_server(handler, port, explicit_port)
    except StartupError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    address = f"http://127.0.0.1:{server.server_port}"
    print(
        f"Bioinformatics Tool Finder running at {address} "
        f"(Kev: {endpoint_host}) — Ctrl+C to stop",
        flush=True,
    )
    if not args.no_browser:
        try:
            webbrowser.open(address)
        except Exception:
            pass

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
