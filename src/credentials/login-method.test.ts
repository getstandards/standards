import type {
	ApiKeyAuth,
	OAuthAuth,
	OAuthCredential,
	Provider,
	ProviderAuth,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
	credentialKindLabel,
	selectProviderLoginMethod,
} from "./login-method.js";

function fakeProvider(auth: ProviderAuth): Provider {
	return {
		id: "test",
		name: "Test",
		auth,
		getModels: () => [],
		stream: () => {
			throw new Error("selectProviderLoginMethod must not stream");
		},
		streamSimple: () => {
			throw new Error("selectProviderLoginMethod must not stream");
		},
	};
}

const oauthCredential: OAuthCredential = {
	type: "oauth",
	access: "access-token",
	refresh: "refresh-token",
	expires: 0,
};

const interactiveApiKey: ApiKeyAuth = {
	name: "Test API key",
	login: async () => ({ type: "api_key" }),
	resolve: async () => undefined,
};

const ambientApiKey: ApiKeyAuth = {
	name: "Test ambient key",
	resolve: async () => undefined,
};

const subscriptionOauth: OAuthAuth = {
	name: "Test subscription",
	isSubscription: true,
	login: async () => oauthCredential,
	refresh: async () => oauthCredential,
	toAuth: async () => ({}),
};

const plainOauth: OAuthAuth = {
	name: "Test OAuth",
	login: async () => oauthCredential,
	refresh: async () => oauthCredential,
	toAuth: async () => ({}),
};

describe("selectProviderLoginMethod", () => {
	it("prefers a subscription OAuth method over an API key method", () => {
		const provider = fakeProvider({
			apiKey: interactiveApiKey,
			oauth: subscriptionOauth,
		});
		expect(selectProviderLoginMethod(provider)).toEqual({
			kind: "login",
			type: "oauth",
		});
	});

	it("uses the interactive API key method when OAuth is not a subscription", () => {
		const provider = fakeProvider({
			apiKey: interactiveApiKey,
			oauth: plainOauth,
		});
		expect(selectProviderLoginMethod(provider)).toEqual({
			kind: "login",
			type: "api_key",
		});
	});

	it("falls back to a non-subscription OAuth method when the API key is ambient only", () => {
		const provider = fakeProvider({
			apiKey: ambientApiKey,
			oauth: plainOauth,
		});
		expect(selectProviderLoginMethod(provider)).toEqual({
			kind: "login",
			type: "oauth",
		});
	});

	it("reports an ambient source when the provider has no interactive method", () => {
		const provider = fakeProvider({
			apiKey: ambientApiKey,
		});
		expect(selectProviderLoginMethod(provider)).toEqual({
			kind: "ambient",
			ambientSource: "Test ambient key",
		});
	});
});

describe("credentialKindLabel", () => {
	it("maps the stored api_key type to the user-facing api-key label", () => {
		expect(credentialKindLabel("api_key")).toBe("api-key");
	});

	it("keeps the oauth label", () => {
		expect(credentialKindLabel("oauth")).toBe("oauth");
	});
});
