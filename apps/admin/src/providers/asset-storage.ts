import { getS3StorageEnv } from "@generator/env/server";

import type {
	AssetStorage,
	AssetStorageObjectWrite,
} from "@/domain/asset-releases";

export function createAssetStorage() {
	const config = getS3StorageEnv();
	const client = new globalThis.Bun.S3Client({
		accessKeyId: config.S3_ACCESS_KEY_ID,
		bucket: config.S3_BUCKET,
		endpoint: config.S3_ENDPOINT,
		region: config.S3_REGION,
		secretAccessKey: config.S3_SECRET_ACCESS_KEY,
	});

	return new BunS3AssetStorage(client);
}

class BunS3AssetStorage implements AssetStorage {
	private readonly client: Bun.S3Client;

	constructor(client: Bun.S3Client) {
		this.client = client;
	}

	async readJson<T>(key: string): Promise<T | null> {
		const file = this.client.file(key);
		if (!(await file.exists())) {
			return null;
		}

		return (await file.json()) as T;
	}

	async writeJson(key: string, payload: unknown) {
		await this.client.write(key, JSON.stringify(payload, null, 2));
	}

	async writeObject(input: AssetStorageObjectWrite) {
		await this.client.write(input.key, input.body);
	}
}
