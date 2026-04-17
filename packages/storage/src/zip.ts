function crc32(data: Uint8Array): number {
	let crc = 0xff_ff_ff_ff;
	for (const byte of data) {
		// biome-ignore lint/suspicious/noBitwiseOperators: CRC32 algorithm
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			// biome-ignore lint/suspicious/noBitwiseOperators: CRC32 algorithm
			crc = crc & 1 ? (crc >>> 1) ^ 0xed_b8_83_20 : crc >>> 1;
		}
	}
	// biome-ignore lint/suspicious/noBitwiseOperators: CRC32 algorithm
	return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

export function buildZipFromBuffers(
	files: Array<{ data: Uint8Array; name: string }>
): Uint8Array {
	const entries: Uint8Array[] = [];
	const centralDir: Uint8Array[] = [];
	let offset = 0;

	for (const file of files) {
		const nameBytes = new TextEncoder().encode(file.name);
		const checksum = crc32(file.data);

		const localHeader = new Uint8Array(30 + nameBytes.length);
		const view = new DataView(localHeader.buffer);
		view.setUint32(0, 0x04_03_4b_50, true);
		view.setUint16(4, 20, true);
		view.setUint16(8, 0, true);
		view.setUint32(14, checksum, true);
		view.setUint32(18, file.data.length, true);
		view.setUint32(22, file.data.length, true);
		view.setUint16(26, nameBytes.length, true);
		localHeader.set(nameBytes, 30);

		const cdEntry = new Uint8Array(46 + nameBytes.length);
		const cdView = new DataView(cdEntry.buffer);
		cdView.setUint32(0, 0x02_01_4b_50, true);
		cdView.setUint16(4, 20, true);
		cdView.setUint16(6, 20, true);
		cdView.setUint16(12, 0, true);
		cdView.setUint32(16, checksum, true);
		cdView.setUint32(20, file.data.length, true);
		cdView.setUint32(24, file.data.length, true);
		cdView.setUint16(28, nameBytes.length, true);
		cdView.setUint32(42, offset, true);
		cdEntry.set(nameBytes, 46);

		entries.push(localHeader, file.data);
		centralDir.push(cdEntry);
		offset += localHeader.length + file.data.length;
	}

	const cdOffset = offset;
	let cdSize = 0;
	for (const entry of centralDir) {
		cdSize += entry.length;
	}

	const endRecord = new Uint8Array(22);
	const endView = new DataView(endRecord.buffer);
	endView.setUint32(0, 0x06_05_4b_50, true);
	endView.setUint16(8, files.length, true);
	endView.setUint16(10, files.length, true);
	endView.setUint32(12, cdSize, true);
	endView.setUint32(16, cdOffset, true);

	const totalSize = offset + cdSize + 22;
	const result = new Uint8Array(totalSize);
	let pos = 0;
	for (const part of [...entries, ...centralDir, endRecord]) {
		result.set(part, pos);
		pos += part.length;
	}
	return result;
}
