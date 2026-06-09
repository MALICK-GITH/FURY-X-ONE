import argparse
import json
import re
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, mean_squared_error
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder


NUMERIC_CANDIDATES = [
    "home_odds",
    "draw_odds",
    "away_odds",
    "home_form_rate",
    "away_form_rate",
    "home_attack_avg",
    "away_attack_avg",
    "home_defense_avg",
    "away_defense_avg",
    "head_to_head_matches",
    "head_to_head_home_winrate",
    "minute",
    "elapsed_seconds",
    "markets_count",
    "ec",
    "current_home_goals",
    "current_away_goals",
]

CATEGORICAL_CANDIDATES = [
    "team_home",
    "team_away",
    "league",
    "source",
    "game_mode",
    "game_version",
    "country",
]


def parse_args():
    parser = argparse.ArgumentParser(description="Entraînement RandomForest pour Fury X One.")
    parser.add_argument("--csv", required=True, help="Chemin vers le CSV d'entraînement.")
    parser.add_argument("--outdir", default="models/random_forest", help="Dossier de sortie des modèles.")
    parser.add_argument("--test-size", type=float, default=0.2, help="Part du dataset réservée au test.")
    parser.add_argument("--random-state", type=int, default=42, help="Graine aléatoire.")
    return parser.parse_args()


def normalize_columns(dataframe: pd.DataFrame) -> pd.DataFrame:
    aliases = {
        "home_team": "team_home",
        "away_team": "team_away",
        "o1": "team_home",
        "o2": "team_away",
        "le": "league",
        "l": "league",
        "cn": "country",
        "ec": "markets_count",
        "s1": "score_home",
        "s2": "score_away",
    }

    renamed = {}
    for column in dataframe.columns:
        normalized = aliases.get(column.lower(), column.lower())
        renamed[column] = normalized
    return dataframe.rename(columns=renamed)


def infer_game_version(league_name: str) -> str:
    value = str(league_name or "")
    if "FC 26" in value or "FC26" in value:
        return "FC26"
    if "FC 25" in value or "FC25" in value:
        return "FC25"
    if "FC 24" in value or "FC24" in value:
        return "FC24"
    if "FIFA23" in value:
        return "FIFA23"
    return "unknown"


def infer_game_mode(league_name: str) -> str:
    value = str(league_name or "").lower()
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
    if "champions" in value:
        return "champions"
    if "world" in value or "monde" in value:
        return "world"
    return "classic"


def add_engineered_features(dataframe: pd.DataFrame) -> pd.DataFrame:
    dataframe = dataframe.copy()

    if "league" in dataframe.columns:
        dataframe["game_version"] = dataframe.get("game_version", dataframe["league"].map(infer_game_version))
        dataframe["game_mode"] = dataframe.get("game_mode", dataframe["league"].map(infer_game_mode))
        dataframe["league_group"] = dataframe["league"].astype(str).str.replace(r"\s+", " ", regex=True).str.strip()

    for date_column in ("match_datetime", "finished_at", "created_at"):
        if date_column in dataframe.columns:
            parsed = pd.to_datetime(dataframe[date_column], errors="coerce", utc=True)
            dataframe[f"{date_column}_hour"] = parsed.dt.hour
            dataframe[f"{date_column}_weekday"] = parsed.dt.weekday

    if "team_home" in dataframe.columns and "team_away" in dataframe.columns:
        dataframe["fixture"] = dataframe["team_home"].astype(str) + " vs " + dataframe["team_away"].astype(str)

    return dataframe


