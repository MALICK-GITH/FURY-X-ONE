"""
train_csv.py — Pipeline d'entraînement multi-familles / multi-tâches
=====================================================================
Familles :
  - PENALTY      : Penalty, FC24. Penalty, FC25. Penalty, FC26. Penalty, FIFA23. Penalty
  - RUSH         : FC 26. 5x5 Rush. Superligue
  - HIGHSCORE    : FC 24. 4x4. Champ. d'Angleterre, FC 25. 3x3. Ligue de conférence
  - CLASSIC      : Tous les championnats classiques + World Cup simulation

Tâches par modèle :
  1. Résultat       → classification 3 classes (dom / nul / ext)  [PENALTY : 2 classes seulement]
  2. Total buts     → régression
  3. Pair / Impair  → classification binaire
  4. Score exact    → Modèle de Poisson (lambda dom + lambda ext)
  5. Nb buts        → identique au total buts (alias)

Usage :
  python train_csv.py --csv finished_matches.csv --out ./models
  python train_csv.py --csv finished_matches.csv --out ./models --eval
"""

import argparse
import os
import json
import warnings
import joblib
import numpy as np
import pandas as pd
from scipy.stats import poisson
from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor, RandomForestClassifier
from sklearn.linear_model import LogisticRegression, Ridge, PoissonRegressor
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import (accuracy_score, mean_absolute_error,
                              classification_report, log_loss)
from sklearn.pipeline import Pipeline
warnings.filterwarnings("ignore")

# ──────────────────────────────────────────────────────────────────────────────
# 1. CONFIGURATION DES FAMILLES
# ──────────────────────────────────────────────────────────────────────────────

FAMILIES = {
    "PENALTY": {
        "pattern": r"Penalty|penalty",
        "has_draw": False,          # jamais de nul en Penalty
        "typical_goals": (3, 15),   # fourchette normale
        "description": "Séances de tirs au but — 2 issues possibles, scores élevés",
    },
    "HIGHSCORE": {
        "pattern": r"3x3|4x4",
        "has_draw": True,
        "typical_goals": (8, 22),
        "description": "Formats 3x3 / 4x4 — scores très élevés (~15 buts/match)",
    },
    "RUSH": {
        "pattern": r"Rush",
        "has_draw": True,
        "typical_goals": (3, 14),
        "description": "FC 26. 5x5 Rush — profil intermédiaire, grande variance",
    },
    "CLASSIC": {
        "pattern": None,            # tout le reste
        "has_draw": True,
        "typical_goals": (0, 8),
        "description": "Championnats classiques simulés — proche du football réel",
    },
}

# ──────────────────────────────────────────────────────────────────────────────
# 2. CHARGEMENT ET PRÉPARATION DES DONNÉES
# ──────────────────────────────────────────────────────────────────────────────

def load_data(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path)
    df["finished_at"] = pd.to_datetime(df["finished_at"], format="ISO8601", utc=True)
    df = df.sort_values("finished_at").reset_index(drop=True)

    # Cibles brutes
    df["total_goals"] = df["score_home"] + df["score_away"]
    df["goals_parity"] = (df["total_goals"] % 2 == 0).astype(int)  # 1=pair, 0=impair
    df["result"] = df.apply(
        lambda r: "H" if r.score_home > r.score_away
        else ("A" if r.score_away > r.score_home else "D"),
        axis=1,
    )
    return df


def assign_family(df: pd.DataFrame) -> pd.DataFrame:
    df["family"] = "CLASSIC"
    for fam, cfg in FAMILIES.items():
        if cfg["pattern"] is not None:
            mask = df["league"].str.contains(cfg["pattern"], regex=True, na=False)
            df.loc[mask, "family"] = fam
    return df


# ──────────────────────────────────────────────────────────────────────────────
# 3. FEATURE ENGINEERING — historique glissant par équipe
# ──────────────────────────────────────────────────────────────────────────────

WINDOWS = [5, 10]  # fenêtres glissantes


