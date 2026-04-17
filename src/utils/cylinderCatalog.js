import { parseKgFromProductName } from './productDisplay';

const CANONICAL_KG = [2.4, 5, 12.5, 37.5];

export function canonicalKg(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  for (const c of CANONICAL_KG) {
    if (Math.abs(n - c) < 0.051) return c;
  }
  return null;
}

function normalize(raw) {
  return String(raw || '').toLowerCase().trim();
}

export function isEmptyCylinderName(raw) {
  const s = normalize(raw);
  return s.includes('empty') && s.includes('cylinder');
}

export function isNewIssueName(raw) {
  return normalize(raw).includes('new issue');
}

export function isGasCylinderName(raw) {
  const s = normalize(raw);
  if (!s) return false;
  if (isEmptyCylinderName(s) || isNewIssueName(s)) return false;
  return s.includes('gas') && parseKgFromProductName(s) != null;
}

export function canonicalKgFromName(raw) {
  const parsed = parseKgFromProductName(String(raw || ''));
  if (parsed == null) return null;
  return canonicalKg(parsed);
}

export function labelFromKg(kg) {
  return `${kg} kg`;
}
