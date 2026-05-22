import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseConfigFile } from "./parser";
import * as fs from "node:fs/promises";

vi.mock("node:fs/promises");

const mockFs = fs as typeof import("node:fs/promises");

describe("parseConfigFile", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("parses .json files", async () => {
		vi.mocked(mockFs.readFile).mockResolvedValue(
			'{"providers": ["openai"], "tools": ["getTime"]}',
		);

		const result = await parseConfigFile("/path/to/config.json");

		expect(result).toEqual({ providers: ["openai"], tools: ["getTime"] });
	});

	it("parses .yaml files", async () => {
		vi.mocked(mockFs.readFile).mockResolvedValue(
			"providers:\n  - openai\ntools:\n  - getTime\n",
		);

		const result = await parseConfigFile("/path/to/config.yaml");

		expect(result).toEqual({ providers: ["openai"], tools: ["getTime"] });
	});

	it("parses .yml files", async () => {
		vi.mocked(mockFs.readFile).mockResolvedValue(
			"providers:\n  - openai\n",
		);

		const result = await parseConfigFile("/path/to/config.yml");

		expect(result).toEqual({ providers: ["openai"] });
	});

	it("parses .toml files", async () => {
		vi.mocked(mockFs.readFile).mockResolvedValue(
			'providers = ["openai"]\n',
		);

		const result = await parseConfigFile("/path/to/config.toml");

		expect(result).toEqual({ providers: ["openai"] });
	});

	it("throws on unknown file extension", async () => {
		vi.mocked(mockFs.readFile).mockResolvedValue("some content");

		await expect(parseConfigFile("/path/to/config.txt")).rejects.toThrow(
			"Unsupported config file extension: .txt",
		);
	});

	it("throws on missing file", async () => {
		const err = new Error("ENOENT: no such file or directory");
		(err as NodeJS.ErrnoException).code = "ENOENT";
		vi.mocked(mockFs.readFile).mockRejectedValue(err);

		await expect(parseConfigFile("/path/to/missing.json")).rejects.toThrow(
			"Config file not found: /path/to/missing.json",
		);
	});
});
