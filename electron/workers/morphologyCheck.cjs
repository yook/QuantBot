const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const PhpMorphy = require("phpmorphy");
const os = require("os");

const MORPH_BATCH_SIZE =
  Number(process.env.MORPH_CHECK_BATCH_SIZE) > 0
    ? Math.max(1, Math.floor(Number(process.env.MORPH_CHECK_BATCH_SIZE)))
    : 50;
// Candidate dictionary locations (try these in order until one works)
const MORPHY_DICT_CANDIDATES = [
  process.env.MORPHY_DICT_PATH,
  path.join(process.cwd(), "node_modules", "phpmorphy", "dicts"),
  path.join(__dirname, "dicts"),
].filter(Boolean);

// Minimal tag sets used in heuristics. We normalize grammemes before checking,
// so keep these lists small (core tokens + a couple fallbacks).
const NOMINATIVE_TAGS = ["ИМ", "ИМЯ", "NOM"];
const ACCUSATIVE_TAGS = ["ВН", "ACC"];
const GENITIVE_TAGS = ["РД", "GEN"];
const GENDER_TAGS = ["МР", "ЖР", "СР", "MASC", "FEM", "NEUT"];
const NUMBER_TAGS = ["ЕД", "МН", "SING", "PL"];
const PREPOSITIONS = [
  "ДЛЯ",
  "НА",
  "В",
  "ВО",
  "К",
  "О",
  "ОБ",
  "ОБО",
  "ПО",
  "ПРИ",
  "У",
  "С",
  "ИЗ",
  "ИЗО",
  "ПОД",
  "ПОДО",
  "ПЕРЕД",
  "ПЕРЕДО",
  "ОТ",
];

// Product whitelist: tokens that should be treated as explicit nouns
// even when phpmorphy has no parses or misses noun tags.
const PRODUCT_WHITELIST = new Set(["бафф", "парео", "клатч", "шопер", "дартс"]);

// Normalization helpers: produce normalized token list from mixed grammeme strings.
function _normTokensFromArray(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const item of arr) {
    if (!item && item !== 0) continue;
    const s = String(item).toUpperCase();
    // split combined tokens like "МР-ЖР" into ["МР","ЖР"] and remove empties
    const parts = s
      .split(/[^A-ZА-Я0-9]+/u)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const p of parts) out.push(p);
  }
  return out;
}

// Precompute normalized probe sets for fast lookups
const NORM_NOMINATIVE = new Set(_normTokensFromArray(NOMINATIVE_TAGS));
const NORM_ACCUSATIVE = new Set(_normTokensFromArray(ACCUSATIVE_TAGS));
const NORM_GENITIVE = new Set(_normTokensFromArray(GENITIVE_TAGS));
const NORM_GENDER = new Set(_normTokensFromArray(GENDER_TAGS));
const NORM_NUMBER = new Set(_normTokensFromArray(NUMBER_TAGS));

function send(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch (_) {
    // ignore
  }
}

