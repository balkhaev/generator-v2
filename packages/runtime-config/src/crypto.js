/**
 * AES-256-GCM helpers for credential storage.
 *
 * The master key lives in `CONFIG_MASTER_KEY` of the admin-api process and
 * never leaves it. Ciphertext+IV are stored in Postgres; the GCM auth tag is
 * appended to the ciphertext (last 16 bytes before base64 encoding) so we
 * only need two columns in the schema.
 *
 * Why this and not a vendored crypto lib: Node's `node:crypto` ships AES-GCM
 * out of the box, the dependency surface is zero, and the format is trivial
 * to re-implement in another language if we ever migrate the storage layer.
 */
import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEX_KEY_PATTERN = /^[0-9a-fA-F]+$/;
export class InvalidMasterKeyError extends Error {
	constructor(reason) {
		super(`CONFIG_MASTER_KEY is invalid: ${reason}`);
		this.name = "InvalidMasterKeyError";
	}
}
export class DecryptionFailedError extends Error {
	constructor() {
		super("Failed to decrypt credential: ciphertext or master key is invalid");
		this.name = "DecryptionFailedError";
	}
}
/**
 * Parses a master key from env. Accepts:
 *   - 64-char hex (32 bytes)
 *   - base64 of 32 bytes (44 chars including padding)
 *
 * Returns the raw 32-byte buffer. Throws on any deviation — refusing to start
 * is the only safe behaviour here, otherwise we'd silently encrypt secrets
 * with a weak key.
 */
export function parseMasterKey(raw) {
	const trimmed = raw.trim();
	if (!trimmed) {
		throw new InvalidMasterKeyError("value is empty");
	}
	if (HEX_KEY_PATTERN.test(trimmed)) {
		if (trimmed.length !== KEY_BYTES * 2) {
			throw new InvalidMasterKeyError(
				`hex key must be ${KEY_BYTES * 2} chars (got ${trimmed.length})`
			);
		}
		return Buffer.from(trimmed, "hex");
	}
	const decoded = Buffer.from(trimmed, "base64");
	if (decoded.length !== KEY_BYTES) {
		throw new InvalidMasterKeyError(
			`decoded key must be ${KEY_BYTES} bytes (got ${decoded.length})`
		);
	}
	return decoded;
}
export function encrypt(plaintext, masterKey) {
	if (masterKey.length !== KEY_BYTES) {
		throw new InvalidMasterKeyError(
			`expected ${KEY_BYTES}-byte key, got ${masterKey.length}`
		);
	}
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, masterKey, iv);
	const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return {
		ciphertext: Buffer.concat([enc, tag]).toString("base64"),
		iv: iv.toString("base64"),
	};
}
export function decrypt(value, masterKey) {
	if (masterKey.length !== KEY_BYTES) {
		throw new InvalidMasterKeyError(
			`expected ${KEY_BYTES}-byte key, got ${masterKey.length}`
		);
	}
	const iv = Buffer.from(value.iv, "base64");
	if (iv.length !== IV_BYTES) {
		throw new DecryptionFailedError();
	}
	const combined = Buffer.from(value.ciphertext, "base64");
	if (combined.length < TAG_BYTES + 1) {
		throw new DecryptionFailedError();
	}
	const tag = combined.subarray(combined.length - TAG_BYTES);
	const ciphertext = combined.subarray(0, combined.length - TAG_BYTES);
	const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
	decipher.setAuthTag(tag);
	try {
		const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
		return dec.toString("utf8");
	} catch {
		throw new DecryptionFailedError();
	}
}
/**
 * Constant-time comparison helper for situations where credentials are
 * compared (e.g. internal-token check). Exposed here so callers don't need
 * to depend on `node:crypto` directly.
 */
export function timingSafeEqualString(a, b) {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) {
		return false;
	}
	return timingSafeEqual(ab, bb);
}
