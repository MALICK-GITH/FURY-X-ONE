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
from datetime import datetime, timezone


PORT = 3000
BASE_DIR = Path(__file__).resolve().parent
API_URL = (
    "https://888starz.bet/service-api/LiveFeed/Get1x2_VZip"
    "?sports=85&count=80&lng=fr&gr=789&mode=4&country=96"
    "&partner=233&getEmpty=true&virtualSports=true&noFilterBlockEvent=true"
)
PREDICTION_API_URL = "https://ai-p-hcuo.onrender.com/api/predict"
CHAT_API_KEY = os.environ.get("FURY_CHAT_API_KEY", "devx-s3lkpld19bvhbsv2ex5omi1b2vjet5a5")
CHAT_API_URL = "https://aimodelapi.onrender.com/v1/chat/completions"
CHAT_MODEL = "deepseek-r1"


class FuryRequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/matches":
            self.proxy_matches()
            return

        relative_path = "index.html" if self.path in ("/", "") else self.path.lstrip("/")
        file_path = (BASE_DIR / relative_path).resolve()

        if BASE_DIR not in file_path.parents and file_path != BASE_DIR / "index.html":
            self.send_error(403, "Accès refusé")
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
        request = Request(
            API_URL,
            headers={
                "accept": "application/json,text/plain,*/*",
                "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
                "user-agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/139.0.0.0 Safari/537.36"
                ),
            },
        )

        try:
            with open_url_with_retry(request, timeout=20) as response:
                payload = response.read()
                status = response.getcode()
                content_type = response.headers.get_content_type()
        except HTTPError as error:
            payload = error.read() or json.dumps({"error": str(error)}).encode("utf-8")
            status = error.code
            content_type = "application/json"
        except (URLError, RemoteDisconnected, SocketTimeout, ssl.SSLError) as error:
            payload = json.dumps({"error": describe_network_error(error)}).encode("utf-8")
            status = 502
            content_type = "application/json"

        self.send_response(status)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.write_response_body(payload)

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
            payload = build_prediction_payload(match)
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
            return

        request = Request(
            PREDICTION_API_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0",
            },
            method="POST",
        )

        try:
            with open_url_with_retry(request, timeout=30) as response:
                prediction_payload = json.loads(response.read().decode("utf-8"))
                self.send_json(
                    {
                        "provider": prediction_payload.get("source", "ONE DELUX AI"),
                        "input": payload,
                        "prediction": prediction_payload,
                    },
                    response.getcode(),
                )
        except HTTPError as error:
            error_payload = error.read().decode("utf-8", errors="replace")
            self.send_json({"error": error_payload or str(error)}, error.code)
        except (URLError, RemoteDisconnected, SocketTimeout, ssl.SSLError) as error:
            self.send_json({"error": describe_network_error(error)}, 502)

    def read_json_body(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            return json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError(f"Requête invalide: {error}") from error

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
    server = HTTPServer(("127.0.0.1", PORT), FuryRequestHandler)
    print(f"Fury X One disponible sur http://localhost:{PORT}")
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
        raise ValueError("Réponse IA vide")
    content = choices[0].get("message", {}).get("content", "").strip()
    if not content:
        raise ValueError("Réponse IA sans contenu")
    return content


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
                    "home": match.get("O1", "Équipe 1"),
                    "away": match.get("O2", "Équipe 2"),
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
        lines.append(f"- {item['home']} vs {item['away']} · {item['league']} · {item['status']}")
    lines.append("Si tu veux, je peux aussi te proposer seulement les matchs en direct ou dans une ligue précise.")
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
        "Réponds en français simple et court.",
        "Aide l'utilisateur à comprendre les pages, les ligues, les matchs, les statuts et les marchés.",
        "N'invente jamais des informations absentes du contexte reçu.",
        "Si une information manque, dis-le clairement.",
        "Quand l'utilisateur demande de trouver un match, de proposer un match, ou parle d'un match sans précision, utilise d'abord les matchs déjà présents dans le contexte du site.",
        "Dans ce cas, propose directement 3 à 5 matchs disponibles avec leur ligue et leur statut au lieu de redemander une précision.",
        "Ne demande une précision que si aucun match exploitable n'est présent dans le contexte.",
        "Si plusieurs matchs existent, privilégie ceux en direct ou à la mi-temps.",
        f"Route actuelle: {route}.",
        f"Page actuelle: {current_page}.",
        f"Nombre total de ligues chargées: {page_context.get('leaguesCount', 0)}.",
        f"Nombre total de matchs chargés: {page_context.get('matchesCount', 0)}.",
    ]
    if match_context:
        parts.append(f"Contexte match actuel: {json.dumps(match_context, ensure_ascii=False)}.")
    if league_context:
        parts.append(f"Contexte ligue actuelle: {json.dumps(league_context, ensure_ascii=False)}.")
    if site_context:
        parts.append(f"Contexte global du site: {json.dumps(site_context, ensure_ascii=False)}.")
    return " ".join(parts)


def build_prediction_payload(match):
    home_odds = get_market_odds(match, 1, 2.0)
    draw_odds = get_market_odds(match, 3, 3.0)
    away_odds = get_market_odds(match, 2, 2.0)
    current_home = get_score(match, "S1") if has_live_score(match) else 0
    current_away = get_score(match, "S2") if has_live_score(match) else 0
    total_goals = current_home + current_away
    league_name = match.get("LE") or match.get("L") or "Unknown League"

    return {
        "league": league_name,
        "home_team": match.get("O1") or "Home",
        "away_team": match.get("O2") or "Away",
        "home_odds": home_odds,
        "draw_odds": draw_odds,
        "away_odds": away_odds,
        "match_datetime": format_match_datetime(match.get("S")),
        "home_form_rate": derive_form_rate(current_home, current_away, home=True),
        "away_form_rate": derive_form_rate(current_home, current_away, home=False),
        "home_attack_avg": derive_attack_avg(current_home),
        "away_attack_avg": derive_attack_avg(current_away),
        "home_defense_avg": derive_defense_avg(current_away),
        "away_defense_avg": derive_defense_avg(current_home),
        "head_to_head_matches": 0,
        "head_to_head_home_winrate": 0.5,
        "game_mode": infer_game_mode(league_name),
        "game_version": infer_game_version(league_name),
    }


def format_match_datetime(timestamp):
    if not timestamp:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def derive_form_rate(home_score, away_score, home=True):
    total = home_score + away_score
    if total == 0:
        return 0.5
    value = (home_score if home else away_score) / total
    return round(min(max(value, 0.15), 0.85), 3)


def derive_attack_avg(goals):
    return round(min(max(1.5 + goals * 0.35, 1.5), 8.0), 3)


def derive_defense_avg(goals_conceded):
    return round(min(max(1.2 + goals_conceded * 0.25, 1.2), 8.0), 3)


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


def get_market_odds(match, bet_type, fallback):
    for market in match.get("E", []):
        if market.get("T") == bet_type:
            try:
                return float(market.get("C", fallback))
            except (TypeError, ValueError):
                return fallback
    return fallback


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
