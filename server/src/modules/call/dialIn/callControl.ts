/**
 * Call Control adapter for dial-in IVR.
 * FakeCallControl records commands for e2e.
 * TelnyxCallControl posts real commands when an API key is configured.
 */

import { DIAL_IN_TTS_VOICE, TELNYX_API_BASE } from "../../../config.js";
import { readSettings } from "../../settings/repo.js";

export type GatherUsingSpeakOpts = {
  payload: string;
  maximumDigits?: number;
  minimumDigits?: number;
  timeoutMillis?: number;
  validDigits?: string;
  clientState?: string;
};

export type SpeakOpts = {
  payload: string;
  clientState?: string;
};

export type StreamingStartOpts = {
  streamUrl?: string;
  streamTrack?: "inbound_track" | "outbound_track" | "both_tracks";
  /** Telnyx bidirectional mode. Use "rtp" for L16/PCMU payloads. */
  streamBidirectionalMode?: "rtp" | "mp3";
  /** Codec for bidirectional RTP. Default PCMU (8 kHz PSTN). */
  streamBidirectionalCodec?: "PCMU" | "PCMA" | "G722" | "OPUS" | "AMR-WB" | "L16";
  /** Sampling rate for bidirectional RTP (Hz). Use 16000 with L16 for HD. */
  streamBidirectionalSamplingRate?: 8000 | 16000 | 22050 | 24000 | 48000;
};

/** Telnyx reject causes. Prefer reject over answer+hangup when no call is live (no billable answer). */
export type RejectCause = "CALL_REJECTED" | "USER_BUSY";

export type RejectOpts = {
  cause?: RejectCause;
};

export type CallControlCommand =
  | { type: "answer"; callControlId: string; at: number }
  | {
      type: "reject";
      callControlId: string;
      opts: RejectOpts;
      at: number;
    }
  | {
      type: "gather_using_speak";
      callControlId: string;
      opts: GatherUsingSpeakOpts;
      at: number;
    }
  | { type: "speak"; callControlId: string; opts: SpeakOpts; at: number }
  | {
      type: "consent_prompt";
      callControlId: string;
      opts: SpeakOpts;
      at: number;
    }
  | { type: "hangup"; callControlId: string; at: number }
  | {
      type: "streaming_start";
      callControlId: string;
      opts: StreamingStartOpts;
      at: number;
    };

export interface CallControlClient {
  answer(callControlId: string): Promise<void>;
  /** Reject before answer so Telnyx does not bill an answered leg. */
  reject(callControlId: string, opts?: RejectOpts): Promise<void>;
  gatherUsingSpeak(
    callControlId: string,
    opts: GatherUsingSpeakOpts,
  ): Promise<void>;
  speak(callControlId: string, opts: SpeakOpts): Promise<void>;
  /** Log/speak recording consent before bridge (Fake records as consent_prompt). */
  consentPrompt(callControlId: string, opts: SpeakOpts): Promise<void>;
  hangup(callControlId: string): Promise<void>;
  streamingStart(
    callControlId: string,
    opts?: StreamingStartOpts,
  ): Promise<void>;
}

export class FakeCallControlClient implements CallControlClient {
  commands: CallControlCommand[] = [];

  clear(): void {
    this.commands = [];
  }

  async answer(callControlId: string): Promise<void> {
    this.commands.push({ type: "answer", callControlId, at: Date.now() });
  }

  async reject(callControlId: string, opts: RejectOpts = {}): Promise<void> {
    this.commands.push({
      type: "reject",
      callControlId,
      opts: { cause: opts.cause ?? "CALL_REJECTED" },
      at: Date.now(),
    });
  }

  async gatherUsingSpeak(
    callControlId: string,
    opts: GatherUsingSpeakOpts,
  ): Promise<void> {
    this.commands.push({
      type: "gather_using_speak",
      callControlId,
      opts,
      at: Date.now(),
    });
  }

  async speak(callControlId: string, opts: SpeakOpts): Promise<void> {
    this.commands.push({ type: "speak", callControlId, opts, at: Date.now() });
  }

  async consentPrompt(callControlId: string, opts: SpeakOpts): Promise<void> {
    this.commands.push({
      type: "consent_prompt",
      callControlId,
      opts,
      at: Date.now(),
    });
  }

  async hangup(callControlId: string): Promise<void> {
    this.commands.push({ type: "hangup", callControlId, at: Date.now() });
  }

  async streamingStart(
    callControlId: string,
    opts: StreamingStartOpts = {},
  ): Promise<void> {
    this.commands.push({
      type: "streaming_start",
      callControlId,
      opts,
      at: Date.now(),
    });
  }
}

export class TelnyxCallControlClient implements CallControlClient {
  constructor(private readonly apiKey: string) {}

