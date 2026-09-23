// Hand-written mock scenarios. Every price in the dashboard is generated from
// these "fair" (no-vig) probabilities and lines by the mock provider, so the
// numbers are internally consistent: each sportsbook applies its own margin,
// and line history walks from `open` to `current`.
//
// Times are relative (hours from now, snapped to a realistic start slot) so
// the mock slate never goes stale.
// Teams are real league teams for realism; matchups, prices, injuries, and
// weather notes are invented. UFC fighters are fictional.

// vig: built-in margin; step: price rounding; lag: update ticks behind the
// market; shade: how far a book leans off fair on each side (creates the
// price differences that make line shopping worthwhile).
export const MOCK_BOOKS = [
  { key: "pinnacle", name: "Pinnacle", vig: 0.026, step: 1, lag: 0, shade: 0.004 },
  { key: "draftkings", name: "DraftKings", vig: 0.045, step: 5, lag: 1, shade: 0.016 },
  { key: "fanduel", name: "FanDuel", vig: 0.042, step: 2, lag: 1, shade: 0.016 },
  { key: "betmgm", name: "BetMGM", vig: 0.05, step: 5, lag: 2, shade: 0.016 },
  { key: "caesars", name: "Caesars", vig: 0.048, step: 5, lag: 2, shade: 0.016 },
  { key: "betrivers", name: "BetRivers", vig: 0.052, step: 5, lag: 1, shade: 0.016 }
];

// Win-probability change per point of spread/total, and whether books may
// hang a half-point off consensus (common in NFL/NBA, rare on run lines).
export const SPORT_PROFILES = {
  nfl: { spreadPerPoint: 0.03, totalPerPoint: 0.022, offsets: true, vigScale: 1 },
  nba: { spreadPerPoint: 0.028, totalPerPoint: 0.018, offsets: true, vigScale: 1 },
  mlb: { spreadPerPoint: 0, totalPerPoint: 0.09, offsets: false, vigScale: 1 },
  soccer: { spreadPerPoint: 0, totalPerPoint: 0, offsets: false, vigScale: 1.35 },
  ufc: { spreadPerPoint: 0, totalPerPoint: 0, offsets: false, vigScale: 1.2 }
};

