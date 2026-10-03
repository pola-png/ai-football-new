/**
 * Robust Multi-Source Online H2H Search Module.
 * Extracts historical match results between two teams from public sports databases and search engines.
 */

function cleanTeamName(name) {
  if (!name) return '';
  return String(name)
    .replace(/\b(FC|CF|SC|AC|SV|CD|FK|BSC|AFC|AS|UD|SD|BK|IF|FF|Club|United|City|Town|Rovers|Wanderers)\b/gi, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function getTeamKeywords(name) {
  const clean = cleanTeamName(name).toLowerCase();
  const raw = String(name).toLowerCase().replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
  const parts = [...new Set([...clean.split(' '), ...raw.split(' ')])].filter(p => p.length >= 3);
  return parts;
}

function isTeamMatch(text, keywords) {
  if (!text || keywords.length === 0) return false;
  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

/**
 * Parses scorelines from unstructured web search text and HTML snippets.
 */
export function parseScorelinesFromText(text, homeTeamName, awayTeamName) {
  if (!text) return [];

  const matches = [];
  const homeKeywords = getTeamKeywords(homeTeamName);
  const awayKeywords = getTeamKeywords(awayTeamName);

  if (homeKeywords.length === 0 || awayKeywords.length === 0) {
    return [];
  }

  // Normalize text whitespace and common html artifacts
  const cleanText = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');

  // Pattern 1: Explicit match with date/teams: e.g. "Real Madrid 3 - 1 Barcelona", "Arsenal 2:1 Chelsea", "Chelsea 0-2 Arsenal"
  const directScoreRegex = /([A-Za-z0-9\s.]{2,30})\s+(\d+)\s*[-:]\s*(\d+)\s+([A-Za-z0-9\s.]{2,30})/gi;
  let m;

  while ((m = directScoreRegex.exec(cleanText)) !== null) {
    const teamA = m[1].trim();
    const sA = parseInt(m[2], 10);
    const sB = parseInt(m[3], 10);
    const teamB = m[4].trim();

    if (sA > 15 || sB > 15) continue; // Unrealistic football scores

    const aIsHome = isTeamMatch(teamA, homeKeywords);
    const aIsAway = isTeamMatch(teamA, awayKeywords);
    const bIsHome = isTeamMatch(teamB, homeKeywords);
    const bIsAway = isTeamMatch(teamB, awayKeywords);

    if ((aIsHome && bIsAway) || (aIsAway && bIsHome)) {
      const isHomeTeamA = aIsHome;
      const hs = isHomeTeamA ? sA : sB;
      const as = isHomeTeamA ? sB : sA;

      const duplicate = matches.some(x => x.home_score === String(hs) && x.away_score === String(as));
      if (!duplicate) {
        matches.push({
          home_score: String(hs),
          away_score: String(as),
          winner: hs > as ? 'home' : (as > hs ? 'away' : 'draw'),
          status_short: 'FT',
          kickoff_at: new Date(Date.now() - matches.length * 90 * 24 * 3600 * 1000).toISOString(),
          source: 'web_search_direct',
        });
      }
    }
  }

  // Pattern 2: Search snippets containing "vs", "head to head", "beat", "won", "finished 2-1", "drew 1-1"
  const sentences = cleanText.split(/[.\n;•|]/);
  const scoreExtractRegex = /(?:won|beat|lost|drew|defeat|score|result|ft|ended|finished)?\s*[\(\[]?\s*(\d+)\s*[-:]\s*(\d+)\s*[\)\]]?/i;

  for (const sentence of sentences) {
    if (matches.length >= 8) break;
    const hasHome = isTeamMatch(sentence, homeKeywords);
    const hasAway = isTeamMatch(sentence, awayKeywords);

    if (hasHome && hasAway) {
      const scoreMatch = scoreExtractRegex.exec(sentence);
      if (scoreMatch) {
        const s1 = parseInt(scoreMatch[1], 10);
        const s2 = parseInt(scoreMatch[2], 10);
        if (s1 <= 12 && s2 <= 12 && (s1 > 0 || s2 > 0 || sentence.toLowerCase().includes('0-0') || sentence.toLowerCase().includes('0:0') || sentence.toLowerCase().includes('goalless'))) {
          // Determine who won based on context
          const lowerSentence = sentence.toLowerCase();
          const homeIndex = homeKeywords.reduce((acc, k) => {
            const idx = lowerSentence.indexOf(k);
            return idx !== -1 && (acc === -1 || idx < acc) ? idx : acc;
          }, -1);
          const awayIndex = awayKeywords.reduce((acc, k) => {
            const idx = lowerSentence.indexOf(k);
            return idx !== -1 && (acc === -1 || idx < acc) ? idx : acc;
          }, -1);

          const isHomeMentionedFirst = homeIndex !== -1 && (awayIndex === -1 || homeIndex < awayIndex);
          const hs = isHomeMentionedFirst ? s1 : s2;
          const as = isHomeMentionedFirst ? s2 : s1;

          const duplicate = matches.some(x => x.home_score === String(hs) && x.away_score === String(as));
          if (!duplicate) {
            matches.push({
              home_score: String(hs),
              away_score: String(as),
              winner: hs > as ? 'home' : (as > hs ? 'away' : 'draw'),
              status_short: 'FT',
              kickoff_at: new Date(Date.now() - matches.length * 90 * 24 * 3600 * 1000).toISOString(),
              source: 'web_search_sentence',
            });
          }
        }
      }
    }
  }

  return matches.slice(0, 8);
}

/**
 * Fetch H2H events from TheSportsDB open database.
 */
async function fetchTheSportsDBH2H(homeTeamName, awayTeamName, timeoutMs = 4000) {
  const cleanHome = cleanTeamName(homeTeamName) || homeTeamName;
  const cleanAway = cleanTeamName(awayTeamName) || awayTeamName;

  const queries = [
    `${cleanHome}_vs_${cleanAway}`,
    `${cleanAway}_vs_${cleanHome}`,
    `${homeTeamName}_vs_${awayTeamName}`,
  ];

  const homeKeywords = getTeamKeywords(homeTeamName);
  const awayKeywords = getTeamKeywords(awayTeamName);
  const results = [];

  for (const q of queries) {
    const url = `https://www.thesportsdb.com/api/v1/json/3/searchevents.php?e=${encodeURIComponent(q.replace(/\s+/g, '_'))}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) continue;

      const data = await res.json();
      if (Array.isArray(data?.event)) {
        for (const ev of data.event) {
          if (ev.intHomeScore !== null && ev.intAwayScore !== null && ev.intHomeScore !== '' && ev.intAwayScore !== '') {
            const hs = parseInt(ev.intHomeScore, 10);
            const as = parseInt(ev.intAwayScore, 10);
            if (isNaN(hs) || isNaN(as)) continue;

            const isHomeTeamActualHome = isTeamMatch(ev.strHomeTeam, homeKeywords);
            const actualHomeScore = isHomeTeamActualHome ? hs : as;
            const actualAwayScore = isHomeTeamActualHome ? as : hs;

            const dateStr = ev.dateEvent ? `${ev.dateEvent}T00:00:00.000Z` : new Date().toISOString();

            const duplicate = results.some(r => r.home_score === String(actualHomeScore) && r.away_score === String(actualAwayScore) && r.kickoff_at === dateStr);
            if (!duplicate) {
              results.push({
                home_score: String(actualHomeScore),
                away_score: String(actualAwayScore),
                winner: actualHomeScore > actualAwayScore ? 'home' : (actualAwayScore > actualHomeScore ? 'away' : 'draw'),
                status_short: 'FT',
                kickoff_at: dateStr,
                source: 'thesportsdb',
              });
            }
          }
        }
      }
      if (results.length >= 3) break;
    } catch {
      clearTimeout(timer);
    }
  }

  return results;
}

/**
 * Fetch H2H from DuckDuckGo search HTML / Lite.
 */
async function fetchDuckDuckGoSearch(homeTeamName, awayTeamName, timeoutMs = 4000) {
  const cleanHome = cleanTeamName(homeTeamName) || homeTeamName;
  const cleanAway = cleanTeamName(awayTeamName) || awayTeamName;
  const query = `${cleanHome} vs ${cleanAway} head to head past results score`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return [];

    const html = await res.text();
    const cleanText = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');

    return parseScorelinesFromText(cleanText, homeTeamName, awayTeamName);
  } catch {
    clearTimeout(timer);
    return [];
  }
}

/**
 * Fetch H2H from Bing Search HTML.
 */
async function fetchBingSearch(homeTeamName, awayTeamName, timeoutMs = 4000) {
  const cleanHome = cleanTeamName(homeTeamName) || homeTeamName;
  const cleanAway = cleanTeamName(awayTeamName) || awayTeamName;
  const query = `${cleanHome} vs ${cleanAway} past matches head to head score`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return [];

    const html = await res.text();
    const cleanText = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');

    return parseScorelinesFromText(cleanText, homeTeamName, awayTeamName);
  } catch {
    clearTimeout(timer);
    return [];
  }
}

/**
 * Searches the web for H2H match history using multiple search sources in parallel.
 * @param {string} homeTeamName - Home team name
 * @param {string} awayTeamName - Away team name
 * @param {object} [options] - Optional timeout and config
 * @returns {Promise<Array>} List of extracted match objects
 */
export async function searchH2HOnline(homeTeamName, awayTeamName, options = {}) {
  if (!homeTeamName || !awayTeamName) return [];
  if (
    homeTeamName.toLowerCase().includes('unknown') ||
    awayTeamName.toLowerCase().includes('unknown')
  ) {
    return [];
  }

  const timeoutMs = options.timeoutMs || 5000;

  // Run sports database search + web search in parallel for speed & high accuracy
  const [sportsDbMatches, ddgMatches, bingMatches] = await Promise.all([
    fetchTheSportsDBH2H(homeTeamName, awayTeamName, timeoutMs),
    fetchDuckDuckGoSearch(homeTeamName, awayTeamName, timeoutMs),
    fetchBingSearch(homeTeamName, awayTeamName, timeoutMs),
  ]);

  const combined = [...sportsDbMatches, ...ddgMatches, ...bingMatches];
  const unique = [];

  for (const m of combined) {
    const exists = unique.some(
      u => u.home_score === m.home_score && u.away_score === m.away_score && u.winner === m.winner
    );
    if (!exists) {
      unique.push(m);
    }
  }

  return unique.slice(0, 8);
}
