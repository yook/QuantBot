const cheerio = require("cheerio");
const { JSDOM } = require("jsdom");

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferAttrNameFromSelector(selector) {
  const selectorText = String(selector || "");
  if (!selectorText) return "";

  const matches = [...selectorText.matchAll(/\[([^\]]+)\]/g)];
  if (!matches.length) return "";

  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const body = String(
      matches[i] && matches[i][1] ? matches[i][1] : "",
    ).trim();
    if (!body) continue;

    const attrMatch = body.match(/^\s*([^\s~|^$*!=>\]]+)\s*(?:[~|^$*]?=|$)/);
    const attr = String(attrMatch && attrMatch[1] ? attrMatch[1] : "").trim();
    if (attr) return attr;
  }

  return "";
}

function textArray($, selector) {
  return $(selector)
    .map((i, el) => $(el).text().trim())
    .get();
}

function attrArray($, selector, attrName) {
  const resolvedAttrName =
    String(attrName || "").trim() || inferAttrNameFromSelector(selector);

  if (!resolvedAttrName) {
    return [];
  }

  return $(selector)
    .map((i, el) => $(el).attr(resolvedAttrName))
    .get()
    .filter((value) => value != null)
    .map((value) => String(value));
}

function ownTextArray($, selector) {
  return $(selector)
    .map((i, el) =>
      (el.children || [])
        .filter((child) => child && child.type === "text")
        .map((child) => child.data || "")
        .join("")
        .trim(),
    )
    .get();
}

function firstNumber(value) {
  const compact = String(value || "").replace(/(\d)\s+(?=\d)/g, "$1");
  const match = compact.match(/-?\d+(?:[.,]\d+)?/);
  return match ? match[0].replace(/,/g, ".") : "";
}

function applyRegex(value, pattern) {
  if (!pattern) return "";
  try {
    const regex = new RegExp(pattern);
    const match = String(value || "").match(regex);
    if (!match) return "";
    return match[1] || match[0] || "";
  } catch (_) {
    return "";
  }
}

function evaluateXPath(window, selector) {
  const nodes = [];
  const result = window.document.evaluate(
    selector,
    window.document,
    null,
    window.XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null,
  );

  for (let i = 0; i < result.snapshotLength; i += 1) {
    nodes.push(result.snapshotItem(i));
  }

  return nodes.filter(Boolean);
}

function nodeText(node) {
  if (!node) return "";
  if (node.nodeType === 2 || node.nodeType === 3 || node.nodeType === 4) {
    return String(node.nodeValue || "").trim();
  }
  return String(node.textContent || "").trim();
}

function nodeAttr(node, attrName) {
  const resolvedAttrName = String(attrName || "").trim();

  if (node && node.nodeType === 2) {
    return resolvedAttrName ? "" : String(node.nodeValue || "");
  }
  if (!resolvedAttrName || !node || typeof node.getAttribute !== "function") {
    return "";
  }

  const value = node.getAttribute(resolvedAttrName);
  return value == null ? "" : String(value);
}

function nodeInnerHtml(node) {
  if (!node) return "";
  if (typeof node.innerHTML === "string") return node.innerHTML;
  return nodeText(node);
}

function nodeOuterHtml(node) {
  if (!node) return "";
  if (typeof node.outerHTML === "string") return node.outerHTML;
  return nodeText(node);
}

function nodeOwnText(node) {
  if (!node || !node.childNodes) return nodeText(node);
  return Array.from(node.childNodes)
    .filter((child) => child && (child.nodeType === 3 || child.nodeType === 4))
    .map((child) => child.nodeValue || "")
    .join("")
    .trim();
}

function textArrayXPath(nodes) {
  return nodes.map(nodeText).filter(Boolean);
}

function attrArrayXPath(nodes, attrName) {
  return nodes
    .map((node) => nodeAttr(node, attrName))
    .filter((value) => value !== "");
}

function ownTextArrayXPath(nodes) {
  return nodes.map(nodeOwnText).filter(Boolean);
}

