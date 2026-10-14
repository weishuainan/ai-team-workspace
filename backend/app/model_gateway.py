from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import quote

import httpx
from openai import AsyncAzureOpenAI, AsyncOpenAI, __version__ as OPENAI_SDK_VERSION


MODEL_PROVIDERS = {
    "openai_responses",
    "openai_chat",
    "openai_compatible",
    "azure_openai",
    "anthropic",
    "gemini",
    "ollama",
}


def provider_label(provider: str) -> str:
    return {
        "openai_responses": "OpenAI Responses API",
        "openai_chat": "OpenAI Chat Completions",
        "openai_compatible": "OpenAI-compatible Chat Completions",
        "azure_openai": "Azure OpenAI",
        "anthropic": "Anthropic Messages",
        "gemini": "Google Gemini GenerateContent",
        "ollama": "Ollama Chat",
    }.get(provider, provider)


def provider_defaults(provider: str) -> dict[str, str]:
    return {
        "openai_responses": {"base_url": "https://api.openai.com/v1", "model_name": "gpt-5-mini"},
        "openai_chat": {"base_url": "https://api.openai.com/v1", "model_name": "gpt-4o-mini"},
        "openai_compatible": {"base_url": "https://api.openai.com/v1", "model_name": "gpt-4o-mini"},
        "azure_openai": {"base_url": "https://YOUR-RESOURCE.openai.azure.com", "model_name": "YOUR-DEPLOYMENT"},
        "anthropic": {"base_url": "https://api.anthropic.com/v1", "model_name": "claude-sonnet-4-5"},
        "gemini": {"base_url": "https://generativelanguage.googleapis.com/v1beta", "model_name": "gemini-2.5-flash"},
        "ollama": {"base_url": "http://localhost:11434", "model_name": "qwen3:8b"},
    }[provider]


def _system_and_conversation(messages: list[dict[str, str]]) -> tuple[str, list[dict[str, str]]]:
    system = "\n\n".join(message["content"] for message in messages if message.get("role") in {"system", "developer"})
    conversation = [message for message in messages if message.get("role") not in {"system", "developer"}]
    return system, conversation


def _usage(input_tokens: int = 0, output_tokens: int = 0, total_tokens: int = 0) -> dict[str, int]:
    return {
        "input_tokens": input_tokens or 0,
        "output_tokens": output_tokens or 0,
        "total_tokens": total_tokens or (input_tokens or 0) + (output_tokens or 0),
    }


def _text_parts(parts: Any) -> str:
    if isinstance(parts, str):
        return parts.strip()
    if not isinstance(parts, list):
        return ""
    values: list[str] = []
    for part in parts:
        if isinstance(part, dict):
            value = part.get("text") or part.get("content") or ""
        else:
            value = getattr(part, "text", "") or getattr(part, "content", "")
        if value:
            values.append(str(value))
    return "".join(values).strip()


