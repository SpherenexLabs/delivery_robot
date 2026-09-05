const firebaseConfig = {
  apiKey: 'AIzaSyAr4IYnykpwovqOJWzfBd7abVdAma_Ig3Q',
  authDomain: 'diet-planner-3bdf3.firebaseapp.com',
  databaseURL: 'https://diet-planner-3bdf3-default-rtdb.firebaseio.com',
  projectId: 'diet-planner-3bdf3',
  storageBucket: 'diet-planner-3bdf3.firebasestorage.app',
  messagingSenderId: '927878354911',
  appId: '1:927878354911:web:2e616b171a267b9910566a',
  measurementId: 'G-MSYWCM58MT',
};

const ROOT_PATH = 'Face_Detection_Based_5660';
let obstacleSafetyActive = false;
let obstacleBuzzerActive = false;
let deferredDirection = 'S';
let buzzResetTimer = null;
let servoResetTimer = null;

const toRobotTelemetry = (data) => ({
  battery: data?.Battery ?? null,
  buzz: data?.Buzzer ?? null,
  direction: data?.direction ?? 'S',
  obstacle: data?.Obstacle ?? null,
  servo: data?.Servo ?? null,
  voltage: data?.Voltage ?? null,
});

const toList = (records, sortField = 'createdAtMs') =>
  Object.values(records || {}).sort((first, second) => (second[sortField] || 0) - (first[sortField] || 0));

const request = async (path, options = {}) => {
  const method = options.method || 'GET';
  const maxAttempts = method === 'GET' ? 1 : 2;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(`${firebaseConfig.databaseURL}/${ROOT_PATH}/${path}.json`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Firebase request failed with status ${response.status}`);
      }

      if (method === 'DELETE') {
        return null;
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => window.setTimeout(resolve, 300));
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }

  throw new Error(
    lastError?.name === 'AbortError'
      ? 'Firebase request timed out. Check the internet connection and try again.'
      : `Firebase connection failed: ${lastError?.message || 'network error'}`,
  );
};

export const loadAdminData = async () => {
  const data = await request('');

  return {
    parcels: toList(data?.parcels),
    receivers: toList(data?.receivers),
    assignments: toList(data?.assignments),
    bookings: toList(data?.bookings),
    alerts: toList(data?.alerts),
    direction: data?.direction || 'S',
    telemetry: toRobotTelemetry(data),
    robotControl: data?.robotControl?.current || null,
    doorControl: data?.doorControl?.current || null,
    timerMap: data?.timerMap?.current || null,
    timerMaps: toList(data?.timerMaps, 'updatedAtMs'),
  };
};

export const saveRecord = (collection, record) =>
  request(`${collection}/${record.id}`, {
    method: 'PUT',
    body: JSON.stringify(record),
  });

export const updateRecord = (collection, id, updates) =>
  request(`${collection}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });

export const deleteRecord = (collection, id) =>
  request(`${collection}/${id}`, {
    method: 'DELETE',
  });

export const writeDeviceLocation = (coords) =>
  request('robotLocation/current', {
    method: 'PUT',
    body: JSON.stringify({
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy ?? null,
      updatedAt: new Date().toLocaleString(),
      updatedAtMs: Date.now(),
    }),
  });

export const loadDeviceLocation = () => request('robotLocation/current');

export const loadAlerts = async () => toList(await request('alerts'));

export const loadBookings = async () => toList(await request('bookings'));

export const loadRobotTelemetry = async () => {
  const [Battery, Buzzer, direction, Obstacle, Servo, Voltage] = await Promise.all([
    request('Battery'),
    request('Buzzer'),
    request('direction'),
    request('Obstacle'),
    request('Servo'),
    request('Voltage'),
  ]);

  return toRobotTelemetry({ Battery, Buzzer, direction, Obstacle, Servo, Voltage });
};

const sendDirection = (direction) =>
  request('direction', {
    method: 'PUT',
    body: JSON.stringify(direction),
  });

export const writeDirection = (direction) => {
  if (obstacleSafetyActive) {
    deferredDirection = direction;
    return sendDirection('S');
  }

  return sendDirection(direction);
};

export const setObstacleSafety = async (isActive, currentDirection = 'S') => {
  if (isActive) {
    obstacleSafetyActive = true;

    if (currentDirection && currentDirection !== 'S') {
      deferredDirection = currentDirection;
    }

    await sendDirection('S');
    return 'S';
  }

  obstacleSafetyActive = false;
  const directionToResume = deferredDirection || 'S';
  deferredDirection = 'S';
  await sendDirection(directionToResume);
  return directionToResume;
};

export const writeHardwareValue = (node, value) =>
  request(node, {
    method: 'PUT',
    body: JSON.stringify(value),
  });

export const activateBuzzAlert = async () => {
  window.clearTimeout(buzzResetTimer);
  await writeHardwareValue('Buzzer', 1);

  if (obstacleBuzzerActive) {
    buzzResetTimer = null;
    return;
  }

  buzzResetTimer = window.setTimeout(() => {
    if (!obstacleBuzzerActive) {
      writeHardwareValue('Buzzer', 0).catch(() => {});
    }
    buzzResetTimer = null;
  }, 5000);
};

export const syncObstacleBuzzer = async (isActive) => {
  obstacleBuzzerActive = isActive;
  window.clearTimeout(buzzResetTimer);
  buzzResetTimer = null;
  await writeHardwareValue('Buzzer', isActive ? 1 : 0);
};

export const activateServoForDelivery = async () => {
  window.clearTimeout(servoResetTimer);
  await writeHardwareValue('Servo', 1);

  servoResetTimer = window.setTimeout(() => {
    writeHardwareValue('Servo', 0).catch(() => {});
    servoResetTimer = null;
  }, 10000);
};