  private async postAction(
    callControlId: string,
    action: string,
    body: Record<string, unknown> = {},
  ): Promise<void> {
    const id = encodeURIComponent(callControlId);
    const url = `${TELNYX_API_BASE}/calls/${id}/actions/${action}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Telnyx ${action} failed: ${res.status} ${text.slice(0, 400)}`,
      );
    }
  }

  async answer(callControlId: string): Promise<void> {
    await this.postAction(callControlId, "answer", {});
  }

  async reject(callControlId: string, opts: RejectOpts = {}): Promise<void> {
    await this.postAction(callControlId, "reject", {
      cause: opts.cause ?? "CALL_REJECTED",
    });
  }

  async gatherUsingSpeak(
    callControlId: string,
    opts: GatherUsingSpeakOpts,
  ): Promise<void> {
    await this.postAction(callControlId, "gather_using_speak", {
      payload: opts.payload,
      voice: DIAL_IN_TTS_VOICE,
      language: "en-US",
      minimum_digits: opts.minimumDigits ?? 4,
      maximum_digits: opts.maximumDigits ?? 4,
      timeout_millis: opts.timeoutMillis ?? 15_000,
      valid_digits: opts.validDigits ?? "0123456789",
      ...(opts.clientState ? { client_state: opts.clientState } : {}),
    });
  }

  async speak(callControlId: string, opts: SpeakOpts): Promise<void> {
    await this.postAction(callControlId, "speak", {
      payload: opts.payload,
      voice: DIAL_IN_TTS_VOICE,
      language: "en-US",
      ...(opts.clientState ? { client_state: opts.clientState } : {}),
    });
  }

  async consentPrompt(callControlId: string, opts: SpeakOpts): Promise<void> {
    await this.speak(callControlId, opts);
  }

  async hangup(callControlId: string): Promise<void> {
    await this.postAction(callControlId, "hangup", {});
  }

  async streamingStart(
    callControlId: string,
    opts: StreamingStartOpts = {},
  ): Promise<void> {
    // Placeholder URLs are for FakeDialIn / e2e only; do not call Telnyx.
    if (!opts.streamUrl || opts.streamUrl.includes("fake.local")) {
      return;
    }
    await this.postAction(callControlId, "streaming_start", {
      stream_url: opts.streamUrl,
      stream_track: opts.streamTrack ?? "inbound_track",
      stream_bidirectional_mode: opts.streamBidirectionalMode ?? "rtp",
      stream_bidirectional_codec: opts.streamBidirectionalCodec ?? "PCMU",
      ...(opts.streamBidirectionalSamplingRate
        ? {
            stream_bidirectional_sampling_rate:
              opts.streamBidirectionalSamplingRate,
          }
        : {}),
    });
  }
}

/**
 * Runs Fake (for e2e inspect) and optionally Telnyx (live PSTN) in parallel.
 * Fake always records. Telnyx failures are logged and rethrown.
 */
export class DualCallControlClient implements CallControlClient {
  constructor(
    private readonly fake: FakeCallControlClient,
    private readonly live: CallControlClient,
  ) {}

  private async withLive(
    label: string,
    callControlId: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      console.warn(
        `[dial-in] Telnyx ${label} failed for ${callControlId}:`,
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  }

  async answer(callControlId: string): Promise<void> {
    await this.fake.answer(callControlId);
    await this.withLive("answer", callControlId, () =>
      this.live.answer(callControlId),
    );
  }

  async reject(callControlId: string, opts?: RejectOpts): Promise<void> {
    await this.fake.reject(callControlId, opts);
    await this.withLive("reject", callControlId, () =>
      this.live.reject(callControlId, opts),
    );
  }

  async gatherUsingSpeak(
    callControlId: string,
    opts: GatherUsingSpeakOpts,
  ): Promise<void> {
    await this.fake.gatherUsingSpeak(callControlId, opts);
    await this.withLive("gather_using_speak", callControlId, () =>
      this.live.gatherUsingSpeak(callControlId, opts),
    );
  }

  async speak(callControlId: string, opts: SpeakOpts): Promise<void> {
    await this.fake.speak(callControlId, opts);
    await this.withLive("speak", callControlId, () =>
      this.live.speak(callControlId, opts),
    );
  }

  async consentPrompt(callControlId: string, opts: SpeakOpts): Promise<void> {
    await this.fake.consentPrompt(callControlId, opts);
    await this.withLive("consent_prompt", callControlId, () =>
      this.live.consentPrompt(callControlId, opts),
    );
  }

  async hangup(callControlId: string): Promise<void> {
    await this.fake.hangup(callControlId);
    await this.withLive("hangup", callControlId, () =>
      this.live.hangup(callControlId),
    );
  }

  async streamingStart(
    callControlId: string,
    opts?: StreamingStartOpts,
  ): Promise<void> {
    await this.fake.streamingStart(callControlId, opts);
    await this.withLive("streaming_start", callControlId, () =>
      this.live.streamingStart(callControlId, opts),
    );
  }
}

const fakeCallControl = new FakeCallControlClient();

/** Shared Fake Call Control instance (e2e inspects recorded commands). */
export function getFakeCallControl(): FakeCallControlClient {
  return fakeCallControl;
}

function getTelnyxApiKey(): string {
  const key = (readSettings().telnyx_api_key ?? "").trim();
  if (!key || key === "(set)") return "";
  return key;
}

/** Fake for e2e; Dual(+Telnyx) when a Telnyx API key is saved in settings. */
export function getCallControlClient(): CallControlClient {
  const apiKey = getTelnyxApiKey();
  if (!apiKey) return fakeCallControl;
  return new DualCallControlClient(
    fakeCallControl,
    new TelnyxCallControlClient(apiKey),
  );
}