function tokenise(text) {
  return String(text || "")
    .replace(/[^\p{L}\s\-']/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.trim());
}

function grammemeIncludes(grammemes, probes) {
  if (!Array.isArray(grammemes)) return false;
  // normalize grammemes into tokens (uppercase, split combined markers)
  const tokens = _normTokensFromArray(grammemes);
  if (!tokens.length) return false;
  // if caller passed a precomputed normalized set, use it; otherwise normalize probes
  let probeSet = null;
  if (probes === NOMINATIVE_TAGS) probeSet = NORM_NOMINATIVE;
  else if (probes === ACCUSATIVE_TAGS) probeSet = NORM_ACCUSATIVE;
  else if (probes === GENITIVE_TAGS) probeSet = NORM_GENITIVE;
  else if (probes === GENDER_TAGS) probeSet = NORM_GENDER;
  else if (probes === NUMBER_TAGS) probeSet = NORM_NUMBER;
  else probeSet = new Set(_normTokensFromArray(probes));

  return tokens.some((t) => probeSet.has(t));
}

function parseHasGender(p, probeGender) {
  if (!p.grammemes) return false;
  const tokens = _normTokensFromArray(p.grammemes);
  if (!tokens.length) return false;
  let probeSet = null;
  if (probeGender === GENDER_TAGS) probeSet = NORM_GENDER;
  else probeSet = new Set(_normTokensFromArray(probeGender));
  return tokens.some((t) => probeSet.has(t));
}

function parseHasNumber(p, probeNumber) {
  if (!p.grammemes) return false;
  const tokens = _normTokensFromArray(p.grammemes);
  if (!tokens.length) return false;
  let probeSet = null;
  if (probeNumber === NUMBER_TAGS) probeSet = NORM_NUMBER;
  else probeSet = new Set(_normTokensFromArray(probeNumber));
  return tokens.some((t) => probeSet.has(t));
}

function nounAdjAgree(nounParses, adjParses) {
  // Возвращаем подсказку по падежу согласованной пары: "nom" | "acc" | null
  for (const n of nounParses) {
    for (const a of adjParses) {
      const nHasNom = grammemeIncludes(n.grammemes, NOMINATIVE_TAGS);
      const aHasNom = grammemeIncludes(a.grammemes, NOMINATIVE_TAGS);
      const nHasAcc = grammemeIncludes(n.grammemes, ACCUSATIVE_TAGS);
      const aHasAcc = grammemeIncludes(a.grammemes, ACCUSATIVE_TAGS);
      const nHasGen = grammemeIncludes(n.grammemes, GENITIVE_TAGS);
      const aHasGen = grammemeIncludes(a.grammemes, GENITIVE_TAGS);

      let caseTag = null;
      if ((nHasNom || aHasNom) && nHasNom && aHasNom) caseTag = "nom";
      else if ((nHasAcc || aHasAcc) && nHasAcc && aHasAcc) caseTag = "acc";
      else if ((nHasGen || aHasGen) && nHasGen && aHasGen) caseTag = "gen";
      else if (!nHasNom && !nHasAcc && !aHasNom && !aHasAcc) caseTag = null;
      else continue; // падежи не согласованы

      const nHasGender = parseHasGender(n, GENDER_TAGS);
      const aHasGender = parseHasGender(a, GENDER_TAGS);
      if (nHasGender && aHasGender) {
        const nGender = n.grammemes
          .map((g) => String(g).toLowerCase())
          .find((g) => GENDER_TAGS.includes(g));
        const aGender = a.grammemes
          .map((g) => String(g).toLowerCase())
          .find((g) => GENDER_TAGS.includes(g));
        if (nGender && aGender && nGender !== aGender) {
          // If genders disagree, allow agreement when case and number clearly match
          // (tolerant mode — handles parser mis-tags like "тунику" being SР).
          const nHasNumberInner = parseHasNumber(n, NUMBER_TAGS);
          const aHasNumberInner = parseHasNumber(a, NUMBER_TAGS);
          if (!(nHasNumberInner && aHasNumberInner)) continue;
          const nNumInner = n.grammemes
            .map((g) => String(g).toLowerCase())
            .find((g) => NUMBER_TAGS.includes(g));
          const aNumInner = a.grammemes
            .map((g) => String(g).toLowerCase())
            .find((g) => NUMBER_TAGS.includes(g));
          if (!nNumInner || !aNumInner || nNumInner !== aNumInner) continue;
        }
      }

      const nHasNumber = parseHasNumber(n, NUMBER_TAGS);
      const aHasNumber = parseHasNumber(a, NUMBER_TAGS);
      if (nHasNumber && aHasNumber) {
        const nNum = n.grammemes
          .map((g) => String(g).toLowerCase())
          .find((g) => NUMBER_TAGS.includes(g));
        const aNum = a.grammemes
          .map((g) => String(g).toLowerCase())
          .find((g) => NUMBER_TAGS.includes(g));
        if (nNum && aNum && nNum !== aNum) continue;
      }
      return caseTag;
    }
  }
  return null;
}

function getParses(morph, word) {
  const parses = [];

  try {
    if (typeof morph.getMorphInfo === "function") {
      const info = morph.getMorphInfo(word);
      if (info && Array.isArray(info)) {
        info.forEach((item) => {
          const pos = item.pos || item.grammar || item.tag || item[0] || "";
          const grammemes = item.grammemes || item.grammar || item.tags || [];
          const normal =
            item.normal ||
            item.normal_form ||
            item.base_form ||
            (item.dict && item.dict[0]) ||
            word;
          parses.push({
            pos: String(pos).toUpperCase(),
            grammemes: Array.isArray(grammemes)
              ? grammemes.map(String)
              : [String(grammemes)],
            normal,
          });
        });
      }
    }
  } catch (_e) {}

  if (parses.length === 0) {
    try {
      if (typeof morph.getAllFormsWithAncodes === "function") {
        const forms = morph.getAllFormsWithAncodes(word);
        if (forms && Array.isArray(forms)) {
          forms.forEach((f) => {
            // Some phpmorphy bindings return objects with `all` (strings) and `forms` arrays.
            if (f && f.all && Array.isArray(f.all)) {
              const alls = f.all || [];
              const formsArr = f.forms || [];
              for (let i = 0; i < alls.length; i++) {
                const formWord = formsArr && formsArr[i] ? formsArr[i] : "";
                if (formWord.toLowerCase() === word.toLowerCase()) {
                  const raw = String(alls[i] || "");
                  const parts = raw.split(/\s+/, 2);
                  const pos = parts[0] || "";
                  const gramsRaw = parts[1] || "";
                  const grammemes = gramsRaw.length
                    ? gramsRaw.split(",").map(String)
                    : [];
                  const normal =
                    formsArr && formsArr[i]
                      ? formsArr[i]
                      : formsArr && formsArr[0]
                      ? formsArr[0]
                      : word;
                  parses.push({
                    pos: String(pos).toUpperCase(),
                    grammemes,
                    normal,
                  });
                }
              }
              return;
            }

            const ancode = f.ancode || (Array.isArray(f) && f[1]) || null;
            let gram = null;
            try {
              if (ancode && typeof morph.getGramInfo === "function") {
                gram = morph.getGramInfo(ancode);
              }
            } catch (_e) {}
            const pos = (gram && (gram.pos || gram.POS)) || "";
            const grammemes =
              (gram && (gram.grammemes || gram.tags || gram.gram)) || [];
            let normal = word;
            try {
              if (typeof morph.getBaseForm === "function") {
                const base = morph.getBaseForm(word);
                if (base && base.length) normal = base[0];
              } else if (typeof morph.getNormalForms === "function") {
                const nf = morph.getNormalForms(word);
                if (nf && nf.length) normal = nf[0];
              }
            } catch (_e) {}
            parses.push({
              pos: String(pos).toUpperCase(),
              grammemes: Array.isArray(grammemes)
                ? grammemes.map(String)
                : [String(grammemes)],
              normal,
            });
          });
        }
      }
    } catch (_e) {}
  }

  const uniq = [];
  const seen = new Set();
  parses.forEach((p) => {
    const key = `${p.normal}||${p.pos}||${(p.grammemes || []).join(",")}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniq.push(p);
    }
  });
  return uniq;
}

function checkHeadline(morph, text) {
  const tokens = tokenise(text);
  // If the phrase starts with a preposition, treat as fragment/problem.
  try {
    const firstTok = tokens[0] ? String(tokens[0]).toUpperCase() : null;
    if (firstTok && PREPOSITIONS.includes(firstTok)) {
      return {
        ok: false,
        reason: `Первое слово "${tokens[0]}" — предлог; заголовок выглядит как фрагмент/объект без действия.`,
      };
    }
  } catch (_) {}
  const allParses = tokens.map((t) => ({
    token: t,
    parses: getParses(morph, t),
  }));

  // Fallback: for tokens with no parses, try a simple singularization heuristic
  // (strip common plural endings) and re-run parses — covers missing plural forms
  // in phpmorphy (e.g. "беговелы" -> "беговел").
  for (const ap of allParses) {
    if (ap.parses && ap.parses.length) continue;
    try {
      const t = ap.token;
      let alt = null;
      if (t.match(/[ыи]$/u)) alt = t.slice(0, -1);
      else if (t.match(/ов$/u)) alt = t.replace(/ов$/u, "");
      else if (t.match(/ев$/u)) alt = t.replace(/ев$/u, "");
      if (alt) {
        const altParses = getParses(morph, alt);
        if (altParses && altParses.length) {
          ap.parses = altParses;
          // keep original token text but use parses from alt form
        }
      }
    } catch (_) {}
  }

  const isNounPos = (pos) => {
    const p = String(pos || "").toUpperCase();
    return p === "S" || p === "С" || p === "NOUN";
  };

  const isAdjPos = (pos) => {
    const p = String(pos || "").toUpperCase();
    return p === "A" || p === "П" || p === "ADJ";
  };

  const hasVerb = allParses.some((tp) =>
    tp.parses.some((p) => {
      const pos = (p.pos || "").toString().toUpperCase();
      if (
        pos.includes("V") ||
        pos.includes("INF") ||
        pos.includes("VERB") ||
        pos === "ИНФИНИТИВ"
      )
        return true;
      if (
        p.grammemes &&
        p.grammemes.some((g) => String(g).toLowerCase().includes("инф"))
      )
        return true;
      return false;
    })
  );
  if (hasVerb) {
    return {
      ok: true,
      reason: "Есть глагол/инфинитив — заголовок содержит предикат.",
    };
  }

  const nounCandidates = [];
  let adjCandidates = [];
  allParses.forEach((tp, idx) => {
    let nounParses = tp.parses.filter((p) => {
      if (isNounPos(p.pos)) return true;
      if (
        p.grammemes &&
        p.grammemes.some((g) => String(g).toLowerCase().includes("сущ"))
      )
        return true;
      // Heuristic: if parse carries gender/number markers but not an explicit
      // infinitive marker, treat it as a possible noun form (covers cases
      // where phpmorphy returns odd POS tags for surface forms).
      try {
        const hasGender = parseHasGender(p, GENDER_TAGS);
        const hasNumber = parseHasNumber(p, NUMBER_TAGS);
        const gramsStr = (p.grammemes || []).join(",").toLowerCase();
        const hasInf = gramsStr.includes("инф");
        if ((hasGender || hasNumber) && !hasInf) return true;
      } catch (_) {}
      return false;
    });

    // If phpmorphy returned no noun parses, but token is known product
    // noun in our whitelist, synthesize a simple noun parse so the token
    // will be considered an explicit noun candidate.
    try {
      if ((!nounParses || nounParses.length === 0) && tp.token) {
        const tl = String(tp.token || "").toLowerCase();
        if (PRODUCT_WHITELIST.has(tl)) {
          nounParses = [
            {
              pos: "С",
              grammemes: ["ИМ"],
              normal: String(tp.token || "").toUpperCase(),
            },
          ];
        }
      }
    } catch (_) {}
    if (nounParses.length) {
      const prevToken = tokens[idx - 1] ? tokens[idx - 1].toUpperCase() : null;
      const inPrepositional = prevToken
        ? PREPOSITIONS.includes(prevToken)
        : false;
      // Consider a candidate "explicit" noun when it's clearly a noun.
      // Demote cases where the dictionary lists substantivized adjective forms
      // (POS 'С' combined with quality marker 'КАЧ') — treat these as not-explicit
      // to prefer real nouns when available.
      const hasAdjParseOnToken = tp.parses.some((pp) => isAdjPos(pp.pos));
      const explicit = nounParses.some((p) => {
        try {
          if (isNounPos(p.pos)) return true;
          const grams = (p.grammemes || []).map((g) => String(g).toUpperCase());
          if (grams.some((g) => g.includes("СУЩ"))) return true;
          // If POS is 'С' (substantive) but grammemes include 'КАЧ' (quality),
          // it's likely a substantivized adjective — treat as non-explicit.
          if (String(p.pos || "").toUpperCase() === "С") {
            if (grams.some((g) => g.includes("КАЧ") || g.includes("КАЧЕ"))) {
              return false;
            }
            return true;
          }
        } catch (_) {}
        return false;
      });
      // If the token also has an adjective parse, treat ambiguous noun parses
      // (substantivized forms) as non-explicit to prefer real nouns.
      // Additionally probe phpmorphy graminfo for quality marker (КАЧ).
      let hasQualityMarker = false;
      try {
        if (typeof morph.getAllFormsWithGramInfo === "function") {
          const gi = morph.getAllFormsWithGramInfo(tp.token);
          if (Array.isArray(gi)) {
            for (const entry of gi) {
              const alls = entry && entry.all ? entry.all : [];
              for (const raw of alls) {
                if (
                  String(raw || "")
                    .toUpperCase()
                    .includes("КАЧ")
                ) {
                  hasQualityMarker = true;
                  break;
                }
              }
              if (hasQualityMarker) break;
            }
          }
        }
      } catch (_) {}
      // Разрешаем считать кандидата явным даже при наличии разборов как прилагательное
      // (phpmorphy часто даёт такие двойные теги для нормальных существительных).
      // Фильтруем только случаи с маркером качества, где это скорее субстантивированное
      // прилагательное.
      // Treat as non-explicit only when there is both a quality marker AND
      // an adjective parse on the token (likely a substantivized adjective).
      let explicitFinal = explicit && !(hasQualityMarker && hasAdjParseOnToken);
      // Heuristic: if token surface looks like a plural noun (typical endings
      // 'и' or 'ы') and not marked as quality, accept as explicit noun —
      // covers cases like "кроссовки" where parser tags are noisy.
      try {
        if (!explicitFinal) {
          const tnorm = String(tp.token || "").toLowerCase();
          if (!hasQualityMarker && /[ыи]$/u.test(tnorm)) explicitFinal = true;
        }
      } catch (_) {}
      nounCandidates.push({
        token: tp.token,
        parses: nounParses,
        idx,
        explicit: explicitFinal,
        inPrepositional,
      });
    }

    const adjParses = tp.parses.filter((p) => {
      if (isAdjPos(p.pos)) return true;
      return (
        p.grammemes &&
        p.grammemes.some((g) => String(g).toLowerCase().includes("прил"))
      );
    });
    if (adjParses.length)
      adjCandidates.push({ token: tp.token, parses: adjParses, idx });
  });

  // Remove adjectives that are inside prepositional phrases — they do not
  // directly modify the main noun (e.g. "туники для полных").
  adjCandidates = adjCandidates.filter((adj) => {
    const prev = tokens[adj.idx - 1] ? tokens[adj.idx - 1].toUpperCase() : null;
    return !(prev && PREPOSITIONS.includes(prev));
  });

  // If an adjective candidate is just an alternate parse of the same token
  // which already has an explicit noun parse, ignore that adjective —
  // e.g. phpmorphy returns adjective parses for "носки" and we must not
  // treat that as a separate modifying adjective.
  adjCandidates = adjCandidates.filter(
    (adj) => !nounCandidates.some((nc) => nc.idx === adj.idx && nc.explicit)
  );

  // Heuristic: if there's an earlier explicit noun and a later noun that
  // appears to be genitive (e.g. "... больших размеров"), prefer the
  // earlier explicit noun as the headline subject. This avoids choosing
  // the genitive noun as the head.
  try {
    if (nounCandidates.length > 1) {
      const explicitLeft = nounCandidates
        .filter((nc) => nc.explicit && !nc.inPrepositional)
        .sort((a, b) => a.idx - b.idx)[0];
      const laterGen = nounCandidates.find(
        (nc) =>
          nc.idx > (explicitLeft ? explicitLeft.idx : -1) &&
          nc.parses.some((p) => grammemeIncludes(p.grammemes, GENITIVE_TAGS))
      );
      if (explicitLeft && laterGen) {
        // choose explicitLeft as head immediately
        const headToken = explicitLeft.token;
        return {
          ok: true,
          reason: `Главное существительное "${headToken}" выбрано как тема: найден явный левый noun перед генитивным оборотом.`,
        };
      }
    }
  } catch (_) {}

  if (nounCandidates.length === 0) {
    return {
      ok: false,
      reason:
        "Нет глагола и не обнаружено явного существительного — возможно неполный заголовок.",
    };
  }

  // Strict rule: если нет глагола, требуем, чтобы первое найденное
  // (левое) явное существительное имело явный номинативный разбор.
  // В противном случае считаем заголовок некорректным (фрагментом).
  try {
    if (!hasVerb) {
      const firstNoun = [...nounCandidates].sort((a, b) => a.idx - b.idx)[0];
      // If the first noun is explicitly accusative, mark as problem.
      try {
        // Flag only when token has accusative parses and no nominative parses
        if (
          firstNoun &&
          firstNoun.parses.some((p) =>
            grammemeIncludes(p.grammemes, ACCUSATIVE_TAGS)
          ) &&
          !firstNoun.parses.some((p) =>
            grammemeIncludes(p.grammemes, NOMINATIVE_TAGS)
          )
        ) {
          return {
            ok: false,
            reason: `Первое существительное "${firstNoun.token}" согласовано в винительном падеже и нет глагола — вероятный фрагмент/объект без действия.`,
          };
        }
      } catch (_) {}
      // NOTE: removed strict requirement for explicit nominative when no verb
    }
  } catch (_) {}

  let chosen = null;
  let chosenCase = null;
  let agreementFound = false;
  let chosenAdjIdx = null;
  if (adjCandidates.length > 0) {
    for (const adj of adjCandidates) {
      // Skip adjectives that are part of prepositional phrases (they don't
      // directly modify the head noun), e.g. "туники для полных" -> "полных" is in prep phrase.
      const adjPrevToken = tokens[adj.idx - 1]
        ? tokens[adj.idx - 1].toUpperCase()
        : null;
      if (adjPrevToken && PREPOSITIONS.includes(adjPrevToken)) continue;
      const sortedByDist = [...nounCandidates].sort((a, b) => {
        // prefer explicit nouns first, then by proximity to the adjective
        if (a.explicit && !b.explicit) return -1;
        if (!a.explicit && b.explicit) return 1;
        return Math.abs(a.idx - adj.idx) - Math.abs(b.idx - adj.idx);
      });
      for (const n of sortedByDist) {
        if (n.idx === adj.idx) continue; // skip pairing token with itself
        const agreeCase = nounAdjAgree(n.parses, adj.parses);
        if (agreeCase !== null) {
          // Strict mode: prefer explicit (real) noun candidates as heads.
          // However, tolerate some parser mis-tags: if a non-explicit noun
          // parse still carries clear gender+number markers and does not
          // look like a quality/substantivized adjective, accept it.
          if (!n.explicit) {
            const tolerantAccept = n.parses.some((p) => {
              try {
                const hasG = parseHasGender(p, GENDER_TAGS);
                const hasN = parseHasNumber(p, NUMBER_TAGS);
                const gramsStr = (p.grammemes || []).join(",").toLowerCase();
                const looksQuality =
                  gramsStr.includes("кач") ||
                  gramsStr.includes("качe") ||
                  gramsStr.includes("качeн");
                return hasG && hasN && !looksQuality;
              } catch (_) {
                return false;
              }
            });
            if (!tolerantAccept) {
              // skip substantivized adjective candidates under strict rule
              continue;
            }
          }
          chosen = n;
          chosenCase = agreeCase; // nom/acc
          // If the chosen noun is not explicit but there is a nearby explicit
          // noun candidate, prefer that explicit noun as the head — this
          // ensures real nouns (e.g. "кроссовки") are chosen over
          // substantivized/ad-hoc parses like "большого".
          if (!chosen.explicit) {
            const explicitCandidates = nounCandidates
              .filter((nc) => nc.explicit && !nc.inPrepositional)
              .map((nc) => ({ nc, dist: Math.abs(nc.idx - adj.idx) }))
              .sort((a, b) => a.dist - b.dist);
            if (explicitCandidates.length) {
              const rep = explicitCandidates[0].nc;
              chosen = rep;
              chosenCase = rep.parses.some((p) =>
                grammemeIncludes(p.grammemes, NOMINATIVE_TAGS)
              )
                ? "nom"
                : chosenCase;
            }
          }
          agreementFound = true;
          chosenAdjIdx = adj.idx;
          break;
        }
      }
      if (chosen) break;
    }

    if (!agreementFound) {
      // Попробуем толерантный fallback: найти ближайшее существительное,
      // которое хотя бы потенциально согласуется по номинативу/числу/роду
      // с прилагательным, и принять его как тему. Это покрывает случаи,
      // когда разборы неполные или некорректные у phpmorphy.
      for (const adj of adjCandidates) {
        const sortedByDist = [...nounCandidates].sort((a, b) => {
          // prefer explicit nouns first, then by proximity to the adjective
          if (a.explicit && !b.explicit) return -1;
          if (!a.explicit && b.explicit) return 1;
          return Math.abs(a.idx - adj.idx) - Math.abs(b.idx - adj.idx);
        });
        for (const n of sortedByDist) {
          if (n.idx === adj.idx) continue;
          // prefer explicit nouns
          if (n.explicit) {
            const nHasNom = n.parses.some((p) =>
              grammemeIncludes(p.grammemes, NOMINATIVE_TAGS)
            );
            const adjHasNom = adj.parses.some((p) =>
              grammemeIncludes(p.grammemes, NOMINATIVE_TAGS)
            );
            if (nHasNom || adjHasNom) {
              chosen = n;
              chosenCase = "nom";
              agreementFound = true;
              break;
            }
            // match by number
            const nHasNum = n.parses.some((p) =>
              parseHasNumber(p, NUMBER_TAGS)
            );
            const adjHasNum = adj.parses.some((p) =>
              parseHasNumber(p, NUMBER_TAGS)
            );
            if (nHasNum && adjHasNum) {
              chosen = n;
              chosenCase = "nom";
              agreementFound = true;
              break;
            }
          } else {
            // non-explicit noun: accept if it has gender or number marker and
            // adjective has matching marker
            const nHasG = n.parses.some((p) => parseHasGender(p, GENDER_TAGS));
            const adjHasG = adj.parses.some((p) =>
              parseHasGender(p, GENDER_TAGS)
            );
            const nHasN = n.parses.some((p) => parseHasNumber(p, NUMBER_TAGS));
            const adjHasN = adj.parses.some((p) =>
              parseHasNumber(p, NUMBER_TAGS)
            );
            if ((nHasG && adjHasG) || (nHasN && adjHasN)) {
              chosen = n;
              chosenCase = "nom";
              agreementFound = true;
              break;
            }
          }
        }
        if (agreementFound) break;
      }

      if (!agreementFound) {
        // Несогласование при наличии прилагательных — PROBLEM
        return {
          ok: false,
          reason:
            "Прилагательные не согласованы с существительными — ошибка согласования.",
        };
      }
    }

    // If the chosen candidate is a substantivized adjective (not explicit),
    // but there is a nearby explicit noun candidate, prefer that explicit
    // noun when it matches the same case (or has nominative) — this avoids
    // treating substanivized adjectives as heads when a real noun is present.
    if (chosen && !chosen.explicit) {
      const sameCasePrefer = (nc) => {
        if (!chosenCase) return false;
        return nc.parses.some((p) => {
          if (chosenCase === "nom")
            return grammemeIncludes(p.grammemes, NOMINATIVE_TAGS);
          if (chosenCase === "acc")
            return grammemeIncludes(p.grammemes, ACCUSATIVE_TAGS);
          return false;
        });
      };

      // search by distance from the adjective (we have adj variable in outer loop scope)
      const adjIdx = typeof chosenAdjIdx === "number" ? chosenAdjIdx : null;
      const explicitCandidates = nounCandidates
        .filter((nc) => nc.explicit)
        .map((nc) => ({
          nc,
          dist: adjIdx === null ? 0 : Math.abs(nc.idx - adjIdx),
        }))
        .sort((a, b) => a.dist - b.dist);

      let replacement = null;
      for (const item of explicitCandidates) {
        const nc = item.nc;
        if (sameCasePrefer(nc)) {
          replacement = nc;
          break;
        }
      }
      // fallback: prefer nearest explicit noun that has nominative parse
      if (!replacement) {
        replacement = explicitCandidates.find((it) =>
          it.nc.parses.some((p) =>
            grammemeIncludes(p.grammemes, NOMINATIVE_TAGS)
          )
        )?.nc;
      }
      if (replacement) {
        chosen = replacement;
        chosenCase = chosen.parses.some((p) =>
          grammemeIncludes(p.grammemes, NOMINATIVE_TAGS)
        )
          ? "nom"
          : chosenCase;
      }
    }

    // Убираем логику nomOverride, чтобы не менять chosenCase на nom, если согласование acc
    // if (chosen) {
    //   const chosenHasNom = chosen.parses.some((p) =>
    //     grammemeIncludes(p.grammemes, NOMINATIVE_TAGS)
    //   );
    //   if (!chosenHasNom) {
    //     const nomOverride = nounCandidates.find((nc) =>
    //       nc.parses.some((p) => grammemeIncludes(p.grammemes, NOMINATIVE_TAGS))
    //     );
    //     if (nomOverride) {
    //       chosen = nomOverride;
    //       chosenCase = "nom";
    //     }
    //   }
    // }
  }

  // Если согласование с прилагательным дало винительный падеж (acc),
  // но в тексте есть более раннее явное существительное в именительном падеже,
  // предпочтём его как тему/заголовок. (требуем explicit)
  if (chosen && chosenCase === "acc") {
    // If the chosen candidate is explicit and looks like a surface plural
    // noun (or carries number/gender markers), prefer treating it as a
    // nominative head rather than a fragment in accusative.
    if (
      chosen.explicit &&
      (chosen.parses.some((p) => parseHasNumber(p, NUMBER_TAGS)) ||
        /[ыи]$/u.test(String(chosen.token || "").toLowerCase()))
    ) {
      return {
        ok: true,
        reason: `Главное существительное "${chosen.token}" выглядит как название (явное существительное) — принимаем как именительный.`,
      };
    }

    const earlierNom = nounCandidates.find(
      (nc) =>
        nc.idx < chosen.idx &&
        nc.explicit &&
        nc.parses.some((p) => grammemeIncludes(p.grammemes, NOMINATIVE_TAGS))
    );
    if (earlierNom) {
      chosen = earlierNom;
      chosenCase = "nom";
    }
  }

  // Если после согласования падеж не определён (null) или не nom/acc,
  // но есть явный номинативный кандидат, предпочитаем его.
  if (chosen && chosenCase !== "nom" && chosenCase !== "acc") {
    const nomOverride = nounCandidates.find(
      (nc) =>
        nc.explicit &&
        nc.parses.some((p) => grammemeIncludes(p.grammemes, NOMINATIVE_TAGS))
    );
    if (nomOverride) {
      chosen = nomOverride;
      chosenCase = "nom";
    }
  }

  // Эвристика с предлогами: если выбранное слово стоит после предлога,
  // а есть явный номинатив вне предл. оборота — предпочитаем его как head.
  if (chosen) {
    const nomOutsidePrep = nounCandidates.find(
      (nc) =>
        nc.explicit &&
        !nc.inPrepositional &&
        nc.parses.some((p) => grammemeIncludes(p.grammemes, NOMINATIVE_TAGS))
    );
    if (nomOutsidePrep) {
      const chosenIsPrep = !!chosen.inPrepositional;
      if (chosenIsPrep || chosenCase !== "nom") {
        chosen = nomOutsidePrep;
        chosenCase = "nom";
      }
    }
  }

  // Prefer an earlier explicit noun over a later genitive head (e.g.
  // "кроссовки ... больших размеров"). If the currently chosen token
  // is genitive (or parsed as genitive), and there exists a left-side
  // explicit noun candidate (not inside a prepositional phrase), prefer
  // that earlier explicit noun as the headline subject.
  if (chosen) {
    try {
      const chosenHasGen =
        chosenCase === "gen" ||
        chosen.parses.some((p) => grammemeIncludes(p.grammemes, GENITIVE_TAGS));
      if (chosenHasGen) {
        const earlierExplicit = nounCandidates.find(
          (nc) => nc.idx < chosen.idx && nc.explicit && !nc.inPrepositional
        );
        if (earlierExplicit) {
          chosen = earlierExplicit;
          chosenCase = "nom";
        }
      }
    } catch (_) {}
  }

  if (!chosen) {
    // Strict rule: choose nominative only among explicit nouns. If none,
    // treat as PROBLEM (no real noun found).
    const nomCandidate = nounCandidates.find(
      (nc) =>
        nc.explicit &&
        nc.parses.some((p) => grammemeIncludes(p.grammemes, NOMINATIVE_TAGS))
    );
    if (nomCandidate) {
      chosen = nomCandidate;
      chosenCase = "nom";
    } else {
      // Толерантный fallback: если нет явного номинативного кандидата, но
      // есть кандидат (не в предл. обороте) с явными маркерами рода/числа,
      // примем его за тему (обычная ошибка разбора у phpmorphy).
      const tolerant = nounCandidates.find(
        (nc) =>
          !nc.inPrepositional &&
          nc.parses.some((p) => {
            try {
              // Accept if parser signals number OR gender (relaxed),
              // and there's no obvious quality marker.
              const hasG = parseHasGender(p, GENDER_TAGS);
              const hasN = parseHasNumber(p, NUMBER_TAGS);
              const grams = (p.grammemes || []).join(",").toLowerCase();
              const looksQuality = grams.includes("кач");
              return (hasG || hasN) && !looksQuality;
            } catch (_) {
              return false;
            }
          })
      );
      if (tolerant) {
        chosen = tolerant;
        chosenCase = "nom";
      } else {
        return {
          ok: false,
          reason:
            "Нет явного существительного в именительном падеже (только субстантивированные прилагательные) — считаем некорректным.",
        };
      }
    }
  }

  if (!chosen) {
    chosen = nounCandidates[nounCandidates.length - 1];
    chosenCase = null;
  }

  const headToken = chosen.token;

  // Если из согласования с прилагательным уже знаем падеж, используем его в первую очередь.
  if (chosenCase === "nom") {
    return {
      ok: true,
      reason: `Главное существительное "${headToken}" согласовано в именительном падеже — заголовок корректен как название.`,
    };
  }
  if (chosenCase === "acc") {
    return {
      ok: false,
      reason: `Главное существительное "${headToken}" согласовано в винительном падеже и нет глагола — вероятный фрагмент/объект без действия.`,
    };
  }

  // Если есть ИМ., считаем корректным названием даже при наличии других разборов.
  const hasNom =
    chosen.parses.some((p) => {
      const grams = Array.isArray(p.grammemes) ? p.grammemes.map(String) : [];
      const hasZero = grams.some((g) => String(g).trim() === "0");
      return (
        grammemeIncludes(p.grammemes, NOMINATIVE_TAGS) ||
        (chosen.explicit && hasZero)
      );
    }) ||
    (chosen.explicit &&
      /[ыи]$/u.test(String(chosen.token || "").toLowerCase()));
  if (hasNom) {
    return {
      ok: true,
      reason: `Главное существительное "${headToken}" может быть в именительном падеже — заголовок корректен как название.`,
    };
  }

  // Иначе, если встречается только В.Н., считаем фрагментом без предиката.
  const hasAcc = chosen.parses.some((p) =>
    grammemeIncludes(p.grammemes, ACCUSATIVE_TAGS)
  );
  if (hasAcc) {
    return {
      ok: false,
      reason: `Главное существительное "${headToken}" в винительном падеже и нет глагола — вероятный фрагмент/объект без действия.`,
    };
  }
  return {
    ok: false,
    reason: `Нет глагола; падеж основного существительного ("${headToken}") не однозначен — нужен контекст.`,
  };
}

function parseConfig() {
  let buf = "";
  return new Promise((resolve, reject) => {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
      const parts = buf.split("\n");
      buf = parts.pop() || "";
      for (const line of parts) {
        if (!line.trim()) continue;
        try {
          const cfg = JSON.parse(line);
          resolve(cfg);
          process.stdin.pause();
          return;
        } catch (e) {
          reject(e);
        }
      }
    });
    process.stdin.on("end", () => {
      if (buf.trim()) {
        try {
          const cfg = JSON.parse(buf);
          resolve(cfg);
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error("No config provided"));
      }
    });
  });
}

async function main() {
  try {
    const DEBUG_WORDS = process.env.MORPH_DEBUG_WORDS;

    let config = null;
    let projectId = null;
    let dbPath = null;
    if (!DEBUG_WORDS) {
      config = await parseConfig();
      projectId = Number(config?.projectId);
      dbPath = config?.dbPath || process.env.DB_PATH;
      if (!projectId || !dbPath) {
        throw new Error("projectId and dbPath are required");
      }
      // attach for later use
      config.projectId = projectId;
      config.dbPath = dbPath;
    }

    let morph;
    // Try each candidate dict path until initialization succeeds
    const morphOptions = {
      lang: "ru_RU",
      storage: PhpMorphy.STORAGE_MEM,
      predict_by_suffix: true,
      predict_by_db: true,
      graminfo_as_text: true,
      use_ancodes_cache: true,
      resolve_ancodes: PhpMorphy.RESOLVE_ANCODES_AS_TEXT,
    };
    let lastInitError = null;
    for (const candidate of MORPHY_DICT_CANDIDATES) {
      try {
        morph = new PhpMorphy(candidate, morphOptions);
        send({
          type: "info",
          message: "phpmorphy init ok",
          dictPath: candidate,
        });
        break;
      } catch (e) {
        lastInitError = e;
        send({
          type: "info",
          message: "phpmorphy init failed for candidate",
          dictPath: candidate,
          detail: String(e && e.message ? e.message : e),
        });
      }
    }
    if (!morph) {
      send({
        type: "error",
        message: "phpmorphy init failed for all candidates",
        detail: String(
          lastInitError && lastInitError.message
            ? lastInitError.message
            : lastInitError
        ),
        tried: MORPHY_DICT_CANDIDATES,
      });
      process.exit(1);
    }

    // Debug: if MORPH_DEBUG_WORDS is set (comma-separated words), dump parses and exit.
    if (DEBUG_WORDS) {
      const words = String(DEBUG_WORDS)
        .split(",")
        .map((w) => w.trim())
        .filter(Boolean);

      // Quick check: if initial morph returns empty grammemes/pos, try fallback init using language code
      try {
        const testWord = words[0] || "тест";
        const testParses = getParses(morph, testWord);
        const allEmpty =
          !testParses ||
          testParses.length === 0 ||
          testParses.every((p) => {
            const posEmpty = !p.pos || String(p.pos).trim() === "";
            const gramsEmpty = !p.grammemes || p.grammemes.length === 0;
            return posEmpty && gramsEmpty;
          });
        if (allEmpty) {
          try {
            send({
              type: "info",
              message:
                "initial phpmorphy returned empty grammemes; trying fallback init with language 'ru'",
            });
            morph = new PhpMorphy("ru", {
              storage: PhpMorphy.STORAGE_MEM,
              predict_by_suffix: true,
              predict_by_db: true,
              graminfo_as_text: true,
              use_ancodes_cache: true,
              resolve_ancodes: PhpMorphy.RESOLVE_ANCODES_AS_TEXT,
            });
          } catch (_e) {
            // fallback init failed; we'll continue with original instance
          }
        }
      } catch (_e) {}

      const dump = [];
      for (const w of words) {
        try {
          const parses = getParses(morph, w);
          dump.push({ word: w, parses });
        } catch (e) {
          dump.push({ word: w, error: String(e && e.message ? e.message : e) });
        }
      }
      // Доп. отладка: если передали несколько токенов, соберём их в фразу
      // и сразу прогоняем через checkHeadline, чтобы увидеть итоговое решение.
      try {
        const phrase = words.join(" ").trim();
        if (phrase) {
          const check = checkHeadline(morph, phrase);
          send({ type: "debug-check", phrase, result: check });
        }
      } catch (e) {
        send({
          type: "debug-check-error",
          detail: String(e && e.message ? e.message : e),
        });
      }
      // Более детальная диагностика: перечислим кандидатные существительные/прилагательные
      try {
        const localIsNounPos = (pos) => {
          const p = String(pos || "").toUpperCase();
          return p === "S" || p === "С" || p === "NOUN";
        };
        const localIsAdjPos = (pos) => {
          const p = String(pos || "").toUpperCase();
          return p === "A" || p === "П" || p === "ADJ";
        };
        const allParsesLocal = dump.map((d) => ({
          token: d.word,
          parses: d.parses || [],
        }));
        const nounCandidatesLocal = [];
        const adjCandidatesLocal = [];
        allParsesLocal.forEach((tp, idx) => {
          const nounParses = (tp.parses || []).filter((p) => {
            if (localIsNounPos(p.pos)) return true;
            if (
              p.grammemes &&
              p.grammemes.some((g) => String(g).toLowerCase().includes("сущ"))
            )
              return true;
            try {
              const hasGender = parseHasGender(p, GENDER_TAGS);
              const hasNumber = parseHasNumber(p, NUMBER_TAGS);
              const gramsStr = (p.grammemes || []).join(",").toLowerCase();
              const hasInf = gramsStr.includes("инф");
              if ((hasGender || hasNumber) && !hasInf) return true;
            } catch (_) {}
            return false;
          });
          if (nounParses.length) {
            const prevToken = words[idx - 1]
              ? words[idx - 1].toUpperCase()
              : null;
            const inPrepositional = prevToken
              ? PREPOSITIONS.includes(prevToken)
              : false;
            const hasAdjParseOnToken = (tp.parses || []).some((pp) =>
              localIsAdjPos(pp.pos)
            );
            let explicit = nounParses.some((p) => {
              try {
                if (localIsNounPos(p.pos)) return true;
                const grams = (p.grammemes || []).map((g) =>
                  String(g).toUpperCase()
                );
                if (grams.some((g) => g.includes("СУЩ"))) return true;
                if (String(p.pos || "").toUpperCase() === "С") {
                  if (
                    grams.some((g) => g.includes("КАЧ") || g.includes("КАЧЕ"))
                  )
                    return false;
                  return true;
                }
              } catch (_) {}
              return false;
            });
            let hasQualityMarker = false;
            try {
              if (typeof morph.getAllFormsWithGramInfo === "function") {
                const gi = morph.getAllFormsWithGramInfo(tp.token);
                if (Array.isArray(gi)) {
                  for (const entry of gi) {
                    const alls = entry && entry.all ? entry.all : [];
                    for (const raw of alls) {
                      if (
                        String(raw || "")
                          .toUpperCase()
                          .includes("КАЧ")
                      ) {
                        hasQualityMarker = true;
                        break;
                      }
                    }
                    if (hasQualityMarker) break;
                  }
                }
              }
            } catch (_) {}
            let explicitFinal =
              explicit && !(hasQualityMarker && hasAdjParseOnToken);
            try {
              if (!explicitFinal) {
                const tnorm = String(tp.token || "").toLowerCase();
                if (!hasQualityMarker && /[ыи]$/u.test(tnorm))
                  explicitFinal = true;
              }
            } catch (_) {}
            nounCandidatesLocal.push({
              token: tp.token,
              parses: nounParses,
              idx,
              explicit: explicitFinal,
              inPrepositional,
            });
          }
          const adjParses = (tp.parses || []).filter((p) => {
            if (localIsAdjPos(p.pos)) return true;
            return (
              p.grammemes &&
              p.grammemes.some((g) => String(g).toLowerCase().includes("прил"))
            );
          });
          if (adjParses.length)
            adjCandidatesLocal.push({
              token: tp.token,
              parses: adjParses,
              idx,
            });
        });
        send({
          type: "debug-nounCandidates",
          nounCandidates: nounCandidatesLocal,
        });
        send({
          type: "debug-adjCandidates",
          adjCandidates: adjCandidatesLocal,
        });
      } catch (e) {
        send({
          type: "debug-diag-error",
          detail: String(e && e.message ? e.message : e),
        });
      }
      const dumpPath = path.join(os.tmpdir(), `morph-dump-${Date.now()}.json`);
      try {
        fs.writeFileSync(dumpPath, JSON.stringify(dump, null, 2), "utf8");
        send({ type: "debug-done", file: dumpPath });
        process.exit(0);
      } catch (e) {
        send({
          type: "error",
          message: "dump write failed",
          detail: String(e && e.message ? e.message : e),
        });
        process.exit(1);
      }
    }

    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");

    const totalRow = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM keywords WHERE project_id = ? AND is_keyword = 1 AND (is_valid_headline IS NULL)"
      )
      .get(projectId);
    const total = Number(totalRow?.cnt || 0);
    if (!total) {
      send({ type: "complete", processed: 0, total: 0 });
      return;
    }

    // Важно: нельзя использовать OFFSET при фильтре IS NULL, т.к. после
    // обновления строк набор уменьшается и смещается — мы будем пропускать
    // хвост. Используем курсор по id > lastId.
    const selectStmt = db.prepare(
      "SELECT id, keyword FROM keywords WHERE project_id = ? AND is_keyword = 1 AND (is_valid_headline IS NULL) AND id > ? ORDER BY id LIMIT ?"
    );
    const updateStmt = db.prepare(
      "UPDATE keywords SET is_valid_headline = ?, validation_reason = ? WHERE id = ?"
    );

    let processed = 0;
    let lastId = 0;

    while (processed < total) {
      const rows = selectStmt.all(projectId, lastId, MORPH_BATCH_SIZE);
      if (!rows.length) break;

      const tx = db.transaction((batch) => {
        for (const row of batch) {
          const res = checkHeadline(morph, row.keyword);
          updateStmt.run(res.ok ? 1 : 0, res.reason || null, row.id);
          processed += 1;
          if (row.id > lastId) lastId = row.id;
        }
      });
      tx.immediate(rows);

      const percent = total > 0 ? Math.round((processed / total) * 100) : 100;
      send({ type: "processing", processed, total, percent });
    }

    send({ type: "complete", processed, total });
  } catch (err) {
    send({
      type: "error",
      message: err && err.message ? err.message : String(err),
    });
    process.exit(1);
  }
}

main();
