import { db } from "@generator/db";
import { eq } from "@generator/db/operators";
import { runpodPodTemplate } from "@generator/db/schema/runpod";
import { studioScenario } from "@generator/db/schema/studio";

type Db = typeof db;

export interface ScenarioRunpodBinding {
	podTemplateId: string | null;
	podTemplateName: string | null;
	scenarioId: string;
	workflowKey: string;
}

export interface ScenarioRunpodBindingRepository {
	get(scenarioId: string): Promise<ScenarioRunpodBinding | null>;
	listBindings(): Promise<ScenarioRunpodBinding[]>;
	setBinding(
		scenarioId: string,
		podTemplateId: string | null
	): Promise<ScenarioRunpodBinding | null>;
}

/**
 * Лёгкий репозиторий: единственная задача — читать/писать
 * `studio_scenario.runpodPodTemplateId` из admin app'а, не трогая Studio API.
 * Studio scenarios никак не используют это поле напрямую (всё чтение происходит
 * в generator-стартapе), так что race с user-flow Studio'а нет.
 */
export function createDrizzleScenarioRunpodBindingRepository(
	database: Db = db
): ScenarioRunpodBindingRepository {
	const baseQuery = () =>
		database
			.select({
				podTemplateId: studioScenario.runpodPodTemplateId,
				podTemplateName: runpodPodTemplate.name,
				scenarioId: studioScenario.id,
				workflowKey: studioScenario.workflowKey,
			})
			.from(studioScenario)
			.leftJoin(
				runpodPodTemplate,
				eq(runpodPodTemplate.id, studioScenario.runpodPodTemplateId)
			);

	return {
		async get(scenarioId) {
			const rows = await baseQuery().where(eq(studioScenario.id, scenarioId));
			return rows[0] ?? null;
		},
		async listBindings() {
			return await baseQuery();
		},
		async setBinding(scenarioId, podTemplateId) {
			const [updated] = await database
				.update(studioScenario)
				.set({ runpodPodTemplateId: podTemplateId })
				.where(eq(studioScenario.id, scenarioId))
				.returning({ id: studioScenario.id });
			if (!updated) {
				return null;
			}
			return this.get(scenarioId);
		},
	};
}
