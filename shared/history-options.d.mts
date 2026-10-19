export interface HistoryOptions {enabled:boolean;intervalMinutes:number;maxEntries:number;retentionDays:number;}
export const HISTORY_DEFAULTS: Readonly<HistoryOptions>;
export function historyOptions(value?: unknown): HistoryOptions;
export function storedHistoryOptions(text: string | null | undefined): HistoryOptions;
