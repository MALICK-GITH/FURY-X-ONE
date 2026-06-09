const betTypeLabels = {
  1: "Victoire équipe 1",
  2: "Victoire équipe 2",
  3: "Match nul",
  4: "Double chance 1X",
  5: "Double chance X2",
  6: "Double chance 12",
  7: "Handicap équipe 1",
  8: "Handicap équipe 2",
  9: "Over",
  10: "Under",
  11: "Over équipe",
  12: "Under équipe",
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
  ]
};

function renderLoading(message = "Chargement des ligues et matchs...") {
  app.innerHTML = `<section class="hero"><h2>Chargement</h2><p>${message}</p></section>`;
}

function renderError(message) {
  app.innerHTML = `
    <section class="hero">
      <h2>Erreur de chargement</h2>
      <p>${message}</p>
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
    { id: "penalty", label: "Penalty" },
    { id: "rush", label: "Rush / 5x5" },
    { id: "4x4", label: "4x4" },
    { id: "3x3", label: "3x3" },
    { id: "champions", label: "Champions League" }
  ];
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

function formatTimestamp(timestamp) {
  if (!timestamp) return "Inconnu";
  return new Date(timestamp * 1000).toLocaleString("fr-FR", {
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
        <div class="stat"><span>Ligues</span><strong>${filteredLeagues.length}</strong></div>
        <div class="stat"><span>Matchs</span><strong>${filteredMatches.length}</strong></div>
        <div class="stat"><span>En direct</span><strong>${matches.filter((match) => match.ICY).length}</strong></div>
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
}

function renderLeagueCard(league) {
  return `
    <article class="card league-card">
      <div class="league-card-top">
        <span class="mini-badge">Ligue</span>
        <h3>${league.name}</h3>
      </div>
      <div class="league-meta">
        <span class="muted">Pays: ${league.country}</span>
        <span class="muted">Sport ID: ${league.sportId}</span>
        <span class="muted">Matchs: ${league.matches.length}</span>
      </div>
      <div class="actions">
        <a class="button" href="#/league/${league.id}">Voir les matchs</a>
      </div>
    </article>
  `;
}

function renderLeague(leagueId) {
  const league = state.leagues.find((item) => String(item.id) === String(leagueId));
  if (!league) {
    app.innerHTML = `<div class="card"><h2>Ligue introuvable</h2><a class="button-secondary" href="#/">Retour</a></div>`;
    return;
  }

  app.innerHTML = `
    <section class="hero hero-league">
      <h2>${league.name}</h2>
      <p>${league.matches.length} match(s) disponibles dans cette ligue virtuelle.</p>
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
  return `
    <article class="match-card">
      <div class="match-card-top">
        <div class="pill-row">
          <span class="pill ${getStatusClass(match)}">${getDisplayStatus(match)}</span>
          <span class="pill">${getDisplayPhase(match)}</span>
        </div>
        <span class="muted">Début: ${formatTimestamp(match.S)}</span>
      </div>

      <div class="teams">
        <div class="team-col">
          <p class="muted">Équipe 1</p>
          <h3>${match.O1}</h3>
        </div>
        <div class="score ${hasLiveScore(match) ? "" : "score-muted"}">${scoreDisplay}</div>
        <div class="team-col">
          <p class="muted">Équipe 2</p>
          <h3>${match.O2}</h3>
        </div>
      </div>

      <div class="match-meta">
        <div class="pill-row">
          <span class="pill">Temps: ${getDisplayTime(match)}</span>
        </div>
        <p class="muted match-info-line">${getCompactMatchInfo(match)}</p>
        <div class="odds-row">
          ${(match.E || []).slice(0, 5).map((item) => `<span class="odd-pill">${betTypeLabels[item.T] || `Type ${item.T}`}${item.P ? ` ${item.P}` : ""} · ${item.C}</span>`).join("")}
        </div>
      </div>

      <div class="actions">
        <a class="button" href="#/prediction/${match.I}">Détails</a>
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

  app.innerHTML = `
    <section class="hero hero-detail">
      <div class="detail-header-top">
        <span class="mini-badge">Détail match</span>
        <span class="muted">${match.LE || match.L}</span>
      </div>
      <h2>${match.O1} vs ${match.O2}</h2>
      <div class="detail-score-row">
        <div class="detail-team">${match.O1}</div>
        <div class="detail-score ${hasLiveScore(match) ? "" : "score-muted"}">${scoreDisplay}</div>
        <div class="detail-team detail-team-right">${match.O2}</div>
      </div>
      <div class="pill-row">
        <span class="pill ${getStatusClass(match)}">${getDisplayStatus(match)}</span>
        <span class="pill">${getDisplayPhase(match)}</span>
        <span class="pill">${getDisplayTime(match)}</span>
      </div>
      <div class="actions">
        <a class="button-secondary" href="#/league/${match.LI}">Retour à la ligue</a>
        <button class="button export-image-button" type="button" onclick="exportMatchPredictionImage('${match.I}')">
          ${state.exportLoading ? "Cr?ation..." : "Cr?er l'image"}
        </button>
      </div>
    </section>

    <section class="prediction-layout prediction-layout-top">
      <article class="prediction-box">
        <h3>Prédiction</h3>
        <p class="muted">Module ONE DELUX AI · ${getDisplayStatus(match)} · ${getDisplayTime(match)}</p>
        ${renderPredictionModule(predictionState)}
      </article>

      <article class="prediction-box">
        <h3>${match.O1} <span class="muted">vs</span> ${match.O2}</h3>
        <p class="muted">${getCompactMatchInfo(match)}</p>
        <div class="prediction-grid">
          <div class="market-item"><strong>Score</strong><p>${scoreDisplay}</p></div>
          <div class="market-item"><strong>Début</strong><p>${formatTimestamp(match.S)}</p></div>
          <div class="market-item"><strong>Ligue</strong><p>${match.LE || match.L || "Inconnue"}</p></div>
          <div class="market-item"><strong>Pays</strong><p>${match.CN || match.CE || "Inconnu"}</p></div>
          <div class="market-item"><strong>Marchés</strong><p>${match.EC || (match.E || []).length}</p></div>
          <div class="market-item"><strong>ID match</strong><p>${match.I}</p></div>
          <div class="market-item"><strong>Info match</strong><p>${match.SC?.I || "Aucune information supplémentaire"}</p></div>
        </div>
      </article>
    </section>

    <section class="card section-card">
      <h3>Marchés principaux</h3>
      <div class="market-list">
        ${primaryMarkets.map((item) => `
          <div class="market-item">
            <strong>${betTypeLabels[item.T] || `Type ${item.T}`}</strong>
            <p>Groupe: ${marketGroupLabels[item.G] || item.G}</p>
            <p>${item.P !== undefined ? `Ligne: ${item.P}` : "Sans ligne"}</p>
            <p>Cote: ${item.C}</p>
          </div>
        `).join("")}
      </div>
    </section>

    <section class="card section-card">
      <h3>Marchés avancés - Total buts</h3>
      <div class="market-list">
        ${advancedTotals.length ? advancedTotals.map((item) => `
          <div class="market-item">
            <strong>${betTypeLabels[item.T] || `Type ${item.T}`}</strong>
            <p>Ligne: ${item.P}</p>
            <p>Cote: ${item.C}</p>
          </div>
        `).join("") : "<p class='muted'>Aucun marché avancé disponible.</p>"}
      </div>
    </section>

    <section class="card section-card">
      <h3>Marchés avancés - Handicap</h3>
      <div class="market-list">
        ${advancedHandicaps.length ? advancedHandicaps.map((item) => `
          <div class="market-item">
            <strong>${betTypeLabels[item.T] || `Type ${item.T}`}</strong>
            <p>Groupe: ${marketGroupLabels[item.G] || item.G}</p>
            <p>${item.P !== undefined ? `Ligne: ${item.P}` : "Sans ligne"}</p>
            <p>Cote: ${item.C}</p>
          </div>
        `).join("") : "<p class='muted'>Aucun handicap avancé disponible.</p>"}
      </div>
    </section>
  `;

  if (!state.predictionCache[String(match.I)]) {
    loadPrediction(match);
  }
}

function renderPredictionModule(predictionState) {
  if (predictionState.loading) {
    return `<div class="market-item"><p>Chargement de la prédiction...</p></div>`;
  }
  if (predictionState.error) {
    return `<div class="market-item"><strong>Erreur</strong><p>${predictionState.error}</p></div>`;
  }

  const prediction = predictionState.data?.prediction;
  const input = predictionState.data?.input;
  if (!prediction) {
    return `<div class="market-item"><p>Aucune prédiction disponible.</p></div>`;
  }

  return `
    <div class="primary-prediction-glow">
      <span class="primary-prediction-label">Prédiction principale</span>
      <div class="primary-prediction-value">${prediction.score_prediction || prediction.over_under_2_5 || "-"}</div>
      <div class="primary-prediction-meta">
        <span>Confiance: ${prediction.confidence ?? "-"}%</span>
        <span>Source: ${prediction.source || predictionState.data?.provider || "-"}</span>
      </div>
    </div>
    <div class="prediction-grid">
      <div class="market-item"><strong>Score prédit</strong><p>${prediction.score_prediction || "-"}</p></div>
      <div class="market-item"><strong>Over/Under 2.5</strong><p>${prediction.over_under_2_5 || "-"}</p></div>
      <div class="market-item"><strong>Buts domicile</strong><p>${prediction.home_goals ?? "-"}</p></div>
      <div class="market-item"><strong>Buts extérieur</strong><p>${prediction.away_goals ?? "-"}</p></div>
      <div class="market-item"><strong>Total buts</strong><p>${prediction.total_goals ?? "-"}</p></div>
      <div class="market-item"><strong>Modèle source</strong><p>${prediction.source || predictionState.data?.provider || "-"}</p></div>
      <div class="market-item"><strong>Cotes envoyées</strong><p>1 (${match.O1}): ${input?.home_odds ?? "-"} · N (nul): ${input?.draw_odds ?? "-"} · 2 (${match.O2}): ${input?.away_odds ?? "-"}</p></div>
    </div>
  `;
}

function getPredictionHeadline(prediction) {
  if (!prediction) {
    return "Pr??diction indisponible";
  }
  return prediction.score_prediction || prediction.over_under_2_5 || "Pr??diction en attente";
}

function getPredictionFooter(predictionState) {
  if (predictionState.loading) {
    return "Pr??diction en cours de chargement";
  }
  if (predictionState.error) {
    return "Pr??diction indisponible pour le moment";
  }
  const prediction = predictionState.data?.prediction;
  if (!prediction) {
    return "Aucune pr?diction disponible";
  }
  const confidence = prediction.confidence ?? "-";
  const source = prediction.source || predictionState.data?.provider || "ONE DELUX AI";
  return `${getPredictionHeadline(prediction)} ? Confiance ${confidence}% ? ${source}`;
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
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1440;

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
    context.fillText(`${getDisplayStatus(match)} ?? ${getDisplayPhase(match)} ?? ${getDisplayTime(match)}`, 134, 420);

    context.fillStyle = "rgba(94, 234, 212, 0.16)";
    context.strokeStyle = "rgba(94, 234, 212, 0.32)";
    roundRect(context, 96, 520, 888, 244, 30, true, true);

    context.fillStyle = "#ecfeff";
    context.font = "700 24px Arial";
    context.fillText("PR??DICTION PRINCIPALE", 132, 576);

    context.fillStyle = "#ffffff";
    context.font = "900 72px Arial";
    context.fillText(getPredictionHeadline(prediction), 132, 664);

    context.fillStyle = "#ecfeff";
    context.font = "28px Arial";
    wrapExportLine(context, getPredictionFooter(predictionState), 132, 716, 810, 36);

    context.fillStyle = "rgba(255, 255, 255, 0.04)";
    roundRect(context, 96, 810, 888, 348, 28, true, false);

    context.fillStyle = "#f5f7fb";
    context.font = "700 28px Arial";
    context.fillText("R??SUM?? DU MATCH", 132, 868);

    context.fillStyle = "#9fb0cc";
    context.font = "26px Arial";
    const summaryText = [
      `D??but : ${formatTimestamp(match.S)}`,
      `March??s : ${match.EC || (match.E || []).length}`,
      `Info : ${match.SC?.I || "Aucune information suppl??mentaire"}`,
      prediction
        ? `Projection : ${prediction.home_goals ?? "-"} - ${prediction.away_goals ?? "-"} | Total ${prediction.total_goals ?? "-"}`
        : "Projection : indisponible"
    ].join(" ?? ");
    wrapExportLine(context, summaryText, 132, 918, 810, 34);

    context.fillStyle = "#f5f7fb";
    context.font = "700 28px Arial";
    context.fillText("MARCH??S CL??S", 132, 1036);

    context.fillStyle = "#9fb0cc";
    context.font = "24px Arial";
    (match.E || []).slice(0, 4).forEach((item, index) => {
      const label = betTypeLabels[item.T] || `Type ${item.T}`;
      const line = item.P !== undefined ? ` ${item.P}` : "";
      context.fillText(`??? ${label}${line} ?? ${item.C}`, 132, 1088 + index * 44);
    });

    context.fillStyle = "#5eead4";
    context.font = "700 24px Arial";
    context.fillText("Image g??n??r??e depuis la page d??tails Fury X One", 132, 1296);

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `fury-x-one-${match.I}.png`;
    link.click();
  } catch (error) {
    alert(`Impossible de cr??er l'image : ${error.message}`);
  } finally {
    state.exportLoading = false;
    if (window.location.hash === `#/prediction/${match.I}`) {
      renderPredictionDetails(match.I);
    }
  }
}

function roundRect(context, x, y, width, height, radius, fill, stroke) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
  if (fill) {
    context.fill();
  }
  if (stroke) {
    context.stroke();
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

function renderAssistantMessages() {
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
      content: `Je n’ai pas pu répondre pour le moment : ${error.message}`
    });
  }

  renderAssistantMessages();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
  renderHome();
}

async function bootstrap() {
  state.loading = true;
  state.error = "";
  router();

  try {
    const response = await fetch("/api/matches");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    state.leagues = normalizeLeagues(Array.isArray(payload?.Value) ? payload.Value : []);
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

assistantToggle.addEventListener("click", () => toggleAssistant());
assistantClose.addEventListener("click", () => toggleAssistant(false));
assistantForm.addEventListener("submit", handleAssistantSubmit);
renderAssistantMessages();