export const MOCK_EVENTS = [
  {
    id: "nfl-kc-buf",
    sport: "nfl",
    league: "NFL",
    kickoffUtc: [0, 20], // Sunday night, 8:20 PM ET
    startsInHours: 76,
    openedHoursAgo: 144,
    venue: "Highmark Stadium, Orchard Park NY",
    away: { name: "Kansas City Chiefs", short: "KC" },
    home: { name: "Buffalo Bills", short: "BUF" },
    moneyline: { open: { home: 0.54 }, current: { home: 0.6 } },
    spread: { open: { point: -1.5 }, current: { point: -3 } },
    total: { open: { point: 48.5 }, current: { point: 46.5 } },
    moves: [0.3, 0.55, 0.85],
    notes: [
      "Spread moved Bills -1.5 → -3, crossing the key number of 3 after early sharp action.",
      "Total fell from 48.5 to 46–47 depending on the book, on a windy forecast for Sunday (mock). Shop the number."
    ]
  },
  {
    id: "nfl-det-gb",
    sport: "nfl",
    league: "NFL",
    startsInHours: 80,
    openedHoursAgo: 144,
    venue: "Lambeau Field, Green Bay WI",
    away: { name: "Detroit Lions", short: "DET" },
    home: { name: "Green Bay Packers", short: "GB" },
    moneyline: { open: { home: 0.48 }, current: { home: 0.43 } },
    spread: { open: { point: 1 }, current: { point: 2.5 } },
    total: { open: { point: 50.5 }, current: { point: 51.5 } },
    moves: [0.4, 0.75],
    notes: ["Lions money pushed Green Bay from +1 to +2.5; the moneyline moved about 5% of win probability."]
  },
  {
    id: "nba-bos-nyk",
    sport: "nba",
    league: "NBA",
    startsInHours: 30,
    openedHoursAgo: 40,
    venue: "Madison Square Garden, New York NY",
    away: { name: "Boston Celtics", short: "BOS" },
    home: { name: "New York Knicks", short: "NYK" },
    moneyline: { open: { home: 0.43 }, current: { home: 0.46 } },
    spread: { open: { point: 2.5 }, current: { point: 1.5 } },
    total: { open: { point: 224.5 }, current: { point: 221.5 } },
    moves: [0.5, 0.8],
    notes: ["Total dropped 3 points after a (mock) injury report listed a Celtics starting guard as questionable."]
  },
  {
    id: "nba-den-lal",
    sport: "nba",
    league: "NBA",
    kickoffUtc: [2, 30], // 10:30 PM ET, West Coast
    startsInHours: 54,
    openedHoursAgo: 48,
    venue: "Crypto.com Arena, Los Angeles CA",
    away: { name: "Denver Nuggets", short: "DEN" },
    home: { name: "Los Angeles Lakers", short: "LAL" },
    moneyline: { open: { home: 0.4 }, current: { home: 0.36 } },
    spread: { open: { point: 3 }, current: { point: 4.5 } },
    total: { open: { point: 229.5 }, current: { point: 231 } },
    moves: [0.35, 0.7],
    notes: ["Nuggets steamed from -3 to -4.5 across most books within one update window."]
  },
  {
    id: "mlb-lad-sd",
    sport: "mlb",
    league: "MLB",
    kickoffUtc: [1, 40], // 6:40 PM PT
    startsInHours: 8,
    openedHoursAgo: 26,
    venue: "Petco Park, San Diego CA",
    away: { name: "Los Angeles Dodgers", short: "LAD" },
    home: { name: "San Diego Padres", short: "SD" },
    moneyline: { open: { home: 0.46 }, current: { home: 0.53 } },
    spread: { open: { point: 1.5, homeProb: 0.66 }, current: { point: -1.5, homeProb: 0.38 } },
    total: { open: { point: 8 }, current: { point: 7.5 } },
    moves: [0.6],
    notes: [
      "Padres flipped from underdog to favorite after the (mock) Dodgers starter was scratched.",
      "The run line flipped with it: San Diego +1.5 → -1.5."
    ]
  },
  {
    id: "mlb-nyy-bal",
    sport: "mlb",
    league: "MLB",
    startsInHours: 10,
    openedHoursAgo: 26,
    venue: "Oriole Park at Camden Yards, Baltimore MD",
    away: { name: "New York Yankees", short: "NYY" },
    home: { name: "Baltimore Orioles", short: "BAL" },
    moneyline: { open: { home: 0.45 }, current: { home: 0.44 } },
    spread: { open: { point: 1.5, homeProb: 0.63 }, current: { point: 1.5, homeProb: 0.62 } },
    total: { open: { point: 9, overProb: 0.48 }, current: { point: 9.5, overProb: 0.5 } },
    moves: [0.7],
    notes: ["Total ticked up to 9.5 with wind forecast blowing out to right field (mock)."]
  },
  {
    id: "epl-ars-liv",
    sport: "soccer",
    league: "Premier League",
    startsInHours: 50,
    openedHoursAgo: 120,
    venue: "Emirates Stadium, London",
    away: { name: "Liverpool", short: "LIV" },
    home: { name: "Arsenal", short: "ARS" },
    moneyline: { open: { home: 0.41, draw: 0.27 }, current: { home: 0.45, draw: 0.26 } },
    spread: { open: { point: -0.5, homeProb: 0.41 }, current: { point: -0.5, homeProb: 0.45 } },
    total: { open: { point: 2.5, overProb: 0.56 }, current: { point: 2.5, overProb: 0.6 } },
    moves: [0.5, 0.9],
    notes: ["Arsenal shortened after (mock) team news; the draw drifted slightly. 1X2 is a three-way market."]
  },
  {
    id: "laliga-rma-fcb",
    sport: "soccer",
    league: "La Liga",
    kickoffUtc: [19, 0], // 9:00 PM Madrid
    startsInHours: 98,
    openedHoursAgo: 120,
    venue: "Santiago Bernabéu, Madrid",
    away: { name: "FC Barcelona", short: "BAR" },
    home: { name: "Real Madrid", short: "RMA" },
    moneyline: { open: { home: 0.45, draw: 0.24 }, current: { home: 0.42, draw: 0.24 } },
    spread: { open: { point: -0.5, homeProb: 0.45 }, current: { point: -0.5, homeProb: 0.42 } },
    total: { open: { point: 2.5, overProb: 0.62 }, current: { point: 3, overProb: 0.51 } },
    moves: [0.45],
    notes: ["Goal line moved from 2.5 to 3.0; compare over/under prices only at the same line."]
  },
  {
    id: "ufc-hale-volkov",
    sport: "ufc",
    league: "UFC Fight Night (mock)",
    startsInHours: 124,
    openedHoursAgo: 240,
    neutral: true,
    venue: "UFC APEX, Las Vegas NV",
    away: { name: "Dmitri Volkov", short: "Volkov" },
    home: { name: "Marcus Hale", short: "Hale" },
    moneyline: { open: { home: 0.72 }, current: { home: 0.64 } },
    total: { open: { point: 2.5, overProb: 0.42 }, current: { point: 2.5, overProb: 0.48 } },
    moves: [0.25, 0.6, 0.9],
    // Caesars never moved off the opening number: a stale-line example.
    staleBook: "caesars",
    notes: [
      "Favorite drifted from about -285 to -190 at the sharpest book; fictional fighters, invented prices.",
      "Caesars is still hanging the opening prices and hasn't updated in 40+ minutes. Stale lines are where apparent edges usually come from, and they are often pulled or limited before they can be bet."
    ]
  },
  {
    id: "ufc-reyes-bello",
    kickoffUtc: [2, 30],
    sport: "ufc",
    league: "UFC Fight Night (mock)",
    startsInHours: 125,
    openedHoursAgo: 240,
    neutral: true,
    venue: "UFC APEX, Las Vegas NV",
    away: { name: "Tariq Bello", short: "Bello" },
    home: { name: "Jonas Reyes", short: "Reyes" },
    moneyline: { open: { home: 0.55 }, current: { home: 0.6 } },
    total: { open: { point: 1.5, overProb: 0.58 }, current: { point: 1.5, overProb: 0.55 } },
    moves: [0.5],
    notes: ["Rounds total is over/under 1.5 rounds; fictional fighters, invented prices."]
  },
  {
    id: "nfl-phi-sf",
    sport: "nfl",
    league: "NFL",
    kickoffUtc: [20, 25], // 4:25 PM ET
    startsInHours: 83,
    openedHoursAgo: 144,
    venue: "Levi's Stadium, Santa Clara CA",
    away: { name: "Philadelphia Eagles", short: "PHI" },
    home: { name: "San Francisco 49ers", short: "SF" },
    moneyline: { open: { home: 0.53 }, current: { home: 0.52 } },
    spread: { open: { point: -1.5 }, current: { point: -1 } },
    total: { open: { point: 45.5 }, current: { point: 45.5 } },
    moves: [0.5]
  },
  {
    id: "nba-gsw-phx",
    sport: "nba",
    league: "NBA",
    startsInHours: 56,
    openedHoursAgo: 48,
    venue: "Footprint Center, Phoenix AZ",
    away: { name: "Golden State Warriors", short: "GSW" },
    home: { name: "Phoenix Suns", short: "PHX" },
    moneyline: { open: { home: 0.55 }, current: { home: 0.56 } },
    spread: { open: { point: -2 }, current: { point: -2.5 } },
    total: { open: { point: 227.5 }, current: { point: 228 } },
    moves: [0.6]
  },
  {
    id: "mlb-atl-phi",
    sport: "mlb",
    league: "MLB",
    startsInHours: 12,
    openedHoursAgo: 26,
    venue: "Citizens Bank Park, Philadelphia PA",
    away: { name: "Atlanta Braves", short: "ATL" },
    home: { name: "Philadelphia Phillies", short: "PHI" },
    moneyline: { open: { home: 0.56 }, current: { home: 0.58 } },
    spread: { open: { point: -1.5, homeProb: 0.38 }, current: { point: -1.5, homeProb: 0.4 } },
    total: { open: { point: 8.5, overProb: 0.5 }, current: { point: 8.5, overProb: 0.47 } },
    moves: [0.5]
  },
  {
    id: "bund-fcb-bvb",
    sport: "soccer",
    league: "Bundesliga",
    startsInHours: 72,
    openedHoursAgo: 120,
    venue: "Allianz Arena, Munich",
    away: { name: "Borussia Dortmund", short: "BVB" },
    home: { name: "Bayern Munich", short: "FCB" },
    moneyline: { open: { home: 0.62, draw: 0.2 }, current: { home: 0.64, draw: 0.19 } },
    spread: { open: { point: -1.5, homeProb: 0.42 }, current: { point: -1.5, homeProb: 0.44 } },
    total: { open: { point: 3.5, overProb: 0.52 }, current: { point: 3.5, overProb: 0.55 } },
    moves: [0.5]
  },
  {
    id: "ufc-costa-mbeki",
    kickoffUtc: [1, 30],
    sport: "ufc",
    league: "UFC Fight Night (mock)",
    startsInHours: 126,
    openedHoursAgo: 240,
    neutral: true,
    venue: "UFC APEX, Las Vegas NV",
    away: { name: "Leon Mbeki", short: "Mbeki" },
    home: { name: "Andre Costa", short: "Costa" },
    moneyline: { open: { home: 0.47 }, current: { home: 0.53 } },
    total: { open: { point: 2.5, overProb: 0.55 }, current: { point: 2.5, overProb: 0.52 } },
    moves: [0.4, 0.8],
    notes: ["Near pick'em fight flipped favorites: Costa went from a slight underdog to a slight favorite. Fictional fighters, invented prices."]
  }
];
