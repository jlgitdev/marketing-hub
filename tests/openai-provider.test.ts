import { describe, expect, it } from "vitest";
import {
  OPENAI_IMAGE_TIMEOUT_MS,
  OPENAI_RESEARCH_TIMEOUT_MS,
  OPENAI_TEXT_TIMEOUT_MS,
  buildSpeakerSpotlightImageEditRequest,
  classifyProviderError,
  collectSourceMetadata
} from "@/server/ai/openai-provider";

describe("OpenAI provider diagnostics and GPT Image 2 request", () => {
  it("builds a model-correct 2:3 GPT Image 2 edit without input_fidelity", () => {
    const image = [{} as never, {} as never];
    const request = buildSpeakerSpotlightImageEditRequest(image, "Create the verified speaker card");

    expect(request).toMatchObject({
      model: "gpt-image-2",
      image,
      prompt: "Create the verified speaker card",
      size: "1024x1536",
      quality: "high",
      output_format: "png"
    });
    expect(request).not.toHaveProperty("input_fidelity");
    expect(OPENAI_IMAGE_TIMEOUT_MS).toBeGreaterThanOrEqual(180_000);
  });

  it("preserves safe invalid-request diagnostics without exposing the provider message", () => {
    const error = Object.assign(new Error("400 rejected secret sk-example-do-not-expose"), {
      status: 400,
      code: "invalid_value",
      type: "invalid_request_error",
      param: "input_fidelity",
      requestID: "req_test_invalid_request"
    });

    const failure = classifyProviderError(error);

    expect(failure.code).toBe("invalid_request");
    expect(failure.details).toMatchObject({
      status: 400,
      providerCode: "invalid_value",
      providerType: "invalid_request_error",
      param: "input_fidelity",
      requestId: "req_test_invalid_request",
      retryable: false
    });
    expect(failure.message).toContain("parameter input_fidelity");
    expect(failure.message).toContain("req_test_invalid_request");
    expect(failure.message).not.toContain("sk-example-do-not-expose");
  });

  it("marks server failures as retryable and retains the request id", () => {
    const error = Object.assign(new Error("Internal server error"), {
      status: 503,
      code: "server_error",
      type: "server_error",
      requestID: "req_test_server_error"
    });

    const failure = classifyProviderError(error);

    expect(failure.code).toBe("server_error");
    expect(failure.details).toMatchObject({ status: 503, requestId: "req_test_server_error", retryable: true });
  });

  it("recognizes the SDK's timed-out wording and allows long-running provider operations", () => {
    const error = Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" });

    const failure = classifyProviderError(error);

    expect(failure.code).toBe("timeout");
    expect(failure.details.retryable).toBe(true);
    expect(OPENAI_RESEARCH_TIMEOUT_MS).toBeGreaterThan(180_000);
    expect(OPENAI_TEXT_TIMEOUT_MS).toBeGreaterThanOrEqual(180_000);
  });

  it("records directly opened web-search pages as provider-observed evidence", () => {
    const metadata = collectSourceMetadata([{
      type: "web_search_call",
      action: { type: "open_page", url: "https://example.com/contact" }
    }]);

    expect(metadata.get("https://example.com/contact")?.webSearchAction).toMatchObject({ type: "open_page" });
  });
});
