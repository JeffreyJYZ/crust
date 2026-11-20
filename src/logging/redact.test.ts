/**
 * The redaction pass: a secret leaves the process as `[redacted]`, whether it sat under a secret
 * field name or inside a message as a query parameter, a bearer header or a JSON pair. A non-secret
 * word that merely contains "key" (`monkey`) stays readable, so the field rule is not a blunt
 * substring match.
 */

import { describe, expect, test } from "bun:test";

import { isSecretName, REDACTED, redactFields, redactText, redactValue } from "@/logging/redact";

describe("field names", () => {
	test("token, secret, password and key names lose their value", () => {
		expect(isSecretName("token")).toBe(true);
		expect(isSecretName("seedToken")).toBe(true);
		expect(isSecretName("seed_token")).toBe(true);
		expect(isSecretName("apiKey")).toBe(true);
		expect(isSecretName("password")).toBe(true);
		expect(isSecretName("secret")).toBe(true);
		expect(isSecretName("authorization")).toBe(true);
	});

	test("a word that merely contains key is not a secret", () => {
		expect(isSecretName("monkey")).toBe(false);
		expect(isSecretName("keyboard")).toBe(false);
		expect(isSecretName("count")).toBe(false);
	});

	test("nested structures are walked and every secret-named leaf is replaced", () => {
		expect(
			redactFields({
				files: 12,
				nested: { apiKey: "sk-live", list: [{ password: "hunter2" }, "keep"] },
			}),
		).toEqual({
			files: 12,
			nested: { apiKey: REDACTED, list: [{ password: REDACTED }, "keep"] },
		});
	});
});

describe("message text", () => {
	test("a token in a query string is redacted", () => {
		expect(redactText("GET /x?window=main&token=abc123&y=1")).toBe(
			`GET /x?window=main&token=${REDACTED}&y=1`,
		);
		expect(redactText("http://h/p?api_key=zzz")).toBe(`http://h/p?api_key=${REDACTED}`);
	});

	test("a bearer header and a JSON pair are redacted", () => {
		expect(redactText("authorization: Bearer abc.def-123")).toBe(
			`authorization: Bearer ${REDACTED}`,
		);
		expect(redactText('{"token":"abc","ok":true}')).toBe(`{"token":"${REDACTED}","ok":true}`);
	});

	test("a value under a url-shaped field is redacted even when the field name is not secret", () => {
		expect(redactValue("https://h/p?token=abc", "url")).toBe(`https://h/p?token=${REDACTED}`);
	});

	test("a long value is truncated and marked, never silently cut", () => {
		const long = "x".repeat(2500);
		const out = redactValue(long, "msg") as string;
		expect(out.endsWith("…[truncated]")).toBe(true);
		expect(out.length).toBe(2000 + "…[truncated]".length);
	});
});
