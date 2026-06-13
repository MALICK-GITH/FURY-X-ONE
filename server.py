from http.client import RemoteDisconnected
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from socket import timeout as SocketTimeout
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import json
import mimetypes
import os
import ssl
import time


PORT = 3000
BASE_DIR = Path(__file__).resolve().parent
API_URL = (
    "https://888starz.bet/service-api/LiveFeed/Get1x2_VZip"
    "?sports=85&count=80&lng=fr&gr=789&mode=4&country=96"
    "&partner=233&getEmpty=true&virtualSports=true&noFilterBlockEvent=true"
)
API_URL_1XBET = (
    "https://1xbet.com/service-api/LiveFeed/Get1x2_VZip"
    "?sports=85&count=40&lng=fr&gr=285&mode=4&country=96"
    "&getEmpty=true&virtualSports=true&noFilterBlockEvent=true"
)
CHAT_API_KEY = os.environ.get("FURY_CHAT_API_KEY", "devx-s3lkpld19bvhbsv2ex5omi1b2vjet5a5")
CHAT_API_URL = "https://aimodelapi.onrender.com/v1/chat/completions"
CHAT_MODEL = "deepseek-r1"
PREDICTION_API_URL = "https://top-modele-train-api.onrender.com/predict"


class FuryRequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/matches":
            self.proxy_matches()
            return

        relative_path = "index.html" if self.path in ("/", "") else self.path.lstrip("/")
        file_path = (BASE_DIR / relative_path).resolve()

        if BASE_DIR not in file_path.parents and file_path != BASE_DIR / "index.html":
            self.send_error(403, "AccÃ¨s refusÃ©")
            return

        if not file_path.exists() or not file_path.is_file():
            self.send_error(404, "Fichier introuvable")
            return

        self.serve_file(file_path)

    def do_POST(self):
        if self.path == "/api/prediction":
            self.proxy_prediction()
            return
        if self.path == "/api/assistant":
            self.proxy_assistant()
            return
        self.send_error(404, "Endpoint introuvable")

    def serve_file(self, file_path: Path):
        content_type, _ = mimetypes.guess_type(str(file_path))
        payload = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.write_response_body(payload)

    def proxy_matches(self):
        payload, status, content_type = self.fetch_matches_with_fallback()

        self.send_response(status)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.write_response_body(payload)

    def fetch_matches_with_fallback(self):
        print(f"[API] Tentative source principale: 888starz")
        primary_request = Request(
            API_URL,
            headers={
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                "accept-language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
                "cache-control": "max-age=0",
                "sec-ch-ua": '"Chromium";v="139", "Not;A=Brand";v="99"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Linux"',
                "sec-fetch-dest": "document",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "cross-site",
                "sec-fetch-user": "?1",
                "upgrade-insecure-requests": "1",
                "user-agent": (
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"
                ),
            },
        )

        try:
            with open_url_with_retry(primary_request, timeout=20) as response:
                payload = response.read()
                status = response.getcode()
                content_type = response.headers.get_content_type()
                print(f"[API] Source principale 888starz OK - Status: {status}")
                return payload, status, content_type
        except HTTPError as error:
            primary_error = error
            print(f"[API] Source principale 888starz échouée (HTTPError: {error.code})")
        except (URLError, RemoteDisconnected, SocketTimeout, ssl.SSLError) as error:
            primary_error = error
            print(f"[API] Source principale 888starz échouée ({type(error).__name__})")

        print(f"[API] Tentative source secours: 1xbet")
        backup_request = Request(
            API_URL_1XBET,
            headers={
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                "accept-language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
                "cache-control": "max-age=0",
                "cookie": "platform_type=mobile; _cfuvid=Q5wh5YbhmBC1kX8SHeueoTjNwBOpr2d9sNKh0OSw6mU-1780850029.1256554-1.0.1.1-VGUQVgJAovtXZOHw4cZhoUj6EpH1pQ0yXLyjYsJgaAA; auid=wjuO02olnW60/gFPDRlvAg==; lng=fr; cookies_agree_type=3; tzo=0; is12h=0",
                "sec-ch-ua": '"Chromium";v="139", "Not;A=Brand";v="99"',
                "sec-ch-ua-mobile": "?1",
                "sec-ch-ua-platform": '"Android"',
                "sec-fetch-dest": "document",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "none",
                "sec-fetch-user": "?1",
                "upgrade-insecure-requests": "1",
                "user-agent": (
                    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"
                ),
            },
        )

        try:
            with open_url_with_retry(backup_request, timeout=20) as response:
                payload = response.read()
                status = response.getcode()
                content_type = response.headers.get_content_type()
                print(f"[API] Source secours 1xbet OK - Status: {status}")
                return payload, status, content_type
        except HTTPError as error:
            print(f"[API] Source secours 1xbet échouée (HTTPError: {error.code})")
            payload = error.read() or json.dumps({"error": f"Primary API failed: {primary_error}. Backup API failed: {error}"}).encode("utf-8")
            status = error.code
            content_type = "application/json"
            return payload, status, content_type
        except (URLError, RemoteDisconnected, SocketTimeout, ssl.SSLError) as error:
            print(f"[API] Source secours 1xbet échouée ({type(error).__name__})")
            payload = json.dumps({"error": f"Primary API failed: {describe_network_error(primary_error)}. Backup API failed: {describe_network_error(error)}"}).encode("utf-8")
            status = 502
            content_type = "application/json"
            return payload, status, content_type

    def proxy_assistant(self):
        try:
            request_body = self.read_json_body()
            messages = request_body.get("messages", [])
            page_context = request_body.get("pageContext", {})
            site_context = request_body.get("siteContext", {})
            shortcut_reply = build_assistant_shortcut_reply(messages, site_context)
            if shortcut_reply:
                self.send_json(
                    {
                        "reply": shortcut_reply,
                        "provider": "Fury X One Assistant",
                        "model": "local-routing",
                    }
                )
                return
            system_prompt = build_assistant_system_prompt(page_context, site_context)
            chat_messages = [{"role": "system", "content": system_prompt}]
            chat_messages.extend(normalize_chat_messages(messages))
            reply = call_chat_api(chat_messages)
            self.send_json(
                {
                    "reply": reply,
                    "provider": "AImodelAPI",
                    "model": CHAT_MODEL,
                }
            )
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
        except HTTPError as error:
            error_payload = error.read().decode("utf-8", errors="replace")
            self.send_json({"error": error_payload or str(error)}, error.code)
        except URLError as error:
            self.send_json({"error": str(error.reason)}, 502)

    def proxy_prediction(self):
        try:
            request_body = self.read_json_body()
            match = request_body.get("match", {})
            prediction = call_prediction_api(match)
            self.send_json(
                {
                    "provider": "top-modele-train-api",
                    "prediction": prediction,
                }
            )
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
        except HTTPError as error:
            error_payload = error.read().decode("utf-8", errors="replace")
            try:
                parsed_payload = json.loads(error_payload) if error_payload else {}
            except json.JSONDecodeError:
                parsed_payload = {"error": error_payload or str(error)}
            if isinstance(parsed_payload, dict) and parsed_payload.get("detail") and not parsed_payload.get("error"):
                parsed_payload["error"] = parsed_payload["detail"]
            self.send_json(parsed_payload or {"error": str(error)}, error.code)
        except URLError as error:
            self.send_json({"error": describe_network_error(error)}, 502)

    def read_json_body(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            return json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError(f"RequÃªte invalide: {error}") from error

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.write_response_body(body)

    def log_message(self, format, *args):
        return

    def write_response_body(self, payload):
        try:
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return


def run():
    server = HTTPServer(("0.0.0.0", PORT), FuryRequestHandler)
    print(f"Fury X One disponible sur http://0.0.0.0:{PORT}")
    server.serve_forever()


def open_url_with_retry(request, timeout=20, attempts=3, backoff=0.6):
    last_error = None
    for attempt in range(attempts):
        try:
            return urlopen(request, timeout=timeout)
        except HTTPError:
            raise
        except (URLError, RemoteDisconnected, SocketTimeout, ssl.SSLError) as error:
            last_error = error
            if attempt == attempts - 1:
                break
            time.sleep(backoff * (attempt + 1))
    raise last_error


def describe_network_error(error):
    reason = getattr(error, "reason", None)
    if reason:
        return str(reason)
    return str(error)


def call_chat_api(messages):
    payload = {
        "model": CHAT_MODEL,
        "messages": messages,
        "temperature": 0.4,
    }
    request = Request(
        CHAT_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {CHAT_API_KEY}",
        },
        method="POST",
    )
    with open_url_with_retry(request, timeout=45) as response:
        data = json.loads(response.read().decode("utf-8"))
    choices = data.get("choices") or []
    if not choices:
        raise ValueError("RÃ©ponse IA vide")
    content = choices[0].get("message", {}).get("content", "").strip()
    if not content:
        raise ValueError("RÃ©ponse IA sans contenu")
    return content


