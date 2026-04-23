const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const PROJECT_ROOT = process.cwd();
const SRC_DIR = path.join(PROJECT_ROOT, 'src');
const EN_JSON_PATH = path.join(PROJECT_ROOT, 'translations', 'en.json');
const OUTPUT_PATH = path.join(PROJECT_ROOT, 'extracted_keys.json');

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const TRANSLATABLE_ATTRIBUTE_NAMES = new Set([
  'placeholder',
  'title',
  'label',
  'message',
  'text',
  'headerTitle',
  'buttonText',
  'accessibilityLabel',
]);

const HARD_CODED_SOURCE_DIRS = [
  path.join('src', 'screens') + path.sep,
  path.join('src', 'navigation') + path.sep,
  path.join('src', 'components') + path.sep,
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function walkFiles(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(fullPath);
    }
  }
  return out;
}

function getByPath(obj, keyPath) {
  const parts = keyPath.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || !(p in cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function extractStringFromNode(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return normalizeText(node.value);
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    const cooked = node.quasis.map((q) => q.value.cooked || '').join('');
    return normalizeText(cooked);
  }
  return null;
}

function isTCall(node) {
  const callee = node.callee;
  if (!callee) return false;
  if (callee.type === 'Identifier' && callee.name === 't') return true;
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'i18n' &&
    callee.property &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 't'
  ) {
    return true;
  }
  return false;
}

function getDefaultValueFromOptions(node) {
  if (!node || node.type !== 'ObjectExpression') return null;
  for (const prop of node.properties) {
    if (!prop || prop.type !== 'ObjectProperty') continue;
    let keyName = null;
    if (prop.key.type === 'Identifier') keyName = prop.key.name;
    if (prop.key.type === 'StringLiteral') keyName = prop.key.value;
    if (keyName !== 'defaultValue') continue;
    const value = extractStringFromNode(prop.value);
    if (value) return value;
  }
  return null;
}

function addKey(target, enLookup, fullKey, fallback) {
  if (typeof fullKey !== 'string') return;
  const normalizedKey = fullKey.trim();
  if (!normalizedKey || !normalizedKey.includes('.')) return;

  const dot = normalizedKey.indexOf('.');
  const namespace = normalizedKey.slice(0, dot);
  const innerKey = normalizedKey.slice(dot + 1);
  if (!namespace || !innerKey) return;

  const fromEn = getByPath(enLookup, normalizedKey);
  const candidate = normalizeText(fallback) || normalizeText(fromEn) || innerKey;

  if (!target[namespace]) target[namespace] = {};

  if (!(innerKey in target[namespace])) {
    target[namespace][innerKey] = candidate;
    return;
  }

  const existing = target[namespace][innerKey];
  if ((existing == null || existing === innerKey) && candidate && candidate !== innerKey) {
    target[namespace][innerKey] = candidate;
  }
}