def add_targets(dataframe: pd.DataFrame) -> pd.DataFrame:
    dataframe = dataframe.copy()
    dataframe["score_home"] = pd.to_numeric(dataframe["score_home"], errors="coerce")
    dataframe["score_away"] = pd.to_numeric(dataframe["score_away"], errors="coerce")
    dataframe = dataframe.dropna(subset=["score_home", "score_away"]).copy()
    dataframe["score_home"] = dataframe["score_home"].astype(int)
    dataframe["score_away"] = dataframe["score_away"].astype(int)
    dataframe["total_goals"] = dataframe["score_home"] + dataframe["score_away"]
    dataframe["result_1x2"] = np.select(
        [
            dataframe["score_home"] > dataframe["score_away"],
            dataframe["score_home"] < dataframe["score_away"],
        ],
        ["1", "2"],
        default="N",
    )
    dataframe["over_under_2_5"] = np.where(dataframe["total_goals"] > 2.5, "Over", "Under")
    dataframe["btts"] = np.where(
        (dataframe["score_home"] > 0) & (dataframe["score_away"] > 0),
        "Yes",
        "No",
    )
    dataframe["exact_score"] = (
        dataframe["score_home"].astype(str) + "-" + dataframe["score_away"].astype(str)
    )
    return dataframe


def choose_feature_columns(dataframe: pd.DataFrame):
    numeric_columns = [column for column in NUMERIC_CANDIDATES if column in dataframe.columns]
    categorical_columns = [
        column for column in CATEGORICAL_CANDIDATES if column in dataframe.columns
    ]
    extra_numeric = [
        column
        for column in dataframe.columns
        if column.endswith("_hour") or column.endswith("_weekday")
    ]
    extra_categorical = [column for column in ("league_group", "fixture") if column in dataframe.columns]
    numeric_columns.extend([column for column in extra_numeric if column not in numeric_columns])
    categorical_columns.extend([column for column in extra_categorical if column not in categorical_columns])
    return numeric_columns, categorical_columns


def build_preprocessor(numeric_columns, categorical_columns):
    transformers = []
    if numeric_columns:
        transformers.append(
            (
                "num",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="median")),
                    ]
                ),
                numeric_columns,
            )
        )
    if categorical_columns:
        transformers.append(
            (
                "cat",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        ("onehot", OneHotEncoder(handle_unknown="ignore")),
                    ]
                ),
                categorical_columns,
            )
        )
    return ColumnTransformer(transformers=transformers, remainder="drop")


def build_classifier(preprocessor):
    return Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            (
                "model",
                RandomForestClassifier(
                    n_estimators=600,
                    max_depth=24,
                    min_samples_split=6,
                    min_samples_leaf=2,
                    class_weight="balanced_subsample",
                    random_state=42,
                    n_jobs=-1,
                ),
            ),
        ]
    )


def build_regressor(preprocessor):
    return Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            (
                "model",
                RandomForestRegressor(
                    n_estimators=500,
                    max_depth=22,
                    min_samples_split=6,
                    min_samples_leaf=2,
                    random_state=42,
                    n_jobs=-1,
                ),
            ),
        ]
    )


def evaluate_classifier(model, features_test, target_test):
    predictions = model.predict(features_test)
    return {
        "accuracy": round(float(accuracy_score(target_test, predictions)), 5),
        "f1_weighted": round(float(f1_score(target_test, predictions, average="weighted")), 5),
    }


def evaluate_regressor(model, features_test, target_test):
    predictions = model.predict(features_test)
    mse = mean_squared_error(target_test, predictions)
    return {
        "mae": round(float(mean_absolute_error(target_test, predictions)), 5),
        "rmse": round(float(np.sqrt(mse)), 5),
    }


