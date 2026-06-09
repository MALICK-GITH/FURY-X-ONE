# Entraînement RandomForest — Fury X One

## Commande

```powershell
python train_random_forest.py --csv "F:\csv train fifa\finished_matches_dataset_20260606_171133.csv" --outdir "F:\FURY X ONE\models\random_forest"
```

## Ce que le script entraîne

- `result_1x2_rf.joblib`
- `over_under_2_5_rf.joblib`
- `btts_rf.joblib`
- `score_home_rf.joblib`
- `score_away_rf.joblib`
- `total_goals_rf.joblib`

## Fichiers générés

- `model_metadata.json`
- `training_report.json`

## Colonnes minimales requises

- `team_home`
- `team_away`
- `league`
- `score_home`
- `score_away`

## Colonnes supplémentaires recommandées pour la future base enrichie

- `home_odds`
- `draw_odds`
- `away_odds`
- `game_mode`
- `game_version`
- `home_form_rate`
- `away_form_rate`
- `home_attack_avg`
- `away_attack_avg`
- `home_defense_avg`
- `away_defense_avg`
- `head_to_head_matches`
- `head_to_head_home_winrate`
- `minute`
- `elapsed_seconds`
- `markets_count`
- `current_home_goals`
- `current_away_goals`

## Recommandation produit

- prédiction principale du site : `result_1x2`
- prédiction secondaire : `over_under_2_5`
- score exact : à afficher comme projection secondaire, pas comme bloc principal
