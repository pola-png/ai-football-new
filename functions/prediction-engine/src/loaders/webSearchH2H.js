/**
 * Automated Web-Scraping H2H Search Module.
 * Searches public web results for historical match outcomes between two teams without any external API.
 */

function cleanTeamName(name) {
  if (!name) return '';
  return String(name)
    .replace(/\b(FC|CF|SC|AC|SV|CD|FK|BSC|AFC|AS|UD|SD|BK|IF|FF)\b/gi, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseScorelinesFromText(text, homeTeamName, awayTeamName) {
  if (!text) return [];

  const matches = [];
  const homeClean = cleanTeamName(homeTeamName).toLowerCase();
  const awayClean = cleanTeamName(awayTeamName).toLowerCase();

  // Pattern 1: Matches with explicit team names around scores: e.g. "Arsenal 2 - 1 Chelsea" or "Chelsea 0:3 Arsenal"
  const teamScorePattern = /([A-Za-z0-9\s]{2,25})\s+(\d+)\s*[-:]\s*(\d+)\s+([A-Za-z0-9\s]{2,25})/gi;
  let match;

  while ((match = teamScorePattern.exec(text)) !== null) {
    const leftTeam = match[1].trim().toLowerCase();
    const score1 = parseInt(match[2], 10);
    const score2 = parseInt(match[3], 10);
    const rightTeam = match[4].trim().toLowerCase();

    // Sanity check realistic football scores
    if (score1 > 12 || score2 > 12) continue;

    const leftIsHome = homeClean && leftTeam.includes(homeClean.split(' ')[0]);
    const leftIsAway = awayClean && leftTeam.includes(awayClean.split(' ')[0]);
    const rightIsHome = homeClean && rightTeam.includes(homeClean.split(' ')[0]);
    const rightIsAway = awayClean && rightTeam.includes(awayClean.split(' ')[0]);

    if ((leftIsHome && rightIsAway) || (leftIsAway && rightIsHome)) {
      const isHomeFirst = leftIsHome;
      const hs = isHomeFirst ? score1 : score2;
      const as = isHomeFirst ? score2 : score1;

      matches.push({
        home_score: String(hs),
        away_score: String(as),
        winner: hs > as ? 'home' : (as > hs ? 'away' : 'draw'),
        status_short: 'FT',
        source: 'web_search',
      });
    }
  }

  // Pattern 2: Score patterns embedded in match summary sentences e.g. "won 2-1", "draw 1-1", "finished 0-2", "(3-1)"
  if (matches.length < 3) {
    const genericScorePattern = /(?:won|beat|lost|drew|defeat|score|finished|result|ft)?\s*[\(\[]?\s*(\d+)\s*[-:]\s*(\d+)\s*[\)\]]?/gi;
    while ((match = genericScorePattern.exec(text)) !== null) {
      const s1 = parseInt(match[1], 10);
      const s2 = parseInt(match[2], 10);
      if (s1 <= 9 && s2 <= 9) {
        // Only include if text segment contains reference to both clubs
        const snippetWindow = text.substring(Math.max(0, match.index - 80), Math.min(text.length, match.index + 80)).toLowerCase();
        if (
          homeClean.split(' ')[0] && snippetWindow.includes(homeClean.split(' ')[0]) &&
          awayClean.split(' ')[0] && snippetWindow.includes(awayClean.split(' ')[0])
        ) {
          const duplicate = matches.some(m => m.home_score === String(s1) && m.away_score === String(s2));
          if (!duplicate) {
            matches.push({
              home_score: String(s1),
              away_score: String(s2),
              winner: s1 > s2 ? 'home' : (s2 > s1 ? 'away' : 'draw'),
              status_short: 'FT',
              source: 'web_search_snippet',
            });
          }
        }
      }
    }
  }

  return matches.slice(0, 8); // keep top 8 most recent historical matches
}

/**
 * Searches the web for H2H match history between two teams using public web search.
 * @param {string} homeTeamName - Home team name
 * @param {string} awayTeamName - Away team name
 * @param {object} [options] - Optional timeout and config
 * @returns {Promise<Array>} List of extracted match objects
 */
export async function searchH2HOnline(homeTeamName, awayTeamName, options = {}) {
  const timeoutMs = options.timeoutMs || 3500;

  if (!homeTeamName || !awayTeamName) return [];
  if (homeTeamName.toLowerCase().includes('unknown') || awayTeamName.toLowerCase().includes('unknown')) {
    return [];
  }

  const cleanHome = cleanTeamName(homeTeamName);
  const cleanAway = cleanTeamName(awayTeamName);
  if (!cleanHome || !cleanAway) return [];

  const query = `${cleanHome} vs ${cleanAway} head to head results past matches`;
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(searchUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    // Strip script and style tags
    const cleanText = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ');

    const results = parseScorelinesFromText(cleanText, homeTeamName, awayTeamName);
    return results;
  } catch (error) {
    clearTimeout(timer);
    // Silent fail on timeout/network issue — graceful degradation
    return [];
  }
}
