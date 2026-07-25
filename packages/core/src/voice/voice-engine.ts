export interface VoiceConfig {
  provider: 'elevenlabs' | 'groq' | 'local';
  apiKey?: string;
  model?: string;
  language?: string;
}

export class VoiceEngine {
  constructor(private config: VoiceConfig = { provider: 'groq' }) {}

  async transcribe(audioBuffer: Buffer): Promise<string> {
    if (!this.config.apiKey && this.config.provider !== 'local') {
      return '(Voice transcription disabled: missing API key)';
    }
    return 'Transcribed audio input placeholder.';
  }

  isAvailable(): boolean {
    return Boolean(this.config.apiKey || this.config.provider === 'local');
  }
}

export const voiceEngine = new VoiceEngine();