function isPotentialLabel(text) {
  if (typeof text !== 'string') return false;
  const v = text.trim();
  if (!v) return false;
  if (!/[A-Za-z]/.test(v)) return false;
  if (/^(https?:|\/?api\/|[A-Z0-9_]{3,})/.test(v)) return false;
  if (/^[{}()[\].,:;|+\-/*=!<>~`'"\\]+$/.test(v)) return false;
  return true;
}

function toNamespaceFromFile(file) {
  const rel = path.relative(PROJECT_ROOT, file).split(path.sep).join('/');

  if (rel === 'src/components/DrawerContent.jsx') return 'drawer';

  const screenMatch = rel.match(/^src\/screens\/([^/]+)\.[^.]+$/);
  if (screenMatch) {
    const base = screenMatch[1].replace(/Screen$/i, '');
    return base.replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'common';
  }

  if (rel.startsWith('src/navigation/')) return 'navigation';
  if (rel.startsWith('src/components/')) return 'common';

  return 'common';
}

function makeKeyFromLabel(label) {
  const words = String(label)
    .replace(/[{}()[\]<>]/g, ' ')
    .match(/[A-Za-z0-9]+/g);

  if (!words || words.length === 0) return null;

  const tokens = words.slice(0, 8);
  const first = tokens[0].toLowerCase();
  const rest = tokens
    .slice(1)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
  let key = `${first}${rest}`;
  if (/^[0-9]/.test(key)) key = `label${key}`;
  return key;
}

function addHardcodedLabel(target, file, rawText) {
  const text = normalizeText(rawText);
  if (!text || !isPotentialLabel(text)) return;

  const namespace = toNamespaceFromFile(file);
  if (!target[namespace]) target[namespace] = {};

  // Avoid duplicates when a value already exists under the same namespace.
  if (Object.values(target[namespace]).includes(text)) return;

  let key = makeKeyFromLabel(text);
  if (!key) return;

  let i = 2;
  while (key in target[namespace] && target[namespace][key] !== text) {
    key = `${key}${i}`;
    i += 1;
  }

  target[namespace][key] = text;
}

function shouldScanHardcoded(file) {
  const rel = path.relative(PROJECT_ROOT, file);
  return HARD_CODED_SOURCE_DIRS.some((prefix) => rel.startsWith(prefix));
}

function isInsideTCall(pathRef) {
  const callPath = pathRef.findParent((p) => p.isCallExpression());
  if (!callPath) return false;
  return isTCall(callPath.node);
}

function isInsideJsx(pathRef) {
  return Boolean(pathRef.findParent((p) => p.isJSXElement() || p.isJSXFragment() || p.isJSXAttribute()));
}

function main() {
  const enJson = readJson(EN_JSON_PATH);
  const enLookup = enJson && enJson.translation ? enJson.translation : {};

  const files = walkFiles(SRC_DIR);
  const result = {};

  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    let ast;
    try {
      ast = parser.parse(code, {
        sourceType: 'unambiguous',
        plugins: [
          'jsx',
          'typescript',
          'classProperties',
          'objectRestSpread',
          'optionalChaining',
          'nullishCoalescingOperator',
          'dynamicImport',
        ],
      });
    } catch (err) {
      console.warn(`Skipping parse error in ${path.relative(PROJECT_ROOT, file)}: ${err.message}`);
      continue;
    }

    const scanHardcoded = shouldScanHardcoded(file);

    traverse(ast, {
      CallExpression(pathRef) {
        const node = pathRef.node;
        if (isTCall(node)) {
          const args = node.arguments || [];
          if (args.length === 0) return;

          const first = args[0];
          const fullKey = extractStringFromNode(first);
          if (!fullKey) return;

          let fallback = null;

          if (args.length >= 2) {
            fallback = extractStringFromNode(args[1]);
            if (!fallback) {
              fallback = getDefaultValueFromOptions(args[1]);
            }
          }

          if (!fallback) {
            if (args.length >= 3) {
              fallback = getDefaultValueFromOptions(args[2]);
            }
          }

          addKey(result, enLookup, fullKey, fallback);
          return;
        }

        if (!scanHardcoded) return;

        const callee = node.callee;
        const isAlertCall =
          callee &&
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.object &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Alert' &&
          callee.property &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'alert';

        const isShowAlertCall =
          callee &&
          callee.type === 'Identifier' &&
          ['showAlert', 'alert'].includes(callee.name);

        if (isAlertCall || isShowAlertCall) {
          for (const arg of node.arguments || []) {
            const str = extractStringFromNode(arg);
            if (!str) continue;
            addHardcodedLabel(result, file, str);
          }
        }
      },
      NewExpression(pathRef) {
        if (!scanHardcoded) return;
        const node = pathRef.node;
        if (!node.callee || node.callee.type !== 'Identifier' || node.callee.name !== 'Error') return;
        const first = node.arguments && node.arguments[0];
        const str = extractStringFromNode(first);
        if (str) addHardcodedLabel(result, file, str);
      },
      JSXText(pathRef) {
        if (!scanHardcoded) return;
        if (isInsideTCall(pathRef)) return;
        addHardcodedLabel(result, file, pathRef.node.value);
      },
      JSXAttribute(pathRef) {
        if (!scanHardcoded) return;
        if (isInsideTCall(pathRef)) return;

        const nameNode = pathRef.node.name;
        const attrName = nameNode && nameNode.name;
        if (!TRANSLATABLE_ATTRIBUTE_NAMES.has(attrName)) return;

        const valueNode = pathRef.node.value;
        if (!valueNode) return;

        if (valueNode.type === 'StringLiteral') {
          addHardcodedLabel(result, file, valueNode.value);
          return;
        }

        if (valueNode.type === 'JSXExpressionContainer') {
          const expr = valueNode.expression;
          const str = extractStringFromNode(expr);
          if (str) addHardcodedLabel(result, file, str);
        }
      },
    });
  }

  const sorted = {};
  for (const ns of Object.keys(result).sort()) {
    sorted[ns] = {};
    for (const key of Object.keys(result[ns]).sort()) {
      sorted[ns][key] = result[ns][key];
    }
  }

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');

  const nsCount = Object.keys(sorted).length;
  const keyCount = Object.values(sorted).reduce((sum, nsObj) => sum + Object.keys(nsObj).length, 0);
  console.log(`Wrote ${keyCount} keys across ${nsCount} namespaces to extracted_keys.json`);
}

main();
