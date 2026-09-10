import { callOdooJson2 } from './index.service';
import { getAllProducts } from './product.service';
import * as productsDb from '../database/products.js';
import * as syncQueueDb from '../database/syncQueue.js';
import * as gasLeakageCollectsDb from '../database/gasLeakageCollects.js';
import {
  canonicalKgFromName,
  isEmptyCylinderName,
  isGasCylinderName,
  labelFromKg,
} from '../utils/cylinderCatalog';
import { getProductDisplayName } from '../utils/productDisplay';

const LEAKED_RECEIPT_DISPLAY_NAME = 'Leaked Items WH: Receipts';
export const LEAKAGE_CANONICAL_KG = [2.4, 5, 12.5, 37.5];
const CHATTER_SEP = '────────────────────────────────────────';

/** Preset reasons sent to Odoo `reason` (English). UI labels are translated separately. */
export const LEAKAGE_REASON_PRESETS = [
  { key: 'gasBurnerIssue', apiValue: 'Gas Burner Issue', icon: 'flame-outline' },
  { key: 'gasLeakage', apiValue: 'Gas Leakage', icon: 'warning-outline' },
  { key: 'cylinderDamage', apiValue: 'Cylinder Damage', icon: 'alert-circle-outline' },
  { key: 'valveIssue', apiValue: 'Valve Issue', icon: 'construct-outline' },
  { key: 'others', apiValue: null, icon: 'create-outline' },
];

let cachedPickingTypeId = null;

function stripToMap(products) {
  const map = {};
  for (const p of products || []) {
    const id = Number(p?.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    map[id] = p?.name ?? '';
  }
  return map;
}

function kindLabel(kind) {
  return kind === 'empty' ? 'empty' : 'gas filled';
}

function defaultDisplayName(kg, kind) {
  return `${labelFromKg(kg)} ${kindLabel(kind)}`;
}

/**
 * Always 8 slots (4 sizes × gas/empty). Product ids fill in from the local catalog when present.
 */
export function buildAlwaysVisibleLeakageRows(productMap) {
  const best = new Map();
  for (const [idStr, rawName] of Object.entries(productMap || {})) {
    const productId = Number(idStr);
    if (!Number.isFinite(productId) || productId <= 0) continue;
    const name = String(rawName || '');
    const kg = canonicalKgFromName(name);
    if (kg == null) continue;
    const kind = isEmptyCylinderName(name)
      ? 'empty'
      : isGasCylinderName(name)
        ? 'gas'
        : null;
    if (!kind) continue;
    const key = `${kg}:${kind}`;
    if (best.has(key)) continue;
    best.set(key, {
      productId,
      name,
      displayName: getProductDisplayName(name) || name,
      kg,
      kind,
    });
  }

  const rows = [];
  for (const kg of LEAKAGE_CANONICAL_KG) {
    for (const kind of ['gas', 'empty']) {
      const found = best.get(`${kg}:${kind}`);
      rows.push({
        productId: found?.productId ?? null,
        name: found?.name || defaultDisplayName(kg, kind),
        displayName: found?.displayName || defaultDisplayName(kg, kind),
        kg,
        kind,
      });
    }
  }
  return rows;
}

export async function loadLeakageCylinderProducts({ allowRemote = false } = {}) {
  const localMap = await productsDb.getProductsMap();
  let rows = buildAlwaysVisibleLeakageRows(localMap);
  const missing = rows.some((r) => r.productId == null);
  if (!missing || !allowRemote) return rows;
  try {
    const remote = await getAllProducts();
    rows = buildAlwaysVisibleLeakageRows({ ...localMap, ...stripToMap(remote) });
  } catch {
    // Stay on local catalog — leakage collect must work offline.
  }
  return rows;
}

export function buildGasLeakageChatterBody(entries, driverReason) {
  const lines = [];
  lines.push('Gas leakage collected — mobile delivery');
  lines.push(CHATTER_SEP);
  const rows = Array.isArray(entries) ? entries : [];
  let any = false;
  for (const e of rows) {
    const qty = Number(e.qty ?? e.product_uom_qty) || 0;
    if (qty <= 0) continue;
    any = true;
    const kg = Number(e.kg);
    const kind = e.kind === 'empty' ? 'empty' : 'gas filled';
    const label =
      String(e.displayName || e.name || '').trim() ||
      (Number.isFinite(kg) ? `${labelFromKg(kg)} ${kind}` : kind);
    lines.push(`${label}: ${qty}`);
  }
  if (!any) lines.push('No leaked cylinders recorded.');
  lines.push(CHATTER_SEP);
  lines.push(`Driver reason: ${String(driverReason || '').trim() || '—'}`);
  return lines.join('\n');
}

export async function getLeakedItemsReceiptPickingTypeId() {
  if (cachedPickingTypeId != null) return cachedPickingTypeId;
  const result = await callOdooJson2('stock.picking.type', 'search_read', {
    domain: [['display_name', 'like', LEAKED_RECEIPT_DISPLAY_NAME]],
    fields: ['id', 'name'],
  });
  const rows = Array.isArray(result) ? result : [];
  const id = Number(rows[0]?.id);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('Leaked Items receipt picking type was not found.');
  }
  cachedPickingTypeId = id;
  return id;
}

