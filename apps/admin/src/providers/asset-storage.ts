import { createS3Client, resolveS3StorageConfig } from "@generator/storage";

import type {
	AssetStorage,
	AssetStorageObjectWrite,
} from "@/domain/asset-releases";

export function createAssetStorage() {
	const config = resolveS3StorageConfig();
	return new BunS3AssetStorage(createS3Client(config));
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