def compute_team_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Pour chaque match, calcule les stats historiques des deux équipes
    AVANT ce match (pas de data leakage).
    """
    records = []

    # Index groupé par équipe pour accès rapide
    all_teams = pd.concat([
        df[["finished_at", "team_home", "score_home", "score_away", "result", "family", "league"]].rename(
            columns={"team_home": "team", "score_home": "goals_for", "score_away": "goals_against"}
        ).assign(is_home=1),
        df[["finished_at", "team_away", "score_away", "score_home", "result", "family", "league"]].rename(
            columns={"team_away": "team", "score_away": "goals_for", "score_home": "goals_against"}
        ).assign(is_home=0),
    ], ignore_index=True).sort_values("finished_at")

    # Résultat du point de vue de l'équipe
    all_teams["win"] = all_teams.apply(
        lambda r: 1 if (r.is_home == 1 and r.result == "H") or
                        (r.is_home == 0 and r.result == "A") else 0, axis=1
    )
    all_teams["draw"] = (all_teams["result"] == "D").astype(int)
    all_teams["loss"] = ((all_teams["win"] == 0) & (all_teams["draw"] == 0)).astype(int)

    team_history: dict[str, pd.DataFrame] = {}
    for team, grp in all_teams.groupby("team"):
        team_history[team] = grp.sort_values("finished_at").reset_index(drop=True)

    def get_stats(team: str, before_dt, window: int) -> dict:
        hist = team_history.get(team, pd.DataFrame())
        if hist.empty:
            return _empty_stats(window)
        past = hist[hist["finished_at"] < before_dt].tail(window)
        if len(past) == 0:
            return _empty_stats(window)
        n = len(past)
        return {
            f"w{window}_played":    n,
            f"w{window}_wins":      past["win"].sum(),
            f"w{window}_draws":     past["draw"].sum(),
            f"w{window}_losses":    past["loss"].sum(),
            f"w{window}_gf":        past["goals_for"].mean(),
            f"w{window}_ga":        past["goals_against"].mean(),
            f"w{window}_gd":        (past["goals_for"] - past["goals_against"]).mean(),
            f"w{window}_win_rate":  past["win"].mean(),
            f"w{window}_draw_rate": past["draw"].mean(),
        }

    def _empty_stats(window: int) -> dict:
        keys = ["played", "wins", "draws", "losses", "gf", "ga", "gd", "win_rate", "draw_rate"]
        return {f"w{window}_{k}": 0.0 for k in keys}

    print("  → Calcul des features historiques (peut prendre quelques secondes)...")

    for _, row in df.iterrows():
        feat = {"id": row["id"]}
        for w in WINDOWS:
            h_stats = get_stats(row["team_home"], row["finished_at"], w)
            a_stats = get_stats(row["team_away"], row["finished_at"], w)
            for k, v in h_stats.items():
                feat[f"home_{k}"] = v
            for k, v in a_stats.items():
                feat[f"away_{k}"] = v
            # Features différentielles
            feat[f"diff_w{w}_win_rate"]  = h_stats[f"w{w}_win_rate"]  - a_stats[f"w{w}_win_rate"]
            feat[f"diff_w{w}_gf"]        = h_stats[f"w{w}_gf"]        - a_stats[f"w{w}_gf"]
            feat[f"diff_w{w}_ga"]        = h_stats[f"w{w}_ga"]        - a_stats[f"w{w}_ga"]
            feat[f"diff_w{w}_gd"]        = h_stats[f"w{w}_gd"]        - a_stats[f"w{w}_gd"]
        records.append(feat)

    feat_df = pd.DataFrame(records).set_index("id")
    return feat_df


def build_features(df: pd.DataFrame, feat_df: pd.DataFrame) -> pd.DataFrame:
    """Assemble toutes les features : historiques + encodages."""
    full = df.set_index("id").join(feat_df)

    # Encodage équipes (fréquence d'apparition → proxy de "niveau")
    home_freq = df["team_home"].value_counts(normalize=True)
    away_freq = df["team_away"].value_counts(normalize=True)
    full["home_team_freq"] = full["team_home"].map(home_freq).fillna(0)
    full["away_team_freq"] = full["team_away"].map(away_freq).fillna(0)

    # Encodage ligue (label encoding)
    le_league = LabelEncoder()
    full["league_enc"] = le_league.fit_transform(full["league"])

    return full.reset_index(), le_league


def get_feature_cols(df: pd.DataFrame) -> list:
    exclude = {
        "id", "match_id", "team_home", "team_away", "league", "family",
        "finished_at", "created_at", "updated_at", "source",
        "score_home", "score_away", "total_goals", "goals_parity", "result",
    }
    return [c for c in df.columns if c not in exclude]


# ──────────────────────────────────────────────────────────────────────────────
# 4. MODÈLE DE POISSON — score exact
# ──────────────────────────────────────────────────────────────────────────────

class PoissonScoreModel:
    """
    Modèle de Poisson indépendant pour chaque équipe.
    Prédit lambda_home et lambda_away puis calcule P(score_home=i, score_away=j).
    """

    def __init__(self):
        self.model_home = PoissonRegressor(max_iter=500)
        self.model_away = PoissonRegressor(max_iter=500)
        self.scaler = StandardScaler()
        self.feature_cols = None

    def fit(self, X: np.ndarray, y_home: np.ndarray, y_away: np.ndarray, feature_cols: list):
        self.feature_cols = feature_cols
        Xs = self.scaler.fit_transform(X)
        self.model_home.fit(Xs, y_home)
        self.model_away.fit(Xs, y_away)
        return self

    def predict_lambdas(self, X: np.ndarray):
        Xs = self.scaler.transform(X)
        lh = np.clip(self.model_home.predict(Xs), 0.1, 30)
        la = np.clip(self.model_away.predict(Xs), 0.1, 30)
        return lh, la

    def predict_exact_score(self, X: np.ndarray, max_goals: int = 10):
        lh, la = self.predict_lambdas(X)
        results = []
        for lh_i, la_i in zip(lh, la):
            best_prob = 0
            best_score = (0, 0)
            for i in range(max_goals + 1):
                for j in range(max_goals + 1):
                    p = poisson.pmf(i, lh_i) * poisson.pmf(j, la_i)
                    if p > best_prob:
                        best_prob = p
                        best_score = (i, j)
            results.append(best_score)
        return results

    def predict_total_goals(self, X: np.ndarray):
        lh, la = self.predict_lambdas(X)
        return lh + la

    def predict_result_proba(self, X: np.ndarray, has_draw: bool = True, max_goals: int = 15):
        """Calcule P(H), P(D), P(A) en intégrant la distribution de Poisson."""
        lh, la = self.predict_lambdas(X)
        probas = []
        for lh_i, la_i in zip(lh, la):
            ph = pd_ = pa = 0.0
            for i in range(max_goals + 1):
                for j in range(max_goals + 1):
                    p = poisson.pmf(i, lh_i) * poisson.pmf(j, la_i)
                    if i > j:
                        ph += p
                    elif i == j:
                        pd_ += p
                    else:
                        pa += p
            if not has_draw:
                total = ph + pa
                probas.append([ph / total, 0.0, pa / total])
            else:
                probas.append([ph, pd_, pa])
        return np.array(probas)


# ──────────────────────────────────────────────────────────────────────────────
# 5. ENTRAÎNEMENT PAR FAMILLE
# ──────────────────────────────────────────────────────────────────────────────

def train_family(family: str, df_fam: pd.DataFrame, cfg: dict, out_dir: str, evaluate: bool):
    print(f"\n{'='*60}")
    print(f"  FAMILLE : {family} — {len(df_fam)} matchs")
    print(f"  {cfg['description']}")
    print(f"{'='*60}")

    has_draw = cfg["has_draw"]
    n = len(df_fam)

    if n < 50:
        print(f"  ⚠️  Pas assez de données ({n} matchs). Famille ignorée.")
        return

    # Features
    feat_df = compute_team_features(df_fam.reset_index(drop=True))
    full, le_league = build_features(df_fam.reset_index(drop=True), feat_df)
    full = full.fillna(0)

    feature_cols = get_feature_cols(full)
    X = full[feature_cols].values

    # Cibles
    y_result   = full["result"].values          # H / D / A
    y_goals    = full["total_goals"].values
    y_parity   = full["goals_parity"].values
    y_score_h  = full["score_home"].values
    y_score_a  = full["score_away"].values

    # Pour PENALTY : supprimer les nuls (ne devraient pas exister)
    if not has_draw:
        mask = full["result"] != "D"
        X         = X[mask]
        y_result  = y_result[mask]
        y_goals   = y_goals[mask]
        y_parity  = y_parity[mask]
        y_score_h = y_score_h[mask]
        y_score_a = y_score_a[mask]
        print(f"  (Penalty : {mask.sum()} matchs sans nul conservés)")

    # Encodage résultat
    le_result = LabelEncoder()
    y_result_enc = le_result.fit_transform(y_result)

    # Split train/test
    test_size = 0.2 if n >= 200 else 0.15
    idx = np.arange(len(X))
    # Respect de l'ordre temporel
    split = int(len(idx) * (1 - test_size))
    tr, te = idx[:split], idx[split:]

    X_tr, X_te = X[tr], X[te]
    yr_tr, yr_te = y_result_enc[tr], y_result_enc[te]
    yg_tr, yg_te = y_goals[tr], y_goals[te]
    yp_tr, yp_te = y_parity[tr], y_parity[te]
    ysh_tr = y_score_h[tr]
    ysa_tr = y_score_a[tr]

    models = {}

    # ── 5.1 Résultat (1/N/2) ────────────────────────────────────────────────
    print("  [1/4] Entraînement résultat...")
    n_classes = len(np.unique(yr_tr))
    if n_classes >= 2:
        if n >= 500:
            clf_result = Pipeline([
                ("scaler", StandardScaler()),
                ("clf", GradientBoostingClassifier(
                    n_estimators=200, max_depth=4, learning_rate=0.05,
                    subsample=0.8, random_state=42
                ))
            ])
        else:
            clf_result = Pipeline([
                ("scaler", StandardScaler()),
                ("clf", RandomForestClassifier(
                    n_estimators=200, max_depth=6, random_state=42
                ))
            ])
        clf_result.fit(X_tr, yr_tr)
        models["result"] = clf_result

        if evaluate and len(te) > 0:
            preds = clf_result.predict(X_te)
            acc = accuracy_score(yr_te, preds)
            print(f"    Accuracy résultat : {acc:.3f}")
            print(classification_report(yr_te, preds,
                  target_names=le_result.classes_, zero_division=0))

    # ── 5.2 Total buts (régression) ─────────────────────────────────────────
    print("  [2/4] Entraînement total buts...")
    if n >= 500:
        reg_goals = Pipeline([
            ("scaler", StandardScaler()),
            ("reg", GradientBoostingRegressor(
                n_estimators=200, max_depth=4, learning_rate=0.05,
                subsample=0.8, random_state=42
            ))
        ])
    else:
        reg_goals = Pipeline([
            ("scaler", StandardScaler()),
            ("reg", Ridge(alpha=1.0))
        ])
    reg_goals.fit(X_tr, yg_tr)
    models["total_goals"] = reg_goals

    if evaluate and len(te) > 0:
        preds_g = reg_goals.predict(X_te)
        mae = mean_absolute_error(yg_te, preds_g)
        print(f"    MAE total buts : {mae:.3f}")

    # ── 5.3 Pair / Impair ───────────────────────────────────────────────────
    print("  [3/4] Entraînement pair/impair...")
    clf_parity = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", LogisticRegression(max_iter=500, C=1.0, random_state=42))
    ])
    clf_parity.fit(X_tr, yp_tr)
    models["parity"] = clf_parity

    if evaluate and len(te) > 0:
        preds_p = clf_parity.predict(X_te)
        acc_p = accuracy_score(yp_te, preds_p)
        print(f"    Accuracy pair/impair : {acc_p:.3f}")

    # ── 5.4 Score exact — Modèle de Poisson ─────────────────────────────────
    print("  [4/4] Entraînement score exact (Poisson)...")
    max_goals_poisson = int(cfg["typical_goals"][1]) + 2
    poisson_model = PoissonScoreModel()
    poisson_model.fit(X_tr, ysh_tr, ysa_tr, feature_cols)
    models["poisson"] = poisson_model

    if evaluate and len(te) > 0:
        exact_preds = poisson_model.predict_exact_score(X_te, max_goals=max_goals_poisson)
        exact_actual = list(zip(y_score_h[te], y_score_a[te]))
        exact_acc = sum(p == a for p, a in zip(exact_preds, exact_actual)) / len(exact_actual)
        total_mae = mean_absolute_error(y_goals[te], poisson_model.predict_total_goals(X_te))
        print(f"    Accuracy score exact : {exact_acc:.3f}")
        print(f"    MAE total buts (Poisson) : {total_mae:.3f}")

    # ── Sauvegarde ───────────────────────────────────────────────────────────
    family_dir = os.path.join(out_dir, family)
    os.makedirs(family_dir, exist_ok=True)

    for name, model in models.items():
        path = os.path.join(family_dir, f"{name}.pkl")
        joblib.dump(model, path)

    # Métadonnées
    meta = {
        "family":        family,
        "description":   cfg["description"],
        "has_draw":      has_draw,
        "n_train":       len(tr),
        "n_test":        len(te),
        "feature_cols":  feature_cols,
        "result_classes": list(le_result.classes_),
        "typical_goals": cfg["typical_goals"],
        "max_goals_poisson": max_goals_poisson,
        "leagues":       list(df_fam["league"].unique()),
    }
    joblib.dump(le_result, os.path.join(family_dir, "le_result.pkl"))
    joblib.dump(le_league, os.path.join(family_dir, "le_league.pkl"))
    with open(os.path.join(family_dir, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    print(f"\n  ✅ Modèles sauvegardés dans : {family_dir}/")
    print(f"     Fichiers : {', '.join(models.keys())}.pkl + meta.json")
    return meta


# ──────────────────────────────────────────────────────────────────────────────
# 6. PRÉDICTION (helper réutilisable)
# ──────────────────────────────────────────────────────────────────────────────

def predict_match(team_home: str, team_away: str, league: str, models_dir: str,
                  history_df: pd.DataFrame):
    """
    Prédit toutes les issues pour un match donné.
    history_df : le DataFrame historique pour calculer les features.
    """
    # Déterminer la famille
    family = "CLASSIC"
    for fam, cfg in FAMILIES.items():
        if cfg["pattern"] and pd.Series([league]).str.contains(cfg["pattern"], regex=True)[0]:
            family = fam
            break

    family_dir = os.path.join(models_dir, family)
    if not os.path.exists(family_dir):
        raise FileNotFoundError(f"Modèles non trouvés pour la famille {family}. Lance d'abord l'entraînement.")

    with open(os.path.join(family_dir, "meta.json")) as f:
        meta = json.load(f)

    # Construire une ligne fictive pour ce match
    fake_row = pd.DataFrame([{
        "id": 999999,
        "match_id": 999999,
        "team_home": team_home,
        "team_away": team_away,
        "league": league,
        "score_home": 0,
        "score_away": 0,
        "finished_at": pd.Timestamp.now(tz="UTC"),
        "source": "predict",
        "created_at": pd.Timestamp.now(tz="UTC"),
        "updated_at": pd.Timestamp.now(tz="UTC"),
    }])
    fake_row["finished_at"] = pd.to_datetime(fake_row["finished_at"], utc=True)
    fake_row["total_goals"] = 0
    fake_row["goals_parity"] = 0
    fake_row["result"] = "H"
    fake_row["family"] = family

    combined = pd.concat([history_df, fake_row], ignore_index=True)
    combined = combined.sort_values("finished_at").reset_index(drop=True)

    feat_df = compute_team_features(combined)
    full, _ = build_features(combined, feat_df)
    full = full.fillna(0)

    row = full[full["id"] == 999999].iloc[0]
    feature_cols = meta["feature_cols"]
    X = row[feature_cols].values.reshape(1, -1)

    # Charger les modèles
    le_result   = joblib.load(os.path.join(family_dir, "le_result.pkl"))
    clf_result  = joblib.load(os.path.join(family_dir, "result.pkl"))
    reg_goals   = joblib.load(os.path.join(family_dir, "total_goals.pkl"))
    clf_parity  = joblib.load(os.path.join(family_dir, "parity.pkl"))
    poisson_mdl = joblib.load(os.path.join(family_dir, "poisson.pkl"))

    # Prédictions
    result_proba = clf_result.predict_proba(X)[0]
    result_classes = le_result.classes_
    result_pred = le_result.inverse_transform([clf_result.predict(X)[0]])[0]

    total_goals_pred = float(reg_goals.predict(X)[0])
    parity_pred = "pair" if clf_parity.predict(X)[0] == 1 else "impair"
    parity_proba = clf_parity.predict_proba(X)[0]

    max_g = meta["max_goals_poisson"]
    exact_score = poisson_mdl.predict_exact_score(X, max_goals=max_g)[0]
    lh, la = poisson_mdl.predict_lambdas(X)

    output = {
        "match": f"{team_home} vs {team_away}",
        "league": league,
        "family": family,
        "result": {
            "prediction": result_pred,
            "probabilities": {c: round(float(p), 3)
                              for c, p in zip(result_classes, result_proba)},
        },
        "total_goals": {
            "prediction": round(total_goals_pred, 1),
            "lambda_home": round(float(lh[0]), 2),
            "lambda_away": round(float(la[0]), 2),
        },
        "parity": {
            "prediction": parity_pred,
            "prob_pair":   round(float(parity_proba[1]), 3),
            "prob_impair": round(float(parity_proba[0]), 3),
        },
        "exact_score": {
            "prediction": f"{exact_score[0]}-{exact_score[1]}",
        },
    }
    return output


# ──────────────────────────────────────────────────────────────────────────────
# 7. POINT D'ENTRÉE
# ──────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Entraînement multi-familles / multi-tâches")
    parser.add_argument("--csv",  required=True, help="Chemin vers le CSV des matchs terminés")
    parser.add_argument("--out",  default="./models", help="Répertoire de sortie des modèles")
    parser.add_argument("--eval", action="store_true", help="Afficher les métriques d'évaluation")
    parser.add_argument("--predict", action="store_true",
                        help="Mode démo : prédit un match exemple après l'entraînement")
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)

    print("=" * 60)
    print("  CHARGEMENT DES DONNÉES")
    print("=" * 60)
    df = load_data(args.csv)
    df = assign_family(df)

    print(f"  {len(df)} matchs chargés")
    for fam in FAMILIES:
        n = (df["family"] == fam).sum()
        print(f"  {fam:12s} : {n} matchs")

    all_meta = {}
    for family, cfg in FAMILIES.items():
        df_fam = df[df["family"] == family].copy()
        if len(df_fam) == 0:
            print(f"\n⚠️  Famille {family} : aucun match trouvé, ignorée.")
            continue
        meta = train_family(family, df_fam, cfg, args.out, evaluate=args.eval)
        if meta:
            all_meta[family] = meta

    # Résumé global
    summary_path = os.path.join(args.out, "summary.json")
    with open(summary_path, "w") as f:
        json.dump(all_meta, f, indent=2, ensure_ascii=False)

    print("\n" + "=" * 60)
    print("  ENTRAÎNEMENT TERMINÉ")
    print(f"  Résumé global : {summary_path}")
    print("=" * 60)

    # Démo de prédiction
    if args.predict:
        print("\n--- DÉMO PRÉDICTION ---")
        try:
            result = predict_match(
                team_home="Bayern Munich",
                team_away="Manchester City",
                league="FC 26. Champions League",
                models_dir=args.out,
                history_df=df,
            )
            print(json.dumps(result, indent=2, ensure_ascii=False))
        except Exception as e:
            print(f"Erreur prédiction démo : {e}")


if __name__ == "__main__":
    main()