function extractFieldFromCss($, field) {
  switch (field.find) {
    case "text":
      return textArray($, field.selector).join("; ");
    case "attr":
      return attrArray($, field.selector, field.attrClass).join("; ");
    case "html":
      return $(field.selector)
        .map((i, el) => $(el).html() || "")
        .get()
        .join("; ");
    case "outerHtml":
      return $(field.selector)
        .map((i, el) => $.html(el))
        .get()
        .join("; ");
    case "firstText":
      return textArray($, field.selector)[0] || "";
    case "firstAttr":
      return attrArray($, field.selector, field.attrClass)[0] || "";
    case "exists":
      return ($(field.selector).length > 0) + "";
    case "matchesRegex":
      return applyRegex(
        textArray($, field.selector).join("; "),
        field.attrClass,
      );
    case "allTextArray":
      return textArray($, field.selector);
    case "allAttrArray":
      return attrArray($, field.selector, field.attrClass);
    case "uniqueText":
      return Array.from(new Set(textArray($, field.selector))).join("; ");
    case "countTextLength":
      return String(textArray($, field.selector).join("; ").length);
    case "countAttrLength":
      return String(
        attrArray($, field.selector, field.attrClass).join("; ").length,
      );
    case "countWords":
      return String(
        normalizeWhitespace(textArray($, field.selector).join(" "))
          .split(/\s+/)
          .filter(Boolean).length,
      );
    case "number":
      return firstNumber(textArray($, field.selector).join("; "));
    case "trimmedText":
      return textArray($, field.selector).map(normalizeWhitespace).join("; ");
    case "ownText":
      return ownTextArray($, field.selector).join("; ");
    case "quantity":
      return $(field.selector).length + "";
    default:
      return "";
  }
}

function extractFieldFromXPath(nodes, field) {
  switch (field.find) {
    case "text":
      return textArrayXPath(nodes).join("; ");
    case "attr":
      return attrArrayXPath(nodes, field.attrClass).join("; ");
    case "html":
      return nodes.map(nodeInnerHtml).filter(Boolean).join("; ");
    case "outerHtml":
      return nodes.map(nodeOuterHtml).filter(Boolean).join("; ");
    case "firstText":
      return textArrayXPath(nodes)[0] || "";
    case "firstAttr":
      return attrArrayXPath(nodes, field.attrClass)[0] || "";
    case "exists":
      return (nodes.length > 0) + "";
    case "matchesRegex":
      return applyRegex(textArrayXPath(nodes).join("; "), field.attrClass);
    case "allTextArray":
      return textArrayXPath(nodes);
    case "allAttrArray":
      return attrArrayXPath(nodes, field.attrClass);
    case "uniqueText":
      return Array.from(new Set(textArrayXPath(nodes))).join("; ");
    case "countTextLength":
      return String(textArrayXPath(nodes).join("; ").length);
    case "countAttrLength":
      return String(attrArrayXPath(nodes, field.attrClass).join("; ").length);
    case "countWords":
      return String(
        normalizeWhitespace(textArrayXPath(nodes).join(" "))
          .split(/\s+/)
          .filter(Boolean).length,
      );
    case "number":
      return firstNumber(textArrayXPath(nodes).join("; "));
    case "trimmedText":
      return textArrayXPath(nodes).map(normalizeWhitespace).join("; ");
    case "ownText":
      return ownTextArrayXPath(nodes).join("; ");
    case "quantity":
      return nodes.length + "";
    default:
      return "";
  }
}

function extractDynamicFromHtml(html, parserFields) {
  const out = {};
  if (!html || !parserFields || !parserFields.length) return out;

  try {
    const $ = cheerio.load(html);
    let dom = null;
    let xpathWindow = null;

    for (const field of parserFields) {
      if (!field || !field.selector || !field.find || !field.prop) continue;

      let value = "";
      try {
        if ((field.selectorType || "css") === "xpath") {
          if (!xpathWindow) {
            dom = new JSDOM(html);
            xpathWindow = dom.window;
          }
          value = extractFieldFromXPath(
            evaluateXPath(xpathWindow, field.selector),
            field,
          );
        } else {
          value = extractFieldFromCss($, field);
        }

        if (field.getLength) {
          value = String(value ? String(value).length : 0);
        }
      } catch (_) {}

      out[field.prop] = value;
    }

    if (dom) {
      try {
        dom.window.close();
      } catch (_) {}
    }
  } catch (_) {}

  return out;
}

function extractDynamicFromBuffer(buffer, parserFields) {
  if (!buffer) return {};

  let html = "";
  if (Buffer.isBuffer(buffer)) {
    html = buffer.toString("utf8");
  } else if (typeof buffer === "string") {
    html = buffer;
  } else if (buffer instanceof ArrayBuffer) {
    html = Buffer.from(buffer).toString("utf8");
  } else if (ArrayBuffer.isView(buffer)) {
    html = Buffer.from(buffer.buffer).toString("utf8");
  }

  return extractDynamicFromHtml(html, parserFields);
}

module.exports = {
  extractDynamicFromHtml,
  extractDynamicFromBuffer,
};
