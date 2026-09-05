const CAMERA_BRIDGE_URL = (import.meta.env.VITE_CAMERA_BRIDGE_URL || '').trim().replace(/\/$/, '');

const isLocalApp = () =>
  ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

export const resolveCameraStreamUrl = (inputUrl) => {
  const cameraUrl = new URL(inputUrl.trim());

  if (!['http:', 'https:', 'rtsp:'].includes(cameraUrl.protocol)) {
    throw new Error('Enter a complete RTSP, HTTP, or HTTPS camera URL.');
  }

  const isLegacyMaizicUrl =
    cameraUrl.protocol === 'http:' &&
    cameraUrl.port === '8080' &&
    cameraUrl.pathname.toLowerCase() === '/video';
  const streamUrl = isLegacyMaizicUrl
    ? `rtsp://${cameraUrl.username}:${cameraUrl.password}@${cameraUrl.hostname}:554/stream1`
    : cameraUrl.toString();
  const streamProtocol = new URL(streamUrl).protocol;

  if (streamProtocol === 'rtsp:') {
    if (!CAMERA_BRIDGE_URL && !isLocalApp()) {
      throw new Error(
        'RTSP needs an HTTPS camera bridge in production. Set VITE_CAMERA_BRIDGE_URL in Vercel and redeploy.',
      );
    }

    return `${CAMERA_BRIDGE_URL}/api/ip-camera/stream?url=${encodeURIComponent(streamUrl)}`;
  }

  if (window.location.protocol === 'https:' && streamProtocol === 'http:') {
    throw new Error('An HTTPS deployment cannot open an HTTP camera stream. Use an HTTPS camera URL or bridge.');
  }

  return streamUrl;
};

const CAMERA_ERROR_HINTS = {
  NotAllowedError: 'Camera permission is blocked. Click the camera icon in the address bar (or check Windows Settings > Privacy & security > Camera) and allow access for this site, then reload.',
  NotFoundError: 'No camera was found. Check that a webcam is connected and enabled.',
  NotReadableError: 'The camera is already in use by another app or browser tab. Close it and try again.',
  OverconstrainedError: 'The selected camera does not support the requested settings. Try a different camera.',
  SecurityError: 'Camera access is blocked by the browser for this page.',
};

export const describeCameraError = (error) => {
  const hint = CAMERA_ERROR_HINTS[error?.name];
  if (hint) {
    return hint;
  }
  return error?.message || 'Could not access the camera. Please allow camera permission and try again.';
};

export const listVideoInputDevices = async () => {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return [];
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === 'videoinput');
};

export const openWebcamStream = async (deviceIndex, { width = 640, height = 480 } = {}) => {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera access is not supported in this browser.');
  }

  const devices = await listVideoInputDevices();
  const selectedDevice = devices[deviceIndex];

  if (devices.length > 0 && !selectedDevice) {
    throw new Error(`Camera ${deviceIndex} was not found. Only ${devices.length} camera(s) detected.`);
  }

  const videoConstraints = selectedDevice
    ? { deviceId: { exact: selectedDevice.deviceId }, width: { ideal: width }, height: { ideal: height } }
    : { facingMode: 'user', width: { ideal: width }, height: { ideal: height } };

  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
  const devicesWithLabels = await listVideoInputDevices();

  return { stream, devices: devicesWithLabels };
};
