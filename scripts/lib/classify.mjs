// Keyword classifier for events that arrive without an org of their own
// (Luma, Eventbrite, Meetup, library listings). Title words count double.
// Events from an org's own feed take the org's first domain instead.

const RULES = {
  "ocean-parks": [
    "beach", "ocean", "dune", "dunes", "cleanup", "clean-up", "clean up", "habitat", "restoration",
    "native plant", "tree planting", "plant trees", "stewardship", "birding", "bird walk", "nature walk",
    "naturalist", "tide pool", "wildlife", "park volunteer", "volunteer day", "trail", "whale",
  ],
  resilience: [
    "nert", "emergency", "disaster", "preparedness", "earthquake", "mutual aid", "pantry", "food bank",
    "climate", "resilience", "first aid", "cpr", "evacuation", "heat", "flood", "sea level", "wildfire",
    "free groceries", "food distribution",
  ],
  "food-land": [
    "farmers market", "farmers' market", "cooking", "compost", "gardening", "garden workday", "harvest",
    "seed", "co-op", "community garden", "foraging", "fermentation", "baking", "food tour", "tasting",
  ],
  "art-culture": [
    "art", "artist", "music", "concert", "live music", "jazz", "band", "dj", "film", "screening",
    "cinema", "theater", "theatre", "comedy", "poetry", "reading", "book launch", "author", "gallery",
    "exhibit", "exhibition", "museum", "festival", "dance performance", "open mic", "craft", "makers",
    "night market", "mercantile", "mural", "nightlife", "orchestra", "choir", "opera",
  ],
  neighbors: [
    "kids", "children", "family", "families", "toddler", "storytime", "story time", "teen", "teens",
    "youth", "senior", "seniors", "older adults", "community", "potluck", "social", "parents", "baby",
    "newcomer", "lunar new year", "moon festival", "heritage", "block party", "trivia", "game night",
    "bingo", "mahjong", "playgroup", "meet your neighbors",
  ],
  civic: [
    "meeting", "town hall", "supervisor", "board of", "association", "merchants", "planning", "hearing",
    "vote", "voter", "election", "candidate", "forum", "transit", "muni", "bike", "bicycle", "street",
    "safety", "police", "sfpd", "neighborhood", "housing", "rezoning", "zoning", "budget", "policy",
    "advocacy", "great highway",
  ],
  learning: [
    "class", "workshop", "lecture", "talk", "course", "lesson", "tutoring", "library", "science",
    "esl", "english conversation", "coding", "computer", "homework", "stem", "seminar", "webinar",
    "author talk", "book club", "panel", "training", "citizenship", "tech help",
  ],
  wellbeing: [
    "yoga", "meditation", "run club", "running", "5k", "10k", "fitness", "workout", "tai chi", "qigong",
    "health", "wellness", "mindfulness", "sound bath", "surf", "swim", "volleyball", "sports",
    "bootcamp", "breathwork", "grief", "support group", "worship", "mass", "prayer", "dharma", "sangha",
    "pilates", "walk", "hike", "cycling", "pickleball", "ecstatic dance",
  ],
};

const ORDER = Object.keys(RULES);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const COMPILED = Object.fromEntries(
  ORDER.map((d) => [d, RULES[d].map((w) => new RegExp(`\\b${escapeRe(w)}\\b`, "i"))])
);

export function classify(title, description = "") {
  const t = String(title || "");
  const desc = String(description || "").slice(0, 600);
  let best = null;
  let bestScore = 0;
  for (const d of ORDER) {
    let score = 0;
    for (const re of COMPILED[d]) {
      if (re.test(t)) score += 2;
      if (re.test(desc)) score += 1;
    }
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best ?? "neighbors";
}
