import json
import urllib.request
import urllib.error

def test_prediction_api():
    # Test avec un match réel depuis les données récupérées (ligue FC 26)
    test_match = {
        "I": 728882170,
        "O1": "Liverpool",
        "O2": "Bayern Munich",
        "LE": "FC 26. 5x5 Rush. Superleague",
        "L": "FC 26. 5x5 Rush. Superleague",
        "S": 1781350200
    }
    
    print("=== TEST 1: Match valide ===")
    print(f"Match: {test_match['O1']} vs {test_match['O2']}")
    print(f"Ligue: {test_match['LE']}")
    
    try:
        payload = json.dumps({"match": test_match}).encode("utf-8")
        request = urllib.request.Request(
            "http://localhost:3000/api/prediction",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
            print(f"Status: {response.getcode()}")
            print(f"Provider: {data.get('provider')}")
            print(f"Prediction structure: {json.dumps(data.get('prediction'), indent=2)}")
            
    except urllib.error.HTTPError as e:
        print(f"HTTP Error: {e.code} - {e.read().decode('utf-8')}")
    except urllib.error.URLError as e:
        print(f"URL Error: {e.reason}")
    except Exception as e:
        print(f"Error: {e}")
    
    print("\n=== TEST 2: Match invalide (champs manquants) ===")
    invalid_match = {
        "O1": "Team A",
        # O2 manquant
        "LE": "Test League"
    }
    
    try:
        payload = json.dumps({"match": invalid_match}).encode("utf-8")
        request = urllib.request.Request(
            "http://localhost:3000/api/prediction",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
            print(f"Status: {response.getcode()}")
            print(f"Response: {data}")
            
    except urllib.error.HTTPError as e:
        print(f"HTTP Error (attendu): {e.code} - {e.read().decode('utf-8')}")
    except Exception as e:
        print(f"Error: {e}")
    
    print("\n=== TEST 3: Match avec champs vides ===")
    empty_match = {
        "O1": "",
        "O2": "",
        "LE": ""
    }
    
    try:
        payload = json.dumps({"match": empty_match}).encode("utf-8")
        request = urllib.request.Request(
            "http://localhost:3000/api/prediction",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
            print(f"Status: {response.getcode()}")
            print(f"Response: {data}")
            
    except urllib.error.HTTPError as e:
        print(f"HTTP Error (attendu): {e.code} - {e.read().decode('utf-8')}")
    except Exception as e:
        print(f"Error: {e}")
    
    # Tests avec différentes ligues pour trouver celles reconnues par le modèle
    print("\n=== TEST 4: Différentes ligues ===")
    leagues_to_test = [
        "FC 24. 4x4. England Championship",
        "FC 25. 3x3. Conference League",
        "Premier League",
        "La Liga",
        "Serie A",
        "Bundesliga",
        "Ligue 1"
    ]
    
    for league in leagues_to_test:
        print(f"\nTest ligue: {league}")
        test_match = {
            "O1": "Team A",
            "O2": "Team B",
            "LE": league,
            "L": league
        }
        
        try:
            payload = json.dumps({"match": test_match}).encode("utf-8")
            request = urllib.request.Request(
                "http://localhost:3000/api/prediction",
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                method="POST",
            )
            
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.loads(response.read().decode("utf-8"))
                print(f"[OK] SUCCES - Status: {response.getcode()}")
                print(f"Provider: {data.get('provider')}")
                if data.get('prediction'):
                    print(f"Prediction: {json.dumps(data.get('prediction'), indent=2)}")
                break  # Arrêter au premier succès
                
        except urllib.error.HTTPError as e:
            error_msg = e.read().decode('utf-8')
            if "previously unseen labels" in error_msg:
                print("[ERREUR] Ligue inconnue par le modele")
            else:
                print(f"[ERREUR] {e.code} - {error_msg}")
        except Exception as e:
            print(f"[ERREUR] {e}")

if __name__ == "__main__":
    test_prediction_api()