def anthropic_request(messages: list[dict[str, str]], max_tokens: int, temperature: float) -> dict[str, Any]:
    system, conversation = _system_and_conversation(messages)
    payload: dict[str, Any] = {
        "messages": [{"role": "assistant" if item["role"] == "assistant" else "user", "content": item["content"]} for item in conversation],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if system:
        payload["system"] = system
    return payload


def gemini_request(messages: list[dict[str, str]], max_tokens: int, temperature: float) -> dict[str, Any]:
    system, conversation = _system_and_conversation(messages)
    payload: dict[str, Any] = {
        "contents": [{"role": "model" if item["role"] == "assistant" else "user", "parts": [{"text": item["content"]}]} for item in conversation],
        "generationConfig": {"maxOutputTokens": max_tokens, "temperature": temperature},
    }
    if system:
        payload["systemInstruction"] = {"parts": [{"text": system}]}
    return payload


def ollama_request(messages: list[dict[str, str]], max_tokens: int, temperature: float) -> dict[str, Any]:
    return {"messages": messages, "stream": False, "options": {"temperature": temperature, "num_predict": max_tokens}}


async def generate_text(
    config: dict[str, str],
    messages: list[dict[str, str]],
    *,
    temperature: float,
    max_tokens: int,
) -> dict[str, Any]:
    provider = config["provider"]
    model = config["model_name"]
    api_key = config.get("api_key") or ""
    base_url = config["base_url"].rstrip("/")
    timeout = float(config.get("timeout") or 110)

    if provider == "openai_responses":
        client = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=timeout, max_retries=2)
        response = await client.responses.create(model=model, input=messages, max_output_tokens=max_tokens)
        usage = getattr(response, "usage", None)
        return {
            "text": (response.output_text or "").strip(),
            "finish_reason": getattr(getattr(response, "incomplete_details", None), "reason", "") or "stop",
            "usage": _usage(getattr(usage, "input_tokens", 0), getattr(usage, "output_tokens", 0), getattr(usage, "total_tokens", 0)),
            "runtime": provider_label(provider),
            "sdk": "openai-python",
            "sdk_version": OPENAI_SDK_VERSION,
        }

    if provider in {"openai_chat", "openai_compatible", "azure_openai"}:
        if provider == "azure_openai":
            client = AsyncAzureOpenAI(api_key=api_key, azure_endpoint=base_url, api_version=config.get("api_version") or "2024-10-21", timeout=timeout, max_retries=2)
        else:
            client = AsyncOpenAI(api_key=api_key or "not-needed", base_url=base_url, timeout=timeout, max_retries=2)
        completion_options: dict[str, Any] = {"model": model, "messages": messages}
        if provider == "openai_compatible":
            completion_options.update({"temperature": temperature, "max_tokens": max_tokens})
        else:
            completion_options["max_completion_tokens"] = max_tokens
            if provider == "openai_chat":
                completion_options["temperature"] = temperature
        response = await client.chat.completions.create(**completion_options)
        choice = response.choices[0] if response.choices else None
        usage = getattr(response, "usage", None)
        return {
            "text": _text_parts(getattr(getattr(choice, "message", None), "content", "")),
            "finish_reason": getattr(choice, "finish_reason", "") or "",
            "usage": _usage(getattr(usage, "prompt_tokens", 0), getattr(usage, "completion_tokens", 0), getattr(usage, "total_tokens", 0)),
            "runtime": provider_label(provider),
            "sdk": "openai-python",
            "sdk_version": OPENAI_SDK_VERSION,
        }

    headers = {"Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=timeout) as client:
        if provider == "anthropic":
            headers.update({"x-api-key": api_key, "anthropic-version": config.get("api_version") or "2023-06-01"})
            payload = {"model": model, **anthropic_request(messages, max_tokens, temperature)}
            response = await client.post(f"{base_url}/messages", headers=headers, json=payload)
            response.raise_for_status(); body = response.json(); usage = body.get("usage") or {}
            return {"text": _text_parts(body.get("content")), "finish_reason": body.get("stop_reason", ""), "usage": _usage(usage.get("input_tokens", 0), usage.get("output_tokens", 0)), "runtime": provider_label(provider), "sdk": "httpx", "sdk_version": httpx.__version__}
        if provider == "gemini":
            headers["x-goog-api-key"] = api_key
            response = await client.post(f"{base_url}/models/{quote(model, safe='')}:generateContent", headers=headers, json=gemini_request(messages, max_tokens, temperature))
            response.raise_for_status(); body = response.json(); candidates = body.get("candidates") or []; candidate = candidates[0] if candidates else {}; usage = body.get("usageMetadata") or {}
            return {"text": _text_parts((candidate.get("content") or {}).get("parts")), "finish_reason": candidate.get("finishReason", ""), "usage": _usage(usage.get("promptTokenCount", 0), usage.get("candidatesTokenCount", 0), usage.get("totalTokenCount", 0)), "runtime": provider_label(provider), "sdk": "httpx", "sdk_version": httpx.__version__}
        if provider == "ollama":
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            payload = {"model": model, **ollama_request(messages, max_tokens, temperature)}
            response = await client.post(f"{base_url}/api/chat", headers=headers, json=payload)
            response.raise_for_status(); body = response.json()
            return {"text": str((body.get("message") or {}).get("content") or "").strip(), "finish_reason": body.get("done_reason", ""), "usage": _usage(body.get("prompt_eval_count", 0), body.get("eval_count", 0)), "runtime": provider_label(provider), "sdk": "httpx", "sdk_version": httpx.__version__}
    raise ValueError("UNSUPPORTED_MODEL_PROVIDER")


async def stream_text(
    config: dict[str, str],
    messages: list[dict[str, str]],
    *,
    temperature: float,
    max_tokens: int,
) -> AsyncIterator[str]:
    provider = config["provider"]
    api_key = config.get("api_key") or ""
    timeout = float(config.get("timeout") or 110)
    if provider in {"openai_chat", "openai_compatible", "azure_openai"}:
        if provider == "azure_openai":
            client = AsyncAzureOpenAI(api_key=api_key, azure_endpoint=config["base_url"], api_version=config.get("api_version") or "2024-10-21", timeout=timeout, max_retries=2)
        else:
            client = AsyncOpenAI(api_key=api_key or "not-needed", base_url=config["base_url"], timeout=timeout, max_retries=2)
        completion_options: dict[str, Any] = {"model": config["model_name"], "messages": messages, "stream": True}
        if provider == "openai_compatible":
            completion_options.update({"temperature": temperature, "max_tokens": max_tokens})
        else:
            completion_options["max_completion_tokens"] = max_tokens
            if provider == "openai_chat":
                completion_options["temperature"] = temperature
        stream = await client.chat.completions.create(**completion_options)
        async for chunk in stream:
            choice = chunk.choices[0] if chunk.choices else None
            content = getattr(getattr(choice, "delta", None), "content", "")
            if content:
                yield str(content)
        return
    if provider == "openai_responses":
        client = AsyncOpenAI(api_key=api_key, base_url=config["base_url"], timeout=timeout, max_retries=2)
        stream = await client.responses.create(model=config["model_name"], input=messages, max_output_tokens=max_tokens, stream=True)
        async for event in stream:
            if getattr(event, "type", "") == "response.output_text.delta" and getattr(event, "delta", ""):
                yield str(event.delta)
        return
    result = await generate_text(config, messages, temperature=temperature, max_tokens=max_tokens)
    if result["text"]:
        yield result["text"]
