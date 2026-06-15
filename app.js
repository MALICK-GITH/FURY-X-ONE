const betTypeLabels = {
  1: "Victoire équipe 1",
  2: "Victoire équipe 2",
  3: "Match nul",
  4: "Double chance 1X",
  5: "Double chance X2",
  6: "Double chance 12",
  7: "Handicap équipe 1",
  8: "Handicap équipe 2",
  9: "Plus de",
  10: "Moins de",
  11: "Plus de buts équipe",
  12: "Moins de buts équipe",
  13: "BTTS Oui",
  14: "BTTS Non"
};

const marketGroupLabels = {
  1: "Résultat 1X2",
  2: "Handicap",
  8: "Double chance",
  15: "Total équipe",
  17: "Total buts",
  19: "Marché spécial",
  62: "Les deux équipes marquent"
};

const app = document.getElementById("app");
const assistantToggle = document.getElementById("assistant-toggle");
const assistantPanel = document.getElementById("assistant-panel");
const assistantClose = document.getElementById("assistant-close");
const assistantMessagesEl = document.getElementById("assistant-messages");
const assistantForm = document.getElementById("assistant-form");
const assistantInput = document.getElementById("assistant-input");

const state = {
  leagues: [],
  predictionApi: {
    health: null,
    families: {},
    leaguesByFamily: {}
  },
  loading: true,
  error: "",
  activeLeagueFilter: "all",
  predictionCache: {},
  exportLoading: false,
  assistantOpen: false,
  assistantMessages: [
    {
      role: "assistant",
      content:
        "Bonjour, je suis l’assistant Fury X One. Je peux t’aider à comprendre les ligues, les matchs et les marchés."
    }
  ],
  couponMatches: [],
  couponMessage: "",
  couponCount: 3,
  couponThreshold: "safe",
  couponLeagueSelection: ["all"],
  couponLeaguePanelOpen: false,
  couponGenerating: false
};

function renderLoading(message = "Chargement des ligues et matchs...") {
  app.innerHTML = `<section class="hero"><h2>Chargement</h2><p>${escapeHtml(message)}</p></section>`;
}

function renderError(message) {
  app.innerHTML = `
    <section class="hero">
      <h2>Erreur de chargement</h2>
      <p>${escapeHtml(message)}</p>
      <div class="actions">
        <button class="button" onclick="bootstrap()">Réessayer</button>
      </div>
    </section>
  `;
}

function getAllMatches() {
  return state.leagues.flatMap((league) =>
    league.matches.map((match) => ({ ...match, leagueName: league.name }))
  );
}

function getLeagueCategory(name) {
  const value = (name || "").toLowerCase();
  if (value.includes("penalty")) return "penalty";
  if (value.includes("5x5") || value.includes("rush")) return "rush";
  if (value.includes("4x4")) return "4x4";
  if (value.includes("3x3")) return "3x3";
  if (value.includes("champions")) return "champions";
  return "other";
}

function getLeagueFilterOptions() {
  return [
    { id: "all", label: "Toutes" },
    { id: "penalty", label: "Tirs au but" },
    { id: "rush", label: "Rush / 5x5" },
    { id: "4x4", label: "4x4" },
    { id: "3x3", label: "3x3" },
    { id: "champions", label: "Ligue des champions" }
  ];
}

function getPredictionFamilyEntries() {
  return Object.entries(state.predictionApi.families || {});
}

function getPredictionFamilyForLeagueName(leagueName) {
  for (const [familyName, familyConfig] of getPredictionFamilyEntries()) {
    const pattern = familyConfig?.pattern;
    if (!pattern) {
      continue;
    }
    try {
      if (new RegExp(pattern, "i").test(String(leagueName || ""))) {
        return familyName;
      }
    } catch (_) {
      continue;
    }
  }
  return "CLASSIC";
}

function getFilteredLeagues() {
  if (state.activeLeagueFilter === "all") {
    return state.leagues;
  }
  return state.leagues.filter((league) => getLeagueCategory(league.name) === state.activeLeagueFilter);
}

function getMatchStatusSummary(matches) {
  const summary = {
    total: matches.length,
    notStarted: 0,
    live: 0,
    halftime: 0,
    finishedLike: 0
  };

  matches.forEach((match) => {
    const statusName = (match.TN || "").toLowerCase();
    if (match.GNS) summary.notStarted += 1;
    if (match.ICY || match.HS === 1) summary.live += 1;
    if (!match.GNS && statusName.includes("mi-temps")) summary.halftime += 1;
    if (statusName.includes("termin") || statusName.includes("fin")) summary.finishedLike += 1;
  });

  return summary;
}

function getStatusClass(match) {
  const statusName = getDisplayStatus(match).toLowerCase();
  if (statusName.includes("direct")) return "status-live";
  if (statusName.includes("mi-temps")) return "status-halftime";
  if (statusName.includes("venir") || match.GNS) return "status-upcoming";
  if (statusName.includes("termin") || statusName.includes("fin")) return "status-finished";
  return "status-neutral";
}

function setLeagueFilter(filterId) {
  state.activeLeagueFilter = filterId;
  renderHome();
}

function getMatchById(id) {
  return getAllMatches().find((match) => String(match.I) === String(id));
}

function getAdvancedTotals(match) {
  return (match.AE || []).find((entry) => entry.G === 17)?.ME ?? [];
}

function getAdvancedHandicaps(match) {
  return (match.AE || []).find((entry) => entry.G === 2)?.ME ?? [];
}

function normalizeLeagues(rawMatches) {
  const groups = new Map();
  rawMatches.forEach((match) => {
    const leagueId = match.LI || match.LE || "unknown";
    if (!groups.has(leagueId)) {
      groups.set(leagueId, {
        id: leagueId,
        name: match.LE || match.L || "Ligue inconnue",
        country: match.CN || match.CE || "Inconnu",
        sportId: match.SI || 85,
        matches: []
      });
    }
    groups.get(leagueId).matches.push(match);
  });
  return Array.from(groups.values()).sort((left, right) => left.name.localeCompare(right.name, "fr"));
}

