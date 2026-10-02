// Per-recording level options and payloads.

export const SENS_LABELS = { 1: 'Lowest', 2: 'Low', 3: 'Normal', 4: 'High', 5: 'Highest' };
export const RUSTLE_OPTS = [['', 'Default'], ['2', 'Maximum'], ['1', 'Strong'], ['0.5', 'Gentle'], ['0', 'Off']];
export const rustleName = v => v >= 2 ? 'Maximum' : v >= 1 ? 'Strong' : v > 0 ? 'Gentle' : 'Off';
export const GATE_OFF = -80;
export const dbToLin = d => Math.pow(10, d / 20);

export const levelsPayload = clips => Object.fromEntries(clips.map(c => [c.name, c.edit]));
