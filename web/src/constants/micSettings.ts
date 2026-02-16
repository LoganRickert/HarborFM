export const DEVICE_ID_KEY = 'harborfm_call_device_id';
export const getAgcKey = (deviceId: string) => `harborfm_call_agc_${deviceId || 'default'}`;
export const getMicVolumeKey = (deviceId: string) => `harborfm_call_mic_volume_${deviceId || 'default'}`;