function formatTimestamp(timestamp, locale = "fr-FR") {
  if (!timestamp) return "Inconnu";
  return new Date(timestamp * 1000).toLocaleString(locale, {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function hasLiveScore(match) {
  const score = match?.SC?.FS || {};
  return Object.prototype.hasOwnProperty.call(score, "S1") && Object.prototype.hasOwnProperty.call(score, "S2");
}

function isPrematchState(match) {
  return Boolean(match.GNS);
}

function isHalftimeState(match) {
  return !isPrematchState(match) && (match.TN || "").toLowerCase().includes("mi-temps");
}

function isLiveState(match) {
  return !isPrematchState(match) && Boolean(match.HS === 1 || match.ICY);
}

function getScoreDisplay(match) {
  if (!hasLiveScore(match)) {
    return isPrematchState(match) ? "Pas encore commencé" : "Score non disponible";
  }
  return `${match.SC.FS.S1} - ${match.SC.FS.S2}`;
}

function getDisplayStatus(match) {
  if (isPrematchState(match)) return "À venir";
  if (isHalftimeState(match)) return "Mi-temps";
  if (isLiveState(match)) return "En direct";
  return match.TN || "Statut inconnu";
}

function getDisplayPhase(match) {
  if (isPrematchState(match)) return "Pré-match";
  return match.SC?.CPS || match.TNS || "Période";
}

function getDisplayTime(match) {
  return match.SC?.SLS || "Temps inconnu";
}

function getCompactMatchInfo(match) {
  if (isPrematchState(match)) {
    return [getDisplayStatus(match), getDisplayTime(match), match.SC?.I || null].filter(Boolean).join(" · ");
  }
  return [getDisplayStatus(match), getDisplayPhase(match), getDisplayTime(match)].filter(Boolean).join(" · ");
}

function legacyRenderHome() {
  const matches = getAllMatches();
  const filteredLeagues = getFilteredLeagues();
  const filteredMatches = filteredLeagues.flatMap((league) => league.matches);
  const statusSummary = getMatchStatusSummary(filteredMatches);
  const filterOptions = getLeagueFilterOptions();

  app.innerHTML = `
    <section class="hero hero-home">
      <h2>Accueil</h2>
      <p>Les ligues et matchs affichés viennent de l’API live 888starz. Ouvrez les détails d’un match pour voir ses informations et ses marchés.</p>
      <div class="stats">
        <div class="stat"><span>Ligues</span><strong>${filteredLeagues.length}</strong></div>
        <div class="stat"><span>Matchs</span><strong>${filteredMatches.length}</strong></div>
        <div class="stat"><span>En direct</span><strong>${matches.filter((match) => match.ICY).length}</strong></div>
      </div>
      <div class="actions">
        <button class="button" onclick="exportMatchesToCSV(getAllMatches())">Exporter CSV</button>
        <button class="button" onclick="generatePDFReport(getAllMatches())">Rapport PDF</button>
      </div>
    </section>

    <section class="section-block">
      <div class="section-heading">
        <h2>API Prédictions</h2>
        <p class="muted">Santé, familles et ligues supportées.</p>
      </div>
      <div class="grid leagues">
        <article class="card">
          <h3>Statut moteur</h3>
          <p><strong>${escapeHtml(state.predictionApi.health?.status || "Inconnu")}</strong></p>
          <p class="muted">Modèles chargés: ${escapeHtml(state.predictionApi.health?.models_loaded ? "Oui" : "Non")}</p>
        </article>
        ${getPredictionFamilyEntries().map(([familyName, familyConfig]) => `
          <article class="card">
            <h3>${escapeHtml(familyName)}</h3>
            <p>${escapeHtml(familyConfig.description || "")}</p>
            <p class="muted">Ligues: ${escapeHtml((state.predictionApi.leaguesByFamily[familyName] || []).length)}</p>
          </article>
        `).join("")}
      </div>
    </section>

    <section class="section-block">
      <div class="section-heading">
        <h2>API Prédictions</h2>
        <p class="muted">Santé, familles et ligues supportées.</p>
      </div>
      <div class="grid leagues">
        <article class="card">
          <h3>Statut moteur</h3>
          <p><strong>${escapeHtml(state.predictionApi.health?.status || "Inconnu")}</strong></p>
          <p class="muted">Modèles chargés: ${escapeHtml(state.predictionApi.health?.models_loaded ? "Oui" : "Non")}</p>
        </article>
        ${getPredictionFamilyEntries().map(([familyName, familyConfig]) => `
          <article class="card">
            <h3>${escapeHtml(familyName)}</h3>
            <p>${escapeHtml(familyConfig.description || "")}</p>
            <p class="muted">Ligues: ${escapeHtml((state.predictionApi.leaguesByFamily[familyName] || []).length)}</p>
          </article>
        `).join("")}
      </div>
    </section>

    <section class="section-block">
      <div class="section-heading">
        <h2>API PrÃ©dictions</h2>
        <p class="muted">SantÃ©, familles et ligues supportÃ©es.</p>
      </div>
      <div class="grid leagues">
        <article class="card">
          <h3>Statut moteur</h3>
          <p><strong>${escapeHtml(state.predictionApi.health?.status || "Inconnu")}</strong></p>
          <p class="muted">ModÃ¨les chargÃ©s: ${escapeHtml(state.predictionApi.health?.models_loaded ? "Oui" : "Non")}</p>
        </article>
        ${getPredictionFamilyEntries().map(([familyName, familyConfig]) => `
          <article class="card">
            <h3>${escapeHtml(familyName)}</h3>
            <p>${escapeHtml(familyConfig.description || "")}</p>
            <p class="muted">Ligues: ${escapeHtml((state.predictionApi.leaguesByFamily[familyName] || []).length)}</p>
          </article>
        `).join("")}
      </div>
    </section>

    <section class="section-block">
      <div class="section-heading">
        <h2>API PrÃ©dictions</h2>
        <p class="muted">SantÃ©, familles et ligues supportÃ©es.</p>
      </div>
      <div class="grid leagues">
        <article class="card">
          <h3>Statut moteur</h3>
          <p><strong>${escapeHtml(state.predictionApi.health?.status || "Inconnu")}</strong></p>
          <p class="muted">ModÃ¨les chargÃ©s: ${escapeHtml(state.predictionApi.health?.models_loaded ? "Oui" : "Non")}</p>
        </article>
        ${getPredictionFamilyEntries().map(([familyName, familyConfig]) => `
          <article class="card">
            <h3>${escapeHtml(familyName)}</h3>
            <p>${escapeHtml(familyConfig.description || "")}</p>
            <p class="muted">Ligues: ${escapeHtml((state.predictionApi.leaguesByFamily[familyName] || []).length)}</p>
          </article>
        `).join("")}
      </div>
    </section>

    <section class="toolbar">
      <div class="card">
        <h2>Filtres des ligues</h2>
        <div class="filter-row">
          ${filterOptions.map((option) => `<button class="filter-chip ${state.activeLeagueFilter === option.id ? "active" : ""}" onclick="setLeagueFilter('${option.id}')">${option.label}</button>`).join("")}
        </div>
      </div>
    </section>

    <section class="status-grid">
      <div class="card">
        <h2>Secteur des statuts de match</h2>
        <div class="status-row">
          <div class="status-card"><span>Total</span><strong>${statusSummary.total}</strong></div>
          <div class="status-card"><span>Pas commencés</span><strong>${statusSummary.notStarted}</strong></div>
          <div class="status-card"><span>En direct</span><strong>${statusSummary.live}</strong></div>
          <div class="status-card"><span>Mi-temps</span><strong>${statusSummary.halftime}</strong></div>
          <div class="status-card"><span>Terminés</span><strong>${statusSummary.finishedLike}</strong></div>
        </div>
      </div>
    </section>

    <section class="section-block">
      <div class="section-heading">
        <h2>Ligues</h2>
        <p class="muted">Choisis une ligue pour voir ses matchs en direct et ses marchés.</p>
      </div>
      <div class="grid leagues">
        ${filteredLeagues.map(renderLeagueCard).join("")}
      </div>
    </section>
  `;

  const cacheKey = String(match.I);
  const cachedPrediction = state.predictionCache[cacheKey];
  if (!cachedPrediction || (!cachedPrediction.loading && !cachedPrediction.data && !cachedPrediction.error)) {
    loadPrediction(match);
  }
}

function renderLeagueCard(league) {
  const leagueId = encodeRouteSegment(league.id);
  return `
    <article class="card league-card">
      <div class="league-card-top">
        <span class="mini-badge">Ligue</span>
        <h3>${escapeHtml(league.name)}</h3>
      </div>
      <div class="league-meta">
        <span class="muted">Pays: ${escapeHtml(league.country)}</span>
        <span class="muted">Sport ID: ${escapeHtml(league.sportId)}</span>
        <span class="muted">Matchs: ${escapeHtml(league.matches.length)}</span>
      </div>
      <div class="actions">
        <a class="button" href="#/league/${leagueId}">Voir les matchs</a>
      </div>
    </article>
  `;
}

function legacyRenderLeague(leagueId) {
  const league = state.leagues.find((item) => String(item.id) === String(leagueId));
  if (!league) {
    app.innerHTML = `<div class="card"><h2>Ligue introuvable</h2><a class="button-secondary" href="#/">Retour</a></div>`;
    return;
  }

  app.innerHTML = `
    <section class="hero hero-league">
      <h2>${escapeHtml(league.name)}</h2>
      <p>${escapeHtml(league.matches.length)} match(s) disponibles dans cette ligue virtuelle.</p>
      <div class="actions">
        <a class="button-secondary" href="#/">Retour à l’accueil</a>
      </div>
    </section>

    <section class="section-block">
      <div class="section-heading">
        <h2>Matchs</h2>
        <p class="muted">Vue rapide des affiches, scores, statuts et marchés principaux.</p>
      </div>
    </section>

    <section class="matches">
      ${league.matches.map(renderMatchCard).join("")}
    </section>
  `;
}

function renderMatchCard(match) {
  const scoreDisplay = getScoreDisplay(match);
  const matchId = encodeRouteSegment(match.I);
  return `
    <article class="match-card">
      <div class="match-card-top">
        <div class="pill-row">
          <span class="pill ${getStatusClass(match)}">${escapeHtml(getDisplayStatus(match))}</span>
          <span class="pill">${escapeHtml(getDisplayPhase(match))}</span>
        </div>
        <span class="muted">Début: ${escapeHtml(formatTimestamp(match.S))}</span>
      </div>

      <div class="teams">
        <div class="team-col">
          <p class="muted">Équipe 1</p>
          <h3>${escapeHtml(match.O1)}</h3>
        </div>
        <div class="score ${hasLiveScore(match) ? "" : "score-muted"}">${escapeHtml(scoreDisplay)}</div>
        <div class="team-col">
          <p class="muted">Équipe 2</p>
          <h3>${escapeHtml(match.O2)}</h3>
        </div>
      </div>

      <div class="match-meta">
        <div class="pill-row">
          <span class="pill">Temps: ${escapeHtml(getDisplayTime(match))}</span>
        </div>
        <p class="muted match-info-line">${escapeHtml(getCompactMatchInfo(match))}</p>
        <div class="odds-row">
          ${(match.E || []).slice(0, 5).map((item) => `<span class="odd-pill">${escapeHtml(betTypeLabels[item.T] || `Type ${item.T}`)}${item.P ? ` ${escapeHtml(item.P)}` : ""} · ${escapeHtml(item.C)}</span>`).join("")}
        </div>
      </div>

      <div class="actions">
        <a class="button" href="#/prediction/${matchId}">Détails</a>
      </div>
    </article>
  `;
}

function legacyRenderPredictionDetails(matchId) {
  const match = getMatchById(matchId);
  if (!match) {
    app.innerHTML = `<div class="card"><h2>Match introuvable</h2><a class="button-secondary" href="#/">Retour</a></div>`;
    return;
  }

  const advancedTotals = getAdvancedTotals(match);
  const advancedHandicaps = getAdvancedHandicaps(match);
  const primaryMarkets = (match.E || []).filter((item) => [1, 2, 3, 9, 10, 13, 14, 180, 181].includes(item.T));
  const scoreDisplay = getScoreDisplay(match);
  const predictionState = state.predictionCache[String(match.I)] || { loading: true };
  const leagueId = encodeRouteSegment(match.LI);
  const exportMatchId = escapeAttribute(match.I);

  app.innerHTML = `
    <section class="hero hero-detail">
      <div class="detail-header-top">
        <span class="mini-badge">Détail match</span>
        <span class="muted">${escapeHtml(match.LE || match.L)}</span>
      </div>
      <h2>${escapeHtml(match.O1)} vs ${escapeHtml(match.O2)}</h2>
      <div class="detail-score-row">
        <div class="detail-team">${escapeHtml(match.O1)}</div>
        <div class="detail-score ${hasLiveScore(match) ? "" : "score-muted"}">${escapeHtml(scoreDisplay)}</div>
        <div class="detail-team detail-team-right">${escapeHtml(match.O2)}</div>
      </div>
      <div class="pill-row">
        <span class="pill ${getStatusClass(match)}">${escapeHtml(getDisplayStatus(match))}</span>
        <span class="pill">${escapeHtml(getDisplayPhase(match))}</span>
        <span class="pill">${escapeHtml(getDisplayTime(match))}</span>
      </div>
      <div class="actions">
        <a class="button-secondary" href="#/league/${leagueId}">Retour à la ligue</a>
        <button class="button export-image-button" type="button" data-export-match-id="${exportMatchId}">
          ${state.exportLoading ? "Création..." : "Créer l'image"}
        </button>
      </div>
    </section>

    <section class="prediction-layout prediction-layout-top">
      <article class="prediction-box">
        <h3>Prédiction</h3>
        <p class="muted">API réelle · ${escapeHtml(getDisplayStatus(match))} · ${escapeHtml(getDisplayTime(match))}</p>
        ${renderPredictionModule(match, predictionState)}
      </article>

      <article class="prediction-box">
        <h3>${escapeHtml(match.O1)} <span class="muted">vs</span> ${escapeHtml(match.O2)}</h3>
        <p class="muted">${escapeHtml(getCompactMatchInfo(match))}</p>
        <div class="prediction-grid">
          <div class="market-item"><strong>Score actuel</strong><p>${escapeHtml(scoreDisplay)}</p></div>
          <div class="market-item"><strong>Début</strong><p>${escapeHtml(formatTimestamp(match.S))}</p></div>
          <div class="market-item"><strong>Ligue</strong><p>${escapeHtml(match.LE || match.L || "Inconnue")}</p></div>
          <div class="market-item"><strong>Pays</strong><p>${escapeHtml(match.CN || match.CE || "Inconnu")}</p></div>
          <div class="market-item"><strong>Marchés</strong><p>${escapeHtml(match.EC || (match.E || []).length)}</p></div>
          <div class="market-item"><strong>ID match</strong><p>${escapeHtml(match.I)}</p></div>
          <div class="market-item"><strong>Info match</strong><p>${escapeHtml(match.SC?.I || "Aucune information supplémentaire")}</p></div>
        </div>
      </article>
    </section>

    <section class="card section-card">
      <h3>Marchés principaux</h3>
      <div class="market-list">
        ${primaryMarkets.map((item) => `
          <div class="market-item">
            <strong>${escapeHtml(betTypeLabels[item.T] || `Type ${item.T}`)}</strong>
            <p>Groupe: ${escapeHtml(marketGroupLabels[item.G] || item.G)}</p>
            <p>${item.P !== undefined ? `Ligne: ${escapeHtml(item.P)}` : "Sans ligne"}</p>
            <p>Cote: ${escapeHtml(item.C)}</p>
          </div>
        `).join("")}
      </div>
    </section>

    <section class="card section-card">
      <h3>Marchés avancés - Total buts</h3>
      <div class="market-list">
        ${advancedTotals.length ? advancedTotals.map((item) => `
          <div class="market-item">
            <strong>${escapeHtml(betTypeLabels[item.T] || `Type ${item.T}`)}</strong>
            <p>Ligne: ${escapeHtml(item.P)}</p>
            <p>Cote: ${escapeHtml(item.C)}</p>
          </div>
        `).join("") : "<p class='muted'>Aucun marché avancé disponible.</p>"}
      </div>
    </section>

    <section class="card section-card">
      <h3>Marchés avancés - Handicap</h3>
      <div class="market-list">
        ${advancedHandicaps.length ? advancedHandicaps.map((item) => `
          <div class="market-item">
            <strong>${escapeHtml(betTypeLabels[item.T] || `Type ${item.T}`)}</strong>
            <p>Groupe: ${escapeHtml(marketGroupLabels[item.G] || item.G)}</p>
            <p>${item.P !== undefined ? `Ligne: ${escapeHtml(item.P)}` : "Sans ligne"}</p>
            <p>Cote: ${escapeHtml(item.C)}</p>
          </div>
        `).join("") : "<p class='muted'>Aucun handicap avancé disponible.</p>"}
      </div>
    </section>
  `;

  if (!state.predictionCache[String(match.I)]) {
    loadPrediction(match);
  }
}

function legacyRenderPredictionModule(match, predictionState) {
  if (predictionState.loading) {
    return `<div class="market-item"><p>Chargement de la prédiction...</p></div>`;
  }

  if (predictionState.error) {
    return `<div class="market-item"><strong>Erreur</strong><p>${predictionState.error}</p></div>`;
  }

  const prediction = predictionState.data?.prediction;
  if (!prediction) {
    return `<div class="market-item"><p>Aucune prédiction disponible.</p></div>`;
  }

  const resultLabel = getResultLabel(prediction.result?.prediction, match);
  const exactScore = prediction.exact_score?.prediction || "-";
  const totalGoals = prediction.total_goals?.prediction ?? "-";
  const parity = prediction.parity?.prediction || "-";
  const family = prediction.family || "-";
  const probabilities = prediction.result?.probabilities || {};
  const confidence = getMainConfidence(probabilities, prediction.result?.prediction);
  const totalGoalsMarkets = prediction.total_goals?.over_under || {};
  const handicapRecommendation = prediction.handicap?.recommended || null;
  const handicapLabel = handicapRecommendation
    ? `${formatHandicapLabel(handicapRecommendation.line, handicapRecommendation.prediction, match)} (${getMainConfidence(handicapRecommendation.probabilities || {}, handicapRecommendation.prediction)})`
    : "-";

  return `
    <div class="primary-prediction-glow">
      <span class="primary-prediction-label">Prédiction principale</span>
      <div class="primary-prediction-value">${resultLabel}</div>
      <div class="primary-prediction-meta">
        <span>Score exact: ${exactScore}</span>
        <span>Total buts: ${formatPredictionNumber(totalGoals)}</span>
        <span>Confiance: ${confidence}</span>
        <span>Famille: ${family}</span>
      </div>
    </div>
    <div class="prediction-grid">
      <div class="market-item"><strong>Résultat</strong><p>${resultLabel}</p></div>
      <div class="market-item"><strong>Score exact</strong><p>${exactScore}</p></div>
      <div class="market-item"><strong>Total buts</strong><p>${formatPredictionNumber(totalGoals)}</p></div>
      <div class="market-item"><strong>Parité</strong><p>${parity}</p></div>
      <div class="market-item"><strong>Probabilité domicile</strong><p>${formatPercent(probabilities.H)}</p></div>
      <div class="market-item"><strong>Probabilité nul</strong><p>${formatPercent(probabilities.D)}</p></div>
      <div class="market-item"><strong>Probabilité extérieur</strong><p>${formatPercent(probabilities.A)}</p></div>
      <div class="market-item"><strong>Plus de 2,5 buts</strong><p>${formatOverUnder(totalGoalsMarkets["2.5"], "over")}</p></div>
      <div class="market-item"><strong>Plus de 3,5 buts</strong><p>${formatOverUnder(totalGoalsMarkets["3.5"], "over")}</p></div>
      <div class="market-item"><strong>Handicap conseillé</strong><p>${handicapLabel}</p></div>
      <div class="market-item"><strong>Source</strong><p>${predictionState.data?.provider || "API réelle"}</p></div>
    </div>
  `;
}

function getResultLabel(code, match) {
  if (code === "H") return `${match.O1} gagne`;
  if (code === "A") return `${match.O2} gagne`;
  if (code === "D") return "Match nul";
  return code || "Indisponible";
}

function formatPercent(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function formatPredictionNumber(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  return Number(value).toFixed(1);
}

function getMainConfidence(probabilities, code) {
  if (!code || !probabilities || probabilities[code] === undefined) {
    return "-";
  }
  return formatPercent(probabilities[code]);
}

function formatOverUnder(overUnderLine, side) {
  if (!overUnderLine || overUnderLine[side] === undefined) {
    return "-";
  }
  return formatPercent(overUnderLine[side]);
}

function formatHandicapLabel(line, code, match) {
  if (!line || !code) {
    return "-";
  }
  const teamLabel = code === "H" ? match.O1 : code === "A" ? match.O2 : "Nul";
  if (code === "D") {
    return `Handicap ${line} : nul`;
  }
  return `${teamLabel} ${line}`;
}

function getPredictionHeadline(prediction, match) {
  if (!prediction) {
    return "Prédiction indisponible";
  }
  return getResultLabel(prediction.result?.prediction, match);
}

function getPredictionFooter(predictionState, match) {
  if (predictionState.loading) {
    return "Prédiction en cours de chargement";
  }
  if (predictionState.error) {
    return "Prédiction indisponible pour le moment";
  }
  const prediction = predictionState.data?.prediction;
  if (!prediction) {
    return "Aucune pr?diction disponible";
  }
  const confidence = getMainConfidence(prediction.result?.probabilities || {}, prediction.result?.prediction);
  return `${getResultLabel(prediction.result?.prediction, match)} · Confiance ${confidence} · ${predictionState.data?.provider || "API réelle"}`;
}

function roundRect(context, x, y, width, height, radius, fill, stroke) {
  if (typeof radius === "undefined") {
    radius = 5;
  }
  if (typeof radius === "number") {
    radius = {tl: radius, tr: radius, br: radius, bl: radius};
  } else {
    var defaultRadius = {tl: 0, tr: 0, br: 0, bl: 0};
    for (var side in defaultRadius) {
      radius[side] = radius[side] || defaultRadius[side];
    }
  }
  context.beginPath();
  context.moveTo(x + radius.tl, y);
  context.lineTo(x + width - radius.tr, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
  context.lineTo(x + width, y + height - radius.br);
  context.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
  context.lineTo(x + radius.bl, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
  context.lineTo(x, y + radius.tl);
  context.quadraticCurveTo(x, y, x + radius.tl, y);
  context.closePath();
  if (fill) {
    context.fill();
  }
  if (stroke) {
    context.stroke();
  }
}

function wrapExportLine(context, text, x, y, maxWidth, lineHeight) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = "";

  words.forEach((word) => {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (!currentLine || context.measureText(candidate).width <= maxWidth) {
      currentLine = candidate;
      return;
    }
    lines.push(currentLine);
    currentLine = word;
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  lines.forEach((line, index) => {
    context.fillText(line, x, y + index * lineHeight);
  });
}

async function exportMatchPredictionImage(matchId) {
  const match = getMatchById(matchId);
  if (!match || state.exportLoading) {
    return;
  }

  state.exportLoading = true;
  if (window.location.hash === `#/prediction/${match.I}`) {
    renderPredictionDetails(match.I);
  }

  try {
    const cachedPrediction = state.predictionCache[String(match.I)];
    if (!cachedPrediction || (!cachedPrediction.data && !cachedPrediction.loading)) {
      await loadPrediction(match);
    }

    const predictionState = state.predictionCache[String(match.I)] || {};
    const prediction = predictionState.data?.prediction || null;
    const rawPrediction = predictionState.data?.raw || prediction;
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1600;

    const context = canvas.getContext("2d");
    const background = context.createLinearGradient(0, 0, 0, canvas.height);
    background.addColorStop(0, "#07101d");
    background.addColorStop(0.55, "#0b1324");
    background.addColorStop(1, "#0b1020");
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const glow = context.createRadialGradient(860, 180, 30, 860, 180, 360);
    glow.addColorStop(0, "rgba(94, 234, 212, 0.26)");
    glow.addColorStop(1, "rgba(94, 234, 212, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = "rgba(16, 27, 49, 0.94)";
    context.strokeStyle = "rgba(255, 255, 255, 0.08)";
    context.lineWidth = 2;
    roundRect(context, 56, 52, 968, 1336, 36, true, true);

    context.fillStyle = "#5eead4";
    context.font = "700 30px Arial";
    context.fillText("FURY X ONE", 96, 118);

    context.fillStyle = "#f5f7fb";
    context.font = "900 54px Arial";
    context.fillText(`${match.O1} vs ${match.O2}`, 96, 198);

    context.fillStyle = "#9fb0cc";
    context.font = "28px Arial";
    context.fillText(match.LE || match.L || "Ligue inconnue", 96, 244);

    context.fillStyle = "rgba(255, 255, 255, 0.05)";
    roundRect(context, 96, 292, 888, 176, 28, true, false);

    context.fillStyle = "#f5f7fb";
    context.font = "700 28px Arial";
    context.fillText(match.O1, 134, 356);
    context.textAlign = "center";
    context.font = "900 58px Arial";
    context.fillText(getScoreDisplay(match), 540, 376);
    context.textAlign = "right";
    context.font = "700 28px Arial";
    context.fillText(match.O2, 946, 356);
    context.textAlign = "left";

    context.fillStyle = "#9fb0cc";
    context.font = "24px Arial";
    context.fillText(`${getDisplayStatus(match)} · ${getDisplayPhase(match)} · ${getDisplayTime(match)}`, 134, 420);

    context.fillStyle = "rgba(94, 234, 212, 0.16)";
    context.strokeStyle = "rgba(94, 234, 212, 0.32)";
    roundRect(context, 96, 520, 888, 244, 30, true, true);

    context.fillStyle = "#ecfeff";
    context.font = "700 24px Arial";
    context.fillText("PRÉDICTION PRINCIPALE", 132, 576);

    context.fillStyle = "#ffffff";
    context.font = "900 72px Arial";
    context.fillText(getPredictionHeadline(prediction, match), 132, 664);

    context.fillStyle = "#ecfeff";
    context.font = "28px Arial";
    wrapExportLine(context, getPredictionFooter(predictionState, match), 132, 716, 810, 36);

    context.fillStyle = "rgba(255, 255, 255, 0.04)";
    roundRect(context, 96, 810, 888, 400, 28, true, false);

    context.fillStyle = "#f5f7fb";
    context.font = "700 28px Arial";
    context.fillText("PRÉDICTIONS COMPLÈTES", 132, 868);

    const x1x2 = rawPrediction.predictions?.["1x2"] || {};
    const totalGoalsData = rawPrediction.predictions?.total_goals || {};
    const handicapData = rawPrediction.predictions?.handicap || {};
    const parityData = rawPrediction.predictions?.parity || {};
    const exactScoreData = rawPrediction.predictions?.exact_score || {};
    const family = rawPrediction.family || "-";

    let yPos = 920;

    context.fillStyle = "#5eead4";
    context.font = "700 22px Arial";
    context.fillText(`Famille: ${family}`, 132, yPos);
    yPos += 40;

    context.fillStyle = "#ecfeff";
    context.font = "700 22px Arial";
    context.fillText("Score Exact:", 132, yPos);
    context.fillStyle = "#ffffff";
    context.font = "900 36px Arial";
    context.fillText(exactScoreData.prediction || "-", 280, yPos);
    yPos += 50;

    context.fillStyle = "#ecfeff";
    context.font = "700 22px Arial";
    context.fillText("Total Buts:", 132, yPos);
    context.fillStyle = "#ffffff";
    context.font = "900 36px Arial";
    context.fillText(formatPredictionNumber(totalGoalsData.predicted || "-"), 280, yPos);
    yPos += 50;

    context.fillStyle = "#ecfeff";
    context.font = "700 22px Arial";
    context.fillText("1X2:", 132, yPos);
    context.fillStyle = "#ffffff";
    context.font = "700 20px Arial";
    context.fillText(`H: ${formatPercent(x1x2.home)} | D: ${formatPercent(x1x2.draw)} | A: ${formatPercent(x1x2.away)}`, 200, yPos);
    yPos += 50;

    context.fillStyle = "#ecfeff";
    context.font = "700 22px Arial";
    context.fillText("Parité:", 132, yPos);
    context.fillStyle = "#ffffff";
    context.font = "700 20px Arial";
    context.fillText(`Pair: ${formatPercent(parityData.pair)} | Impair: ${formatPercent(parityData.impair)}`, 220, yPos);
    yPos += 50;

    context.fillStyle = "rgba(255, 255, 255, 0.04)";
    roundRect(context, 96, 1230, 888, 200, 28, true, false);

    context.fillStyle = "#f5f7fb";
    context.font = "700 28px Arial";
    context.fillText("RÉSUMÉ DU MATCH", 132, 1288);

    context.fillStyle = "#9fb0cc";
    context.font = "24px Arial";
    const summaryText = [
      `Début : ${formatTimestamp(match.S)}`,
      `Marchés : ${match.EC || (match.E || []).length}`,
      `Info : ${match.SC?.I || "Aucune information supplémentaire"}`
    ].join(" · ");
    wrapExportLine(context, summaryText, 132, 1338, 810, 34);

    context.fillStyle = "#5eead4";
    context.font = "700 24px Arial";
    context.fillText("Image générée depuis la page détails Fury X One", 132, 1380);

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `fury-x-one-${match.I}.png`;
    link.click();
  } catch (error) {
    alert(`Impossible de créer l’image : ${error.message}`);
  } finally {
    state.exportLoading = false;
    if (window.location.hash === `#/prediction/${match.I}`) {
      renderPredictionDetails(match.I);
    }
  }
}

async function loadPrediction(match) {
  const key = String(match.I);
  state.predictionCache[key] = { loading: true };
  renderPredictionDetails(match.I);

  try {
    const response = await fetch("/api/prediction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ match })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    state.predictionCache[key] = { loading: false, data: payload };
  } catch (error) {
    state.predictionCache[key] = { loading: false, error: error.message };
  }

  if (window.location.hash === `#/prediction/${match.I}`) {
    renderPredictionDetails(match.I);
  }
}

async function ensureCurrentMatchPredictionContext() {
  const hash = window.location.hash || "#/";
  const [, route, id] = hash.split("/");
  if (route !== "prediction") {
    return;
  }

  const match = getMatchById(id);
  if (!match) {
    return;
  }

  const key = String(match.I);
  const cachedPrediction = state.predictionCache[key];
  if (!cachedPrediction || (!cachedPrediction.data && !cachedPrediction.loading && !cachedPrediction.error)) {
    await loadPrediction(match);
  }
}

function getCurrentPageContext() {
  const hash = window.location.hash || "#/";
  const [, route, id] = hash.split("/");
  const pageContext = {
    route: route || "home",
    pageTitle: route === "league" ? "Page ligue" : route === "prediction" ? "Page détail match" : "Accueil",
    leaguesCount: state.leagues.length,
    matchesCount: getAllMatches().length
  };
  if (route === "prediction") {
    const match = getMatchById(id);
    if (match) {
      pageContext.matchContext = {
        matchId: match.I,
        teams: `${match.O1} vs ${match.O2}`,
        league: match.LE || match.L,
        score: getScoreDisplay(match),
        status: getDisplayStatus(match),
        rawMatch: match,
        prediction: state.predictionCache[String(match.I)]?.data || null
      };
    }
  }
  if (route === "league") {
    const league = state.leagues.find((item) => String(item.id) === String(id));
    if (league) {
      pageContext.leagueContext = league;
    }
  }
  return pageContext;
}

function buildAssistantRequestPayload() {
  return {
    messages: state.assistantMessages,
    pageContext: getCurrentPageContext(),
    siteContext: {
      leagues: state.leagues,
      filteredLeagueIds: getFilteredLeagues().map((league) => league.id)
    }
  };
}


function parseAssistantCommand(content) {
  const value = String(content || "").trim().toLowerCase();
  if (!value) return null;

  if (value.includes("va dans la page coupon") || value.includes("ouvre la page coupon")) {
    return { type: "open_coupon" };
  }

  const couponMatch = value.match(/g[?e]n[?e]re moi un coupon(?: d(?:e|u)ne?| de)? cote?\s*(\d+)/i);
  if (couponMatch) {
    return { type: "generate_coupon", count: Number(couponMatch[1]) || state.couponCount };
  }

  const searchMatch = value.match(/(?:lance une recherche|donne-moi le match|donne moi le match|cherche.*match).*?(\d+)\s*min/i);
  if (searchMatch) {
    return { type: "find_match_by_start_window", minutes: Number(searchMatch[1]) };
  }

  return null;
}

function getMinutesUntilStart(match) {
  const startTimestamp = Number(match?.S || 0);
  if (!startTimestamp) return null;
  return Math.round((startTimestamp * 1000 - Date.now()) / 60000);
}

async function findBestPredictedMatchInWindow(minutesWindow) {
  const matches = getAllMatches().filter((match) => {
    const minutesUntilStart = getMinutesUntilStart(match);
    return minutesUntilStart !== null && minutesUntilStart >= 0 && minutesUntilStart <= minutesWindow;
  });

  if (!matches.length) {
    return { message: `Aucun match ne commence dans les ${minutesWindow} prochaines minutes.` };
  }

  let bestCandidate = null;
  for (const match of matches.slice(0, 12)) {
    const key = String(match.I);
    let predictionState = state.predictionCache[key];
    if (!predictionState?.data) {
      await loadPrediction(match);
      predictionState = state.predictionCache[key];
    }
    const prediction = predictionState?.data?.prediction;
    if (!prediction?.result?.prediction) {
      continue;
    }
    const confidence = getMainConfidence(prediction.result?.probabilities || {}, prediction.result?.prediction);
    if (!bestCandidate || Number(confidence) > Number(bestCandidate.confidence)) {
      bestCandidate = { match, prediction, confidence };
    }
  }

  if (!bestCandidate) {
    return { message: `Je n'ai pas trouv? de pr?diction exploitable dans les ${minutesWindow} prochaines minutes.` };
  }

  window.location.hash = `#/prediction/${bestCandidate.match.I}`;
  return {
    message: `${bestCandidate.match.O1} vs ${bestCandidate.match.O2} commence dans ${getMinutesUntilStart(bestCandidate.match)} min. Pronostic principal: ${getResultLabel(bestCandidate.prediction.result?.prediction, bestCandidate.match)} avec confiance ${bestCandidate.confidence}.`
  };
}

async function executeAssistantCommand(command) {
  if (!command) return null;

  if (command.type === "open_coupon") {
    window.location.hash = "#/coupon";
    return "J?ouvre la page coupon.";
  }

  if (command.type === "generate_coupon") {
    window.location.hash = "#/coupon";
    state.couponCount = Math.max(1, Math.min(10, Number(command.count) || state.couponCount));
    renderCouponPage();
    await generateCoupon();
    if (state.couponMatches.length > 0) {
      return `Coupon g?n?r? avec ${state.couponMatches.length} match(s).`;
    }
    return state.couponMessage || "Je n?ai pas pu g?n?rer de coupon.";
  }

  if (command.type === "find_match_by_start_window") {
    const result = await findBestPredictedMatchInWindow(command.minutes);
    return result?.message || null;
  }

  return null;
}

function legacyRenderAssistantMessages() {
  assistantMessagesEl.innerHTML = state.assistantMessages
    .map((message) => `<div class="assistant-bubble ${message.role}">${escapeHtml(message.content)}</div>`)
    .join("");
  assistantMessagesEl.scrollTop = assistantMessagesEl.scrollHeight;
}

function toggleAssistant(forceValue) {
  state.assistantOpen = typeof forceValue === "boolean" ? forceValue : !state.assistantOpen;
  assistantPanel.classList.toggle("hidden", !state.assistantOpen);
  if (state.assistantOpen) {
    renderAssistantMessages();
    assistantInput.focus();
  }
}

async function handleAssistantSubmit(event) {
  event.preventDefault();
  const content = assistantInput.value.trim();
  if (!content) return;

  state.assistantMessages.push({ role: "user", content });
  assistantInput.value = "";
  renderAssistantMessages();

  try {
    await ensureCurrentMatchPredictionContext();

    const assistantCommand = parseAssistantCommand(content);
    const localReply = await executeAssistantCommand(assistantCommand);
    if (localReply) {
      state.assistantMessages.push({ role: "assistant", content: localReply });
      renderAssistantMessages();
      return;
    }

    const response = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAssistantRequestPayload())
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    state.assistantMessages.push({ role: "assistant", content: payload.reply });
  } catch (error) {
    state.assistantMessages.push({
      role: "assistant",
      content: `Je n?ai pas pu r?pondre pour le moment : ${error.message}`
    });
  }

  renderAssistantMessages();
}



function router() {
  if (state.loading) {
    renderLoading();
    return;
  }
  if (state.error) {
    renderError(state.error);
    return;
  }

  const hash = window.location.hash || "#/";
  const [, route, id] = hash.split("/");

  if (!route) {
    renderHome();
    return;
  }
  if (route === "league") {
    renderLeague(id);
    return;
  }
  if (route === "prediction") {
    renderPredictionDetails(id);
    return;
  }
  if (route === "coupon") {
    renderCouponPage();
    return;
  }
  renderHome();
}

async function bootstrap() {
  state.loading = true;
  state.error = "";
  router();

  try {
    const [matchesResponse, healthResponse, familiesResponse] = await Promise.all([
      fetch("/api/matches"),
      fetch("/api/fifa/health"),
      fetch("/api/fifa/families")
    ]);
    if (!matchesResponse.ok) {
      throw new Error(`HTTP ${matchesResponse.status}`);
    }
    const payload = await matchesResponse.json();
    state.leagues = normalizeLeagues(Array.isArray(payload?.Value) ? payload.Value : []);
    state.predictionApi.health = healthResponse.ok ? await healthResponse.json() : null;
    const familiesPayload = familiesResponse.ok ? await familiesResponse.json() : {};
    state.predictionApi.families = familiesPayload?.families || {};
    const familyNames = Object.keys(state.predictionApi.families);
    const leaguesPayloads = await Promise.all(
      familyNames.map((familyName) =>
        fetch(`/api/fifa/leagues/${encodeURIComponent(familyName)}`)
          .then((response) => response.ok ? response.json() : null)
          .catch(() => null)
      )
    );
    state.predictionApi.leaguesByFamily = {};
    leaguesPayloads.forEach((familyPayload, index) => {
      state.predictionApi.leaguesByFamily[familyNames[index]] = familyPayload?.leagues || [];
    });
  } catch (error) {
    state.error = `Impossible de charger l’API live : ${error.message}`;
  } finally {
    state.loading = false;
    router();
  }
}

window.addEventListener("hashchange", router);
window.addEventListener("load", bootstrap);
window.bootstrap = bootstrap;
window.setLeagueFilter = setLeagueFilter;
window.exportMatchPredictionImage = exportMatchPredictionImage;
window.exportMatchesToCSV = exportMatchesToCSV;
window.generatePDFReport = generatePDFReport;
window.updateCouponCount = updateCouponCount;
window.setCouponThreshold = setCouponThreshold;
window.toggleCouponLeagueSelection = toggleCouponLeagueSelection;
window.generateCoupon = generateCoupon;
window.exportCouponImage = exportCouponImage;

assistantToggle.addEventListener("click", () => toggleAssistant());
assistantClose.addEventListener("click", () => toggleAssistant(false));
assistantForm.addEventListener("submit", handleAssistantSubmit);
renderAssistantMessages();

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function escapeClassToken(value) {
  const sanitized = String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  return sanitized || "unknown";
}

function encodeRouteSegment(value) {
  return encodeURIComponent(String(value ?? ""));
}

function exportMatchesToCSV(matches) {
  const headers = [
    "ID Match",
    "Équipe 1",
    "Équipe 2",
    "Ligue",
    "Pays",
    "Statut",
    "Score",
    "Début",
    "Marchés"
  ];

  const rows = matches.map(match => [
    match.I,
    match.O1,
    match.O2,
    match.LE || match.L,
    match.CN || match.CE,
    getDisplayStatus(match),
    getScoreDisplay(match),
    formatTimestamp(match.S),
    (match.E || []).length
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map(row => row.map(cell => `"${String(cell || "").replace(/"/g, '""')}"`).join(","))
  ].join("\n");

  const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `fury-x-one-matches-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function generatePDFReport(matches) {
  const canvas = document.createElement("canvas");
  canvas.width = 1240;
  canvas.height = 1754;
  const context = canvas.getContext("2d");

  const background = context.createLinearGradient(0, 0, 0, canvas.height);
  background.addColorStop(0, "#07101d");
  background.addColorStop(0.5, "#0b1324");
  background.addColorStop(1, "#0b1020");
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "#5eead4";
  context.font = "bold 36px Arial";
  context.fillText("FURY X ONE - RAPPORT", 50, 80);

  context.fillStyle = "#f5f7fb";
  context.font = "bold 28px Arial";
  const date = new Date().toLocaleString("fr-FR", {
    dateStyle: "full",
    timeStyle: "short"
  });
  context.fillText(`Généré le: ${date}`, 50, 130);

  context.fillStyle = "#9fb0cc";
  context.font = "24px Arial";
  context.fillText(`Total matchs: ${matches.length}`, 50, 180);
  context.fillText(`En direct: ${matches.filter(m => m.ICY).length}`, 50, 220);
  context.fillText(`À venir: ${matches.filter(m => m.GNS).length}`, 50, 260);

  let y = 320;
  const matchesPerPage = 15;
  const matchesToShow = matches.slice(0, matchesPerPage);

  context.fillStyle = "#ecfeff";
  context.font = "bold 20px Arial";
  context.fillText("MATCHS PRINCIPAUX", 50, y);
  y += 40;

  matchesToShow.forEach((match, index) => {
    if (y > 1650) return;

    context.fillStyle = "rgba(255, 255, 255, 0.05)";
    roundRect(context, 50, y - 10, 1140, 70, 10, true, false);

    context.fillStyle = "#f5f7fb";
    context.font = "bold 18px Arial";
    context.fillText(`${match.O1} vs ${match.O2}`, 70, y + 15);

    context.fillStyle = "#9fb0cc";
    context.font = "16px Arial";
    context.fillText(`${match.LE || match.L} · ${getDisplayStatus(match)}`, 70, y + 40);

    context.fillStyle = "#5eead4";
    context.font = "bold 16px Arial";
    context.fillText(getScoreDisplay(match), 1100, y + 25);

    y += 90;
  });

  context.fillStyle = "#5eead4";
  context.font = "16px Arial";
  context.fillText("Rapport généré automatiquement par Fury X One", 50, 1720);

  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `fury-x-one-report-${Date.now()}.png`;
  link.click();
}


function renderHome() {
  const matches = getAllMatches();
  const filteredLeagues = getFilteredLeagues();
  const filteredMatches = filteredLeagues.flatMap((league) => league.matches);
  const statusSummary = getMatchStatusSummary(filteredMatches);
  const filterOptions = getLeagueFilterOptions();

  app.innerHTML = `
    <section class="hero hero-home">
      <h2>Accueil</h2>
      <p>Les ligues et matchs affichés viennent de l’API live 888starz. Ouvrez les détails d’un match pour voir ses informations et ses marchés.</p>
      <div class="stats">
        <div class="stat"><span>Ligues</span><strong>${escapeHtml(filteredLeagues.length)}</strong></div>
        <div class="stat"><span>Matchs</span><strong>${escapeHtml(filteredMatches.length)}</strong></div>
        <div class="stat"><span>En direct</span><strong>${escapeHtml(matches.filter((match) => match.ICY).length)}</strong></div>
      </div>
      <div class="actions">
        <a class="button" href="#/coupon">Générateur de Coupons</a>
      </div>
    </section>

    <section class="toolbar">
      <div class="card">
        <h2>Filtres des ligues</h2>
        <div class="filter-row">
          ${filterOptions.map((option) => `<button class="filter-chip ${state.activeLeagueFilter === option.id ? "active" : ""}" onclick="setLeagueFilter('${option.id}')">${escapeHtml(option.label)}</button>`).join("")}
        </div>
      </div>
    </section>

    <section class="status-grid">
      <div class="card">
        <h2>Secteur des statuts de match</h2>
        <div class="status-row">
          <div class="status-card"><span>Total</span><strong>${escapeHtml(statusSummary.total)}</strong></div>
          <div class="status-card"><span>Pas commencés</span><strong>${escapeHtml(statusSummary.notStarted)}</strong></div>
          <div class="status-card"><span>En direct</span><strong>${escapeHtml(statusSummary.live)}</strong></div>
          <div class="status-card"><span>Mi-temps</span><strong>${escapeHtml(statusSummary.halftime)}</strong></div>
          <div class="status-card"><span>Terminés</span><strong>${escapeHtml(statusSummary.finishedLike)}</strong></div>
        </div>
      </div>
    </section>

    <section class="section-block">
      <div class="section-heading">
        <h2>Ligues</h2>
        <p class="muted">Choisis une ligue pour voir ses matchs en direct et ses marchés.</p>
      </div>
      <div class="grid leagues">
        ${filteredLeagues.map(renderLeagueCard).join("")}
      </div>
    </section>
  `;
}

function renderCouponPage() {
  app.innerHTML = `
    <section class="hero">
      <h2>Générateur de Coupons</h2>
      <p>Génère automatiquement des coupons de prédictions basés sur l'API FIFA.</p>
    </section>

    <section class="card">
      <h3>Configuration du Coupon</h3>
      <div class="coupon-config">
        <div class="config-row">
          <label>Nombre de matchs:</label>
          <select id="coupon-count" onchange="updateCouponCount(this.value)">
            <option value="1" ${state.couponCount === 1 ? 'selected' : ''}>1 match</option>
            <option value="2" ${state.couponCount === 2 ? 'selected' : ''}>2 matchs</option>
            <option value="3" ${state.couponCount === 3 ? 'selected' : ''}>3 matchs</option>
            <option value="4" ${state.couponCount === 4 ? 'selected' : ''}>4 matchs</option>
            <option value="5" ${state.couponCount === 5 ? 'selected' : ''}>5 matchs</option>
            <option value="6" ${state.couponCount === 6 ? 'selected' : ''}>6 matchs</option>
            <option value="7" ${state.couponCount === 7 ? 'selected' : ''}>7 matchs</option>
            <option value="8" ${state.couponCount === 8 ? 'selected' : ''}>8 matchs</option>
            <option value="9" ${state.couponCount === 9 ? 'selected' : ''}>9 matchs</option>
            <option value="10" ${state.couponCount === 10 ? 'selected' : ''}>10 matchs</option>
          </select>
        </div>
        <div class="config-row">
          <label>Seuil de confiance:</label>
          <div class="threshold-selector">
            <button class="threshold-btn ${state.couponThreshold === 'safe' ? 'active' : ''}" onclick="setCouponThreshold('safe')">SAFE</button>
            <button class="threshold-btn ${state.couponThreshold === 'super_safe' ? 'active' : ''}" onclick="setCouponThreshold('super_safe')">SUPER SAFE</button>
            <button class="threshold-btn ${state.couponThreshold === 'aggressive' ? 'active' : ''}" onclick="setCouponThreshold('aggressive')">AGGRESSIVE</button>
          </div>
        </div>
        <div class="config-row">
          <label>Ligues ? inclure:</label>
          <div class="coupon-league-panel">
            <button class="button button-secondary" type="button" onclick="toggleCouponLeaguePanel()">
              ${state.couponLeaguePanelOpen ? "Masquer les ligues" : "Choisir les ligues"}
              ${state.couponLeagueSelection.includes("all") ? " ? Toutes" : ` ? ${state.couponLeagueSelection.length} s?lectionn?e(s)`}
            </button>
            <div class="filter-row ${state.couponLeaguePanelOpen ? "" : "hidden"}">
              <button class="filter-chip ${state.couponLeagueSelection.includes('all') ? 'active' : ''}" type="button" onclick="toggleCouponLeagueSelection('all')">Toutes</button>
              ${state.leagues.map((league) => `
                <button
                  class="filter-chip ${state.couponLeagueSelection.includes(String(league.id)) ? 'active' : ''}"
                  type="button"
                  onclick="toggleCouponLeagueSelection('${escapeAttribute(league.id)}')"
                >${escapeHtml(league.name)}</button>
              `).join("")}
            </div>
          </div>
        </div>
        <div class="config-row">
          <button class="button" type="button" data-action="generate-coupon" onclick="generateCoupon()" ${state.couponGenerating ? "disabled" : ""}>${state.couponGenerating ? "G?n?ration..." : "G?n?rer le Coupon"}</button>
        </div>
      </div>
    </section>

    <section class="card">
      <h3>Coupon Généré</h3>
      ${state.couponMatches.length > 0 ? `
        <div class="coupon-matches">
          ${state.couponMatches.map((item, index) => `
            <div class="coupon-match-item">
              <div class="coupon-match-header">
                <span class="coupon-match-number">#${index + 1}</span>
                <span class="coupon-match-teams">${escapeHtml(item.match.O1)} vs ${escapeHtml(item.match.O2)}</span>
              </div>
              <div class="coupon-prediction">
                <span class="prediction-label">Prédiction:</span>
                <span class="prediction-value">${escapeHtml(item.prediction)}</span>
                <span class="prediction-confidence">Confiance: ${escapeHtml(item.confidence)}</span>
              </div>
            </div>
          `).join("")}
        </div>
        <div class="coupon-actions">
          <button class="button" type="button" data-action="export-coupon" onclick="exportCouponImage()">Cr?er l'image du Coupon</button>
        </div>
      ` : `<p class="muted">${escapeHtml(state.couponMessage || 'Cliquez sur "G?n?rer le Coupon" pour cr?er un nouveau coupon.')}</p>`}
    </section>
  `;
}

function updateCouponCount(value) {
  state.couponCount = parseInt(value);
  renderCouponPage();
}

function setCouponThreshold(threshold) {
  state.couponThreshold = threshold;
  renderCouponPage();
}

function toggleCouponLeagueSelection(leagueId) {
  const value = String(leagueId);
  if (value === "all") {
    state.couponLeagueSelection = ["all"];
    renderCouponPage();
    return;
  }

  const nextSelection = new Set((state.couponLeagueSelection || []).filter((item) => item !== "all"));
  if (nextSelection.has(value)) {
    nextSelection.delete(value);
  } else {
    nextSelection.add(value);
  }

  state.couponLeagueSelection = nextSelection.size ? Array.from(nextSelection) : ["all"];
  renderCouponPage();
}

function toggleCouponLeaguePanel() {
  state.couponLeaguePanelOpen = !state.couponLeaguePanelOpen;
  renderCouponPage();
}

function getCouponEligibleLeagues() {
  if (!Array.isArray(state.couponLeagueSelection) || state.couponLeagueSelection.includes("all")) {
    return state.leagues;
  }
  const selectedIds = new Set(state.couponLeagueSelection.map((item) => String(item)));
  return state.leagues.filter((league) => selectedIds.has(String(league.id)));
}
async function generateCoupon() {
  const leagues = getCouponEligibleLeagues();
  const matches = leagues.flatMap((league) => league.matches);
  const availableMatches = matches.filter(m => isPrematchState(m) || isLiveState(m));

  if (state.couponGenerating) {
    return;
  }

  state.couponGenerating = true;
  state.couponMessage = "";
  renderCouponPage();

  if (!leagues.length) {
    state.couponMatches = [];
    state.couponMessage = "Aucune ligue sélectionnée pour le coupon.";
    state.couponGenerating = false;
    renderCouponPage();
    return;
  }

  if (availableMatches.length < state.couponCount) {
    state.couponMatches = [];
    state.couponMessage = "Pas assez de matchs disponibles pour g?n?rer ce coupon.";
    state.couponGenerating = false;
    renderCouponPage();
    return;
  }

  const thresholdConfig = {
    safe: { minConfidence: 65, scanCount: 24 },
    super_safe: { minConfidence: 78, scanCount: 28 },
    aggressive: { minConfidence: 52, scanCount: 32 }
  };

  const config = thresholdConfig[state.couponThreshold];
  const selectedMatches = availableMatches
    .slice()
    .sort((left, right) => Number(left.S || 0) - Number(right.S || 0))
    .slice(0, Math.min(availableMatches.length, config.scanCount));

  state.couponMatches = [];
  const candidates = [];

  for (const match of selectedMatches) {
    try {
      const response = await fetch("/api/prediction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ match })
      });
      const data = await response.json();
      const prediction = data.prediction;
      const rawPrediction = prediction?.raw || data.raw || prediction;
      const probabilities = prediction.result?.probabilities || {};
      const confidence = getMainConfidence(probabilities, prediction.result?.prediction);

      if (confidence >= config.minConfidence) {
        candidates.push({
          match,
          prediction: getResultLabel(prediction.result?.prediction, match),
          confidence,
          rawPrediction,
          family: prediction.family || getPredictionFamilyForLeagueName(match.LE || match.L)
        });
      }
    } catch (error) {
      console.error("Error loading prediction:", error);
    }
  }

  candidates.sort((left, right) => Number(right.confidence) - Number(left.confidence));
  state.couponMatches = candidates.slice(0, state.couponCount);

  if (state.couponMatches.length === 0 && candidates.length === 0) {
    const fallbackCandidates = [];
    for (const match of selectedMatches.slice(0, Math.min(selectedMatches.length, 12))) {
      const key = String(match.I);
      const cachedPrediction = state.predictionCache[key];
      const prediction = cachedPrediction?.data?.prediction;
      if (!prediction?.result?.prediction) {
        continue;
      }
      const confidence = getMainConfidence(prediction.result?.probabilities || {}, prediction.result?.prediction);
      fallbackCandidates.push({
        match,
        prediction: getResultLabel(prediction.result?.prediction, match),
        confidence,
        rawPrediction: prediction?.raw || cachedPrediction?.data?.raw || prediction,
        family: prediction.family || getPredictionFamilyForLeagueName(match.LE || match.L)
      });
    }
    fallbackCandidates.sort((left, right) => Number(right.confidence) - Number(left.confidence));
    state.couponMatches = fallbackCandidates.slice(0, state.couponCount);
  }

  if (state.couponMatches.length === 0) {
    state.couponMessage = "Aucun match ne correspond au seuil de confiance s?lectionn?. Essayez un seuil plus bas.";
  } else if (state.couponMatches.length < state.couponCount) {
    state.couponMessage = `Seulement ${state.couponMatches.length} match(s) correspondent au seuil ${state.couponThreshold}.`;
  }

  state.couponGenerating = false;
  renderCouponPage();
}

async function exportCouponImage() {
  if (state.couponMatches.length === 0) {
    alert("Aucun coupon à exporter.");
    return;
  }

  state.exportLoading = true;
  renderCouponPage();

  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1200 + (state.couponMatches.length * 200);

    const context = canvas.getContext("2d");
    const background = context.createLinearGradient(0, 0, 0, canvas.height);
    background.addColorStop(0, "#07101d");
    background.addColorStop(0.55, "#0b1324");
    background.addColorStop(1, "#0b1020");
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const glow = context.createRadialGradient(860, 180, 30, 860, 180, 360);
    glow.addColorStop(0, "rgba(94, 234, 212, 0.26)");
    glow.addColorStop(1, "rgba(94, 234, 212, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = "rgba(16, 27, 49, 0.94)";
    context.strokeStyle = "rgba(255, 255, 255, 0.08)";
    context.lineWidth = 2;
    roundRect(context, 56, 52, 968, canvas.height - 104, 36, true, true);

    context.fillStyle = "#5eead4";
    context.font = "700 30px Arial";
    context.fillText("FURY X ONE - COUPON", 96, 118);

    context.fillStyle = "#f5f7fb";
    context.font = "900 42px Arial";
    context.fillText(`Coupon ${state.couponCount} Matchs`, 96, 180);

    context.fillStyle = "#9fb0cc";
    context.font = "24px Arial";
    context.fillText(`Seuil: ${state.couponThreshold.toUpperCase()}`, 96, 220);

    let yPos = 280;
    state.couponMatches.forEach((item, index) => {
      context.fillStyle = "rgba(94, 234, 212, 0.16)";
      context.strokeStyle = "rgba(94, 234, 212, 0.32)";
      roundRect(context, 96, yPos, 888, 180, 20, true, true);

      context.fillStyle = "#ecfeff";
      context.font = "700 22px Arial";
      context.fillText(`#${index + 1} - ${item.match.O1} vs ${item.match.O2}`, 132, yPos + 40);

      context.fillStyle = "#ffffff";
      context.font = "900 36px Arial";
      context.fillText(item.prediction, 132, yPos + 90);

      context.fillStyle = "#ecfeff";
      context.font = "700 20px Arial";
      context.fillText(`Confiance: ${item.confidence}`, 132, yPos + 130);

      yPos += 200;
    });

    context.fillStyle = "#5eead4";
    context.font = "700 24px Arial";
    context.fillText("Coupon généré depuis Fury X One", 96, canvas.height - 60);

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `fury-x-one-coupon-${Date.now()}.png`;
    link.click();
  } catch (error) {
    alert(`Impossible de créer l'image : ${error.message}`);
  } finally {
    state.exportLoading = false;
    renderCouponPage();
  }
}

function renderLeagueCard(league) {
  const leagueId = encodeRouteSegment(league.id);
  const summary = getMatchStatusSummary(league.matches);
  return `
    <article class="card league-card">
      <div class="league-card-top">
        <div>
          <span class="mini-badge">Ligue</span>
          <h3>${escapeHtml(league.name)}</h3>
        </div>
        <span class="league-card-count">${escapeHtml(league.matches.length)} matchs</span>
      </div>
      <div class="league-meta">
        <span class="muted">Pays: ${escapeHtml(league.country)}</span>
        <span class="muted">Sport ID: ${escapeHtml(league.sportId)}</span>
      </div>
      <div class="league-card-stats">
        <div class="league-stat-chip"><span>Live</span><strong>${escapeHtml(summary.live)}</strong></div>
        <div class="league-stat-chip"><span>A venir</span><strong>${escapeHtml(summary.notStarted)}</strong></div>
        <div class="league-stat-chip"><span>Termines</span><strong>${escapeHtml(summary.finishedLike)}</strong></div>
      </div>
      <div class="actions">
        <a class="button" href="#/league/${leagueId}">Voir les matchs</a>
      </div>
    </article>
  `;
}

function getOrderedMatches(matches) {
  return [...matches].sort((left, right) => {
    const leftPriority = isLiveState(left) ? 0 : isPrematchState(left) ? 1 : isHalftimeState(left) ? 2 : 3;
    const rightPriority = isLiveState(right) ? 0 : isPrematchState(right) ? 1 : isHalftimeState(right) ? 2 : 3;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    return Number(left.S || 0) - Number(right.S || 0);
  });
}

function formatOddValue(value) {
  const numericValue = Number(value);
  if (value === undefined || value === null || Number.isNaN(numericValue)) {
    return "--";
  }
  return numericValue.toFixed(2);
}

function formatMarketLine(value) {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) {
    return String(value);
  }
  return numericValue > 0 ? `+${numericValue}` : `${numericValue}`;
}

function getTeamContext(match, side) {
  if (side === "home") {
    return {
      name: match.O1,
      city: match.O1CT || match.CN || match.CE || "Virtuel"
    };
  }
  return {
    name: match.O2,
    city: match.O2CT || match.CN || match.CE || "Virtuel"
  };
}

function findPrimaryMarket(match, predicate) {
  return (match.E || []).find((item) => !item.B && item.CE === 1 && predicate(item))
    || (match.E || []).find((item) => !item.B && predicate(item))
    || null;
}

function getThreeWayOdds(match) {
  return [
    {
      key: "home",
      label: "1",
      subtitle: "Domicile",
      value: findPrimaryMarket(match, (item) => item.T === 1)?.C
    },
    {
      key: "draw",
      label: "X",
      subtitle: "Nul",
      value: findPrimaryMarket(match, (item) => item.T === 3)?.C
    },
    {
      key: "away",
      label: "2",
      subtitle: "Exterieur",
      value: findPrimaryMarket(match, (item) => item.T === 2)?.C
    }
  ];
}

function getMatchInsightMarkets(match) {
  const totalMarket = findPrimaryMarket(match, (item) => item.G === 17 && (item.T === 9 || item.T === 10));
  const bttsMarket = findPrimaryMarket(match, (item) => item.G === 62 && (item.T === 13 || item.T === 14));
  const handicapMarket = findPrimaryMarket(match, (item) => item.G === 2 && (item.T === 7 || item.T === 8));
  const marketCount = match.EC || (match.E || []).length;

  return [
    totalMarket
      ? {
          label: `${totalMarket.T === 9 ? "Plus" : "Moins"} ${formatMarketLine(totalMarket.P)}`,
          value: formatOddValue(totalMarket.C)
        }
      : null,
    bttsMarket
      ? {
          label: bttsMarket.T === 13 ? "BTTS Oui" : "BTTS Non",
          value: formatOddValue(bttsMarket.C)
        }
      : null,
    handicapMarket
      ? {
          label: `${handicapMarket.T === 7 ? "H1" : "H2"} ${formatMarketLine(handicapMarket.P)}`,
          value: formatOddValue(handicapMarket.C)
        }
      : null,
    {
      label: "Marches ouverts",
      value: String(marketCount)
    }
  ].filter(Boolean).slice(0, 4);
}

function renderOutcomeOdds(match) {
  return getThreeWayOdds(match)
    .map((odd) => `
      <div class="sportsbook-odd-box sportsbook-odd-box-${escapeClassToken(odd.key)}">
        <span class="sportsbook-odd-label">${escapeHtml(odd.label)}</span>
        <strong>${escapeHtml(formatOddValue(odd.value))}</strong>
        <small>${escapeHtml(odd.subtitle)}</small>
      </div>
    `)
    .join("");
}

function renderMatchInsights(match) {
  return getMatchInsightMarkets(match)
    .map((item) => `
      <div class="market-signal">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(item.value)}</strong>
      </div>
    `)
    .join("");
}

function renderLeagueSpotlight(match) {
  return `
    <div class="sportsbook-spotlight">
      <div class="sportsbook-spotlight-copy">
        <span class="sportsbook-spotlight-label">A l'affiche</span>
        <strong>${escapeHtml(match.O1)} vs ${escapeHtml(match.O2)}</strong>
        <p>${escapeHtml(getCompactMatchInfo(match))}</p>
      </div>
      <div class="sportsbook-spotlight-odds">
        ${renderOutcomeOdds(match)}
      </div>
    </div>
  `;
}

function renderLeague(leagueId) {
  const league = state.leagues.find((item) => String(item.id) === String(leagueId));
  if (!league) {
    app.innerHTML = `<div class="card"><h2>Ligue introuvable</h2><a class="button-secondary" href="#/">Retour</a></div>`;
    return;
  }

  const orderedMatches = getOrderedMatches(league.matches);
  const summary = getMatchStatusSummary(orderedMatches);
  const spotlightMatch = orderedMatches[0] || null;

  app.innerHTML = `
    <section class="hero hero-league">
      <div class="sportsbook-hero-top">
        <div>
          <span class="mini-badge">Match Center</span>
          <h2>${escapeHtml(league.name)}</h2>
          <p>Une presentation premium inspiree des applications de paris sportif, avec des affiches plus fortes, des cotes visibles et un acces rapide aux predictions.</p>
        </div>
        <div class="sportsbook-hero-side">
          <span class="sportsbook-country">${escapeHtml(league.country)}</span>
          <div class="actions">
            <a class="button-secondary" href="#/">Retour a l'accueil</a>
          </div>
        </div>
      </div>
      <div class="sportsbook-summary-grid">
        <div class="sportsbook-summary-card"><span>Affiches</span><strong>${escapeHtml(orderedMatches.length)}</strong></div>
        <div class="sportsbook-summary-card"><span>En direct</span><strong>${escapeHtml(summary.live)}</strong></div>
        <div class="sportsbook-summary-card"><span>A venir</span><strong>${escapeHtml(summary.notStarted)}</strong></div>
        <div class="sportsbook-summary-card"><span>Mi-temps</span><strong>${escapeHtml(summary.halftime)}</strong></div>
      </div>
      ${spotlightMatch ? renderLeagueSpotlight(spotlightMatch) : ""}
    </section>

    <section class="section-block">
      <div class="section-heading">
        <h2>Matchs</h2>
        <p class="muted">Chaque carte affiche le score, le statut, les cotes 1X2 et des marches cles dans un format premium.</p>
      </div>
    </section>

    <section class="matches matches-sportsbook">
      ${orderedMatches.map(renderMatchCard).join("")}
    </section>
  `;
}

function renderMatchCard(match) {
  const scoreDisplay = getScoreDisplay(match);
  const matchId = encodeRouteSegment(match.I);
  const homeTeam = getTeamContext(match, "home");
  const awayTeam = getTeamContext(match, "away");
  const marketsCount = match.EC || (match.E || []).length;
  return `
    <article class="match-card match-card-premium">
      <div class="match-card-top">
        <div class="pill-row">
          <span class="pill ${getStatusClass(match)}">${escapeHtml(getDisplayStatus(match))}</span>
          <span class="pill">${escapeHtml(getDisplayPhase(match))}</span>
          <span class="pill pill-soft">${escapeHtml(match.LE || match.L || "Ligue virtuelle")}</span>
        </div>
        <div class="match-kickoff-block">
          <span>Coup d'envoi</span>
          <strong>${escapeHtml(formatTimestamp(match.S))}</strong>
        </div>
      </div>

      <div class="sportsbook-board">
        <div class="team-stack">
          <span class="team-side-label">Equipe 1</span>
          <h3>${escapeHtml(homeTeam.name)}</h3>
          <p class="muted">${escapeHtml(homeTeam.city)}</p>
        </div>
        <div class="board-center">
          <div class="score ${hasLiveScore(match) ? "" : "score-muted"}">${escapeHtml(scoreDisplay)}</div>
          <p class="match-info-line">${escapeHtml(getCompactMatchInfo(match))}</p>
        </div>
        <div class="team-stack team-stack-right">
          <span class="team-side-label">Equipe 2</span>
          <h3>${escapeHtml(awayTeam.name)}</h3>
          <p class="muted">${escapeHtml(awayTeam.city)}</p>
        </div>
      </div>

      <div class="sportsbook-odds-strip">
        ${renderOutcomeOdds(match)}
      </div>

      <div class="market-signal-row">
        ${renderMatchInsights(match)}
      </div>

      <div class="match-card-footer">
        <div class="match-card-volume">
          <strong>${escapeHtml(marketsCount)}</strong>
          <span>marches disponibles</span>
        </div>
        <div class="actions">
          <a class="button" href="#/prediction/${matchId}">Analyser le match</a>
        </div>
      </div>
    </article>
  `;
}

function renderPredictionDetails(matchId) {
  const match = getMatchById(matchId);
  if (!match) {
    app.innerHTML = `<div class="card"><h2>Match introuvable</h2><a class="button-secondary" href="#/">Retour</a></div>`;
    return;
  }

  const advancedTotals = getAdvancedTotals(match);
  const advancedHandicaps = getAdvancedHandicaps(match);
  const primaryMarkets = (match.E || []).filter((item) => [1, 2, 3, 9, 10, 13, 14, 180, 181].includes(item.T));
  const scoreDisplay = getScoreDisplay(match);
  const predictionState = state.predictionCache[String(match.I)] || { loading: true };
  const leagueId = encodeRouteSegment(match.LI);
  const exportMatchId = escapeAttribute(match.I);

  app.innerHTML = `
    <section class="hero hero-detail">
      <div class="detail-header-top">
        <span class="mini-badge">Détail match</span>
        <span class="muted">${escapeHtml(match.LE || match.L)}</span>
      </div>
      <h2>${escapeHtml(match.O1)} vs ${escapeHtml(match.O2)}</h2>
      <div class="detail-score-row">
        <div class="detail-team">${escapeHtml(match.O1)}</div>
        <div class="detail-score ${hasLiveScore(match) ? "" : "score-muted"}">${escapeHtml(scoreDisplay)}</div>
        <div class="detail-team detail-team-right">${escapeHtml(match.O2)}</div>
      </div>
      <div class="pill-row">
        <span class="pill ${getStatusClass(match)}">${escapeHtml(getDisplayStatus(match))}</span>
        <span class="pill">${escapeHtml(getDisplayPhase(match))}</span>
        <span class="pill">${escapeHtml(getDisplayTime(match))}</span>
      </div>
      <div class="actions">
        <a class="button-secondary" href="#/league/${leagueId}">Retour à la ligue</a>
        <button class="button export-image-button" type="button" data-export-match-id="${exportMatchId}">
          ${state.exportLoading ? "Création..." : "Créer l'image"}
        </button>
      </div>
    </section>

    <section class="prediction-layout prediction-layout-top">
      <article class="prediction-box">
        <h3>Prédiction</h3>
        <p class="muted">API réelle · ${escapeHtml(getDisplayStatus(match))} · ${escapeHtml(getDisplayTime(match))}</p>
        ${renderPredictionModule(match, predictionState)}
      </article>

      <article class="prediction-box">
        <h3>${escapeHtml(match.O1)} <span class="muted">vs</span> ${escapeHtml(match.O2)}</h3>
        <p class="muted">${escapeHtml(getCompactMatchInfo(match))}</p>
        <div class="prediction-grid">
          <div class="market-item"><strong>Score actuel</strong><p>${escapeHtml(scoreDisplay)}</p></div>
          <div class="market-item"><strong>Début</strong><p>${escapeHtml(formatTimestamp(match.S))}</p></div>
          <div class="market-item"><strong>Ligue</strong><p>${escapeHtml(match.LE || match.L || "Inconnue")}</p></div>
          <div class="market-item"><strong>Pays</strong><p>${escapeHtml(match.CN || match.CE || "Inconnu")}</p></div>
          <div class="market-item"><strong>Marchés</strong><p>${escapeHtml(match.EC || (match.E || []).length)}</p></div>
          <div class="market-item"><strong>ID match</strong><p>${escapeHtml(match.I)}</p></div>
          <div class="market-item"><strong>Info match</strong><p>${escapeHtml(match.SC?.I || "Aucune information supplémentaire")}</p></div>
        </div>
      </article>
    </section>

    <section class="card section-card">
      <h3>Marchés principaux</h3>
      <div class="market-list">
        ${primaryMarkets.map((item) => `
          <div class="market-item">
            <strong>${escapeHtml(betTypeLabels[item.T] || `Type ${item.T}`)}</strong>
            <p>Groupe: ${escapeHtml(marketGroupLabels[item.G] || item.G)}</p>
            <p>${item.P !== undefined ? `Ligne: ${escapeHtml(item.P)}` : "Sans ligne"}</p>
            <p>Cote: ${escapeHtml(item.C)}</p>
          </div>
        `).join("")}
      </div>
    </section>

    <section class="card section-card">
      <h3>Marchés avancés - Total buts</h3>
      <div class="market-list">
        ${advancedTotals.length ? advancedTotals.map((item) => `
          <div class="market-item">
            <strong>${escapeHtml(betTypeLabels[item.T] || `Type ${item.T}`)}</strong>
            <p>Ligne: ${escapeHtml(item.P)}</p>
            <p>Cote: ${escapeHtml(item.C)}</p>
          </div>
        `).join("") : "<p class='muted'>Aucun marché avancé disponible.</p>"}
      </div>
    </section>

    <section class="card section-card">
      <h3>Marchés avancés - Handicap</h3>
      <div class="market-list">
        ${advancedHandicaps.length ? advancedHandicaps.map((item) => `
          <div class="market-item">
            <strong>${escapeHtml(betTypeLabels[item.T] || `Type ${item.T}`)}</strong>
            <p>Groupe: ${escapeHtml(marketGroupLabels[item.G] || item.G)}</p>
            <p>${item.P !== undefined ? `Ligne: ${escapeHtml(item.P)}` : "Sans ligne"}</p>
            <p>Cote: ${escapeHtml(item.C)}</p>
          </div>
        `).join("") : "<p class='muted'>Aucun handicap avancé disponible.</p>"}
      </div>
    </section>
  `;

  const cacheKey = String(match.I);
  const cachedPrediction = state.predictionCache[cacheKey];
  if (!cachedPrediction || (!cachedPrediction.loading && !cachedPrediction.data && !cachedPrediction.error)) {
    loadPrediction(match);
  }
}

function renderPredictionModule(match, predictionState) {
  if (predictionState.loading) {
    return `<div class="market-item"><p>Chargement de la prédiction...</p></div>`;
  }

  if (predictionState.error) {
    return `<div class="market-item"><strong>Erreur</strong><p>${escapeHtml(predictionState.error)}</p></div>`;
  }

  const prediction = predictionState.data?.prediction;
  if (!prediction) {
    return `<div class="market-item"><p>Aucune prédiction disponible.</p></div>`;
  }

  const rawPrediction = prediction.raw || predictionState.data?.raw || prediction;
  const family = prediction.family || rawPrediction.family || "-";
  const resultLabel = getResultLabel(prediction.result?.prediction, match);
  const exactScore = prediction.exact_score?.prediction || "-";
  const totalGoals = prediction.total_goals?.prediction ?? "-";
  const parity = prediction.parity?.prediction || "-";
  const probabilities = prediction.result?.probabilities || {};
  const confidence = getMainConfidence(probabilities, prediction.result?.prediction);
  const handicapRecommendation = prediction.handicap?.recommended || null;
  const handicapLabel = handicapRecommendation
    ? `${formatHandicapLabel(handicapRecommendation.line, handicapRecommendation.prediction, match)} (${getMainConfidence(handicapRecommendation.probabilities || {}, handicapRecommendation.prediction)})`
    : "-";

  const x1x2 = rawPrediction.predictions?.["1x2"] || {};
  const totalGoalsData = rawPrediction.predictions?.total_goals || {};
  const handicapData = rawPrediction.predictions?.handicap || {};
  const parityData = rawPrediction.predictions?.parity || {};
  const exactScoreData = rawPrediction.predictions?.exact_score || {};

  return `
    <div class="prediction-full-display">
      <div class="prediction-family-badge">Famille: ${escapeHtml(family)}</div>
      
      <div class="prediction-exact-score">
        <div class="prediction-exact-score-label">Score Exact Prédit</div>
        <div class="prediction-exact-score-value">${escapeHtml(exactScoreData.prediction || exactScore)}</div>
      </div>

      <div class="prediction-total-goals">
        <div class="prediction-total-goals-label">Total Buts Prédit</div>
        <div class="prediction-total-goals-value">${escapeHtml(formatPredictionNumber(totalGoalsData.predicted || totalGoals))}</div>
      </div>

      <div class="prediction-section">
        <div class="prediction-section-title">Résultat 1X2</div>
        <div class="prediction-1x2-grid">
          <div class="prediction-1x2-item ${x1x2.home > x1x2.away && x1x2.home > x1x2.draw ? 'winner' : ''}">
            <div class="prediction-1x2-label">Domicile</div>
            <div class="prediction-1x2-value">H</div>
            <div class="prediction-1x2-percent">${escapeHtml(formatPercent(x1x2.home))}</div>
          </div>
          <div class="prediction-1x2-item ${x1x2.draw > x1x2.home && x1x2.draw > x1x2.away ? 'winner' : ''}">
            <div class="prediction-1x2-label">Nul</div>
            <div class="prediction-1x2-value">D</div>
            <div class="prediction-1x2-percent">${escapeHtml(formatPercent(x1x2.draw))}</div>
          </div>
          <div class="prediction-1x2-item ${x1x2.away > x1x2.home && x1x2.away > x1x2.draw ? 'winner' : ''}">
            <div class="prediction-1x2-label">Extérieur</div>
            <div class="prediction-1x2-value">A</div>
            <div class="prediction-1x2-percent">${escapeHtml(formatPercent(x1x2.away))}</div>
          </div>
        </div>
      </div>

      <div class="prediction-section">
        <div class="prediction-section-title">Over/Under Dynamique</div>
        <div class="prediction-overunder-grid">
          ${Object.entries(totalGoalsData.over_under || {}).slice(0, 6).map(([threshold, probs]) => `
            <div class="prediction-overunder-item">
              <div class="prediction-overunder-threshold">${escapeHtml(threshold)}</div>
              <div class="prediction-overunder-probs">
                <div class="prediction-overunder-prob over">Over: ${escapeHtml(formatPercent(probs.over))}</div>
                <div class="prediction-overunder-prob under">Under: ${escapeHtml(formatPercent(probs.under))}</div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="prediction-section">
        <div class="prediction-section-title">Handicap Dynamique</div>
        <div class="prediction-handicap-grid">
          ${Object.entries(handicapData).filter(([key]) => key !== 'recommended').slice(0, 5).map(([line, probs]) => `
            <div class="prediction-handicap-item">
              <div class="prediction-handicap-line">${escapeHtml(line)}</div>
              <div class="prediction-handicap-probs">
                <div class="prediction-handicap-prob">H: ${escapeHtml(formatPercent(probs.home))}</div>
                <div class="prediction-handicap-prob">D: ${escapeHtml(formatPercent(probs.draw))}</div>
                <div class="prediction-handicap-prob">A: ${escapeHtml(formatPercent(probs.away))}</div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="prediction-section">
        <div class="prediction-section-title">Parité</div>
        <div class="prediction-parity-grid">
          <div class="prediction-parity-item">
            <div class="prediction-parity-label">Pair</div>
            <div class="prediction-parity-value">${escapeHtml(formatPercent(parityData.pair))}</div>
          </div>
          <div class="prediction-parity-item">
            <div class="prediction-parity-label">Impair</div>
            <div class="prediction-parity-value">${escapeHtml(formatPercent(parityData.impair))}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAssistantMessages() {
  assistantMessagesEl.innerHTML = state.assistantMessages
    .map((message) => `<div class="assistant-bubble ${escapeClassToken(message.role)}">${escapeHtml(message.content)}</div>`)
    .join("");
  assistantMessagesEl.scrollTop = assistantMessagesEl.scrollHeight;
}

function handleAppClick(event) {
  const exportButton = event.target.closest("[data-export-match-id]");
  if (exportButton) {
    exportMatchPredictionImage(exportButton.getAttribute("data-export-match-id"));
    return;
  }

  const generateCouponButton = event.target.closest('[data-action="generate-coupon"]');
  if (generateCouponButton) {
    generateCoupon();
    return;
  }

  const exportCouponButton = event.target.closest('[data-action="export-coupon"]');
  if (exportCouponButton) {
    exportCouponImage();
  }
}

app.addEventListener("click", handleAppClick);
renderAssistantMessages();
