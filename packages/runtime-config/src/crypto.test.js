import { describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import {
	DecryptionFailedError,
	decrypt,
	encrypt,
	InvalidMasterKeyError,
	parseMasterKey,
} from "./crypto";

const HEX_KEY = "0".repeat(64);
const BAD_HEX = "deadbeef";
describe("parseMasterKey", () => {
	it("accepts a 64-char hex key", () => {
		const key = parseMasterKey(HEX_KEY);
		expect(key.length).toBe(32);
	});
	it("accepts a 44-char base64 key (32 bytes)", () => {
		const raw = randomBytes(32).toString("base64");
		const key = parseMasterKey(raw);
		expect(key.length).toBe(32);
	});
	it("rejects an empty string", () => {
		expect(() => parseMasterKey("   ")).toThrow(InvalidMasterKeyError);
	});
	it("rejects a too-short hex key", () => {
		expect(() => parseMasterKey(BAD_HEX)).toThrow(InvalidMasterKeyError);
	});
	it("rejects a base64 string that decodes to the wrong size", () => {
		const raw = randomBytes(16).toString("base64");
		expect(() => parseMasterKey(raw)).toThrow(InvalidMasterKeyError);
	});
});
describe("encrypt/decrypt round-trip", () => {
	const key = parseMasterKey(HEX_KEY);
	it("recovers the original plaintext", () => {
		const plain = "sk-or-v1-deadbeefcafebabe";
		const enc = encrypt(plain, key);
		expect(enc.ciphertext).not.toContain(plain);
		expect(decrypt(enc, key)).toBe(plain);
	});
	it("produces a fresh IV per call (no reuse)", () => {
		const a = encrypt("same", key);
		const b = encrypt("same", key);
		expect(a.iv).not.toBe(b.iv);
		expect(a.ciphertext).not.toBe(b.ciphertext);
	});
	it("rejects ciphertext tampered with after encryption", () => {
		const enc = encrypt("hello", key);
		const buf = Buffer.from(enc.ciphertext, "base64");
		const original = buf[0] ?? 0;
		buf[0] = original === 0 ? 1 : original - 1;
		const tampered = { ...enc, ciphertext: buf.toString("base64") };
		expect(() => decrypt(tampered, key)).toThrow(DecryptionFailedError);
	});
	it("rejects decryption with the wrong key", () => {
		const enc = encrypt("hello", key);
		const otherKey = parseMasterKey("1".repeat(64));
		expect(() => decrypt(enc, otherKey)).toThrow(DecryptionFailedError);
	});
	it("rejects an IV of the wrong length", () => {
		const enc = encrypt("hello", key);
		const bad = { ...enc, iv: Buffer.from([1, 2, 3]).toString("base64") };
		expect(() => decrypt(bad, key)).toThrow(DecryptionFailedError);
	});
});
