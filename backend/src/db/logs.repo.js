const db = require('../db');
const { generateSecureId } = require('../utils/id');
const { sha256 } = require('../security/hash');

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

const insertActivityStmt = db.prepare(`
  INSERT INTO activity_logs (id, session_id, user_id, action, details, created_at)
  VALUES (@id, @session_id, @user_id, @action, @details, @created_at)
`);

const insertAuditStmt = db.prepare(`
  INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, metadata, ip_address, prev_hash, log_hash, created_at)
  VALUES (@id, @actor, @action, @entity_type, @entity_id, @metadata, @ip_address, @prev_hash, @log_hash, @created_at)
`);

const getLastAuditLogStmt = db.prepare(`
  SELECT log_hash FROM audit_logs ORDER BY rowid DESC LIMIT 1
`);

function calculateAuditHash({ prevHash, id, actor, action, entityType, entityId, metadata, ipAddress, createdAt }) {
  const content = [
    prevHash || GENESIS_HASH,
    id,
    actor,
    action,
    entityType,
    entityId || '',
    metadata || '',
    ipAddress || '',
    createdAt,
  ].join('|');
  return sha256(content);
}

/**
 * Logs a user/session-facing activity event.
 * `details`, if provided, is JSON.stringify'd — never pass raw document contents.
 */
function logActivity({ sessionId = null, userId = null, action, details = null }) {
  insertActivityStmt.run({
    id: generateSecureId(16),
    session_id: sessionId,
    user_id: userId,
    action,
    details: details ? JSON.stringify(details) : null,
    created_at: new Date().toISOString(),
  });
}

const listAuditLogsStmt = db.prepare(
  `SELECT * FROM audit_logs ORDER BY rowid DESC LIMIT ? OFFSET ?`
);
const countAuditLogsStmt = db.prepare(`SELECT COUNT(*) c FROM audit_logs`);
const getAllChronologicalAuditLogsStmt = db.prepare(
  `SELECT * FROM audit_logs ORDER BY rowid ASC`
);

/**
 * Logs a security/compliance-relevant audit event with tamper-evident SHA-256 hash chaining.
 * Prevents silent tampering or row insertion/deletion in the audit log.
 */
function logAudit({ actor = 'system', action, entityType, entityId = null, metadata = null, ipAddress = null }) {
  const id = generateSecureId(16);
  const createdAt = new Date().toISOString();
  const metadataStr = metadata ? JSON.stringify(metadata) : null;

  const last = getLastAuditLogStmt.get();
  const prevHash = last?.log_hash || GENESIS_HASH;

  const logHash = calculateAuditHash({
    prevHash,
    id,
    actor,
    action,
    entityType,
    entityId,
    metadata: metadataStr,
    ipAddress,
    createdAt,
  });

  insertAuditStmt.run({
    id,
    actor,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata: metadataStr,
    ip_address: ipAddress,
    prev_hash: prevHash,
    log_hash: logHash,
    created_at: createdAt,
  });

  return { id, prevHash, logHash };
}

function listAuditLogs({ limit = 50, offset = 0 } = {}) {
  return listAuditLogsStmt.all(limit, offset);
}

function countAuditLogs() {
  return countAuditLogsStmt.get().c;
}

/**
 * Verifies the cryptographic integrity of the entire audit chain.
 * Traverses all records in order:
 * 1. Confirms each record's prev_hash equals the previous record's log_hash.
 * 2. Recalculates log_hash from record fields to detect field-level modification.
 */
function verifyAuditChain() {
  const records = getAllChronologicalAuditLogsStmt.all();
  if (records.length === 0) {
    return { valid: true, totalRecords: 0, checkedCount: 0 };
  }

  let expectedPrevHash = GENESIS_HASH;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    // Check chain link
    if (record.prev_hash !== expectedPrevHash) {
      return {
        valid: false,
        totalRecords: records.length,
        checkedCount: i,
        brokenAtId: record.id,
        reason: `Hash chain continuity broken at entry ${record.id} (index ${i}). Expected prev_hash ${expectedPrevHash}, found ${record.prev_hash}`,
      };
    }

    // Check record hash integrity
    const calculated = calculateAuditHash({
      prevHash: record.prev_hash,
      id: record.id,
      actor: record.actor,
      action: record.action,
      entityType: record.entity_type,
      entityId: record.entity_id,
      metadata: record.metadata,
      ipAddress: record.ip_address,
      createdAt: record.created_at,
    });

    if (calculated !== record.log_hash) {
      return {
        valid: false,
        totalRecords: records.length,
        checkedCount: i,
        brokenAtId: record.id,
        reason: `Record tamper detected at entry ${record.id} (index ${i}). Stored hash does not match computed hash from fields.`,
      };
    }

    expectedPrevHash = record.log_hash;
  }

  return {
    valid: true,
    totalRecords: records.length,
    checkedCount: records.length,
    lastHash: expectedPrevHash,
  };
}

module.exports = { logActivity, logAudit, listAuditLogs, countAuditLogs, verifyAuditChain, GENESIS_HASH };
