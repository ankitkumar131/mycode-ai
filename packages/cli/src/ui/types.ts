export interface AppProps {
  cwd?: string;
  model?: string;
  provider?: string;
}

export interface AppState {
  theme: string;
  vimMode: boolean;
  modelName: string;
  providerName: string;
}