def train_models(dataframe: pd.DataFrame, outdir: Path, test_size: float, random_state: int):
    numeric_columns, categorical_columns = choose_feature_columns(dataframe)
    feature_columns = numeric_columns + categorical_columns
    if not feature_columns:
        raise ValueError("Aucune feature exploitable trouvée dans le CSV.")

    features = dataframe[feature_columns].copy()
    split_indices = np.arange(len(dataframe))
    train_indices, test_indices = train_test_split(
        split_indices,
        test_size=test_size,
        random_state=random_state,
        stratify=dataframe["result_1x2"],
    )

    features_train = features.iloc[train_indices]
    features_test = features.iloc[test_indices]

    report = {
        "rows": int(len(dataframe)),
        "feature_columns": feature_columns,
        "numeric_features": numeric_columns,
        "categorical_features": categorical_columns,
        "targets": {},
    }

    classifier_targets = {
        "result_1x2": dataframe["result_1x2"],
        "over_under_2_5": dataframe["over_under_2_5"],
        "btts": dataframe["btts"],
    }
    regressor_targets = {
        "score_home": dataframe["score_home"],
        "score_away": dataframe["score_away"],
        "total_goals": dataframe["total_goals"],
    }

    outdir.mkdir(parents=True, exist_ok=True)

    for target_name, target_values in classifier_targets.items():
        target_train = target_values.iloc[train_indices]
        target_test = target_values.iloc[test_indices]
        pipeline = build_classifier(build_preprocessor(numeric_columns, categorical_columns))
        pipeline.fit(features_train, target_train)
        metrics = evaluate_classifier(pipeline, features_test, target_test)
        joblib.dump(pipeline, outdir / f"{target_name}_rf.joblib")
        report["targets"][target_name] = {
            "type": "classifier",
            "metrics": metrics,
            "classes": sorted(target_values.astype(str).unique().tolist()),
        }

    for target_name, target_values in regressor_targets.items():
        target_train = target_values.iloc[train_indices]
        target_test = target_values.iloc[test_indices]
        pipeline = build_regressor(build_preprocessor(numeric_columns, categorical_columns))
        pipeline.fit(features_train, target_train)
        metrics = evaluate_regressor(pipeline, features_test, target_test)
        joblib.dump(pipeline, outdir / f"{target_name}_rf.joblib")
        report["targets"][target_name] = {
            "type": "regressor",
            "metrics": metrics,
        }

    metadata = {
        "rows": int(len(dataframe)),
        "train_rows": int(len(train_indices)),
        "test_rows": int(len(test_indices)),
        "feature_columns": feature_columns,
        "numeric_features": numeric_columns,
        "categorical_features": categorical_columns,
        "target_columns": list(report["targets"].keys()),
        "recommended_primary_prediction": "result_1x2",
        "recommended_secondary_predictions": ["over_under_2_5", "btts", "score_home", "score_away"],
    }

    (outdir / "training_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (outdir / "model_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return report


def print_dataset_summary(dataframe: pd.DataFrame):
    result_counts = dataframe["result_1x2"].value_counts().to_dict()
    league_counts = dataframe["league"].value_counts().head(10).to_dict() if "league" in dataframe.columns else {}
    print("=== Dataset summary ===")
    print(f"Lignes: {len(dataframe)}")
    print(f"Ligues uniques: {dataframe['league'].nunique() if 'league' in dataframe.columns else 0}")
    print(f"Distribution 1X2: {result_counts}")
    print(f"Top ligues: {league_counts}")


def main():
    args = parse_args()
    csv_path = Path(args.csv)
    outdir = Path(args.outdir)

    dataframe = pd.read_csv(csv_path)
    dataframe = normalize_columns(dataframe)
    dataframe = add_engineered_features(dataframe)

    required = {"team_home", "team_away", "league", "score_home", "score_away"}
    missing = [column for column in required if column not in dataframe.columns]
    if missing:
        raise ValueError(f"Colonnes obligatoires manquantes: {missing}")

    dataframe = add_targets(dataframe)
    print_dataset_summary(dataframe)
    report = train_models(dataframe, outdir, args.test_size, args.random_state)

    print("\n=== Résultats ===")
    for target_name, info in report["targets"].items():
        print(f"{target_name}: {info['metrics']}")
    print(f"\nModèles enregistrés dans: {outdir.resolve()}")


if __name__ == "__main__":
    main()