def call_prediction_api(match):
    payload = build_prediction_request(match)
    request = Request(
        PREDICTION_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    with open_url_with_retry(request, timeout=30) as response:
        data = json.loads(response.read().decode("utf-8"))
    return normalize_prediction_response(data, payload)


def build_prediction_request(match):
    team_home = str(match.get("O1E") or match.get("O1") or "").strip()
    team_away = str(match.get("O2E") or match.get("O2") or "").strip()
    league = str(match.get("LE") or match.get("L") or "").strip()

    if not team_home or not team_away or not league:
        raise ValueError("Match invalide: équipe domicile, équipe extérieure et ligue sont requis.")

    return {
        "team_home": team_home,
        "team_away": team_away,
        "league": league,
    }


def normalize_prediction_response(payload, request_payload):
    predictions = payload.get("predictions")
    if not isinstance(predictions, dict):
        return payload

    result_probabilities = normalize_result_probabilities(predictions.get("1x2"))
    result_prediction = select_best_prediction(result_probabilities)
    parity_probabilities = predictions.get("parity") or {}
    parity_prediction = select_best_prediction(
        {
            "pair": parity_probabilities.get("pair"),
            "impair": parity_probabilities.get("impair"),
        }
    )

    return {
        "match": payload.get("match") or f"{request_payload['team_home']} vs {request_payload['team_away']}",
        "league": payload.get("league") or request_payload["league"],
        "family": payload.get("family") or "-",
        "result": {
            "prediction": result_prediction,
            "probabilities": result_probabilities,
        },
        "total_goals": {
            "prediction": (predictions.get("total_goals") or {}).get("predicted"),
            "over_under": (predictions.get("total_goals") or {}).get("over_under") or {},
        },
        "parity": {
            "prediction": parity_prediction,
            "prob_pair": parity_probabilities.get("pair"),
            "prob_impair": parity_probabilities.get("impair"),
        },
        "exact_score": predictions.get("exact_score") or {"prediction": None},
        "handicap": {
            "lines": predictions.get("handicap") or {},
            "recommended": get_best_handicap_prediction(predictions.get("handicap") or {}),
        },
        "raw": payload,
    }


def normalize_result_probabilities(probabilities):
    values = probabilities or {}
    return {
        "H": values.get("home"),
        "D": values.get("draw"),
        "A": values.get("away"),
    }


def select_best_prediction(probabilities):
    best_code = None
    best_value = float("-inf")

    for code, raw_value in (probabilities or {}).items():
        if raw_value is None:
            continue
        try:
            value = float(raw_value)
        except (TypeError, ValueError):
            continue
        if value > best_value:
            best_code = code
            best_value = value

    return best_code


def get_best_handicap_prediction(handicap_lines):
    best_line = None
    best_code = None
    best_probabilities = None
    best_value = float("-inf")

    for line, probabilities in (handicap_lines or {}).items():
        normalized = normalize_result_probabilities(probabilities)
        code = select_best_prediction(normalized)
        if not code or normalized.get(code) is None:
            continue
        value = float(normalized[code])
        if value > best_value:
            best_line = line
            best_code = code
            best_probabilities = normalized
            best_value = value

    if not best_line or not best_code:
        return None

    return {
        "line": best_line,
        "prediction": best_code,
        "probabilities": best_probabilities,
    }


def normalize_chat_messages(messages):
    normalized = []
    for message in messages[-12:]:
        role = message.get("role")
        content = str(message.get("content", "")).strip()
        if role in {"user", "assistant"} and content:
            normalized.append({"role": role, "content": content})
    return normalized


def build_assistant_shortcut_reply(messages, site_context):
    if not messages:
        return None
    last_user_message = ""
    for message in reversed(messages):
        if message.get("role") == "user":
            last_user_message = str(message.get("content", "")).strip().lower()
            break
    if not last_user_message:
        return None

    triggers = [
        "trouve moi un match",
        "trouve-moi un match",
        "propose moi un match",
        "propose-moi un match",
        "cherche un match",
        "donne moi un match",
        "donne-moi un match",
    ]
    if not any(trigger in last_user_message for trigger in triggers):
        return None

    leagues = site_context.get("leagues", [])
    available_matches = []
    for league in leagues:
        for match in league.get("matches", []):
            available_matches.append(
                {
                    "league": match.get("LE") or match.get("L") or league.get("name", "Ligue inconnue"),
                    "home": match.get("O1", "Ã‰quipe 1"),
                    "away": match.get("O2", "Ã‰quipe 2"),
                    "status": match.get("TN", "Statut inconnu"),
                    "priority": get_match_priority(match),
                }
            )

    if not available_matches:
        return None

    available_matches.sort(key=lambda item: item["priority"])
    picks = available_matches[:4]
    lines = ["Voici quelques matchs disponibles en ce moment :"]
    for item in picks:
        lines.append(f"- {item['home']} vs {item['away']} Â· {item['league']} Â· {item['status']}")
    lines.append("Si tu veux, je peux aussi te proposer seulement les matchs en direct ou dans une ligue prÃ©cise.")
    return "\n".join(lines)


def get_match_priority(match):
    status = str(match.get("TN", "")).lower()
    if "direct" in status:
        return 0
    if "mi-temps" in status:
        return 1
    if match.get("GNS"):
        return 2
    return 3


def build_assistant_system_prompt(page_context, site_context):
    route = page_context.get("route", "unknown")
    current_page = page_context.get("pageTitle", "page inconnue")
    match_context = page_context.get("matchContext")
    league_context = page_context.get("leagueContext")
    parts = [
        "Tu es l'assistant global du site Fury X One.",
        "RÃ©ponds en franÃ§ais simple et court.",
        "Aide l'utilisateur Ã  comprendre les pages, les ligues, les matchs, les statuts et les marchÃ©s.",
        "N'invente jamais des informations absentes du contexte reÃ§u.",
        "Si une information manque, dis-le clairement.",
        "Quand l'utilisateur demande de trouver un match, de proposer un match, ou parle d'un match sans prÃ©cision, utilise d'abord les matchs dÃ©jÃ  prÃ©sents dans le contexte du site.",
        "Dans ce cas, propose directement 3 Ã  5 matchs disponibles avec leur ligue et leur statut au lieu de redemander une prÃ©cision.",
        "Ne demande une prÃ©cision que si aucun match exploitable n'est prÃ©sent dans le contexte.",
        "Si plusieurs matchs existent, privilÃ©gie ceux en direct ou Ã  la mi-temps.",
        f"Route actuelle: {route}.",
        f"Page actuelle: {current_page}.",
        f"Nombre total de ligues chargÃ©es: {page_context.get('leaguesCount', 0)}.",
        f"Nombre total de matchs chargÃ©s: {page_context.get('matchesCount', 0)}.",
    ]
    if match_context:
        parts.append(f"Contexte match actuel: {json.dumps(match_context, ensure_ascii=False)}.")
    if league_context:
        parts.append(f"Contexte ligue actuelle: {json.dumps(league_context, ensure_ascii=False)}.")
    if site_context:
        parts.append(f"Contexte global du site: {json.dumps(site_context, ensure_ascii=False)}.")
    return " ".join(parts)


def infer_game_mode(league_name):
    value = (league_name or "").lower()
    if "penalty" in value:
        return "penalty"
    if "3x3" in value:
        return "3x3"
    if "4x4" in value:
        return "4x4"
    if "5x5" in value:
        return "5x5"
    if "rush" in value:
        return "rush"
    return "rush"


def infer_game_version(league_name):
    value = league_name or ""
    if "FC 26" in value or "FC26" in value:
        return "FC26"
    if "FC 25" in value or "FC25" in value:
        return "FC25"
    if "FC 24" in value or "FC24" in value:
        return "FC24"
    if "FIFA23" in value:
        return "FIFA23"
    return "FC26"


def get_score(match, side):
    try:
        return int(match.get("SC", {}).get("FS", {}).get(side, 0) or 0)
    except (TypeError, ValueError):
        return 0


def has_live_score(match):
    fs = match.get("SC", {}).get("FS", {})
    return "S1" in fs and "S2" in fs


if __name__ == "__main__":
    run()