function pickingIdFromCreateResult(result) {
  if (result == null) return null;
  if (typeof result === 'number' && Number.isFinite(result) && result > 0) return result;
  if (Array.isArray(result)) {
    const first = result[0];
    if (typeof first === 'number' && Number.isFinite(first) && first > 0) return first;
    const nested = Number(first?.id ?? first?.result);
    if (Number.isFinite(nested) && nested > 0) return nested;
  }
  const id = Number(result?.id ?? result?.result);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function canAttemptLeakageUploadNow() {
  try {
    const { getLastNetworkQuality, NetworkQuality } = require('./networkStatus.service.js');
    return getLastNetworkQuality() === NetworkQuality.GOOD;
  } catch (_) {
    return true;
  }
}

/**
 * Create a leaked-items receipt picking.
 * @param {{ partnerId: number, reason: string, moves: Array<{ productId: number, qty: number }> }} payload
 */
export async function createLeakagePicking({ partnerId, reason, moves }) {
  const pid = Number(partnerId);
  const reasonText = String(reason || '').trim();
  const moveRows = (moves || [])
    .map((m) => ({
      productId: Number(m.productId),
      qty: Number(m.qty),
    }))
    .filter((m) => Number.isFinite(m.productId) && m.productId > 0 && Number.isFinite(m.qty) && m.qty > 0);

  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error('Customer is required.');
  }
  if (!reasonText) {
    throw new Error('Reason is required.');
  }
  if (moveRows.length === 0) {
    throw new Error('Select at least one leaked product quantity.');
  }

  const pickingTypeId = await getLeakedItemsReceiptPickingTypeId();
  const result = await callOdooJson2('stock.picking', 'create', {
    vals_list: [
      {
        partner_id: pid,
        picking_type_id: pickingTypeId,
        reason: reasonText,
        move_ids: moveRows.map((m) => [
          0,
          0,
          {
            product_id: m.productId,
            product_uom_qty: m.qty,
          },
        ]),
      },
    ],
  });
  const pickingId = pickingIdFromCreateResult(result);
  if (pickingId == null) {
    throw new Error('Leaked-items receipt was not created on the server.');
  }
  return pickingId;
}

