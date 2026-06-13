import json

# Lire les données de matchs
with open("test-matches.json", "r", encoding="utf-8") as f:
    data = json.load(f)

matches = data.get("Value", [])

# Extraire les ligues uniques
leagues = {}
for match in matches[:10]:  # Premier 10 matchs
    league = match.get("LE") or match.get("L") or "Unknown"
    if league not in leagues:
        leagues[league] = {
            "name": league,
            "teams": [],
            "sample_match": None
        }
    leagues[league]["teams"].append(f"{match.get('O1')} vs {match.get('O2')}")
    if leagues[league]["sample_match"] is None:
        leagues[league]["sample_match"] = match

print("=== LIGUES DISPONIBLES ===")
for league_name, league_data in leagues.items():
    print(f"\nLigue: {league_name}")
    print(f"Exemples de matchs: {', '.join(league_data['teams'][:3])}")
    
    # Tester avec cette ligue
    sample = league_data["sample_match"]
    print(f"Test avec: {sample.get('O1')} vs {sample.get('O2')}")

print("\n=== MATCH COMPLET POUR TEST ===")
if matches:
    first_match = matches[0]
    print(json.dumps({
        "O1": first_match.get("O1"),
        "O2": first_match.get("O2"),
        "LE": first_match.get("LE"),
        "L": first_match.get("L"),
        "I": first_match.get("I")
    }, indent=2, ensure_ascii=False))
