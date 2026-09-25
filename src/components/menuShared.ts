export type MainTab = 'LOCAL' | 'COMMUNITY' | 'SOCIAL' | 'PROGRESS' | 'GLOBAL' | 'SETTINGS' | 'REPLAYS';

export const formatPercentLabel = (value: number) => `${Math.round(value * 100)}%`;

export type IntegrityResultRow = {
  name: string;
  status: 'OK' | 'WARN' | 'ERROR';
  details: string;
};