async function findPendingLeakageItem({ saleOrderId, queueId }) {
  const pending = (await syncQueueDb.getPending().catch(() => [])) || [];
  const qid = Number(queueId);
  if (Number.isFinite(qid) && qid > 0) {
    const byId = pending.find((row) => Number(row.id) === qid);
    if (byId) return byId;
  }
  const soId = Number(saleOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return null;
  return (
    pending.find(
      (row) =>
        row.action_type === syncQueueDb.ACTION_GAS_LEAKAGE_COLLECT &&
        Number(row.payload?.saleOrderId) === soId
    ) || null
  );
}

/** One in-flight create per queue row — checkout flush and sync drain must not both POST. */
const inFlightLeakageFlushes = new Map();

/**
 * Queue leakage collect so checkout can continue offline. Tries Odoo immediately when online.
 */
export async function submitLeakageCollectOfflineFirst({
  partnerId,
  reason,
  moves,
  saleOrderId = null,
  chatterBody = '',
  chatterAttachedToPayment = false,
  partnerName = '',
  source = 'menu',
}) {
  const payload = {
    partnerId: Number(partnerId),
    partnerName: String(partnerName || '').trim(),
    source: source === 'checkout' ? 'checkout' : 'menu',
    reason: String(reason || '').trim(),
    moves: (moves || []).map((m) => ({
      productId: Number(m.productId),
      qty: Number(m.qty),
      kg: m.kg != null ? Number(m.kg) : null,
      kind: m.kind || null,
      displayName: m.displayName || m.name || '',
    })),
    saleOrderId: saleOrderId != null ? Number(saleOrderId) : null,
    chatterBody: String(chatterBody || '').trim(),
    chatterAttachedToPayment: chatterAttachedToPayment === true,
    pickingSynced: false,
    chatterSynced: chatterAttachedToPayment === true || !String(chatterBody || '').trim(),
    recordedAt: new Date().toISOString(),
  };

  const existing = await findPendingLeakageItem({ saleOrderId: payload.saleOrderId });
  let queueId = existing?.id != null ? Number(existing.id) : null;
  if (queueId != null && Number.isFinite(queueId) && queueId > 0) {
    await syncQueueDb.updateQueueItemPayload(queueId, payload, { suppressWake: true });
  } else {
    queueId = await syncQueueDb.enqueue(syncQueueDb.ACTION_GAS_LEAKAGE_COLLECT, payload, {
      suppressWake: true,
    });
  }

  try {
    await gasLeakageCollectsDb.insertGasLeakageCollect({
      collectedAt: payload.recordedAt,
      partnerId: payload.partnerId,
      partnerName: payload.partnerName,
      saleOrderId: payload.saleOrderId,
      reason: payload.reason,
      moves: payload.moves,
      source: payload.source,
      queueId,
      odooSyncStatus: 'pending',
    });
  } catch (e) {
    console.warn('[gasLeakage] local history insert failed', e?.message ?? e);
  }

  if (!canAttemptLeakageUploadNow()) {
    syncQueueDb.requestPendingUploadWake();
    return { ok: true, queued: true, queueId };
  }

  try {
    await flushGasLeakageQueueItem({
      id: queueId,
      action_type: syncQueueDb.ACTION_GAS_LEAKAGE_COLLECT,
      payload,
    });
    return { ok: true, queued: false, queueId };
  } catch (e) {
    syncQueueDb.requestPendingUploadWake();
    return { ok: true, queued: true, queueId, error: e };
  }
}

export async function flushGasLeakageQueueItem(item) {
  const id = Number(item?.id);
  if (!Number.isFinite(id) || id <= 0) {
    return { skipped: true };
  }

  const existingRun = inFlightLeakageFlushes.get(id);
  if (existingRun) return existingRun;

  const run = (async () => {
    const latest = await syncQueueDb.getQueueItemById(id).catch(() => null);
    const uploaded = Number(latest?.is_uploaded) === 1 || latest?.synced_at != null;
    const p =
      latest?.payload && typeof latest.payload === 'object'
        ? { ...latest.payload }
        : item?.payload && typeof item.payload === 'object'
          ? { ...item.payload }
          : {};

    let pickingSynced = p.pickingSynced === true;
    let chatterSynced = p.chatterSynced === true || p.chatterAttachedToPayment === true;

    if (uploaded && pickingSynced) {
      await gasLeakageCollectsDb.markGasLeakageCollectSyncedByQueueId(id);
      return { ok: true, alreadySynced: true, pickingSynced, chatterSynced };
    }

    if (!pickingSynced) {
      const pickingId = await createLeakagePicking({
        partnerId: p.partnerId,
        reason: p.reason,
        moves: p.moves,
      });
      pickingSynced = true;
      p.pickingSynced = true;
      p.odooPickingId = pickingId;
      await syncQueueDb.updateQueueItemPayload(id, p, { suppressWake: true });
    }

    const soId = Number(p.saleOrderId);
    const body = String(p.chatterBody || '').trim();
    if (!chatterSynced && Number.isFinite(soId) && soId > 0 && body) {
      const { postPaymentProofToChatterWithAttachmentIds, linesToOdooHtmlBody } = await import(
        './proofAttachment.service.js'
      );
      const html = /<\s*br/i.test(body) ? body : linesToOdooHtmlBody(body.split('\n'));
      await postPaymentProofToChatterWithAttachmentIds(soId, { body: html, attachmentIds: [] });
      chatterSynced = true;
      p.chatterSynced = true;
      await syncQueueDb.updateQueueItemPayload(id, p, { suppressWake: true });
    } else if (!body || p.chatterAttachedToPayment === true) {
      chatterSynced = true;
      p.chatterSynced = true;
    }

    if (pickingSynced && chatterSynced) {
      await syncQueueDb.markSynced(id);
      await gasLeakageCollectsDb.markGasLeakageCollectSyncedByQueueId(id);
    }
    return { ok: true, pickingSynced, chatterSynced };
  })();

  inFlightLeakageFlushes.set(id, run);
  try {
    return await run;
  } finally {
    inFlightLeakageFlushes.delete(id);
  }
}
