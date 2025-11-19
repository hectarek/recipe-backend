export const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 0.5,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "¼": 0.25,
  "¾": 0.75,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

export const UNIT_ALIASES: Record<string, string> = {
  teaspoon: "tsp",
  teaspoons: "tsp",
  tsp: "tsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tbsp: "tbsp",
  cup: "cup",
  cups: "cup",
  ounce: "oz",
  ounces: "oz",
  oz: "oz",
  pound: "lb",
  pounds: "lb",
  lb: "lb",
  lbs: "lb",
  gram: "g",
  grams: "g",
  g: "g",
  kilogram: "kg",
  kilograms: "kg",
  kg: "kg",
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  ml: "ml",
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  l: "l",
  pinch: "pinch",
  cloves: "clove",
  clove: "clove",
  can: "can",
  cans: "can",
  package: "package",
  packages: "package",
  stick: "stick",
  sticks: "stick",
  slice: "slice",
  slices: "slice",
  bunch: "bunch",
  bunches: "bunch",
  sprig: "sprig",
  sprigs: "sprig",
  rib: "rib",
  ribs: "rib",
  piece: "piece",
  pieces: "piece",
  stalk: "stalk",
  stalks: "stalk",
  head: "head",
  heads: "head",
  bulb: "bulb",
  bulbs: "bulb",
  leaf: "leaf",
  leaves: "leaf",
};

export const DESCRIPTORS = [
  "chopped",
  "finely chopped",
  "thinly sliced",
  "sliced",
  "diced",
  "minced",
  "peeled",
  "seeded",
  "softened",
  "melted",
  "divided",
  "to taste",
  "at room temperature",
  "freshly ground",
];

export const SERVINGS_NUMBER_REGEX = /(\d+(?:\.\d+)?)/;
export const HOURS_TEXT_REGEX = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr|h)\b/i;
export const MINUTES_TEXT_REGEX =
  /(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|min|m)\b/i;
export const NUMERIC_DURATION_REGEX = /^\d+(?:\.\d+)?$/;
export const ISO_DATE_COMPONENT_REGEX = /(\d+(?:\.\d+)?)([YMWD])/gi;
export const ISO_TIME_COMPONENT_REGEX = /(\d+(?:\.\d+)?)([YMWDHS])/gi;
export const ISO_DATE_TIME_SEPARATOR_REGEX = /[Tt]/;
export const DATABASE_ID_HEX_REGEX = /[0-9a-fA-F]{32}/;
export const COLLECTION_PREFIX_REGEX = /^collection:\/\//i;

export const ISO_DATE_DESIGNATOR_MULTIPLIERS: Record<string, number> = {
  Y: 525_600,
  M: 43_800,
  W: 10_080,
  D: 1440,
};

export const ISO_TIME_DESIGNATOR_MULTIPLIERS: Record<string, number> = {
  H: 60,
  M: 1,
  S: 1 / 60,
  D: 1440,
};
