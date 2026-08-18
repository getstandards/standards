import { z } from "zod/v4";

/** Model providers built into the pi AI SDK used by Standards. */
export const KNOWN_MODEL_PROVIDERS = [
	"amazon-bedrock",
	"ant-ling",
	"anthropic",
	"azure-openai-responses",
	"baseten",
	"cerebras",
	"cloudflare-ai-gateway",
	"cloudflare-workers-ai",
	"deepseek",
	"fireworks",
	"github-copilot",
	"google",
	"google-vertex",
	"groq",
	"huggingface",
	"kimi-coding",
	"minimax",
	"minimax-cn",
	"mistral",
	"moonshotai",
	"moonshotai-cn",
	"nvidia",
	"openai",
	"openai-codex",
	"opencode",
	"opencode-go",
	"openrouter",
	"qwen-token-plan",
	"qwen-token-plan-cn",
	"qwen-token-plan-individual",
	"together",
	"vercel-ai-gateway",
	"xai",
	"xiaomi",
	"xiaomi-token-plan-ams",
	"xiaomi-token-plan-cn",
	"xiaomi-token-plan-sgp",
	"zai",
	"zai-coding-cn",
] as const;

const knownModelProviderSet = new Set<string>(KNOWN_MODEL_PROVIDERS);
const modelReferenceError = `Expected a model reference in '<provider>/<model>' form. Known providers: ${KNOWN_MODEL_PROVIDERS.join(
	", ",
)}.`;

/** A provider and model identifier in `<provider>/<model>` form. */
export const modelReferenceSchema = z
	.string()
	.superRefine((modelReference, context) => {
		const separatorIndex = modelReference.indexOf("/");
		if (separatorIndex <= 0) {
			context.addIssue({ code: "custom", message: modelReferenceError });
			return;
		}
		const provider = modelReference.slice(0, separatorIndex);
		const model = modelReference.slice(separatorIndex + 1);
		if (model.length === 0 || !knownModelProviderSet.has(provider)) {
			context.addIssue({ code: "custom", message: modelReferenceError });
		}
	})
	.brand<"ModelReference">();

/** A validated model reference used by one or both review agent steps. */
export type ModelReference = z.infer<typeof modelReferenceSchema>;
